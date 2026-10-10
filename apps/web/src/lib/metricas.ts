// Lo que cuentan los widgets de uso: nada de React aquí, solo el cálculo, para poder
// comprobarlo con `pnpm --filter @iot/web check`.
//
// Dos cosas distintas:
//   - `usoAcumulado`: serie para la gráfica de un motor. Tiempo que el motor estuvo en marcha,
//     acumulado a lo largo de la ventana de telemetría que hay en memoria.
//   - `METRICAS`: el catálogo del widget "Contador". Cada fila sabe de dónde sale su número y
//     cómo se escribe; añadir un contador nuevo es añadir una fila, el widget no cambia.
import type { Configuracion, Lectura } from '@iot/shared';
import { distancia, duracion } from './formato.ts';
import type { Resumen } from './types.ts';

export type Motor = 'izq' | 'der';

/** Por debajo de esto el PWM es ruido o freno, no marcha: el motor no está "en uso". */
export const PWM_ACTIVO_PCT = 3;
/**
 * Hueco máximo que se cuenta entre dos lecturas. Sin tope, un corte de WiFi de diez minutos
 * se apuntaría como diez minutos de motor en marcha.
 */
const HUECO_MAX_S = 2;

export const NOMBRE_MOTOR: Record<Motor, string> = { izq: 'izquierdo', der: 'derecho' };

export const velMotor = (l: Lectura, motor: Motor) => (motor === 'izq' ? l.velIzqPct : l.velDerPct);

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
      const dt = Math.min(HUECO_MAX_S, Math.max(0, (l.medidoEn - lecturas[i - 1].medidoEn) / 1000));
      if (Math.abs(velMotor(lecturas[i - 1], motor)) >= PWM_ACTIVO_PCT) acumulado += dt;
    }
    serie.push({ x: l.medidoEn, y: acumulado });
  }
  return serie;
}

/**
 * Segundos de motores en marcha hoy. El servidor no guarda el PWM agregado, así que se cuenta
 * por estado de movimiento: todo lo que no es "detenido" mueve las dos ruedas (girar es un
 * motor en cada sentido). Cada lectura vale un intervalo de telemetría.
 */
export function segundosMotores(resumen: Resumen, cfg: Configuracion): number {
  const m = resumen.movimientos;
  if (!m) return 0;
  const activas = m.avanzando + m.girando_izq + m.girando_der + m.retrocediendo;
  return (activas * cfg.intervaloTelemetriaMs) / 1000;
}

interface Contexto {
  resumen: Resumen;
  cfg: Configuracion;
  /** Telemetria que el socket tiene en memoria: de aqui salen las metricas por motor. */
  lecturas: Lectura[];
  /** Ahora, en ms. Parámetro y no `Date.now()` para poder comprobar la duración de la sesión. */
  ahora: number;
}

const entero = (n: number) => n.toLocaleString('es');

/** Catálogo del contador. `calc` devuelve el número ya escrito, con su unidad. */
export const METRICAS = [
  {
    valor: 'motores-hoy',
    texto: 'Motores en marcha',
    alcance: 'Hoy',
    calc: ({ resumen, cfg }: Contexto) => duracion(segundosMotores(resumen, cfg)),
  },
  { valor: 'uso-hoy', texto: 'Tiempo de uso', alcance: 'Hoy', calc: ({ resumen }: Contexto) => duracion(resumen.segundosHoy) },
  // El servidor no guarda el PWM por rueda, asi que el tiempo de cada motor por separado solo
  // se puede medir sobre la telemetria en memoria. Es el total de la grafica de ese motor.
  {
    valor: 'motor-izq',
    texto: 'Motor izquierdo en marcha',
    alcance: 'Ventana en vivo',
    calc: ({ lecturas }: Contexto) => duracion(usoAcumulado(lecturas, 'izq').at(-1)?.y ?? 0),
  },
  {
    valor: 'motor-der',
    texto: 'Motor derecho en marcha',
    alcance: 'Ventana en vivo',
    calc: ({ lecturas }: Contexto) => duracion(usoAcumulado(lecturas, 'der').at(-1)?.y ?? 0),
  },
  {
    valor: 'distancia-hoy',
    texto: 'Distancia recorrida',
    alcance: 'Hoy',
    calc: ({ resumen }: Contexto) => distancia(resumen.distanciaHoyCm),
  },
  {
    valor: 'evasiones-hoy',
    texto: 'Evasiones',
    alcance: 'Hoy',
    calc: ({ resumen }: Contexto) => entero(resumen.evasionesIzq + resumen.evasionesCentro + resumen.evasionesDer),
  },
  {
    valor: 'sesion-duracion',
    texto: 'Duración',
    alcance: 'Sesión en curso',
    calc: ({ resumen, ahora }: Contexto) => (resumen.sesion ? duracion((ahora - resumen.sesion.iniciadaEn) / 1000) : '—'),
  },
  {
    valor: 'sesion-distancia',
    texto: 'Distancia',
    alcance: 'Sesión en curso',
    calc: ({ resumen }: Contexto) => (resumen.sesion ? distancia(resumen.sesion.distanciaCm) : '—'),
  },
  {
    valor: 'sesion-evasiones',
    texto: 'Evasiones',
    alcance: 'Sesión en curso',
    calc: ({ resumen }: Contexto) => (resumen.sesion ? entero(resumen.sesion.evasiones) : '—'),
  },
  {
    valor: 'sesion-lecturas',
    texto: 'Lecturas recibidas',
    alcance: 'Sesión en curso',
    calc: ({ resumen }: Contexto) => (resumen.sesion ? entero(resumen.sesion.lecturas) : '—'),
  },
] as const;

export type IdMetrica = (typeof METRICAS)[number]['valor'];

export const metrica = (id: IdMetrica) => METRICAS.find((m) => m.valor === id) ?? METRICAS[0];
