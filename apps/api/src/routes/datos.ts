// Lecturas, sesiones, configuración y estadísticas de un robot.
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

const COLUMNAS_LECTURA = `id,
  distancia_izquierda_cm AS "distanciaIzquierdaCm",
  distancia_central_cm   AS "distanciaCentralCm",
  distancia_derecha_cm   AS "distanciaDerechaCm",
  movimiento_izquierda   AS "movimientoIzquierda",
  movimiento_derecha     AS "movimientoDerecha",
  bateria_voltios        AS "bateriaVoltios",
  bateria_porcentaje     AS "bateriaPorcentaje",
  creado_en              AS "creadoEn",
  sesion_id              AS "sesionId"`;

const COLUMNAS_AGREGADO = `lecturas,
  min_izquierda_cm        AS "minIzquierdaCm",
  min_central_cm          AS "minCentralCm",
  min_derecha_cm          AS "minDerechaCm",
  prom_izquierda_cm       AS "promIzquierdaCm",
  prom_central_cm         AS "promCentralCm",
  prom_derecha_cm         AS "promDerechaCm",
  prom_pwm_izquierda      AS "promPwmIzquierda",
  prom_pwm_derecha        AS "promPwmDerecha",
  lecturas_en_marcha      AS "lecturasEnMarcha",
  lecturas_detenido       AS "lecturasDetenido",
  prom_bateria_porcentaje AS "promBateriaPorcentaje"`;

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

  const porMinuto = f.agregacion === 'minuto';
  const vista = porMinuto ? 'v_lecturas_por_minuto' : 'v_lecturas_por_hora';
  const columna = porMinuto ? 'minuto' : 'hora';
  // Las columnas `cerca_*` solo existen en la vista por hora.
  const cerca = porMinuto
    ? ''
    : `, cerca_izquierda AS "cercaIzquierda", cerca_central AS "cercaCentral", cerca_derecha AS "cercaDerecha"`;
  const { rows } = await pool.query(
    `SELECT ${columna} AS instante, ${COLUMNAS_AGREGADO}${cerca}
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

datosRouter.get('/sesiones/:id/lecturas', async (req, res) => {
  await sesionAccesible(req.params.id, req.user);
  const { rows } = await pool.query(
    `SELECT ${COLUMNAS_LECTURA} FROM lecturas WHERE sesion_id = $1 ORDER BY creado_en LIMIT ${LIMITE_FILAS}`,
    [Number(req.params.id)],
  );
  res.json(rows);
});

// ---------- Configuración ----------

datosRouter.get('/dispositivos/:id/configuracion', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  res.json(await configuracionDe(req.params.id));
});

datosRouter.patch('/dispositivos/:id/configuracion', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  const cambio = parse(configSchema, req.body);
  const cfg = await actualizarConfiguracion(req.params.id, cambio);
  emitirConfig(req.params.id, cfg);
  res.json(cfg);
});

// ---------- Estadísticas ----------

datosRouter.get('/dispositivos/:id/resumen', async (req, res) => {
  await exigirPropiedad(req.params.id, req.user);
  const { rows } = await pool.query(
    `SELECT
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
         ORDER BY creado_en DESC LIMIT 1)                                            AS "bateriaVoltios"`,
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
      bateriaInicioPorcentaje: sesion.bateriaInicioPorcentaje,
      bateriaPorcentaje: sesion.bateriaUltimaPorcentaje,
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
