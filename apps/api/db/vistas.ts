// pnpm db:vistas — recrea solo las vistas de agregación, sin tocar los datos.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.ts';

const sql = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vistas.sql');
await pool.query(await fs.readFile(sql, 'utf8'));
console.log('db: vistas de agregación recreadas');
await pool.end();
