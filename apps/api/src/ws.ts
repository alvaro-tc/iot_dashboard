// Gateway Socket.IO, namespace /live.
//
// Autenticación: el navegador manda el JWT en el handshake (`auth.token`). Sin token válido
// la conexión se rechaza; al unirse a la sala de un robot se comprueba que sea suyo (o que
// quien pide sea admin).
//
// Salas: una por robot, `robot:{id}`. Así la telemetría de un robot no viaja a navegadores
// que están mirando otro, que es lo que pasaba con el broadcast filtrado por rol anterior.
//
//   Cliente -> servidor: unirse, salir, comando, actualizar_config, sincronizar_reloj
//   Servidor -> cliente: telemetria, evento, estado, config, comando_ack
import type { Server as HttpServer } from 'node:http';
import type { EventoRobot, Lectura } from '@iot/shared';
import { Server, type Socket } from 'socket.io';
import { userFromToken, type AuthUser } from './auth.ts';
import { actualizarConfiguracion, configSchema, configuracionDe } from './configuracion.ts';
import { pool } from './db.ts';
import { enviarComando } from './comandos.ts';
import { historialDe } from './telemetria.ts';

const sala = (dispositivoId: string) => `robot:${dispositivoId}`;

let io: Server | null = null;
export const clientesConectados = () => io?.of('/live').sockets.size ?? 0;

interface DatosSocket {
  user: AuthUser;
}

/** Comprueba que el robot existe y que el usuario puede verlo. */
async function puedeVer(user: AuthUser, dispositivoId: string): Promise<boolean> {
  const { rows } = await pool.query<{ user_id: number }>('SELECT user_id FROM dispositivos WHERE id = $1', [
    dispositivoId,
  ]);
  if (!rows[0]) return false;
  return user.role === 'admin' || rows[0].user_id === user.id;
}

export function attachWebSocket(server: HttpServer): Server {
  io = new Server(server, {
    path: '/socket.io',
    cors: { origin: true, credentials: true },
    // El robot publica a 5 Hz; no hace falta un ping más agresivo que esto.
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  const live = io.of('/live');

  live.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    const user = await userFromToken(token);
    if (!user) return next(new Error('unauthorized'));
    (socket.data as DatosSocket).user = user;
    next();
  });

  live.on('connection', (socket: Socket) => {
    const { user } = socket.data as DatosSocket;

    // El navegador corrige el desfase de su reloj contra el del servidor para que la
    // latencia que muestra (Date.now() - t) no mida la diferencia de relojes.
    socket.on('sincronizar_reloj', (enviadoEn: number, ack?: (r: unknown) => void) => {
      ack?.({ enviadoEn, servidor: Date.now() });
    });

    socket.on('unirse', async (dispositivoId: unknown, ack?: (r: unknown) => void) => {
      if (typeof dispositivoId !== 'string' || !(await puedeVer(user, dispositivoId))) {
        ack?.({ ok: false, error: 'No tienes acceso a ese robot.' });
        return;
      }
      await socket.join(sala(dispositivoId));

      // Estado inicial de golpe: así el mapa no arranca vacío esperando la siguiente lectura.
      const { rows } = await pool.query(
        `SELECT en_linea AS "enLinea", ultimo_contacto AS "ultimoContacto", version_firmware AS "versionFirmware"
         FROM dispositivos WHERE id = $1`,
        [dispositivoId],
      );
      ack?.({
        ok: true,
        estado: rows[0] ?? null,
        config: await configuracionDe(dispositivoId),
        historial: historialDe(dispositivoId),
      });
    });

    socket.on('salir', (dispositivoId: unknown) => {
      if (typeof dispositivoId === 'string') void socket.leave(sala(dispositivoId));
    });

    socket.on('comando', async (payload: unknown, ack?: (r: unknown) => void) => {
      const p = payload as { dispositivoId?: string; accion?: string };
      if (typeof p?.dispositivoId !== 'string' || !(await puedeVer(user, p.dispositivoId))) {
        ack?.({ ok: false, error: 'No tienes acceso a ese robot.' });
        return;
      }
      if (p.accion !== 'iniciar' && p.accion !== 'pausar' && p.accion !== 'detener') {
        ack?.({ ok: false, error: 'Acción desconocida.' });
        return;
      }
      try {
        const r = await enviarComando(p.dispositivoId, p.accion);
        ack?.({ ok: true, ...r });
      } catch (e) {
        ack?.({ ok: false, error: (e as Error).message });
      }
    });

    socket.on('actualizar_config', async (payload: unknown, ack?: (r: unknown) => void) => {
      const p = payload as { dispositivoId?: string; cambio?: unknown };
      if (typeof p?.dispositivoId !== 'string' || !(await puedeVer(user, p.dispositivoId))) {
        ack?.({ ok: false, error: 'No tienes acceso a ese robot.' });
        return;
      }
      const parsed = configSchema.safeParse(p.cambio);
      if (!parsed.success) {
        ack?.({ ok: false, error: 'Configuración fuera de rango.' });
        return;
      }
      try {
        const cfg = await actualizarConfiguracion(p.dispositivoId, parsed.data);
        emitirConfig(p.dispositivoId, cfg);
        ack?.({ ok: true, config: cfg });
      } catch (e) {
        ack?.({ ok: false, error: (e as Error).message });
      }
    });
  });

  return io;
}

const aSala = (dispositivoId: string, evento: string, payload: unknown) =>
  io?.of('/live').to(sala(dispositivoId)).emit(evento, payload);

export const emitirTelemetria = (dispositivoId: string, l: Lectura) => aSala(dispositivoId, 'telemetria', l);
export const emitirEvento = (dispositivoId: string, e: Omit<EventoRobot, 'id'>) => aSala(dispositivoId, 'evento', e);
export const emitirConfig = (dispositivoId: string, cfg: unknown) => aSala(dispositivoId, 'config', cfg);
export const emitirComandoAck = (dispositivoId: string, ack: unknown) => aSala(dispositivoId, 'comando_ack', ack);
export const emitirEstado = (dispositivoId: string, estado: unknown) => aSala(dispositivoId, 'estado', estado);

/** Echa a los sockets de un usuario desactivado, eliminado o con el rol cambiado. */
export function disconnectUser(userId: number): void {
  for (const socket of io?.of('/live').sockets.values() ?? []) {
    if ((socket.data as DatosSocket).user?.id === userId) socket.disconnect(true);
  }
}
