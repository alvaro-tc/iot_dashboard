import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { pool } from './db.ts';
import { env } from './env.ts';
import { errorHandler } from './http.ts';
import { syncBroker } from './mqtt/broker-credentials.ts';
import { startBridge } from './mqtt/bridge.ts';
import { adminRouter } from './routes/admin.ts';
import { authRouter } from './routes/auth.ts';
import { clientRouter } from './routes/client.ts';
import { devicesRouter } from './routes/devices.ts';
import { startIdleSweeper } from './runs.ts';
import { attachWebSocket } from './ws.ts';

const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/devices', devicesRouter);
app.use('/api', clientRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
app.use(errorHandler);

try {
  await pool.query('SELECT 1');
} catch (e) {
  console.error(`[db] no se pudo conectar a ${env.DATABASE_URL}: ${(e as Error).message}`);
  console.error('     Levanta Postgres con `docker compose up -d` y aplica el esquema con `pnpm db:reset`.');
  process.exit(1);
}

// Antes de conectar el puente: asegura que el usuario de servicio existe en passwd y la ACL está al día.
await syncBroker().catch((e) =>
  console.warn(`[broker] no se pudo sincronizar Mosquitto (${e.message}). El puente seguirá reintentando.`),
);

const server = http.createServer(app);
attachWebSocket(server);
startBridge();
startIdleSweeper();

server.listen(env.PORT, () => console.log(`[api] http://localhost:${env.PORT}  ws://localhost:${env.PORT}/ws`));

process.on('unhandledRejection', (e) => console.error('[api] promesa rechazada sin manejar:', e));
