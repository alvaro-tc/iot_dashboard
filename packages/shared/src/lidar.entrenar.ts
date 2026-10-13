// Entrenamiento del modelo inverso del sonar:  node src/lidar.entrenar.ts
//
// QUÉ SE APRENDE Y POR QUÉ ESTO ES ENTRENABLE
// `integrarMedida` suma a cada celda del cono un incremento de log-odds de la forma
//     ±(base − porDistancia·fDist − porAngulo·fAng)
// que es LINEAL en los siete pesos. El log-odds final de una celda es la suma de todas las
// medidas que la tocaron, así que también es lineal:  logodds(celda) = w · Φ(celda), con Φ
// las features acumuladas. Y la probabilidad de ocupación es σ(w · Φ).
//
// Es decir: el modelo inverso del sonar ES una regresión logística, y se puede ajustar por
// máxima verosimilitud contra verdad-terreno. No hace falta ninguna red, y los siete números
// que salen siguen siendo legibles y acotables a mano (nada de pesos opacos).
//
// LOS DATOS SALEN GRATIS
// El simulador da la verdad-terreno que el robot real nunca tendría: se generan salas al azar
// (rectangulares y en L) con muebles, se simulan barridos desde poses conocidas, y cada celda
// viene etiquetada como ocupada o libre. Se entrena con unas salas y se MIDE con otras que no
// se vieron en el entrenamiento.
//
// LA REGLA
// Si la ganancia de IoU sobre los pesos a mano no llega a 2 puntos, los pesos entrenados NO se
// usan: `PESOS` en lidar.ts se queda con `PESOS_A_MANO`. Un modelo que no mide mejor no entra.
import {
  DIST_MAX_CM,
  SENSORES,
} from './robot.ts';
import {
  GEOMETRIA_POR_DEFECTO,
  PESOS_A_MANO,
  SEMIHAZ_DEG,
  SIN_ECO_FIABLE_CM,
  TOLERANCIA_CM,
  UMBRAL_OCUPADO,
  crearRejilla,
  integrarBarrido,
  logOdds,
  dentroDelPoligono,
  difAngular,
  formaL,
  grados,
  paredesDe,
  puntosDeBarrido,
  radianes,
  rayo,
  rectangulo,
  type MuestraBarrido,
  type PesosSonar,
  type Pose,
  type Punto,
  type PuntoMedido,
  type Segmento,
} from './lidar.ts';

const geo = GEOMETRIA_POR_DEFECTO;
/** Orden fijo de los pesos: el vector w y el objeto PesosSonar son la misma cosa. */
const CLAVES = [
  'ocupBase',
  'ocupPorDistancia',
  'ocupPorAngulo',
  'libreBase',
  'librePorDistancia',
  'librePorAngulo',
  'libreSinEco',
] as const satisfies readonly (keyof PesosSonar)[];
const D = CLAVES.length;

const aVector = (p: PesosSonar) => CLAVES.map((k) => p[k]);
const aPesos = (w: number[]): PesosSonar =>
  Object.fromEntries(CLAVES.map((k, i) => [k, w[i]])) as unknown as PesosSonar;

function prng(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Generación de salas con verdad-terreno
// ---------------------------------------------------------------------------

type Mueble =
  | { tipo: 'caja'; cx: number; cy: number; w: number; h: number }
  | { tipo: 'circulo'; cx: number; cy: number; r: number };

interface Escenario {
  vertices: Punto[];
  muebles: Mueble[];
  paredes: Segmento[];
  mundo: Segmento[];
  poses: Pose[];
  anchoCm: number;
  altoCm: number;
}

function segmentosDeMueble(m: Mueble): Segmento[] {
  if (m.tipo === 'caja') {
    const { cx, cy, w, h } = m;
    return [
      { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy - h / 2 },
      { x1: cx + w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 },
      { x1: cx + w / 2, y1: cy + h / 2, x2: cx - w / 2, y2: cy + h / 2 },
      { x1: cx - w / 2, y1: cy + h / 2, x2: cx - w / 2, y2: cy - h / 2 },
    ];
  }
  const lados: Segmento[] = [];
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * 2 * Math.PI;
    const a1 = ((i + 1) / 16) * 2 * Math.PI;
    lados.push({
      x1: m.cx + m.r * Math.cos(a0), y1: m.cy + m.r * Math.sin(a0),
      x2: m.cx + m.r * Math.cos(a1), y2: m.cy + m.r * Math.sin(a1),
    });
  }
  return lados;
}

