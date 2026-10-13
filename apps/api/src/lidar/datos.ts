// Acceso a datos del modo lidar: habitaciones, su mapa, y las medidas y la calibración de cada
// robot. Todo el SQL del modo lidar vive aquí; `mapeo.ts` solo trata con estas funciones.
import {
  CALIBRACION_POR_DEFECTO,
  GEOMETRIA_POR_DEFECTO,
  RESOLUCION_CM,
  caja,
  crearRejilla,
  normalizarVertices,
  rejillaABase64,
  rejillaDeBase64,
  type CalibracionRobot,
  type GeometriaRobot,
  type Obstaculo,
  type Puerta,
  type Punto,
  type Rejilla,
  type Sala,
} from '@iot/shared';
import { z } from 'zod';
import { pool } from '../db.ts';
import { HttpError } from '../http.ts';

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

const punto = z.object({ x: z.number().min(-2000).max(2000), y: z.number().min(-2000).max(2000) });

/** Un polígono de paredes rectas: al menos un triángulo, y nada absurdo de grande. */
export const verticesSchema = z
  .array(punto)
  .min(3, 'Una habitación necesita al menos 3 esquinas.')
  .max(24, 'Como mucho 24 esquinas.')
  .refine((v) => {
    const c = caja(v);
    return c.ancho >= 50 && c.alto >= 50 && c.ancho <= 2000 && c.alto <= 2000;
  }, 'La habitación debe medir entre 50 cm y 20 m de lado.');

const puertaSchema = z.object({
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
  nombre: z.string().trim().max(40).optional(),
});

export const salaSchema = z.object({
  nombre: z
    .string({ required_error: 'Ponle un nombre a la habitación.' })
    .trim()
    .min(2, 'El nombre debe tener al menos 2 caracteres.')
    .max(40, 'El nombre no puede superar 40 caracteres.'),
  forma: z.enum(['rectangulo', 'poligono']).default('rectangulo'),
  vertices: verticesSchema,
  anchoEstimadoCm: z.number().int().min(50).max(2000),
  altoEstimadoCm: z.number().int().min(50).max(2000),
  puertas: z.array(puertaSchema).max(12, 'Como mucho 12 puertas.').default([]),
});

export const salaParcialSchema = salaSchema.partial();

const sensorSchema = z.object({
  x: z.number().min(-60).max(60),
  y: z.number().min(-60).max(60),
  anguloDeg: z.number().min(-180).max(180),
});

export const geometriaSchema = z.object({
  radioChasisCm: z.number().min(3).max(100),
  separacionRuedasCm: z.number().min(3).max(100),
  sensores: z.object({ izquierdo: sensorSchema, central: sensorSchema, derecho: sensorSchema }),
});

export const calibracionSchema = z.object({
  pwmGiro: z.number().int().min(40).max(255),
  gradosPorSegundo: z.number().min(5).max(720),
  pwmAvance: z.number().int().min(40).max(255),
  cmPorSegundo: z.number().min(1).max(200),
  medidoEn: z.number().nullable(),
});

// ---------------------------------------------------------------------------
// Habitaciones
// ---------------------------------------------------------------------------

const COLUMNAS_SALA = `s.id, s.dispositivo_id AS "dispositivoId", s.nombre, s.forma, s.vertices,
  s.ancho_estimado_cm AS "anchoEstimadoCm", s.alto_estimado_cm AS "altoEstimadoCm",
  s.ancho_real_cm AS "anchoRealCm", s.alto_real_cm AS "altoRealCm", s.puertas,
  s.creado_en AS "creadoEn", s.actualizado_en AS "actualizadoEn"`;

/** Una habitación con el resumen de su mapa (sin la rejilla, que pesa). */
export interface SalaConMapa extends Sala {
  mapa: { barridos: number; cobertura: number; obstaculos: number; actualizadoEn: string } | null;
  activa: boolean;
}

