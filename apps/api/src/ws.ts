// Gateway Socket.IO, namespace /live.
//
// Autenticación: el navegador manda el JWT en el handshake (`auth.token`). Sin token válido
// la conexión se rechaza; al unirse a la sala de un robot se comprueba que sea suyo (o que
// quien pide sea admin).
//
// Salas: una por robot, `robot:{id}`. Así la telemetría de un robot no viaja a navegadores
// que están mirando otro, que es lo que pasaba con el broadcast filtrado por rol anterior.
//
// Además de las salas por robot, cada socket entra en `usuario:{id}` (y los admin en `admins`).
// Por ahí van los cambios en lo que guarda Postgres:
//
//   `datos`     la vista ya recalculada ({clave, valor}); el navegador la mete tal cual
//               en la caché de react-query y se redibuja sin pedir nada por HTTP.
//   `invalidar` solo para las vistas que dependen del rango que esté mirando el navegador
//               (histórico, actividad por motor): ahí el servidor no sabe qué calcular.
//
//   Cliente -> servidor: unirse, salir, actualizar_config, sincronizar_reloj
//   Servidor -> cliente: telemetria, estado, config, datos, invalidar
import type { Server as HttpServer } from 'node:http';
import type { Lectura } from '@iot/shared';
import { Server, type Socket } from 'socket.io';
import { userFromToken, type AuthUser } from './auth.ts';
import { actualizarConfiguracion, configSchema, configuracionDe } from './configuracion.ts';
import { pool } from './db.ts';
import { flotaRobots, listaDispositivos, listaUsuarios, resumenDe, resumenFlota, sesionesDe } from './consultas.ts';
import { guardarPreferencia, preferenciasDe } from './preferencias.ts';
import { ajustesDe, salasDe } from './lidar/datos.ts';
import { estadoCompleto } from './lidar/mapeo.ts';
import { lidarHabilitado } from './routes/lidar.ts';
import { historialDe } from './telemetria.ts';

const sala = (dispositivoId: string) => `robot:${dispositivoId}`;
/**
 * Sala aparte para el modo lidar. No basta con no pintar el menú: si los eventos `lidar`
 * fueran a la sala del robot, un cliente sin el permiso los recibiría igual y le bastaría
 * abrir las herramientas del navegador para ver que la función existe. Solo entran aquí los
 * sockets cuya cuenta tiene el permiso.
 */
const salaLidar = (dispositivoId: string) => `lidar:${dispositivoId}`;
const salaUsuario = (usuarioId: number) => `usuario:${usuarioId}`;
const SALA_ADMINS = 'admins';

let io: Server | null = null;
export const clientesConectados = () => io?.of('/live').sockets.size ?? 0;

interface DatosSocket {
  user: AuthUser;
}

/** Comprueba que el robot existe y que el usuario puede verlo. */
async function puedeVer(user: AuthUser, dispositivoId: string): Promise<boolean> {
  const { rows } = await pool.query<{ usuario_id: number }>('SELECT usuario_id FROM dispositivos WHERE id = $1', [
    dispositivoId,
  ]);
  if (!rows[0]) return false;
  return user.role === 'admin' || rows[0].usuario_id === user.id;
}

