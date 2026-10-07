// Lecturas, sesiones, eventos, configuración y estadísticas de un robot.
//
// Todo pasa por exigirPropiedad: un usuario solo ve sus robots, un admin los ve todos.
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.ts';
import { actualizarConfiguracion, configSchema, configuracionDe } from '../configuracion.ts';
import { pool } from '../db.ts';
import { HttpError, parse } from '../http.ts';
import { mqttConectado } from '../mqtt/bridge.ts';
import { tamanoBuffer } from '../persistencia.ts';
import { sesionActiva } from '../sesiones.ts';
import { mensajesPorSegundo } from '../telemetria.ts';
import { clientesConectados, emitirConfig } from '../ws.ts';
import { exigirPropiedad } from './dispositivos.ts';

export const datosRouter = Router();
datosRouter.use(requireAuth);

const LIMITE_FILAS = 5000;

const rangoSchema = z.object({
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
  agregacion: z.enum(['raw', 'minuto', 'hora']).default('raw'),
  limite: z.coerce.number().int().min(1).max(LIMITE_FILAS).default(1000),
});

const COLUMNAS_LECTURA = `secuencia, dist_izq_cm AS "distIzqCm", dist_centro_cm AS "distCentroCm",
  dist_der_cm AS "distDerCm", estado_movimiento AS "movimiento", pos_x_cm AS "posXCm", pos_y_cm AS "posYCm",
  orientacion_deg AS "orientacionDeg", vel_izq_pct AS "velIzqPct", vel_der_pct AS "velDerPct",
  bateria_v AS "bateriaV", bateria_pct AS "bateriaPct", rssi_dbm AS "rssiDbm",
  medido_en AS "medidoEn", recibido_en AS "recibidoEn", sesion_id AS "sesionId"`;

async function leerLecturas(dispositivoId: string, f: z.infer<typeof rangoSchema>) {
  const desde = f.desde ?? new Date(Date.now() - 3_600_000);
  const hasta = f.hasta ?? new Date();

  if (f.agregacion === 'raw') {
    const { rows } = await pool.query(
      `SELECT ${COLUMNAS_LECTURA} FROM lecturas
       WHERE dispositivo_id = $1 AND creado_en >= $2 AND creado_en < $3
       ORDER BY creado_en DESC LIMIT $4`,
      [dispositivoId, desde, hasta, f.limite],
    );
    return rows.reverse(); // el LIMIT toma las más recientes; se devuelven en orden temporal
  }

  const vista = f.agregacion === 'minuto' ? 'v_lecturas_por_minuto' : 'v_lecturas_por_hora';
  const columna = f.agregacion === 'minuto' ? 'minuto' : 'hora';
  const { rows } = await pool.query(
    `SELECT ${columna} AS instante, lecturas, min_izq_cm AS "minIzqCm", min_centro_cm AS "minCentroCm",
            min_der_cm AS "minDerCm", prom_izq_cm AS "promIzqCm", prom_centro_cm AS "promCentroCm",
            prom_der_cm AS "promDerCm", n_avanzando AS "nAvanzando", n_girando_izq AS "nGirandoIzq",
            n_girando_der AS "nGirandoDer", n_retrocediendo AS "nRetrocediendo", n_detenido AS "nDetenido",
            prom_bateria_pct AS "promBateriaPct", latencia_ms AS "latenciaMs"
     FROM ${vista}
     WHERE dispositivo_id = $1 AND ${columna} >= $2 AND ${columna} < $3
     ORDER BY ${columna}`,
    [dispositivoId, desde, hasta],
  );
  return rows;
}

datosRouter.get('/dispositivos/:id/lecturas', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  res.json(await leerLecturas(req.params.id, parse(rangoSchema, req.query)));
});

datosRouter.get('/dispositivos/:id/lecturas/export.csv', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  const filas = await leerLecturas(req.params.id, { ...parse(rangoSchema, req.query), limite: LIMITE_FILAS });
  if (!filas.length) {
    res.type('text/csv').send('');
    return;
  }
  const cabeceras = Object.keys(filas[0]);
  const escapar = (v: unknown) => {
    const s = v instanceof Date ? v.toISOString() : v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cabeceras.join(','), ...filas.map((f) => cabeceras.map((c) => escapar(f[c])).join(','))].join('\n');
  res.type('text/csv').attachment(`lecturas-${req.params.id}.csv`).send(csv);
});

