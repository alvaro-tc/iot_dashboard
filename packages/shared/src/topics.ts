// Formato de topics MQTT: telemetry/{userId}/{seriesKey}

export const TELEMETRY_SUBSCRIPTION = 'telemetry/+/+';

export function telemetryTopic(userId: number, seriesKey: string): string {
  return `telemetry/${userId}/${seriesKey}`;
}

/** Patrón de ACL: un dispositivo solo escribe bajo el prefijo de su dueño. */
export function deviceAclPattern(userId: number): string {
  return `telemetry/${userId}/+`;
}

export function parseTelemetryTopic(topic: string): { userId: number; seriesKey: string } | null {
  const m = /^telemetry\/(\d+)\/([a-z0-9_]+)$/.exec(topic);
  return m ? { userId: Number(m[1]), seriesKey: m[2] } : null;
}

/** Payload que publica un dispositivo o el simulador. `deviceId` solo lo manda el ESP32. */
export interface TelemetryPayload {
  iteration: number;
  value: number;
  deviceId?: string;
  ts?: number;
}
