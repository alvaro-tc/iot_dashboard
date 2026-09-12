import { SERIES_KEYS, seriesByKey } from '@iot/shared';
import bcrypt from 'bcrypt';
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../auth.ts';
import { pool } from '../db.ts';
import { HttpError, isUniqueViolation, parse, positiveId } from '../http.ts';
import { removeDevices, syncBroker } from '../mqtt/broker-credentials.ts';
import { listRuns, runFiltersSchema } from '../queries.ts';
import { closeRunsAndEmit } from '../runs.ts';
import { stopSimulation } from '../simulator.ts';
import { disconnectUser } from '../ws.ts';
import { EMAIL_TAKEN, USER_COLUMNS, emailSchema, nameSchema, passwordSchema } from './auth.ts';
import { DEVICE_COLUMNS, revokeDevice } from './devices.ts';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

const roleSchema = z.enum(['admin', 'client'], { message: 'Elige un rol: admin o cliente.' });

async function getUser(id: number) {
  const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'El usuario no existe.');
  return rows[0];
}

/** Debe quedar al menos un admin activo aparte del usuario `exceptId`. */
async function assertAnotherAdmin(exceptId: number) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND is_active AND id <> $1`,
    [exceptId],
  );
  if (rows[0].n === 0) throw new HttpError(409, 'Debe quedar al menos un administrador activo.');
}

async function syncBrokerSoft() {
  await syncBroker().catch((e) => console.error('[admin] no se pudo sincronizar el broker:', e.message));
}

// ---------- Panel general ----------

adminRouter.get('/stats', async (req, res) => {
  const since = z.coerce.date().catch(new Date(Date.now() - 86_400_000)).parse(req.query.since);
  const [counts, active] = await Promise.all([
    pool.query(
      `SELECT (SELECT count(*) FROM users WHERE role = 'client')::int AS clients,
              (SELECT count(*) FROM devices WHERE NOT is_revoked)::int AS devices,
              (SELECT count(*) FROM runs WHERE started_at >= $1)::int AS "runsToday",
              (SELECT count(*) FROM runs WHERE status = 'active')::int AS "sendingNow"`,
      [since],
    ),
    pool.query(
      `SELECT r.id AS "runId", r.user_id AS "userId", u.name AS "userName", r.series_key AS "seriesKey",
              r.started_at AS "startedAt", r.source, d.name AS "deviceName", r.sample_count AS "sampleCount"
       FROM runs r JOIN users u ON u.id = r.user_id LEFT JOIN devices d ON d.id = r.device_id
       WHERE r.status = 'active' ORDER BY r.started_at`,
    ),
  ]);
  res.json({ ...counts.rows[0], activeRuns: active.rows });
});

// ---------- Usuarios ----------

adminRouter.get('/users', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, u.role, u.is_active AS "isActive", u.created_at AS "createdAt",
            (SELECT count(*) FROM devices d WHERE d.user_id = u.id AND NOT d.is_revoked)::int AS "deviceCount",
            (SELECT count(*) FROM runs r WHERE r.user_id = u.id)::int AS "runCount",
            (SELECT coalesce(sum(r.sample_count), 0) FROM runs r WHERE r.user_id = u.id)::int AS "sampleCount",
            greatest((SELECT max(coalesce(r.ended_at, now())) FROM runs r WHERE r.user_id = u.id),
                     (SELECT max(d.last_seen_at) FROM devices d WHERE d.user_id = u.id)) AS "lastActivity",
            ar.id AS "activeRunId", ar.series_key AS "activeSeriesKey"
     FROM users u LEFT JOIN runs ar ON ar.user_id = u.id AND ar.status = 'active'
     ORDER BY u.role, u.name`,
  );
  res.json(rows);
});

adminRouter.post('/users', async (req, res) => {
  const body = parse(
    z.object({ name: nameSchema, email: emailSchema, password: passwordSchema, role: roleSchema }),
    req.body,
  );
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4) RETURNING ${USER_COLUMNS}`,
      [body.email, await bcrypt.hash(body.password, 10), body.name, body.role],
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (isUniqueViolation(e)) throw EMAIL_TAKEN;
    throw e;
  }
});

adminRouter.get('/users/:id', async (req, res) => {
  res.json(await getUser(positiveId(req.params.id)));
});

adminRouter.patch('/users/:id', async (req, res) => {
  const id = positiveId(req.params.id);
  const body = parse(
    z.object({ name: nameSchema.optional(), email: emailSchema.optional(), role: roleSchema.optional(), isActive: z.boolean().optional() }),
    req.body,
  );
  const target = await getUser(id);
  const losesAdmin = target.role === 'admin' && (body.role === 'client' || body.isActive === false);
  if (id === req.user.id && losesAdmin) {
    throw new HttpError(400, 'No puedes desactivarte ni quitarte el rol de administrador a ti mismo.');
  }
  if (losesAdmin) await assertAnotherAdmin(id);

  let updated;
  try {
    const { rows } = await pool.query(
      `UPDATE users SET name = coalesce($2, name), email = coalesce($3, email), role = coalesce($4, role),
                        is_active = coalesce($5, is_active)
       WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [id, body.name ?? null, body.email ?? null, body.role ?? null, body.isActive ?? null],
    );
    updated = rows[0];
  } catch (e) {
    if (isUniqueViolation(e)) throw EMAIL_TAKEN;
    throw e;
  }

  if (body.isActive === false && target.isActive) {
    await stopSimulation(id);
    await closeRunsAndEmit('r.user_id = $1', [id]);
    disconnectUser(id);
  }
  if (body.role && body.role !== target.role) disconnectUser(id); // que reconecte con el rol nuevo
  if (body.isActive !== undefined && body.isActive !== target.isActive) await syncBrokerSoft();
  res.json(updated);
});

