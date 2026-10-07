// Tópicos MQTT del robot. Prefijo: roomba/{dispositivoId}/...
//
// El dispositivoId es el mismo id que la fila de `dispositivos` y el usuario MQTT del robot,
// así la ACL de Mosquitto puede atarse a un único prefijo por robot.

export const PREFIJO = 'roomba';

/** El backend se suscribe a todo lo que sube de los robots con un solo patrón. */
export const SUSCRIPCION_ROBOTS = `${PREFIJO}/+/+`;
/** `telemetria/lote` y `cmd/ack` tienen dos niveles tras el id. */
export const SUSCRIPCION_ROBOTS_SUB = `${PREFIJO}/+/+/+`;

export type TopicoSubida = 'telemetria' | 'telemetria/lote' | 'estado' | 'evento' | 'cmd/ack';
export type TopicoBajada = 'cmd' | 'config';

export const topico = (dispositivoId: string, t: TopicoSubida | TopicoBajada) =>
  `${PREFIJO}/${dispositivoId}/${t}`;

/** ACL: un robot solo puede hablar bajo su propio prefijo. */
export const aclPatron = (dispositivoId: string) => `${PREFIJO}/${dispositivoId}/#`;

export function parseTopico(topic: string): { dispositivoId: string; sufijo: string } | null {
  const m = new RegExp(`^${PREFIJO}/([A-Za-z0-9_-]{1,64})/(.+)$`).exec(topic);
  return m ? { dispositivoId: m[1], sufijo: m[2] } : null;
}
