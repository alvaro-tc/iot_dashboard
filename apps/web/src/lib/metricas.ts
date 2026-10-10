// Lo que cuentan los widgets de uso: nada de React aquí, solo el cálculo, para poder
// comprobarlo con `pnpm --filter @iot/web check`.
//
// Dos cosas distintas:
//   - `usoAcumulado`: serie para la gráfica de un motor. Tiempo que el motor estuvo en marcha,
//     acumulado a lo largo de la ventana de telemetría que hay en memoria.
//   - `METRICAS`: el catálogo del widget "Contador". Cada fila sabe de dónde sale su número y
//     cómo se escribe; añadir un contador nuevo es añadir una fila, el widget no cambia.
import { PWM_ACTIVO, type Lectura } from '@iot/shared';
import { duracion } from './formato.ts';
import type { Resumen } from './types.ts';

export type Motor = 'izquierdo' | 'derecho';

/**
 * Hueco máximo que se cuenta entre dos lecturas. Sin tope, un corte de WiFi de diez minutos
 * se apuntaría como diez minutos de motor en marcha.
 */
const HUECO_MAX_S = 2;

/** Cada cuánto publica el robot (INTERVALO_MQTT_MS del firmware): una lectura = este tiempo. */
export const INTERVALO_TELEMETRIA_MS = 500;

export const NOMBRE_MOTOR: Record<Motor, string> = { izquierdo: 'izquierdo', derecho: 'derecho' };

export const pwmMotor = (l: Lectura, motor: Motor) =>
  motor === 'izquierdo' ? l.movimientoIzquierda : l.movimientoDerecha;

/**
 * Serie {x: instante, y: segundos acumulados} del tiempo que el motor estuvo en marcha.
 * El tramo entre dos lecturas se cuenta como activo si la primera lo estaba: es lo que el
 * robot hizo durante ese tramo, no lo que hace al final.
 */
export function usoAcumulado(lecturas: Lectura[], motor: Motor): { x: number; y: number }[] {
  const serie: { x: number; y: number }[] = [];
  let acumulado = 0;
  for (let i = 0; i < lecturas.length; i++) {
    const l = lecturas[i];
    if (i > 0) {
      const dt = Math.min(HUECO_MAX_S, Math.max(0, (l.creadoEn - lecturas[i - 1].creadoEn) / 1000));
      if (Math.abs(pwmMotor(lecturas[i - 1], motor)) >= PWM_ACTIVO) acumulado += dt;
    }
    serie.push({ x: l.creadoEn, y: acumulado });
  }
  return serie;
}

/**
 * Segundos de motores en marcha hoy. El servidor cuenta las lecturas en las que alguna rueda
 * tenía PWM, y cada lectura vale un intervalo de telemetría.
 */
export function segundosMotores(resumen: Resumen): number {
  return ((resumen.lecturasEnMarchaHoy ?? 0) * INTERVALO_TELEMETRIA_MS) / 1000;
}

interface Contexto {
  resumen: Resumen;
  /** Telemetria que el socket tiene en memoria: de aqui salen las metricas por motor. */
  lecturas: Lectura[];
  /** Ahora, en ms. Parámetro y no `Date.now()` para poder comprobar la duración de la sesión. */
  ahora: number;
}

const entero = (n: number) => Math.round(n).toLocaleString('es');

/** Catálogo del contador. `calc` devuelve el número ya escrito, con su unidad. */
export const METRICAS = [
  {
    valor: 'motores-hoy',
    texto: 'Motores en marcha',
    alcance: 'Hoy',
    calc: ({ resumen }: Contexto) => duracion(segundosMotores(resumen)),
  },
  { valor: 'uso-hoy', texto: 'Tiempo de uso', alcance: 'Hoy', calc: ({ resumen }: Contexto) => duracion(resumen.segundosHoy) },
  // El servidor no guarda el PWM por rueda agregado, asi que el tiempo de cada motor por
  // separado solo se puede medir sobre la telemetria en memoria. Es el total de su grafica.
  {
    valor: 'motor-izq',
    texto: 'Motor izquierdo en marcha',
    alcance: 'Ventana en vivo',
    calc: ({ lecturas }: Contexto) => duracion(usoAcumulado(lecturas, 'izquierdo').at(-1)?.y ?? 0),
  },
  {
    valor: 'motor-der',
    texto: 'Motor derecho en marcha',
    alcance: 'Ventana en vivo',
    calc: ({ lecturas }: Contexto) => duracion(usoAcumulado(lecturas, 'derecho').at(-1)?.y ?? 0),
  },
  {
    valor: 'obstaculos-hoy',
    texto: 'Lecturas con obstáculo cerca',
    alcance: 'Hoy',
    calc: ({ resumen }: Contexto) =>
      entero((resumen.cercaIzquierda ?? 0) + (resumen.cercaCentral ?? 0) + (resumen.cercaDerecha ?? 0)),
  },
  {
    valor: 'bateria',
    texto: 'Batería',
    alcance: 'Última lectura',
    calc: ({ resumen }: Contexto) =>
      resumen.bateriaPorcentaje === null || resumen.bateriaPorcentaje === undefined
        ? '—'
        : `${Math.round(resumen.bateriaPorcentaje)} %`,
  },
  {
    valor: 'sesion-duracion',
    texto: 'Duración',
    alcance: 'Sesión en curso',
    calc: ({ resumen, ahora }: Contexto) => (resumen.sesion ? duracion((ahora - resumen.sesion.iniciadaEn) / 1000) : '—'),
  },
  {
    valor: 'sesion-lecturas',
    texto: 'Lecturas recibidas',
    alcance: 'Sesión en curso',
    calc: ({ resumen }: Contexto) => (resumen.sesion ? entero(resumen.sesion.lecturas) : '—'),
  },
  {
    valor: 'mensajes',
    texto: 'Mensajes por segundo',
    alcance: 'Ahora',
    calc: ({ resumen }: Contexto) => entero(resumen.mensajesPorSegundo ?? 0),
  },
] as const;

export type IdMetrica = (typeof METRICAS)[number]['valor'];

export const metrica = (id: IdMetrica) => METRICAS.find((m) => m.valor === id) ?? METRICAS[0];
