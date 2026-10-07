// Buffer de persistencia: las lecturas y los eventos se acumulan en memoria y se insertan
// en lote cada segundo (o al llegar a 200 filas).
//
// Por qué: el camino en vivo (MQTT -> WebSocket) ya emitió el dato antes de llegar aquí. La
// base de datos es el camino lento, y un INSERT por lectura a 5 Hz por robot la castigaría
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

export interface EventoPersistible {
  dispositivoId: string;
  sesionId: number | null;
  tipo: string;
  sensor: string | null;
  distanciaCm: number | null;
  posXCm: number | null;
  posYCm: number | null;
  mensaje: string;
  creadoEn: number;
}

let bufferLecturas: Lectura[] = [];
let bufferEventos: EventoPersistible[] = [];
let espera = ESPERA_MIN_MS;
let volcando = false;
let temporizador: ReturnType<typeof setInterval> | null = null;

export const tamanoBuffer = () => bufferLecturas.length + bufferEventos.length;

export function encolarLectura(l: Lectura): void {
  bufferLecturas.push(l);
  if (bufferLecturas.length >= MAX_FILAS) void volcar();
}

export function encolarEvento(e: EventoPersistible): void {
  bufferEventos.push(e);
}

async function insertarLecturas(filas: Lectura[]): Promise<void> {
  // ON CONFLICT DO NOTHING: un lote diferido reenviado tras una reconexión trae lecturas
  // que ya se guardaron en vivo. El índice único (sesion_id, secuencia) las descarta.
  await pool.query(
    `INSERT INTO lecturas (dispositivo_id, sesion_id, secuencia, dist_izq_cm, dist_centro_cm, dist_der_cm,
                           estado_movimiento, pos_x_cm, pos_y_cm, orientacion_deg, vel_izq_pct, vel_der_pct,
                           bateria_v, bateria_pct, rssi_dbm, medido_en, recibido_en)
     SELECT * FROM unnest(
       $1::text[], $2::bigint[], $3::int[], $4::numeric[], $5::numeric[], $6::numeric[], $7::text[],
       $8::numeric[], $9::numeric[], $10::numeric[], $11::smallint[], $12::smallint[], $13::numeric[],
       $14::smallint[], $15::smallint[], $16::timestamptz[], $17::timestamptz[])
     ON CONFLICT (sesion_id, secuencia) DO NOTHING`,
    [
      filas.map((f) => f.dispositivoId),
      filas.map((f) => f.sesionId),
      filas.map((f) => f.seq),
      filas.map((f) => f.distIzqCm),
      filas.map((f) => f.distCentroCm),
      filas.map((f) => f.distDerCm),
      filas.map((f) => f.movimiento),
      filas.map((f) => f.posXCm),
      filas.map((f) => f.posYCm),
      filas.map((f) => f.orientacionDeg),
      filas.map((f) => f.velIzqPct),
      filas.map((f) => f.velDerPct),
      filas.map((f) => f.bateriaV),
      filas.map((f) => f.bateriaPct),
      filas.map((f) => f.rssiDbm),
      filas.map((f) => new Date(f.medidoEn).toISOString()),
      filas.map((f) => new Date(f.recibidoEn).toISOString()),
    ],
  );
}

async function insertarEventos(filas: EventoPersistible[]): Promise<void> {
  await pool.query(
    `INSERT INTO eventos (dispositivo_id, sesion_id, tipo, sensor, distancia_cm, pos_x_cm, pos_y_cm, mensaje, creado_en)
     SELECT * FROM unnest($1::text[], $2::bigint[], $3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::numeric[], $8::text[], $9::timestamptz[])`,
    [
      filas.map((f) => f.dispositivoId),
      filas.map((f) => f.sesionId),
      filas.map((f) => f.tipo),
      filas.map((f) => f.sensor),
      filas.map((f) => f.distanciaCm),
      filas.map((f) => f.posXCm),
      filas.map((f) => f.posYCm),
      filas.map((f) => f.mensaje),
      filas.map((f) => new Date(f.creadoEn).toISOString()),
    ],
  );
}

async function aDisco(lecturas: Lectura[], eventos: EventoPersistible[]): Promise<void> {
  const lineas = [
    ...lecturas.map((l) => JSON.stringify({ tipo: 'lectura', dato: l })),
    ...eventos.map((e) => JSON.stringify({ tipo: 'evento', dato: e })),
  ];
  await fs.mkdir(path.dirname(PENDIENTES), { recursive: true });
  await fs.appendFile(PENDIENTES, lineas.join('\n') + '\n', 'utf8');
  console.warn(`[persistencia] ${lineas.length} filas volcadas a ${PENDIENTES}`);
}

/**
 * Vacía el buffer contra Postgres. Si falla, las filas vuelven al buffer y la siguiente
 * tanda espera el doble (hasta 30 s). Una sola ejecución a la vez.
 */
export async function volcar(): Promise<void> {
  if (volcando) return;
  if (!bufferLecturas.length && !bufferEventos.length) return;
  volcando = true;

  const lecturas = bufferLecturas;
  const eventos = bufferEventos;
  bufferLecturas = [];
  bufferEventos = [];

  try {
    if (lecturas.length) await insertarLecturas(lecturas);
    if (eventos.length) await insertarEventos(eventos);
    espera = ESPERA_MIN_MS;
  } catch (e) {
    console.error(`[persistencia] fallo al insertar (${(e as Error).message}); reintento en ${espera} ms`);
    // Las filas vuelven al principio del buffer para conservar el orden temporal.
    bufferLecturas = [...lecturas, ...bufferLecturas];
    bufferEventos = [...eventos, ...bufferEventos];
    if (tamanoBuffer() > LIMITE_MEMORIA) {
      const l = bufferLecturas;
      const ev = bufferEventos;
      bufferLecturas = [];
      bufferEventos = [];
      await aDisco(l, ev).catch((err) => console.error('[persistencia] ni a disco:', err.message));
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
  const eventos: EventoPersistible[] = [];
  for (const linea of texto.split('\n')) {
    if (!linea.trim()) continue;
    try {
      const { tipo, dato } = JSON.parse(linea);
      if (tipo === 'lectura') lecturas.push(dato);
      else eventos.push(dato);
    } catch {
      /* línea truncada por un corte de luz: se ignora */
    }
  }
  try {
    if (lecturas.length) await insertarLecturas(lecturas);
    if (eventos.length) await insertarEventos(eventos);
    await fs.rm(PENDIENTES, { force: true });
    console.log(`[persistencia] reenviadas ${lecturas.length + eventos.length} filas pendientes`);
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
