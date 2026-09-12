// WebSocket /ws?token=JWT
//
// Último eslabón de la cadena MQTT -> sesiones -> Postgres -> WebSocket. Cada conexión recibe
// solo lo que le corresponde por rol:
//   - admin:  todos los eventos de todos los clientes, con todos los campos.
//   - client: solo los eventos de sus propias sesiones, y SIN value, errorAbs, iteration ni
//             contadores. Los payloads de cliente se construyen campo a campo (lista blanca):
//             si mañana se añade un campo numérico al evento, no se filtra por accidente.
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { userFromToken, type AuthUser } from './auth.ts';

export type LiveEvent =
  | {
      type: 'sample';
      userId: number;
      payload: { id: number; runId: number; seriesKey: string; iteration: number; value: number; errorAbs: number; createdAt: Date };
    }
  | {
      type: 'run_start';
      userId: number;
      payload: { runId: number; seriesKey: string; startedAt: Date; source: 'web' | 'device'; deviceName: string | null };
    }
  | {
      type: 'run_end';
      userId: number;
      payload: { runId: number; seriesKey: string; endedAt: Date; sampleCount: number; lastValue: number | null; lastErrorAbs: number | null };
    };

const conns = new Map<WebSocket, AuthUser>();

export function attachWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', async (ws, req) => {
    const token = new URL(req.url ?? '', 'http://x').searchParams.get('token');
    const user = await userFromToken(token);
    if (!user) {
      ws.close(4401, 'unauthorized');
      return;
    }
    conns.set(ws, user);
    (ws as WebSocket & { alive?: boolean }).alive = true;
    ws.on('pong', () => ((ws as WebSocket & { alive?: boolean }).alive = true));
    ws.on('close', () => conns.delete(ws));
    ws.on('error', () => conns.delete(ws));
    ws.send(JSON.stringify({ type: 'hello', payload: { role: user.role } }));
  });

  // Keepalive: corta conexiones muertas (portátil suspendido, wifi caído).
  setInterval(() => {
    for (const ws of conns.keys()) {
      const w = ws as WebSocket & { alive?: boolean };
      if (!w.alive) {
        ws.terminate();
        conns.delete(ws);
        continue;
      }
      w.alive = false;
      ws.ping();
    }
  }, 30_000).unref();
}

function forClient(e: LiveEvent): object | null {
  switch (e.type) {
    case 'sample':
      return null; // el cliente no recibe muestras: todo en ellas es numérico
    case 'run_start':
      return {
        type: e.type,
        payload: {
          runId: e.payload.runId,
          seriesKey: e.payload.seriesKey,
          startedAt: e.payload.startedAt,
          source: e.payload.source,
          deviceName: e.payload.deviceName,
        },
      };
    case 'run_end':
      return { type: e.type, payload: { runId: e.payload.runId, seriesKey: e.payload.seriesKey, endedAt: e.payload.endedAt } };
  }
}

export function broadcast(events: LiveEvent[]): void {
  for (const e of events) {
    const adminMsg = JSON.stringify({ type: e.type, payload: { ...e.payload, userId: e.userId } });
    const client = forClient(e);
    const clientMsg = client && JSON.stringify(client);
    for (const [ws, user] of conns) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (user.role === 'admin') ws.send(adminMsg);
      else if (clientMsg && user.id === e.userId) ws.send(clientMsg);
    }
  }
}

/** Cierra los sockets de un usuario (desactivado, eliminado o con el rol cambiado). */
export function disconnectUser(userId: number): void {
  for (const [ws, user] of conns) if (user.id === userId) ws.close(4401, 'unauthorized');
}
