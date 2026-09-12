import bcrypt from 'bcrypt';
import { Router } from 'express';
import { customAlphabet, nanoid } from 'nanoid';
import { z } from 'zod';
import { requireAuth } from '../auth.ts';
import { pool } from '../db.ts';
import { env } from '../env.ts';
import { HttpError, parse } from '../http.ts';
import { addDevice, removeDevices } from '../mqtt/broker-credentials.ts';
import { closeRunsAndEmit } from '../runs.ts';
import { stopSimulation } from '../simulator.ts';

const shortId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);
export const DEVICE_COLUMNS = `id, user_id AS "userId", name, is_revoked AS "isRevoked", created_at AS "createdAt", last_seen_at AS "lastSeenAt"`;

const BROKER_DOWN =
  'No se pudo actualizar el broker MQTT. Comprueba que el contenedor de Mosquitto está en marcha (docker compose up -d) e inténtalo de nuevo.';

/** Revocar: marca en BD, cierra su sesión activa y quita sus credenciales del broker. */
export async function revokeDevice(deviceId: string): Promise<void> {
  const { rowCount } = await pool.query('UPDATE devices SET is_revoked = true WHERE id = $1 AND NOT is_revoked', [deviceId]);
  if (!rowCount) throw new HttpError(404, 'El dispositivo no existe o ya estaba revocado.');
  await closeRunsAndEmit('r.device_id = $1', [deviceId]);
  try {
    await removeDevices([deviceId]);
  } catch (e) {
    // La plataforma ya descarta sus muestras (is_revoked); el broker se reconcilia al reiniciar la API.
    console.error('[devices] revocación sin recargar broker:', (e as Error).message);
    throw new HttpError(502, `Dispositivo revocado, pero ${BROKER_DOWN.charAt(0).toLowerCase()}${BROKER_DOWN.slice(1)}`);
  }
}

function brokerInfo() {
  const url = new URL(env.MQTT_URL);
  return { host: env.MQTT_PUBLIC_HOST || url.hostname, port: Number(url.port || 1883) };
}

export const devicesRouter = Router();
devicesRouter.use(requireAuth);

devicesRouter.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${DEVICE_COLUMNS} FROM devices WHERE user_id = $1 AND NOT is_revoked ORDER BY created_at DESC`,
    [req.user.id],
  );
  res.json(rows);
});

devicesRouter.post('/', async (req, res) => {
  const { name } = parse(
    z.object({
      name: z
        .string({ required_error: 'Ponle un nombre al dispositivo.' })
        .trim()
        .min(2, 'El nombre debe tener al menos 2 caracteres.')
        .max(60, 'El nombre no puede superar 60 caracteres.'),
    }),
    req.body,
  );
  const existing = await pool.query('SELECT 1 FROM devices WHERE user_id = $1 AND NOT is_revoked', [req.user.id]);
  if (existing.rowCount) throw new HttpError(409, 'Ya tienes un ESP32 vinculado. Revócalo antes de vincular otro.');

  const id = `esp32-${shortId()}`;
  const token = nanoid(32);
  await stopSimulation(req.user.id); // a partir de ahora el envío lo controla el ESP32
  const { rows } = await pool.query(
    `INSERT INTO devices (id, user_id, name, token_hash) VALUES ($1, $2, $3, $4) RETURNING ${DEVICE_COLUMNS}`,
    [id, req.user.id, name, await bcrypt.hash(token, 10)],
  );
  try {
    await addDevice(id, token);
  } catch (e) {
    console.error('[devices] no se pudo registrar en el broker:', (e as Error).message);
    await pool.query('DELETE FROM devices WHERE id = $1', [id]);
    throw new HttpError(502, BROKER_DOWN);
  }
  // El token solo sale en esta respuesta. En BD queda su hash bcrypt.
  res.status(201).json({ device: rows[0], token, userId: req.user.id, broker: brokerInfo() });
});

devicesRouter.delete('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT user_id FROM devices WHERE id = $1', [req.params.id]);
  if (!rows[0] || rows[0].user_id !== req.user.id) throw new HttpError(404, 'El dispositivo no existe.');
  await revokeDevice(req.params.id);
  res.status(204).end();
});
