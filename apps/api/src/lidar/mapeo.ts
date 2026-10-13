// Motor del modo lidar: convierte lotes de muestras del sonar en un mapa, en tiempo real.
//
// QUIÉN HACE QUÉ
//   El robot (firmware_beta) obedece y mide: gira, avanza, limpia esquivando, y sube muestras
//   con el TIEMPO de cada una. No sabe dónde está ni qué está mapeando.
//   Este módulo pone la cabeza: reconstruye el ángulo de cada muestra con la calibración,
//   encaja el barrido contra las paredes de la habitación para saber desde dónde se midió,
//   acumula la rejilla de ocupación, saca las formas de los obstáculos, lo guarda y lo emite.
//
// POR QUÉ AQUÍ Y NO EN EL ESP32
//   Porque así la cinemática y el mapeo se corrigen sin reflashear, se prueban en el PC
//   (packages/shared/src/lidar.check.ts) y los comparten el firmware y el simulador.
//
// EL ESTADO VIVE EN MEMORIA
//   Un mapeo en curso es una sesión: si se reinicia la API se pierde el progreso del barrido en
//   vuelo, pero NO el mapa (se guarda en `mapas` en cada barrido completado). Reiniciar a media
//   limpieza deja al robot parándose solo (ver SIN_SERVIDOR_PARA_MS en el firmware).
import {
  RESOLUCION_CM,
  avanzarPose,
  caja,
  campoDeCercania,
  cobertura as coberturaDe,
  dentroDelPoligono,
  detectarObstaculos,
  difAngular,
  encajarBarrido,
  encajarGlobal,
  integrarBarrido,
  masCercanoEnSegmento,
  paredesDe,
  ponerDentro,
  periodoDeGiro,
  puntosDeBarrido,
  rejillaABase64,
  topico,
  velocidadDeAvance,
  type LoteBarrido,
  type MuestraBarrido,
  type Obstaculo,
  type Pose,
  type Rejilla,
  type Sala,
} from '@iot/shared';
import { publicar } from '../mqtt/bridge.ts';
import { emitirLidar } from '../ws.ts';
import {
  ajustesDe,
  guardarCalibracion,
  guardarMapa,
  guardarTamanoReal,
  mapaDe,
  rejillaParaSala,
  salaDe,
  type AjustesRobot,
} from './datos.ts';

export type ModoLidar =
  | 'inactivo'
  | 'calibrando_giro'
  | 'calibrando_avance'
  | 'reconociendo'
  | 'limpiando';

/** Vueltas que se piden por barrido: algo más de una, para cerrar el perfil con solape. */
const VUELTAS_POR_BARRIDO = 1.15;
/** Margen sobre la duración teórica del giro, para que el robot acabe la vuelta. */
const MARGEN_MANIOBRA_MS = 600;
/** Barridos como mucho en un reconocimiento, y cobertura con la que se da por bueno. */
const BARRIDOS_MAXIMOS = 6;
const COBERTURA_OBJETIVO = 0.82;
/** Cuánto se intenta avanzar entre dos barridos para ver lo que tapaban los muebles. */
const SALTO_CM = 80;
/** Trozo de limpieza entre dos barridos de relocalización. */
const LIMPIEZA_TROZO_MS = 25000;
/** Cerca de una puerta: el backend desvía al robot (él no conoce el mapa). */
const PUERTA_CERCA_CM = 40;
/** Y no se le manda otro desvío hasta pasado esto, para no encadenar giros. */
const ESPERA_ENTRE_DESVIOS_MS = 2500;
/** Residuo de encaje por encima del cual el barrido no se cree (y no entra en el mapa). */
const RESIDUO_MAXIMO_CM = 25;
/** Cuánto se busca alrededor del punto que marcó el cliente en el plano. */
const RADIO_INICIO_CM = 80;
/** Cuánto puede haberse movido el robot entre dos barridos seguidos, como mucho. */
const DESVIO_ENTRE_BARRIDOS_CM = 200;
/** Barridos malos seguidos antes de dejar de insistir. */
const FALLOS_PARA_RENDIRSE = 2;
/** Residuo a partir del cual se vuelve a buscar alrededor de lo encontrado. */
const RESIDUO_PARA_RECUPERAR_CM = 8;
/** Radio de esa segunda búsqueda. */
const RADIO_RECUPERACION_CM = 60;

