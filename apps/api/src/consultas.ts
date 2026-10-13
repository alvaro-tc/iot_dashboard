// Las consultas de lectura que el dashboard necesita, en un solo sitio.
//
// Cada una devuelve exactamente lo que sirve su endpoint REST. Así el push por WebSocket
// (ws.ts -> evento `datos`) y el GET de toda la vida calculan lo mismo: el navegador puede
// meter lo que llega por el socket en la caché de react-query sin volver a preguntar.
import { PWM_ACTIVO } from '@iot/shared';
import { pool } from './db.ts';
import { sesionActiva } from './sesiones.ts';
import { mensajesPorSegundo } from './telemetria.ts';

export const COLUMNAS_DISPOSITIVO = `id, usuario_id AS "userId", nombre, ubicacion,
  revocado AS "isRevoked", en_linea AS "enLinea", ultimo_contacto AS "ultimoContacto",
  version_firmware AS "versionFirmware", creado_en AS "creadoEn"`;

/** Robots visibles para quien pregunta: los suyos, o todos si es admin. */
export async function listaDispositivos(user: { id: number; role: string }) {
  const { rows } = await pool.query(
    `SELECT ${COLUMNAS_DISPOSITIVO},
            (SELECT count(*)::int FROM sesiones s WHERE s.dispositivo_id = d.id) AS "totalSesiones",
            (SELECT l.bateria_porcentaje FROM lecturas l WHERE l.dispositivo_id = d.id
             ORDER BY l.creado_en DESC LIMIT 1) AS "bateriaPct"
     FROM dispositivos d
     WHERE ($1 = 'admin' OR usuario_id = $2) AND NOT revocado
     ORDER BY creado_en`,
    [user.role, user.id],
  );
  return rows;
}

/** Toda la flota, con su dueño. Solo para admin. */
export async function flotaRobots() {
  const { rows } = await pool.query(
    `SELECT ${COLUMNAS_DISPOSITIVO}, u.nombre AS "usuario", u.correo AS "usuarioEmail",
            (SELECT count(*)::int FROM sesiones s WHERE s.dispositivo_id = d.id) AS "totalSesiones"
     FROM dispositivos d JOIN usuarios u ON u.id = d.usuario_id
     ORDER BY d.revocado, d.creado_en DESC`,
  );
  return rows;
}

/** Totales de la instalación y sesiones abiertas ahora mismo. Solo para admin. */
export async function resumenFlota() {
  const [totales, activos] = await Promise.all([
    pool.query(
      `SELECT (SELECT count(*) FROM usuarios WHERE rol = 'cliente')::int            AS clientes,
              (SELECT count(*) FROM dispositivos WHERE NOT revocado)::int      AS robots,
              (SELECT count(*) FROM dispositivos WHERE en_linea
                                               AND NOT revocado)::int          AS "robotsEnLinea",
              (SELECT count(*) FROM sesiones
                WHERE iniciada_en >= date_trunc('day', now()))::int              AS "sesionesHoy",
              (SELECT count(*) FROM sesiones WHERE finalizada_en IS NULL)::int   AS "sesionesActivas"`,
    ),
    pool.query(
      `SELECT s.id AS "sesionId", s.dispositivo_id AS "dispositivoId", d.nombre, u.nombre AS "usuario",
              s.iniciada_en AS "iniciadaEn", s.total_lecturas AS "lecturas"
       FROM sesiones s
       JOIN dispositivos d ON d.id = s.dispositivo_id
       JOIN usuarios u ON u.id = d.usuario_id
       WHERE s.finalizada_en IS NULL ORDER BY s.iniciada_en`,
    ),
  ]);
  return { ...totales.rows[0], sesionesEnCurso: activos.rows };
}

/** Cuentas con sus contadores. Solo para admin. */
export async function listaUsuarios() {
  const { rows } = await pool.query(
    `SELECT u.id, u.correo AS email, u.nombre AS name, u.rol AS role,
            u.activo AS "isActive", u.lidar_habilitado AS "lidarHabilitado", u.creado_en AS "createdAt",
            (SELECT count(*)::int FROM dispositivos d
              WHERE d.usuario_id = u.id AND NOT d.revocado)                        AS "robots",
            (SELECT count(*)::int FROM sesiones s JOIN dispositivos d ON d.id = s.dispositivo_id
              WHERE d.usuario_id = u.id)                                             AS "sesiones",
            (SELECT max(d.ultimo_contacto) FROM dispositivos d WHERE d.usuario_id = u.id) AS "ultimaActividad"
     FROM usuarios u ORDER BY u.rol, u.nombre`,
  );
  return rows;
}

