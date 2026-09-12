// Endpoints del cliente. Nunca devuelven value, error_abs, iteration ni contadores de muestras.
import { SERIES_KEYS } from '@iot/shared';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.ts';
import { pool } from '../db.ts';
import { HttpError, parse } from '../http.ts';
import { listRuns } from '../queries.ts';
import { getSimulation, startSimulation, stopSimulation } from '../simulator.ts';

export const clientRouter = Router();
clientRouter.use(['/client', '/simulate'], requireAuth);

clientRouter.get('/client/runs', async (req, res) => {
  res.json(await listRuns({ userId: req.user.id }, false));
});

clientRouter.get('/client/status', async (req, res) => {
  const [device, run] = await Promise.all([
    pool.query(
      `SELECT id, name, created_at AS "createdAt", last_seen_at AS "lastSeenAt"
       FROM devices WHERE user_id = $1 AND NOT is_revoked LIMIT 1`,
      [req.user.id],
    ),
    pool.query(
      `SELECT r.id AS "runId", r.series_key AS "seriesKey", r.started_at AS "startedAt", r.source, d.name AS "deviceName"
       FROM runs r LEFT JOIN devices d ON d.id = r.device_id
       WHERE r.user_id = $1 AND r.status = 'active'`,
      [req.user.id],
    ),
  ]);
  const activeRun = run.rows[0] ?? null;
  res.json({
    hasDevice: device.rowCount! > 0,
    device: device.rows[0] ?? null,
    deviceOnline: activeRun?.source === 'device',
    activeRun,
    simulation: getSimulation(req.user.id),
  });
});

const startSchema = z.object({
  seriesKey: z.enum(SERIES_KEYS, { message: 'Elige una de las 7 series.' }),
  intervalMs: z.coerce
    .number()
    .int()
    .min(50, 'El intervalo mínimo es 50 ms.')
    .max(10_000, 'El intervalo máximo es 10 000 ms.')
    .default(250),
});

clientRouter.post('/simulate/start', async (req, res) => {
  const body = parse(startSchema, req.body);
  const { rowCount } = await pool.query('SELECT 1 FROM devices WHERE user_id = $1 AND NOT is_revoked', [req.user.id]);
  if (rowCount) {
    throw new HttpError(409, 'El envío lo controla ahora tu ESP32. Revócalo en "Mi dispositivo" si quieres volver a usar el simulador.');
  }
  // Cambiar de serie con el simulador en marcha cierra la sesión anterior (la lógica de sesiones lo
  // haría igual al llegar la primera muestra de la nueva serie, pero así el cierre es inmediato).
  await stopSimulation(req.user.id);
  try {
    startSimulation(req.user.id, body.seriesKey, body.intervalMs);
  } catch {
    throw new HttpError(503, 'El broker MQTT no está disponible. Comprueba que Mosquitto está en marcha e inténtalo en unos segundos.');
  }
  res.json({ simulation: getSimulation(req.user.id) });
});

clientRouter.post('/simulate/stop', async (req, res) => {
  await stopSimulation(req.user.id);
  res.json({ simulation: null });
});