interface Sesion {
  dispositivoId: string;
  modo: ModoLidar;
  sala: Sala | null;
  ajustes: AjustesRobot;
  /** Donde creemos que está el robot, en el marco de la sala. */
  pose: Pose;
  rejilla: Rejilla | null;
  obstaculos: Obstaculo[];
  barridos: number;
  cobertura: number;
  /** Muestras del barrido en curso, en orden de lote. */
  muestras: MuestraBarrido[];
  barridoActual: number;
  /** Para cancelar las secuencias programadas al parar: solo corre la del token vigente. */
  token: number;
  temporizadores: ReturnType<typeof setTimeout>[];
  ultimaTelemetriaMs: number;
  ultimoDesvioMs: number;
  /** Último encaje: lo muestra el panel para que se vea si el mapa es de fiar. */
  residuoCm: number | null;
  aviso: string | null;
  /** Dónde dijo el cliente que estaba el robot al empezar. Semilla del primer encaje. */
  inicio: { x: number; y: number } | null;
  /** Barridos seguidos que no han encajado: a los dos, se deja de insistir. */
  fallosSeguidos: number;
  /** Celda ocupada más cercana, rehecha en cada barrido: el encaje va contra el MAPA. */
  campo: ReturnType<typeof campoDeCercania> | null;
}

const sesiones = new Map<string, Sesion>();

async function sesionDe(dispositivoId: string): Promise<Sesion> {
  let s = sesiones.get(dispositivoId);
  if (!s) {
    s = {
      dispositivoId,
      modo: 'inactivo',
      sala: null,
      ajustes: await ajustesDe(dispositivoId),
      pose: { x: 0, y: 0, th: 0 },
      rejilla: null,
      obstaculos: [],
      barridos: 0,
      cobertura: 0,
      muestras: [],
      barridoActual: 0,
      token: 0,
      temporizadores: [],
      ultimaTelemetriaMs: 0,
      ultimoDesvioMs: 0,
      residuoCm: null,
      aviso: null,
      inicio: null,
      fallosSeguidos: 0,
      campo: null,
    };
    sesiones.set(dispositivoId, s);
  }
  return s;
}

export const estadoDe = (dispositivoId: string) => sesiones.get(dispositivoId) ?? null;
export function olvidarLidar(dispositivoId: string): void {
  const s = sesiones.get(dispositivoId);
  if (s) cancelar(s);
  sesiones.delete(dispositivoId);
}

// ---------------------------------------------------------------------------
// Órdenes al robot
// ---------------------------------------------------------------------------

function ordenar(dispositivoId: string, orden: Record<string, unknown>): void {
  publicar(topico(dispositivoId, 'comando'), orden, { qos: 1 });
}

function cancelar(s: Sesion): void {
  s.token++;
  for (const t of s.temporizadores) clearTimeout(t);
  s.temporizadores = [];
}

/** Programa un paso de la secuencia; si se ha parado (o cambiado de modo), no corre. */
function luego(s: Sesion, ms: number, fn: () => void): void {
  const token = s.token;
  const t = setTimeout(() => {
    if (s.token !== token) return;
    try {
      fn();
    } catch (e) {
      console.warn(`[lidar] ${s.dispositivoId}: ${(e as Error).message}`);
    }
  }, ms);
  s.temporizadores.push(t);
}

/** Milisegundos que tarda el robot en girar `grados` con su calibración. */
const msDeGiro = (s: Sesion, grados: number) =>
  Math.max(150, (Math.abs(grados) / Math.max(5, s.ajustes.calibracion.gradosPorSegundo)) * 1000);

/** Milisegundos que tarda en avanzar `cm`. */
const msDeAvance = (s: Sesion, cm: number) =>
  Math.max(200, (Math.abs(cm) / Math.max(1, s.ajustes.calibracion.cmPorSegundo)) * 1000);

const msDeBarrido = (s: Sesion) => msDeGiro(s, 360 * VUELTAS_POR_BARRIDO) + MARGEN_MANIOBRA_MS;

// ---------------------------------------------------------------------------
// Emisión al navegador
// ---------------------------------------------------------------------------

/**
 * Lo que ve el panel. La rejilla va en base64 (un byte por celda): una sala de 5×4 m son
 * 8000 celdas, 11 kB en base64, y se manda una vez por barrido, no por muestra.
 */