export function attachWebSocket(server: HttpServer): Server {
  io = new Server(server, {
    path: '/socket.io',
    cors: { origin: true, credentials: true },
    // El robot publica unas pocas veces por segundo; no hace falta un ping más agresivo.
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

    // Tema y panel de la cuenta, de golpe al conectar: el navegador aplica lo que tenga el
    // servidor (que manda sobre lo que hubiera guardado este navegador) y, si el servidor
    // todavía no tiene nada, sube lo suyo.
    void (async () => {
      await socket.join(salaUsuario(user.id));
      socket.emit('preferencias', await preferenciasDe(user.id));
    })().catch((e) => console.warn(`[ws] preferencias de ${user.id}: ${(e as Error).message}`));

    socket.on('guardar_pref', async (payload: unknown, ack?: (r: unknown) => void) => {
      const { clave, valor, ts } = (payload ?? {}) as { clave?: unknown; valor?: unknown; ts?: unknown };
      try {
        const r = await guardarPreferencia(user.id, clave, valor, ts);
        if (!r) {
          ack?.({ ok: false, error: 'Preferencia no reconocida.' });
          return;
        }
        // Al resto de la cuenta, no a quien lo manda: ya lo tiene aplicado. Si ha perdido
        // (su copia era más vieja), no se reparte nada: la vigente ya la tienen todos, y a
        // quien ha perdido se le devuelve en el ack para que se ponga al día.
        if (r.guardado) socket.to(salaUsuario(user.id)).emit('pref', { clave, ...r.entrada });
        ack?.({ ok: r.guardado, ...r.entrada });
      } catch (e) {
        ack?.({ ok: false, error: (e as Error).message });
      }
    });

    // Un admin ve datos globales: entra también en la sala de invalidaciones de la flota.
    if (user.role === 'admin') void socket.join(SALA_ADMINS);

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
      const conLidar = user.role === 'admin' || (await lidarHabilitado(user.id));
      if (conLidar) await socket.join(salaLidar(dispositivoId));

      // Estado inicial de golpe: así el panel no arranca vacío esperando la siguiente lectura.
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
        // El estado del mapeo (con el mapa guardado, si lo hay) viaja en el mismo ack: así el
        // plano aparece dibujado al abrir el panel, sin esperar al siguiente barrido.
        lidar: conLidar ? await estadoCompleto(dispositivoId, (await ajustesDe(dispositivoId)).salaActivaId) : undefined,
      });
    });

    socket.on('salir', (dispositivoId: unknown) => {
      if (typeof dispositivoId !== 'string') return;
      void socket.leave(sala(dispositivoId));
      void socket.leave(salaLidar(dispositivoId));
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
export const emitirConfig = (dispositivoId: string, cfg: unknown) => aSala(dispositivoId, 'config', cfg);
export const emitirEstado = (dispositivoId: string, estado: unknown) => aSala(dispositivoId, 'estado', estado);
/** Modo lidar: estado del mapeo y, cuando cambia, la rejilla. Solo a la sala del robot. */
export const emitirLidar = (dispositivoId: string, payload: unknown) =>
  io?.of('/live').to(salaLidar(dispositivoId)).emit('lidar', payload);

/**
 * Recalcula la vista `clave`. `undefined` = no se puede empujar y toca invalidar: o no es
 * una vista que el servidor sepa reconstruir (histórico y actividad por motor dependen del
 * rango que esté abierto en el navegador), o falta saber de qué robot.
 */
async function calcular(clave: string, user: AuthUser, dispositivoId?: string): Promise<unknown> {
  switch (clave) {
    case 'dispositivos':
      return listaDispositivos(user);
    case 'admin-robots':
      return flotaRobots();
    case 'admin-resumen':
      return resumenFlota();
    case 'admin-users':
      return listaUsuarios();
    case 'sesiones':
      return dispositivoId ? sesionesDe(dispositivoId) : undefined;
    case 'salas':
      // Solo para quien tiene el modo lidar: a los demás no se les empuja ni la lista vacía.
      return dispositivoId && (user.role === 'admin' || (await lidarHabilitado(user.id)))
        ? salasDe(dispositivoId)
        : undefined;
    case 'resumen':
      return dispositivoId ? resumenDe(dispositivoId) : undefined;
    default:
      return undefined;
  }
}

/**
 * La queryKey tal y como la escribe el navegador: el nombre de la vista y, en las que son
 * de un robot, su id detrás. Tiene que coincidir con los useQuery del front o el valor
 * empujado acabaría en una entrada de la caché que nadie mira. Ver ws.check.ts.
 */
export const claveDe = (vista: string, dispositivoId?: string): unknown[] =>
  vista === 'sesiones' || vista === 'resumen' || vista === 'salas' ? [vista, dispositivoId] : [vista];

const hayAlguien = (sala: string) => (io?.of('/live').adapter.rooms.get(sala)?.size ?? 0) > 0;

async function duenoDe(dispositivoId: string): Promise<number | undefined> {
  const { rows } = await pool.query<{ usuario_id: number }>(
    'SELECT usuario_id FROM dispositivos WHERE id = $1',
    [dispositivoId],
  );
  return rows[0]?.usuario_id;
}

/**
 * Manda a los navegadores afectados el valor nuevo de cada vista.
 *
 * Hay dos audiencias y por tanto dos cálculos como mucho: el dueño (que solo ve lo suyo) y
 * los admin (que ven la flota entera). Un admin que además sea el dueño está solo en la
 * segunda, de ahí el `except`: si no, recibiría las dos versiones de `dispositivos` y
 * ganaría la que llegase última.
 *
 * Si no hay nadie escuchando no se toca la base de datos.
 */
async function empujar(claves: string[], ctx: { usuarioId?: number; dispositivoId?: string }): Promise<void> {
  const live = io?.of('/live');
  if (!live) return;
  const usuarioId = ctx.usuarioId ?? (ctx.dispositivoId ? await duenoDe(ctx.dispositivoId) : undefined);

  const audiencias: { a: ReturnType<typeof live.to>; user: AuthUser }[] = [];
  if (usuarioId !== undefined && hayAlguien(salaUsuario(usuarioId))) {
    audiencias.push({
      a: live.to(salaUsuario(usuarioId)).except(SALA_ADMINS),
      user: { id: usuarioId, role: 'cliente' } as AuthUser,
    });
  }
  if (hayAlguien(SALA_ADMINS)) {
    audiencias.push({ a: live.to(SALA_ADMINS), user: { id: 0, role: 'admin' } as AuthUser });
  }

  for (const { a, user } of audiencias) {
    const invalidar: string[] = [];
    for (const clave of claves) {
      // Las vistas de admin no se calculan (ni viajan) para un cliente.
      if (clave.startsWith('admin-') && user.role !== 'admin') continue;
      const valor = await calcular(clave, user, ctx.dispositivoId).catch((e) => {
        console.warn(`[ws] no se pudo recalcular ${clave}: ${(e as Error).message}`);
        return undefined;
      });
      if (valor === undefined) invalidar.push(clave);
      else a.emit('datos', { clave: claveDe(clave, ctx.dispositivoId), valor });
    }
    if (invalidar.length) a.emit('invalidar', invalidar);
  }
}

const fallo = (e: unknown) => console.warn(`[ws] empuje: ${(e as Error).message}`);

/** Empuja las vistas tras un cambio de un usuario. Sin `usuarioId`, solo a los admin. */
export function emitirCambio(claves: string[], usuarioId?: number): void {
  void empujar(claves, { usuarioId }).catch(fallo);
}

/** Igual, resolviendo el dueño a partir del robot. */
export function emitirCambioRobot(dispositivoId: string, claves: string[]): void {
  void empujar(claves, { dispositivoId }).catch(fallo);
}

/** Echa a los sockets de un usuario desactivado, eliminado o con el rol cambiado. */
export function disconnectUser(userId: number): void {
  for (const socket of io?.of('/live').sockets.values() ?? []) {
    if ((socket.data as DatosSocket).user?.id === userId) socket.disconnect(true);
  }
}
