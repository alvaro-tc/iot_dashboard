import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { pool } from './db.ts';
import { env } from './env.ts';
import { errorHandler } from './http.ts';
import { syncBroker } from './mqtt/broker-credentials.ts';
import { startBridge } from './mqtt/bridge.ts';
import { arrancarPersistencia, detenerPersistencia, reenviarPendientes } from './persistencia.ts';
import { arrancarVigia } from './presencia.ts';
import { republicarConfiguraciones } from './configuracion.ts';
import { adminRouter } from './routes/admin.ts';
import { authRouter } from './routes/auth.ts';
import { datosRouter } from './routes/datos.ts';
import { dispositivosRouter } from './routes/dispositivos.ts';
import { ingestaRouter } from './routes/ingesta.ts';
import { lidarRouter } from './routes/lidar.ts';
import { arrancarBarridoInactivas, arrancarVolcadoPeriodico, volcarTodas } from './sesiones.ts';
import { attachWebSocket, emitirCambioRobot } from './ws.ts';

const app = express();
app.use(cors());
app.use(express.json({ limit: '200kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/dispositivos', dispositivosRouter);
app.use('/api/lidar', lidarRouter); // modo lidar; responde 404 a quien no tenga el permiso
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

// Bases creadas antes de que el token se guardara cifrado: la columna se añade al arrancar.
await pool.query('ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS token_cifrado TEXT');

// Bases creadas antes de que el tema y el panel se guardaran en la cuenta.
await pool.query(`CREATE TABLE IF NOT EXISTS preferencias_usuario (
  usuario_id     INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  datos          JSONB NOT NULL DEFAULT '{}',
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
)`);

// Bases creadas antes del modo lidar. Todo con IF NOT EXISTS: aplicar el esquema entero
// (db:reset) borraría el historial del cliente, así que las funciones nuevas se añaden en
// caliente al arrancar. Mismo contenido que apps/api/db/schema.sql.
await pool.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS lidar_habilitado BOOLEAN NOT NULL DEFAULT false');
await pool.query(`ALTER TABLE configuracion_dispositivo
  ADD COLUMN IF NOT EXISTS geometria JSONB NOT NULL DEFAULT '{"radioChasisCm":17,"separacionRuedasCm":24,"sensores":{"izquierdo":{"x":12,"y":-12,"anguloDeg":-45},"central":{"x":17,"y":0,"anguloDeg":0},"derecho":{"x":12,"y":12,"anguloDeg":45}}}'`);
await pool.query(`ALTER TABLE configuracion_dispositivo
  ADD COLUMN IF NOT EXISTS calibracion JSONB NOT NULL DEFAULT '{"pwmGiro":140,"gradosPorSegundo":90,"pwmAvance":180,"cmPorSegundo":18,"medidoEn":null}'`);
await pool.query(`CREATE TABLE IF NOT EXISTS salas (
  id                BIGSERIAL PRIMARY KEY,
  dispositivo_id    TEXT NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
  nombre            TEXT NOT NULL,
  forma             TEXT NOT NULL DEFAULT 'rectangulo' CHECK (forma IN ('rectangulo','poligono')),
  vertices          JSONB NOT NULL,
  ancho_estimado_cm INTEGER NOT NULL CHECK (ancho_estimado_cm BETWEEN 50 AND 2000),
  alto_estimado_cm  INTEGER NOT NULL CHECK (alto_estimado_cm  BETWEEN 50 AND 2000),
  ancho_real_cm     NUMERIC(6,1),
  alto_real_cm      NUMERIC(6,1),
  puertas           JSONB NOT NULL DEFAULT '[]',
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
)`);
await pool.query('CREATE INDEX IF NOT EXISTS idx_salas_dispositivo ON salas (dispositivo_id, creado_en)');
await pool.query(
  'CREATE UNIQUE INDEX IF NOT EXISTS uniq_sala_nombre_por_dispositivo ON salas (dispositivo_id, lower(nombre))',
);
await pool.query(`CREATE TABLE IF NOT EXISTS mapas (
  sala_id        BIGINT PRIMARY KEY REFERENCES salas(id) ON DELETE CASCADE,
  rejilla        TEXT NOT NULL,
  cols           INTEGER NOT NULL CHECK (cols > 0),
  filas          INTEGER NOT NULL CHECK (filas > 0),
  resolucion_cm  SMALLINT NOT NULL DEFAULT 5 CHECK (resolucion_cm > 0),
  obstaculos     JSONB NOT NULL DEFAULT '[]',
  barridos       INTEGER NOT NULL DEFAULT 0,
  cobertura      NUMERIC(4,3) NOT NULL DEFAULT 0,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
)`);
await pool.query(
  'ALTER TABLE configuracion_dispositivo ADD COLUMN IF NOT EXISTS sala_activa_id BIGINT REFERENCES salas(id) ON DELETE SET NULL',
);

// Antes de conectar el puente: asegura que el usuario de servicio existe en passwd y la ACL está al día.
await syncBroker().catch((e) =>
  console.warn(`[broker] no se pudo sincronizar Mosquitto (${e.message}). El puente seguirá reintentando.`),
);

const server = http.createServer(app);
attachWebSocket(server);
startBridge();

// La config va RETENIDA en el broker, así que un payload de una versión anterior del proyecto
// se queda ahí para siempre y es lo primero que recibe un robot al suscribirse. Uno de esos
// (con los nombres viejos de los sensores) dejaba los tres ángulos en undefined y el robot
// publicaba null en los tres sensores sin quejarse. Republicar la vigente al arrancar sobrescribe
// lo rancio: el retenido siempre corresponde al esquema que el código entiende.
setTimeout(() => void republicarConfiguraciones(), 2_000);
arrancarPersistencia();
arrancarVolcadoPeriodico();
arrancarVigia();
arrancarBarridoInactivas(env.SESION_INACTIVA_MS, (id) => {
  console.log(`[sesiones] cerrada por inactividad: ${id}`);
  void emitirCambioRobot(id, ['sesiones', 'resumen', 'dispositivos', 'admin-resumen']);
});
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