export interface EstadoLidarEmitido {
  modo: ModoLidar;
  salaId: number | null;
  pose: Pose | null;
  barridos: number;
  cobertura: number;
  residuoCm: number | null;
  obstaculos: Obstaculo[];
  aviso: string | null;
  rejilla?: { datos: string; cols: number; filas: number; res: number };
}

function emitir(s: Sesion, conRejilla = false): void {
  const payload: EstadoLidarEmitido = {
    modo: s.modo,
    salaId: s.sala?.id ?? null,
    pose: s.sala ? s.pose : null,
    barridos: s.barridos,
    cobertura: s.cobertura,
    residuoCm: s.residuoCm,
    obstaculos: s.obstaculos,
    aviso: s.aviso,
  };
  if (conRejilla && s.rejilla) {
    payload.rejilla = {
      datos: rejillaABase64(s.rejilla),
      cols: s.rejilla.cols,
      filas: s.rejilla.filas,
      res: s.rejilla.res,
    };
  }
  emitirLidar(s.dispositivoId, payload);
}

/** Estado actual para un navegador que acaba de abrir el panel (con mapa guardado si lo hay). */
export async function estadoCompleto(dispositivoId: string, salaId: number | null): Promise<EstadoLidarEmitido> {
  const s = await sesionDe(dispositivoId);
  // Si no hay sesión viva, se sirve lo guardado de la habitación que pidan.
  const id = s.modo === 'inactivo' ? salaId : (s.sala?.id ?? salaId);
  const payload: EstadoLidarEmitido = {
    modo: s.modo,
    salaId: id,
    pose: s.modo === 'inactivo' ? null : s.pose,
    barridos: s.barridos,
    cobertura: s.cobertura,
    residuoCm: s.residuoCm,
    obstaculos: s.obstaculos,
    aviso: s.aviso,
  };
  if (s.modo !== 'inactivo' && s.rejilla) {
    payload.rejilla = { datos: rejillaABase64(s.rejilla), cols: s.rejilla.cols, filas: s.rejilla.filas, res: s.rejilla.res };
    return payload;
  }
  if (id === null) return payload;
  const guardado = await mapaDe(id);
  if (!guardado) return payload;
  return {
    ...payload,
    barridos: guardado.barridos,
    cobertura: guardado.cobertura,
    obstaculos: guardado.obstaculos,
    rejilla: {
      datos: rejillaABase64(guardado.rejilla),
      cols: guardado.rejilla.cols,
      filas: guardado.rejilla.filas,
      res: guardado.rejilla.res,
    },
  };
}

// ---------------------------------------------------------------------------
// Arranque de cada función
// ---------------------------------------------------------------------------

/** Vuelve a cargar medidas y calibración (han podido cambiar desde la web) y limpia la sesión. */
async function preparar(dispositivoId: string, modo: ModoLidar, salaId: number | null): Promise<Sesion> {
  const s = await sesionDe(dispositivoId);
  cancelar(s);
  s.ajustes = await ajustesDe(dispositivoId);
  s.modo = modo;
  s.muestras = [];
  s.aviso = null;
  s.residuoCm = null;
  s.fallosSeguidos = 0;
  s.sala = salaId === null ? null : await salaDe(salaId);
  return s;
}

export async function calibrarGiro(dispositivoId: string): Promise<void> {
  const s = await preparar(dispositivoId, 'calibrando_giro', null);
  // Tres vueltas largas: la autocorrelación necesita ver el perfil repetirse al menos dos veces.
  const ms = Math.min(20000, msDeGiro(s, 360 * 3) + MARGEN_MANIOBRA_MS);
  emitir(s);
  ordenar(dispositivoId, { accion: 'calibrar_giro', pwm: s.ajustes.calibracion.pwmGiro, ms, sentido: 1 });
}

export async function calibrarAvance(dispositivoId: string): Promise<void> {
  const s = await preparar(dispositivoId, 'calibrando_avance', null);
  emitir(s);
  // El firmware aborta a 25 cm de la pared, así que pedir 5 s de más no es un riesgo.
  ordenar(dispositivoId, { accion: 'calibrar_avance', pwm: s.ajustes.calibracion.pwmAvance, ms: 5000 });
}

/**
 * Reconocer la habitación: barrer, moverse a un sitio con otra vista, barrer otra vez… hasta
 * cubrirla. Empieza con la rejilla en blanco (re-escanear es justo para cuando el cuarto ha
 * cambiado: arrastrar la rejilla vieja mantendría muebles que ya no están).
 */
