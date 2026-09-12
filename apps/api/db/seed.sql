-- Datos de demostración. Se ejecuta con la zona horaria del equipo (la fija db/reset.ts),
-- así que "hoy a las 08:00" es 08:00 hora local, guardado en UTC.
-- Las muestras de cada sesión las genera db/reset.ts con computeTerm de @iot/shared,
-- para no duplicar aquí las fórmulas de las series.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- crypt() + gen_salt('bf') = hash bcrypt compatible

INSERT INTO users (email, password, name, role) VALUES
  ('admin@demo.com',  crypt('admin123',   gen_salt('bf', 10)), 'Administración', 'admin'),
  ('alvaro@demo.com', crypt('cliente123', gen_salt('bf', 10)), 'Álvaro Quispe',  'client'),
  ('maria@demo.com',  crypt('cliente123', gen_salt('bf', 10)), 'María Condori',  'client'),
  ('jorge@demo.com',  crypt('cliente123', gen_salt('bf', 10)), 'Jorge Mamani',   'client');

-- Tokens de demo (db/reset.ts los registra también en Mosquitto):
--   esp32-alvaro01 -> AlvaroDemoToken0123456789abcdefg
--   esp32-jorge001 -> JorgeDemoToken0123456789abcdefgh
INSERT INTO devices (id, user_id, name, token_hash, created_at) VALUES
  ('esp32-alvaro01', (SELECT id FROM users WHERE email = 'alvaro@demo.com'), 'Sensor laboratorio',
     crypt('AlvaroDemoToken0123456789abcdefg', gen_salt('bf', 10)), current_date - 3),
  ('esp32-jorge001', (SELECT id FROM users WHERE email = 'jorge@demo.com'), 'Placa de pruebas',
     crypt('JorgeDemoToken0123456789abcdefgh', gen_salt('bf', 10)), current_date - 1);

-- Historial de Álvaro. Hoy: 08:00–09:40 Leibniz, a las 09:40 cambia a Wallis hasta 10:00,
-- y por la tarde Basilea de 14:00 a 14:30. Ayer, dos sesiones desde el simulador web.
INSERT INTO runs (user_id, device_id, series_key, status, started_at, ended_at, source)
SELECT u.id, v.device_id, v.series_key, 'finished',
       (current_date + v.day_offset + v.t0)::timestamptz,
       (current_date + v.day_offset + v.t1)::timestamptz,
       v.source
FROM users u
JOIN (VALUES
  ('alvaro@demo.com', 'esp32-alvaro01', 'pi_leibniz',      0, time '08:00', time '09:40', 'device'),
  ('alvaro@demo.com', 'esp32-alvaro01', 'wallis_pi',       0, time '09:40', time '10:00', 'device'),
  ('alvaro@demo.com', 'esp32-alvaro01', 'basel',           0, time '14:00', time '14:30', 'device'),
  ('alvaro@demo.com', NULL,             'ln2_alternating', -1, time '16:00', time '16:20', 'web'),
  ('alvaro@demo.com', NULL,             'catalan',         -1, time '17:00', time '17:05', 'web'),
  ('maria@demo.com',  NULL,             'pi_leibniz',      -1, time '11:00', time '11:15', 'web')
) AS v(email, device_id, series_key, day_offset, t0, t1, source) ON v.email = u.email;
