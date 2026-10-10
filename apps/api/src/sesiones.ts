// Sesiones de funcionamiento: una por ciclo de actividad del robot.
//
// Se abren con la primera lectura que llega y se cierran cuando el robot se desconecta o
// deja de publicar (presencia.ts y el barrido de inactivas). Los contadores se llevan en
// memoria y solo se escriben en Postgres al abrir, al cerrar y en un volcado periódico, así
// el camino en vivo no espera nunca a la base de datos.
import { pool } from './db.ts';

export interface SesionActiva {
  id: number;
  dispositivoId: string;
  iniciadaEn: number;
  totalLecturas: number;
  bateriaInicioPorcentaje: number | null;
  bateriaUltimaPorcentaje: number | null;
  /** Marca del último mensaje recibido, para el barrido de sesiones inactivas. */
  ultimoMensaje: number;
}

const activas = new Map<string, SesionActiva>();

export const sesionActiva = (dispositivoId: string) => activas.get(dispositivoId) ?? null;

/**
 * Abre una sesión. Si la base ya tiene una abierta para ese robot (el backend se reinició
 * a media sesión), se readopta en lugar de crear otra: el índice único
 * uniq_sesion_activa_por_dispositivo rechazaría la segunda.
 */
export async function abrirSesion(dispositivoId: string): Promise<SesionActiva> {
  const existente = activas.get(dispositivoId);
  if (existente) return existente;

  const { rows } = await pool.query<{
    id: number;
    iniciada_en: Date;
    total_lecturas: number;
    bateria_inicio_porcentaje: number | null;
  }>(
    `INSERT INTO sesiones (dispositivo_id) VALUES ($1)
     ON CONFLICT (dispositivo_id) WHERE finalizada_en IS NULL DO NOTHING
     RETURNING id, iniciada_en, total_lecturas, bateria_inicio_porcentaje`,
    [dispositivoId],
  );
  const fila =
    rows[0] ??
    (
      await pool.query(
        `SELECT id, iniciada_en, total_lecturas, bateria_inicio_porcentaje
         FROM sesiones WHERE dispositivo_id = $1 AND finalizada_en IS NULL`,
        [dispositivoId],
      )
    ).rows[0];

  const sesion: SesionActiva = {
    id: fila.id,
    dispositivoId,
    iniciadaEn: new Date(fila.iniciada_en).getTime(),
    totalLecturas: fila.total_lecturas ?? 0,
    bateriaInicioPorcentaje: fila.bateria_inicio_porcentaje,
    bateriaUltimaPorcentaje: fila.bateria_inicio_porcentaje,
    ultimoMensaje: Date.now(),
  };
  activas.set(dispositivoId, sesion);
  return sesion;
}

/** Vuelca los contadores en memoria a la fila de la sesión. */
async function volcar(s: SesionActiva, cerrar: boolean): Promise<void> {
  await pool.query(
    `UPDATE sesiones
     SET total_lecturas = $2,
         bateria_inicio_porcentaje = coalesce(bateria_inicio_porcentaje, $3),
         bateria_fin_porcentaje = $4,
         finalizada_en = CASE WHEN $5 THEN now() ELSE finalizada_en END
     WHERE id = $1`,
    [s.id, s.totalLecturas, s.bateriaInicioPorcentaje, s.bateriaUltimaPorcentaje, cerrar],
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
