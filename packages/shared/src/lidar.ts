// "Lidar" de sonar giratorio: tipos y matemáticas del mapeo, compartidos por API, firmware
// beta (vía el backend), simulador y web.
//
// POR QUÉ ESTO FUNCIONA SIN HARDWARE NUEVO
// El robot no tiene lidar, ni encoders, ni IMU: solo tres HC-SR04 fijos a -45/0/+45 y dos
// ruedas. La idea es convertir el chasis entero en el motor del lidar: girando sobre su eje
// despacio, los tres sensores barren los 360° y dan un perfil polar de la habitación (con
// triple cobertura, porque los tres pasan por el mismo ángulo en distintos instantes).
//
// El problema de verdad no es medir, es saber DÓNDE se midió. Sin encoders, la odometría del
// PWM deriva en segundos. La salida es que la sala es de paredes rectas y de tamaño conocido
// a grandes rasgos: cada barrido se ENCAJA contra el polígono de la sala (ICP punto-a-arista),
// y de ahí sale la pose (x, y, orientación) sin integrar nada. La odometría solo tiene que
// servir de semilla del encaje, no de medida: la deriva se corta en cada barrido en vez de
// acumularse.
//
// Lo que no cae sobre una pared es obstáculo, y se acumula en una rejilla de ocupación en
// log-odds (varios barridos desde sitios distintos se refuerzan entre sí). De la rejilla
// salen las formas de los obstáculos por geometría (componentes conexas + PCA).
//
// CONVENIO DE COORDENADAS (uno solo, para no andar con signos)
//   - Marco de la sala: cm, x a la derecha, **y hacia abajo** (como el lienzo del navegador).
//   - Orientación `th` en grados, 0 = +x, creciente en el sentido de las agujas del reloj en
//     pantalla. El vector de avance es (cos th, sin th).
//   - El ángulo de un sensor es el de `configuracion_dispositivo.angulos_sensores`, relativo
//     al frente: negativo = a la izquierda del robot. Con el marco de arriba sale gratis, sin
//     invertir nada: sumar -45° a la orientación gira hacia la izquierda en pantalla.
import { DIST_MAX_CM, DIST_MIN_CM, SENSORES, type Sensor } from './robot.ts';

// ---------------------------------------------------------------------------
// Geometría básica
// ---------------------------------------------------------------------------

export interface Punto {
  x: number;
  y: number;
}

export interface Segmento {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Pose del robot en el marco de la sala: cm y grados. */
export interface Pose {
  x: number;
  y: number;
  th: number;
}

export const grados = (rad: number) => (rad * 180) / Math.PI;
export const radianes = (deg: number) => (deg * Math.PI) / 180;

/** Diferencia angular en grados, acotada a (-180, 180]. */
export function difAngular(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Punto del segmento más cercano a (px, py), y su distancia. */
export function masCercanoEnSegmento(px: number, py: number, s: Segmento): { x: number; y: number; d: number } {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const largo2 = dx * dx + dy * dy;
  // Segmento degenerado (dos vértices iguales): es un punto.
  const t = largo2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / largo2));
  const x = s.x1 + t * dx;
  const y = s.y1 + t * dy;
  return { x, y, d: Math.hypot(px - x, py - y) };
}

/** Arista más cercana de un conjunto de segmentos. */
export function masCercanoEnParedes(px: number, py: number, paredes: Segmento[]): { x: number; y: number; d: number } {
  let mejor = { x: px, y: py, d: Infinity };
  for (const s of paredes) {
    const c = masCercanoEnSegmento(px, py, s);
    if (c.d < mejor.d) mejor = c;
  }
  return mejor;
}

/**
 * Distancia del rayo (ox, oy, dirección en grados) al segmento más cercano, o Infinity.
 * Es la misma cuenta que `simulacion.ts`, aquí para el simulador de barridos y los tests.
 */
export function rayo(ox: number, oy: number, dirDeg: number, paredes: Segmento[]): number {
  const a = radianes(dirDeg);
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  let mejor = Infinity;
  for (const p of paredes) {
    const sx = p.x2 - p.x1;
    const sy = p.y2 - p.y1;
    const den = dx * sy - dy * sx;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((p.x1 - ox) * sy - (p.y1 - oy) * sx) / den;
    const u = ((p.x1 - ox) * dy - (p.y1 - oy) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1 && t < mejor) mejor = t;
  }
  return mejor;
}

/** ¿Está el punto dentro del polígono? (cruce de rayos; el polígono se cierra solo). */
export function dentroDelPoligono(px: number, py: number, vertices: Punto[]): boolean {
  let dentro = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i];
    const b = vertices[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  return dentro;
}

export function caja(vertices: Punto[]): { x: number; y: number; ancho: number; alto: number } {
  const xs = vertices.map((v) => v.x);
  const ys = vertices.map((v) => v.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, ancho: Math.max(...xs) - x, alto: Math.max(...ys) - y };
}

/** Área del polígono (fórmula del cordón), en cm². Siempre positiva. */
export function areaPoligono(vertices: Punto[]): number {
  let a = 0;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    a += vertices[j].x * vertices[i].y - vertices[i].x * vertices[j].y;
  }
  return Math.abs(a) / 2;
}

// ---------------------------------------------------------------------------
// La sala
// ---------------------------------------------------------------------------

/** Un rectángulo es un polígono de cuatro vértices: el encaje no distingue, la interfaz sí. */
export type FormaSala = 'rectangulo' | 'poligono';

/**
 * Hueco de pared que NO es una salida: el robot lo trata como pared para no escaparse, pero
 * se dibuja distinto (y no cuenta como obstáculo). Es un segmento sobre el borde de la sala.
 */
export interface Puerta extends Segmento {
  nombre?: string;
}

export interface Sala {
  id: number;
  dispositivoId: string;
  nombre: string;
  forma: FormaSala;
  /** Polígono cerrado, en cm y en el marco de la sala. Mínimo 3 vértices. */
  vertices: Punto[];
  /** Lo que el usuario estimó antes de mapear: ayuda a semillar el encaje. */
  anchoEstimadoCm: number;
  altoEstimadoCm: number;
  /** Medido al mapear (caja del polígono ya encajado). null hasta el primer barrido. */
  anchoRealCm: number | null;
  altoRealCm: number | null;
  puertas: Puerta[];
  creadoEn?: string;
  actualizadoEn?: string;
}

/** Rectángulo de ancho×alto con la esquina en el origen. */
export const rectangulo = (ancho: number, alto: number): Punto[] => [
  { x: 0, y: 0 },
  { x: ancho, y: 0 },
  { x: ancho, y: alto },
  { x: 0, y: alto },
];

/** Planta en L, el caso no rectangular más común. `recorte` es la esquina que falta. */
export function formaL(ancho: number, alto: number, recorteAncho: number, recorteAlto: number): Punto[] {
  const ra = Math.max(10, Math.min(ancho - 10, recorteAncho));
  const rh = Math.max(10, Math.min(alto - 10, recorteAlto));
  return [
    { x: 0, y: 0 },
    { x: ancho, y: 0 },
    { x: ancho, y: alto - rh },
    { x: ancho - ra, y: alto - rh },
    { x: ancho - ra, y: alto },
    { x: 0, y: alto },
  ];
}

/** Lleva el polígono al origen (esquina de su caja en 0,0): el marco de la sala y la rejilla. */
export function normalizarVertices(vertices: Punto[]): Punto[] {
  const c = caja(vertices);
  return vertices.map((v) => ({ x: Math.round((v.x - c.x) * 10) / 10, y: Math.round((v.y - c.y) * 10) / 10 }));
}

/**
 * Lo que el encaje y la navegación consideran "pared": las aristas del polígono MÁS las
 * puertas. Que la puerta sea pared es justo lo que pide el enunciado: si el robot ve el hueco
 * no se escapa, porque ahí hay una puerta.
 */
