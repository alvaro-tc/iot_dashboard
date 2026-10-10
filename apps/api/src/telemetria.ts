// Telemetría: valida lo que llega del robot, lo emite AL INSTANTE por WebSocket y solo
// después lo encola para la base de datos.
//
// El orden importa: emitir antes de persistir es lo que mantiene la latencia del dashboard
// por debajo de los 300 ms aunque Postgres esté lento o caído.
//
// El esquema de entrada es el diccionario que publica `firmware/main.py` tal cual: claves
// completas en español, distancias por sensor y PWM con signo por rueda.
import { bateriaPorcentaje, PWM_MAX, type Lectura, type TelemetriaMqtt } from '@iot/shared';
import { z } from 'zod';
import { encolarLectura } from './persistencia.ts';
import { abrirSesion, sesionActiva } from './sesiones.ts';
import { emitirTelemetria } from './ws.ts';

/** Ventana que se manda a un navegador recién conectado para que el panel no arranque vacío. */
const HISTORIAL_EN_MEMORIA = 50;

const distancia = z.number().min(0).max(400).nullable();
const pwm = z.number().int().min(-PWM_MAX).max(PWM_MAX);

export const telemetriaSchema = z.object({
  robot_id: z.string().max(64).optional(),
  distancias_cm: z.object({
    izquierdo: distancia.default(null),
    central: distancia.default(null),
    derecho: distancia.default(null),
  }),
  bateria_v: z.number().min(0).max(20),
  bateria_porcentaje: z.number().int().min(0).max(100).optional(),
  motores: z.object({ izquierda_pwm: pwm, derecha_pwm: pwm }),
});

interface EstadoRobot {
  historial: Lectura[];
  /** Mensajes del último segundo, para el indicador de msg/s del dashboard. */
  marcas: number[];
}

const estados = new Map<string, EstadoRobot>();

function estadoDe(dispositivoId: string): EstadoRobot {
  let e = estados.get(dispositivoId);
  if (!e) {
    e = { historial: [], marcas: [] };
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

/**
 * Procesa un mensaje de telemetría ya parseado y devuelve la lectura normalizada. No lanza:
 * un robot con el firmware mal no puede tumbar el backend.
 */
export async function procesarTelemetria(
  dispositivoId: string,
  bruto: TelemetriaMqtt,
  recibidoEn = Date.now(),
): Promise<Lectura> {
  const e = estadoDe(dispositivoId);
  const sesion = sesionActiva(dispositivoId) ?? (await abrirSesion(dispositivoId));

  const l: Lectura = {
    dispositivoId,
    sesionId: sesion.id,
    distanciaIzquierdaCm: bruto.distancias_cm.izquierdo,
    distanciaCentralCm: bruto.distancias_cm.central,
    distanciaDerechaCm: bruto.distancias_cm.derecho,
    movimientoIzquierda: bruto.motores.izquierda_pwm,
    movimientoDerecha: bruto.motores.derecha_pwm,
    bateriaVoltios: bruto.bateria_v,
    // El robot ya manda el porcentaje; si no lo trae, se deduce del voltaje.
    bateriaPorcentaje: bruto.bateria_porcentaje ?? bateriaPorcentaje(bruto.bateria_v),
    creadoEn: recibidoEn,
  };

  // 1. Al navegador, antes de cualquier escritura.
  emitirTelemetria(dispositivoId, l);

  // 2. Contadores de la sesión en memoria.
  e.marcas.push(recibidoEn);
  e.historial.push(l);
  if (e.historial.length > HISTORIAL_EN_MEMORIA) e.historial.shift();

  sesion.ultimoMensaje = recibidoEn;
  sesion.totalLecturas++;
  sesion.bateriaInicioPorcentaje ??= l.bateriaPorcentaje;
  sesion.bateriaUltimaPorcentaje = l.bateriaPorcentaje;

  // 3. Y por último, la cola de persistencia.
  encolarLectura(l);
  return l;
}