const enMueble = (x: number, y: number, m: Mueble) =>
  m.tipo === 'caja'
    ? Math.abs(x - m.cx) <= m.w / 2 && Math.abs(y - m.cy) <= m.h / 2
    : Math.hypot(x - m.cx, y - m.cy) <= m.r;

function generarEscenario(rnd: () => number, barridos: number): Escenario {
  const ancho = 300 + Math.floor(rnd() * 350);
  const alto = 280 + Math.floor(rnd() * 320);
  // Una de cada tres, en L: el modelo tiene que valer también donde la pared gira.
  const vertices =
    rnd() < 0.33
      ? formaL(ancho, alto, 80 + rnd() * (ancho * 0.4), 80 + rnd() * (alto * 0.4))
      : rectangulo(ancho, alto);

  const muebles: Mueble[] = [];
  const cuantos = 1 + Math.floor(rnd() * 4);
  let intentos = 0;
  while (muebles.length < cuantos && intentos++ < 60) {
    const cx = 60 + rnd() * (ancho - 120);
    const cy = 60 + rnd() * (alto - 120);
    if (!dentroDelPoligono(cx, cy, vertices)) continue;
    const m: Mueble =
      rnd() < 0.5
        ? { tipo: 'caja', cx, cy, w: 40 + rnd() * 90, h: 30 + rnd() * 70 }
        : { tipo: 'circulo', cx, cy, r: 15 + rnd() * 30 };
    // Que no se solapen entre sí: dos muebles pegados son un mueble, y la etiqueta se lía.
    if (muebles.some((o) => Math.hypot(o.cx - m.cx, o.cy - m.cy) < 110)) continue;
    muebles.push(m);
  }

  const paredes = paredesDe({ vertices, puertas: [] });
  const mundo = [...paredes, ...muebles.flatMap(segmentosDeMueble)];

  // Poses de barrido: dentro de la sala, lejos de las paredes y fuera de los muebles.
  const poses: Pose[] = [];
  intentos = 0;
  while (poses.length < barridos && intentos++ < 200) {
    const x = 50 + rnd() * (ancho - 100);
    const y = 50 + rnd() * (alto - 100);
    if (!dentroDelPoligono(x, y, vertices)) continue;
    if (muebles.some((m) => enMueble(x, y, m))) continue;
    if (muebles.some((m) => Math.hypot(m.cx - x, m.cy - y) < 55)) continue;
    poses.push({ x, y, th: rnd() * 360 });
  }

  return { vertices, muebles, paredes, mundo, poses, anchoCm: ancho, altoCm: alto };
}

/** Barrido simulado: idéntico al de lidar.check.ts (girar sobre el eje y medir). */
function barridoSimulado(pose: Pose, mundo: Segmento[], omega: number, rnd: () => number): MuestraBarrido[] {
  const muestras: MuestraBarrido[] = [];
  const duracion = (360 / Math.abs(omega)) * 1000;
  for (let dt = 0; dt <= duracion; dt += 50) {
    const th = pose.th + omega * (dt / 1000);
    const c = Math.cos(radianes(th));
    const s = Math.sin(radianes(th));
    const m: MuestraBarrido = { dt, izquierdo: null, central: null, derecho: null };
    for (const sensor of SENSORES) {
      const mont = geo.sensores[sensor];
      const d = rayo(pose.x + mont.x * c - mont.y * s, pose.y + mont.x * s + mont.y * c, th + mont.anguloDeg, mundo);
      m[sensor] = d > DIST_MAX_CM || rnd() < 0.02 ? null : Math.round((d + (rnd() - 0.5) * 2) * 10) / 10;
    }
    muestras.push(m);
  }
  return muestras;
}

// ---------------------------------------------------------------------------
// Features acumuladas por celda (el mismo recorrido que integrarMedida)
// ---------------------------------------------------------------------------

interface Muestra {
  /** Features acumuladas de la celda: logodds = w · phi. */
  phi: Float64Array;
  /** 1 = ocupada de verdad, 0 = libre de verdad. */
  etiqueta: number;
}