export function paredesDe(sala: Pick<Sala, 'vertices' | 'puertas'>): Segmento[] {
  const paredes: Segmento[] = [];
  const v = sala.vertices;
  for (let i = 0; i < v.length; i++) {
    const a = v[i];
    const b = v[(i + 1) % v.length];
    paredes.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  for (const p of sala.puertas) paredes.push({ x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2 });
  return paredes;
}

/**
 * Mete la pose dentro de la habitación. El robot no puede estar fuera de su propio cuarto: el
 * encaje ya penaliza esas poses, pero la odometría entre barridos no penaliza nada y deriva
 * libremente (se vieron x/y negativas tras un avance que chocó). Se proyecta sobre la pared más
 * cercana y se empuja un poco hacia dentro, porque una pose exactamente sobre el borde vuelve a
 * dar `dentroDelPoligono` falso en la comprobación siguiente.
 *
 * La orientación no se toca: mirar a la pared es perfectamente legítimo.
 */
export function ponerDentro(sala: Pick<Sala, 'vertices' | 'puertas'>, pose: Pose): Pose {
  if (dentroDelPoligono(pose.x, pose.y, sala.vertices)) return pose;
  const c = masCercanoEnParedes(pose.x, pose.y, paredesDe(sala));
  const caj = caja(sala.vertices);
  const centro = { x: caj.x + caj.ancho / 2, y: caj.y + caj.alto / 2 };
  const dx = centro.x - c.x;
  const dy = centro.y - c.y;
  const largo = Math.hypot(dx, dy);
  if (largo < 1e-6) return { ...pose, x: c.x, y: c.y };
  const dentro = { ...pose, x: c.x + (dx / largo) * MARGEN_DENTRO_CM, y: c.y + (dy / largo) * MARGEN_DENTRO_CM };
  // En una planta en L el centro de la caja puede caer en el recorte, o sea fuera: entonces el
  // empujón sacaría la pose en vez de meterla, y vale más dejarla justo sobre la pared.
  return dentroDelPoligono(dentro.x, dentro.y, sala.vertices) ? dentro : { ...pose, x: c.x, y: c.y };
}

/** Cuánto se empuja hacia dentro al reproyectar: menos que una celda de la rejilla. */
const MARGEN_DENTRO_CM = 2;

// ---------------------------------------------------------------------------
// Geometría del robot y calibración
// ---------------------------------------------------------------------------

/**
 * Medidas del chasis. Importan para el mapeo: el haz no nace en el centro del robot, así que
 * sin el desplazamiento del sensor el punto medido se coloca unos centímetros desviado, y a
 * 3 m eso es un obstáculo fantasma. Se editan por robot en la web.
 *
 * `x` es hacia el frente y `y` hacia la derecha del robot, en cm desde el centro del eje.
 */
export interface GeometriaRobot {
  radioChasisCm: number;
  separacionRuedasCm: number;
  sensores: Record<Sensor, { x: number; y: number; anguloDeg: number }>;
}

export const GEOMETRIA_POR_DEFECTO: GeometriaRobot = {
  radioChasisCm: 17,
  separacionRuedasCm: 24,
  sensores: {
    izquierdo: { x: 12, y: -12, anguloDeg: -45 },
    central: { x: 17, y: 0, anguloDeg: 0 },
    derecho: { x: 12, y: 12, anguloDeg: 45 },
  },
};

/**
 * Lo que hay que medir en el robot real porque no hay encoders: cuánto gira y cuánto avanza
 * por unidad de PWM. Se obtiene con las rutinas de `calibracion` (ver `autocalibrar*`), no a
 * ojo: dos chasis iguales con la misma batería dan números distintos.
 */
export interface CalibracionRobot {
  /** PWM con el que se hacen los barridos (giro sobre el eje). */
  pwmGiro: number;
  /** Grados por segundo a `pwmGiro`. Positivo = sentido horario en pantalla. */
  gradosPorSegundo: number;
  /** PWM de avance en la limpieza y cm/s a ese PWM. */
  pwmAvance: number;
  cmPorSegundo: number;
  /** Cuándo se midió (ms). null = sin calibrar: el mapeo avisa y usa los valores de reserva. */
  medidoEn: number | null;
}

export const CALIBRACION_POR_DEFECTO: CalibracionRobot = {
  pwmGiro: 140,
  gradosPorSegundo: 90,
  pwmAvance: 180,
  cmPorSegundo: 18,
  medidoEn: null,
};

/**
 * Separación de ruedas EFECTIVA, deducida de las dos calibraciones en vez de medida con una
 * cinta. La separación geométrica no sirve para la odometría: las ruedas patinan al girar
 * sobre el eje, así que el robot gira bastante menos de lo que dice la cinemática ideal.
 *
 * Girando en el sitio a `pwmGiro`, la velocidad de cada rueda es
 *     v = (pwmGiro / pwmAvance) · cmPorSegundo
 * y la cinemática diferencial dice ω = 2v / L. Como ω se ha MEDIDO (gradosPorSegundo), se
 * despeja la L que hace cuadrar las dos medidas, y con ella el avance y el giro quedan
 * consistentes entre sí.
 */
export function separacionEfectivaCm(cal: CalibracionRobot, geo: GeometriaRobot): number {
  const omega = radianes(Math.abs(cal.gradosPorSegundo));
  if (!cal.medidoEn || omega < 1e-6 || cal.pwmAvance <= 0) return geo.separacionRuedasCm;
  const v = (cal.pwmGiro / cal.pwmAvance) * cal.cmPorSegundo;
  const l = (2 * v) / omega;
  // Un número absurdo (calibración mala) es peor que la medida de la cinta.
  return l > 5 && l < 200 ? l : geo.separacionRuedasCm;
}

/**
 * Odometría de tracción diferencial: adelanta la pose con los PWM de las dos ruedas.
 *
 * Es la SEMILLA del encaje, no una medida: sin encoders esto deriva en segundos (por eso cada
 * barrido se vuelve a encajar contra las paredes). Durante la limpieza es lo único que hay
 * entre dos barridos, y los PWM salen de la telemetría normal del robot.
 */
export function avanzarPose(
  pose: Pose,
  izquierdaPwm: number,
  derechaPwm: number,
  dtMs: number,
  cal: CalibracionRobot,
  geo: GeometriaRobot,
): Pose {
  if (cal.pwmAvance <= 0 || dtMs <= 0) return pose;
  const escala = cal.cmPorSegundo / cal.pwmAvance;
  const vi = izquierdaPwm * escala;
  const vd = derechaPwm * escala;
  const dt = dtMs / 1000;
  const l = separacionEfectivaCm(cal, geo);
  // th crece en sentido horario en pantalla: con la rueda izquierda más rápida el robot gira
  // a la derecha, o sea th hacia arriba. De ahí (vi − vd) y no (vd − vi).
  const dth = ((vi - vd) / l) * dt;
  const avance = ((vi + vd) / 2) * dt;
  // Arco en vez de línea recta: con dth grande (un giro) la recta se iría de sitio.
  const thMedio = radianes(pose.th + grados(dth) / 2);
  return {
    x: pose.x + avance * Math.cos(thMedio),
    y: pose.y + avance * Math.sin(thMedio),
    th: pose.th + grados(dth),
  };
}

// ---------------------------------------------------------------------------
// Barridos: lo que sube el firmware beta
// ---------------------------------------------------------------------------

/**
 * Una muestra del barrido: milisegundos desde el inicio del giro y los tres sensores.
 * El firmware no sabe su ángulo (no hay encoders): manda el tiempo, y el ángulo lo reconstruye
 * el backend con `gradosPorSegundo` de la calibración. Así el único sitio donde vive la
 * cinemática es este paquete, y se puede corregir sin reflashear el ESP32.
 */
export interface MuestraBarrido {
  dt: number;
  izquierdo: number | null;
  central: number | null;
  derecho: number | null;
}

export interface LoteBarrido {
  /** Número de barrido dentro de la sesión de mapeo; sirve para detectar lotes perdidos. */
  barrido: number;
  /** Índice del primer lote de este barrido: 0 abre barrido nuevo. */
  lote: number;
  /** La acción que estaba ejecutando el robot: el mismo vocabulario que el tópico `comando`. */
  modo: 'barrer' | 'limpiar' | 'girar' | 'avanzar' | 'calibrar_giro' | 'calibrar_avance';
  muestras: MuestraBarrido[];
  /** true en el último lote del barrido. */
  fin?: boolean;
}

/** Un punto medido, ya con su ángulo global reconstruido. */
export interface PuntoMedido {
  /** Origen del haz en el marco de la sala. */
  ox: number;
  oy: number;
  /** Dirección del haz en el marco de la sala, en grados. */
  dir: number;
  /** Distancia medida, o null si no volvió el eco. */
  d: number | null;
  sensor: Sensor;
  /** Punto del impacto, solo si d no es null. */
  x: number;
  y: number;
}

/**
 * Reconstruye los puntos de un barrido a partir de las muestras y una pose supuesta.
 *
 * `omega` son los grados/segundo del giro: con él, el tiempo de cada muestra se convierte en
 * el ángulo que llevaba el robot. La pose de entrada es la semilla (odometría o la del barrido
 * anterior); el encaje la corregirá después.
 */
export function puntosDeBarrido(
  muestras: MuestraBarrido[],
  pose: Pose,
  omega: number,
  geo: GeometriaRobot,
): PuntoMedido[] {
  const puntos: PuntoMedido[] = [];
  for (const m of muestras) {
    const th = pose.th + omega * (m.dt / 1000);
    const c = Math.cos(radianes(th));
    const s = Math.sin(radianes(th));
    for (const sensor of SENSORES) {
      const d = m[sensor];
      const mont = geo.sensores[sensor];
      // El haz nace en el sensor, no en el centro del robot: se rota el montaje con la pose.
      const ox = pose.x + mont.x * c - mont.y * s;
      const oy = pose.y + mont.x * s + mont.y * c;
      const dir = th + mont.anguloDeg;
      const valido = d !== null && d >= DIST_MIN_CM && d <= DIST_MAX_CM;
      puntos.push({
        ox,
        oy,
        dir,
        d: valido ? d : null,
        sensor,
        x: valido ? ox + Math.cos(radianes(dir)) * d! : ox,
        y: valido ? oy + Math.sin(radianes(dir)) * d! : oy,
      });
    }
  }
  return puntos;
}

// ---------------------------------------------------------------------------
// Encaje del barrido contra las paredes (ICP punto-a-arista)
// ---------------------------------------------------------------------------

/**
 * Corrige la pose supuesta para que los puntos del barrido caigan sobre las paredes.
 *
 * Es ICP recortado: en cada vuelta se empareja cada punto con su arista más cercana, se
 * descartan los peores (que son justo los obstáculos y los ecos malos, por eso NO se ajusta a
 * ellos) y se resuelve la rotación y traslación óptimas entre los pares que quedan. Converge
 * en pocas vueltas porque la semilla está cerca y la sala es convexa a trozos.
 *
 * `reintentos` prueba varias orientaciones iniciales: tras un giro largo la odometría puede
 * estar desfasada decenas de grados, y el ICP solo no sale de ese mínimo local.
 */
export function encajarBarrido(
  puntos: PuntoMedido[],
  paredes: Segmento[],
  semilla: Pose,
  opciones: {
    vueltas?: number;
    recorte?: number;
    reintentos?: number[];
    /** Planta de la habitación: si se pasa, se descartan las poses fuera de ella. */
    vertices?: Punto[];
    /**
     * Mapa ya conocido (campoDeCercania de la rejilla). Con él, el barrido se encaja contra las
     * paredes Y contra los obstáculos ya mapeados, que es lo que lo hace funcionar en una casa
     * amueblada. Sin él (primer barrido de una habitación) solo hay paredes.
     */
    campo?: CampoCercania | null;
    /**
     * Cuánto se le permite alejarse de la semilla. Con un punto de partida conocido (el que
     * marca el cliente, o la odometría entre dos barridos seguidos) esto es información de
     * verdad: sin el límite, el refinado se va caminando y acaba a dos metros aunque la
     * búsqueda gruesa hubiera acertado.
     */
    maxDesvioCm?: number;
    /**
     * Respecto a QUÉ se mide "alejarse": por defecto la semilla, pero cuando el ajuste se lanza
     * varias veces desde candidatas distintas (ver `encajarGlobal`) todas tienen que medirse
     * contra el mismo sitio conocido —el punto que marcó el cliente—, o cada una se juzga
     * respecto a sí misma y las lejanas puntúan igual de bien.
     */
    ancla?: Punto | null;
  } = {},
): { pose: Pose; error: number; usados: number; puntuacion: number } {
  const vueltas = opciones.vueltas ?? 24;
  // `recorte` ya no es "quédate con esta fracción": es el SUELO de puntos que entran en el
  // ajuste cuando el umbral adaptativo deja fuera a casi todos. Ver `cuantosInliers`.
  const recorte = opciones.recorte ?? 0.35;
  const vertices = opciones.vertices;
  const campo = opciones.campo ?? null;
  const maxDesvio = opciones.maxDesvioCm ?? Infinity;
  const ancla = opciones.ancla ?? semilla;

  /**
   * Con qué se empareja un punto: la pared o el obstáculo ya mapeado, el que esté más cerca.
   * Esta función es TODO el cambio de "encajar contra las paredes" a "encajar contra el mapa".
   */
  const emparejar = (px: number, py: number) => {
    const pared = masCercanoEnParedes(px, py, paredes);
    if (!campo) return pared;
    const enMapa = cercaEnMapa(campo, px, py);
    return enMapa && enMapa.d < pared.d ? enMapa : pared;
  };
  const reintentos = opciones.reintentos ?? [0, -20, 20, -45, 45, 90, 180, -90];
  const validos = puntos.filter((p) => p.d !== null);
  if (validos.length < 8) return { pose: semilla, error: Infinity, usados: 0, puntuacion: Infinity };

  let mejor = { pose: semilla, error: Infinity, usados: 0, puntuacion: Infinity };
  let mejorPuntuacion = Infinity;

  /**
   * Puntúa una pose: coste de encaje (ver abajo) más lo que cuesta alejarse de lo que ya se
   * sabía. Se usa para ELEGIR entre poses, no para ajustar.
   */
  const puntuar = (pose: Pose) => {
    const colocados = recolocar(validos, semilla, pose);
    const ds = colocados.map((p) => emparejar(p.x, p.y).d).sort((a, b) => a - b);

    // El residuo que se REPORTA se mide sobre los inliers: es "cuánto se desvían de la pared
    // los puntos que son pared". Si incluyera los de los muebles, un encaje perfecto en un
    // salón lleno daría 20-30 cm y el mapeo lo rechazaría por malo.
    const n = cuantosInliers(ds);
    const error = Math.sqrt(ds.slice(0, n).reduce((a, d) => a + d * d, 0) / n);

    // Pero el candidato NO se elige por ese residuo: con un umbral adaptativo el ajuste puede
    // elegirse los inliers, y encajar de maravilla un tercio de los puntos ignorando el resto da
    // un residuo buenísimo en una pose absurda (se midieron errores de 2 m con residuo de
    // 0,5 cm). El coste de selección cuenta CUÁNTOS puntos son pared u obstáculo conocido:
    //
    //   cada punto que encaja (≤ UMBRAL_INLIER_MIN_CM) cuesta su propia desviación,
    //   cada punto que no encaja cuesta TOPE_COSTE_CM, falle por 20 cm o por 2 m.
    //
    // Ese "da igual por cuánto" es lo que mata los ajustes difusos.
    let encajan = 0;
    let suma = 0;
    for (const d of ds) {
      if (d <= UMBRAL_INLIER_MIN_CM) {
        encajan++;
        suma += d;
      }
    }
    const coste =
      (suma + (ds.length - encajan) * TOPE_COSTE_CM) / ds.length +
      // El robot está DENTRO de la habitación, y no puede estar lejos de donde se le supone:
      // las dos cosas son información gratis que descarta las soluciones espejo de un golpe.
      (vertices && !dentroDelPoligono(pose.x, pose.y, vertices) ? PENALIZACION_FUERA_CM : 0) +
      (Math.hypot(pose.x - ancla.x, pose.y - ancla.y) > maxDesvio ? PENALIZACION_FUERA_CM : 0);

    // La odometría es información, no ruido: entre dos encajes que explican el barrido igual de
    // bien, vale el que está más cerca de donde el robot cree estar. Sin este término, una sala
    // rectangular encaja igual de bien girada 180° (es simétrica) y el mapa se construye del
    // revés. Los pesos son flojos a propósito: un encaje de verdad mejor sigue ganando.
    const puntuacion =
      coste +
      (PRIOR_ANGULO_CM * Math.abs(difAngular(pose.th, semilla.th))) / 45 +
      (PRIOR_POSICION_CM * Math.hypot(pose.x - ancla.x, pose.y - ancla.y)) / 50;

    return { puntuacion, error, usados: n };
  };

  /** Guarda la pose si es la mejor vista hasta ahora. */
  const considerar = (pose: Pose) => {
    const { puntuacion, error, usados } = puntuar(pose);
    if (puntuacion < mejorPuntuacion) {
      mejorPuntuacion = puntuacion;
      mejor = { pose: { ...pose, th: ((pose.th % 360) + 360) % 360 }, error, usados, puntuacion };
    }
  };

  // La propia semilla entra a concurso: si el ajuste se escapa, lo que el robot creía saber
  // sigue siendo mejor que una pose inventada.
  considerar(semilla);

  for (const giro of reintentos) {
    let pose: Pose = { ...semilla, th: semilla.th + giro };

    for (let v = 0; v < vueltas; v++) {
      // Los puntos se recolocan con la pose en curso: el barrido es rígido, así que basta
      // rotar y trasladar los medidos respecto de la semilla.
      const colocados = recolocar(validos, semilla, pose);
      const pares = colocados
        .map((p) => ({ p, c: emparejar(p.x, p.y) }))
        .sort((a, b) => a.c.d - b.c.d);

      // Recorte PROGRESIVO: al principio entran casi todos los puntos y al final solo los que
      // están de verdad sobre una pared o sobre un obstáculo ya conocido.
      //
      // Las dos cosas hacen falta y tiran en sentidos opuestos. Con un recorte estricto desde la
      // primera vuelta, una semilla a medio metro no tiene casi ningún punto cerca, así que el
      // ajuste arranca con un puñado de puntos cualesquiera y se va caminando hasta fuera de la
      // habitación. Con un recorte generoso siempre, los puntos de los muebles de un salón lleno
      // (casi la mitad de los rayos) entran por obligación y arrastran la pose. Empezar ancho y
      // cerrar resuelve las dos: primero encuentra la zona, después afina.
      const avance2 = vueltas > 1 ? v / (vueltas - 1) : 1;
      const fraccion = RECORTE_INICIAL - (RECORTE_INICIAL - recorte) * avance2;
      const n = Math.max(6, Math.floor(pares.length * fraccion));
      const usados = pares.slice(0, n);

      // Procrustes 2D: el giro y el desplazamiento que mejor llevan los puntos a sus
      // proyecciones sobre la pared.
      let cx = 0, cy = 0, qx = 0, qy = 0;
      for (const { p, c } of usados) {
        cx += p.x; cy += p.y; qx += c.x; qy += c.y;
      }
      cx /= n; cy /= n; qx /= n; qy /= n;
      let num = 0, den = 0;
      for (const { p, c } of usados) {
        const ax = p.x - cx, ay = p.y - cy;
        const bx = c.x - qx, by = c.y - qy;
        num += ax * by - ay * bx;
        den += ax * bx + ay * by;
      }
      const dth = grados(Math.atan2(num, den));
      const cos = Math.cos(radianes(dth));
      const sin = Math.sin(radianes(dth));
      // Traslación óptima: la que lleva el centroide girado al de las proyecciones.
      const tx = qx - (cx * cos - cy * sin);
      const ty = qy - (cx * sin + cy * cos);
      // La pose sufre la MISMA transformación rígida que los puntos (girar y luego trasladar);
      // si solo se le sumara la traslación, el robot se quedaría atrás al corregir el ángulo.
      const nueva: Pose = {
        x: pose.x * cos - pose.y * sin + tx,
        y: pose.x * sin + pose.y * cos + ty,
        th: pose.th + dth,
      };

      const avance = Math.hypot(nueva.x - pose.x, nueva.y - pose.y) + Math.abs(dth);
      pose = nueva;
      // Se puntúan también las poses INTERMEDIAS, no solo la final: si el ajuste pasa por la
      // buena y después se va caminando, hay que quedarse con aquella. Puntuando solo al final,
      // los tres reintentos acababan lejos, todos penalizados por igual, y ganaba la menos mala
      // (errores de 2 m con la posición de partida ya marcada por el cliente).
      if (v % 3 === 0 || avance < 0.05) considerar(pose);
      if (avance < 0.05) break;
    }

    considerar(pose);
  }

  return mejor;
}

/**
 * Cuántos puntos (de la lista YA ordenada de residuos) cuentan como "sobre una pared".
 *
 * El umbral sale de la mediana de los residuos (la escala de error del propio barrido), acotado
 * entre el ruido del sensor y "esto ya no es pared". Se usa SOLO para medir el residuo que se
 * reporta, no para alinear: el alineamiento tiene su propio recorte progresivo. Mezclar las dos
 * cosas daba residuos de 60-78 cm en poses acertadas al centímetro, porque el suelo de puntos
 * que necesita el alineamiento metía en la cuenta puntos que no eran pared.
 */
function cuantosInliers(ordenados: number[]): number {
  if (!ordenados.length) return 0;
  const mediana = ordenados[Math.floor(ordenados.length / 2)];
  // El umbral se adapta a la escala de error del barrido, pero CON TOPE: en una habitación con
  // muchos muebles la mediana se dispara (la mitad de los rayos no dan en una pared), y sin
  // tope el umbral llegaba a los 2 m y entraban como "inliers" todos los puntos. El residuo
  // reportado salía entonces de 116 cm con la pose acertada al centímetro, y el mapeo rechazaba
  // barridos buenos por creerlos malos.
  const umbral = Math.min(TOPE_COSTE_CM, Math.max(UMBRAL_INLIER_MIN_CM, 2.5 * mediana));
  let cerca = 0;
  while (cerca < ordenados.length && ordenados[cerca] <= umbral) cerca++;
  return Math.min(ordenados.length, Math.max(6, cerca));
}

/** Fracción de puntos que entra en la primera vuelta del ajuste. Ver `encajarBarrido`. */
const RECORTE_INICIAL = 0.9;
/** Por debajo de esto, un punto está sobre la pared: es ruido del sensor, no un obstáculo. */
const UMBRAL_INLIER_MIN_CM = 8;
/** Lo que cuesta un punto que no es pared, falle por 20 cm o por 2 m. */
const TOPE_COSTE_CM = 40;
/**
 * Umbral de "cae sobre la pared" en la búsqueda GRUESA. Más ancho que el del ajuste fino
 * (UMBRAL_INLIER_MIN_CM): los candidatos están en una rejilla de decenas de centímetros, así
 * que ni el bueno acierta al centímetro.
 */
const UMBRAL_GRUESO_CM = 20;
/** Lo que cuesta poner al robot fuera de su propia habitación: tanto como para descartarla. */
const PENALIZACION_FUERA_CM = 1000;

/** Cuánto residuo (en cm) "vale" desviarse 45° o 50 cm de la semilla. Ver `encajarBarrido`. */
const PRIOR_ANGULO_CM = 0.6;
const PRIOR_POSICION_CM = 0.5;

/**
 * Celda ocupada más cercana a cada celda de la rejilla ("nearest feature transform").
 *
 * Es lo que permite encajar un barrido contra el MAPA y no solo contra las paredes, y esa es la
 * diferencia entre que esto funcione en una casa o no. Encajando contra las paredes, en un
 * salón amueblado más de la mitad de los rayos dan en un mueble y hay que tratarlos como ruido:
 * eso está por encima del punto de ruptura del ajuste, y la pose se va metros. Con el mapa, los
 * muebles ya conocidos TIENEN correspondencia y dejan de ser ruido para convertirse en lo que
 * mejor sujeta la pose (una pared lisa no dice en qué punto de ella estás; una silla sí).
 *
 * Se calcula con dos pasadas tipo Danielsson (propagando el vecino más cercano y recalculando la
 * distancia euclídea de verdad), que para una rejilla de 100×80 es instantáneo.
 */
export interface CampoCercania {
  cols: number;
  filas: number;
  res: number;
  /** Índice de la celda ocupada más cercana, o -1 si no hay ninguna. */
  origen: Int32Array;
  /** Distancia en cm a esa celda. */
  distancia: Float32Array;
}

export function campoDeCercania(r: Rejilla, umbral = UMBRAL_OCUPADO): CampoCercania {
  const n = r.cols * r.filas;
  const origen = new Int32Array(n).fill(-1);
  const distancia = new Float32Array(n).fill(Infinity);

  for (let i = 0; i < n; i++) {
    if (r.datos[i] / ESCALA_LOGODDS >= umbral) {
      origen[i] = i;
      distancia[i] = 0;
    }
  }

  const dist = (i: number, fuente: number) => {
    const ix = i % r.cols;
    const iy = (i - ix) / r.cols;
    const fx = fuente % r.cols;
    const fy = (fuente - fx) / r.cols;
    return Math.hypot(ix - fx, iy - fy) * r.res;
  };

  const propagar = (i: number, vecino: number) => {
    if (vecino < 0 || vecino >= n) return;
    const fuente = origen[vecino];
    if (fuente < 0) return;
    const d = dist(i, fuente);
    if (d < distancia[i]) {
      distancia[i] = d;
      origen[i] = fuente;
    }
  };

  for (let y = 0; y < r.filas; y++) {
    for (let x = 0; x < r.cols; x++) {
      const i = y * r.cols + x;
      if (y > 0) propagar(i, i - r.cols);
      if (x > 0) propagar(i, i - 1);
      if (y > 0 && x > 0) propagar(i, i - r.cols - 1);
      if (y > 0 && x < r.cols - 1) propagar(i, i - r.cols + 1);
    }
  }
  for (let y = r.filas - 1; y >= 0; y--) {
    for (let x = r.cols - 1; x >= 0; x--) {
      const i = y * r.cols + x;
      if (y < r.filas - 1) propagar(i, i + r.cols);
      if (x < r.cols - 1) propagar(i, i + 1);
      if (y < r.filas - 1 && x < r.cols - 1) propagar(i, i + r.cols + 1);
      if (y < r.filas - 1 && x > 0) propagar(i, i + r.cols - 1);
    }
  }

  return { cols: r.cols, filas: r.filas, res: r.res, origen, distancia };
}

/** Celda ocupada más cercana a un punto en cm, según el campo. */
function cercaEnMapa(campo: CampoCercania, px: number, py: number): { x: number; y: number; d: number } | null {
  const cx = Math.floor(px / campo.res);
  const cy = Math.floor(py / campo.res);
  if (cx < 0 || cy < 0 || cx >= campo.cols || cy >= campo.filas) return null;
  const i = cy * campo.cols + cx;
  const fuente = campo.origen[i];
  if (fuente < 0) return null;
  const fx = fuente % campo.cols;
  const fy = (fuente - fx) / campo.cols;
  const x = (fx + 0.5) * campo.res;
  const y = (fy + 0.5) * campo.res;
  return { x, y, d: Math.hypot(px - x, py - y) };
}

/**
 * Encaje GLOBAL: sin semilla de confianza, no vale solo el ICP.
 *
 * `encajarBarrido` converge en lo local. Para el PRIMER barrido de una habitación no se sabe
 * dónde está el robot (lo único razonable es suponer el centro), y si de verdad estaba a metro
 * y medio de ahí, el ICP encaja el barrido contra la pared equivocada: sale una pose creíble,
 * con residuo mediano, y el mapa entero se construye desplazado. Pasó en la primera prueba de
 * verdad: obstáculos a 50-90 cm de los muebles reales con un residuo de 23 cm.
 *
 * Así que primero se barre una REJILLA de candidatos (posición × orientación) puntuando cada
 * uno por cuántos puntos caen sobre una pared, y el mejor se refina con el ICP. La puntuación
 * gruesa usa un submuestreo: lo que importa es descartar los candidatos malos, no medirlos.
 *
 * TECHO HONESTO: a ciegas, en una sala RECTANGULAR y lisa, esto no es de fiar, y no por el
 * algoritmo. Un barrido tomado en una esquina encaja perfecto en la opuesta (un rectángulo es
 * idéntico girado 180°), y con paredes largas y sin relieve hay además poses intermedias que
 * explican las paredes casi igual de bien: se midieron errores de 2-3 m con residuos de 2 cm.
 * La información no está en los datos.
 *
 * Por eso existe `cerca`: el cliente marca en el plano dónde está el robot (y el panel lo
 * ofrece antes de reconocer) y entonces solo queda resolver la orientación, que sí es fiable.
 * Es lo mismo que hace un aspirador comercial empezando siempre desde su base. En una sala en L
 * o con cualquier asimetría el problema se resuelve solo, y ahí a ciegas funciona.
 */
export function encajarGlobal(
  puntos: PuntoMedido[],
  paredes: Segmento[],
  vertices: Punto[],
  /** La pose con la que se generaron los puntos (`puntosDeBarrido`): el barrido es rígido. */
  semilla: Pose,
  opciones: {
    pasoCm?: number;
    orientaciones?: number;
    muestreo?: number;
    /**
     * Dónde buscar. Con un punto de partida (el que el cliente marca en el plano) la búsqueda
     * se limita a su alrededor y solo queda por resolver la orientación, que es mucho más
     * fiable: una sala rectangular y lisa tiene demasiadas poses que explican bien las paredes,
     * así que a ciegas no hay garantía ninguna (ver el comentario de la función).
     */
    cerca?: Punto | null;
    radioCm?: number;
  } = {},
): { pose: Pose; error: number; usados: number; puntuacion: number } {
  const paso = opciones.pasoCm ?? 40;
  // 12 orientaciones = 30° entre candidatas. Con 45° el refinado tiene que recuperar demasiado
  // ángulo y a veces no llega.
  const orientaciones = opciones.orientaciones ?? 12;
  const muestreo = opciones.muestreo ?? 60;
  const validos = puntos.filter((p) => p.d !== null);
  if (validos.length < 8) return { pose: semilla, error: Infinity, usados: 0, puntuacion: Infinity };

  // Submuestreo repartido por todo el barrido (no los 60 primeros, que son un solo sector).
  const salto = Math.max(1, Math.floor(validos.length / muestreo));
  const pocos = validos.filter((_, i) => i % salto === 0);
  const c = caja(vertices);
  const cerca = opciones.cerca ?? null;
  const radio = opciones.radioCm ?? 70;

  // Con punto de partida se barre solo su entorno (y más fino); sin él, la habitación entera.
  const desdeX = cerca ? Math.max(c.x, cerca.x - radio) : c.x + paso / 2;
  const hastaX = cerca ? Math.min(c.x + c.ancho, cerca.x + radio) : c.x + c.ancho;
  const desdeY = cerca ? Math.max(c.y, cerca.y - radio) : c.y + paso / 2;
  const hastaY = cerca ? Math.min(c.y + c.alto, cerca.y + radio) : c.y + c.alto;
  const pasoReal = cerca ? Math.min(paso, 20) : paso;

  // Se guardan las MEJORES K, no solo la mejor: entre candidatas hay 30° de orientación, y si la
  // buena cae justo entre dos, el refinado de la ganadora (que solo ajusta ±15°) no llega hasta
  // ella. Refinando las cinco primeras, el ángulo correcto entra en el intervalo de alguna.
  const CANDIDATAS = 5;
  const mejores: { pose: Pose; coste: number }[] = [];
  const guardar = (pose: Pose, coste: number) => {
    mejores.push({ pose, coste });
    mejores.sort((a, b) => a.coste - b.coste);
    if (mejores.length > CANDIDATAS) mejores.pop();
  };

  for (let y = desdeY; y <= hastaY; y += pasoReal) {
    for (let x = desdeX; x <= hastaX; x += pasoReal) {
      // Un candidato fuera de la habitación no es un candidato.
      if (!dentroDelPoligono(x, y, vertices)) continue;
      for (let i = 0; i < orientaciones; i++) {
        const candidata: Pose = { x, y, th: (360 / orientaciones) * i };
        // El mismo coste que usa el ICP para elegir candidato, y por la misma razón: cuenta
        // CUÁNTOS puntos caen sobre una pared, y los que no caen cuestan lo mismo fallen por
        // poco o por mucho. Con el coste lineal recortado que había antes ganaban las poses
        // difusas, y este encaje (el primero de una habitación, el que fija el marco de todo el
        // mapa) devolvía una esquina equivocada con 30 cm de residuo.
        let coste = 0;
        for (const p of recolocar(pocos, semilla, candidata)) {
          const d = masCercanoEnParedes(p.x, p.y, paredes).d;
          coste += d <= UMBRAL_GRUESO_CM ? d : TOPE_COSTE_CM;
        }
        guardar(candidata, coste);
      }
    }
  }

  // Refinado fino desde el mejor candidato. Sin reintentos de orientación: la rejilla ya ha
  // explorado el giro, y aquí solo se quiere pulir.
  let mejor = { pose: semilla, error: Infinity, usados: 0, puntuacion: Infinity };
  for (const { pose } of mejores) {
    // La nube SE MUEVE a la candidata antes de refinar. `encajarBarrido` da por hecho que los
    // puntos se midieron desde la semilla que recibe (de ahí parte su transformación rígida),
    // así que pasarle una candidata distinta con la nube todavía en el sitio de la semilla
    // original dejaba el barrido a metros de donde se le decía: el ajuste arrancaba descolocado
    // y se iba caminando. Era la causa de que una candidata gruesa acertada a 3 cm acabara
    // devolviendo una pose a 2 m.
    const r = encajarBarrido(recolocar(puntos, semilla, pose), paredes, pose, {
      reintentos: [0, -15, 15],
      vertices,
      // Con punto de partida, el refinado se queda en su entorno y TODAS las candidatas se
      // juzgan contra ese mismo punto: la búsqueda gruesa ya ha decidido la zona.
      maxDesvioCm: cerca ? radio : undefined,
      ancla: cerca,
    });
    // Por la PUNTUACIÓN, no por el residuo: el residuo mide lo bien que encajan los puntos que
    // ha elegido el ajuste, y elegir por él premia a quien elige pocos. Es el mismo error que
    // ya costó un rato dentro del propio ICP.
    if (r.puntuacion < mejor.puntuacion) mejor = r;
  }
  return mejor;
}

/** Rehace los puntos de un barrido rígido tras cambiar la pose: rota y traslada respecto a la semilla. */
function recolocar(puntos: PuntoMedido[], semilla: Pose, pose: Pose): PuntoMedido[] {
  const dth = pose.th - semilla.th;
  const cos = Math.cos(radianes(dth));
  const sin = Math.sin(radianes(dth));
  const mover = (x: number, y: number) => {
    const rx = x - semilla.x;
    const ry = y - semilla.y;
    return { x: pose.x + rx * cos - ry * sin, y: pose.y + rx * sin + ry * cos };
  };
  return puntos.map((p) => {
    const o = mover(p.ox, p.oy);
    const i = mover(p.x, p.y);
    return { ...p, ox: o.x, oy: o.y, dir: p.dir + dth, x: i.x, y: i.y };
  });
}

// ---------------------------------------------------------------------------
// Rejilla de ocupación
// ---------------------------------------------------------------------------

/** Lado de celda. 5 cm: una silla son 8 celdas de ancho y una sala de 5 m son 100×100. */
export const RESOLUCION_CM = 5;
/**
 * La rejilla guarda log-odds en Int8 (±127/ESCALA): 1 byte por celda y viaja en base64.
 *
 * La escala fija a la vez el paso de cuantización (1/ESCALA) y el techo (±127/ESCALA). Con 12
 * (paso 0.08, techo ±10.6) una sola medida de "libre" saturaba la celda de golpe y el mapa se
 * volvía binario: la ganancia del modelo entrenado se caía de +33 puntos a +4. Con 3 el paso
 * sigue siendo fino de sobra (0.33 de log-odds, que es ruido al lado de una medida) y el techo
 * ±42 deja que decenas de medidas se acumulen y se contradigan, que es de lo que vive el mapa.
 */
export const ESCALA_LOGODDS = 3;
/** Por encima de esto una celda se considera ocupada; por debajo del negativo, libre. */
export const UMBRAL_OCUPADO = 1.2;
export const UMBRAL_LIBRE = -0.8;

export interface Rejilla {
  /** Celdas de ancho y alto, y el lado de celda en cm. */
  cols: number;
  filas: number;
  res: number;
  datos: Int8Array;
}

export function crearRejilla(anchoCm: number, altoCm: number, res = RESOLUCION_CM): Rejilla {
  const cols = Math.max(1, Math.ceil(anchoCm / res));
  const filas = Math.max(1, Math.ceil(altoCm / res));
  return { cols, filas, res, datos: new Int8Array(cols * filas) };
}

export const logOdds = (r: Rejilla, cx: number, cy: number) => r.datos[cy * r.cols + cx] / ESCALA_LOGODDS;
export const probabilidad = (l: number) => 1 / (1 + Math.exp(-l));

function sumar(r: Rejilla, cx: number, cy: number, delta: number): void {
  if (cx < 0 || cy < 0 || cx >= r.cols || cy >= r.filas) return;
  const i = cy * r.cols + cx;
  const v = r.datos[i] + Math.round(delta * ESCALA_LOGODDS);
  r.datos[i] = Math.max(-127, Math.min(127, v));
}

/**
 * La rejilla viaja al navegador en base64: 100×100 celdas son 10 kB, 13 kB en base64.
 *
 * Con btoa/atob y no con Buffer, aunque el que serializa sea el backend: este paquete lo
 * comparten la API y la web, y tirar de Buffer obligaría al navegador a cargar los tipos de
 * Node. btoa existe en los dos desde Node 16.
 */
export function rejillaABase64(r: Rejilla): string {
  const bytes = new Uint8Array(r.datos.buffer, r.datos.byteOffset, r.datos.byteLength);
  let s = '';
  // De 8 kB en adelante, pasar el array entero a fromCharCode revienta la pila: por trozos.
  const TROZO = 4096;
  for (let i = 0; i < bytes.length; i += TROZO) {
    s += String.fromCharCode(...bytes.subarray(i, i + TROZO));
  }
  return btoa(s);
}

export function rejillaDeBase64(b64: string, cols: number, filas: number, res = RESOLUCION_CM): Rejilla {
  const bruto = atob(b64);
  const bytes = new Uint8Array(bruto.length);
  for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i);
  const datos = new Int8Array(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, cols * filas));
  const r = crearRejilla(cols * res, filas * res, res);
  r.datos.set(datos.subarray(0, r.datos.length));
  return r;
}

