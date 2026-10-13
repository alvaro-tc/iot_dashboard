// Autocheck del lidar de sonar giratorio: node src/lidar.check.ts
//
// No prueba "que compile": prueba que la idea funciona. Genera barridos sintéticos con los
// tres HC-SR04 en una sala conocida (rectangular y en L), con ruido y ecos perdidos como los
// del sensor real, y comprueba que:
//
//   1. el encaje recupera la pose aunque la semilla venga desviada metros y decenas de grados,
//   2. la rejilla de ocupación encuentra los obstáculos donde están y con su forma,
//   3. la calibración saca los grados/segundo y los cm/s sin encoders.
//
// Si algo de esto se rompe, el mapa del dashboard sale mal y aquí se ve antes.
import {
  CALIBRACION_POR_DEFECTO,
  GEOMETRIA_POR_DEFECTO,
  crearRejilla,
  detectarObstaculos,
  encajarBarrido,
  encajarGlobal,
  campoDeCercania,
  formaL,
  dentroDelPoligono,
  integrarBarrido,
  masCercanoEnParedes,
  paredesDe,
  ponerDentro,
  periodoDeGiro,
  puntosDeBarrido,
  rayo,
  rectangulo,
  radianes,
  rejillaABase64,
  difAngular,
  rejillaDeBase64,
  separacionEfectivaCm,
  avanzarPose,
  velocidadDeAvance,
  type GeometriaRobot,
  type MuestraBarrido,
  type Pose,
  type Punto,
  type Segmento,
} from './lidar.ts';
import { CONFIG_POR_DEFECTO, DIST_MAX_CM, SENSORES } from './robot.ts';
import { DISTANCIA_RUEDAS_SIM, RobotSimulado, VEL_MAX_CM_S_SIM } from './simulacion.ts';

const geo: GeometriaRobot = GEOMETRIA_POR_DEFECTO;