export async function reconocer(
  dispositivoId: string,
  salaId: number,
  inicio?: { x: number; y: number } | null,
): Promise<void> {
  const s = await preparar(dispositivoId, 'reconociendo', salaId);
  if (!s.sala) throw new Error('La habitación no existe.');

  s.rejilla = rejillaParaSala(s.sala.vertices);
  s.campo = null;
  s.obstaculos = [];
  s.barridos = 0;
  s.cobertura = 0;
  // Dónde está el robot al empezar. Importa de verdad: a ciegas, en una sala rectangular y
  // lisa, hay varias poses que explican las paredes igual de bien y el mapa entero puede salir
  // desplazado (ver el techo que documenta `encajarGlobal`). Marcándolo en el plano, el primer
  // encaje sale exacto; sin marcarlo se supone el centro y se avisa.
  const c = caja(s.sala.vertices);
  s.inicio = inicio ?? null;
  s.pose = { x: inicio?.x ?? c.ancho / 2, y: inicio?.y ?? c.alto / 2, th: 0 };
  if (!inicio) {
    s.aviso =
      'No has marcado dónde está el robot: se supone que está en el centro. Si el mapa sale girado o desplazado, márcalo en el plano y vuelve a reconocer.';
  }
  if (!s.ajustes.calibracion.medidoEn) {
    s.aviso = 'Este robot no está calibrado: el mapa saldrá torcido. Calíbralo para medir sus grados por segundo.';
  }
  emitir(s, true);
  ordenar(dispositivoId, { accion: 'barrer', pwm: s.ajustes.calibracion.pwmGiro, ms: msDeBarrido(s), sentido: 1 });
}

/**
 * Limpiar: el robot esquiva por su cuenta (navegacion.py) y aquí se le sigue la pista con la
 * odometría de su telemetría, se van metiendo en el mapa los obstáculos que encuentra, y cada
 * LIMPIEZA_TROZO_MS se le hace parar para un barrido de relocalización.
 */
export async function limpiar(
  dispositivoId: string,
  salaId: number,
  inicio?: { x: number; y: number } | null,
): Promise<void> {
  const s = await preparar(dispositivoId, 'limpiando', salaId);
  if (!s.sala) throw new Error('La habitación no existe.');

  // Limpiar parte del mapa que ya hay: es lo que se dibuja mientras limpia.
  const guardado = await mapaDe(salaId);
  if (!guardado) throw new Error('Esta habitación no está mapeada todavía. Reconócela primero.');
  s.rejilla = guardado.rejilla;
  // El mapa que ya hay es lo que va a sujetar la pose: los muebles conocidos dejan de ser ruido.
  s.campo = campoDeCercania(guardado.rejilla);
  s.obstaculos = guardado.obstaculos;
  s.barridos = guardado.barridos;
  s.cobertura = guardado.cobertura;
  const c = caja(s.sala.vertices);
  s.inicio = inicio ?? null;
  s.pose = { x: inicio?.x ?? c.ancho / 2, y: inicio?.y ?? c.alto / 2, th: 0 };
  emitir(s, true);

  // Un barrido primero: sin saber dónde está, la vigilancia de las puertas no vale nada.
  ordenar(dispositivoId, { accion: 'barrer', pwm: s.ajustes.calibracion.pwmGiro, ms: msDeBarrido(s), sentido: 1 });
}

export async function parar(dispositivoId: string): Promise<void> {
  const s = await sesionDe(dispositivoId);
  cancelar(s);
  ordenar(dispositivoId, { accion: 'parar' });
  s.modo = 'inactivo';
  s.muestras = [];
  emitir(s);
}

// ---------------------------------------------------------------------------
// Llegada de datos del robot
// ---------------------------------------------------------------------------

/** Lote de muestras del firmware beta (tópico `barrido`). */
export async function recibirLote(dispositivoId: string, lote: LoteBarrido): Promise<void> {
  const s = await sesionDe(dispositivoId);
  if (s.modo === 'inactivo') return; // nadie ha pedido nada: lote tardío de una maniobra abortada

  // Barrido nuevo: se descarta lo que quedara del anterior (un lote perdido no debe mezclar
  // dos maniobras en el mismo perfil).
  if (lote.barrido !== s.barridoActual) {
    s.barridoActual = lote.barrido;
    s.muestras = [];
  }
  s.muestras.push(...lote.muestras);

  if (!lote.fin) {
    // Durante la limpieza el mapa se refresca sobre la marcha: es lo que hace que el panel
    // muestre los obstáculos en cuanto los encuentra, sin esperar al final del trozo.
    if (s.modo === 'limpiando') integrarEnMarcha(s, lote.muestras);
    return;
  }

  const muestras = s.muestras;
  s.muestras = [];
  if (s.modo === 'calibrando_giro') return cerrarCalibracionGiro(s, muestras);
  if (s.modo === 'calibrando_avance') return cerrarCalibracionAvance(s, muestras);
  await cerrarBarrido(s, muestras);
}

