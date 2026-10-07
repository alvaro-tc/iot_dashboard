// Comandos del dashboard al robot: iniciar, pausar y detener.
//
//   navegador --Socket.IO--> aquí --MQTT roomba/{id}/cmd--> robot
//   robot --roomba/{id}/cmd/ack--> aquí --Socket.IO--> navegador
//
// Cada comando lleva un `id` y se espera su ack hasta 2 s. Si no llega, el dashboard lo
// sabe y puede decir "el robot no respondió" en lugar de dejar el botón girando.
import { randomUUID } from 'node:crypto';
import { topico } from '@iot/shared';
import { actualizarConfiguracion } from './configuracion.ts';
import { publicar } from './mqtt/bridge.ts';
import { abrirSesion, cerrarSesion } from './sesiones.ts';
import { registrarEvento } from './telemetria.ts';
import { emitirComandoAck } from './ws.ts';

const TIMEOUT_ACK_MS = 2000;

export type Accion = 'iniciar' | 'pausar' | 'detener';

const MODO_DE_ACCION = { iniciar: 'automatico', pausar: 'pausado', detener: 'detenido' } as const;

const pendientes = new Map<string, (ok: boolean) => void>();

/** Llamado por el puente cuando llega `cmd/ack`. */
export function recibirAck(dispositivoId: string, id: unknown): void {
  if (typeof id !== 'string') return;
  const resolver = pendientes.get(id);
  if (resolver) {
    pendientes.delete(id);
    resolver(true);
  }
  emitirComandoAck(dispositivoId, { id, confirmado: true });
}

export async function enviarComando(
  dispositivoId: string,
  accion: Accion,
): Promise<{ id: string; confirmado: boolean; modo: string }> {
  const modo = MODO_DE_ACCION[accion];

  // El estado de la sesión se decide aquí, no al recibir telemetría: si el robot está
  // apagado, "detener" igualmente tiene que cerrar la sesión abierta.
  if (accion === 'iniciar') await abrirSesion(dispositivoId);
  else if (accion === 'detener') await cerrarSesion(dispositivoId);

  await actualizarConfiguracion(dispositivoId, { modo }); // guarda y publica `config` retenido

  const id = randomUUID();
  const espera = new Promise<boolean>((resolve) => {
    pendientes.set(id, resolve);
    setTimeout(() => {
      if (pendientes.delete(id)) resolve(false); // el robot no contestó a tiempo
    }, TIMEOUT_ACK_MS).unref?.();
  });

  publicar(topico(dispositivoId, 'cmd'), { accion, id }, { qos: 1 });

  const confirmado = await espera;
  registrarEvento(dispositivoId, null, 'cambio_modo', `Modo ${modo}${confirmado ? '' : ' (sin confirmar por el robot)'}`);
  return { id, confirmado, modo };
}
