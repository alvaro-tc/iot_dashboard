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
 * Lecturas en marcha -> segundos de uso. El servidor cuenta las lecturas en las que la rueda
 * tenía PWM, y cada lectura vale un intervalo de telemetría.
 */
export const segundosDeLecturas = (lecturas: number | null | undefined): number =>
  ((lecturas ?? 0) * INTERVALO_TELEMETRIA_MS) / 1000;

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
    calc: ({ resumen }: Contexto) => duracion(segundosDeLecturas(resumen.lecturasEnMarchaHoy)),
  },
  { valor: 'uso-hoy', texto: 'Tiempo de uso', alcance: 'Hoy', calc: ({ resumen }: Contexto) => duracion(resumen.segundosHoy) },
  // Acumulados de toda la vida del robot. Los de motor salen de contar sus lecturas con PWM
  // en la base, asi que aqui si hay total por rueda (en la ventana en vivo no haria falta).
  {
    valor: 'uso-total',
    texto: 'Tiempo de uso',
    alcance: 'Total',
    calc: ({ resumen }: Contexto) => duracion(resumen.segundosTotal),
  },
  {
    valor: 'motores-total',
    texto: 'Motores en marcha',
    alcance: 'Total',
    calc: ({ resumen }: Contexto) => duracion(segundosDeLecturas(resumen.lecturasEnMarchaTotal)),
  },
  {
    valor: 'motor-izq-total',
    texto: 'Motor izquierdo en marcha',
    alcance: 'Total',
    calc: ({ resumen }: Contexto) => duracion(segundosDeLecturas(resumen.lecturasMarchaIzquierdaTotal)),
  },
  {
    valor: 'motor-der-total',
    texto: 'Motor derecho en marcha',
    alcance: 'Total',
    calc: ({ resumen }: Contexto) => duracion(segundosDeLecturas(resumen.lecturasMarchaDerechaTotal)),
  },
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

// ---------------------------------------------------------------------------
// Actividad del motor: velocidad con signo a lo largo del tiempo
// ---------------------------------------------------------------------------
//
// Tres ventanas para el mismo widget. La de "vivo" sale de la telemetría que el socket tiene
// en memoria (una lectura cada 500 ms); las otras dos de los agregados de Postgres, que es el
// único sitio donde hay historial más allá de esos minutos.

export const ALCANCES = [
  { valor: 'vivo', texto: 'En vivo' },
  { valor: 'hoy', texto: 'Hoy' },
  { valor: 'total', texto: 'Total' },
] as const;
export type Alcance = (typeof ALCANCES)[number]['valor'];
export const esAlcance = (v: unknown): v is Alcance => ALCANCES.some((a) => a.valor === v);

/** Agregación que pide cada ventana: por minuto cabe el día, por hora cabe la vida del robot. */
export const AGREGACION: Record<Exclude<Alcance, 'vivo'>, 'minuto' | 'hora'> = { hoy: 'minuto', total: 'hora' };

export interface Punto {
  x: number;
  /** PWM con signo: >0 adelante, <0 atrás, null = sin dato en ese tramo. */
  y: number | null;
}

/** Velocidad instantánea de una rueda, tal como llegó por el socket. */
export const velocidadEnVivo = (lecturas: Lectura[], motor: Motor): Punto[] =>
  lecturas.map((l) => ({ x: l.creadoEn, y: pwmMotor(l, motor) }));

/**
 * Velocidad media de una rueda por tramo (minuto u hora), con su signo. Postgres devuelve los
 * `avg` como cadena, así que se convierte aquí: sin esto la gráfica compara textos.
 */
export const velocidadAgregada = (filas: FilaAgregada[], motor: Motor): Punto[] =>
  filas.map((f) => {
    const v = motor === 'izquierdo' ? f.promMovIzquierda : f.promMovDerecha;
    return { x: new Date(f.instante).getTime(), y: v === null || v === undefined ? null : Number(v) };
  });

/** Tiempo que esa rueda estuvo en marcha en el tramo agregado, en segundos. */
export const segundosMarcha = (filas: FilaAgregada[], motor: Motor): number =>
  segundosDeLecturas(
    filas.reduce((a, f) => a + Number((motor === 'izquierdo' ? f.lecturasMarchaIzquierda : f.lecturasMarchaDerecha) ?? 0), 0),
  );

/** Lo que el widget necesita de una fila agregada; `LecturaAgregada` cumple con esto. */
interface FilaAgregada {
  instante: string;
  promMovIzquierda: number | null;
  promMovDerecha: number | null;
  lecturasMarchaIzquierda: number;
  lecturasMarchaDerecha: number;
}