/**
 * Un barrido completo: encajar contra las paredes, integrar en la rejilla, sacar formas,
 * guardar y emitir. Es el corazón de la cosa.
 */
async function cerrarBarrido(s: Sesion, muestras: MuestraBarrido[]): Promise<void> {
  if (!s.sala || !s.rejilla) return;
  const { calibracion, geometria } = s.ajustes;
  const paredes = paredesDe(s.sala);

  // El sentido del giro lo fija la orden (`sentido: 1` = horario en pantalla).
  const omega = calibracion.gradosPorSegundo;
  const puntos = puntosDeBarrido(muestras, s.pose, omega, geometria);

  // Primer barrido de la sesión: no se sabe la orientación, así que búsqueda global acotada al
  // punto de partida. Los siguientes llegan con la semilla de la odometría y se encajan contra
  // el MAPA (paredes y obstáculos ya conocidos), que es lo único que aguanta una casa
  // amueblada: contra las paredes a secas, más de la mitad de los rayos serían ruido.
  const primero = s.barridos === 0;
  let encaje = primero
    ? encajarGlobal(puntos, paredes, s.sala.vertices, s.pose, {
        cerca: s.inicio,
        radioCm: s.inicio ? RADIO_INICIO_CM : undefined,
      })
    : encajarBarrido(puntos, paredes, s.pose, {
        vertices: s.sala.vertices,
        campo: s.campo,
        // Entre dos barridos el robot no puede haberse ido más lejos de lo que da de sí la
        // odometría: acotarlo evita que un encaje malo teletransporte el mapa.
        maxDesvioCm: DESVIO_ENTRE_BARRIDOS_CM,
      });

  // Pasada de RECUPERACIÓN. Si el residuo sale alto, el ajuste se ha quedado en un mínimo local:
  // casi siempre porque la odometría del trayecto anterior venía desviada (el robot chocó, o la
  // rueda patinó más de lo calibrado) y el ICP, que solo converge en lo local, no llega. Volver
  // a buscar alrededor de lo que ha salido cuesta unas decenas de milisegundos y endereza justo
  // los barridos que si no habría que tirar.
  if (Number.isFinite(encaje.error) && encaje.error > RESIDUO_PARA_RECUPERAR_CM) {
    const segundo = encajarGlobal(puntos, paredes, s.sala.vertices, s.pose, {
      cerca: { x: encaje.pose.x, y: encaje.pose.y },
      radioCm: RADIO_RECUPERACION_CM,
    });
    if (segundo.error < encaje.error) encaje = segundo;
  }

  if (!Number.isFinite(encaje.error) || encaje.error > RESIDUO_MAXIMO_CM) {
    // Un barrido que no cuadra con la habitación NO entra en el mapa: lo que sea que midió
    // (el robot en otro cuarto, la calibración mal, la puerta abierta a un pasillo) ensuciaría
    // la rejilla con obstáculos inventados.
    s.residuoCm = Number.isFinite(encaje.error) ? Math.round(encaje.error * 10) / 10 : null;
    s.fallosSeguidos++;
    s.aviso =
      'Ese barrido no cuadró con la forma de la habitación y no ha entrado en el mapa. Comprueba el tamaño que le diste, o calibra el robot.';
    emitir(s);
    // Un barrido malo se SALTA, no abandona el reconocimiento entero: el robot puede haber
    // barrido desde un rincón con poca pared a la vista e ir perfecto desde el punto siguiente.
    // Se deja de insistir a los dos seguidos, que ya es síntoma de que algo más va mal.
    if (s.modo === 'reconociendo') {
      if (s.fallosSeguidos >= FALLOS_PARA_RENDIRSE) await terminarReconocimiento(s);
      else await siguientePasoReconocimiento(s, muestras);
    }
    return;
  }
  s.fallosSeguidos = 0;

  // El robot no puede estar fuera de su habitación. El encaje ya penaliza esas poses, pero si la
  // odometría venía de fuera (tras un avance que chocó) TODAS las candidatas pueden estar fuera y
  // gana la menos mala: se vieron poses con y negativa. Se mete dentro y se sigue.
  s.pose = ponerDentro(s.sala, encaje.pose);
  s.residuoCm = Math.round(encaje.error * 10) / 10;
  s.aviso = null;

  // Los puntos se vuelven a generar con la pose ya corregida: integrar con la semilla metería
  // todo el error del encaje en el mapa.
  integrarBarrido(s.rejilla, puntosDeBarrido(muestras, s.pose, omega, geometria));
  s.barridos++;
  // El campo de cercanía se rehace con el mapa nuevo: es contra esto contra lo que se encajará
  // el barrido siguiente.
  s.campo = campoDeCercania(s.rejilla);
  s.obstaculos = detectarObstaculos(s.rejilla, paredes);
  s.cobertura = Math.round(coberturaDe(s.rejilla, s.sala.vertices) * 1000) / 1000;

  await guardarMapa({
    salaId: s.sala.id,
    rejilla: s.rejilla,
    obstaculos: s.obstaculos,
    barridos: s.barridos,
    cobertura: s.cobertura,
  });
  // Lo medido de verdad, junto a lo que estimó el usuario: la caja de la habitación es la de
  // su polígono, que es lo que el encaje ha confirmado que cuadra con las paredes.
  const c = caja(s.sala.vertices);
  await guardarTamanoReal(s.sala.id, c.ancho, c.alto);

  emitir(s, true);

  if (s.modo === 'reconociendo') await siguientePasoReconocimiento(s, muestras);
  else if (s.modo === 'limpiando') seguirLimpiando(s);
}

