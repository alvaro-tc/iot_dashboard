-- Datos de demostración. Se ejecuta con la zona horaria del equipo (la fija db/reset.ts),
-- así que "hoy a las 08:00" es 08:00 hora local, guardado en UTC.
--
-- Aquí solo van usuarios, robots y la cabecera de cada sesión. Las lecturas las genera
-- db/reset.ts simulando el robot con @iot/shared, para que las distancias y los motores
-- sean físicamente coherentes entre sí.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- crypt() + gen_salt('bf') = hash bcrypt compatible

INSERT INTO usuarios (correo, contrasena, nombre, rol) VALUES
  ('admin@demo.com',  crypt('admin123',   gen_salt('bf', 10)), 'Administración', 'admin'),
  ('alvaro@demo.com', crypt('cliente123', gen_salt('bf', 10)), 'Álvaro Quispe',  'cliente'),
  ('maria@demo.com',  crypt('cliente123', gen_salt('bf', 10)), 'María Condori',  'cliente');

-- Tokens de demo (db/reset.ts los registra también en Mosquitto):
--   roomba-sala    -> SalaDemoToken0123456789abcdefgh
--   roomba-cocina  -> CocinaDemoToken0123456789abcdef
--   roomba-maria   -> MariaDemoToken0123456789abcdefg
INSERT INTO dispositivos (id, usuario_id, nombre, ubicacion, token_hash, version_firmware, creado_en) VALUES
  ('roomba-sala',   (SELECT id FROM usuarios WHERE correo = 'alvaro@demo.com'), 'Roomba Sala',   'Sala de estar',
     crypt('SalaDemoToken0123456789abcdefgh', gen_salt('bf', 10)), '1.2.0', current_date - 14),
  ('roomba-cocina', (SELECT id FROM usuarios WHERE correo = 'alvaro@demo.com'), 'Roomba Cocina', 'Cocina',
     crypt('CocinaDemoToken0123456789abcdef', gen_salt('bf', 10)), '1.2.0', current_date - 6),
  ('roomba-maria',  (SELECT id FROM usuarios WHERE correo = 'maria@demo.com'),  'Roomba Pasillo', 'Pasillo',
     crypt('MariaDemoToken0123456789abcdefg', gen_salt('bf', 10)), '1.1.3', current_date - 2);

-- La configuración la crea el trigger trg_configuracion_por_defecto; aquí solo se ajusta
-- la velocidad de crucero que distingue a cada robot.
UPDATE configuracion_dispositivo SET velocidad_base = 180 WHERE dispositivo_id = 'roomba-sala';
UPDATE configuracion_dispositivo SET velocidad_base = 130 WHERE dispositivo_id = 'roomba-cocina';
UPDATE configuracion_dispositivo SET velocidad_base = 210 WHERE dispositivo_id = 'roomba-maria';

-- Sesiones pasadas. reset.ts las rellena con lecturas simuladas:
-- la duración de cada una sale de iniciada_en/finalizada_en.
--
-- Los robots de alvaro@demo.com tienen dos semanas de historial (una o dos limpiezas por día,
-- de 12 a 40 min) para que el widget de actividad del motor tenga algo que enseñar en
-- "Hoy" y en "Total", y que los dos números sean distintos. roomba-cocina se dio de alta
-- hace 6 días, así que su historial empieza ahí.
INSERT INTO sesiones (dispositivo_id, iniciada_en, finalizada_en)
SELECT v.dispositivo_id,
       (current_date + v.dia + v.t0)::timestamptz,
       (current_date + v.dia + v.t1)::timestamptz
FROM (VALUES
  ('roomba-sala',   0,  time '08:30', time '09:05'),
  ('roomba-sala',   0,  time '14:32', time '15:10'),
  ('roomba-sala',  -1,  time '09:15', time '09:58'),
  ('roomba-sala',  -1,  time '19:05', time '19:22'),
  ('roomba-sala',  -2,  time '18:00', time '18:25'),
  ('roomba-sala',  -3,  time '08:45', time '09:12'),
  ('roomba-sala',  -4,  time '10:10', time '10:38'),
  ('roomba-sala',  -4,  time '17:40', time '17:55'),
  ('roomba-sala',  -5,  time '09:00', time '09:30'),
  ('roomba-sala',  -6,  time '11:20', time '11:52'),
  ('roomba-sala',  -7,  time '08:35', time '09:00'),
  ('roomba-sala',  -8,  time '16:15', time '16:40'),
  ('roomba-sala',  -9,  time '09:40', time '10:05'),
  ('roomba-sala', -10,  time '12:05', time '12:33'),
  ('roomba-sala', -11,  time '08:50', time '09:18'),
  ('roomba-sala', -12,  time '18:20', time '18:44'),
  ('roomba-sala', -13,  time '10:30', time '10:52'),
  ('roomba-cocina', 0,  time '11:00', time '11:18'),
  ('roomba-cocina', 0,  time '06:45', time '06:59'),
  ('roomba-cocina',-1,  time '12:40', time '13:02'),
  ('roomba-cocina',-2,  time '13:15', time '13:30'),
  ('roomba-cocina',-3,  time '12:50', time '13:08'),
  ('roomba-cocina',-4,  time '11:35', time '11:47'),
  ('roomba-cocina',-5,  time '13:00', time '13:20'),
  ('roomba-maria', -1,  time '16:20', time '16:47')
) AS v(dispositivo_id, dia, t0, t1);
