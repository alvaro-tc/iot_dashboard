// pnpm db:reset — recrea el esquema, carga el seed, genera el historial de lecturas
// simulando cada sesión, y registra en Mosquitto las credenciales de los robots de demo.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RobotSimulado, bateriaPorcentaje, type Configuracion } from '@iot/shared';
import { pool } from '../src/db.ts';
import { addDevice, syncBroker } from '../src/mqtt/broker-credentials.ts';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PASO_MS = 50; // bucle de control, igual que el firmware
const TELEMETRIA_MS = 500; // una lectura publicada cada 500 ms, igual que INTERVALO_MQTT_MS

const c = await pool.connect();
try {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await c.query(`SET TIME ZONE '${tz.replace(/'/g, '')}'`);
  await c.query(await fs.readFile(path.join(dir, 'schema.sql'), 'utf8'));
  await c.query(await fs.readFile(path.join(dir, 'vistas.sql'), 'utf8'));
  await c.query(await fs.readFile(path.join(dir, 'seed.sql'), 'utf8'));

  const { rows: sesiones } = await c.query<{
    id: number;
    dispositivo_id: string;
    iniciada_en: Date;
    finalizada_en: Date;
    velocidad_base: number;
    angulos_sensores: Configuracion['angulosSensores'];
  }>(
    `SELECT s.id, s.dispositivo_id, s.iniciada_en, s.finalizada_en,
            cfg.velocidad_base, cfg.angulos_sensores
     FROM sesiones s
     JOIN configuracion_dispositivo cfg ON cfg.dispositivo_id = s.dispositivo_id
     ORDER BY s.id`,
  );

  let totalLecturas = 0;

  for (const s of sesiones) {
    const config: Configuracion = {
      velocidadBase: s.velocidad_base,
      angulosSensores: s.angulos_sensores,
    };
    // La semilla es el id de la sesión: cada db:reset genera exactamente el mismo historial.
    const robot = new RobotSimulado(config, { semilla: s.id * 101 });
    robot.reiniciar();

    const duracionMs = s.finalizada_en.getTime() - s.iniciada_en.getTime();

    const col = {
      izquierda: [] as (number | null)[],
      central: [] as (number | null)[],
      derecha: [] as (number | null)[],
      movIzq: [] as number[],
      movDer: [] as number[],
      voltios: [] as number[],
      porcentaje: [] as number[],
      creado: [] as string[],
    };
    let bateriaInicio: number | null = null;

    for (let t = 0; t < duracionMs; t += PASO_MS) {
      robot.paso(PASO_MS);
      if (t % TELEMETRIA_MS !== 0) continue;

      const tel = robot.telemetria();
      const pct = bateriaPorcentaje(tel.bateria_v);
      bateriaInicio ??= pct;

      col.izquierda.push(tel.distancias_cm.izquierdo);
      col.central.push(tel.distancias_cm.central);
      col.derecha.push(tel.distancias_cm.derecho);
      col.movIzq.push(tel.motores.izquierda_pwm);
      col.movDer.push(tel.motores.derecha_pwm);
      col.voltios.push(tel.bateria_v);
      col.porcentaje.push(pct);
      col.creado.push(new Date(s.iniciada_en.getTime() + t).toISOString());
    }

    await c.query(
      `INSERT INTO lecturas (dispositivo_id, sesion_id, distancia_izquierda_cm, distancia_central_cm,
                             distancia_derecha_cm, movimiento_izquierda, movimiento_derecha,
                             bateria_voltios, bateria_porcentaje, creado_en)
       SELECT $1, $2, * FROM unnest(
         $3::numeric[], $4::numeric[], $5::numeric[], $6::smallint[], $7::smallint[],
         $8::numeric[], $9::smallint[], $10::timestamptz[])`,
      [
        s.dispositivo_id, s.id,
        col.izquierda, col.central, col.derecha, col.movIzq, col.movDer,
        col.voltios, col.porcentaje, col.creado,
      ],
    );

    await c.query(
      `UPDATE sesiones SET total_lecturas = $2, bateria_inicio_porcentaje = $3, bateria_fin_porcentaje = $4
       WHERE id = $1`,
      [s.id, col.creado.length, bateriaInicio, col.porcentaje.at(-1) ?? bateriaInicio],
    );

    totalLecturas += col.creado.length;
  }

  console.log(`db: esquema y seed aplicados (${sesiones.length} sesiones, ${totalLecturas} lecturas, zona ${tz})`);
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
