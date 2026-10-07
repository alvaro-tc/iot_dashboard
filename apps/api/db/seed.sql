-- Datos de demostración. Se ejecuta con la zona horaria del equipo (la fija db/reset.ts),
-- así que "hoy a las 08:00" es 08:00 hora local, guardado en UTC.
--
-- Aquí solo van usuarios, robots y la cabecera de cada sesión. Las lecturas y los eventos
-- los genera db/reset.ts simulando el robot con @iot/shared, para que la trayectoria, las
-- distancias y los obstáculos sean físicamente coherentes entre sí.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- crypt() + gen_salt('bf') = hash bcrypt compatible

INSERT INTO users (email, password, name, role) VALUES
  ('admin@demo.com',  crypt('admin123',   gen_salt('bf', 10)), 'Administración', 'admin'),
  ('alvaro@demo.com', crypt('cliente123', gen_salt('bf', 10)), 'Álvaro Quispe',  'client'),
  ('maria@demo.com',  crypt('cliente123', gen_salt('bf', 10)), 'María Condori',  'client');

-- Tokens de demo (db/reset.ts los registra también en Mosquitto):
--   roomba-sala    -> SalaDemoToken0123456789abcdefgh
--   roomba-cocina  -> CocinaDemoToken0123456789abcdef
--   roomba-maria   -> MariaDemoToken0123456789abcdefg
INSERT INTO dispositivos (id, user_id, nombre, ubicacion, token_hash, version_firmware, creado_en) VALUES
  ('roomba-sala',   (SELECT id FROM users WHERE email = 'alvaro@demo.com'), 'Roomba Sala',   'Sala de estar',
     crypt('SalaDemoToken0123456789abcdefgh', gen_salt('bf', 10)), '1.2.0', current_date - 14),
  ('roomba-cocina', (SELECT id FROM users WHERE email = 'alvaro@demo.com'), 'Roomba Cocina', 'Cocina',
     crypt('CocinaDemoToken0123456789abcdef', gen_salt('bf', 10)), '1.2.0', current_date - 6),
  ('roomba-maria',  (SELECT id FROM users WHERE email = 'maria@demo.com'),  'Roomba Pasillo', 'Pasillo',
     crypt('MariaDemoToken0123456789abcdefg', gen_salt('bf', 10)), '1.1.3', current_date - 2);

-- La configuración la crea el trigger trg_configuracion_por_defecto; aquí solo se ajusta
-- lo que distingue a cada robot (área de la habitación y perfil de evasión).
UPDATE configuracion_dispositivo SET area_ancho_cm = 500, area_alto_cm = 400
  WHERE dispositivo_id = 'roomba-sala';
UPDATE configuracion_dispositivo SET area_ancho_cm = 320, area_alto_cm = 260,
       distancia_evasion_cm = 12, distancia_precaucion_cm = 25, velocidad_base_pct = 50
  WHERE dispositivo_id = 'roomba-cocina';
UPDATE configuracion_dispositivo SET area_ancho_cm = 600, area_alto_cm = 200,
       distancia_evasion_cm = 20, distancia_precaucion_cm = 40
  WHERE dispositivo_id = 'roomba-maria';

-- Sesiones de limpieza pasadas. reset.ts las rellena con lecturas simuladas:
-- la duración de cada una sale de iniciada_en/finalizada_en.
INSERT INTO sesiones (dispositivo_id, iniciada_en, finalizada_en)
SELECT v.dispositivo_id,
       (current_date + v.dia + v.t0)::timestamptz,
       (current_date + v.dia + v.t1)::timestamptz
FROM (VALUES
  ('roomba-sala',   0,  time '08:30', time '09:05'),
  ('roomba-sala',   0,  time '14:32', time '15:10'),
  ('roomba-sala',  -1,  time '09:15', time '09:58'),
  ('roomba-sala',  -2,  time '18:00', time '18:25'),
  ('roomba-cocina', 0,  time '11:00', time '11:18'),
  ('roomba-cocina',-1,  time '12:40', time '13:02'),
  ('roomba-maria', -1,  time '16:20', time '16:47')
) AS v(dispositivo_id, dia, t0, t1);