export async function salasDe(dispositivoId: string): Promise<SalaConMapa[]> {
  const { rows } = await pool.query(
    `SELECT ${COLUMNAS_SALA},
            m.barridos, m.cobertura, m.actualizado_en AS "mapaActualizadoEn",
            coalesce(jsonb_array_length(m.obstaculos), 0) AS "numObstaculos",
            (c.sala_activa_id = s.id) AS activa
     FROM salas s
     LEFT JOIN mapas m ON m.sala_id = s.id
     LEFT JOIN configuracion_dispositivo c ON c.dispositivo_id = s.dispositivo_id
     WHERE s.dispositivo_id = $1
     ORDER BY s.creado_en`,
    [dispositivoId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    dispositivoId: r.dispositivoId,
    nombre: r.nombre,
    forma: r.forma,
    vertices: r.vertices,
    anchoEstimadoCm: r.anchoEstimadoCm,
    altoEstimadoCm: r.altoEstimadoCm,
    anchoRealCm: r.anchoRealCm === null ? null : Number(r.anchoRealCm),
    altoRealCm: r.altoRealCm === null ? null : Number(r.altoRealCm),
    puertas: r.puertas,
    creadoEn: r.creadoEn,
    actualizadoEn: r.actualizadoEn,
    activa: r.activa === true,
    mapa: r.barridos === null
      ? null
      : {
          barridos: r.barridos,
          cobertura: Number(r.cobertura),
          obstaculos: Number(r.numObstaculos),
          actualizadoEn: r.mapaActualizadoEn,
        },
  }));
}

export async function salaDe(salaId: number): Promise<Sala | null> {
  const { rows } = await pool.query(`SELECT ${COLUMNAS_SALA} FROM salas s WHERE s.id = $1`, [salaId]);
  const r = rows[0];
  if (!r) return null;
  return {
    ...r,
    id: Number(r.id),
    anchoRealCm: r.anchoRealCm === null ? null : Number(r.anchoRealCm),
    altoRealCm: r.altoRealCm === null ? null : Number(r.altoRealCm),
  };
}

/** El robot de una habitación: lo usa el control de acceso de las rutas. */
export async function robotDeSala(salaId: number): Promise<string | null> {
  const { rows } = await pool.query<{ dispositivo_id: string }>(
    'SELECT dispositivo_id FROM salas WHERE id = $1',
    [salaId],
  );
  return rows[0]?.dispositivo_id ?? null;
}

const nombreOcupado = new HttpError(400, 'Revisa los campos marcados.', {
  nombre: 'Ya tienes una habitación con ese nombre en este robot.',
});

export async function crearSala(dispositivoId: string, datos: z.infer<typeof salaSchema>): Promise<Sala> {
  // Los vértices se guardan ya normalizados al origen: el marco de la sala y el de la rejilla
  // son el mismo, así que la celda (0,0) es siempre la esquina de la caja del polígono.
  const vertices = normalizarVertices(datos.vertices);
  try {
    const { rows } = await pool.query(
      `INSERT INTO salas (dispositivo_id, nombre, forma, vertices, ancho_estimado_cm, alto_estimado_cm, puertas)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNAS_SALA.replace(/s\./g, '')}`,
      [
        dispositivoId,
        datos.nombre,
        datos.forma,
        JSON.stringify(vertices),
        datos.anchoEstimadoCm,
        datos.altoEstimadoCm,
        JSON.stringify(datos.puertas),
      ],
    );
    return { ...rows[0], id: Number(rows[0].id) };
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw nombreOcupado;
    throw e;
  }
}

