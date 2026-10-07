// Formato de números y textos del dominio, en un solo sitio: 1 decimal para cm,
// enteros para porcentajes.
import type { EstadoDistancia, Movimiento, Sensor, TipoEvento } from '@iot/shared';

export const cm = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(1)} cm`);
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v)} %`);
export const ms = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v)} ms`);
export const voltios = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(2)} V`);
export const grados = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(1)}°`);

/** Distancias largas en metros: 1240 cm se lee peor que 12,4 m. */
export function distancia(cmValor: number | null | undefined): string {
  if (cmValor === null || cmValor === undefined) return '—';
  return cmValor >= 100 ? `${(cmValor / 100).toFixed(1)} m` : `${Math.round(cmValor)} cm`;
}

export function duracion(segundos: number | null | undefined): string {
  if (!segundos || segundos < 0) return '0 s';
  const s = Math.round(segundos);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export const hora = (iso: string | number | Date) =>
  new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });

export const fechaHora = (iso: string | number | Date) =>
  new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export function haceCuanto(iso: string | number | null | undefined): string {
  if (!iso) return 'nunca';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10) return 'ahora mismo';
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86_400)} días`;
}

export const NOMBRE_MOVIMIENTO: Record<Movimiento, string> = {
  avanzando: 'Avanzando',
  girando_izq: 'Girando a la izquierda',
  girando_der: 'Girando a la derecha',
  retrocediendo: 'Retrocediendo',
  detenido: 'Detenido',
};

export const NOMBRE_SENSOR: Record<Sensor, string> = {
  izq: 'izquierdo',
  centro: 'central',
  der: 'derecho',
};

export const NOMBRE_EVENTO: Record<TipoEvento, string> = {
  obstaculo: 'Obstáculo',
  atascado: 'Atascado',
  bateria_baja: 'Batería baja',
  conexion: 'Conexión',
  desconexion: 'Desconexión',
  cambio_modo: 'Cambio de modo',
};

/** Clases Tailwind del color de cada estado de sensor. */
export const CLASE_ESTADO: Record<EstadoDistancia, string> = {
  libre: 'text-libre',
  precaucion: 'text-precaucion',
  evasion: 'text-evasion',
};

/** Señal WiFi en porcentaje a partir del RSSI: -50 dBm o mejor es 100 %, -90 dBm es 0 %. */
export function senalPct(rssi: number | null | undefined): number | null {
  if (rssi === null || rssi === undefined) return null;
  return Math.max(0, Math.min(100, Math.round(((rssi + 90) / 40) * 100)));
}

/**
 * Frase del banner de estado: "Girando a la derecha — obstáculo a 12 cm (izquierdo)".
 * Es lo que un lector de pantalla lee del mapa, así que tiene que bastar por sí sola.
 */
export function fraseEstado(
  movimiento: Movimiento | null,
  distancias: { sensor: Sensor; d: number | null }[],
  evasionCm: number,
): string {
  if (!movimiento) return 'Sin datos del robot';
  const bloqueados = distancias.filter((x) => x.d !== null && x.d <= evasionCm);
  if (movimiento === 'detenido') return 'Detenido';
  if (!bloqueados.length) return `${NOMBRE_MOVIMIENTO[movimiento]} — camino libre`;
  const mas = bloqueados.reduce((a, b) => (a.d! <= b.d! ? a : b));
  return `${NOMBRE_MOVIMIENTO[movimiento]} — obstáculo a ${mas.d!.toFixed(0)} cm (${NOMBRE_SENSOR[mas.sensor]})`;
}
