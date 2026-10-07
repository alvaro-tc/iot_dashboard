// Robot de tracción diferencial simulado en una habitación con muebles.
//
// Vive en @iot/shared porque lo usan dos cosas que deben coincidir:
//   - /simulador: publica por MQTT igual que el ESP32 (demo sin hardware).
//   - apps/api/db/reset.ts: genera el historial del seed con trayectorias coherentes.
//
// La lógica de evasión es la MISMA máquina de estados que firmware/movimiento.py. Si cambia
// una, hay que cambiar la otra: es la única duplicación deliberada del proyecto (MicroPython
// no puede importar TypeScript).

import {
  DIST_MAX_CM,
  DIST_MIN_CM,
  normalizaDeg,
  type Configuracion,
  type Movimiento,
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
  config: Configuracion;
  /** Semilla para que el seed genere siempre el mismo historial. */
  semilla?: number;
  /** Deriva de la odometría: el robot simulado "cree" que avanza algo distinto de lo real. */
  derivaPct?: number;
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
const VEL_MAX_CM_S = 22; // velocidad lineal al 100 % de PWM

export class RobotSimulado {
  // Pose real dentro de la habitación.
  private rx = 0;
  private ry = 0;
  private rth = 0;
  // Pose estimada por odometría: es la que se publica, y acumula deriva como el robot real.
  private ox = 0;
  private oy = 0;
  private oth = 0;

  private vi = 0;
  private vd = 0;
  private movimiento: Movimiento = 'detenido';
  private maniobra = 0; // ms que quedan de un retroceso en curso
  private girando: 'izq' | 'der' | null = null; // sentido de giro fijado hasta despejar
  private msGirando = 0; // tiempo acumulado girando sin lograr despejar
  private paredes: Pared[];
  private rnd: () => number;
  private deriva: number;

  seq = 0;
  bateriaV = 8.4;
  rssi = -55;
  distanciaRecorridaCm = 0;
  evasiones = 0;
  /** Sensor que disparó la última evasión: el backend lo usa para el evento. */
  ultimaEvasion: { sensor: 'izq' | 'centro' | 'der'; distancia: number } | null = null;

  config: Configuracion;

  constructor(config: Configuracion, opciones: Partial<OpcionesSimulacion> = {}) {
    this.config = config;
    this.paredes = habitacion(config.areaAnchoCm, config.areaAltoCm);
    this.rnd = prng(opciones.semilla ?? 1);
    this.deriva = opciones.derivaPct ?? 0.02;
    this.rth = this.rnd() * 360;
  }

  /** Nueva sesión: el origen del mapa vuelve a (0,0,0°) aunque el robot esté donde esté. */
  reiniciar(): void {
    this.seq = 0;
    this.ox = this.oy = this.oth = 0;
    this.distanciaRecorridaCm = 0;
    this.evasiones = 0;
    this.maniobra = 0;
    this.girando = null;
    this.msGirando = 0;
  }

  distancias(): [number | null, number | null, number | null] {
    const { izq, centro, der } = this.config.angulosSensores;
    // El haz nace en el borde del chasis, no en el centro.
    const medir = (ang: number) => {
      const a = ((this.rth + ang) * Math.PI) / 180;
      const d = rayo(this.rx + RADIO_CHASIS * Math.cos(a), this.ry + RADIO_CHASIS * Math.sin(a), this.rth + ang, this.paredes);
      // Más allá del alcance el eco no vuelve: el firmware entrega None.
      if (d > DIST_MAX_CM) return null;
      if (this.rnd() < 0.01) return null; // eco perdido de vez en cuando
      // Pegado a la pared el HC-SR04 no resuelve por debajo de 2 cm, pero sigue habiendo
      // pared: devolver null aquí haría que el robot la leyera como camino libre.
      if (d < DIST_MIN_CM) return DIST_MIN_CM;
      // Ruido de ±1 cm.
      return Math.max(DIST_MIN_CM, Math.round((d + (this.rnd() - 0.5) * 2) * 10) / 10);
    };
    return [medir(izq), medir(centro), medir(der)];
  }

  /**
   * Máquina de estados de evasión. Espejo de firmware/movimiento.py:
   *   libre -> avanzar (más lento bajo precaución)
   *   centro bloqueado -> girar hacia el lado con más espacio
   *   un lado bloqueado -> girar al contrario
   *   los tres bloqueados -> retroceder y luego girar
   */
  private decidir(d: [number | null, number | null, number | null], dtMs: number): void {
    const { distanciaEvasionCm: ev, distanciaPrecaucionCm: prec, velocidadBasePct: base, modo } = this.config;
    if (modo !== 'automatico') {
      this.vi = this.vd = 0;
      this.movimiento = 'detenido';
      return;
    }

    // El retroceso se completa entero: interrumpirlo deja al robot pegado al obstáculo.
    if (this.maniobra > 0) {
      this.maniobra -= dtMs;
      return;
    }

    const [izq, centro, der] = d.map((x) => (x === null ? Infinity : x)) as [number, number, number];
    const bloqueado = (x: number) => x <= ev;
    const giro = Math.round(base * 0.8);
    const girar = (haciaIzq: boolean) => {
      this.vi = haciaIzq ? -giro : giro;
      this.vd = haciaIzq ? giro : -giro;
      this.movimiento = haciaIzq ? 'girando_izq' : 'girando_der';
    };

    this.ultimaEvasion = null;

    // Camino libre: se cancela el giro en curso y se avanza.
    if (!bloqueado(izq) && !bloqueado(centro) && !bloqueado(der)) {
      this.girando = null;
      this.msGirando = 0;
      const v = Math.min(izq, centro, der) <= prec ? Math.round(base * 0.5) : base; // frena al acercarse
      this.vi = this.vd = v;
      this.movimiento = 'avanzando';
      return;
    }

    // Hay algo delante. El sentido del giro se ELIGE UNA VEZ y se mantiene hasta despejar:
    // si se recalculara en cada paso, el robot alternaría izquierda/derecha y se quedaría
    // bamboleándose contra la esquina sin salir nunca.
    // Girar y girar sin despejar = atascado (una esquina, o algo que los sensores no ven).
    // Sin esta salida el robot se queda dando vueltas sobre su eje para siempre.
    this.msGirando += dtMs;
    if (this.msGirando > 3000) {
      this.msGirando = 0;
      this.girando = null;
      this.vi = this.vd = -base;
      this.movimiento = 'retrocediendo';
      this.maniobra = 900;
      return;
    }

    if (this.girando === null) {
      this.evasiones++;
      if (bloqueado(izq) && bloqueado(centro) && bloqueado(der)) {
        // Encerrado: primero retrocede, y al terminar elegirá sentido con espacio nuevo.
        this.vi = this.vd = -base;
        this.movimiento = 'retrocediendo';
        this.maniobra = 700;
        this.ultimaEvasion = { sensor: 'centro', distancia: centro };
        return;
      }
      if (bloqueado(centro)) {
        this.girando = izq > der ? 'izq' : 'der'; // hacia donde hay más espacio
        this.ultimaEvasion = { sensor: 'centro', distancia: centro };
      } else if (bloqueado(izq)) {
        this.girando = 'der'; // obstáculo a un lado: gira al contrario
        this.ultimaEvasion = { sensor: 'izq', distancia: izq };
      } else {
        this.girando = 'izq';
        this.ultimaEvasion = { sensor: 'der', distancia: der };
      }
    }
    girar(this.girando === 'izq');
  }

  /** Integra un paso del bucle de control. `dtMs` ~50 ms, igual que el firmware. */
  paso(dtMs: number): void {
    const d = this.distancias();
    this.decidir(d, dtMs);

    const dt = dtMs / 1000;
    // Cinemática de tracción diferencial a partir del PWM actual de cada rueda.
    const cinematica = () => {
      const vIzq = (this.vi / 100) * VEL_MAX_CM_S;
      const vDer = (this.vd / 100) * VEL_MAX_CM_S;
      return { v: (vDer + vIzq) / 2, omega: ((vDer - vIzq) / DISTANCIA_RUEDAS) * (180 / Math.PI) };
    };

    // Pose real. El chasis no atraviesa paredes, y la comprobación mira en el SENTIDO DE LA
    // MARCHA: al retroceder no hay sensor trasero, pero la pared sigue estando ahí. Sin esto
    // el robot se mete dentro de un mueble en la primera maniobra de retroceso.
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
        this.girando ??= this.rnd() < 0.5 ? 'izq' : 'der';
        const giro = Math.round(this.config.velocidadBasePct * 0.8);
        this.vi = this.girando === 'izq' ? -giro : giro;
        this.vd = this.girando === 'izq' ? giro : -giro;
        this.movimiento = this.girando === 'izq' ? 'girando_izq' : 'girando_der';
        this.maniobra = 0;
      }
    }

    // La rotación se aplica con las velocidades YA definitivas. Calcularla antes de resolver
    // el bloqueo dejaba al robot encajado girando con omega = 0: congelado para siempre.
    const { v, omega } = cinematica();
    this.rth = normalizaDeg(this.rth + omega * dt);

    // Pose estimada por odometría: misma integración, pero con un factor de deriva. No sabe
    // que el chasis está bloqueado, y por eso la estimación se separa de la realidad: es
    // exactamente el error que acumula el dead reckoning en el robot de verdad.
    const k = 1 + this.deriva;
    const othRad = (this.oth * Math.PI) / 180;
    this.ox += v * k * Math.cos(othRad) * dt;
    this.oy += v * k * Math.sin(othRad) * dt;
    this.oth = normalizaDeg(this.oth + omega * k * dt);


    // Batería: descarga lenta, más rápida girando (ambos motores a tope en sentidos opuestos).
    const carga = (Math.abs(this.vi) + Math.abs(this.vd)) / 200;
    this.bateriaV = Math.max(6.4, this.bateriaV - carga * 0.00035 * dt);
    this.rssi = Math.round(Math.max(-90, Math.min(-35, this.rssi + (this.rnd() - 0.5) * 3)));
  }

  /** Telemetría lista para publicar, con la pose estimada (no la real). */
  telemetria(ahoraMs: number): TelemetriaMqtt {
    const d = this.distancias();
    return {
      seq: ++this.seq,
      t: ahoraMs,
      d,
      e: this.movimiento,
      x: Math.round(this.ox * 10) / 10,
      y: Math.round(this.oy * 10) / 10,
      th: Math.round(this.oth * 10) / 10,
      vi: Math.round(this.vi),
      vd: Math.round(this.vd),
      bv: Math.round(this.bateriaV * 100) / 100,
      rssi: this.rssi,
    };
  }
}
