// Modo lidar: habitaciones, mapas, calibración y las órdenes de reconocer y limpiar.
//
// CONTROL DE ACCESO
// Todo el router pasa por `exigirLidar`, que responde **404** (no 403) si el cliente no tiene
// el permiso que da el admin. La diferencia importa: un 403 confirma que la función existe. Con
// 404, para un cliente sin permiso estas rutas son indistinguibles de rutas que no existen, y
// como el front tampoco le pinta el menú ni la ruta, no puede enterarse de que hay algo.
//
// Un admin siempre pasa (es quien da el permiso y tiene que poder probarlo).
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.ts';
import { pool } from '../db.ts';
import { HttpError, parse } from '../http.ts';
import {
  actualizarSala,
  ajustesDe,
  borrarMapa,
  borrarSala,
  calibracionSchema,
  crearSala,
  elegirSalaActiva,
  geometriaSchema,
  guardarGeometria,
  guardarCalibracion,
  guardarPuertas,
  robotDeSala,
  salaDe,
  salaParcialSchema,
  salaSchema,
  salasDe,
} from '../lidar/datos.ts';
import {
  calibrarAvance,
  calibrarGiro,
  estadoCompleto,
  limpiar,
  parar,
  reconocer,
} from '../lidar/mapeo.ts';
import { emitirCambioRobot } from '../ws.ts';
import { exigirPropiedad } from './dispositivos.ts';

export const lidarRouter = Router();

const NO_EXISTE = new HttpError(404, 'Ruta no encontrada.');

/** ¿Tiene esta cuenta el modo lidar? Lo decide un admin, cuenta por cuenta. */
export async function lidarHabilitado(usuarioId: number): Promise<boolean> {
  const { rows } = await pool.query<{ lidar_habilitado: boolean }>(
    'SELECT lidar_habilitado FROM usuarios WHERE id = $1',
    [usuarioId],
  );
  return rows[0]?.lidar_habilitado === true;
}

const exigirLidar: RequestHandler = async (req, _res, next) => {
  if (req.user.role === 'admin' || (await lidarHabilitado(req.user.id))) return next();
  next(NO_EXISTE); // nunca 403: un 403 ya delataría que la función existe
};

lidarRouter.use(requireAuth, exigirLidar);

/** Comprueba que la habitación existe y que su robot es de quien pregunta. */
async function exigirSala(salaId: string, user: { id: number; role: string }): Promise<number> {
  const id = Number(salaId);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Identificador de habitación inválido.');
  const dispositivoId = await robotDeSala(id);
  if (!dispositivoId) throw new HttpError(404, 'La habitación no existe.');
  await exigirPropiedad(dispositivoId, user);
  return id;
}

/**
 * `dispositivos` va con `salas` porque la ubicación del robot es el nombre de su habitación
 * activa (ver `elegirSalaActiva`): al cambiar de cuarto, renombrarlo o borrarlo, la tarjeta del
 * robot tiene que decir otra cosa.
 */
const CLAVES_SALAS = ['salas', 'dispositivos'];

// ---------------------------------------------------------------------------
// Habitaciones de un robot
// ---------------------------------------------------------------------------

lidarRouter.get('/dispositivos/:id/salas', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  res.json(await salasDe(req.params.id));
});

lidarRouter.post('/dispositivos/:id/salas', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  const sala = await crearSala(req.params.id, parse(salaSchema, req.body));
  // La primera habitación de un robot se queda seleccionada: no tiene sentido pedir al
  // cliente que elija entre una.
  const { salaActivaId } = await ajustesDe(req.params.id);
  if (salaActivaId === null) await elegirSalaActiva(req.params.id, sala.id);
  emitirCambioRobot(req.params.id, CLAVES_SALAS);
  res.status(201).json(sala);
});

lidarRouter.patch('/salas/:id', async (req, res) => {
  const id = await exigirSala(req.params.id, req.user);
  const cambio = parse(salaParcialSchema, req.body);
  const antes = await salaDe(id);
  const sala = await actualizarSala(id, cambio);

  // Cambiar la forma invalida el mapa: la rejilla está indexada sobre la caja del polígono
  // viejo, así que sus celdas ya no caen donde deben. Mejor pedir otro escaneo que dibujar
  // obstáculos desplazados.
  if (cambio.vertices && JSON.stringify(antes?.vertices) !== JSON.stringify(sala.vertices)) {
    await borrarMapa(id);
  }
  emitirCambioRobot(sala.dispositivoId, CLAVES_SALAS);
  res.json(sala);
});

