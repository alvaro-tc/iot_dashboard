// Simulador web: para clientes sin ESP32. Publica por MQTT igual que un dispositivo (pero sin
// deviceId), así que sus muestras recorren exactamente el mismo camino que las reales.
import { DECIMALS, computeTerm, initialAcc, telemetryTopic, type SeriesKey } from '@iot/shared';
import { getMqtt } from './mqtt/bridge.ts';
import { closeRunsAndEmit } from './runs.ts';

interface Simulation {
  timer: NodeJS.Timeout;
  seriesKey: SeriesKey;
  intervalMs: number;
}

const sims = new Map<number, Simulation>();

export function startSimulation(userId: number, seriesKey: SeriesKey, intervalMs: number): void {
  const mqtt = getMqtt();
  if (!mqtt?.connected) throw new Error('mqtt-offline');
  clearSimulation(userId);
  let k = 0;
  let acc = initialAcc(seriesKey);
  const timer = setInterval(() => {
    k++;
    const r = computeTerm(seriesKey, k, acc);
    acc = r.acc;
    const payload = { iteration: k, value: Number(r.value.toFixed(DECIMALS.value)), ts: Math.floor(Date.now() / 1000) };
    getMqtt()?.publish(telemetryTopic(userId, seriesKey), JSON.stringify(payload));
  }, intervalMs);
  sims.set(userId, { timer, seriesKey, intervalMs });
}

function clearSimulation(userId: number): boolean {
  const sim = sims.get(userId);
  if (sim) clearInterval(sim.timer);
  return sims.delete(userId);
}

/** Detiene el simulador y cierra su sesión web activa, si la hay. */
export async function stopSimulation(userId: number): Promise<void> {
  if (clearSimulation(userId)) {
    // Deja que el puente procese lo que ya estaba en vuelo antes de cerrar.
    await new Promise((r) => setTimeout(r, 300));
    await closeRunsAndEmit(`r.user_id = $1 AND r.source = 'web'`, [userId]);
  }
}

export function getSimulation(userId: number) {
  const sim = sims.get(userId);
  return sim ? { seriesKey: sim.seriesKey, intervalMs: sim.intervalMs } : null;
}