// ---------------------------------------------------------------------------
// Modelo inverso del sonar (la parte aprendida)
// ---------------------------------------------------------------------------

/** Semiancho del haz del HC-SR04. El cono real ronda los 15° totales; se abre algo más
    porque a incidencia oblicua el eco llega por un lóbulo lateral. */
export const SEMIHAZ_DEG = 11;
/** Media banda de incertidumbre radial alrededor de la medida, en cm. */
export const TOLERANCIA_CM = 4;
/** Sin eco, el sonar solo garantiza vacío hasta aquí: más allá no se afirma nada. */
export const SIN_ECO_FIABLE_CM = 120;

/**
 * Pesos del modelo inverso: cuánto log-odds suma una medida a las celdas del cono.
 *
 * Es una regresión logística con seis coeficientes sobre tres features (constante, ángulo
 * respecto al eje del haz, distancia relativa). No es una red: es el modelo que el problema
 * admite, y por eso se puede ENTRENAR contra verdad-terreno del simulador (lidar.entrenar.ts)
 * y comparar contra los valores a mano. Si el entrenamiento no gana nada medible, se queda el
 * de abajo: eso lo decide el número que imprime el entrenador, no la intuición.
 */
export interface PesosSonar {
  /** Celdas en la banda de la medida: ocupadas. */
  ocupBase: number;
  /** Cuánto se cree menos a medida larga (eco débil, cono ancho). Resta × (d / DIST_MAX). */
  ocupPorDistancia: number;
  /** Cuánto se cree menos fuera del eje del haz. Resta × (offset / SEMIHAZ). */
  ocupPorAngulo: number;
  /** Celdas por delante de la medida: libres. */
  libreBase: number;
  librePorDistancia: number;
  librePorAngulo: number;
  /** Medida sin eco: vacío flojo hasta SIN_ECO_FIABLE_CM. */
  libreSinEco: number;
}

