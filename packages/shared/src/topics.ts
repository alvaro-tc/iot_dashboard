// Tópicos MQTT del robot. Prefijo: roomba/{dispositivoId}/...
//
// El dispositivoId es el mismo id que la fila de `dispositivos` y el usuario MQTT del robot,
// así la ACL de Mosquitto puede atarse a un único prefijo por robot. Los mismos tópicos
// están en firmware/configuracion.py.

export const PREFIJO = 'roomba';

/** El backend se suscribe a todo lo que sube de los robots con un solo patrón. */
export const SUSCRIPCION_ROBOTS = `${PREFIJO}/+/+`;

/**
 * Lo que sube el robot y lo que baja.
 *
 * `barrido` y `lidar` son del firmware beta (ver firmware_beta/): el robot sube lotes de
 * muestras del sonar giratorio y su estado de mapeo, y recibe órdenes por `comando`. El
 * firmware clásico no los usa, y el backend ignora los tópicos que no conoce, así que los dos
 * firmwares conviven en el mismo broker sin tocar la ACL (que ya es roomba/{id}/#).
 */
export type TopicoSubida = 'telemetria' | 'estado' | 'barrido' | 'lidar';
export type TopicoBajada = 'config' | 'comando';

export const topico = (dispositivoId: string, t: TopicoSubida | TopicoBajada) =>
  `${PREFIJO}/${dispositivoId}/${t}`;

/** ACL: un robot solo puede hablar bajo su propio prefijo. */
export const aclPatron = (dispositivoId: string) => `${PREFIJO}/${dispositivoId}/#`;

export function parseTopico(topic: string): { dispositivoId: string; sufijo: string } | null {
  const m = new RegExp(`^${PREFIJO}/([A-Za-z0-9_-]{1,64})/(.+)$`).exec(topic);
  return m ? { dispositivoId: m[1], sufijo: m[2] } : null;
}
