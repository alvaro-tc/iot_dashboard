// Puente MQTT -> telemetría -> WebSocket -> Postgres.
//
//   ESP32 / simulador --publish--> Mosquitto (ACL por robot)
//        --roomba/{id}/telemetria--> este puente (usuario de servicio, suscrito a roomba/#)
//        --zod--> telemetria.procesar (emite por Socket.IO AL INSTANTE)
//        --> buffer de persistencia --lote cada 1 s--> Postgres
//
// Reglas:
//   - Nada que llegue por MQTT puede tumbar el proceso: todo error se loguea y se descarta.
//   - Los mensajes de un mismo robot se procesan en orden de llegada (una cola por robot).
//     Procesándolos en paralelo, la lectura 6 podría confirmarse antes que la 5 y la 5
//     parecería un reinicio de sesión, partiendo la sesión en dos.
//   - Reconexión con espera exponencial: 1 s, 2 s, 4 s… hasta 30 s; vuelve a 1 s al conectar.
import { PREFIJO, parseTopico } from '@iot/shared';
import mqtt from 'mqtt';
import { z } from 'zod';
import { recibirAck } from '../comandos.ts';
import { env } from '../env.ts';
import { marcarPresencia } from '../presencia.ts';
import { procesarTelemetria, registrarEvento, telemetriaSchema } from '../telemetria.ts';

const MIN_ESPERA = 1_000;
const MAX_ESPERA = 30_000;

const estadoSchema = z.object({ en_linea: z.boolean(), firmware: z.string().max(32).optional() });
const eventoSchema = z.object({
  tipo: z.enum(['obstaculo', 'atascado', 'bateria_baja', 'conexion', 'desconexion', 'cambio_modo']),
  sensor: z.enum(['izq', 'centro', 'der']).nullish(),
  distancia_cm: z.number().nullish(),
  mensaje: z.string().max(200).default(''),
});

let client: mqtt.MqttClient | null = null;
export const getMqtt = () => client;
export const mqttConectado = () => client?.connected ?? false;

const colas = new Map<string, Promise<void>>();
function encolar(dispositivoId: string, trabajo: () => Promise<void>): void {
  const siguiente = (colas.get(dispositivoId) ?? Promise.resolve()).then(trabajo);
  colas.set(dispositivoId, siguiente);
  void siguiente.finally(() => colas.get(dispositivoId) === siguiente && colas.delete(dispositivoId));
}

export function publicar(topic: string, payload: unknown, opciones: mqtt.IClientPublishOptions = {}): void {
  if (!client?.connected) {
    console.warn(`[mqtt] sin conexión; no se pudo publicar en ${topic}`);
    return;
  }
  client.publish(topic, JSON.stringify(payload), opciones);
}

async function manejar(dispositivoId: string, sufijo: string, json: unknown): Promise<void> {
  switch (sufijo) {
    case 'telemetria': {
      const p = telemetriaSchema.safeParse(json);
      if (!p.success) throw new Error(`telemetría inválida: ${p.error.issues[0]?.message}`);
      await procesarTelemetria(dispositivoId, p.data);
      return;
    }
    case 'telemetria/lote': {
      // Lecturas diferidas de un corte de red: pueden venir repetidas, el índice único las filtra.
      if (!Array.isArray(json)) throw new Error('el lote no es un arreglo');
      for (const item of json.slice(0, 500)) {
        const p = telemetriaSchema.safeParse(item);
        if (p.success) await procesarTelemetria(dispositivoId, p.data, p.data.t);
      }
      return;
    }
    case 'estado': {
      const p = estadoSchema.safeParse(json);
      if (!p.success) throw new Error('estado inválido');
      await marcarPresencia(dispositivoId, p.data.en_linea, p.data.firmware ?? null);
      return;
    }
    case 'evento': {
      const p = eventoSchema.safeParse(json);
      if (!p.success) throw new Error('evento inválido');
      registrarEvento(dispositivoId, null, p.data.tipo, p.data.mensaje, {
        sensor: p.data.sensor ?? null,
        distanciaCm: p.data.distancia_cm ?? null,
      });
      return;
    }
    case 'cmd/ack': {
      recibirAck(dispositivoId, (json as { id?: unknown })?.id);
      return;
    }
    default:
      return; // `cmd` y `config` los publica el backend; su eco se ignora
  }
}

export function startBridge(): mqtt.MqttClient {
  client = mqtt.connect(env.MQTT_URL, {
    username: env.MQTT_ADMIN_USER,
    password: env.MQTT_ADMIN_PASS,
    clientId: `iot-api-${process.pid}`,
    reconnectPeriod: MIN_ESPERA,
    connectTimeout: 10_000,
  });
  const c = client;

  c.on('connect', () => {
    c.options.reconnectPeriod = MIN_ESPERA;
    console.log(`[mqtt] conectado a ${env.MQTT_URL}`);
    c.subscribe(`${PREFIJO}/#`, { qos: 1 }, (err) => {
      if (err) console.error('[mqtt] no se pudo suscribir:', err.message);
    });
  });
  c.on('close', () => {
    // mqtt.js lee reconnectPeriod cada vez que programa el siguiente intento.
    const siguiente = Math.min((c.options.reconnectPeriod ?? MIN_ESPERA) * 2, MAX_ESPERA);
    console.warn(`[mqtt] desconectado; reintento en ${c.options.reconnectPeriod} ms`);
    c.options.reconnectPeriod = siguiente;
  });
  c.on('error', (e) => console.error('[mqtt]', e.message));

  c.on('message', (topic, buf) => {
    const parsed = parseTopico(topic);
    if (!parsed) return;
    const { dispositivoId, sufijo } = parsed;
    if (sufijo === 'cmd' || sufijo === 'config') return; // publicados por el backend

    let json: unknown;
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch {
      console.warn(`[mqtt] payload no es JSON en ${topic}`);
      return;
    }

    encolar(dispositivoId, () =>
      manejar(dispositivoId, sufijo, json).catch((e) =>
        console.warn(`[mqtt] ${topic}: ${(e as Error).message}`),
      ),
    );
  });

  return c;
}