// ---------- Sesiones ----------

datosRouter.get('/dispositivos/:id/sesiones', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  const { rows } = await pool.query(
    `SELECT sesion_id AS id, iniciada_en AS "iniciadaEn", finalizada_en AS "finalizadaEn",
            duracion_s AS "duracionS", distancia_recorrida_cm AS "distanciaCm", total_evasiones AS "evasiones",
            total_lecturas AS "lecturas", bateria_inicio_pct AS "bateriaInicioPct",
            bateria_fin_pct AS "bateriaFinPct", bateria_consumida_pct AS "bateriaConsumidaPct",
            pct_perdidas AS "pctPerdidas", latencia_ms AS "latenciaMs",
            n_avanzando AS "nAvanzando", n_girando_izq AS "nGirandoIzq", n_girando_der AS "nGirandoDer",
            n_retrocediendo AS "nRetrocediendo", n_detenido AS "nDetenido",
            evasiones_izq AS "evasionesIzq", evasiones_centro AS "evasionesCentro", evasiones_der AS "evasionesDer"
     FROM v_resumen_sesion WHERE dispositivo_id = $1
     ORDER BY (finalizada_en IS NULL) DESC, iniciada_en DESC LIMIT 100`,
    [req.params.id],
  );
  res.json(rows);
});

/** Comprueba que la sesión existe y que su robot es accesible para quien pregunta. */
async function sesionAccesible(sesionId: string, user: { id: number; role: string }): Promise<string> {
  const id = Number(sesionId);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Identificador de sesión inválido.');
  const { rows } = await pool.query<{ dispositivo_id: string }>('SELECT dispositivo_id FROM sesiones WHERE id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, 'La sesión no existe.');
  await exigirPropiedad(rows[0].dispositivo_id, user);
  return rows[0].dispositivo_id;
}

/** Trayectoria + obstáculos proyectados: lo que dibuja la repetición en el mapa. */
datosRouter.get('/sesiones/:id/mapa', async (req, res) => {
  await sesionAccesible(req.params.id, req.user);
  const maxPuntos = z.coerce.number().int().min(100).max(3000).catch(3000).parse(req.query.puntos);
  const { rows } = await pool.query('SELECT * FROM obtener_mapa_sesion($1, $2)', [Number(req.params.id), maxPuntos]);
  res.json(rows);
});

datosRouter.get('/sesiones/:id/lecturas', async (req, res) => {
  await sesionAccesible(req.params.id, req.user);
  const { rows } = await pool.query(
    `SELECT ${COLUMNAS_LECTURA} FROM lecturas WHERE sesion_id = $1 ORDER BY secuencia LIMIT ${LIMITE_FILAS}`,
    [Number(req.params.id)],
  );
  res.json(rows);
});

// ---------- Eventos ----------

datosRouter.get('/dispositivos/:id/eventos', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  const f = parse(
    z.object({
      tipo: z.enum(['obstaculo', 'atascado', 'bateria_baja', 'conexion', 'desconexion', 'cambio_modo']).optional(),
      sensor: z.enum(['izq', 'centro', 'der']).optional(),
      atendido: z.enum(['true', 'false']).optional(),
      pagina: z.coerce.number().int().min(1).default(1),
    }),
    req.query,
  );
  const porPagina = 50;
  const where: string[] = ['dispositivo_id = $1'];
  const params: unknown[] = [req.params.id];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.tipo) add('tipo = ?', f.tipo);
  if (f.sensor) add('sensor = ?', f.sensor);
  if (f.atendido) add('atendido = ?', f.atendido === 'true');

  const { rows } = await pool.query(
    `SELECT id, tipo, sensor, distancia_cm AS "distanciaCm", pos_x_cm AS "posXCm", pos_y_cm AS "posYCm",
            mensaje, atendido, creado_en AS "creadoEn", sesion_id AS "sesionId",
            count(*) OVER ()::int AS total
     FROM eventos WHERE ${where.join(' AND ')}
     ORDER BY creado_en DESC LIMIT ${porPagina} OFFSET ${(f.pagina - 1) * porPagina}`,
    params,
  );
  res.json({ total: rows[0]?.total ?? 0, pagina: f.pagina, porPagina, items: rows });
});

