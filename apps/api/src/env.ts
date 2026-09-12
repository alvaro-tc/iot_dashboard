import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { z } from 'zod';

/** Raíz del monorepo: el .env y la carpeta mosquitto/ viven ahí. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
config({ path: path.join(ROOT, '.env'), quiet: true });

const schema = z.object({
  DATABASE_URL: z.string().default('postgres://iot:iot@localhost:5433/iot'),
  MQTT_URL: z.string().default('mqtt://localhost:1883'),
  MQTT_ADMIN_USER: z.string().default('iot-backend'),
  MQTT_ADMIN_PASS: z.string().min(1),
  MQTT_PUBLIC_HOST: z.string().optional(),
  MOSQUITTO_PASSWD_PATH: z.string().default('./mosquitto/passwd'),
  MOSQUITTO_ACL_PATH: z.string().default('./mosquitto/acl'),
  // Comando que envía SIGHUP a Mosquitto. En el VPS (sin Docker): `sudo systemctl reload mosquitto`.
  MOSQUITTO_RELOAD_CMD: z.string().default('docker kill -s HUP mosquitto'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres'),
  PORT: z.coerce.number().default(4000),
  RUN_IDLE_TIMEOUT_MS: z.coerce.number().default(120_000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Configuración inválida. Copia .env.example a .env y revisa:');
  for (const i of parsed.error.issues) console.error(`  ${i.path.join('.')}: ${i.message}`);
  process.exit(1);
}
export const env = parsed.data;

/** Resuelve rutas del .env relativas a la raíz del repo. */
export const fromRoot = (p: string) => path.resolve(ROOT, p);
