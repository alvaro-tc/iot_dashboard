// pnpm db:reset — recrea el esquema, carga el seed, genera las muestras del historial
// y registra en Mosquitto las credenciales de los dispositivos de demo.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeTerm, initialAcc, seriesByKey, type SeriesKey } from '@iot/shared';
import { pool } from '../src/db.ts';
import { addDevice, syncBroker } from '../src/mqtt/broker-credentials.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const STEP_MS = 2000; // una muestra cada 2 s en el historial precargado

const c = await pool.connect();
try {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await c.query(`SET TIME ZONE '${tz.replace(/'/g, '')}'`);
  await c.query(await fs.readFile(path.join(dir, 'schema.sql'), 'utf8'));
  await c.query(await fs.readFile(path.join(dir, 'seed.sql'), 'utf8'));

  const { rows: runs } = await c.query<{ id: number; series_key: SeriesKey; started_at: Date; ended_at: Date }>(
    'SELECT id, series_key, started_at, ended_at FROM runs ORDER BY id',
  );
  let total = 0;
  for (const run of runs) {
    const n = Math.floor((run.ended_at.getTime() - run.started_at.getTime()) / STEP_MS) + 1;
    const real = seriesByKey[run.series_key].realValue;
    const its: number[] = [], vals: number[] = [], errs: number[] = [], ts: string[] = [];
    let acc = initialAcc(run.series_key);
    for (let k = 1; k <= n; k++) {
      const r = computeTerm(run.series_key, k, acc);
      acc = r.acc;
      its.push(k);
      vals.push(Number(r.value.toFixed(10)));
      errs.push(Math.abs(vals[k - 1] - real));
      ts.push(new Date(run.started_at.getTime() + (k - 1) * STEP_MS).toISOString());
    }
    await c.query(
      `INSERT INTO samples (run_id, iteration, value, error_abs, created_at)
       SELECT $1, * FROM unnest($2::int[], $3::float8[], $4::float8[], $5::timestamptz[])`,
      [run.id, its, vals, errs, ts],
    );
    await c.query(
      `UPDATE runs SET sample_count = $2, last_iteration = $2, last_value = $3, last_error_abs = $4 WHERE id = $1`,
      [run.id, n, vals[n - 1], errs[n - 1]],
    );
    total += n;
  }
  console.log(`db: esquema y seed aplicados (${runs.length} sesiones, ${total} muestras, zona ${tz})`);
} finally {
  c.release();
}

try {
  await addDevice('esp32-alvaro01', 'AlvaroDemoToken0123456789abcdefg');
  await addDevice('esp32-jorge001', 'JorgeDemoToken0123456789abcdefgh');
  await syncBroker(); // usuario de servicio + limpia passwd/acl de dispositivos que ya no existen
  console.log('broker: credenciales de demo registradas');
} catch (e) {
  console.warn(`broker: no se pudo actualizar Mosquitto (${(e as Error).message}). ¿Está en marcha docker compose?`);
}
await pool.end();