/** Últimas 100 sesiones de un robot, la abierta primero. */
export async function sesionesDe(dispositivoId: string) {
  const { rows } = await pool.query(
    `SELECT sesion_id AS id, iniciada_en AS "iniciadaEn", finalizada_en AS "finalizadaEn",
            duracion_s AS "duracionS", total_lecturas AS "lecturas",
            bateria_inicio_porcentaje AS "bateriaInicioPorcentaje",
            bateria_fin_porcentaje AS "bateriaFinPorcentaje",
            bateria_consumida_porcentaje AS "bateriaConsumidaPorcentaje",
            lecturas_en_marcha AS "lecturasEnMarcha", lecturas_detenido AS "lecturasDetenido",
            prom_pwm_izquierda AS "promPwmIzquierda", prom_pwm_derecha AS "promPwmDerecha",
            min_izquierda_cm AS "minIzquierdaCm", min_central_cm AS "minCentralCm",
            min_derecha_cm AS "minDerechaCm",
            cerca_izquierda AS "cercaIzquierda", cerca_central AS "cercaCentral",
            cerca_derecha AS "cercaDerecha"
     FROM v_resumen_sesion WHERE dispositivo_id = $1
     ORDER BY (finalizada_en IS NULL) DESC, iniciada_en DESC LIMIT 100`,
    [dispositivoId],
  );
  return rows;
}

/** Acumulados del robot (hoy y de toda su vida) más la sesión que tiene abierta. */
export async function resumenDe(dispositivoId: string) {
  const { rows } = await pool.query(
    `WITH total AS (
       -- Acumulado de toda la vida del robot, en una sola pasada por sus lecturas. El tiempo
       -- de cada motor por separado solo se puede contar aqui: la vista de sesion agrega el
       -- PWM de las dos ruedas juntas.
       -- ponytail: cuenta todas las lecturas del robot en cada peticion; si la tabla crece a
       -- millones, acumular por sesion en v_resumen_sesion.
       SELECT count(*) FILTER (WHERE abs(movimiento_izquierda) >= $2
                                  OR abs(movimiento_derecha)   >= $2) AS marcha,
              count(*) FILTER (WHERE abs(movimiento_izquierda) >= $2) AS izquierda,
              count(*) FILTER (WHERE abs(movimiento_derecha)   >= $2) AS derecha
       FROM lecturas WHERE dispositivo_id = $1
     )
     SELECT
       (SELECT coalesce(sum(duracion_s), 0) FROM v_resumen_sesion
         WHERE dispositivo_id = $1 AND iniciada_en >= date_trunc('day', now()))      AS "segundosHoy",
       (SELECT coalesce(sum(lecturas_en_marcha), 0) FROM v_resumen_sesion
         WHERE dispositivo_id = $1 AND iniciada_en >= date_trunc('day', now()))      AS "lecturasEnMarchaHoy",
       (SELECT coalesce(sum(lecturas_detenido), 0) FROM v_resumen_sesion
         WHERE dispositivo_id = $1 AND iniciada_en >= date_trunc('day', now()))      AS "lecturasDetenidoHoy",
       (SELECT coalesce(sum(cerca_izquierda), 0) FROM v_resumen_sesion
         WHERE dispositivo_id = $1 AND iniciada_en >= date_trunc('day', now()))      AS "cercaIzquierda",
       (SELECT coalesce(sum(cerca_central), 0) FROM v_resumen_sesion
         WHERE dispositivo_id = $1 AND iniciada_en >= date_trunc('day', now()))      AS "cercaCentral",
       (SELECT coalesce(sum(cerca_derecha), 0) FROM v_resumen_sesion
         WHERE dispositivo_id = $1 AND iniciada_en >= date_trunc('day', now()))      AS "cercaDerecha",
       (SELECT bateria_porcentaje FROM lecturas WHERE dispositivo_id = $1
         ORDER BY creado_en DESC LIMIT 1)                                            AS "bateriaPorcentaje",
       (SELECT bateria_voltios FROM lecturas WHERE dispositivo_id = $1
         ORDER BY creado_en DESC LIMIT 1)                                            AS "bateriaVoltios",
       (SELECT coalesce(sum(duracion_s), 0) FROM v_resumen_sesion
         WHERE dispositivo_id = $1)                                                 AS "segundosTotal",
       total.marcha                                                                 AS "lecturasEnMarchaTotal",
       total.izquierda                                                              AS "lecturasMarchaIzquierdaTotal",
       total.derecha                                                                AS "lecturasMarchaDerechaTotal"
     FROM total`,
    [dispositivoId, PWM_ACTIVO],
  );

  const sesion = sesionActiva(dispositivoId);
  return {
    ...rows[0],
    mensajesPorSegundo: mensajesPorSegundo(dispositivoId),
    sesion: sesion && {
      id: sesion.id,
      iniciadaEn: sesion.iniciadaEn,
      lecturas: sesion.totalLecturas,
      bateriaInicioPorcentaje: sesion.bateriaInicioPorcentaje,
      bateriaPorcentaje: sesion.bateriaUltimaPorcentaje,
    },
  };
}
