// Telemetría: valida lo que llega del robot, lo emite AL INSTANTE por WebSocket y solo
// después lo encola para la base de datos.
//
// El orden importa: emitir antes de persistir es lo que mantiene la latencia del mapa por
// debajo de los 300 ms aunque Postgres esté lento o caído.
import {
  bateriaPct,
  estadoDistancia,
  type Configuracion,
  type Lectura,
  type Sensor,
  type TelemetriaMqtt,
  type TipoEvento,
} from '@iot/shared';
import { z } from 'zod';
import { configuracionDe } from './configuracion.ts';
import { encolarEvento, encolarLectura } from './persistencia.ts';
import { abrirSesion, sesionActiva } from './sesiones.ts';
import { emitirEvento, emitirTelemetria } from './ws.ts';

/** Antirrebote del evento `obstaculo`: el mismo sensor no vuelve a avisar antes de 3 s. */
const REBOTE_OBSTACULO_MS = 3000;
/** Los tres sensores bajo la distancia de evasión más de 5 s seguidos = atascado. */
const ATASCADO_MS = 5000;
const BATERIA_BAJA_PCT = 20;
/** Ventana que se manda a un navegador recién conectado para que el mapa no arranque vacío. */
const HISTORIAL_EN_MEMORIA = 50;

const distancia = z.number().min(0).max(400).nullable();

export const telemetriaSchema = z.object({
  seq: z.number().int().nonnegative(),
  t: z.number().int().positive(),
  d: z.tuple([distancia, distancia, distancia]),
  e: z.enum(['avanzando', 'girando_izq', 'girando_der', 'retrocediendo', 'detenido']),
  x: z.number().finite(),
  y: z.number().finite(),
  th: z.number().finite(),
  vi: z.number().int().min(-100).max(100),
  vd: z.number().int().min(-100).max(100),
  bv: z.number().min(0).max(20),
  rssi: z.number().int().min(-120).max(0),
});

interface EstadoRobot {
  ultimaSecuencia: number;
  ultimoObstaculo: Record<Sensor, number>;
  bloqueadoDesde: number | null;
  avisadaBateriaBaja: boolean;
  historial: Lectura[];
  /** Mensajes del último segundo, para el indicador de msg/s del dashboard. */
  marcas: number[];
}

const estados = new Map<string, EstadoRobot>();

function estadoDe(dispositivoId: string): EstadoRobot {
  let e = estados.get(dispositivoId);
  if (!e) {
    e = {
      ultimaSecuencia: -1,
      ultimoObstaculo: { izq: 0, centro: 0, der: 0 },
      bloqueadoDesde: null,
      avisadaBateriaBaja: false,
      historial: [],
      marcas: [],
    };
    estados.set(dispositivoId, e);
  }
  return e;
}

/** Últimas lecturas en memoria: se las lleva un navegador al unirse a la sala del robot. */
export const historialDe = (dispositivoId: string): Lectura[] => estadoDe(dispositivoId).historial;

export function mensajesPorSegundo(dispositivoId: string): number {
  const e = estadoDe(dispositivoId);
  const corte = Date.now() - 1000;
  e.marcas = e.marcas.filter((m) => m > corte);
  return e.marcas.length;
}

export function olvidarRobot(dispositivoId: string): void {
  estados.delete(dispositivoId);
}

function registrarEvento(
  dispositivoId: string,
  sesionId: number | null,
  tipo: TipoEvento,
  mensaje: string,
  extra: { sensor?: Sensor | null; distanciaCm?: number | null; posXCm?: number | null; posYCm?: number | null } = {},
): void {
  const evento = {
    dispositivoId,
    sesionId,
    tipo,
    sensor: extra.sensor ?? null,
    distanciaCm: extra.distanciaCm ?? null,
    posXCm: extra.posXCm ?? null,
    posYCm: extra.posYCm ?? null,
    mensaje,
    creadoEn: Date.now(),
  };
  emitirEvento(dispositivoId, evento); // primero al navegador
  encolarEvento(evento); // luego a la base de datos
}

export { registrarEvento };

const NOMBRE_SENSOR: Record<Sensor, string> = { izq: 'izquierdo', centro: 'central', der: 'derecho' };

/**
 * Detecta los eventos que no vienen del robot sino de mirar la serie de lecturas:
 * obstáculo, atascado y batería baja.
 */