/** Valores a mano: el punto de partida y el de comparación del entrenamiento. */
export const PESOS_A_MANO: PesosSonar = {
  ocupBase: 1.1,
  ocupPorDistancia: 0.7,
  ocupPorAngulo: 0.55,
  libreBase: 0.5,
  librePorDistancia: 0.2,
  librePorAngulo: 0.25,
  libreSinEco: 0.22,
};

/**
 * Pesos aprendidos con `pnpm --filter @iot/shared entrenar` (regresión logística sobre
 * barridos simulados con verdad-terreno). `mejora` es la ganancia de IoU medida sobre salas
 * que NO estaban en el entrenamiento, frente a PESOS_A_MANO.
 *
 * Si `mejora` es flojo (< 2 puntos), `PESOS` se queda con los de a mano: un modelo que no
 * mide mejor no entra, por bonito que suene. Ver el comentario de `PESOS`.
 */
export const PESOS_ENTRENADOS: PesosSonar & { mejora: number } = {
  // Salido de lidar.entrenar.ts el 2026-10-12: 24 salas de entreno, 6 de validación (para la
  // escala) y 16 de prueba, nunca vistas, 8 barridos cada una. IoU de la clase "ocupada" en las
  // de prueba: 19.5% a mano -> 32.4% entrenado.
  //
  // Lo que ha aprendido, en palabras: la evidencia de OCUPADO vale igual a cualquier distancia
  // y en todo el ancho del haz (sus dos coeficientes se van a cero), mientras que la de LIBRE
  // se cree menos lejos y fuera del eje. Y un no-eco no dice nada (libreSinEco = 0), que es
  // justo lo que pasa con una pared oblicua que no devuelve el pulso.
  ocupBase: 0.31,
  ocupPorDistancia: 0,
  ocupPorAngulo: 0,
  libreBase: 0.32,
  librePorDistancia: 0.16,
  librePorAngulo: 0.16,
  libreSinEco: 0,
  mejora: 13,
};

