// Preferencias de interfaz de cada usuario: tema y panel (widgets, disposición y sus ajustes).
//
// El backend no interpreta el contenido: cada valor es la misma cadena que el navegador ya
// guardaba en localStorage, y es el navegador el que la valida al leerla (una preferencia de
// una versión vieja no puede romper nada). Aquí solo se comprueba que la clave sea una de las
// conocidas y que el tamaño sea razonable: es un dato que escribe el cliente.
//
// Lo que sí resuelve el servidor es el conflicto entre dispositivos: cada valor se guarda con
// la hora de su última edición y una escritura más vieja que la guardada se rechaza. Así un
// dispositivo que llevaba días sin conexión no pisa al conectarse el cambio de ayer, que es lo
// que pasaría guardando por orden de llegada.
import { pool } from './db.ts';

/** Claves que el navegador sincroniza. Fuera de esta lista no se guarda nada. */
const CLAVES = new Set(['tema', 'panel']);
const MAX_BYTES = 64 * 1024;
/** Margen de reloj que se le tolera al cliente: una hora futura congelaría la preferencia. */
const MARGEN_FUTURO_MS = 60_000;

/** Un valor con la hora (ms del reloj del servidor) en que se editó. */
export interface Entrada {
  valor: string;
  ts: number;
}

export type Preferencias = Record<string, Entrada>;

/** Acepta la forma vieja (el valor pelado, sin hora): cuenta como hora desconocida. */
const normalizar = (crudo: unknown): Entrada | null => {
  if (typeof crudo === 'string') return { valor: crudo, ts: 0 };
  const e = crudo as Partial<Entrada> | null;
  if (!e || typeof e.valor !== 'string') return null;
  return { valor: e.valor, ts: typeof e.ts === 'number' ? e.ts : 0 };
};

export async function preferenciasDe(usuarioId: number): Promise<Preferencias> {
  const { rows } = await pool.query<{ datos: Record<string, unknown> }>(
    'SELECT datos FROM preferencias_usuario WHERE usuario_id = $1',
    [usuarioId],
  );
  const prefs: Preferencias = {};
  for (const [clave, crudo] of Object.entries(rows[0]?.datos ?? {})) {
    const e = normalizar(crudo);
    if (e) prefs[clave] = e;
  }
  return prefs;
}

/**
 * Guarda una clave sin tocar las demás, solo si la copia guardada es más vieja.
 *
 * Devuelve null si la clave o el valor no valen, y si no, quién ha ganado: `guardado` dice si
 * ha sido esta escritura, y `entrada` es la que queda vigente (la propia o la que ya había).
 */
export async function guardarPreferencia(
  usuarioId: number,
  clave: unknown,
  valor: unknown,
  ts: unknown,
): Promise<{ guardado: boolean; entrada: Entrada } | null> {
  if (typeof clave !== 'string' || !CLAVES.has(clave)) return null;
  if (typeof valor !== 'string' || Buffer.byteLength(valor) > MAX_BYTES) return null;
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts < 0) return null;
  // Un cliente con el reloj adelantado (o maleducado) no puede dejar su valor intocable.
  const hora = Math.min(Math.trunc(ts), Date.now() + MARGEN_FUTURO_MS);

  // El WHERE del UPDATE hace la comparación dentro de la misma sentencia: dos dispositivos
  // escribiendo a la vez no pueden colarse entre el SELECT y el UPDATE.
  const { rows } = await pool.query<{ entrada: unknown }>(
    `INSERT INTO preferencias_usuario (usuario_id, datos)
     VALUES ($1, jsonb_build_object($2::text, jsonb_build_object('valor', $3::text, 'ts', $4::bigint)))
     ON CONFLICT (usuario_id) DO UPDATE
       SET datos = preferencias_usuario.datos
                   || jsonb_build_object($2::text, jsonb_build_object('valor', $3::text, 'ts', $4::bigint)),
           actualizado_en = now()
       WHERE coalesce(
               CASE WHEN jsonb_typeof(preferencias_usuario.datos -> $2) = 'object'
                    THEN (preferencias_usuario.datos -> $2 ->> 'ts')::bigint END,
               0  -- sin guardar, o guardado con la forma vieja sin hora: pierde
             ) < $4::bigint
     RETURNING datos -> $2 AS entrada`,
    [usuarioId, clave, valor, hora],
  );
  if (rows[0]) return { guardado: true, entrada: normalizar(rows[0].entrada) ?? { valor, ts: hora } };

  // No se guardó: la copia del servidor es igual de nueva o más. Se devuelve para que el
  // dispositivo que ha perdido se ponga al día en vez de quedarse con lo suyo.
  const vigente = (await preferenciasDe(usuarioId))[clave];
  return { guardado: false, entrada: vigente ?? { valor, ts: hora } };
}
