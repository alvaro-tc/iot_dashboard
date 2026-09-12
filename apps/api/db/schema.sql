-- Esquema completo. `pnpm db:reset` lo aplica desde cero.
DROP TABLE IF EXISTS samples, runs, devices, users CASCADE;

CREATE TABLE users (
  id          SERIAL PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,              -- hash bcrypt
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin','client')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un ESP32 vinculado a un cliente.
CREATE TABLE devices (
  id            TEXT PRIMARY KEY,              -- ej. 'esp32-7f3a9c2b'
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                 -- alias legible, ej. 'Sensor laboratorio'
  token_hash    TEXT NOT NULL,                 -- hash bcrypt del token MQTT
  is_revoked    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ
);
CREATE INDEX idx_devices_user ON devices (user_id);

-- Una sesión de envío: un tramo continuo en el que un cliente
-- estuvo mandando datos de UNA sola serie.
CREATE TABLE runs (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id       TEXT REFERENCES devices(id) ON DELETE SET NULL,  -- null si vino del simulador web
  series_key      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','finished')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  sample_count    INTEGER NOT NULL DEFAULT 0,
  last_iteration  INTEGER NOT NULL DEFAULT 0,
  last_value      DOUBLE PRECISION,
  last_error_abs  DOUBLE PRECISION,
  source          TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web','device'))
);

-- Regla de negocio impuesta por la base de datos:
-- un cliente solo puede tener UNA sesión activa a la vez.
CREATE UNIQUE INDEX uniq_active_run_per_user
  ON runs (user_id) WHERE status = 'active';
CREATE INDEX idx_runs_user ON runs (user_id, started_at DESC);

CREATE TABLE samples (
  id          BIGSERIAL PRIMARY KEY,
  run_id      BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  iteration   INTEGER NOT NULL,
  value       DOUBLE PRECISION NOT NULL,
  error_abs   DOUBLE PRECISION NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_samples_run ON samples (run_id, iteration);
