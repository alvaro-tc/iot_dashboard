-- Esquema del dashboard del robot. `pnpm db:reset` lo aplica desde cero.
--
-- Todo en español: tablas, columnas y valores de los CHECK. Los nombres de los sensores
-- (izquierdo / central / derecho) y el rango de los motores (-255..255) son los mismos que
-- usa el firmware del ESP32 en `firmware/`, para que el JSON que publica el robot se pueda
-- guardar sin traducir nada por el camino.
DROP VIEW IF EXISTS v_resumen_sesion, v_lecturas_por_hora, v_lecturas_por_minuto CASCADE;
DROP TABLE IF EXISTS lecturas, sesiones, configuracion_dispositivo, dispositivos, usuarios CASCADE;
-- Restos de esquemas anteriores, por si la base viene de un despliegue viejo.
DROP FUNCTION IF EXISTS obtener_mapa_sesion(BIGINT, INTEGER) CASCADE;
DROP TABLE IF EXISTS eventos, users, samples, runs, devices CASCADE;

CREATE TABLE usuarios (
  id          SERIAL PRIMARY KEY,
  correo      TEXT UNIQUE NOT NULL,
  contrasena  TEXT NOT NULL,              -- hash bcrypt
  nombre      TEXT NOT NULL,
  rol         TEXT NOT NULL CHECK (rol IN ('admin','cliente')),
  activo      BOOLEAN NOT NULL DEFAULT true,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un robot. El id es además el usuario MQTT: la ACL de Mosquitto lo ata a roomba/{id}/#.
CREATE TABLE dispositivos (
  id                TEXT PRIMARY KEY,                -- ej. 'roomba-7f3a9c2b'
  usuario_id        INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre            TEXT NOT NULL,                   -- ej. 'Roomba Sala'
  ubicacion         TEXT NOT NULL DEFAULT '',
  token_hash        TEXT NOT NULL,                   -- hash bcrypt del token MQTT
  revocado          BOOLEAN NOT NULL DEFAULT false,
  en_linea          BOOLEAN NOT NULL DEFAULT false,
  ultimo_contacto   TIMESTAMPTZ,
  version_firmware  TEXT,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dispositivos_usuario ON dispositivos (usuario_id);

-- 1 a 1 con dispositivos: lo que el robot obedece. El backend la publica retenida en `config`.
CREATE TABLE configuracion_dispositivo (
  dispositivo_id    TEXT PRIMARY KEY REFERENCES dispositivos(id) ON DELETE CASCADE,
  -- PWM de crucero de los motores, en la misma escala que el firmware (PWM_MAXIMO = 255).
  velocidad_base    SMALLINT NOT NULL DEFAULT 180 CHECK (velocidad_base BETWEEN 0 AND 255),
  -- Ángulo de montaje de cada HC-SR04 respecto al frente del robot.
  angulos_sensores  JSONB NOT NULL DEFAULT '{"izquierdo":-45,"central":0,"derecho":45}',
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un ciclo de funcionamiento: se abre con la primera lectura que llega y se cierra cuando el
-- robot se desconecta o deja de publicar.
CREATE TABLE sesiones (
  id                        BIGSERIAL PRIMARY KEY,
  dispositivo_id            TEXT NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
  iniciada_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalizada_en             TIMESTAMPTZ,             -- null = sigue activa
  total_lecturas            INTEGER NOT NULL DEFAULT 0,
  bateria_inicio_porcentaje SMALLINT,
  bateria_fin_porcentaje    SMALLINT
);
-- Regla impuesta por la base: un robot no puede tener dos sesiones abiertas a la vez.
CREATE UNIQUE INDEX uniq_sesion_activa_por_dispositivo
  ON sesiones (dispositivo_id) WHERE finalizada_en IS NULL;
CREATE INDEX idx_sesiones_dispositivo ON sesiones (dispositivo_id, iniciada_en DESC);

-- Telemetría: una fila por mensaje publicado por el robot.
CREATE TABLE lecturas (
  id                      BIGSERIAL PRIMARY KEY,
  dispositivo_id          TEXT NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
  sesion_id               BIGINT REFERENCES sesiones(id) ON DELETE CASCADE,
  -- null = el eco no volvió: no hay objeto dentro del alcance del sensor.
  distancia_izquierda_cm  NUMERIC(5,1) CHECK (distancia_izquierda_cm BETWEEN 0 AND 400),
  distancia_central_cm    NUMERIC(5,1) CHECK (distancia_central_cm   BETWEEN 0 AND 400),
  distancia_derecha_cm    NUMERIC(5,1) CHECK (distancia_derecha_cm   BETWEEN 0 AND 400),
  -- PWM con signo de cada rueda: negativo retrocede, positivo avanza, 0 parada.
  -- Sustituye al antiguo `estado_movimiento`: con las dos ruedas se sabe si avanza,
  -- retrocede o gira (y hacia dónde), sin inventar una etiqueta intermedia.
  movimiento_izquierda    SMALLINT NOT NULL CHECK (movimiento_izquierda BETWEEN -255 AND 255),
  movimiento_derecha      SMALLINT NOT NULL CHECK (movimiento_derecha   BETWEEN -255 AND 255),
  bateria_voltios         NUMERIC(4,2) CHECK (bateria_voltios >= 0),
  bateria_porcentaje      SMALLINT CHECK (bateria_porcentaje BETWEEN 0 AND 100),
  creado_en               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lecturas_dispositivo ON lecturas (dispositivo_id, creado_en DESC);
CREATE INDEX idx_lecturas_sesion ON lecturas (sesion_id, creado_en);

-- Crea la configuración por defecto junto con el robot: ningún camino del código
-- puede dejar un dispositivo sin fila de configuración.
CREATE OR REPLACE FUNCTION crear_configuracion_por_defecto() RETURNS TRIGGER AS $fn$
BEGIN
  INSERT INTO configuracion_dispositivo (dispositivo_id) VALUES (NEW.id);
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_configuracion_por_defecto
  AFTER INSERT ON dispositivos
  FOR EACH ROW EXECUTE FUNCTION crear_configuracion_por_defecto();

-- ---------------------------------------------------------------------------
-- Vistas de agregación
-- ---------------------------------------------------------------------------
--
-- "En marcha" = alguna rueda con PWM de al menos 10 (de 255). Por debajo de eso el motor
-- no mueve el chasis: contarlo como marcha infla el tiempo de uso con ruido.

CREATE VIEW v_lecturas_por_minuto AS
SELECT
  l.dispositivo_id,
  l.sesion_id,
  date_trunc('minute', l.creado_en)                       AS minuto,
  count(*)                                                AS lecturas,
  min(l.distancia_izquierda_cm)                           AS min_izquierda_cm,
  min(l.distancia_central_cm)                             AS min_central_cm,
  min(l.distancia_derecha_cm)                             AS min_derecha_cm,
  avg(l.distancia_izquierda_cm)                           AS prom_izquierda_cm,
  avg(l.distancia_central_cm)                             AS prom_central_cm,
  avg(l.distancia_derecha_cm)                             AS prom_derecha_cm,
  avg(abs(l.movimiento_izquierda))                        AS prom_pwm_izquierda,
  avg(abs(l.movimiento_derecha))                          AS prom_pwm_derecha,
  count(*) FILTER (WHERE abs(l.movimiento_izquierda) >= 10
                      OR abs(l.movimiento_derecha)   >= 10) AS lecturas_en_marcha,
  count(*) FILTER (WHERE abs(l.movimiento_izquierda) <  10
                     AND abs(l.movimiento_derecha)   <  10) AS lecturas_detenido,
  avg(l.bateria_porcentaje)                               AS prom_bateria_porcentaje
FROM lecturas l
GROUP BY 1, 2, 3;

CREATE VIEW v_lecturas_por_hora AS
SELECT
  l.dispositivo_id,
  date_trunc('hour', l.creado_en)                         AS hora,
  count(*)                                                AS lecturas,
  min(l.distancia_izquierda_cm)                           AS min_izquierda_cm,
  min(l.distancia_central_cm)                             AS min_central_cm,
  min(l.distancia_derecha_cm)                             AS min_derecha_cm,
  avg(l.distancia_izquierda_cm)                           AS prom_izquierda_cm,
  avg(l.distancia_central_cm)                             AS prom_central_cm,
  avg(l.distancia_derecha_cm)                             AS prom_derecha_cm,
  avg(abs(l.movimiento_izquierda))                        AS prom_pwm_izquierda,
  avg(abs(l.movimiento_derecha))                          AS prom_pwm_derecha,
  count(*) FILTER (WHERE abs(l.movimiento_izquierda) >= 10
                      OR abs(l.movimiento_derecha)   >= 10) AS lecturas_en_marcha,
  count(*) FILTER (WHERE abs(l.movimiento_izquierda) <  10
                     AND abs(l.movimiento_derecha)   <  10) AS lecturas_detenido,
  avg(l.bateria_porcentaje)                               AS prom_bateria_porcentaje,
  -- Cuántas veces cada sensor vio algo a 15 cm o menos: en qué dirección se topa el robot.
  count(*) FILTER (WHERE l.distancia_izquierda_cm IS NOT NULL AND l.distancia_izquierda_cm <= 15) AS cerca_izquierda,
  count(*) FILTER (WHERE l.distancia_central_cm   IS NOT NULL AND l.distancia_central_cm   <= 15) AS cerca_central,
  count(*) FILTER (WHERE l.distancia_derecha_cm   IS NOT NULL AND l.distancia_derecha_cm   <= 15) AS cerca_derecha
FROM lecturas l
GROUP BY 1, 2;

CREATE VIEW v_resumen_sesion AS
SELECT
  s.id                                                                  AS sesion_id,
  s.dispositivo_id,
  s.iniciada_en,
  s.finalizada_en,
  EXTRACT(EPOCH FROM (coalesce(s.finalizada_en, now()) - s.iniciada_en)) AS duracion_s,
  s.total_lecturas,
  s.bateria_inicio_porcentaje,
  s.bateria_fin_porcentaje,
  s.bateria_inicio_porcentaje - s.bateria_fin_porcentaje                AS bateria_consumida_porcentaje,
  agg.lecturas_en_marcha,
  agg.lecturas_detenido,
  agg.prom_pwm_izquierda,
  agg.prom_pwm_derecha,
  agg.min_izquierda_cm,
  agg.min_central_cm,
  agg.min_derecha_cm,
  agg.cerca_izquierda,
  agg.cerca_central,
  agg.cerca_derecha
FROM sesiones s
LEFT JOIN LATERAL (
  SELECT
    count(*) FILTER (WHERE abs(l.movimiento_izquierda) >= 10
                        OR abs(l.movimiento_derecha)   >= 10)           AS lecturas_en_marcha,
    count(*) FILTER (WHERE abs(l.movimiento_izquierda) <  10
                       AND abs(l.movimiento_derecha)   <  10)           AS lecturas_detenido,
    avg(abs(l.movimiento_izquierda))                                    AS prom_pwm_izquierda,
    avg(abs(l.movimiento_derecha))                                      AS prom_pwm_derecha,
    min(l.distancia_izquierda_cm)                                       AS min_izquierda_cm,
    min(l.distancia_central_cm)                                         AS min_central_cm,
    min(l.distancia_derecha_cm)                                         AS min_derecha_cm,
    count(*) FILTER (WHERE l.distancia_izquierda_cm IS NOT NULL AND l.distancia_izquierda_cm <= 15) AS cerca_izquierda,
    count(*) FILTER (WHERE l.distancia_central_cm   IS NOT NULL AND l.distancia_central_cm   <= 15) AS cerca_central,
    count(*) FILTER (WHERE l.distancia_derecha_cm   IS NOT NULL AND l.distancia_derecha_cm   <= 15) AS cerca_derecha
  FROM lecturas l WHERE l.sesion_id = s.id
) agg ON true;