/**
 * Siguiente sitio desde el que barrer. Se elige la dirección más despejada del barrido que
 * acaba de hacer (que es información que ya está pagada) y se avanza hacia ella: desde otro
 * punto se ve lo que antes tapaban los muebles, que es de lo que vive la cobertura.
 */
async function siguientePasoReconocimiento(s: Sesion, muestras: MuestraBarrido[]): Promise<void> {
  if (!s.sala) return;
  if (s.barridos >= BARRIDOS_MAXIMOS || s.cobertura >= COBERTURA_OBJETIVO) {
    await terminarReconocimiento(s);
    return;
  }

  const objetivo = direccionMasDespejada(s, muestras);
  if (!objetivo) {
    await terminarReconocimiento(s);
    return;
  }

  const { giroDeg, avanceCm } = objetivo;
  const msGiro = msDeGiro(s, giroDeg);
  const msAvance = msDeAvance(s, avanceCm);

  // Secuencia: girar, avanzar, barrer. Entre pasos se deja un margen para que el robot frene
  // de verdad (las ruedas no paran en el mismo milisegundo en que acaba la orden).
  ordenar(s.dispositivoId, {
    accion: 'girar',
    pwm: s.ajustes.calibracion.pwmGiro,
    ms: msGiro,
    sentido: giroDeg >= 0 ? 1 : -1,
  });
  // La odometría se adelanta con lo que se acaba de ordenar: es la semilla del próximo encaje.
  s.pose = { ...s.pose, th: s.pose.th + giroDeg };

  luego(s, msGiro + 400, () => {
    ordenar(s.dispositivoId, { accion: 'avanzar', pwm: s.ajustes.calibracion.pwmAvance, ms: msAvance });
    const a = (s.pose.th * Math.PI) / 180;
    s.pose = ponerDentro(s.sala!, {
      x: s.pose.x + avanceCm * Math.cos(a),
      y: s.pose.y + avanceCm * Math.sin(a),
      th: s.pose.th,
    });
    emitir(s);

    luego(s, msAvance + 400, () => {
      ordenar(s.dispositivoId, {
        accion: 'barrer',
        pwm: s.ajustes.calibracion.pwmGiro,
        ms: msDeBarrido(s),
        sentido: 1,
      });
    });
  });
}

/**
 * Dirección con más sitio por delante, en grados RELATIVOS a cómo mira ahora el robot.
 * Se reparte el barrido en sectores y se mira la distancia mínima de cada uno (el mínimo, no la
 * media: un sector con una pata de silla no está despejado aunque el resto esté vacío).
 */
