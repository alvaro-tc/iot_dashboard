import pg from 'pg';
import { env } from './env.ts';

// BIGSERIAL/count(*) llegan como texto por defecto; los ids caben de sobra en un number.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);
// NUMERIC (distancias, voltios, avg/sum de las vistas) también llega como texto: el front
// hace `v.toFixed(1)` sobre estos campos. Precisión de float sobra para cm y voltios.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
pool.on('error', (e) => console.error('[db] error en conexión inactiva:', e.message));

export type Queryable = pg.Pool | pg.PoolClient;

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
