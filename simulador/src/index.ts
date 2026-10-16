// Simulador del robot: se comporta como el ESP32 sin necesitar hardware.
//
//   pnpm simular                       un robot (roomba-sala)
//   pnpm simular -- --robots 3         los tres robots del seed a la vez
//   pnpm simular -- --id roomba-cocina --token ...
//
// Publica en los mismos tópicos, con el mismo formato y el mismo Last Will que el firmware,
// y obedece la configuración que le llega retenida en `config`. La física la pone
// RobotSimulado de @iot/shared, el mismo módulo con el que db:reset genera el historial.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_POR_DEFECTO, RobotSimulado, SENSORES, topico, type Configuracion } from '@iot/shared';
import { config as cargarEnv } from 'dotenv';
import mqtt from 'mqtt';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
cargarEnv({ path: path.join(RAIZ, '.env'), quiet: true });

const PASO_MS = 50; // bucle de control, igual que el firmware
const TELEMETRIA_MS = 500; // igual que INTERVALO_MQTT_MS en firmware/configuracion.py
// Los mismos que firmware_beta/main.py: el backend ve exactamente el mismo caudal.
const MUESTRA_LIDAR_MS = 50;
const MUESTRAS_POR_LOTE = 20;
const VERSION_FIRMWARE = '1.2.0-sim';

/** Robots de demo que crea `pnpm db:reset`, con sus tokens. */
const DEMO = [
  { id: 'roomba-sala', token: 'SalaDemoToken0123456789abcdefgh' },
  { id: 'roomba-cocina', token: 'CocinaDemoToken0123456789abcdef' },
  { id: 'roomba-maria', token: 'MariaDemoToken0123456789abcdefg' },
];