/** PRNG determinista: el check no puede fallar una vez de cada diez. */
function prng(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rect = (cx: number, cy: number, w: number, h: number): Segmento[] => [
  { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy - h / 2 },
  { x1: cx + w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 },
  { x1: cx + w / 2, y1: cy + h / 2, x2: cx - w / 2, y2: cy + h / 2 },
  { x1: cx - w / 2, y1: cy + h / 2, x2: cx - w / 2, y2: cy - h / 2 },
];

/**
 * Barrido sintético: el robot gira sobre su eje a `omega` grados/s y los tres sensores miden
 * contra `mundo` (paredes + muebles). Mismo ruido y mismos fallos de eco que el simulador.
 */
function barridoSimulado(
  pose: Pose,
  mundo: Segmento[],
  omega: number,
  opciones: { pasoMs?: number; vueltas?: number; semilla?: number } = {},
): MuestraBarrido[] {
  const paso = opciones.pasoMs ?? 50;
  const vueltas = opciones.vueltas ?? 1;
  const rnd = prng(opciones.semilla ?? 7);
  const duracion = (360 * vueltas) / Math.abs(omega) * 1000;
  const muestras: MuestraBarrido[] = [];

  for (let dt = 0; dt <= duracion; dt += paso) {
    const th = pose.th + omega * (dt / 1000);
    const c = Math.cos(radianes(th));
    const s = Math.sin(radianes(th));
    const m: MuestraBarrido = { dt, izquierdo: null, central: null, derecho: null };
    for (const sensor of SENSORES) {
      const mont = geo.sensores[sensor];
      const ox = pose.x + mont.x * c - mont.y * s;
      const oy = pose.y + mont.x * s + mont.y * c;
      const d = rayo(ox, oy, th + mont.anguloDeg, mundo);
      // Fuera de alcance o eco perdido (1 de cada 50, como el HC-SR04 real).
      m[sensor] = d > DIST_MAX_CM || rnd() < 0.02 ? null : Math.round((d + (rnd() - 0.5) * 2) * 10) / 10;
    }
    muestras.push(m);
  }
  return muestras;
}

let fallos = 0;
function comprobar(nombre: string, ok: boolean, detalle = ''): void {
  console.log(`${ok ? 'ok  ' : 'FALLO'} ${nombre}${detalle ? `  ${detalle}` : ''}`);
  if (!ok) fallos++;
}

// ---------------------------------------------------------------------------
// 1. Encaje de la pose
// ---------------------------------------------------------------------------

function pruebaEncaje(
  nombre: string,
  vertices: Punto[],
  muebles: Segmento[],
  real: Pose,
  semilla: Pose,
  omega = 60,
): void {
  const sala = { vertices, puertas: [] };
  const paredes = paredesDe(sala);
  const mundo = [...paredes, ...muebles];
  const muestras = barridoSimulado(real, mundo, omega, { semilla: 11 });

  // El backend solo conoce la semilla (odometría), no la pose real.
  const puntos = puntosDeBarrido(muestras, semilla, omega, geo);
  const r = encajarBarrido(puntos, paredes, semilla);

  const errorPos = Math.hypot(r.pose.x - real.x, r.pose.y - real.y);
  const errorAng = Math.abs(((r.pose.th - real.th + 540) % 360) - 180);
  comprobar(
    `${nombre}: pose recuperada`,
    errorPos < 18 && errorAng < 8,
    `error ${errorPos.toFixed(1)} cm / ${errorAng.toFixed(1)}°, residuo ${r.error.toFixed(1)} cm`,
  );
}

const SALA_RECT = rectangulo(500, 400);
const MUEBLES_RECT = [
  ...rect(140, 300, 120, 60), // sofá
  ...rect(360, 120, 80, 80), // mesa
];

pruebaEncaje('rectangular, semilla buena', SALA_RECT, MUEBLES_RECT, { x: 250, y: 200, th: 30 }, { x: 250, y: 200, th: 30 });
pruebaEncaje(
  'rectangular, semilla desviada 40 cm y 25°',
  SALA_RECT,
  MUEBLES_RECT,
  { x: 250, y: 200, th: 30 },
  { x: 290, y: 175, th: 55 },
);
pruebaEncaje(
  'rectangular, robot descentrado',
  SALA_RECT,
  MUEBLES_RECT,
  { x: 120, y: 90, th: 200 },
  { x: 150, y: 120, th: 215 },
);

// En L: el mismo ICP sin tocar nada, que es la razón de modelar la sala como polígono.
const SALA_L = formaL(500, 420, 200, 180);
const MUEBLES_L = rect(120, 120, 90, 50);
pruebaEncaje('en L, semilla desviada', SALA_L, MUEBLES_L, { x: 150, y: 250, th: 100 }, { x: 185, y: 220, th: 118 });
pruebaEncaje('en L, en el brazo corto', SALA_L, MUEBLES_L, { x: 380, y: 140, th: 310 }, { x: 350, y: 160, th: 330 });

// Dibujo libre: un cuarto con paredes en diagonal (aquí un triángulo). El panel deja dibujarlo
// a mano alzada, así que hay que comprobar que el encaje no dependía de que las paredes fueran
// ortogonales: trabaja contra las aristas del polígono, le da igual su ángulo.
const SALA_TRIANGULO: Punto[] = [
  { x: 0, y: 0 },
  { x: 500, y: 0 },
  { x: 250, y: 420 },
];
const MUEBLES_TRIANGULO = rect(250, 120, 90, 50);
pruebaEncaje(
  'triángulo (dibujo libre), semilla desviada',
  SALA_TRIANGULO,
  MUEBLES_TRIANGULO,
  { x: 250, y: 150, th: 70 },
  { x: 220, y: 175, th: 88 },
);
comprobar(
  'triángulo: tres paredes, y el centro cae dentro',
  paredesDe({ vertices: SALA_TRIANGULO, puertas: [] }).length === 3 &&
    dentroDelPoligono(250, 140, SALA_TRIANGULO) &&
    !dentroDelPoligono(20, 400, SALA_TRIANGULO),
);

// Encaje GLOBAL, y el techo honesto de un sonar en una sala simétrica.
//
// Al reconocer una habitación por primera vez no se sabe dónde está el robot: lo único
// razonable es suponer el centro. Probándolo de verdad salió algo que conviene tener escrito:
// en un rectángulo, un barrido tomado en una esquina encaja PERFECTAMENTE (residuo 0,5 cm) en
// la esquina opuesta, porque un rectángulo es idéntico girado 180°. No es un fallo del ajuste,
// es que la orientación absoluta no está en los datos. Un mapa girado 180° sigue siendo un mapa
// correcto de la habitación; lo que no puede pasar es que los barridos se contradigan ENTRE SÍ,
// porque entonces el mapa sale sucio. Eso es lo que se comprueba aquí.
{
  const sala = { vertices: SALA_RECT, puertas: [] };
  const paredes = paredesDe(sala);
  const mundo = [...paredes, ...MUEBLES_RECT];
  const centro: Pose = { x: 250, y: 200, th: 0 };
  /** La imagen de la pose girada 180° sobre el centro: la otra solución válida del rectángulo. */
  const girada = (p: Pose): Pose => ({ x: 500 - p.x, y: 400 - p.y, th: p.th + 180 });

  // CON PUNTO DE PARTIDA (lo que hace el panel: el cliente marca en el plano dónde está el
  // robot antes de reconocer). La posición se da con 40 cm de error y la orientación es
  // desconocida: eso sí se resuelve, y es lo que convierte el primer barrido en fiable.
  for (const real of [
    { x: 90, y: 80, th: 200 },
    { x: 420, y: 330, th: 15 },
    { x: 70, y: 340, th: 120 },
    { x: 250, y: 200, th: 285 },
  ] as Pose[]) {
    const muestras = barridoSimulado(real, mundo, 60, { semilla: 31, vueltas: 1.2 });
    const marcado = { x: real.x + 28, y: real.y - 24 }; // donde el cliente cree que está
    const r = encajarGlobal(puntosDeBarrido(muestras, centro, 60, geo), paredes, SALA_RECT, centro, {
      cerca: marcado,
    });
    const err = Math.hypot(r.pose.x - real.x, r.pose.y - real.y);
    const errAng = Math.abs(difAngular(r.pose.th, real.th));
    // En el CENTRO EXACTO de un rectángulo, el barrido es idéntico girado 180° y el punto
    // marcado tampoco distingue (el centro es su propio simétrico): ahí la orientación no está
    // en los datos y se acepta cualquiera de las dos. En cualquier otro sitio sí se exige.
    const enElCentro = Math.hypot(real.x - 250, real.y - 200) < 5;
    const anguloOk = errAng < 10 || (enElCentro && Math.abs(180 - errAng) < 10);
    comprobar(
      `primer barrido con el punto marcado en (${real.x}, ${real.y})`,
      err < 25 && anguloOk,
      `error ${err.toFixed(0)} cm / ${errAng.toFixed(0)}°, residuo ${r.error.toFixed(1)} cm${enElCentro ? ' (en el centro: 180° es válido)' : ''}`,
    );
  }

  // Y a ciegas, el techo honesto: NO se exige la pose (no está en los datos de una sala
  // rectangular lisa), pero sí que lo que devuelva explique las paredes. Si esto se rompiera,
  // el mapa saldría torcido además de desplazado.
  {
    const real: Pose = { x: 90, y: 80, th: 200 };
    const r = encajarGlobal(
      puntosDeBarrido(barridoSimulado(real, mundo, 60, { semilla: 31, vueltas: 1.2 }), centro, 60, geo),
      paredes,
      SALA_RECT,
      centro,
    );
    comprobar('a ciegas, al menos encaja con las paredes', r.error < 6, `residuo ${r.error.toFixed(1)} cm`);
  }

  // LO QUE DE VERDAD DECIDE LA CALIDAD DEL MAPA: que el segundo barrido caiga donde toca
  // RESPECTO AL PRIMERO. El primero fija el marco (sea el real o su imagen girada); el segundo
  // llega con la semilla de la odometría, y de ahí tiene que salir el desplazamiento real.
  {
    const a: Pose = { x: 150, y: 120, th: 40 };
    const b: Pose = { x: 330, y: 260, th: 115 };
    const primera = encajarGlobal(
      puntosDeBarrido(barridoSimulado(a, mundo, 60, { semilla: 5, vueltas: 1.2 }), centro, 60, geo),
      paredes,
      SALA_RECT,
      centro,
    );
    // La odometría del trayecto a->b, con el error que tendría de verdad (un 5% y 4°).
    const semillaB: Pose = {
      x: primera.pose.x + (b.x - a.x) * 1.05,
      y: primera.pose.y + (b.y - a.y) * 1.05,
      th: primera.pose.th + (b.th - a.th) + 4,
    };
    // El primer barrido se integra en el mapa, y el segundo se encaja contra ESE mapa: los
    // muebles ya conocidos dejan de ser ruido y pasan a sujetar la pose.
    const mapa = crearRejilla(500, 400);
    integrarBarrido(
      mapa,
      puntosDeBarrido(barridoSimulado(a, mundo, 60, { semilla: 5, vueltas: 1.2 }), primera.pose, 60, geo),
    );
    const segunda = encajarBarrido(
      puntosDeBarrido(barridoSimulado(b, mundo, 60, { semilla: 6, vueltas: 1.2 }), semillaB, 60, geo),
      paredes,
      semillaB,
      { vertices: SALA_RECT, campo: campoDeCercania(mapa) },
    );
    const desplazamientoReal = Math.hypot(b.x - a.x, b.y - a.y);
    const desplazamientoMedido = Math.hypot(segunda.pose.x - primera.pose.x, segunda.pose.y - primera.pose.y);
    const giroReal = difAngular(b.th, a.th);
    const giroMedido = difAngular(segunda.pose.th, primera.pose.th);
    comprobar(
      'dos barridos seguidos son coherentes entre sí',
      Math.abs(desplazamientoMedido - desplazamientoReal) < 20 && Math.abs(difAngular(giroMedido, giroReal)) < 8,
      `movimiento medido ${desplazamientoMedido.toFixed(0)} cm / ${giroMedido.toFixed(0)}°, real ${desplazamientoReal.toFixed(0)} cm / ${giroReal.toFixed(0)}°`,
    );
  }

  // Y el caso que rompió el mapa en la primera prueba con el simulador: un salón con MUCHO
  // mueble, donde buena parte de los rayos no da en una pared. Los muebles van PEGADOS a las
  // paredes, como en una casa de verdad, de modo que entre ellos quedan tramos de pared a la
  // vista desde el centro.
  //
  // Importa la diferencia con el caso imposible: si la habitación encierra al robot y solo ve
  // UNA pared, su posición a lo largo de esa pared no está en los datos y el ajuste se desliza
  // sin que el residuo lo delate. Ahí lo único que lo sujeta es la semilla de la odometría, que
  // es exactamente lo que el mapeo tiene a partir del segundo barrido.
  {
    const mundoLleno = [
      ...paredes,
      ...rect(120, 40, 200, 70), // mueble largo contra la pared de arriba
      ...rect(460, 180, 70, 160), // estantería contra la pared derecha
      ...rect(200, 365, 160, 60), // sofá contra la pared de abajo
      ...rect(40, 230, 70, 120), // aparador contra la pared izquierda
      ...rect(300, 200, 110, 90), // mesa en medio
    ];
    const real: Pose = { x: 250, y: 150, th: 70 };

    // Semilla de la odometría tras moverse: lo que de verdad tiene el mapeo.
    const semilla: Pose = { x: 272, y: 132, th: 82 };
    const r = encajarBarrido(
      puntosDeBarrido(barridoSimulado(real, mundoLleno, 60, { semilla: 13, vueltas: 1.2 }), semilla, 60, geo),
      paredes,
      semilla,
      { vertices: SALA_RECT },
    );
    const err = Math.hypot(r.pose.x - real.x, r.pose.y - real.y);
    // El residuo admitido es mayor que en una sala vacía a propósito: la mitad de los rayos dan
    // en muebles que todavía no están en el mapa, así que las paredes se ven por tramos cortos.
    comprobar(
      'encaje en un salón lleno de muebles',
      err < 30 && r.error < 15,
      `error ${err.toFixed(1)} cm, residuo ${r.error.toFixed(1)} cm`,
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Rejilla y obstáculos
// ---------------------------------------------------------------------------

{
  const sala = { vertices: SALA_RECT, puertas: [] };
  const paredes = paredesDe(sala);
  // Un mueble rectangular y una maceta redonda, bien separados de las paredes.
  const mesa = rect(250, 150, 90, 60);
  const maceta: Segmento[] = [];
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * 2 * Math.PI;
    const a1 = ((i + 1) / 16) * 2 * Math.PI;
    maceta.push({
      x1: 150 + 25 * Math.cos(a0), y1: 300 + 25 * Math.sin(a0),
      x2: 150 + 25 * Math.cos(a1), y2: 300 + 25 * Math.sin(a1),
    });
  }
  const mundo = [...paredes, ...mesa, ...maceta];

  // Varios barridos desde sitios distintos: es lo que rellena las sombras de cada uno.
  const rejilla = crearRejilla(500, 400);
  const poses: Pose[] = [
    { x: 250, y: 300, th: 0 },
    { x: 380, y: 200, th: 90 },
    { x: 120, y: 180, th: 180 },
    { x: 300, y: 80, th: 270 },
  ];
  for (const [i, p] of poses.entries()) {
    const muestras = barridoSimulado(p, mundo, 60, { semilla: 20 + i, pasoMs: 40 });
    integrarBarrido(rejilla, puntosDeBarrido(muestras, p, 60, geo));
  }

  const obstaculos = detectarObstaculos(rejilla, paredes);
  // Dos muebles, dos obstáculos: sin el cierre morfológico salían cinco (la mesa partida en
  // tres y la maceta en dos), así que este número vigila la fragmentación, no solo que detecte.
  comprobar(
    'rejilla: un obstáculo por mueble',
    obstaculos.length === 2,
    obstaculos.map((o) => `${o.forma} ${o.celdas}c @(${o.cx.toFixed(0)},${o.cy.toFixed(0)}) ${o.anchoCm}×${o.altoCm}`).join(' | '),
  );

  const cerca = (cx: number, cy: number) =>
    obstaculos.find((o) => Math.hypot(o.cx - cx, o.cy - cy) < 45);
  const laMesa = cerca(250, 150);
  const laMaceta = cerca(150, 300);
  comprobar('rejilla: la mesa está donde está', !!laMesa, laMesa ? `(${laMesa.cx.toFixed(0)}, ${laMesa.cy.toFixed(0)}), real (250, 150)` : '');
  comprobar('rejilla: la maceta está donde está', !!laMaceta, laMaceta ? `(${laMaceta.cx.toFixed(0)}, ${laMaceta.cy.toFixed(0)}), real (150, 300)` : '');

  // Y la FORMA, que es lo que se le pide al mapeo: la mesa es un rectángulo y la maceta un
  // cilindro. Con el cono del haz el tamaño sale algo crecido (ve más ancho de lo que hay),
  // pero la clase y el orden de magnitud tienen que ser los correctos.
  if (laMesa) {
    const largo = Math.max(laMesa.anchoCm, laMesa.altoCm);
    comprobar(
      'rejilla: la mesa se reconoce como caja',
      laMesa.forma === 'caja' && largo > 70 && largo < 130,
      `${laMesa.forma}, ${laMesa.anchoCm}×${laMesa.altoCm} cm (real 90×60)`,
    );
  }
  if (laMaceta) {
    comprobar(
      'rejilla: la maceta se reconoce como redonda',
      laMaceta.forma === 'redondo' && Math.abs(laMaceta.radioCm - 25) < 8,
      `${laMaceta.forma}, r=${laMaceta.radioCm} cm (real 25)`,
    );
  }

  // Ida y vuelta por base64: es como viaja la rejilla al navegador.
  const copia = rejillaDeBase64(rejillaABase64(rejilla), rejilla.cols, rejilla.filas);
  let iguales = true;
  for (let i = 0; i < rejilla.datos.length; i++) if (rejilla.datos[i] !== copia.datos[i]) iguales = false;
  comprobar('rejilla: base64 de ida y vuelta', iguales && copia.cols === rejilla.cols);
}

// ---------------------------------------------------------------------------
// 3. Calibración sin encoders
// ---------------------------------------------------------------------------

{
  const mundo = [...paredesDe({ vertices: SALA_RECT, puertas: [] }), ...rect(140, 300, 120, 60)];
  for (const omega of [45, 72, 110]) {
    // Dos vueltas y media: la autocorrelación necesita ver el perfil repetirse.
    const muestras = barridoSimulado({ x: 220, y: 180, th: 0 }, mundo, omega, { vueltas: 2.5, pasoMs: 40, semilla: 3 });
    const r = periodoDeGiro(muestras);
    const error = r ? Math.abs(r.gradosPorSegundo - omega) / omega : 1;
    comprobar(
      `calibración de giro a ${omega}°/s`,
      !!r && error < 0.08,
      r ? `medido ${r.gradosPorSegundo}°/s (${(error * 100).toFixed(1)}% de error, confianza ${r.confianza})` : 'sin periodo',
    );
  }

  // Avance contra una pared: la distancia central cae con la velocidad real.
  const velocidad = 18.5;
  const muestras: MuestraBarrido[] = [];
  const rnd = prng(5);
  for (let dt = 0; dt <= 4000; dt += 50) {
    const d = 150 - velocidad * (dt / 1000);
    muestras.push({ dt, izquierdo: null, central: Math.round((d + (rnd() - 0.5) * 2) * 10) / 10, derecho: null });
  }
  const v = velocidadDeAvance(muestras);
  comprobar(
    'calibración de avance',
    !!v && Math.abs(v.cmPorSegundo - velocidad) < 1,
    v ? `medido ${v.cmPorSegundo} cm/s (real ${velocidad}), R² ${v.r2}` : 'sin recta',
  );

  // Y un caso que DEBE rechazarse: ruido sin pared enfrente no es una calibración.
  const basura: MuestraBarrido[] = [];
  for (let dt = 0; dt <= 4000; dt += 50) {
    basura.push({ dt, izquierdo: null, central: 80 + (rnd() - 0.5) * 60, derecho: null });
  }
  comprobar('calibración de avance: rechaza la basura', velocidadDeAvance(basura) === null);
}

// ---------------------------------------------------------------------------
// 4. Odometría (la semilla del encaje)
// ---------------------------------------------------------------------------

{
  const cal = { pwmGiro: 140, gradosPorSegundo: 90, pwmAvance: 180, cmPorSegundo: 18, medidoEn: Date.now() };

  // Las dos calibraciones tienen que cuadrar entre sí: girando en el sitio a pwmGiro durante
  // un segundo, la odometría debe dar los 90°/s MEDIDOS, no los que saldrían de la cinta.
  let p: Pose = { x: 100, y: 100, th: 0 };
  p = avanzarPose(p, cal.pwmGiro, -cal.pwmGiro, 1000, cal, geo);
  comprobar(
    'odometría: el giro cuadra con la calibración',
    Math.abs(p.th - 90) < 1 && Math.hypot(p.x - 100, p.y - 100) < 1,
    `${p.th.toFixed(1)}° en 1 s (medido 90°/s), y no se ha movido del sitio`,
  );

  // Avanzando recto a pwmAvance, un segundo son cmPorSegundo centímetros hacia donde mira.
  p = avanzarPose({ x: 100, y: 100, th: 0 }, cal.pwmAvance, cal.pwmAvance, 1000, cal, geo);
  comprobar(
    'odometría: el avance cuadra con la calibración',
    Math.abs(p.x - 118) < 0.5 && Math.abs(p.y - 100) < 0.5 && Math.abs(p.th) < 0.01,
    `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}) tras 1 s a 18 cm/s`,
  );

  // Y mirando a 90° (que con y hacia abajo es "hacia abajo en pantalla"), avanza en +y.
  p = avanzarPose({ x: 100, y: 100, th: 90 }, cal.pwmAvance, cal.pwmAvance, 1000, cal, geo);
  comprobar('odometría: el signo del marco es el del lienzo', Math.abs(p.y - 118) < 0.5 && Math.abs(p.x - 100) < 0.5);

  // Sin calibrar no se inventa nada raro: cae a la separación de la cinta.
  comprobar(
    'odometría: sin calibrar usa la medida del chasis',
    separacionEfectivaCm(CALIBRACION_POR_DEFECTO, geo) === geo.separacionRuedasCm,
  );

  // La odometría deriva sin nadie que la corrija entre barridos: `ponerDentro` es lo que evita
  // que la pose que se emite salga de la habitación (se veían x/y negativas).
  for (const [nombre, vertices] of [
    ['rectangular', SALA_RECT],
    ['en L', SALA_L],
  ] as const) {
    const sala = { vertices, puertas: [] };
    let todas = true;
    for (const fuera of [
      { x: -80, y: -60, th: 30 },
      { x: 10000, y: 50, th: 0 },
      { x: 150, y: -5, th: 200 },
      { x: 220, y: 460, th: 90 },
    ]) {
      const p = ponerDentro(sala, fuera);
      // Dentro, y sin haberse teletransportado: la pared más cercana sigue siendo la suya.
      const d = masCercanoEnParedes(p.x, p.y, paredesDe(sala)).d;
      if (!dentroDelPoligono(p.x, p.y, vertices) || d > 5) todas = false;
    }
    comprobar(`odometría: la pose se queda dentro de la sala ${nombre}`, todas);
  }

  // Y una pose que ya está dentro no se toca.
  const buena: Pose = { x: 200, y: 200, th: 33 };
  comprobar('odometría: ponerDentro no toca una pose válida', ponerDentro({ vertices: SALA_RECT, puertas: [] }, buena) === buena);
}

// ---------------------------------------------------------------------------
// 5. El simulador y el mapeo tienen que hablar del mismo marco
// ---------------------------------------------------------------------------
//
// Esta es la comprobación que caza el error más caro de todos: que `RobotSimulado` (la física
// de la demo sin hardware) y `avanzarPose` (la odometría del modo lidar) no coincidan en el
// signo del giro o en la escala. Si no coinciden, el mapa del dashboard sale girado o del revés
// con el simulador, y depurarlo contra el robot real es infernal.
//
// La calibración se construye a partir de las constantes del propio simulador, así que las dos
// cinemáticas tienen que dar lo mismo hasta el redondeo.
{
  const cal = {
    pwmGiro: 255,
    gradosPorSegundo: ((2 * VEL_MAX_CM_S_SIM) / DISTANCIA_RUEDAS_SIM) * (180 / Math.PI),
    pwmAvance: 255,
    cmPorSegundo: VEL_MAX_CM_S_SIM,
    medidoEn: 1,
  };
  const geoSim = { ...geo, separacionRuedasCm: DISTANCIA_RUEDAS_SIM };

  // Si las dos calibraciones son coherentes, la separación efectiva es la de verdad.
  comprobar(
    'simulador: la separación efectiva sale de la calibración',
    Math.abs(separacionEfectivaCm(cal, geoSim) - DISTANCIA_RUEDAS_SIM) < 0.5,
    `${separacionEfectivaCm(cal, geoSim).toFixed(2)} cm (real ${DISTANCIA_RUEDAS_SIM})`,
  );

  const correr = (izq: number, der: number, ms: number) => {
    const sim = new RobotSimulado({ ...CONFIG_POR_DEFECTO }, { semilla: 4 });
    const inicial = sim.pose();
    sim.mando = { izq, der };
    const paso = 50;
    for (let t = 0; t < ms; t += paso) sim.paso(paso);

    let odo: Pose = { x: inicial.x, y: inicial.y, th: inicial.th };
    for (let t = 0; t < ms; t += paso) odo = avanzarPose(odo, izq, der, paso, cal, geoSim);

    const real = sim.pose();
    return {
      dthSim: difAngular(real.th, inicial.th),
      dthOdo: difAngular(odo.th, inicial.th),
      avanceSim: Math.hypot(real.x - inicial.x, real.y - inicial.y),
      avanceOdo: Math.hypot(odo.x - inicial.x, odo.y - inicial.y),
    };
  };

  // Giro en el sitio: con la rueda izquierda hacia delante el robot gira a la DERECHA, que en
  // el marco del lienzo (y hacia abajo) es ángulo creciente. El signo es lo que importa.
  const giro = correr(200, -200, 1000);
  comprobar(
    'simulador: el giro coincide con la odometría del lidar',
    Math.sign(giro.dthSim) === Math.sign(giro.dthOdo) && Math.abs(giro.dthSim - giro.dthOdo) < 2,
    `simulador ${giro.dthSim.toFixed(1)}°, odometría ${giro.dthOdo.toFixed(1)}°`,
  );
  comprobar('simulador: gira a la derecha con la izquierda adelante', giro.dthSim > 0, `${giro.dthSim.toFixed(1)}°`);

  // Avance recto: el mismo recorrido y sin girar.
  const recto = correr(200, 200, 1000);
  comprobar(
    'simulador: el avance coincide con la odometría del lidar',
    Math.abs(recto.avanceSim - recto.avanceOdo) < 1.5 && Math.abs(recto.dthSim) < 1,
    `simulador ${recto.avanceSim.toFixed(1)} cm, odometría ${recto.avanceOdo.toFixed(1)} cm`,
  );
}

// La calibración por defecto tiene que ser coherente con el firmware (PWM dentro de rango).
comprobar(
  'calibración por defecto en rango',
  CALIBRACION_POR_DEFECTO.pwmGiro > 0 && CALIBRACION_POR_DEFECTO.pwmGiro <= 255 && CALIBRACION_POR_DEFECTO.medidoEn === null,
);

console.log(fallos ? `\n${fallos} comprobación(es) fallidas` : '\ntodo ok');
process.exit(fallos ? 1 : 0);