function direccionMasDespejada(s: Sesion, muestras: MuestraBarrido[]): { giroDeg: number; avanceCm: number } | null {
  if (!s.sala) return null;
  const SECTORES = 16;
  const minimos = new Array<number>(SECTORES).fill(Infinity);
  const puntos = puntosDeBarrido(muestras, s.pose, s.ajustes.calibracion.gradosPorSegundo, s.ajustes.geometria);

  for (const p of puntos) {
    if (p.d === null) continue;
    const rel = ((((p.dir - s.pose.th) % 360) + 360) % 360) / (360 / SECTORES);
    const i = Math.floor(rel) % SECTORES;
    minimos[i] = Math.min(minimos[i], p.d);
  }

  let mejor = -1;
  let mejorHueco = 0;
  for (let i = 0; i < SECTORES; i++) {
    const hueco = Number.isFinite(minimos[i]) ? minimos[i] : 250; // sin eco = sitio de sobra
    if (hueco > mejorHueco) {
      mejorHueco = hueco;
      mejor = i;
    }
  }
  // Sin sitio para moverse con seguridad, no se mueve: mejor un mapa de un punto que un golpe.
  if (mejor < 0 || mejorHueco < s.ajustes.geometria.radioChasisCm + 60) return null;

  const giroDeg = difAngular(mejor * (360 / SECTORES), 0);
  const avanceCm = Math.min(SALTO_CM, mejorHueco - s.ajustes.geometria.radioChasisCm - 40);

  // Y que el destino siga dentro de la habitación (con la puerta contada como pared).
  const a = ((s.pose.th + giroDeg) * Math.PI) / 180;
  const destino = { x: s.pose.x + avanceCm * Math.cos(a), y: s.pose.y + avanceCm * Math.sin(a) };
  if (!dentroDelPoligono(destino.x, destino.y, s.sala.vertices)) return null;

  return { giroDeg, avanceCm: Math.max(30, avanceCm) };
}

async function terminarReconocimiento(s: Sesion): Promise<void> {
  cancelar(s);
  ordenar(s.dispositivoId, { accion: 'parar' });
  s.modo = 'inactivo';
  emitir(s, true);
}

/** Trozo siguiente de limpieza, tras el barrido de relocalización. */
function seguirLimpiando(s: Sesion): void {
  ordenar(s.dispositivoId, { accion: 'limpiar', pwm: s.ajustes.calibracion.pwmAvance, ms: LIMPIEZA_TROZO_MS });
  // Al acabar el trozo, otro barrido: sin relocalizar, la odometría va derivando y la
  // vigilancia de las puertas acaba mirando a un sitio donde el robot ya no está.
  luego(s, LIMPIEZA_TROZO_MS + 500, () => {
    ordenar(s.dispositivoId, {
      accion: 'barrer',
      pwm: s.ajustes.calibracion.pwmGiro,
      ms: msDeBarrido(s),
      sentido: 1,
    });
  });
}

/** Mapa en marcha durante la limpieza: la pose es la de la odometría, con su deriva. */
function integrarEnMarcha(s: Sesion, muestras: MuestraBarrido[]): void {
  if (!s.sala || !s.rejilla) return;
  // ponytail: se integra con la pose derivada, sin encajar (encajar pide una vuelta completa y
  // aquí el robot va de frente). El error se corta en el barrido de relocalización del final
  // del trozo. Si se nota sucio, bajar LIMPIEZA_TROZO_MS.
  const puntos = puntosDeBarrido(muestras, s.pose, 0, s.ajustes.geometria);
  integrarBarrido(s.rejilla, puntos);
  s.obstaculos = detectarObstaculos(s.rejilla, paredesDe(s.sala));
  emitir(s);
}

/**
 * Cada telemetría (2 Hz) adelanta la odometría con los PWM que publica el robot y vigila que no
 * se escape por una puerta.
 *
 * Esto es lo que hace de la puerta una puerta: el robot no conoce el mapa (ve el hueco como
 * sitio libre y se iría), así que es el backend el que, al verlo acercarse, le manda girar.
 */