adminRouter.post('/users/:id/password', async (req, res) => {
  const id = positiveId(req.params.id);
  await getUser(id);
  const password = nanoid(12);
  await pool.query('UPDATE users SET password = $2 WHERE id = $1', [id, await bcrypt.hash(password, 10)]);
  res.json({ password }); // se muestra una sola vez
});

adminRouter.delete('/users/:id', async (req, res) => {
  const id = positiveId(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'No puedes eliminar tu propia cuenta.');
  const target = await getUser(id);
  if (target.role === 'admin') await assertAnotherAdmin(id);

  await stopSimulation(id);
  const devices = await pool.query<{ id: string }>('SELECT id FROM devices WHERE user_id = $1', [id]);
  await pool.query('DELETE FROM users WHERE id = $1', [id]); // cascada: devices, runs, samples
  disconnectUser(id);
  if (devices.rowCount) {
    await removeDevices(devices.rows.map((d) => d.id)).catch((e) =>
      console.error('[admin] no se pudo quitar credenciales del broker:', e.message),
    );
  }
  res.status(204).end();
});

adminRouter.delete('/users/:id/data', async (req, res) => {
  const id = positiveId(req.params.id);
  await getUser(id);
  await stopSimulation(id);
  const { rowCount } = await pool.query('DELETE FROM runs WHERE user_id = $1', [id]); // cascada: samples
  res.json({ deletedRuns: rowCount });
});

adminRouter.get('/users/:id/devices', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${DEVICE_COLUMNS} FROM devices WHERE user_id = $1 ORDER BY is_revoked, created_at DESC`,
    [positiveId(req.params.id)],
  );
  res.json(rows);
});

adminRouter.delete('/devices/:id', async (req, res) => {
  await revokeDevice(req.params.id);
  res.status(204).end();
});

// ---------- Datos ----------

adminRouter.get('/runs', async (req, res) => {
  res.json(await listRuns(parse(runFiltersSchema, req.query), true));
});

adminRouter.get('/users/:id/runs', async (req, res) => {
  const filters = parse(runFiltersSchema.omit({ userId: true }), req.query);
  res.json(await listRuns({ ...filters, userId: positiveId(req.params.id) }, true));
});

const SAMPLE_COLUMNS = `s.id, s.run_id AS "runId", r.series_key AS "seriesKey", s.iteration, s.value,
  s.error_abs AS "errorAbs", s.created_at AS "createdAt"`;

adminRouter.get('/runs/:runId/samples', async (req, res) => {
  const runId = positiveId(req.params.runId);
  const { limit, offset } = parse(
    z.object({
      limit: z.coerce.number().int().min(1).max(5000).default(200),
      offset: z.coerce.number().int().min(0).default(0),
    }),
    req.query,
  );
  const [samples, total] = await Promise.all([
    pool.query(
      `SELECT ${SAMPLE_COLUMNS} FROM samples s JOIN runs r ON r.id = s.run_id
       WHERE s.run_id = $1 ORDER BY s.iteration DESC LIMIT $2 OFFSET $3`,
      [runId, limit, offset],
    ),
    pool.query('SELECT count(*)::int AS n FROM samples WHERE run_id = $1', [runId]),
  ]);
  res.json({ total: total.rows[0].n, samples: samples.rows });
});

adminRouter.get('/users/:id/series/:key', async (req, res) => {
  const id = positiveId(req.params.id);
  const key = parse(z.enum(SERIES_KEYS, { message: 'Serie desconocida.' }), req.params.key);
  const { rows } = await pool.query(
    `SELECT ${SAMPLE_COLUMNS} FROM samples s JOIN runs r ON r.id = s.run_id
     WHERE r.user_id = $1 AND r.series_key = $2
     ORDER BY r.started_at, s.iteration`,
    [id, key],
  );
  res.json({ series: seriesByKey[key], samples: rows });
});