/** Los que se usan de verdad. El entrenador reescribe `mejora`; el umbral decide aquí. */
export const PESOS: PesosSonar = PESOS_ENTRENADOS.mejora >= 2 ? PESOS_ENTRENADOS : PESOS_A_MANO;

/**
 * Mete una medida en la rejilla: recorre las celdas del cono del haz y les suma log-odds.
 *
 * El recorrido es por celdas de la caja que cubre el cono, no por rayos: con rayos quedan
 * celdas sin tocar a distancias largas (el abanico se abre más rápido que la celda) y el mapa
 * sale rayado.
 */
export function integrarMedida(r: Rejilla, p: PuntoMedido, pesos: PesosSonar = PESOS): void {
  const alcance = p.d ?? SIN_ECO_FIABLE_CM;
  const limite = alcance + (p.d === null ? 0 : TOLERANCIA_CM);
  // Caja de celdas que puede tocar el cono.
  const margen = limite + r.res;
  const c0 = Math.max(0, Math.floor((p.ox - margen) / r.res));
  const c1 = Math.min(r.cols - 1, Math.ceil((p.ox + margen) / r.res));
  const f0 = Math.max(0, Math.floor((p.oy - margen) / r.res));
  const f1 = Math.min(r.filas - 1, Math.ceil((p.oy + margen) / r.res));

  for (let cy = f0; cy <= f1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      const px = (cx + 0.5) * r.res;
      const py = (cy + 0.5) * r.res;
      const dx = px - p.ox;
      const dy = py - p.oy;
      const rango = Math.hypot(dx, dy);
      if (rango > limite || rango < 1) continue;
      const offset = Math.abs(difAngular(grados(Math.atan2(dy, dx)), p.dir));
      if (offset > SEMIHAZ_DEG) continue;

      const fAng = offset / SEMIHAZ_DEG;
      const fDist = Math.min(1, alcance / DIST_MAX_CM);

      if (p.d === null) {
        // Sin eco: nada delante, pero flojo (también lo produce una pared oblicua que no
        // devuelve el eco, y por eso no puede pesar como una medida buena).
        sumar(r, cx, cy, -pesos.libreSinEco);
        continue;
      }
      if (rango < p.d - TOLERANCIA_CM) {
        const w = pesos.libreBase - pesos.librePorDistancia * fDist - pesos.librePorAngulo * fAng;
        if (w > 0) sumar(r, cx, cy, -w);
      } else if (rango <= p.d + TOLERANCIA_CM) {
        const w = pesos.ocupBase - pesos.ocupPorDistancia * fDist - pesos.ocupPorAngulo * fAng;
        if (w > 0) sumar(r, cx, cy, w);
      }
    }
  }
}

