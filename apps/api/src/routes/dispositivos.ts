// CRUD de robots. Al crear uno se genera su usuario/contraseña MQTT y se registra en
// Mosquitto con una ACL que solo le deja hablar bajo roomba/{id}/#.
//
// La contraseña se guarda dos veces: como hash bcrypt (lo que valida /api/ingesta) y cifrada con
// AES-256-GCM, para que el dueño del robot pueda volver a consultarla en GET /:id/credenciales sin
// tener que regenerarla y reflashear el ESP32.
import bcrypt from 'bcrypt';
import { Router } from 'express';
import { customAlphabet, nanoid } from 'nanoid';
import { z } from 'zod';
import { requireAuth } from '../auth.ts';
import { configuracionDe, olvidarConfiguracion, publicarConfiguracion } from '../configuracion.ts';
import { COLUMNAS_DISPOSITIVO, listaDispositivos } from '../consultas.ts';
import { pool } from '../db.ts';
import { env } from '../env.ts';
import { HttpError, parse } from '../http.ts';
import { addDevice, removeDevices } from '../mqtt/broker-credentials.ts';
import { cerrarSesion } from '../sesiones.ts';
import { cifrarToken, descifrarToken } from '../token-robot.ts';
import { olvidarRobot } from '../telemetria.ts';
import { emitirCambio, emitirCambioRobot } from '../ws.ts';

const idCorto = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

/** Lo que deja obsoleto dar de alta, renombrar o dar de baja un robot. */
const CLAVES_ROBOTS = ['dispositivos', 'admin-robots', 'admin-resumen', 'admin-users'];

const BROKER_CAIDO =
  'No se pudo actualizar el broker MQTT. Comprueba que Mosquitto está en marcha e inténtalo de nuevo.';

const nombreSchema = z
  .string({ required_error: 'Ponle un nombre al robot.' })
  .trim()
  .min(2, 'El nombre debe tener al menos 2 caracteres.')
  .max(60, 'El nombre no puede superar 60 caracteres.');
const ubicacionSchema = z.string().trim().max(60, 'La ubicación no puede superar 60 caracteres.');

function infoBroker() {
  const url = new URL(env.MQTT_URL);
  return { host: env.MQTT_PUBLIC_HOST || url.hostname, port: env.MQTT_PUBLIC_PORT ?? Number(url.port || 1883) };
}

/** Comprueba que el robot existe y es del usuario (o que quien pregunta es admin). */
export async function exigirPropiedad(dispositivoId: string, user: { id: number; role: string }): Promise<void> {
  const { rows } = await pool.query<{ usuario_id: number }>('SELECT usuario_id FROM dispositivos WHERE id = $1', [
    dispositivoId,
  ]);
  if (!rows[0]) throw new HttpError(404, 'El robot no existe.');
  if (user.role !== 'admin' && rows[0].usuario_id !== user.id) throw new HttpError(404, 'El robot no existe.');
}

export const dispositivosRouter = Router();
dispositivosRouter.use(requireAuth);

dispositivosRouter.get('/', async (req, res) => {
  res.json(await listaDispositivos(req.user));
});

dispositivosRouter.post('/', async (req, res) => {
  const body = parse(z.object({ nombre: nombreSchema, ubicacion: ubicacionSchema.default('') }), req.body);

  const id = `roomba-${idCorto()}`;
  const token = nanoid(32);
  const { rows } = await pool.query(
    `INSERT INTO dispositivos (id, usuario_id, nombre, ubicacion, token_hash, token_cifrado)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNAS_DISPOSITIVO}`,
    [id, req.user.id, body.nombre, body.ubicacion, await bcrypt.hash(token, 10), cifrarToken(token)],
  );
  try {
    await addDevice(id, token);
  } catch (e) {
    console.error('[dispositivos] no se pudo registrar en el broker:', (e as Error).message);
    await pool.query('DELETE FROM dispositivos WHERE id = $1', [id]);
    throw new HttpError(502, BROKER_CAIDO);
  }
  // El trigger ya creó la configuración; se publica retenida para que el robot la reciba
  // en cuanto se suscriba por primera vez.
  const config = await configuracionDe(id);
  publicarConfiguracion(id, config);

  emitirCambio(CLAVES_ROBOTS, req.user.id);
  res.status(201).json({ dispositivo: rows[0], token, config, broker: infoBroker() });
});

dispositivosRouter.patch('/:id', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  const body = parse(
    z.object({ nombre: nombreSchema.optional(), ubicacion: ubicacionSchema.optional() }),
    req.body,
  );
  const { rows } = await pool.query(
    `UPDATE dispositivos SET nombre = coalesce($2, nombre), ubicacion = coalesce($3, ubicacion)
     WHERE id = $1 RETURNING ${COLUMNAS_DISPOSITIVO}`,
    [req.params.id, body.nombre ?? null, body.ubicacion ?? null],
  );
  emitirCambioRobot(req.params.id, CLAVES_ROBOTS);
  res.json(rows[0]);
});

/**
 * Credenciales completas del robot, para volver a copiarlas en el config.py del ESP32.
 * token = null en robots dados de alta antes de guardarse cifrado (o con otro JWT_SECRET):
 * esos sí hay que regenerarlos.
 */
dispositivosRouter.get('/:id/credenciales', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  const { rows } = await pool.query<{ token_cifrado: string | null }>(
    'SELECT token_cifrado FROM dispositivos WHERE id = $1',
    [req.params.id],
  );
  res.json({ id: req.params.id, token: descifrarToken(rows[0].token_cifrado), broker: infoBroker() });
});

/** Nueva contraseña MQTT. La anterior deja de servir en cuanto Mosquitto recarga. */
dispositivosRouter.post('/:id/regenerar-clave', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  const token = nanoid(32);
  await pool.query('UPDATE dispositivos SET token_hash = $2, token_cifrado = $3 WHERE id = $1', [
    req.params.id,
    await bcrypt.hash(token, 10),
    cifrarToken(token),
  ]);
  try {
    await addDevice(req.params.id, token);
  } catch (e) {
    console.error('[dispositivos] no se pudo registrar en el broker:', (e as Error).message);
    throw new HttpError(502, BROKER_CAIDO);
  }
  res.json({ id: req.params.id, token, broker: infoBroker() });
});

dispositivosRouter.delete('/:id', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  const { rowCount } = await pool.query(
    'UPDATE dispositivos SET revocado = true WHERE id = $1 AND NOT revocado',
    [req.params.id],
  );
  if (!rowCount) throw new HttpError(404, 'El robot no existe o ya estaba dado de baja.');

  emitirCambioRobot(req.params.id, CLAVES_ROBOTS);
  await cerrarSesion(req.params.id).catch(() => {});
  olvidarRobot(req.params.id);
  olvidarConfiguracion(req.params.id);
  try {
    await removeDevices([req.params.id]);
  } catch (e) {
    // En la base ya está revocado y sus mensajes se descartan; el broker se reconcilia al
    // reiniciar la API con syncBroker().
    console.error('[dispositivos] baja sin recargar broker:', (e as Error).message);
    throw new HttpError(502, `Robot dado de baja, pero ${BROKER_CAIDO.charAt(0).toLowerCase()}${BROKER_CAIDO.slice(1)}`);
  }
  res.status(204).end();
});
