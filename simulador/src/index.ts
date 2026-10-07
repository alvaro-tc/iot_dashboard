// Simulador del robot: se comporta como el ESP32 sin necesitar hardware.
//
//   pnpm simular                       un robot (roomba-sala)
//   pnpm simular -- --robots 3         los tres robots del seed a la vez
//   pnpm simular -- --id roomba-cocina --token ...
//
// Publica en los mismos tópicos, con el mismo formato, el mismo Last Will y responde a
// `cmd` y `config` igual que el firmware. La física la pone RobotSimulado de @iot/shared,
// el mismo módulo con el que db:reset genera el historial.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_POR_DEFECTO, RobotSimulado, topico, type Configuracion } from '@iot/shared';
import { config as cargarEnv } from 'dotenv';
import mqtt from 'mqtt';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
cargarEnv({ path: path.join(RAIZ, '.env'), quiet: true });

const PASO_MS = 50; // bucle de control, igual que el firmware
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

function arrancarRobot({ id, token }: Robot): void {
  const url = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
  let config: Configuracion = { ...CONFIG_POR_DEFECTO };
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
  /** Lecturas guardadas mientras no hay conexión, submuestreadas a 1 por segundo. */
  const diferidas: unknown[] = [];
  let ultimaDiferida = 0;

  const publicarTelemetria = () => {
    const t = sim.telemetria(Date.now());
    if (cliente.connected) {
      cliente.publish(topico(id, 'telemetria'), JSON.stringify(t), { qos: 0 });
    } else if (Date.now() - ultimaDiferida >= 1000) {
      ultimaDiferida = Date.now();
      diferidas.push(t);
      if (diferidas.length > 100) diferidas.shift(); // igual que el firmware: tope de 100
    }
  };

  const reprogramarTelemetria = () => {
    if (telemetria) clearInterval(telemetria);
    telemetria = setInterval(publicarTelemetria, config.intervaloTelemetriaMs);
  };

  cliente.on('connect', () => {
    console.log(`[${id}] conectado a ${url}`);
    cliente.publish(topico(id, 'estado'), JSON.stringify({ en_linea: true, firmware: VERSION_FIRMWARE }), {
      qos: 1,
      retain: true,
    });
    cliente.subscribe([topico(id, 'cmd'), topico(id, 'config')], { qos: 1 });

    if (diferidas.length) {
      cliente.publish(topico(id, 'telemetria/lote'), JSON.stringify(diferidas), { qos: 1 });
      console.log(`[${id}] reenviadas ${diferidas.length} lecturas diferidas`);
      diferidas.length = 0;
    }

    bucle ??= setInterval(() => sim.paso(PASO_MS), PASO_MS);
    reprogramarTelemetria();
  });

  cliente.on('message', (topic, buf) => {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch {
      return;
    }

    if (topic === topico(id, 'config')) {
      const anterior = config.intervaloTelemetriaMs;
      config = { ...config, ...(json as Partial<Configuracion>) };
      sim.config = config;
      if (config.intervaloTelemetriaMs !== anterior) reprogramarTelemetria();
      console.log(`[${id}] config: modo=${config.modo} evasión=${config.distanciaEvasionCm}cm`);
      return;
    }

    if (topic === topico(id, 'cmd')) {
      const accion = json.accion as string;
      if (accion === 'iniciar') {
        config.modo = 'automatico';
        sim.reiniciar(); // nueva sesión: odometría y seq a cero
      } else if (accion === 'pausar') config.modo = 'pausado';
      else if (accion === 'detener') config.modo = 'detenido';
      sim.config = config;
      cliente.publish(topico(id, 'cmd/ack'), JSON.stringify({ id: json.id, accion }), { qos: 1 });
      console.log(`[${id}] cmd ${accion}`);
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
console.log('           el robot arranca DETENIDO; dale a iniciar desde el dashboard.');
robots.forEach(arrancarRobot);