export async function seguirTelemetria(
  dispositivoId: string,
  izquierdaPwm: number,
  derechaPwm: number,
  ahora: number,
): Promise<void> {
  const s = sesiones.get(dispositivoId);
  if (!s || s.modo !== 'limpiando' || !s.sala) return;

  const dt = s.ultimaTelemetriaMs ? ahora - s.ultimaTelemetriaMs : 0;
  s.ultimaTelemetriaMs = ahora;
  if (dt <= 0 || dt > 3000) return; // primer mensaje, o un hueco tan grande que no se puede integrar

  s.pose = ponerDentro(
    s.sala,
    avanzarPose(s.pose, izquierdaPwm, derechaPwm, dt, s.ajustes.calibracion, s.ajustes.geometria),
  );

  // ¿Va hacia una puerta y está cerca?
  const a = (s.pose.th * Math.PI) / 180;
  const morro = {
    x: s.pose.x + s.ajustes.geometria.radioChasisCm * Math.cos(a),
    y: s.pose.y + s.ajustes.geometria.radioChasisCm * Math.sin(a),
  };
  for (const puerta of s.sala.puertas) {
    const c = masCercanoEnSegmento(morro.x, morro.y, puerta);
    if (c.d > PUERTA_CERCA_CM) continue;
    // Solo si se está acercando: pasar por delante de una puerta es normal.
    const haciaLaPuerta = Math.cos(a) * (c.x - morro.x) + Math.sin(a) * (c.y - morro.y) > 0;
    if (!haciaLaPuerta) continue;
    if (ahora - s.ultimoDesvioMs < ESPERA_ENTRE_DESVIOS_MS) continue;
    s.ultimoDesvioMs = ahora;
    s.aviso = `Desviado de la puerta${puerta.nombre ? ` "${puerta.nombre}"` : ''}.`;
    // Media vuelta: es un hueco por el que se iría de la habitación, no un mueble que rodear.
    ordenar(dispositivoId, {
      accion: 'girar',
      pwm: s.ajustes.calibracion.pwmGiro,
      ms: msDeGiro(s, 150),
      sentido: 1,
    });
    emitir(s);
    return;
  }

  emitir(s);
}

// ---------------------------------------------------------------------------
// Calibración
// ---------------------------------------------------------------------------

async function cerrarCalibracionGiro(s: Sesion, muestras: MuestraBarrido[]): Promise<void> {
  s.modo = 'inactivo';
  const r = periodoDeGiro(muestras);
  if (!r) {
    s.aviso =
      'No se pudo medir el giro: hace falta una habitación con relieve (muebles, esquinas) y al menos dos vueltas completas. Inténtalo en el centro del cuarto.';
    emitir(s);
    return;
  }
  const calibracion = {
    ...s.ajustes.calibracion,
    gradosPorSegundo: r.gradosPorSegundo,
    medidoEn: Date.now(),
  };
  s.ajustes = await guardarCalibracion(s.dispositivoId, calibracion);
  s.aviso = `Giro medido: ${r.gradosPorSegundo}°/s (una vuelta cada ${(r.periodoMs / 1000).toFixed(1)} s, confianza ${(r.confianza * 100).toFixed(0)}%).`;
  emitir(s);
}

async function cerrarCalibracionAvance(s: Sesion, muestras: MuestraBarrido[]): Promise<void> {
  s.modo = 'inactivo';
  const r = velocidadDeAvance(muestras);
  if (!r) {
    s.aviso =
      'No se pudo medir el avance: pon el robot mirando de frente a una pared lisa, a un par de metros, y repite.';
    emitir(s);
    return;
  }
  const calibracion = { ...s.ajustes.calibracion, cmPorSegundo: r.cmPorSegundo, medidoEn: Date.now() };
  s.ajustes = await guardarCalibracion(s.dispositivoId, calibracion);
  s.aviso = `Avance medido: ${r.cmPorSegundo} cm/s a PWM ${calibracion.pwmAvance} (ajuste R² ${r.r2}).`;
  emitir(s);
}

/** Estado que publica el propio firmware (tópico `lidar`): se reenvía tal cual al panel. */
export async function recibirEstadoFirmware(dispositivoId: string, estado: Record<string, unknown>): Promise<void> {
  const s = await sesionDe(dispositivoId);
  // El firmware es la verdad sobre si se está moviendo; el modo (qué estamos haciendo y por
  // qué) lo manda el backend, así que solo se usa para detectar que la maniobra ya acabó.
  if (estado.estado === 'inactivo' && s.modo !== 'inactivo' && !s.temporizadores.length) {
    // Maniobra terminada sin lote final (lote perdido): no se deja la sesión colgada.
    if (s.modo === 'reconociendo' || s.modo === 'limpiando') return;
    s.modo = 'inactivo';
    emitir(s);
  }
}

export const RESOLUCION_MAPA_CM = RESOLUCION_CM;
