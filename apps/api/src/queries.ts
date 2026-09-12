import { SERIES_KEYS } from '@iot/shared';
import { z } from 'zod';
import { pool } from './db.ts';

export const runFiltersSchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
  seriesKey: z.enum(SERIES_KEYS, { message: 'Serie desconocida.' }).optional(),
  status: z.enum(['active', 'finished']).optional(),
  from: z.coerce.date({ message: 'Fecha inicial inválida.' }).optional(),
  to: z.coerce.date({ message: 'Fecha final inválida.' }).optional(),
});
export type RunFilters = z.infer<typeof runFiltersSchema>;

const BASE_COLUMNS = `r.id, r.user_id AS "userId", u.name AS "userName", r.series_key AS "seriesKey", r.status,
  r.started_at AS "startedAt", r.ended_at AS "endedAt", r.source, r.device_id AS "deviceId", d.name AS "deviceName"`;
const NUMERIC_COLUMNS = `, r.sample_count AS "sampleCount", r.last_iteration AS "lastIteration",
  r.last_value AS "lastValue", r.last_error_abs AS "lastErrorAbs"`;

/**
 * Listado de sesiones. `numeric: false` es la versión para clientes: las columnas numéricas ni
 * siquiera se seleccionan, así que no pueden filtrarse por error en la respuesta.
 */
export async function listRuns(f: RunFilters, numeric: boolean) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.userId) add('r.user_id = ?', f.userId);
  if (f.seriesKey) add('r.series_key = ?', f.seriesKey);
  if (f.status) add('r.status = ?', f.status);
  if (f.from) add('coalesce(r.ended_at, now()) >= ?', f.from); // solapa con el rango
  if (f.to) add('r.started_at < ?', f.to);

  const { rows } = await pool.query(
    `SELECT ${BASE_COLUMNS}${numeric ? NUMERIC_COLUMNS : ''}
     FROM runs r JOIN users u ON u.id = r.user_id LEFT JOIN devices d ON d.id = r.device_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY (r.status = 'active') DESC, r.started_at DESC
     LIMIT 2000`,
    params,
  );
  return rows;
}