/** Integra un barrido entero. Devuelve cuántas medidas entraron. */
export function integrarBarrido(r: Rejilla, puntos: PuntoMedido[], pesos: PesosSonar = PESOS): number {
  let n = 0;
  for (const p of puntos) {
    integrarMedida(r, p, pesos);
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Obstáculos: de celdas a formas
// ---------------------------------------------------------------------------

export type FormaObstaculo = 'caja' | 'redondo' | 'alargado' | 'irregular';

export interface Obstaculo {
  id: number;
  forma: FormaObstaculo;
  /** Centro y caja orientada, en cm. `anguloDeg` es el giro de la caja. */
  cx: number;
  cy: number;
  anchoCm: number;
  altoCm: number;
  anguloDeg: number;
  /** Radio equivalente, para dibujar los redondos. */
  radioCm: number;
  celdas: number;
  /** Probabilidad media de ocupación de sus celdas: de 0.5 a 1. */
  confianza: number;
}

/** Celdas ocupadas que NO están pegadas a una pared, agrupadas en componentes conexas. */
export function detectarObstaculos(
  r: Rejilla,
  paredes: Segmento[],
  opciones: { margenParedCm?: number; celdasMinimas?: number } = {},
): Obstaculo[] {
  const margen = opciones.margenParedCm ?? 12;
  const minimas = opciones.celdasMinimas ?? 3;
  const ocupada = new Uint8Array(r.cols * r.filas);
  for (let cy = 0; cy < r.filas; cy++) {
    for (let cx = 0; cx < r.cols; cx++) {
      if (logOdds(r, cx, cy) < UMBRAL_OCUPADO) continue;
      const px = (cx + 0.5) * r.res;
      const py = (cy + 0.5) * r.res;
      // Pegado a una pared (o a una puerta) no es obstáculo: es la pared.
      if (masCercanoEnParedes(px, py, paredes).d <= margen) continue;
      ocupada[cy * r.cols + cx] = 1;
    }
  }

  // Cierre morfológico antes de etiquetar: el sonar deja huecos de sombra dentro de un mismo
  // mueble (cada barrido ve una cara distinta), y sin esto una mesa sale partida en tres
  // obstáculos y una maceta en dos. Se DILATA solo para decidir qué celdas son del mismo
  // objeto; las medidas (centro, caja, forma) salen de las celdas originales, que son las que
  // de verdad se midieron.
  const dilatada = new Uint8Array(ocupada.length);
  for (let cy = 0; cy < r.filas; cy++) {
    for (let cx = 0; cx < r.cols; cx++) {
      if (!ocupada[cy * r.cols + cx]) continue;
      for (let dy = -DILATACION; dy <= DILATACION; dy++) {
        for (let dx = -DILATACION; dx <= DILATACION; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= r.cols || ny >= r.filas) continue;
          dilatada[ny * r.cols + nx] = 1;
        }
      }
    }
  }

  const obstaculos: Obstaculo[] = [];
  const pila: number[] = [];
  for (let i = 0; i < dilatada.length; i++) {
    if (!dilatada[i]) continue;
    // Componente conexa a 8 vecinos (en 4, una diagonal parte un mueble en dos).
    const celdas: number[] = [];
    pila.push(i);
    dilatada[i] = 0;
    while (pila.length) {
      const j = pila.pop()!;
      if (ocupada[j]) celdas.push(j); // solo las medidas de verdad entran en la forma
      const jx = j % r.cols;
      const jy = (j - jx) / r.cols;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = jx + dx;
          const ny = jy + dy;
          if (nx < 0 || ny < 0 || nx >= r.cols || ny >= r.filas) continue;
          const k = ny * r.cols + nx;
          if (!dilatada[k]) continue;
          dilatada[k] = 0;
          pila.push(k);
        }
      }
    }
    if (celdas.length < minimas) continue;
    obstaculos.push(formaDe(r, celdas, obstaculos.length + 1));
  }
  return obstaculos.sort((a, b) => b.celdas - a.celdas);
}