/**
 * Recorre el cono de cada medida igual que `integrarMedida`, pero en vez de sumar log-odds
 * acumula las features. Si esta función y `integrarMedida` se separan, el modelo entrenado
 * dejaría de corresponder con el que se usa en producción: van juntas a propósito.
 */
function acumular(phis: Float64Array, cols: number, filas: number, res: number, p: PuntoMedido): void {
  const alcance = p.d ?? SIN_ECO_FIABLE_CM;
  const limite = alcance + (p.d === null ? 0 : TOLERANCIA_CM);
  const margen = limite + res;
  const c0 = Math.max(0, Math.floor((p.ox - margen) / res));
  const c1 = Math.min(cols - 1, Math.ceil((p.ox + margen) / res));
  const f0 = Math.max(0, Math.floor((p.oy - margen) / res));
  const f1 = Math.min(filas - 1, Math.ceil((p.oy + margen) / res));

  for (let cy = f0; cy <= f1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      const px = (cx + 0.5) * res;
      const py = (cy + 0.5) * res;
      const dx = px - p.ox;
      const dy = py - p.oy;
      const rango = Math.hypot(dx, dy);
      if (rango > limite || rango < 1) continue;
      const offset = Math.abs(difAngular(grados(Math.atan2(dy, dx)), p.dir));
      if (offset > SEMIHAZ_DEG) continue;

      const fAng = offset / SEMIHAZ_DEG;
      const fDist = Math.min(1, alcance / DIST_MAX_CM);
      const base = (cy * cols + cx) * D;

      if (p.d === null) {
        phis[base + 6] -= 1; // −libreSinEco
      } else if (rango < p.d - TOLERANCIA_CM) {
        // Contribución −(libreBase − lpd·fDist − lpa·fAng)
        phis[base + 3] -= 1;
        phis[base + 4] += fDist;
        phis[base + 5] += fAng;
      } else if (rango <= p.d + TOLERANCIA_CM) {
        // Contribución +(ocupBase − opd·fDist − opa·fAng)
        phis[base + 0] += 1;
        phis[base + 1] -= fDist;
        phis[base + 2] -= fAng;
      }
    }
  }
}

