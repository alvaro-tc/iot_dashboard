// Robot de tracción diferencial simulado en una habitación con muebles.
//
// Vive en @iot/shared porque lo usan dos cosas que deben coincidir:
//   - /simulador: publica por MQTT igual que el ESP32 (demo sin hardware).
//   - apps/api/db/reset.ts: genera el historial del seed con lecturas coherentes.
//
// La pose (x, y, orientación) existe solo aquí dentro, para que las distancias que salen de
// los sensores sean las de una habitación de verdad. No se publica ni se guarda: la base
// solo almacena distancias, motores y batería, igual que lo que manda el ESP32.
//
// La lógica de evasión es la MISMA máquina de estados que el firmware. Si cambia una, hay
// que cambiar la otra: es la única duplicación deliberada del proyecto (MicroPython no
// puede importar TypeScript).

import {
  DIST_EVASION_CM,
  DIST_MAX_CM,
  DIST_MIN_CM,
  DIST_PRECAUCION_CM,
  PWM_MAX,
  normalizaDeg,
  type Configuracion,
  type TelemetriaMqtt,
} from './robot.ts';

export interface Pared {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Habitación rectangular con muebles dentro, como segmentos de pared. */
export function habitacion(ancho: number, alto: number): Pared[] {
  const half = { w: ancho / 2, h: alto / 2 };
  const rect = (cx: number, cy: number, w: number, h: number): Pared[] => [
    { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy - h / 2 },
    { x1: cx + w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 },
    { x1: cx + w / 2, y1: cy + h / 2, x2: cx - w / 2, y2: cy + h / 2 },
    { x1: cx - w / 2, y1: cy + h / 2, x2: cx - w / 2, y2: cy - h / 2 },
  ];
  return [
    ...rect(0, 0, ancho, alto), // paredes de la habitación
    ...rect(-half.w * 0.45, half.h * 0.35, 120, 60), // sofá
    ...rect(half.w * 0.4, -half.h * 0.3, 80, 80), // mesa
    ...rect(half.w * 0.5, half.h * 0.55, 60, 40), // maceta
    ...rect(-half.w * 0.3, -half.h * 0.6, 100, 30), // mueble bajo
  ];
}

/** Distancia del rayo (ox, oy, dirección deg) al segmento más cercano, o Infinity si no choca. */
function rayo(ox: number, oy: number, dirDeg: number, paredes: Pared[]): number {
  const a = (dirDeg * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  let mejor = Infinity;
  for (const p of paredes) {
    const sx = p.x2 - p.x1;
    const sy = p.y2 - p.y1;
    const den = dx * sy - dy * sx;
    if (Math.abs(den) < 1e-9) continue; // rayo paralelo al segmento
    const t = ((p.x1 - ox) * sy - (p.y1 - oy) * sx) / den; // distancia a lo largo del rayo
    const u = ((p.x1 - ox) * dy - (p.y1 - oy) * dx) / den; // posición dentro del segmento
    if (t > 0 && u >= 0 && u <= 1 && t < mejor) mejor = t;
  }
  return mejor;
}

export interface OpcionesSimulacion {
  /** Semilla para que el seed genere siempre el mismo historial. */
  semilla?: number;
  /** Tamaño de la habitación simulada, en cm. Solo afecta a la física, no a la base. */
  areaAnchoCm?: number;
  areaAltoCm?: number;
}

/** PRNG determinista (mulberry32): mismo seed -> mismo historial en cada db:reset. */
function prng(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RADIO_CHASIS = 17;
const DISTANCIA_RUEDAS = 24; // cm entre ruedas
const VEL_MAX_CM_S = 22; // velocidad lineal al PWM máximo

export class RobotSimulado {
  // Pose real dentro de la habitación. Interna: no se publica.
  private rx = 0;
  private ry = 0;
  private rth = 0;

  private vi = 0;
  private vd = 0;
  private maniobra = 0; // ms que quedan de un retroceso en curso
  private girando: 'izquierda' | 'derecha' | null = null; // sentido fijado hasta despejar
  private msGirando = 0; // tiempo acumulado girando sin lograr despejar
  private paredes: Pared[];
  private rnd: () => number;

  /** A false las ruedas quedan a cero: sirve para simular un robot parado. */
  activo = true;
  bateriaV = 8.4;
  distanciaRecorridaCm = 0;
  evasiones = 0;
  /** Sensor que disparó la última evasión. Lo usa el simulador para los mensajes de consola. */
  ultimaEvasion: { sensor: 'izquierdo' | 'central' | 'derecho'; distancia: number } | null = null;

  config: Configuracion;

  constructor(config: Configuracion, opciones: OpcionesSimulacion = {}) {
    this.config = config;
    this.paredes = habitacion(opciones.areaAnchoCm ?? 500, opciones.areaAltoCm ?? 400);
    this.rnd = prng(opciones.semilla ?? 1);
    this.rth = this.rnd() * 360;
  }

  /** Nueva sesión: reinicia los contadores acumulados. */
  reiniciar(): void {
    this.distanciaRecorridaCm = 0;
    this.evasiones = 0;
    this.maniobra = 0;
    this.girando = null;
    this.msGirando = 0;
  }

  distancias(): { izquierdo: number | null; central: number | null; derecho: number | null } {
    const { izquierdo, central, derecho } = this.config.angulosSensores;
    // El haz nace en el borde del chasis, no en el centro.
    const medir = (ang: number) => {
      const a = ((this.rth + ang) * Math.PI) / 180;
      const d = rayo(
        this.rx + RADIO_CHASIS * Math.cos(a),
        this.ry + RADIO_CHASIS * Math.sin(a),
        this.rth + ang,
        this.paredes,
      );
      // Más allá del alcance el eco no vuelve: el firmware entrega None.
      if (d > DIST_MAX_CM) return null;
      if (this.rnd() < 0.01) return null; // eco perdido de vez en cuando
      // Pegado a la pared el HC-SR04 no resuelve por debajo de 2 cm, pero sigue habiendo
      // pared: devolver null aquí haría que el robot la leyera como camino libre.
      if (d < DIST_MIN_CM) return DIST_MIN_CM;
      // Ruido de ±1 cm, acotado al rango del sensor: el ruido se suma DESPUÉS de comprobar
      // el alcance, así que sin recortar aquí una medida de 399.8 cm sale como 400.3 y se
      // pasa del rango que acepta la columna (CHECK ... BETWEEN 0 AND 400).
      const conRuido = Math.round((d + (this.rnd() - 0.5) * 2) * 10) / 10;
      return Math.min(DIST_MAX_CM, Math.max(DIST_MIN_CM, conRuido));
    };
    return { izquierdo: medir(izquierdo), central: medir(central), derecho: medir(derecho) };
  }

  /**
   * Máquina de estados de evasión. Espejo del firmware:
   *   libre -> avanzar (más lento bajo precaución)
   *   central bloqueado -> girar hacia el lado con más espacio
   *   un lado bloqueado -> girar al contrario
   *   los tres bloqueados -> retroceder y luego girar
   */
  private decidir(
    d: { izquierdo: number | null; central: number | null; derecho: number | null },
    dtMs: number,
  ): void {
    const base = Math.max(0, Math.min(PWM_MAX, Math.round(this.config.velocidadBase)));
    if (!this.activo) {
      this.vi = this.vd = 0;
      return;
    }

    // El retroceso se completa entero: interrumpirlo deja al robot pegado al obstáculo.
    if (this.maniobra > 0) {
      this.maniobra -= dtMs;
      return;
    }

    const izq = d.izquierdo ?? Infinity;
    const centro = d.central ?? Infinity;
    const der = d.derecho ?? Infinity;
    const bloqueado = (x: number) => x <= DIST_EVASION_CM;
    const giro = Math.round(base * 0.8);
    const girar = (haciaIzq: boolean) => {
      this.vi = haciaIzq ? -giro : giro;
      this.vd = haciaIzq ? giro : -giro;
    };

    this.ultimaEvasion = null;

    // Camino libre: se cancela el giro en curso y se avanza.
    if (!bloqueado(izq) && !bloqueado(centro) && !bloqueado(der)) {
      this.girando = null;
      this.msGirando = 0;
      // Frena al acercarse.
      this.vi = this.vd = Math.min(izq, centro, der) <= DIST_PRECAUCION_CM ? Math.round(base * 0.5) : base;
      return;
    }

    // Hay algo delante. El sentido del giro se ELIGE UNA VEZ y se mantiene hasta despejar:
    // si se recalculara en cada paso, el robot alternaría izquierda/derecha y se quedaría
    // bamboleándose contra la esquina sin salir nunca.
    // Girar y girar sin despejar = atascado (una esquina, o algo que los sensores no ven).
    this.msGirando += dtMs;
    if (this.msGirando > 3000) {
      this.msGirando = 0;
      this.girando = null;
      this.vi = this.vd = -base;
      this.maniobra = 900;
      return;
    }

    if (this.girando === null) {
      this.evasiones++;
      if (bloqueado(izq) && bloqueado(centro) && bloqueado(der)) {
        // Encerrado: primero retrocede, y al terminar elegirá sentido con espacio nuevo.
        this.vi = this.vd = -base;
        this.maniobra = 700;
        this.ultimaEvasion = { sensor: 'central', distancia: centro };
        return;
      }
      if (bloqueado(centro)) {
        this.girando = izq > der ? 'izquierda' : 'derecha'; // hacia donde hay más espacio
        this.ultimaEvasion = { sensor: 'central', distancia: centro };
      } else if (bloqueado(izq)) {
        this.girando = 'derecha'; // obstáculo a un lado: gira al contrario
        this.ultimaEvasion = { sensor: 'izquierdo', distancia: izq };
      } else {
        this.girando = 'izquierda';
        this.ultimaEvasion = { sensor: 'derecho', distancia: der };
      }
    }
    girar(this.girando === 'izquierda');
  }

  /** Integra un paso del bucle de control. `dtMs` ~50 ms, igual que el firmware. */
  paso(dtMs: number): void {
    this.decidir(this.distancias(), dtMs);

    const dt = dtMs / 1000;
    // Cinemática de tracción diferencial a partir del PWM actual de cada rueda.
    const cinematica = () => {
      const vIzq = (this.vi / PWM_MAX) * VEL_MAX_CM_S;
      const vDer = (this.vd / PWM_MAX) * VEL_MAX_CM_S;
      return { v: (vDer + vIzq) / 2, omega: ((vDer - vIzq) / DISTANCIA_RUEDAS) * (180 / Math.PI) };
    };

    // El chasis no atraviesa paredes, y la comprobación mira en el SENTIDO DE LA MARCHA: al
    // retroceder no hay sensor trasero, pero la pared sigue estando ahí. Sin esto el robot
    // se mete dentro de un mueble en la primera maniobra de retroceso.
    const avance = Math.abs(cinematica().v) * dt;
    if (avance > 0) {
      const v = cinematica().v;
      const sentido = v >= 0 ? this.rth : this.rth + 180;
      if (rayo(this.rx, this.ry, sentido, this.paredes) > RADIO_CHASIS + avance) {
        const thRad = (this.rth * Math.PI) / 180;
        this.rx += v * Math.cos(thRad) * dt;
        this.ry += v * Math.sin(thRad) * dt;
        this.distanciaRecorridaCm += avance;
      } else {
        // Encajado contra algo que los sensores no vieron (esquina ciega, retroceso):
        // gira sobre su eje hasta liberarse.
        this.girando ??= this.rnd() < 0.5 ? 'izquierda' : 'derecha';
        const giro = Math.round(this.config.velocidadBase * 0.8);
        this.vi = this.girando === 'izquierda' ? -giro : giro;
        this.vd = this.girando === 'izquierda' ? giro : -giro;
        this.maniobra = 0;
      }
    }

    // La rotación se aplica con las velocidades YA definitivas. Calcularla antes de resolver
    // el bloqueo dejaba al robot encajado girando con omega = 0: congelado para siempre.
    const { omega } = cinematica();
    this.rth = normalizaDeg(this.rth + omega * dt);

    // Batería: descarga lenta, más rápida girando (ambos motores a tope en sentidos opuestos).
    const carga = (Math.abs(this.vi) + Math.abs(this.vd)) / (2 * PWM_MAX);
    this.bateriaV = Math.max(6.4, this.bateriaV - carga * 0.00035 * dt);
  }

  /** Telemetría lista para publicar, con el mismo formato que el ESP32. */
  telemetria(): TelemetriaMqtt {
    return {
      distancias_cm: this.distancias(),
      bateria_v: Math.round(this.bateriaV * 100) / 100,
      motores: {
        izquierda_pwm: Math.round(this.vi),
        derecha_pwm: Math.round(this.vd),
      },
    };
  }
}
