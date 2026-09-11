/**
 * Bus de eventos en proceso. La ruta de ingesta publica aquí y /api/stream
 * reenvía a los clientes por SSE. Es deliberadamente in-memory: con un solo
 * robot y un solo proceso de Next no hace falta Redis.
 *
 * ponytail: bus in-process; cambiar a Redis pub/sub solo si el backend
 * llega a correr en más de una instancia.
 */
import { EventEmitter } from "node:events";

export type MensajeStream =
  | { tipo: "telemetria"; datos: PuntoVivo }
  | { tipo: "evento"; datos: EventoVivo }
  | { tipo: "estado"; datos: EstadoVivo };

export type PuntoVivo = {
  t: string;
  sessionId: string | null;
  distanciaFrontalCm: number;
  distanciaIzquierdaCm: number;
  distanciaDerechaCm: number;
  densidadPolvoMgM3: number;
  pulsosIzq: number;
  pulsosDer: number;
  velocidadMs: number;
  anguloGirado: number;
  n: number;
  errorFrontalCm: number;
};

export type EventoVivo = {
  id: string;
  timestamp: string;
  tipo: string;
  severidad: string;
  sensor: string | null;
  valor: number | null;
  unidad: string | null;
  accion: string | null;
};

export type EstadoVivo = {
  modo: string;
  bateriaPct: number;
  voltaje: number;
  rssi: number;
  zonaWifi: string;
  online: boolean;
  distanciaM: number;
  areaM2: number;
  ultimaConexion: string;
};

const globalForBus = globalThis as unknown as { bus?: EventEmitter };

export const bus = globalForBus.bus ?? new EventEmitter();
// Cada pestaña abierta añade un listener; el límite por defecto (10) es bajo.
bus.setMaxListeners(100);
globalForBus.bus = bus;

export function publicar(mensaje: MensajeStream): void {
  bus.emit("mensaje", mensaje);
}