function detectarEventos(l: Lectura, cfg: Configuracion, e: EstadoRobot, sesionId: number | null): number {
  const lecturas: [Sensor, number | null][] = [
    ['izq', l.distIzqCm],
    ['centro', l.distCentroCm],
    ['der', l.distDerCm],
  ];
  let evasiones = 0;

  for (const [sensor, d] of lecturas) {
    if (estadoDistancia(d, cfg) !== 'evasion') continue;
    if (l.recibidoEn - e.ultimoObstaculo[sensor] < REBOTE_OBSTACULO_MS) continue;
    e.ultimoObstaculo[sensor] = l.recibidoEn;
    evasiones++;
    registrarEvento(l.dispositivoId, sesionId, 'obstaculo', `Obstáculo a ${d!.toFixed(1)} cm (sensor ${NOMBRE_SENSOR[sensor]})`, {
      sensor,
      distanciaCm: d,
      posXCm: l.posXCm,
      posYCm: l.posYCm,
    });
  }

  const todosBloqueados = lecturas.every(([, d]) => estadoDistancia(d, cfg) === 'evasion');
  if (todosBloqueados) {
    e.bloqueadoDesde ??= l.recibidoEn;
    if (l.recibidoEn - e.bloqueadoDesde > ATASCADO_MS) {
      e.bloqueadoDesde = l.recibidoEn; // reinicia la cuenta para no repetir cada lectura
      registrarEvento(l.dispositivoId, sesionId, 'atascado', 'El robot lleva más de 5 s rodeado de obstáculos', {
        posXCm: l.posXCm,
        posYCm: l.posYCm,
      });
    }
  } else {
    e.bloqueadoDesde = null;
  }

  if (l.bateriaPct < BATERIA_BAJA_PCT && !e.avisadaBateriaBaja) {
    e.avisadaBateriaBaja = true;
    registrarEvento(l.dispositivoId, sesionId, 'bateria_baja', `Batería al ${l.bateriaPct} %`, {
      posXCm: l.posXCm,
      posYCm: l.posYCm,
    });
  } else if (l.bateriaPct > BATERIA_BAJA_PCT + 10) {
    e.avisadaBateriaBaja = false; // se recargó: vuelve a poder avisar
  }

  return evasiones;
}

/**
 * Procesa un mensaje de telemetría ya parseado. Devuelve la lectura normalizada, o null si
 * era un duplicado. No lanza: un robot con el firmware mal no puede tumbar el backend.
 */
export async function procesarTelemetria(
  dispositivoId: string,
  bruto: TelemetriaMqtt,
  recibidoEn = Date.now(),
): Promise<Lectura | null> {
  const e = estadoDe(dispositivoId);

  // Duplicado: el mismo seq ya se procesó. Un seq menor que el último es un reinicio de
  // sesión (el firmware pone seq a 0 al pasar a 'automatico'), y ese sí se acepta.
  if (bruto.seq === e.ultimaSecuencia) return null;

  const sesion = sesionActiva(dispositivoId) ?? (await abrirSesion(dispositivoId));
  const cfg = await configuracionDe(dispositivoId);

  const l: Lectura = {
    dispositivoId,
    sesionId: sesion.id,
    seq: bruto.seq,
    distIzqCm: bruto.d[0],
    distCentroCm: bruto.d[1],
    distDerCm: bruto.d[2],
    movimiento: bruto.e,
    posXCm: bruto.x,
    posYCm: bruto.y,
    orientacionDeg: bruto.th,
    velIzqPct: bruto.vi,
    velDerPct: bruto.vd,
    bateriaV: bruto.bv,
    bateriaPct: bateriaPct(bruto.bv),
    rssiDbm: bruto.rssi,
    medidoEn: bruto.t,
    recibidoEn,
  };

  // 1. Al navegador, antes de cualquier escritura.
  emitirTelemetria(dispositivoId, l);

  // 2. Contadores de la sesión en memoria.
  e.ultimaSecuencia = bruto.seq;
  e.marcas.push(recibidoEn);
  e.historial.push(l);
  if (e.historial.length > HISTORIAL_EN_MEMORIA) e.historial.shift();

  sesion.ultimoMensaje = recibidoEn;
  sesion.totalLecturas++;
  sesion.maxSecuencia = Math.max(sesion.maxSecuencia, bruto.seq);
  sesion.bateriaInicioPct ??= l.bateriaPct;
  sesion.bateriaUltimaPct = l.bateriaPct;
  if (sesion.ultimaPose) {
    const dx = l.posXCm - sesion.ultimaPose.x;
    const dy = l.posYCm - sesion.ultimaPose.y;
    sesion.distanciaRecorridaCm += Math.hypot(dx, dy);
  }
  sesion.ultimaPose = { x: l.posXCm, y: l.posYCm };

  // 3. Eventos deducidos de la serie.
  sesion.totalEvasiones += detectarEventos(l, cfg, e, sesion.id);

  // 4. Y por último, la cola de persistencia.
  encolarLectura(l);
  return l;
}