export async function actualizarSala(salaId: number, datos: z.infer<typeof salaParcialSchema>): Promise<Sala> {
  const vertices = datos.vertices ? normalizarVertices(datos.vertices) : null;
  try {
    const { rows } = await pool.query(
      `UPDATE salas SET
         nombre = coalesce($2, nombre),
         forma = coalesce($3, forma),
         vertices = coalesce($4::jsonb, vertices),
         ancho_estimado_cm = coalesce($5, ancho_estimado_cm),
         alto_estimado_cm = coalesce($6, alto_estimado_cm),
         puertas = coalesce($7::jsonb, puertas),
         actualizado_en = now()
       WHERE id = $1 RETURNING ${COLUMNAS_SALA.replace(/s\./g, '')}`,
      [
        salaId,
        datos.nombre ?? null,
        datos.forma ?? null,
        vertices ? JSON.stringify(vertices) : null,
        datos.anchoEstimadoCm ?? null,
        datos.altoEstimadoCm ?? null,
        datos.puertas ? JSON.stringify(datos.puertas) : null,
      ],
    );
    if (!rows[0]) throw new HttpError(404, 'La habitación no existe.');
    return { ...rows[0], id: Number(rows[0].id) };
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw nombreOcupado;
    throw e;
  }
}

/**
 * Cambiar la forma invalida el mapa: la rejilla está indexada sobre la caja del polígono
 * anterior, así que sus celdas ya no corresponden con la habitación. Mejor borrarlo y volver a
 * escanear que dibujar obstáculos desplazados.
 */
export const borrarMapa = (salaId: number) => pool.query('DELETE FROM mapas WHERE sala_id = $1', [salaId]);

export async function borrarSala(salaId: number): Promise<void> {
  const { rowCount } = await pool.query('DELETE FROM salas WHERE id = $1', [salaId]); // cascada: su mapa
  if (!rowCount) throw new HttpError(404, 'La habitación no existe.');
}

// ---------------------------------------------------------------------------
// Mapa
// ---------------------------------------------------------------------------

export interface MapaGuardado {
  salaId: number;
  rejilla: Rejilla;
  obstaculos: Obstaculo[];
  barridos: number;
  cobertura: number;
  actualizadoEn: string;
}