/** Features + etiqueta de todas las celdas con opinión de un escenario. */
function muestrasDe(esc: Escenario, rnd: () => number, omega = 60): Muestra[] {
  const r = crearRejilla(esc.anchoCm, esc.altoCm);
  const phis = new Float64Array(r.cols * r.filas * D);
  for (const pose of esc.poses) {
    const muestras = barridoSimulado(pose, esc.mundo, omega, rnd);
    for (const p of puntosDeBarrido(muestras, pose, omega, geo)) acumular(phis, r.cols, r.filas, r.res, p);
  }

  const salida: Muestra[] = [];
  for (let cy = 0; cy < r.filas; cy++) {
    for (let cx = 0; cx < r.cols; cx++) {
      const base = (cy * r.cols + cx) * D;
      const phi = phis.subarray(base, base + D);
      // Celdas que nadie miró no enseñan nada.
      let tocada = false;
      for (let i = 0; i < D; i++) if (phi[i] !== 0) tocada = true;
      if (!tocada) continue;

      const px = (cx + 0.5) * r.res;
      const py = (cy + 0.5) * r.res;
      const fuera = !dentroDelPoligono(px, py, esc.vertices);
      const mueble = esc.muebles.some((m) => enMueble(px, py, m));
      salida.push({ phi: new Float64Array(phi), etiqueta: fuera || mueble ? 1 : 0 });
    }
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Ajuste y medida
// ---------------------------------------------------------------------------

const sigmoide = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

/**
 * Regresión logística por descenso de gradiente con las clases reequilibradas (hay muchas más
 * celdas libres que ocupadas; sin reequilibrar, el óptimo es decir "todo libre").
 *
 * Los pesos se mantienen ≥ 0: un peso negativo significaría "ver un eco a 2 m hace la celda
 * MÁS libre", que no es un modelo de sonar sino un artefacto del ajuste.
 */
function ajustar(datos: Muestra[], vueltas = 400, paso = 0.35): number[] {
  const w = aVector(PESOS_A_MANO); // arrancar de lo conocido, no de ceros
  const ocupadas = datos.filter((d) => d.etiqueta === 1).length;
  const libres = datos.length - ocupadas;
  const pesoClase = [datos.length / (2 * Math.max(1, libres)), datos.length / (2 * Math.max(1, ocupadas))];

  for (let v = 0; v < vueltas; v++) {
    const grad = new Float64Array(D);
    let total = 0;
    for (const { phi, etiqueta } of datos) {
      let z = 0;
      for (let i = 0; i < D; i++) z += w[i] * phi[i];
      const err = (sigmoide(z) - etiqueta) * pesoClase[etiqueta];
      for (let i = 0; i < D; i++) grad[i] += err * phi[i];
      total += pesoClase[etiqueta];
    }
    for (let i = 0; i < D; i++) w[i] = Math.max(0, w[i] - (paso * grad[i]) / total);
    proyectar(w);
  }
  return w;
}

/**
 * Devuelve los pesos a la región que `integrarMedida` ejecuta de verdad.
 *
 * Producción descarta la contribución cuando (base − porDistancia·fDist − porAngulo·fAng) sale
 * negativa (`if (w > 0)`), porque una medida no puede aportar evidencia del signo contrario.
 * El gradiente sin restringir se aprovechaba justo de eso: aprendía librePorAngulo = 12.4 con
 * libreBase = 10.6, o sea rayos de "libre" fuera del eje contando como ocupado — algo que el
 * código de producción nunca hace. Resultado: +33 puntos en el papel, +4 de verdad.
 *
 * Como fDist y fAng viven en [0,1], basta exigir base ≥ porDistancia + porAngulo. Si se pasa,
 * se encogen los dos coeficientes a proporción en vez de recortar uno: así se conserva su
 * relación, que es lo que el ajuste ha aprendido.
 */
function proyectar(w: number[]): void {
  for (const [base, a, b] of [
    [0, 1, 2],
    [3, 4, 5],
  ]) {
    const suma = w[a] + w[b];
    if (suma > w[base] && suma > 1e-9) {
      const factor = w[base] / suma;
      w[a] *= factor;
      w[b] *= factor;
    }
  }
}

/** IoU de la clase "ocupada" con el umbral que usa el dashboard. */
function iou(datos: Muestra[], w: number[]): number {
  let inter = 0;
  let union = 0;
  for (const { phi, etiqueta } of datos) {
    let z = 0;
    for (let i = 0; i < D; i++) z += w[i] * phi[i];
    const pred = z >= UMBRAL_OCUPADO ? 1 : 0;
    if (pred && etiqueta) inter++;
    if (pred || etiqueta) union++;
  }
  return union ? inter / union : 0;
}

/**
 * La misma medida, pero con la TUBERÍA DE VERDAD: `integrarBarrido` sobre la rejilla Int8.
 *
 * Hace falta porque el ajuste de arriba trabaja con la suma lineal sin recortar, y la rejilla
 * real satura a ±127/ESCALA. Unos pesos grandes pueden ganar en el papel y saturar en cuanto
 * entran dos barridos, así que la ganancia que cuenta es esta, no la del modelo lineal.
 */
function iouReal(escenarios: Escenario[], pesos: PesosSonar, rnd: () => number, omega = 60): number {
  let inter = 0;
  let union = 0;
  for (const esc of escenarios) {
    const r = crearRejilla(esc.anchoCm, esc.altoCm);
    for (const pose of esc.poses) {
      integrarBarrido(r, puntosDeBarrido(barridoSimulado(pose, esc.mundo, omega, rnd), pose, omega, geo), pesos);
    }
    for (let cy = 0; cy < r.filas; cy++) {
      for (let cx = 0; cx < r.cols; cx++) {
        const l = logOdds(r, cx, cy);
        if (l === 0) continue; // celda sin opinión: no entra en la cuenta
        const px = (cx + 0.5) * r.res;
        const py = (cy + 0.5) * r.res;
        const real =
          !dentroDelPoligono(px, py, esc.vertices) || esc.muebles.some((m) => enMueble(px, py, m)) ? 1 : 0;
        const pred = l >= UMBRAL_OCUPADO ? 1 : 0;
        if (pred && real) inter++;
        if (pred || real) union++;
      }
    }
  }
  return union ? inter / union : 0;
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

const SALAS_ENTRENO = 24;
const SALAS_PRUEBA = 16;
const BARRIDOS = 8;

const rnd = prng(2026);
console.log(`generando ${SALAS_ENTRENO} salas de entrenamiento y ${SALAS_PRUEBA} de prueba, ${BARRIDOS} barridos cada una…`);

const entreno: Muestra[] = [];
for (let i = 0; i < SALAS_ENTRENO; i++) entreno.push(...muestrasDe(generarEscenario(rnd, BARRIDOS), rnd));
const escenariosPrueba: Escenario[] = [];
for (let i = 0; i < SALAS_PRUEBA; i++) escenariosPrueba.push(generarEscenario(rnd, BARRIDOS));
const prueba: Muestra[] = escenariosPrueba.flatMap((e) => muestrasDe(e, rnd));

console.log(`celdas: ${entreno.length} de entreno, ${prueba.length} de prueba`);

const aMano = aVector(PESOS_A_MANO);
const ajustados = ajustar(entreno);

/**
 * El ajuste logístico fija la DIRECCIÓN de los pesos, pero no su escala útil: el modelo lineal
 * es casi invariante a escala (multiplicar w por 3 multiplica el log-odds por 3 y reordena poco),
 * mientras que la rejilla real NO lo es, porque satura a ±127/ESCALA y porque el umbral de
 * "ocupada" está fijo. Con los pesos crudos (libreBase 10.6) dos barridos saturan la celda y el
 * mapa se vuelve binario: la ganancia caía de +33 a +4 puntos.
 *
 * Así que la escala se elige midiendo la tubería de verdad, en salas de VALIDACIÓN distintas de
 * las de entrenamiento y de las de prueba. Son siete evaluaciones: más barato que meter el
 * recorte dentro del gradiente, y optimiza justo lo que se entrega.
 */
const escenariosValidacion: Escenario[] = [];
for (let i = 0; i < 6; i++) escenariosValidacion.push(generarEscenario(rnd, 4));

let mejorEscala = 1;
let mejorIou = -1;
console.log('\nbuscando la escala que mejor va en la rejilla real:');
for (const s of [0.08, 0.12, 0.18, 0.25, 0.35, 0.5, 0.75, 1]) {
  const v = iouReal(escenariosValidacion, aPesos(ajustados.map((x) => x * s)), prng(55));
  console.log(`  escala ${s.toFixed(2)}  IoU validación ${(v * 100).toFixed(1)}%`);
  if (v > mejorIou) {
    mejorIou = v;
    mejorEscala = s;
  }
}
console.log(`  -> escala elegida ${mejorEscala}`);
const entrenados = ajustados.map((x) => Math.round(x * mejorEscala * 100) / 100);

const iouMano = iou(prueba, aMano);
const iouEntrenado = iou(prueba, entrenados);
const mejora = (iouEntrenado - iouMano) * 100;

console.log('\npesos a mano :', aMano.map((x) => x.toFixed(2)).join(' '));
console.log('pesos ajustados:', entrenados.map((x) => x.toFixed(2)).join(' '));
console.log(`\nmodelo lineal (sin recortar), salas NO vistas:`);
console.log(`  IoU a mano ${(iouMano * 100).toFixed(1)}%   entrenado ${(iouEntrenado * 100).toFixed(1)}%   (${mejora >= 0 ? '+' : ''}${mejora.toFixed(1)} puntos)`);

// La medida que decide: la rejilla Int8 de verdad, con su saturación.
const realMano = iouReal(escenariosPrueba, PESOS_A_MANO, prng(99));
const realEntrenado = iouReal(escenariosPrueba, aPesos(entrenados), prng(99));
const mejoraReal = (realEntrenado - realMano) * 100;
console.log(`tubería real (rejilla Int8), salas NO vistas:`);
console.log(`  IoU a mano ${(realMano * 100).toFixed(1)}%   entrenado ${(realEntrenado * 100).toFixed(1)}%   (${mejoraReal >= 0 ? '+' : ''}${mejoraReal.toFixed(1)} puntos)  <-- la que cuenta`);

if (mejoraReal >= 2) {
  console.log('\nGana el entrenado. Copiar en PESOS_ENTRENADOS de lidar.ts:');
  console.log(
    JSON.stringify({ ...aPesos(entrenados), mejora: Math.round(mejoraReal * 10) / 10 }, (_k, v) =>
      typeof v === 'number' ? Math.round(v * 100) / 100 : v,
    ),
  );
} else {
  console.log('\nNo gana lo suficiente (< 2 puntos): se queda PESOS_A_MANO. Poner mejora: 0 en PESOS_ENTRENADOS.');
}