/** Celdas de dilatación del cierre: a 5 cm por celda, une huecos de hasta 15 cm. */
const DILATACION = 1;

/**
 * Forma de una componente: centro, ejes principales (PCA) y caja orientada. La clase sale de
 * dos razones adimensionales — alargamiento (eje mayor / menor) y llenado (celdas / área de la
 * caja) — que es exactamente lo que distingue un sofá de una maceta.
 *
 * Aquí NO hay modelo aprendido a propósito: estas dos razones son deterministas y separan las
 * cuatro clases sin datos. Un clasificador entrenado solo añadiría pesos que ajustar.
 */
function formaDe(r: Rejilla, celdas: number[], id: number): Obstaculo {
  const n = celdas.length;
  const xs: number[] = [];
  const ys: number[] = [];
  let suma = 0;
  for (const i of celdas) {
    const cx = i % r.cols;
    const cy = (i - cx) / r.cols;
    xs.push((cx + 0.5) * r.res);
    ys.push((cy + 0.5) * r.res);
    suma += probabilidad(logOdds(r, cx, cy));
  }
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;

  // Matriz de covarianza y su eje mayor.
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  sxx /= n; syy /= n; sxy /= n;
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  // Caja orientada, con extensiones ROBUSTAS en vez de los extremos. El cono del haz (±11°)
  // desparrama los bordes del mueble hacia fuera unos centímetros, así que el mínimo y el
  // máximo de las celdas dan una caja ~20 cm más grande que el mueble: una mesa de 90×60 salía
  // de 108×82, y con esa caja inflada el ajuste de rectángulo no encajaba ni en su propio
  // mueble (todo se clasificaba como redondo). El percentil 90 alrededor de la mediana
  // aguanta ese desparrame y las celdas sueltas de un eco rebotado.
  const us: number[] = [];
  const vs: number[] = [];
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    us.push(dx * cos + dy * sin);
    vs.push(-dx * sin + dy * cos);
  }
  const mu = mediana(us);
  const mv = mediana(vs);
  // Las celdas son cuadrados de `res`: la extensión de sus centros se queda corta media celda.
  const hu = percentil(us.map((u) => Math.abs(u - mu)), 0.9) + r.res / 2;
  const hv = percentil(vs.map((v) => Math.abs(v - mv)), 0.9) + r.res / 2;
  const largo = 2 * hu;
  const ancho = 2 * hv;
  const area = n * r.res * r.res;
  const alargamiento = largo / Math.max(r.res, ancho);

  const cbx = mx + mu * cos - mv * sin;
  const cby = my + mu * sin + mv * cos;
  const clase = clasificar(xs, ys, cbx, cby, largo, ancho, theta, alargamiento, r.res);

  // En un redondo, el radio bueno es el del círculo AJUSTADO, no el del área de la mancha: la
  // mancha es la cara vista (un arco), así que sqrt(area/π) daba 10 cm para una maceta de 25.
  // El centro también se corrige al del círculo: el de la cáscara se va hacia el sensor.
  const redondo = clase.forma === 'redondo' && clase.circulo;
  const radioCm = redondo ? clase.circulo!.radio : Math.sqrt(area / Math.PI);

  return {
    id,
    forma: clase.forma,
    cx: redondo ? clase.circulo!.cx : cbx,
    cy: redondo ? clase.circulo!.cy : cby,
    anchoCm: Math.round((redondo ? radioCm * 2 : largo) * 10) / 10,
    altoCm: Math.round((redondo ? radioCm * 2 : ancho) * 10) / 10,
    anguloDeg: redondo ? 0 : Math.round(grados(theta) * 10) / 10,
    radioCm: Math.round(radioCm * 10) / 10,
    celdas: n,
    confianza: Math.round((suma / n) * 1000) / 1000,
  };
}

/**
 * Clase de la forma, con la pega del sonar de frente: un HC-SR04 solo ve la CARA de un mueble,
 * nunca su parte de atrás, así que la mancha de celdas es una cáscara y no un bloque relleno.
 * Medir "qué fracción del rectángulo está rellena" no distingue nada (todo sale irregular).
 *
 * Lo que sí distingue es a qué se parece esa cáscara: se ajusta un CÍRCULO y el PERÍMETRO de
 * la caja orientada, y gana el que deje menos residuo. La cara vista de una maceta es un arco
 * (residuo de círculo bajo); la de una mesa son dos rectas en ángulo (residuo de caja bajo).
 */