function argumento(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Robot {
  id: string;
  token: string;
}

function robotsAEjecutar(): Robot[] {
  const id = argumento('id');
  if (id) return [{ id, token: argumento('token') ?? '' }];
  const n = Number(argumento('robots') ?? 1);
  return DEMO.slice(0, Math.max(1, Math.min(n, DEMO.length)));
}

/**
 * Fusiona la configuración que llega por MQTT, quedándose SOLO con lo que reconoce.
 *
 * Antes se hacía un spread a ciegas, y eso tiene un filo muy malo: `config` es un mensaje
 * RETENIDO, así que un payload de una versión anterior del proyecto se queda en el broker para
 * siempre. Uno de esos (con las claves viejas `{izq, centro, der}` en vez de
 * `{izquierdo, central, derecho}`) dejaba `angulosSensores.central` en undefined, el ángulo del
 * haz salía NaN y los TRES sensores devolvían null para siempre... sin un solo error en ningún
 * log. Costó un rato encontrarlo; validar aquí es más barato que volver a buscarlo.
 */
function fusionarConfig(actual: Configuracion, json: unknown): Configuracion {
  const entrante = (json ?? {}) as Record<string, unknown>;
  const salida: Configuracion = { ...actual };

  if (typeof entrante.velocidadBase === 'number' && Number.isFinite(entrante.velocidadBase)) {
    salida.velocidadBase = entrante.velocidadBase;
  }

  const angulos = entrante.angulosSensores as Record<string, unknown> | undefined;
  if (angulos && SENSORES.every((s) => typeof angulos[s] === 'number' && Number.isFinite(angulos[s]))) {
    salida.angulosSensores = {
      izquierdo: angulos.izquierdo as number,
      central: angulos.central as number,
      derecho: angulos.derecho as number,
    };
  } else if (angulos) {
    console.warn(`[config] angulosSensores no reconocido (${Object.keys(angulos).join(', ')}): se mantiene el anterior`);
  }

  return salida;
}

function arrancarRobot({ id, token }: Robot): void {
  const url = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
  const config: Configuracion = { ...CONFIG_POR_DEFECTO };
  // Semilla distinta por robot: tres simuladores a la vez no trazan el mismo recorrido.
  const sim = new RobotSimulado(config, { semilla: [...id].reduce((a, c) => a + c.charCodeAt(0), 0) });

  const cliente = mqtt.connect(url, {
    username: id,
    password: token,
    clientId: `sim-${id}-${process.pid}`,
    keepalive: 30,
    reconnectPeriod: 2000,
    // Last Will: si el simulador muere de golpe, Mosquitto avisa por él.
    will: {
      topic: topico(id, 'estado'),
      payload: JSON.stringify({ en_linea: false }),
      qos: 1,
      retain: true,
    },
  });

  let bucle: ReturnType<typeof setInterval> | null = null;
  let telemetria: ReturnType<typeof setInterval> | null = null;

  cliente.on('connect', () => {
    console.log(`[${id}] conectado a ${url}`);
    cliente.publish(topico(id, 'estado'), JSON.stringify({ en_linea: true, firmware: VERSION_FIRMWARE }), {
      qos: 1,
      retain: true,
    });
    cliente.subscribe(topico(id, 'config'), { qos: 1 });
    cliente.subscribe(topico(id, 'comando'), { qos: 1 }); // modo lidar
    publicarEstadoLidar(null);

    // El paso se mide con el reloj, no se da por supuesto: setInterval(50) despierta cada 60-70 ms
    // cuando el proceso tiene trabajo, y avanzar la fisica 50 ms mientras el reloj corre 65 hace
    // que el robot simulado gire mas despacio de lo que dicen sus propias marcas de tiempo. Eso
    // falseaba la calibracion del modo lidar en un 12% (medidos 51 grados/s donde la fisica daba
    // 58). El ESP32 no tiene ese desfase porque su fisica ES el tiempo real; aqui hay que medirlo.
    let ultimoPaso = Date.now();
    bucle ??= setInterval(() => {
      const ahora = Date.now();
      const dt = Math.min(500, ahora - ultimoPaso); // un paron largo no se integra de golpe
      ultimoPaso = ahora;
      if (dt > 0) sim.paso(dt);
      pasoLidar();
    }, PASO_MS);
    telemetria ??= setInterval(() => {
      if (!cliente.connected) return; // sin conexión la lectura se descarta, como en el ESP32
      cliente.publish(topico(id, 'telemetria'), JSON.stringify(sim.telemetria()), { qos: 0 });
    }, TELEMETRIA_MS);
  });

  // ---- Modo lidar (firmware_beta): obedece `comando` y sube lotes en `barrido` ----
  //
  // Mismo protocolo, mismos tópicos y mismo formato de muestras que el ESP32, así que el mapeo
  // del dashboard se prueba entero sin hardware. Lo único que no imita es el arranque por
  // reset: el simulador está siempre listo para los dos modos.
  const lidar = {
    accion: null as string | null,
    inicio: 0,
    duracion: 0,
    barrido: 0,
    lote: 0,
    muestras: [] as (number | null)[][],
    ultima: 0,
  };

  const publicarLote = (fin: boolean) => {
    if (!lidar.muestras.length && !fin) return;
    cliente.publish(
      topico(id, 'barrido'),
      JSON.stringify({
        barrido: lidar.barrido,
        lote: lidar.lote++,
        modo: lidar.accion ?? 'barrer',
        muestras: lidar.muestras,
        fin,
      }),
    );
    lidar.muestras = [];
  };

  const publicarEstadoLidar = (progreso: number | null) =>
    cliente.publish(
      topico(id, 'lidar'),
      JSON.stringify({
        estado: lidar.accion ?? 'inactivo',
        progreso,
        firmware: VERSION_FIRMWARE,
        bateria_porcentaje: null,
      }),
    );

  const pararLidar = () => {
    if (!lidar.accion) return;
    publicarLote(true);
    lidar.accion = null;
    sim.mando = { izq: 0, der: 0 };
    publicarEstadoLidar(null);
  };

  const ordenLidar = (orden: Record<string, unknown>) => {
    const accion = String(orden.accion ?? '');
    if (accion === 'parar') return pararLidar();

    const pwm = Math.max(0, Math.min(255, Number(orden.pwm ?? 150)));
    const sentido = Number(orden.sentido ?? 1) >= 0 ? 1 : -1;
    lidar.accion = accion;
    lidar.inicio = Date.now();
    lidar.duracion = Math.max(200, Math.min(40_000, Number(orden.ms ?? 4000)));
    lidar.barrido++;
    lidar.lote = 0;
    lidar.muestras = [];
    lidar.ultima = lidar.inicio;

    if (accion === 'barrer' || accion === 'calibrar_giro' || accion === 'girar') {
      // Girar sobre el eje: una rueda adelante y la otra atrás.
      sim.mando = { izq: pwm * sentido, der: -pwm * sentido };
    } else if (accion === 'avanzar' || accion === 'calibrar_avance') {
      sim.mando = { izq: pwm, der: pwm };
    } else if (accion === 'limpiar') {
      // Limpiando decide el robot, igual que navegacion.py en el firmware beta.
      sim.mando = null;
      sim.config = { ...sim.config, velocidadBase: pwm };
    }
    console.log(`[${id}] lidar: ${accion} ${lidar.duracion} ms (barrido ${lidar.barrido})`);
    publicarEstadoLidar(0);
  };

  const pasoLidar = () => {
    if (!lidar.accion) return;
    const ahora = Date.now();
    if (ahora - lidar.inicio >= lidar.duracion) return pararLidar();
    if (ahora - lidar.ultima < MUESTRA_LIDAR_MS) return;
    lidar.ultima = ahora;
    const d = sim.distancias();
    lidar.muestras.push([ahora - lidar.inicio, d.izquierdo, d.central, d.derecho]);
    if (lidar.muestras.length >= MUESTRAS_POR_LOTE) publicarLote(false);
    // El mismo corte que firmware_beta/main.py: el avance de calibracion se aborta antes
    // de empotrarse, y la pendiente ya esta medida en el tramo recorrido. Sin esto el simulador
    // se queda empujando la pared y las muestras planas del final estropean el ajuste.
    if (lidar.accion === 'calibrar_avance' && d.central !== null && d.central <= 25) pararLidar();
  };

  cliente.on('message', (topic, buf) => {
    let json: unknown;
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch {
      return; // mensaje ilegible: se mantiene lo que hubiera
    }
    if (topic === topico(id, 'config')) {
      sim.config = fusionarConfig(sim.config, json);
      console.log(`[${id}] config: velocidad base ${sim.config.velocidadBase}`);
      return;
    }
    if (topic === topico(id, 'comando') && json && typeof json === 'object') {
      ordenLidar(json as Record<string, unknown>);
    }
  });

  cliente.on('error', (e) => console.error(`[${id}]`, e.message));
  cliente.on('close', () => console.warn(`[${id}] desconectado; reintentando…`));

  const apagar = () => {
    if (bucle) clearInterval(bucle);
    if (telemetria) clearInterval(telemetria);
    cliente.publish(topico(id, 'estado'), JSON.stringify({ en_linea: false }), { qos: 1, retain: true }, () =>
      cliente.end(),
    );
  };
  process.on('SIGINT', apagar);
  process.on('SIGTERM', apagar);
}

const robots = robotsAEjecutar();
console.log(`simulador: arrancando ${robots.length} robot(s): ${robots.map((r) => r.id).join(', ')}`);
robots.forEach(arrancarRobot);