export async function mapaDe(salaId: number): Promise<MapaGuardado | null> {
  const { rows } = await pool.query(
    `SELECT rejilla, cols, filas, resolucion_cm AS res, obstaculos, barridos, cobertura,
            actualizado_en AS "actualizadoEn"
     FROM mapas WHERE sala_id = $1`,
    [salaId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    salaId,
    rejilla: rejillaDeBase64(r.rejilla, r.cols, r.filas, r.res),
    obstaculos: r.obstaculos,
    barridos: r.barridos,
    cobertura: Number(r.cobertura),
    actualizadoEn: r.actualizadoEn,
  };
}

/** Rejilla vacía del tamaño de la caja de la habitación. */
export function rejillaParaSala(vertices: Punto[]): Rejilla {
  const c = caja(vertices);
  return crearRejilla(c.ancho, c.alto, RESOLUCION_CM);
}

export async function guardarMapa(m: Omit<MapaGuardado, 'actualizadoEn'>): Promise<void> {
  await pool.query(
    `INSERT INTO mapas (sala_id, rejilla, cols, filas, resolucion_cm, obstaculos, barridos, cobertura, actualizado_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (sala_id) DO UPDATE SET
       rejilla = $2, cols = $3, filas = $4, resolucion_cm = $5,
       obstaculos = $6, barridos = $7, cobertura = $8, actualizado_en = now()`,
    [
      m.salaId,
      rejillaABase64(m.rejilla),
      m.rejilla.cols,
      m.rejilla.filas,
      m.rejilla.res,
      JSON.stringify(m.obstaculos),
      m.barridos,
      m.cobertura,
    ],
  );
}

/** Lo medido de verdad: la caja de la habitación según el mapa. Se guarda junto a lo estimado. */
export async function guardarTamanoReal(salaId: number, anchoCm: number, altoCm: number): Promise<void> {
  await pool.query(
    'UPDATE salas SET ancho_real_cm = $2, alto_real_cm = $3, actualizado_en = now() WHERE id = $1',
    [salaId, Math.round(anchoCm * 10) / 10, Math.round(altoCm * 10) / 10],
  );
}

export async function guardarPuertas(salaId: number, puertas: Puerta[]): Promise<void> {
  await pool.query('UPDATE salas SET puertas = $2::jsonb, actualizado_en = now() WHERE id = $1', [
    salaId,
    JSON.stringify(puertas),
  ]);
}

// ---------------------------------------------------------------------------
// Medidas y calibración del robot
// ---------------------------------------------------------------------------

export interface AjustesRobot {
  geometria: GeometriaRobot;
  calibracion: CalibracionRobot;
  salaActivaId: number | null;
}

const cache = new Map<string, AjustesRobot>();

export async function ajustesDe(dispositivoId: string): Promise<AjustesRobot> {
  const enCache = cache.get(dispositivoId);
  if (enCache) return enCache;
  const { rows } = await pool.query(
    `SELECT geometria, calibracion, sala_activa_id AS "salaActivaId"
     FROM configuracion_dispositivo WHERE dispositivo_id = $1`,
    [dispositivoId],
  );
  const r = rows[0];
  const ajustes: AjustesRobot = {
    geometria: r?.geometria ?? GEOMETRIA_POR_DEFECTO,
    calibracion: r?.calibracion ?? CALIBRACION_POR_DEFECTO,
    salaActivaId: r?.salaActivaId === undefined || r.salaActivaId === null ? null : Number(r.salaActivaId),
  };
  cache.set(dispositivoId, ajustes);
  return ajustes;
}

export const olvidarAjustes = (dispositivoId: string) => cache.delete(dispositivoId);

export async function guardarGeometria(dispositivoId: string, geometria: GeometriaRobot): Promise<AjustesRobot> {
  await pool.query('UPDATE configuracion_dispositivo SET geometria = $2::jsonb, actualizado_en = now() WHERE dispositivo_id = $1', [
    dispositivoId,
    JSON.stringify(geometria),
  ]);
  olvidarAjustes(dispositivoId);
  return ajustesDe(dispositivoId);
}

export async function guardarCalibracion(dispositivoId: string, calibracion: CalibracionRobot): Promise<AjustesRobot> {
  await pool.query('UPDATE configuracion_dispositivo SET calibracion = $2::jsonb, actualizado_en = now() WHERE dispositivo_id = $1', [
    dispositivoId,
    JSON.stringify(calibracion),
  ]);
  olvidarAjustes(dispositivoId);
  return ajustesDe(dispositivoId);
}

/**
 * Pone la habitación en la que trabaja el robot y, con ella, su ubicación: la ubicación ES el
 * cuarto en el que está, así que se escribe aquí (donde pasan todos los caminos: el selector
 * del plano, la primera habitación que se crea y el PATCH del robot) en vez de dejar un campo
 * de texto suelto que se contradiga con el mapa que se está mirando.
 */
export async function elegirSalaActiva(dispositivoId: string, salaId: number | null): Promise<void> {
  await pool.query('UPDATE configuracion_dispositivo SET sala_activa_id = $2 WHERE dispositivo_id = $1', [
    dispositivoId,
    salaId,
  ]);
  if (salaId !== null) {
    await pool.query(
      `UPDATE dispositivos d SET ubicacion = s.nombre
         FROM salas s WHERE s.id = $2 AND s.dispositivo_id = d.id AND d.id = $1`,
      [dispositivoId, salaId],
    );
  }
  olvidarAjustes(dispositivoId);
}

/** La habitación de este robot que se llama así, si existe. Es lo que liga ubicación y cuarto. */
export async function salaPorNombre(dispositivoId: string, nombre: string): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>(
    'SELECT id FROM salas WHERE dispositivo_id = $1 AND lower(nombre) = lower($2) LIMIT 1',
    [dispositivoId, nombre.trim()],
  );
  return rows[0] ? Number(rows[0].id) : null;
}
