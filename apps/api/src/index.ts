import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { pool } from './db.ts';
import { env } from './env.ts';
import { errorHandler } from './http.ts';
import { syncBroker } from './mqtt/broker-credentials.ts';
import { startBridge } from './mqtt/bridge.ts';
import { arrancarPersistencia, detenerPersistencia, reenviarPendientes } from './persistencia.ts';
import { adminRouter } from './routes/admin.ts';
import { authRouter } from './routes/auth.ts';
import { datosRouter } from './routes/datos.ts';
import { dispositivosRouter } from './routes/dispositivos.ts';
import { ingestaRouter } from './routes/ingesta.ts';
import { arrancarBarridoInactivas, arrancarVolcadoPeriodico, volcarTodas } from './sesiones.ts';
import { attachWebSocket } from './ws.ts';

const app = express();
app.use(cors());
app.use(express.json({ limit: '200kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/dispositivos', dispositivosRouter);
app.use('/api', ingestaRouter); // camino REST alternativo del firmware
app.use('/api', datosRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
app.use(errorHandler);

try {
  await pool.query('SELECT 1');
} catch (e) {
  console.error(`[db] no se pudo conectar a ${env.DATABASE_URL}: ${(e as Error).message}`);
  console.error('     Arranca Postgres y aplica el esquema con `pnpm db:reset`.');
  process.exit(1);
}

// Antes de conectar el puente: asegura que el usuario de servicio existe en passwd y la ACL está al día.
await syncBroker().catch((e) =>
  console.warn(`[broker] no se pudo sincronizar Mosquitto (${e.message}). El puente seguirá reintentando.`),
);

const server = http.createServer(app);
attachWebSocket(server);
startBridge();
arrancarPersistencia();
arrancarVolcadoPeriodico();
arrancarBarridoInactivas(env.SESION_INACTIVA_MS, (id) => console.log(`[sesiones] cerrada por inactividad: ${id}`));
await reenviarPendientes();

server.listen(env.PORT, () => console.log(`[api] http://localhost:${env.PORT}  ws://localhost:${env.PORT}/live`));

// Apagado ordenado: lo que esté en el buffer se escribe antes de salir.
let apagando = false;
for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(senal, () => {
    if (apagando) return;
    apagando = true;
    console.log(`[api] ${senal}: vaciando buffers…`);
    Promise.all([detenerPersistencia(), volcarTodas()])
      .catch((e) => console.error('[api] al apagar:', e))
      .finally(() => process.exit(0));
  });
}

process.on('unhandledRejection', (e) => console.error('[api] promesa rechazada sin manejar:', e));
