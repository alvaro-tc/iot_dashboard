// Puente MQTT -> sesiones -> Postgres -> WebSocket.
//
//   ESP32 / simulador --publish--> Mosquitto (ACL por dispositivo)
//        --telemetry/{userId}/{seriesKey}--> este puente (usuario de servicio, suscrito a telemetry/+/+)
//        --zod--> runs.ingestSample (transacción: inferir sesión, insertar muestra)
//        --COMMIT--> ws.broadcast (filtrado por rol)
//
// Reglas:
//   - Nada que llegue por MQTT puede tumbar el proceso: todo error se loguea y la muestra se descarta.
//   - Las muestras de un mismo usuario se procesan en orden de llegada (una cola por usuario). Si se
//     procesaran en paralelo, la iteración 6 podría confirmarse antes que la 5 y la 5 parecería un
//     reinicio de la serie, partiendo la sesión en dos.
//   - Reconexión con backoff exponencial: 1 s, 2 s, 4 s… hasta 30 s; vuelve a 1 s al conectar.
import { TELEMETRY_SUBSCRIPTION, isSeriesKey, parseTelemetryTopic } from '@iot/shared';
import mqtt from 'mqtt';
import { z } from 'zod';
import { env } from '../env.ts';
import { DiscardSample, ingestSample } from '../runs.ts';

const payloadSchema = z.object({
  iteration: z.number().int().positive().max(2_147_483_647),
  value: z.number().finite(),
  deviceId: z.string().min(1).max(64).optional(),
  ts: z.number().optional(), // informativo: el ESP32 puede no tener hora; se usa la del servidor
});

const MIN_BACKOFF = 1_000;
const MAX_BACKOFF = 30_000;

let client: mqtt.MqttClient | null = null;
export const getMqtt = () => client;

const tails = new Map<number, Promise<void>>();
function enqueue(userId: number, job: () => Promise<void>): void {
  const next = (tails.get(userId) ?? Promise.resolve()).then(job);
  tails.set(userId, next);
  next.finally(() => tails.get(userId) === next && tails.delete(userId));
}

export function startBridge(): mqtt.MqttClient {
  client = mqtt.connect(env.MQTT_URL, {
    username: env.MQTT_ADMIN_USER,
    password: env.MQTT_ADMIN_PASS,
    clientId: `iot-api-${process.pid}`,
    reconnectPeriod: MIN_BACKOFF,
    connectTimeout: 10_000,
  });
  const c = client;

  c.on('connect', () => {
    c.options.reconnectPeriod = MIN_BACKOFF;
    console.log(`[mqtt] conectado a ${env.MQTT_URL}`);
    c.subscribe(TELEMETRY_SUBSCRIPTION, { qos: 1 }, (err) => {
      if (err) console.error('[mqtt] no se pudo suscribir:', err.message);
    });
  });
  c.on('close', () => {
    // mqtt.js lee reconnectPeriod cada vez que programa el siguiente intento.
    const next = Math.min((c.options.reconnectPeriod ?? MIN_BACKOFF) * 2, MAX_BACKOFF);
    console.warn(`[mqtt] desconectado; reintento en ${c.options.reconnectPeriod} ms`);
    c.options.reconnectPeriod = next;
  });
  c.on('error', (e) => console.error('[mqtt]', e.message));

  c.on('message', (topic, buf) => {
    const parsedTopic = parseTelemetryTopic(topic);
    if (!parsedTopic || !isSeriesKey(parsedTopic.seriesKey)) {
      console.warn(`[mqtt] topic descartado: ${topic}`);
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch {
      console.warn(`[mqtt] payload no es JSON en ${topic}`);
      return;
    }
    const p = payloadSchema.safeParse(json);
    if (!p.success) {
      console.warn(`[mqtt] payload inválido en ${topic}: ${p.error.issues.map((i) => i.path + ' ' + i.message).join('; ')}`);
      return;
    }
    const { userId, seriesKey } = parsedTopic;
    enqueue(userId, () =>
      ingestSample({ userId, seriesKey, iteration: p.data.iteration, value: p.data.value, deviceId: p.data.deviceId ?? null }).catch(
        (e) => {
          if (e instanceof DiscardSample) console.warn(`[mqtt] muestra descartada: ${e.message}`);
          else console.error('[mqtt] error al procesar muestra:', e);
        },
      ),
    );
  });

  return c;
}
