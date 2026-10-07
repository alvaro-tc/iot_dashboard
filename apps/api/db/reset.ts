// pnpm db:reset — recrea el esquema, carga el seed, genera el historial de lecturas y eventos
// simulando cada sesión, y registra en Mosquitto las credenciales de los robots de demo.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_POR_DEFECTO, RobotSimulado, bateriaPct, type Configuracion } from '@iot/shared';
import { pool } from '../src/db.ts';
import { addDevice, syncBroker } from '../src/mqtt/broker-credentials.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PASO_MS = 50; // bucle de control, igual que el firmware
const TELEMETRIA_MS = 200; // una lectura publicada cada 200 ms

const c = await pool.connect();
try {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await c.query(`SET TIME ZONE '${tz.replace(/'/g, '')}'`);
  await c.query(await fs.readFile(path.join(dir, 'schema.sql'), 'utf8'));
  await c.query(await fs.readFile(path.join(dir, 'seed.sql'), 'utf8'));

  const { rows: sesiones } = await c.query<{
    id: number;
    dispositivo_id: string;
    iniciada_en: Date;
    finalizada_en: Date;
    distancia_evasion_cm: number;
    distancia_precaucion_cm: number;
    velocidad_base_pct: number;
    angulos_sensores: Configuracion['angulosSensores'];
    area_ancho_cm: number;
    area_alto_cm: number;
  }>(
    `SELECT s.id, s.dispositivo_id, s.iniciada_en, s.finalizada_en,
            cfg.distancia_evasion_cm, cfg.distancia_precaucion_cm, cfg.velocidad_base_pct,
            cfg.angulos_sensores, cfg.area_ancho_cm, cfg.area_alto_cm
     FROM sesiones s
     JOIN configuracion_dispositivo cfg ON cfg.dispositivo_id = s.dispositivo_id
     ORDER BY s.id`,
  );

  let totalLecturas = 0;
  let totalEventos = 0;

  for (const s of sesiones) {
    const config: Configuracion = {
      ...CONFIG_POR_DEFECTO,
      modo: 'automatico',
      distanciaEvasionCm: s.distancia_evasion_cm,
      distanciaPrecaucionCm: s.distancia_precaucion_cm,
      velocidadBasePct: s.velocidad_base_pct,
      angulosSensores: s.angulos_sensores,
      areaAnchoCm: s.area_ancho_cm,
      areaAltoCm: s.area_alto_cm,
    };
    // La semilla es el id de la sesión: cada db:reset genera exactamente el mismo historial.
    const robot = new RobotSimulado(config, { semilla: s.id * 101 });
    robot.reiniciar();

    const duracionMs = s.finalizada_en.getTime() - s.iniciada_en.getTime();
    const pasosPorLectura = TELEMETRIA_MS / PASO_MS;

    const col = {
      secuencia: [] as number[],
      izq: [] as (number | null)[],
      centro: [] as (number | null)[],
      der: [] as (number | null)[],
      estado: [] as string[],
      x: [] as number[],
      y: [] as number[],
      th: [] as number[],
      vi: [] as number[],
      vd: [] as number[],
      bv: [] as number[],
      pct: [] as number[],
      rssi: [] as number[],
      medido: [] as string[],
      recibido: [] as string[],
    };
    const eventos: { tipo: string; sensor: string | null; dist: number | null; x: number; y: number; msg: string; t: string }[] = [];
    let bateriaInicio: number | null = null;
    let ultimoObstaculoPorSensor: Record<string, number> = {};
    let avisadaBateriaBaja = false;

    for (let t = 0; t < duracionMs; t += PASO_MS) {
      robot.paso(PASO_MS);
      const evasion = robot.ultimaEvasion;
      const instante = s.iniciada_en.getTime() + t;

      if (evasion) {
        // Mismo antirrebote que TelemetriaService: no repetir el mismo sensor en menos de 3 s.
        const ultimo = ultimoObstaculoPorSensor[evasion.sensor] ?? -Infinity;
        if (instante - ultimo >= 3000) {
          ultimoObstaculoPorSensor[evasion.sensor] = instante;
          const tel = robot.telemetria(instante);
          robot.seq--; // telemetria() consume un seq; aquí solo se consultaba la pose
          eventos.push({
            tipo: 'obstaculo',
            sensor: evasion.sensor,
            dist: Math.round(evasion.distancia * 10) / 10,
            x: tel.x,
            y: tel.y,
            msg: `Obstáculo a ${evasion.distancia.toFixed(1)} cm (${evasion.sensor})`,
            t: new Date(instante).toISOString(),
          });
        }
      }

      if (t % TELEMETRIA_MS !== 0 || t / PASO_MS % pasosPorLectura !== 0) continue;

      const tel = robot.telemetria(instante);
      const pct = bateriaPct(tel.bv);
      bateriaInicio ??= pct;

      if (pct < 20 && !avisadaBateriaBaja) {
        avisadaBateriaBaja = true;
        eventos.push({
          tipo: 'bateria_baja',
          sensor: null,
          dist: null,
          x: tel.x,
          y: tel.y,
          msg: `Batería al ${pct} %`,
          t: new Date(instante).toISOString(),
        });
      }

      col.secuencia.push(tel.seq);
      col.izq.push(tel.d[0]);
      col.centro.push(tel.d[1]);
      col.der.push(tel.d[2]);
      col.estado.push(tel.e);
      col.x.push(tel.x);
      col.y.push(tel.y);
      col.th.push(tel.th);
      col.vi.push(tel.vi);
      col.vd.push(tel.vd);
      col.bv.push(tel.bv);
      col.pct.push(pct);
      col.rssi.push(tel.rssi);
      col.medido.push(new Date(instante).toISOString());
      // Latencia realista de la cadena MQTT -> backend: entre 25 y 115 ms.
      col.recibido.push(new Date(instante + 25 + Math.round(Math.random() * 90)).toISOString());
    }

    await c.query(
      `INSERT INTO lecturas (dispositivo_id, sesion_id, secuencia, dist_izq_cm, dist_centro_cm, dist_der_cm,
                             estado_movimiento, pos_x_cm, pos_y_cm, orientacion_deg, vel_izq_pct, vel_der_pct,
                             bateria_v, bateria_pct, rssi_dbm, medido_en, recibido_en, creado_en)
       SELECT $1, $2, * , recibido FROM unnest(
         $3::int[], $4::numeric[], $5::numeric[], $6::numeric[], $7::text[], $8::numeric[], $9::numeric[],
         $10::numeric[], $11::smallint[], $12::smallint[], $13::numeric[], $14::smallint[], $15::smallint[],
         $16::timestamptz[], $17::timestamptz[]
       ) AS t(secuencia, izq, centro, der, estado, x, y, th, vi, vd, bv, pct, rssi, medido, recibido)`,
      [
        s.dispositivo_id, s.id,
        col.secuencia, col.izq, col.centro, col.der, col.estado, col.x, col.y, col.th,
        col.vi, col.vd, col.bv, col.pct, col.rssi, col.medido, col.recibido,
      ],
    );

    if (eventos.length) {
      await c.query(
        `INSERT INTO eventos (dispositivo_id, sesion_id, tipo, sensor, distancia_cm, pos_x_cm, pos_y_cm, mensaje, creado_en)
         SELECT $1, $2, * FROM unnest($3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::numeric[], $8::text[], $9::timestamptz[])`,
        [
          s.dispositivo_id, s.id,
          eventos.map((e) => e.tipo), eventos.map((e) => e.sensor), eventos.map((e) => e.dist),
          eventos.map((e) => e.x), eventos.map((e) => e.y), eventos.map((e) => e.msg), eventos.map((e) => e.t),
        ],
      );
    }

    await c.query(
      `UPDATE sesiones SET total_lecturas = $2, total_evasiones = $3, distancia_recorrida_cm = $4,
                           bateria_inicio_pct = $5, bateria_fin_pct = $6
       WHERE id = $1`,
      [
        s.id,
        col.secuencia.length,
        eventos.filter((e) => e.tipo === 'obstaculo').length,
        Math.round(robot.distanciaRecorridaCm * 10) / 10,
        bateriaInicio,
        col.pct.at(-1) ?? bateriaInicio,
      ],
    );

    totalLecturas += col.secuencia.length;
    totalEventos += eventos.length;
  }

  console.log(
    `db: esquema y seed aplicados (${sesiones.length} sesiones, ${totalLecturas} lecturas, ${totalEventos} eventos, zona ${tz})`,
  );
} finally {
  c.release();
}

try {
  await addDevice('roomba-sala', 'SalaDemoToken0123456789abcdefgh');
  await addDevice('roomba-cocina', 'CocinaDemoToken0123456789abcdef');
  await addDevice('roomba-maria', 'MariaDemoToken0123456789abcdefg');
  await syncBroker(); // usuario de servicio + limpia passwd/acl de robots que ya no existen
  console.log('broker: credenciales de demo registradas');
} catch (e) {
  console.warn(`broker: no se pudo actualizar Mosquitto (${(e as Error).message}). ¿Está Mosquitto en marcha?`);
}
await pool.end();