/** Puertas: el dibujo del cliente sobre el plano. Van aparte porque se tocan mucho más. */
lidarRouter.put('/salas/:id/puertas', async (req, res) => {
  const id = await exigirSala(req.params.id, req.user);
  const { puertas } = parse(salaSchema.pick({ puertas: true }).required(), req.body);
  await guardarPuertas(id, puertas);
  const sala = await salaDe(id);
  emitirCambioRobot(sala!.dispositivoId, CLAVES_SALAS);
  res.json(sala);
});

lidarRouter.delete('/salas/:id', async (req, res) => {
  const id = await exigirSala(req.params.id, req.user);
  const sala = await salaDe(id);
  await borrarSala(id);
  if (sala) emitirCambioRobot(sala.dispositivoId, CLAVES_SALAS);
  res.status(204).end();
});

/** Volver a escanear: se tira el mapa y se empieza de cero (el cuarto ha cambiado). */
lidarRouter.delete('/salas/:id/mapa', async (req, res) => {
  const id = await exigirSala(req.params.id, req.user);
  await borrarMapa(id);
  const sala = await salaDe(id);
  if (sala) emitirCambioRobot(sala.dispositivoId, CLAVES_SALAS);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Qué habitación está trabajando el robot, y su mapa
// ---------------------------------------------------------------------------

lidarRouter.put('/dispositivos/:id/sala-activa', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  const { salaId } = parse(z.object({ salaId: z.number().int().positive().nullable() }), req.body);
  if (salaId !== null) {
    const dispositivoId = await robotDeSala(salaId);
    if (dispositivoId !== req.params.id) throw new HttpError(400, 'Esa habitación no es de este robot.');
  }
  await elegirSalaActiva(req.params.id, salaId);
  emitirCambioRobot(req.params.id, CLAVES_SALAS);
  res.json({ salaId });
});

lidarRouter.get('/dispositivos/:id/estado', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  const { salaActivaId } = await ajustesDe(req.params.id);
  const salaId = req.query.salaId ? Number(req.query.salaId) : salaActivaId;
  res.json(await estadoCompleto(req.params.id, Number.isInteger(salaId) ? salaId : null));
});

// ---------------------------------------------------------------------------
// Medidas del robot y calibración
// ---------------------------------------------------------------------------

lidarRouter.get('/dispositivos/:id/ajustes', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  res.json(await ajustesDe(req.params.id));
});

lidarRouter.put('/dispositivos/:id/geometria', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  res.json(await guardarGeometria(req.params.id, parse(geometriaSchema, req.body)));
});

/** Calibración a mano: se puede escribir si ya se sabe, en vez de medirla. */
lidarRouter.put('/dispositivos/:id/calibracion', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  res.json(await guardarCalibracion(req.params.id, parse(calibracionSchema, req.body)));
});

// ---------------------------------------------------------------------------
// Órdenes
// ---------------------------------------------------------------------------

const accionSchema = z.object({
  accion: z.enum(['reconocer', 'limpiar', 'parar', 'calibrar_giro', 'calibrar_avance']),
  salaId: z.number().int().positive().optional(),
  /**
   * Dónde está el robot al empezar, marcado por el cliente en el plano. Es opcional, pero
   * cambia mucho: sin él, en una sala rectangular y lisa hay varias poses que explican las
   * paredes igual de bien y el mapa puede salir desplazado o girado.
   */
  inicio: z.object({ x: z.number().min(0).max(2000), y: z.number().min(0).max(2000) }).nullish(),
});

lidarRouter.post('/dispositivos/:id/accion', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  const { accion, salaId, inicio } = parse(accionSchema, req.body);

  // El robot tiene que estar en línea: si no, la orden se publica al vacío y el cliente se
  // queda mirando un panel que no avanza sin saber por qué.
  const { rows } = await pool.query<{ en_linea: boolean }>('SELECT en_linea FROM dispositivos WHERE id = $1', [
    req.params.id,
  ]);
  if (!rows[0]?.en_linea && accion !== 'parar') {
    throw new HttpError(409, 'El robot está desconectado. Enciéndelo y espera a que aparezca en línea.');
  }

  try {
    if (accion === 'parar') await parar(req.params.id);
    else if (accion === 'calibrar_giro') await calibrarGiro(req.params.id);
    else if (accion === 'calibrar_avance') await calibrarAvance(req.params.id);
    else {
      const id = salaId ?? (await ajustesDe(req.params.id)).salaActivaId;
      if (id === null || id === undefined) {
        throw new HttpError(400, 'Elige primero una habitación.');
      }
      const dispositivoId = await robotDeSala(id);
      if (dispositivoId !== req.params.id) throw new HttpError(400, 'Esa habitación no es de este robot.');
      if (accion === 'reconocer') await reconocer(req.params.id, id, inicio ?? null);
      else await limpiar(req.params.id, id, inicio ?? null);
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, (e as Error).message);
  }
  res.json({ ok: true });
});