datosRouter.patch('/eventos/:id/atender', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Identificador inválido.');
  const { rows } = await pool.query<{ dispositivo_id: string }>('SELECT dispositivo_id FROM eventos WHERE id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, 'El evento no existe.');
  await exigirPropiedad(rows[0].dispositivo_id, req.user);
  const atendido = z.boolean().catch(true).parse(req.body?.atendido);
  await pool.query('UPDATE eventos SET atendido = $2 WHERE id = $1', [id, atendido]);
  res.json({ id, atendido });
});

// ---------- Configuración ----------

datosRouter.get('/dispositivos/:id/configuracion', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  res.json(await configuracionDe(req.params.id));
});

datosRouter.patch('/dispositivos/:id/configuracion', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  const cambio = parse(configSchema, req.body);
  try {
    const cfg = await actualizarConfiguracion(req.params.id, cambio);
    emitirConfig(req.params.id, cfg);
    res.json(cfg);
  } catch (e) {
    const campo = (e as { campo?: string }).campo;
    if (campo) throw new HttpError(400, 'Revisa los campos marcados.', { [campo]: (e as Error).message });
    throw e;
  }
});

// ---------- Estadísticas ----------

datosRouter.get('/dispositivos/:id/resumen', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  const { rows } = await pool.query(
    `SELECT
       (SELECT coalesce(sum(duracion_s), 0) FROM v_resumen_sesion
         WHERE dispositivo_id = $1 AND iniciada_en >= date_trunc('day', now()))      AS "segundosHoy",
       (SELECT coalesce(sum(distancia_recorrida_cm), 0) FROM sesiones
         WHERE dispositivo_id = $1 AND iniciada_en >= date_trunc('day', now()))      AS "distanciaHoyCm",
       (SELECT count(*)::int FROM eventos
         WHERE dispositivo_id = $1 AND tipo = 'obstaculo' AND sensor = 'izq'
           AND creado_en >= date_trunc('day', now()))                                AS "evasionesIzq",
       (SELECT count(*)::int FROM eventos
         WHERE dispositivo_id = $1 AND tipo = 'obstaculo' AND sensor = 'centro'
           AND creado_en >= date_trunc('day', now()))                                AS "evasionesCentro",
       (SELECT count(*)::int FROM eventos
         WHERE dispositivo_id = $1 AND tipo = 'obstaculo' AND sensor = 'der'
           AND creado_en >= date_trunc('day', now()))                                AS "evasionesDer",
       (SELECT avg(EXTRACT(EPOCH FROM (recibido_en - medido_en)) * 1000) FROM lecturas
         WHERE dispositivo_id = $1 AND creado_en >= now() - interval '5 minutes')     AS "latenciaMs",
       (SELECT bateria_pct FROM lecturas WHERE dispositivo_id = $1
         ORDER BY creado_en DESC LIMIT 1)                                             AS "bateriaPct",
       (SELECT json_build_object(
                 'avanzando',     coalesce(sum(n_avanzando), 0),
                 'girando_izq',   coalesce(sum(n_girando_izq), 0),
                 'girando_der',   coalesce(sum(n_girando_der), 0),
                 'retrocediendo', coalesce(sum(n_retrocediendo), 0),
                 'detenido',      coalesce(sum(n_detenido), 0))
         FROM v_resumen_sesion WHERE dispositivo_id = $1
           AND iniciada_en >= date_trunc('day', now()))                               AS "movimientos"`,
    [req.params.id],
  );

  const sesion = sesionActiva(req.params.id);
  res.json({
    ...rows[0],
    mensajesPorSegundo: mensajesPorSegundo(req.params.id),
    sesion: sesion && {
      id: sesion.id,
      iniciadaEn: sesion.iniciadaEn,
      lecturas: sesion.totalLecturas,
      evasiones: sesion.totalEvasiones,
      distanciaCm: Math.round(sesion.distanciaRecorridaCm * 10) / 10,
      // Huecos en `secuencia`: lo que se perdió por el camino desde el robot.
      pctPerdidas:
        sesion.maxSecuencia > 0
          ? Math.max(0, Math.round((1 - sesion.totalLecturas / sesion.maxSecuencia) * 1000) / 10)
          : 0,
    },
  });
});

datosRouter.get('/salud', async (_req, res) => {
  let postgres = true;
  try {
    await pool.query('SELECT 1');
  } catch {
    postgres = false;
  }
  res.json({
    ok: postgres && mqttConectado(),
    postgres,
    mosquitto: mqttConectado(),
    bufferPersistencia: tamanoBuffer(),
    clientesWebSocket: clientesConectados(),
  });
});
