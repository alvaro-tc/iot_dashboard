// Lógica de sesiones (runs).
//
// El dispositivo no sabe qué es una sesión: solo publica muestras numeradas. Aquí se infieren
// los tramos continuos de envío de un cliente a partir de la secuencia de muestras:
//
//   sin sesión activa                          -> abrir una nueva
//   activa, misma serie, iteration > última    -> seguir en la misma
//   activa, otra serie (o otro origen)          -> cerrar la actual y abrir una nueva
//   activa, misma serie, iteration <= última   -> el cliente reinició: cerrar y abrir
//
// Todo va en una transacción que empieza bloqueando la fila del usuario (SELECT ... FOR UPDATE):
// dos muestras casi simultáneas del mismo cliente se procesan una detrás de otra y no pueden
// abrir dos sesiones. Si aun así el índice único parcial uniq_active_run_per_user salta (p. ej.
// otra instancia de la API), se reintenta una vez: en el reintento ya se ve la sesión ganadora.
//
// Al cerrar, ended_at es el created_at de la última muestra, no now(): la duración registrada
// es la del envío real, no la del momento en que el backend se dio cuenta.
//
// Los eventos WebSocket se emiten DESPUÉS del COMMIT, para no anunciar nada que luego se deshaga.
import { seriesByKey, type SeriesKey } from '@iot/shared';
import { pool, tx, type Queryable } from './db.ts';
import { env } from './env.ts';
import { isUniqueViolation } from './http.ts';
import { broadcast, type LiveEvent } from './ws.ts';

export interface SampleInput {
  userId: number;
  seriesKey: SeriesKey;
  iteration: number;
  value: number;
  deviceId: string | null;
}

/** Muestra rechazada por una regla de negocio. El puente la loguea y la descarta. */
export class DiscardSample extends Error {}

export async function ingestSample(input: SampleInput): Promise<void> {
  let events: LiveEvent[];
  try {
    events = await tx((c) => ingestInTx(c, input));
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    events = await tx((c) => ingestInTx(c, input));
  }
  broadcast(events);
}

