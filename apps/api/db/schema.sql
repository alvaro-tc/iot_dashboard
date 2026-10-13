-- Esquema del dashboard del robot. `pnpm db:reset` lo aplica desde cero.
--
-- Todo en español: tablas, columnas y valores de los CHECK. Los nombres de los sensores
-- (izquierdo / central / derecho) y el rango de los motores (-255..255) son los mismos que
-- usa el firmware del ESP32 en `firmware/`, para que el JSON que publica el robot se pueda
-- guardar sin traducir nada por el camino.
DROP VIEW IF EXISTS v_resumen_sesion, v_lecturas_por_hora, v_lecturas_por_minuto CASCADE;
DROP TABLE IF EXISTS lecturas, sesiones, mapas, salas, configuracion_dispositivo, preferencias_usuario, dispositivos, usuarios CASCADE;
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
  -- Permiso del modo lidar (mapeo de habitaciones), que da y quita un admin. Por defecto NO:
  -- un cliente sin el permiso no recibe la ruta, ni el menú, ni los eventos, y la API le
  -- responde 404 en /api/lidar/*, así que no puede llegar a saber que la función existe.
  lidar_habilitado BOOLEAN NOT NULL DEFAULT false,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Preferencias de interfaz del usuario: tema y panel (qué widgets, dónde y con qué ajustes).
-- Para la base es un JSONB opaco: lo escribe y lo valida el navegador. Vive en la cuenta, no
-- en el navegador, para que la misma cuenta vea lo mismo en cualquier dispositivo.
CREATE TABLE preferencias_usuario (
  usuario_id     INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  datos          JSONB NOT NULL DEFAULT '{}',
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un robot. El id es además el usuario MQTT: la ACL de Mosquitto lo ata a roomba/{id}/#.
CREATE TABLE dispositivos (
  id                TEXT PRIMARY KEY,                -- ej. 'roomba-7f3a9c2b'
  usuario_id        INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre            TEXT NOT NULL,                   -- ej. 'Roomba Sala'
  ubicacion         TEXT NOT NULL DEFAULT '',
  token_hash        TEXT NOT NULL,                   -- hash bcrypt del token MQTT (valida /api/ingesta)
  token_cifrado     TEXT,                            -- el mismo token con AES-256-GCM, para poder volver a mostrarlo
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
  -- Medidas del chasis y posición de cada sensor (cm desde el centro del eje; x al frente,
  -- y a la derecha). Importan para el mapeo: el haz no nace en el centro del robot, y sin el
  -- desplazamiento el punto medido se coloca desviado. Se editan por robot en la web.
  geometria         JSONB NOT NULL DEFAULT '{"radioChasisCm":17,"separacionRuedasCm":24,"sensores":{"izquierdo":{"x":12,"y":-12,"anguloDeg":-45},"central":{"x":17,"y":0,"anguloDeg":0},"derecho":{"x":12,"y":12,"anguloDeg":45}}}',
  -- Lo que hay que MEDIR porque no hay encoders: grados/segundo girando y cm/s avanzando, con
  -- el PWM al que se midieron. `medidoEn` a null = sin calibrar (el mapeo avisa).
  calibracion       JSONB NOT NULL DEFAULT '{"pwmGiro":140,"gradosPorSegundo":90,"pwmAvance":180,"cmPorSegundo":18,"medidoEn":null}',
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Modo lidar: habitaciones y su mapa
-- ---------------------------------------------------------------------------

-- Una habitación de un robot. La forma es SIEMPRE un polígono de paredes rectas: un rectángulo
-- es un polígono de cuatro vértices, y así el encaje del barrido (ICP punto-a-arista) es el
-- mismo código para una sala cuadrada y para una en L. `forma` solo la usa la interfaz, para
-- saber si ofrecer el editor de ancho×alto o el de vértices.
CREATE TABLE salas (
  id                  BIGSERIAL PRIMARY KEY,
  dispositivo_id      TEXT NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
  nombre              TEXT NOT NULL,
  forma               TEXT NOT NULL DEFAULT 'rectangulo' CHECK (forma IN ('rectangulo','poligono')),
  -- [{x,y},…] en cm, en orden, polígono cerrado. La validación del mínimo de 3 vértices y del
  -- tamaño la hace zod en la API (un CHECK sobre JSONB no se lee).
  vertices            JSONB NOT NULL,
  -- Lo que estimó el usuario ANTES de mapear: es la semilla del encaje, y por eso se guarda
  -- aparte de lo medido (sirve para ver cuánto se equivocaba).
  ancho_estimado_cm   INTEGER NOT NULL CHECK (ancho_estimado_cm BETWEEN 50 AND 2000),
  alto_estimado_cm    INTEGER NOT NULL CHECK (alto_estimado_cm  BETWEEN 50 AND 2000),
  -- Caja del polígono ya mapeado. null hasta el primer barrido que encaje.
  ancho_real_cm       NUMERIC(6,1),
  alto_real_cm        NUMERIC(6,1),
  -- Huecos que NO son salida: el robot los trata como pared para no escaparse.
  puertas             JSONB NOT NULL DEFAULT '[]',
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_salas_dispositivo ON salas (dispositivo_id, creado_en);
-- Dos habitaciones del mismo robot no pueden llamarse igual: el selector de arriba las
-- distingue por nombre.
CREATE UNIQUE INDEX uniq_sala_nombre_por_dispositivo ON salas (dispositivo_id, lower(nombre));

-- El mapa en curso de una habitación, 1 a 1 con ella. En tabla aparte porque la rejilla pesa
-- (una sala de 5×4 m son 8000 celdas) y la lista de habitaciones no la necesita.
CREATE TABLE mapas (
  sala_id        BIGINT PRIMARY KEY REFERENCES salas(id) ON DELETE CASCADE,
  -- Rejilla de ocupación en log-odds, un byte por celda (Int8), en base64. Ver lidar.ts.
  rejilla        TEXT NOT NULL,
  cols           INTEGER NOT NULL CHECK (cols > 0),
  filas          INTEGER NOT NULL CHECK (filas > 0),
  resolucion_cm  SMALLINT NOT NULL DEFAULT 5 CHECK (resolucion_cm > 0),
  -- Formas ya extraídas de la rejilla, para no recalcularlas en cada carga del panel.
  obstaculos     JSONB NOT NULL DEFAULT '[]',
  barridos       INTEGER NOT NULL DEFAULT 0,
  -- Fracción de la sala con una opinión (libre u ocupada), de 0 a 1.
  cobertura      NUMERIC(4,3) NOT NULL DEFAULT 0,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Qué habitación está trabajando cada robot. Va aquí y no en `salas` para que sea imposible
-- tener dos a la vez, y con ON DELETE SET NULL: borrar la sala no deja al robot apuntando a
-- una fila que ya no existe.
ALTER TABLE configuracion_dispositivo
  ADD COLUMN sala_activa_id BIGINT REFERENCES salas(id) ON DELETE SET NULL;

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

