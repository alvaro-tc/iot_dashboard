// Tipos y utilidades del dominio del robot, compartidos por API, simulador y web.
//
// Los nombres son los mismos que usa el firmware del ESP32 (`firmware/`) y las columnas de
// la base: sensores izquierdo/central/derecho y motores en PWM con signo de -255 a 255.

/** Rango útil del HC-SR04. Fuera de esto la lectura es `null` (sin objeto). */
export const DIST_MIN_CM = 2;
export const DIST_MAX_CM = 400;
/** Rango que se dibuja en el dashboard: un hogar, no un pasillo de 4 m. */
export const DIST_VISTA_CM = 100;

export const SENSORES = ['izquierdo', 'central', 'derecho'] as const;
export type Sensor = (typeof SENSORES)[number];

/** Escala del PWM, igual que `PWM_MAXIMO` en firmware/configuracion.py. */
export const PWM_MAX = 255;
/** Por debajo de esto el motor no mueve el chasis: es ruido, no marcha. */
export const PWM_ACTIVO = 10;

/**
 * Umbrales de obstáculo. Ya no son configurables por robot: los decide el firmware, y aquí
 * solo sirven para colorear las distancias en el dashboard.
 */
export const DIST_EVASION_CM = 15;
export const DIST_PRECAUCION_CM = 30;

export interface AngulosSensores {
  izquierdo: number;
  central: number;
  derecho: number;
}

export interface Configuracion {
  /** PWM de crucero de los motores, de 0 a 255. */
  velocidadBase: number;
  angulosSensores: AngulosSensores;
}

export const CONFIG_POR_DEFECTO: Configuracion = {
  velocidadBase: 180,
  angulosSensores: { izquierdo: -45, central: 0, derecho: 45 },
};

/**
 * Telemetría tal como la publica el ESP32 en `roomba/{id}/telemetria`. Es exactamente el
 * diccionario que arma `firmware/main.py`, sin abreviar: el backend lo valida y lo guarda
 * sin traducir claves.
 *   distancias_cm  cm por sensor, null = el eco no volvió (nada en rango)
 *   motores        PWM con signo por rueda: negativo retrocede, positivo avanza
 */
export interface TelemetriaMqtt {
  robot_id?: string;
  distancias_cm: {
    izquierdo: number | null;
    central: number | null;
    derecho: number | null;
  };
  bateria_v: number;
  bateria_porcentaje?: number;
  motores: {
    izquierda_pwm: number;
    derecha_pwm: number;
  };
}

/** Lo que el backend reenvía por Socket.IO: ya normalizado y con metadatos del servidor. */
export interface Lectura {
  dispositivoId: string;
  sesionId: number | null;
  distanciaIzquierdaCm: number | null;
  distanciaCentralCm: number | null;
  distanciaDerechaCm: number | null;
  movimientoIzquierda: number;
  movimientoDerecha: number;
  bateriaVoltios: number;
  bateriaPorcentaje: number;
  /** Momento en que el backend recibió la lectura, en ms. */
  creadoEn: number;
}

/** Distancia de un sensor concreto de una lectura. */
export function distanciaDe(l: Lectura, sensor: Sensor): number | null {
  if (sensor === 'izquierdo') return l.distanciaIzquierdaCm;
  if (sensor === 'central') return l.distanciaCentralCm;
  return l.distanciaDerechaCm;
}

export const SENSORES_DE = (l: Lectura): { sensor: Sensor; d: number | null }[] =>
  SENSORES.map((sensor) => ({ sensor, d: distanciaDe(l, sensor) }));

/** Batería: 3.3 V por celda vacía, 4.2 V llena; el pack de demo es de 2 celdas. */
export const BATERIA_MIN_V = 6.6;
export const BATERIA_MAX_V = 8.4;

/** Porcentaje a partir del voltaje, para cuando el robot no lo manda calculado. */
export function bateriaPorcentaje(voltios: number): number {
  const pct = ((voltios - BATERIA_MIN_V) / (BATERIA_MAX_V - BATERIA_MIN_V)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export const MOVIMIENTOS = ['avanzando', 'retrocediendo', 'girando_izquierda', 'girando_derecha', 'detenido'] as const;
export type Movimiento = (typeof MOVIMIENTOS)[number];

/**
 * Qué está haciendo el robot, deducido del PWM de las dos ruedas. Antes esto era una columna
 * (`estado_movimiento`) que el firmware tenía que mantener en sincronía con los motores;
 * ahora se calcula de los motores y no puede contradecirlos.
 */
export function movimiento(izquierda: number, derecha: number): Movimiento {
  const activa = (v: number) => Math.abs(v) >= PWM_ACTIVO;
  if (!activa(izquierda) && !activa(derecha)) return 'detenido';
  // Signos opuestos (o una rueda quieta y la otra no) = giro sobre el eje.
  if (izquierda > 0 && derecha > 0) return 'avanzando';
  if (izquierda < 0 && derecha < 0) return 'retrocediendo';
  return derecha > izquierda ? 'girando_izquierda' : 'girando_derecha';
}

/** Normaliza un ángulo a [0, 360). */
export const normalizaDeg = (deg: number) => ((deg % 360) + 360) % 360;

export type EstadoDistancia = 'libre' | 'precaucion' | 'evasion';

export function estadoDistancia(d: number | null): EstadoDistancia {
  if (d === null) return 'libre';
  if (d <= DIST_EVASION_CM) return 'evasion';
  if (d <= DIST_PRECAUCION_CM) return 'precaucion';
  return 'libre';
}
