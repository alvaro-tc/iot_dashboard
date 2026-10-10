// Buffer de persistencia: las lecturas se acumulan en memoria y se insertan en lote cada
// segundo (o al llegar a 200 filas).
//
// Por qué: el camino en vivo (MQTT -> WebSocket) ya emitió el dato antes de llegar aquí. La
// base de datos es el camino lento, y un INSERT por lectura a 2 Hz por robot la castigaría
// sin necesidad. Si Postgres falla, se reintenta con espera exponencial y, si no se recupera,
// las filas se vuelcan a un NDJSON local para no perderlas.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Lectura } from '@iot/shared';
import { pool } from './db.ts';
import { ROOT } from './env.ts';

const MAX_FILAS = 200;
const INTERVALO_MS = 1000;
const ESPERA_MIN_MS = 500;
const ESPERA_MAX_MS = 30_000;
/** Si el buffer crece más que esto, Postgres lleva mucho caído: se vuelca a disco. */
const LIMITE_MEMORIA = 5000;

const PENDIENTES = path.join(ROOT, 'var', 'pendientes.ndjson');

let buffer: Lectura[] = [];
let espera = ESPERA_MIN_MS;
let volcando = false;
let temporizador: ReturnType<typeof setInterval> | null = null;

export const tamanoBuffer = () => buffer.length;

export function encolarLectura(l: Lectura): void {
  buffer.push(l);
  if (buffer.length >= MAX_FILAS) void volcar();
}

async function insertarLecturas(filas: Lectura[]): Promise<void> {
  await pool.query(
    `INSERT INTO lecturas (dispositivo_id, sesion_id, distancia_izquierda_cm, distancia_central_cm,
                           distancia_derecha_cm, movimiento_izquierda, movimiento_derecha,
                           bateria_voltios, bateria_porcentaje, creado_en)
     SELECT * FROM unnest(
       $1::text[], $2::bigint[], $3::numeric[], $4::numeric[], $5::numeric[],
       $6::smallint[], $7::smallint[], $8::numeric[], $9::smallint[], $10::timestamptz[])`,
    [
      filas.map((f) => f.dispositivoId),
      filas.map((f) => f.sesionId),
      filas.map((f) => f.distanciaIzquierdaCm),
      filas.map((f) => f.distanciaCentralCm),
      filas.map((f) => f.distanciaDerechaCm),
      filas.map((f) => f.movimientoIzquierda),
      filas.map((f) => f.movimientoDerecha),
      filas.map((f) => f.bateriaVoltios),
      filas.map((f) => f.bateriaPorcentaje),
      filas.map((f) => new Date(f.creadoEn).toISOString()),
    ],
  );
}

async function aDisco(lecturas: Lectura[]): Promise<void> {
  const lineas = lecturas.map((l) => JSON.stringify(l));
  await fs.mkdir(path.dirname(PENDIENTES), { recursive: true });
  await fs.appendFile(PENDIENTES, lineas.join('\n') + '\n', 'utf8');
  console.warn(`[persistencia] ${lineas.length} filas volcadas a ${PENDIENTES}`);
}

/**
 * Vacía el buffer contra Postgres. Si falla, las filas vuelven al buffer y la siguiente
 * tanda espera el doble (hasta 30 s). Una sola ejecución a la vez.
 */
export async function volcar(): Promise<void> {
  if (volcando || !buffer.length) return;
  volcando = true;

  const lecturas = buffer;
  buffer = [];

  try {
    await insertarLecturas(lecturas);
    espera = ESPERA_MIN_MS;
  } catch (e) {
    console.error(`[persistencia] fallo al insertar (${(e as Error).message}); reintento en ${espera} ms`);
    // Las filas vuelven al principio del buffer para conservar el orden temporal.
    buffer = [...lecturas, ...buffer];
    if (buffer.length > LIMITE_MEMORIA) {
      const l = buffer;
      buffer = [];
      await aDisco(l).catch((err) => console.error('[persistencia] ni a disco:', err.message));
    }
    espera = Math.min(espera * 2, ESPERA_MAX_MS);
    setTimeout(() => void volcar(), espera).unref?.();
  } finally {
    volcando = false;
  }
}

/** Reenvía lo que quedó en el NDJSON de una caída anterior. */
export async function reenviarPendientes(): Promise<void> {
  const texto = await fs.readFile(PENDIENTES, 'utf8').catch(() => '');
  if (!texto.trim()) return;
  const lecturas: Lectura[] = [];
  for (const linea of texto.split('\n')) {
    if (!linea.trim()) continue;
    try {
      lecturas.push(JSON.parse(linea));
    } catch {
      /* línea truncada por un corte de luz: se ignora */
    }
  }
  try {
    if (lecturas.length) await insertarLecturas(lecturas);
    await fs.rm(PENDIENTES, { force: true });
    console.log(`[persistencia] reenviadas ${lecturas.length} filas pendientes`);
  } catch (e) {
    console.warn(`[persistencia] no se pudieron reenviar los pendientes: ${(e as Error).message}`);
  }
}

export function arrancarPersistencia(): void {
  temporizador = setInterval(() => void volcar(), INTERVALO_MS);
  temporizador.unref();
}

/** Al apagar el proceso se vacía el buffer: ninguna lectura ya confirmada se pierde. */
export async function detenerPersistencia(): Promise<void> {
  if (temporizador) clearInterval(temporizador);
  volcando = false;
  await volcar();
}