function clasificar(
  xs: number[],
  ys: number[],
  cbx: number,
  cby: number,
  largo: number,
  ancho: number,
  theta: number,
  alargamiento: number,
  res: number,
): { forma: FormaObstaculo; circulo?: { cx: number; cy: number; radio: number } } {
  const n = xs.length;
  if (alargamiento >= 3.5) return { forma: 'alargado' }; // pared suelta, sofá de canto, zócalo

  // Círculo por mínimos cuadrados (Kåsa): resolver a·x + b·y + c = x² + y² en 3 incógnitas.
  // Con menos de 5 celdas no hay forma que ajustar.
  let residuoCirculo = Infinity;
  let circulo: { cx: number; cy: number; radio: number } | undefined;
  if (n >= 5) {
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sz = 0, sxz = 0, syz = 0;
    for (let i = 0; i < n; i++) {
      const x = xs[i], y = ys[i], z = x * x + y * y;
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sz += z; sxz += x * z; syz += y * z;
    }
    // Sistema normal 3×3 por Cramer.
    const m = [
      [sxx, sxy, sx],
      [sxy, syy, sy],
      [sx, sy, n],
    ];
    const v = [sxz, syz, sz];
    const det3 = (a: number[][]) =>
      a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
      a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
      a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
    const d0 = det3(m);
    if (Math.abs(d0) > 1e-6) {
      const col = (j: number) => m.map((fila, i) => fila.map((c, k) => (k === j ? v[i] : c)));
      const a = det3(col(0)) / d0;
      const b = det3(col(1)) / d0;
      const c = det3(col(2)) / d0;
      const ccx = a / 2;
      const ccy = b / 2;
      const radio = Math.sqrt(Math.max(0, c + ccx * ccx + ccy * ccy));
      // Mediana y no RMS: unas pocas celdas sueltas (un eco rebotado, una esquina) inflaban el
      // residuo lo bastante para que una mesa se clasificara como redonda.
      residuoCirculo = mediana(xs.map((_, i) => Math.abs(Math.hypot(xs[i] - ccx, ys[i] - ccy) - radio)));
      // Un círculo ajustado a tres celdas en línea sale enorme: si no cabe en la mancha, no vale.
      if (radio > 0 && radio < Math.max(largo, ancho) * 1.5) circulo = { cx: ccx, cy: ccy, radio };
      else residuoCirculo = Infinity;
    }
  }

  // Perímetro de la caja orientada: distancia de cada celda al borde del rectángulo.
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const hu = largo / 2;
  const hv = ancho / 2;
  const residuoCaja = mediana(
    xs.map((_, i) => {
      const dx = xs[i] - cbx;
      const dy = ys[i] - cby;
      const u = Math.abs(dx * cos + dy * sin);
      const v2 = Math.abs(-dx * sin + dy * cos);
      // Dentro de la caja, la distancia al borde es la del lado más cercano.
      return Math.min(Math.abs(hu - u), Math.abs(hv - v2));
    }),
  );

  // El criterio es ABSOLUTO, no una comparación entre los dos residuos: esos dos números se
  // quedan a menudo a un pelo uno del otro y la clase se daba la vuelta con el ruido de un
  // barrido más. Lo que de verdad define un objeto redondo es que su radio apenas varíe
  // (media celda de desviación); el anillo de una mesa de 90×60 varía de 30 a 54 cm desde el
  // centro, así que su residuo de círculo es grande por geometría, no por ruido.
  if (residuoCirculo <= res * 0.9) return { forma: 'redondo', circulo };
  if (residuoCaja <= res * 1.6) return { forma: 'caja' };
  return { forma: 'irregular' };
}

function mediana(valores: number[]): number {
  return percentil(valores, 0.5);
}

function percentil(valores: number[], p: number): number {
  if (!valores.length) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  const i = (orden.length - 1) * p;
  const bajo = Math.floor(i);
  const alto = Math.ceil(i);
  return bajo === alto ? orden[bajo] : orden[bajo] + (orden[alto] - orden[bajo]) * (i - bajo);
}

/** Cuánto de la sala se ha explorado ya: celdas con una opinión / celdas dentro del polígono. */
export function cobertura(r: Rejilla, vertices: Punto[]): number {
  let dentro = 0;
  let conocidas = 0;
  for (let cy = 0; cy < r.filas; cy++) {
    for (let cx = 0; cx < r.cols; cx++) {
      if (!dentroDelPoligono((cx + 0.5) * r.res, (cy + 0.5) * r.res, vertices)) continue;
      dentro++;
      const l = logOdds(r, cx, cy);
      if (l >= UMBRAL_OCUPADO || l <= UMBRAL_LIBRE) conocidas++;
    }
  }
  return dentro ? conocidas / dentro : 0;
}

// ---------------------------------------------------------------------------
// Calibración por sonar (sin encoders, sin hardware nuevo)
// ---------------------------------------------------------------------------

/**
 * Grados por segundo de un giro sobre el eje, SIN encoders.
 *
 * El truco: girando en una habitación cerrada, el perfil de distancias del sensor central se
 * repite exactamente una vez por vuelta. Sacando el periodo de esa repetición (autocorrelación
 * de la serie temporal) sale el tiempo por revolución, y de ahí 360/T grados por segundo.
 *
 * Pide un giro de al menos dos vueltas y una habitación con relieve (una sala vacía y
 * perfectamente cuadrada da cuatro picos por vuelta: de ahí el `minimoMs`, que descarta los
 * periodos que son una fracción de la vuelta).
 */
export function periodoDeGiro(
  muestras: MuestraBarrido[],
  opciones: { minimoMs?: number; maximoMs?: number } = {},
): { periodoMs: number; gradosPorSegundo: number; confianza: number } | null {
  const minimo = opciones.minimoMs ?? 1500;
  const maximo = opciones.maximoMs ?? 20000;
  // Serie uniforme: la autocorrelación necesita paso constante y el muestreo del ESP32 baila.
  const serie = remuestrear(muestras, 50);
  if (serie.n < 40) return null;

  const media = serie.valores.reduce((a, b) => a + b, 0) / serie.n;
  const centrada = serie.valores.map((v) => v - media);
  const energia = centrada.reduce((a, v) => a + v * v, 0);
  if (energia < 1e-6) return null; // nada que correlacionar: el robot no vio relieve

  const desfaseMin = Math.max(2, Math.round(minimo / serie.pasoMs));
  const desfaseMax = Math.min(serie.n - 10, Math.round(maximo / serie.pasoMs));
  if (desfaseMax <= desfaseMin) return null;

  // Correlación cruzada normalizada sobre el trozo que solapa (no sobre la energía total: si
  // no, los desfases largos salen inflados y el máximo se va siempre al final de la serie).
  const correlacion: number[] = [];
  for (let k = desfaseMin; k <= desfaseMax; k++) {
    let suma = 0, ea = 0, eb = 0;
    for (let i = 0; i + k < serie.n; i++) {
      suma += centrada[i] * centrada[i + k];
      ea += centrada[i] * centrada[i];
      eb += centrada[i + k] * centrada[i + k];
    }
    correlacion.push(ea > 0 && eb > 0 ? suma / Math.sqrt(ea * eb) : 0);
  }

  const maximo2 = Math.max(...correlacion);
  if (maximo2 < 0.25) return null;
  // El fundamental, no sus múltiplos: una señal periódica correlaciona igual de bien a una
  // vuelta que a dos, y quedarse con el máximo global daba la mitad de los grados/segundo
  // reales. Se toma el desfase MÁS CORTO que llega al 90% del máximo.
  const indice = correlacion.findIndex((c) => c >= maximo2 * 0.9);
  const mejorDesfase = desfaseMin + indice;
  const mejorValor = correlacion[indice];

  const periodoMs = mejorDesfase * serie.pasoMs;
  return {
    periodoMs,
    gradosPorSegundo: Math.round((360000 / periodoMs) * 10) / 10,
    confianza: Math.round(Math.min(1, mejorValor) * 1000) / 1000,
  };
}

/**
 * cm/s avanzando, SIN encoders: el robot avanza de frente contra una pared y el sensor central
 * ve caer la distancia. La pendiente de esa recta (mínimos cuadrados) ES la velocidad.
 */
export function velocidadDeAvance(
  muestras: MuestraBarrido[],
): { cmPorSegundo: number; r2: number; muestras: number } | null {
  const pares = muestras
    .filter((m) => m.central !== null && m.central! >= DIST_MIN_CM && m.central! <= 200)
    .map((m) => ({ t: m.dt / 1000, d: m.central! }));
  if (pares.length < 8) return null;

  const n = pares.length;
  const mt = pares.reduce((a, p) => a + p.t, 0) / n;
  const md = pares.reduce((a, p) => a + p.d, 0) / n;
  let num = 0, den = 0;
  for (const p of pares) {
    num += (p.t - mt) * (p.d - md);
    den += (p.t - mt) ** 2;
  }
  if (den < 1e-6) return null;
  const pendiente = num / den; // negativa: se acerca a la pared

  // R²: si el robot no iba recto (o la pared no era pared), la recta no explica nada y el
  // número no vale. Mejor no calibrar que calibrar mal.
  let ssRes = 0, ssTot = 0;
  for (const p of pares) {
    const pred = md + pendiente * (p.t - mt);
    ssRes += (p.d - pred) ** 2;
    ssTot += (p.d - md) ** 2;
  }
  const r2 = ssTot < 1e-9 ? 0 : 1 - ssRes / ssTot;
  if (pendiente >= 0 || r2 < 0.8) return null;

  return { cmPorSegundo: Math.round(-pendiente * 10) / 10, r2: Math.round(r2 * 1000) / 1000, muestras: n };
}

/** Serie del sensor central a paso fijo, rellenando los huecos sin eco con el último valor. */
function remuestrear(muestras: MuestraBarrido[], pasoMs: number): { valores: number[]; n: number; pasoMs: number } {
  const utiles = muestras.filter((m) => m.central !== null);
  if (!utiles.length) return { valores: [], n: 0, pasoMs };
  const fin = muestras[muestras.length - 1].dt;
  const valores: number[] = [];
  let i = 0;
  let ultimo = utiles[0].central!;
  for (let t = 0; t <= fin; t += pasoMs) {
    while (i < utiles.length && utiles[i].dt <= t) ultimo = utiles[i++].central!;
    valores.push(ultimo);
  }
  return { valores, n: valores.length, pasoMs };
}
