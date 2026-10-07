// Tipos y utilidades del dominio del robot, compartidos por API, simulador y web.

/** Rango útil del HC-SR04. Fuera de esto la lectura es `null` (sin objeto). */
export const DIST_MIN_CM = 2;
export const DIST_MAX_CM = 400;
/** Rango que se dibuja en el dashboard: un hogar, no un pasillo de 4 m. */
export const DIST_VISTA_CM = 100;

export const SENSORES = ['izq', 'centro', 'der'] as const;
export type Sensor = (typeof SENSORES)[number];

export const MODOS = ['automatico', 'pausado', 'detenido'] as const;
export type Modo = (typeof MODOS)[number];

export const MOVIMIENTOS = ['avanzando', 'girando_izq', 'girando_der', 'retrocediendo', 'detenido'] as const;
export type Movimiento = (typeof MOVIMIENTOS)[number];

export const TIPOS_EVENTO = ['obstaculo', 'atascado', 'bateria_baja', 'conexion', 'desconexion', 'cambio_modo'] as const;
export type TipoEvento = (typeof TIPOS_EVENTO)[number];

export interface AngulosSensores {
  izq: number;
  centro: number;
  der: number;
}

export interface Configuracion {
  modo: Modo;
  distanciaEvasionCm: number;
  distanciaPrecaucionCm: number;
  velocidadBasePct: number;
  intervaloTelemetriaMs: number;
  angulosSensores: AngulosSensores;
  areaAnchoCm: number;
  areaAltoCm: number;
}

export const CONFIG_POR_DEFECTO: Configuracion = {
  modo: 'detenido',
  distanciaEvasionCm: 15,
  distanciaPrecaucionCm: 30,
  velocidadBasePct: 60,
  intervaloTelemetriaMs: 200,
  angulosSensores: { izq: -45, centro: 0, der: 45 },
  areaAnchoCm: 500,
  areaAltoCm: 400,
};

/**
 * Telemetría tal como viaja por MQTT: claves cortas para que el mensaje quepa holgado
 * en un paquete y el ESP32 no gaste RAM construyéndolo.
 *   seq  contador de la sesión     t   epoch ms (NTP)
 *   d    [izq, centro, der] en cm, null = sin objeto en rango
 *   e    estado de movimiento      x,y,th  pose en cm y grados
 *   vi,vd  PWM con signo por rueda (-100..100)
 *   bv   voltaje de batería        rssi  dBm del WiFi
 */
export interface TelemetriaMqtt {
  seq: number;
  t: number;
  d: [number | null, number | null, number | null];
  e: Movimiento;
  x: number;
  y: number;
  th: number;
  vi: number;
  vd: number;
  bv: number;
  rssi: number;
}

/** Lo que el backend reenvía por Socket.IO: ya normalizado y con metadatos del servidor. */
export interface Lectura {
  dispositivoId: string;
  sesionId: number | null;
  seq: number;
  distIzqCm: number | null;
  distCentroCm: number | null;
  distDerCm: number | null;
  movimiento: Movimiento;
  posXCm: number;
  posYCm: number;
  orientacionDeg: number;
  velIzqPct: number;
  velDerPct: number;
  bateriaV: number;
  bateriaPct: number;
  rssiDbm: number;
  medidoEn: number;
  recibidoEn: number;
}

export interface EventoRobot {
  id?: number;
  dispositivoId: string;
  sesionId: number | null;
  tipo: TipoEvento;
  sensor: Sensor | null;
  distanciaCm: number | null;
  posXCm: number | null;
  posYCm: number | null;
  mensaje: string;
  atendido?: boolean;
  creadoEn: number;
}

/** Batería: 3.3 V por celda vacía, 4.2 V llena; el pack de demo es de 2 celdas. */
export const BATERIA_MIN_V = 6.6;
export const BATERIA_MAX_V = 8.4;

export function bateriaPct(voltios: number): number {
  const pct = ((voltios - BATERIA_MIN_V) / (BATERIA_MAX_V - BATERIA_MIN_V)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/** Radio del chasis en cm: el haz del sensor nace en el borde, no en el centro del robot. */
export const RADIO_ROBOT_CM = 17;

/**
 * Punto del obstáculo en coordenadas del mapa, a partir de la pose y una distancia medida.
 * Misma fórmula que usa `obtener_mapa_sesion` en SQL, para que el mapa en vivo y el
 * histórico dibujen exactamente lo mismo.
 */
export function puntoObstaculo(
  x: number,
  y: number,
  thetaDeg: number,
  anguloSensorDeg: number,
  distanciaCm: number,
): { x: number; y: number } {
  const a = ((thetaDeg + anguloSensorDeg) * Math.PI) / 180;
  const r = RADIO_ROBOT_CM + distanciaCm;
  return { x: x + r * Math.cos(a), y: y + r * Math.sin(a) };
}

/** Normaliza un ángulo a [0, 360). */
export const normalizaDeg = (deg: number) => ((deg % 360) + 360) % 360;

/** Diferencia angular con signo en (-180, 180]: el camino más corto entre dos orientaciones. */
export function deltaDeg(desde: number, hasta: number): number {
  const d = normalizaDeg(hasta - desde);
  return d > 180 ? d - 360 : d;
}

export type EstadoDistancia = 'libre' | 'precaucion' | 'evasion';

export function estadoDistancia(d: number | null, cfg: Pick<Configuracion, 'distanciaEvasionCm' | 'distanciaPrecaucionCm'>): EstadoDistancia {
  if (d === null) return 'libre';
  if (d <= cfg.distanciaEvasionCm) return 'evasion';
  if (d <= cfg.distanciaPrecaucionCm) return 'precaucion';
  return 'libre';
}
