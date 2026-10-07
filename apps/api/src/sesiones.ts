// Sesiones de limpieza: una por ciclo de funcionamiento del robot.
//
// Se llevan en memoria mientras están vivas (distancia, evasiones, contador de lecturas) y
// solo se escriben en Postgres al abrirlas, al cerrarlas y en un volcado periódico. Así el
// camino en vivo no espera nunca a la base de datos.
import { pool } from './db.ts';

export interface SesionActiva {
  id: number;
  dispositivoId: string;
  iniciadaEn: number;
  totalLecturas: number;
  totalEvasiones: number;
  distanciaRecorridaCm: number;
  bateriaInicioPct: number | null;
  bateriaUltimaPct: number | null;
  /** Última pose vista, para integrar la distancia recorrida entre lecturas. */
  ultimaPose: { x: number; y: number } | null;
  /** Mayor `secuencia` recibida: con el total de lecturas da el porcentaje de pérdidas. */
  maxSecuencia: number;
  /** Marca del último mensaje recibido, para el barrido de sesiones inactivas. */
  ultimoMensaje: number;
}

const activas = new Map<string, SesionActiva>();

export const sesionActiva = (dispositivoId: string) => activas.get(dispositivoId) ?? null;

/**
 * Abre una sesión. Si la base ya tiene una abierta para ese robot (el backend se reinició
 * a media limpieza), se readopta en lugar de crear otra: el índice único
 * uniq_sesion_activa_por_dispositivo rechazaría la segunda.
 */
export async function abrirSesion(dispositivoId: string): Promise<SesionActiva> {
  const existente = activas.get(dispositivoId);
  if (existente) return existente;

  const { rows } = await pool.query<{ id: number; iniciada_en: Date; total_lecturas: number; total_evasiones: number; distancia_recorrida_cm: string; bateria_inicio_pct: number | null }>(
    `INSERT INTO sesiones (dispositivo_id) VALUES ($1)
     ON CONFLICT (dispositivo_id) WHERE finalizada_en IS NULL DO NOTHING
     RETURNING id, iniciada_en, total_lecturas, total_evasiones, distancia_recorrida_cm, bateria_inicio_pct`,
    [dispositivoId],
  );
  const fila =
    rows[0] ??
    (
      await pool.query(
        `SELECT id, iniciada_en, total_lecturas, total_evasiones, distancia_recorrida_cm, bateria_inicio_pct
         FROM sesiones WHERE dispositivo_id = $1 AND finalizada_en IS NULL`,
        [dispositivoId],
      )
    ).rows[0];

  const sesion: SesionActiva = {
    id: fila.id,
    dispositivoId,
    iniciadaEn: new Date(fila.iniciada_en).getTime(),
    totalLecturas: fila.total_lecturas ?? 0,
    totalEvasiones: fila.total_evasiones ?? 0,
    distanciaRecorridaCm: Number(fila.distancia_recorrida_cm ?? 0),
    bateriaInicioPct: fila.bateria_inicio_pct,
    bateriaUltimaPct: fila.bateria_inicio_pct,
    ultimaPose: null,
    maxSecuencia: 0,
    ultimoMensaje: Date.now(),
  };
  activas.set(dispositivoId, sesion);
  return sesion;
}

/** Vuelca los contadores en memoria a la fila de la sesión. */
async function volcar(s: SesionActiva, cerrar: boolean): Promise<void> {
  await pool.query(
    `UPDATE sesiones
     SET total_lecturas = $2, total_evasiones = $3, distancia_recorrida_cm = $4,
         bateria_inicio_pct = coalesce(bateria_inicio_pct, $5), bateria_fin_pct = $6,
         finalizada_en = CASE WHEN $7 THEN now() ELSE finalizada_en END
     WHERE id = $1`,
    [
      s.id,
      s.totalLecturas,
      s.totalEvasiones,
      Math.round(s.distanciaRecorridaCm * 10) / 10,
      s.bateriaInicioPct,
      s.bateriaUltimaPct,
      cerrar,
    ],
  );
}

export async function cerrarSesion(dispositivoId: string): Promise<SesionActiva | null> {
  const s = activas.get(dispositivoId);
  if (!s) {
    // Puede haber quedado abierta en la base de un arranque anterior.
    await pool.query(
      `UPDATE sesiones SET finalizada_en = now() WHERE dispositivo_id = $1 AND finalizada_en IS NULL`,
      [dispositivoId],
    );
    return null;
  }
  activas.delete(dispositivoId);
  await volcar(s, true);
  return s;
}

/** Volcado periódico: si el proceso muere de golpe, la sesión no pierde más de un minuto. */
export function arrancarVolcadoPeriodico(intervaloMs = 60_000): void {
  setInterval(() => {
    for (const s of activas.values()) {
      volcar(s, false).catch((e) => console.error('[sesiones] volcado:', (e as Error).message));
    }
  }, intervaloMs).unref();
}

export async function volcarTodas(): Promise<void> {
  await Promise.all([...activas.values()].map((s) => volcar(s, false).catch(() => {})));
}

/** Cierra las sesiones de un robot que lleva demasiado tiempo sin publicar nada. */
export function arrancarBarridoInactivas(timeoutMs: number, alCerrar: (dispositivoId: string) => void): void {
  setInterval(() => {
    for (const [id, s] of activas) {
      if (Date.now() - s.ultimoMensaje > timeoutMs) {
        cerrarSesion(id)
          .then(() => alCerrar(id))
          .catch((e) => console.error('[sesiones] barrido:', (e as Error).message));
      }
    }
  }, 15_000).unref();
}