async function ingestInTx(
  c: Queryable,
  { userId, seriesKey, iteration, value, deviceId }: SampleInput,
): Promise<LiveEvent[]> {
  const events: LiveEvent[] = [];

  const user = await c.query<{ is_active: boolean }>('SELECT is_active FROM users WHERE id = $1 FOR UPDATE', [userId]);
  if (!user.rows[0]) throw new DiscardSample(`usuario ${userId} no existe`);
  if (!user.rows[0].is_active) throw new DiscardSample(`usuario ${userId} desactivado`);

  // Defensa en profundidad: la ACL del broker ya impide publicar en el topic de otro usuario.
  let deviceName: string | null = null;
  if (deviceId) {
    const d = await c.query<{ user_id: number; name: string; is_revoked: boolean }>(
      'SELECT user_id, name, is_revoked FROM devices WHERE id = $1',
      [deviceId],
    );
    const dev = d.rows[0];
    if (!dev) throw new DiscardSample(`dispositivo ${deviceId} desconocido`);
    if (dev.is_revoked) throw new DiscardSample(`dispositivo ${deviceId} revocado`);
    if (dev.user_id !== userId) throw new DiscardSample(`dispositivo ${deviceId} publica en el topic de otro usuario`);
    deviceName = dev.name;
    await c.query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [deviceId]);
  } else {
    const d = await c.query('SELECT 1 FROM devices WHERE user_id = $1 AND NOT is_revoked LIMIT 1', [userId]);
    if (d.rowCount) throw new DiscardSample(`usuario ${userId} tiene ESP32 vinculado; muestra sin deviceId descartada`);
  }

  // 1. Sesión activa del usuario.
  const { rows } = await c.query<{ id: number; series_key: string; last_iteration: number; device_id: string | null }>(
    `SELECT id, series_key, last_iteration, device_id FROM runs WHERE user_id = $1 AND status = 'active'`,
    [userId],
  );
  const active = rows[0];
  // 3. Misma serie, mismo origen y la iteración avanza: se continúa.
  const continues =
    active && active.series_key === seriesKey && active.device_id === deviceId && iteration > active.last_iteration;

  let runId: number;
  if (continues) {
    runId = active.id;
  } else {
    // 4/5. Otra serie o reinicio: se cierra la actual.
    if (active) events.push(...(await closeRuns(c, 'r.id = $1', [active.id])));
    // 2. Se abre una nueva.
    const source = deviceId ? 'device' : 'web';
    const created = await c.query<{ id: number; started_at: Date }>(
      `INSERT INTO runs (user_id, device_id, series_key, source) VALUES ($1, $2, $3, $4) RETURNING id, started_at`,
      [userId, deviceId, seriesKey, source],
    );
    runId = created.rows[0].id;
    events.push({
      type: 'run_start',
      userId,
      payload: { runId, seriesKey, startedAt: created.rows[0].started_at, source, deviceName },
    });
  }

  const errorAbs = Math.abs(value - seriesByKey[seriesKey].realValue);
  const sample = await c.query<{ id: number; created_at: Date }>(
    `INSERT INTO samples (run_id, iteration, value, error_abs) VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
    [runId, iteration, value, errorAbs],
  );
  await c.query(
    `UPDATE runs SET sample_count = sample_count + 1, last_iteration = $2, last_value = $3, last_error_abs = $4
     WHERE id = $1`,
    [runId, iteration, value, errorAbs],
  );
  events.push({
    type: 'sample',
    userId,
    payload: { id: sample.rows[0].id, runId, seriesKey, iteration, value, errorAbs, createdAt: sample.rows[0].created_at },
  });
  return events;
}

/**
 * Cierra sesiones activas que cumplan `cond` (SQL sobre `r` = runs y `last.last_at` = hora de su
 * última muestra) y devuelve los eventos run_end. `cond` es siempre SQL fijo de este archivo o de
 * las rutas, nunca entrada de usuario: los valores van en `params`.
 */
export async function closeRuns(q: Queryable, cond: string, params: unknown[]): Promise<LiveEvent[]> {
  const { rows } = await q.query<{
    id: number;
    user_id: number;
    series_key: string;
    ended_at: Date;
    sample_count: number;
    last_value: number | null;
    last_error_abs: number | null;
  }>(
    `WITH last AS (
       SELECT r.id,
              coalesce((SELECT s.created_at FROM samples s WHERE s.run_id = r.id ORDER BY s.iteration DESC LIMIT 1),
                       r.started_at) AS last_at
       FROM runs r WHERE r.status = 'active'
     )
     UPDATE runs r SET status = 'finished', ended_at = last.last_at
     FROM last
     WHERE r.id = last.id AND (${cond})
     RETURNING r.id, r.user_id, r.series_key, r.ended_at, r.sample_count, r.last_value, r.last_error_abs`,
    params,
  );
  return rows.map((r) => ({
    type: 'run_end' as const,
    userId: r.user_id,
    payload: {
      runId: r.id,
      seriesKey: r.series_key,
      endedAt: r.ended_at,
      sampleCount: r.sample_count,
      lastValue: r.last_value,
      lastErrorAbs: r.last_error_abs,
    },
  }));
}

export async function closeRunsAndEmit(cond: string, params: unknown[]): Promise<void> {
  broadcast(await closeRuns(pool, cond, params));
}

/** Barredor de inactividad: cada 30 s cierra las sesiones sin muestras desde hace RUN_IDLE_TIMEOUT_MS. */
export function startIdleSweeper(): void {
  setInterval(() => {
    closeRunsAndEmit(`last.last_at < now() - ($1::double precision * interval '1 millisecond')`, [
      env.RUN_IDLE_TIMEOUT_MS,
    ]).catch((e) => console.error('[sweeper]', e.message));
  }, 30_000).unref();
}
