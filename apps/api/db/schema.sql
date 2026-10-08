-- Esquema completo del dashboard del robot aspirador. `pnpm db:reset` lo aplica desde cero.
DROP VIEW IF EXISTS v_resumen_sesion, v_lecturas_por_hora, v_lecturas_por_minuto CASCADE;
DROP FUNCTION IF EXISTS obtener_mapa_sesion(BIGINT, INTEGER) CASCADE;
DROP TABLE IF EXISTS eventos, lecturas, sesiones, configuracion_dispositivo, dispositivos, users CASCADE;
-- Tablas del esquema viejo (devices/runs/samples), por si la base viene de un despliegue anterior.
DROP TABLE IF EXISTS samples, runs, devices CASCADE;

CREATE TABLE users (
  id          SERIAL PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,              -- hash bcrypt
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin','client')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un robot. El id es además el usuario MQTT: la ACL de Mosquitto lo ata a roomba/{id}/#.
CREATE TABLE dispositivos (
  id                TEXT PRIMARY KEY,                -- ej. 'roomba-7f3a9c2b'
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nombre            TEXT NOT NULL,                   -- ej. 'Roomba Sala'
  ubicacion         TEXT NOT NULL DEFAULT '',
  token_hash        TEXT NOT NULL,                   -- hash bcrypt del token MQTT
  is_revoked        BOOLEAN NOT NULL DEFAULT false,
  en_linea          BOOLEAN NOT NULL DEFAULT false,
  ultimo_contacto   TIMESTAMPTZ,
  version_firmware  TEXT,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dispositivos_user ON dispositivos (user_id);

-- 1 a 1 con dispositivos: lo que el robot obedece. El backend la publica retenida en `config`.
CREATE TABLE configuracion_dispositivo (
  dispositivo_id           TEXT PRIMARY KEY REFERENCES dispositivos(id) ON DELETE CASCADE,
  modo                     TEXT NOT NULL DEFAULT 'detenido'
                             CHECK (modo IN ('automatico','pausado','detenido')),
  distancia_evasion_cm     INTEGER NOT NULL DEFAULT 15 CHECK (distancia_evasion_cm BETWEEN 5 AND 50),
  distancia_precaucion_cm  INTEGER NOT NULL DEFAULT 30 CHECK (distancia_precaucion_cm <= 100),
  velocidad_base_pct       INTEGER NOT NULL DEFAULT 60 CHECK (velocidad_base_pct BETWEEN 30 AND 100),
  intervalo_telemetria_ms  INTEGER NOT NULL DEFAULT 200 CHECK (intervalo_telemetria_ms BETWEEN 100 AND 2000),
  angulos_sensores         JSONB NOT NULL DEFAULT '{"izq":-45,"centro":0,"der":45}',
  area_ancho_cm            INTEGER NOT NULL DEFAULT 500,
  area_alto_cm             INTEGER NOT NULL DEFAULT 400,
  actualizado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Precaución siempre por fuera de evasión: si no, el robot nunca frenaría antes de esquivar.
  CONSTRAINT precaucion_mayor_que_evasion CHECK (distancia_precaucion_cm > distancia_evasion_cm)
);

-- Un ciclo de funcionamiento: desde que el robot pasa a 'automatico' hasta que se detiene.
CREATE TABLE sesiones (
  id                     BIGSERIAL PRIMARY KEY,
  dispositivo_id         TEXT NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
  iniciada_en            TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalizada_en          TIMESTAMPTZ,                 -- null = sigue activa
  total_lecturas         INTEGER NOT NULL DEFAULT 0,
  total_evasiones        INTEGER NOT NULL DEFAULT 0,
  distancia_recorrida_cm NUMERIC(9,1) NOT NULL DEFAULT 0,
  bateria_inicio_pct     SMALLINT,
  bateria_fin_pct        SMALLINT
);
-- Regla impuesta por la base: un robot no puede tener dos sesiones abiertas a la vez.
CREATE UNIQUE INDEX uniq_sesion_activa_por_dispositivo
  ON sesiones (dispositivo_id) WHERE finalizada_en IS NULL;
CREATE INDEX idx_sesiones_dispositivo ON sesiones (dispositivo_id, iniciada_en DESC);

CREATE TABLE lecturas (
  id                BIGSERIAL PRIMARY KEY,
  dispositivo_id    TEXT NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
  sesion_id         BIGINT REFERENCES sesiones(id) ON DELETE CASCADE,
  secuencia         INTEGER NOT NULL,                 -- contador del ESP32: detecta pérdidas y duplicados
  dist_izq_cm       NUMERIC(5,1),                     -- null = sin objeto dentro del rango del sensor
  dist_centro_cm    NUMERIC(5,1),
  dist_der_cm       NUMERIC(5,1),
  estado_movimiento TEXT NOT NULL
                      CHECK (estado_movimiento IN ('avanzando','girando_izq','girando_der','retrocediendo','detenido')),
  pos_x_cm          NUMERIC(7,1) NOT NULL,
  pos_y_cm          NUMERIC(7,1) NOT NULL,
  orientacion_deg   NUMERIC(5,1) NOT NULL,
  vel_izq_pct       SMALLINT NOT NULL CHECK (vel_izq_pct BETWEEN -100 AND 100),
  vel_der_pct       SMALLINT NOT NULL CHECK (vel_der_pct BETWEEN -100 AND 100),
  bateria_v         NUMERIC(4,2),
  bateria_pct       SMALLINT,
  rssi_dbm          SMALLINT,
  medido_en         TIMESTAMPTZ NOT NULL,             -- hora NTP del ESP32
  recibido_en       TIMESTAMPTZ NOT NULL,             -- cuando llegó al backend
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lecturas_dispositivo ON lecturas (dispositivo_id, creado_en DESC);
-- Único por sesión: un reenvío del lote diferido no duplica la lectura.
CREATE UNIQUE INDEX uniq_lectura_secuencia ON lecturas (sesion_id, secuencia);

CREATE TABLE eventos (
  id              BIGSERIAL PRIMARY KEY,
  dispositivo_id  TEXT NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
  sesion_id       BIGINT REFERENCES sesiones(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL
                    CHECK (tipo IN ('obstaculo','atascado','bateria_baja','conexion','desconexion','cambio_modo')),
  sensor          TEXT CHECK (sensor IN ('izq','centro','der')),
  distancia_cm    NUMERIC(5,1),
  pos_x_cm        NUMERIC(7,1),
  pos_y_cm        NUMERIC(7,1),
  mensaje         TEXT NOT NULL DEFAULT '',
  atendido        BOOLEAN NOT NULL DEFAULT false,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_eventos_dispositivo ON eventos (dispositivo_id, creado_en DESC);
CREATE INDEX idx_eventos_sesion ON eventos (sesion_id, creado_en);

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

-- Agregado por minuto: alimenta las gráficas históricas y la latencia media.
CREATE VIEW v_lecturas_por_minuto AS
SELECT
  l.dispositivo_id,
  l.sesion_id,
  date_trunc('minute', l.creado_en)                              AS minuto,
  count(*)                                                       AS lecturas,
  min(l.dist_izq_cm)                                             AS min_izq_cm,
  min(l.dist_centro_cm)                                          AS min_centro_cm,
  min(l.dist_der_cm)                                             AS min_der_cm,
  avg(l.dist_izq_cm)                                             AS prom_izq_cm,
  avg(l.dist_centro_cm)                                          AS prom_centro_cm,
  avg(l.dist_der_cm)                                             AS prom_der_cm,
  count(*) FILTER (WHERE l.estado_movimiento = 'avanzando')      AS n_avanzando,
  count(*) FILTER (WHERE l.estado_movimiento = 'girando_izq')    AS n_girando_izq,
  count(*) FILTER (WHERE l.estado_movimiento = 'girando_der')    AS n_girando_der,
  count(*) FILTER (WHERE l.estado_movimiento = 'retrocediendo')  AS n_retrocediendo,
  count(*) FILTER (WHERE l.estado_movimiento = 'detenido')       AS n_detenido,
  avg(l.bateria_pct)                                             AS prom_bateria_pct,
  -- Latencia extremo a extremo medida en el servidor: hora NTP del robot vs. llegada.
  avg(EXTRACT(EPOCH FROM (l.recibido_en - l.medido_en)) * 1000)  AS latencia_ms
FROM lecturas l
GROUP BY 1, 2, 3;

CREATE VIEW v_lecturas_por_hora AS
SELECT
  l.dispositivo_id,
  date_trunc('hour', l.creado_en)                                AS hora,
  count(*)                                                       AS lecturas,
  min(l.dist_izq_cm)                                             AS min_izq_cm,
  min(l.dist_centro_cm)                                          AS min_centro_cm,
  min(l.dist_der_cm)                                             AS min_der_cm,
  avg(l.dist_izq_cm)                                             AS prom_izq_cm,
  avg(l.dist_centro_cm)                                          AS prom_centro_cm,
  avg(l.dist_der_cm)                                             AS prom_der_cm,
  count(*) FILTER (WHERE l.estado_movimiento = 'avanzando')      AS n_avanzando,
  count(*) FILTER (WHERE l.estado_movimiento = 'girando_izq')    AS n_girando_izq,
  count(*) FILTER (WHERE l.estado_movimiento = 'girando_der')    AS n_girando_der,
  count(*) FILTER (WHERE l.estado_movimiento = 'retrocediendo')  AS n_retrocediendo,
  count(*) FILTER (WHERE l.estado_movimiento = 'detenido')       AS n_detenido,
  avg(l.bateria_pct)                                             AS prom_bateria_pct,
  avg(EXTRACT(EPOCH FROM (l.recibido_en - l.medido_en)) * 1000)  AS latencia_ms,
  count(*) FILTER (WHERE l.dist_izq_cm    IS NOT NULL AND l.dist_izq_cm    <= 15) AS cerca_izq,
  count(*) FILTER (WHERE l.dist_centro_cm IS NOT NULL AND l.dist_centro_cm <= 15) AS cerca_centro,
  count(*) FILTER (WHERE l.dist_der_cm    IS NOT NULL AND l.dist_der_cm    <= 15) AS cerca_der
FROM lecturas l
GROUP BY 1, 2;

-- Resumen de sesión. El porcentaje perdido sale de los huecos en `secuencia`:
-- si llegaron 180 lecturas pero la última secuencia es 200, se perdió el 10 %.
CREATE VIEW v_resumen_sesion AS
SELECT
  s.id                                                                  AS sesion_id,
  s.dispositivo_id,
  s.iniciada_en,
  s.finalizada_en,
  EXTRACT(EPOCH FROM (coalesce(s.finalizada_en, now()) - s.iniciada_en)) AS duracion_s,
  s.distancia_recorrida_cm,
  s.total_evasiones,
  s.total_lecturas,
  s.bateria_inicio_pct,
  s.bateria_fin_pct,
  s.bateria_inicio_pct - s.bateria_fin_pct                              AS bateria_consumida_pct,
  agg.max_secuencia,
  CASE
    WHEN coalesce(agg.max_secuencia, 0) > 0
      THEN greatest(0, round((1 - agg.recibidas::NUMERIC / agg.max_secuencia) * 100, 1))
    ELSE 0
  END                                                                   AS pct_perdidas,
  agg.latencia_ms,
  agg.n_avanzando, agg.n_girando_izq, agg.n_girando_der, agg.n_retrocediendo, agg.n_detenido,
  agg.evasiones_izq, agg.evasiones_centro, agg.evasiones_der
FROM sesiones s
LEFT JOIN LATERAL (
  SELECT
    count(*)                                                      AS recibidas,
    max(l.secuencia)                                              AS max_secuencia,
    avg(EXTRACT(EPOCH FROM (l.recibido_en - l.medido_en)) * 1000) AS latencia_ms,
    count(*) FILTER (WHERE l.estado_movimiento = 'avanzando')     AS n_avanzando,
    count(*) FILTER (WHERE l.estado_movimiento = 'girando_izq')   AS n_girando_izq,
    count(*) FILTER (WHERE l.estado_movimiento = 'girando_der')   AS n_girando_der,
    count(*) FILTER (WHERE l.estado_movimiento = 'retrocediendo') AS n_retrocediendo,
    count(*) FILTER (WHERE l.estado_movimiento = 'detenido')      AS n_detenido,
    (SELECT count(*) FROM eventos e WHERE e.sesion_id = s.id AND e.tipo = 'obstaculo' AND e.sensor = 'izq')    AS evasiones_izq,
    (SELECT count(*) FROM eventos e WHERE e.sesion_id = s.id AND e.tipo = 'obstaculo' AND e.sensor = 'centro') AS evasiones_centro,
    (SELECT count(*) FROM eventos e WHERE e.sesion_id = s.id AND e.tipo = 'obstaculo' AND e.sensor = 'der')    AS evasiones_der
  FROM lecturas l WHERE l.sesion_id = s.id
) agg ON true;

-- ---------------------------------------------------------------------------
-- Mapa de una sesión: trayectoria + obstáculos proyectados
-- ---------------------------------------------------------------------------
--
-- Cada punto de obstáculo se proyecta desde la pose con el ángulo del sensor:
--   x_obs = x + (radio + d)·cos(θ + ángulo),  y_obs = y + (radio + d)·sin(θ + ángulo)
-- Es la misma fórmula que `puntoObstaculo` en @iot/shared, para que el mapa en vivo
-- y la repetición histórica dibujen lo mismo.
--
-- El muestreo uniforme (row_number % paso) acota el resultado a ~p_max_puntos sin
-- recortar el final del recorrido, que es lo que haría un LIMIT.
CREATE FUNCTION obtener_mapa_sesion(p_sesion_id BIGINT, p_max_puntos INTEGER DEFAULT 3000)
RETURNS TABLE (
  secuencia         INTEGER,
  medido_en         TIMESTAMPTZ,
  x                 NUMERIC,
  y                 NUMERIC,
  theta             NUMERIC,
  estado_movimiento TEXT,
  bateria_pct       SMALLINT,
  obstaculos        JSONB
) AS $fn$
DECLARE
  v_radio CONSTANT NUMERIC := 17;   -- radio del chasis, igual que RADIO_ROBOT_CM
  v_ang   JSONB;
  v_paso  INTEGER;
BEGIN
  SELECT c.angulos_sensores INTO v_ang
  FROM sesiones s JOIN configuracion_dispositivo c ON c.dispositivo_id = s.dispositivo_id
  WHERE s.id = p_sesion_id;
  IF v_ang IS NULL THEN
    v_ang := '{"izq":-45,"centro":0,"der":45}'::JSONB;
  END IF;

  SELECT greatest(1, ceil(count(*)::NUMERIC / greatest(p_max_puntos, 1)))
  INTO v_paso FROM lecturas l WHERE l.sesion_id = p_sesion_id;

  RETURN QUERY
  WITH numeradas AS (
    SELECT l.*, row_number() OVER (ORDER BY l.secuencia) AS rn
    FROM lecturas l WHERE l.sesion_id = p_sesion_id
  ), muestreadas AS (
    SELECT * FROM numeradas WHERE (rn - 1) % v_paso = 0
  )
  SELECT
    m.secuencia,
    m.medido_en,
    m.pos_x_cm,
    m.pos_y_cm,
    m.orientacion_deg,
    m.estado_movimiento,
    m.bateria_pct,
    (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'sensor', p.sensor,
        'd', p.dist,
        'x', round(m.pos_x_cm + (v_radio + p.dist) * cosd(m.orientacion_deg + p.ang), 1),
        'y', round(m.pos_y_cm + (v_radio + p.dist) * sind(m.orientacion_deg + p.ang), 1)
      )), '[]'::JSONB)
      FROM (
        VALUES
          ('izq',    m.dist_izq_cm,    (v_ang->>'izq')::NUMERIC),
          ('centro', m.dist_centro_cm, (v_ang->>'centro')::NUMERIC),
          ('der',    m.dist_der_cm,    (v_ang->>'der')::NUMERIC)
      ) AS p(sensor, dist, ang)
      WHERE p.dist IS NOT NULL
    ) AS obstaculos
  FROM muestreadas m
  ORDER BY m.secuencia;
END;
$fn$ LANGUAGE plpgsql STABLE;
