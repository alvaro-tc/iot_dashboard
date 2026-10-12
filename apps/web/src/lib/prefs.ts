// Resolución de conflictos de las preferencias de la cuenta: gana la edición más reciente.
//
// Aparte para poder probarlo sin React: es la parte con filo de la sincronización. Hay dos
// riesgos, y los dos se cortan recordando qué valor y de qué hora está ya acordado con el
// servidor (`sincronizado`):
//
//   - El ciclo: aplico lo que llega -> lo publico -> le llega al otro -> lo publica...
//   - El dispositivo rancio: uno que llevaba días apagado (o sin conexión) se conecta y
//     publica su copia vieja encima del cambio que se hizo ayer en otro.
//
// Por eso cada valor viaja con la hora de su última edición y no basta el orden de llegada.
// La hora es SIEMPRE la del servidor: cada navegador le resta su desfase (lo mide el handshake
// del socket), así dos dispositivos con el reloj descuadrado siguen siendo comparables.

/** Un valor de preferencia con la hora (reloj del servidor, ms) en que se editó. */
export interface Entrada {
  valor: string;
  /** 0 = hora desconocida: valor guardado antes de que se guardaran las horas. Pierde. */
  ts: number;
}

export interface Decision {
  /** Valor llegado del servidor que hay que aplicar al estado local. */
  aplicar?: string;
  /** Entrada local que hay que subir al servidor. */
  publicar?: Entrada;
  /** Nuevo `sincronizado` (undefined = se queda como estaba). */
  sincronizado?: Entrada;
}

/**
 * @param remoto      lo que tiene la cuenta, o undefined si nunca guardó esta clave.
 * @param local        valor serializado del estado de este navegador ahora mismo.
 * @param sincronizado lo último acordado con el servidor (al montar: lo que hubiera en este
 *                     navegador, con la hora de su última edición).
 * @param cargado      ya han llegado las preferencias de la cuenta.
 * @param ahora        hora actual en el reloj del servidor.
 */
export function decidir(
  remoto: Entrada | undefined,
  local: string,
  sincronizado: Entrada,
  cargado: boolean,
  ahora: number,
): Decision {
  // Sin las preferencias de la cuenta todavía no se publica nada: subir el estado inicial de
  // este navegador antes de saber qué hay guardado borraría la preferencia buena.
  if (!cargado) return {};

  // Cambio hecho aquí hace un instante: es la edición más reciente que existe, gana siempre.
  if (local !== sincronizado.valor) {
    const mio = { valor: local, ts: ahora };
    return { publicar: mio, sincronizado: mio };
  }

  // La cuenta no tiene esta clave: se sube lo que haya aquí, con su hora real (puede ser 0).
  if (!remoto) return { publicar: sincronizado, sincronizado };

  // Mismo valor: nada que aplicar. Se adopta su hora si es más nueva, para no volver a
  // compararse contra una hora vieja en el siguiente conflicto.
  if (remoto.valor === sincronizado.valor) return remoto.ts > sincronizado.ts ? { sincronizado: remoto } : {};

  // Conflicto de verdad. Gana el más reciente; en empate gana el servidor, que es el mismo
  // para todos: así los dos dispositivos acaban en el mismo valor y no se turnan pisándose.
  if (remoto.ts >= sincronizado.ts) return { aplicar: remoto.valor, sincronizado: remoto };
  return { publicar: sincronizado, sincronizado };
}
