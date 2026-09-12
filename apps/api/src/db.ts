import pg from 'pg';
import { env } from './env.ts';

// BIGSERIAL/count(*) llegan como texto por defecto; los ids caben de sobra en un number.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

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
