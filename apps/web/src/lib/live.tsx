// Un único WebSocket por pestaña. Se abre al iniciar sesión y se cierra al salir.
// Los componentes se suscriben con useLiveEvents; `connectionId` cambia en cada (re)conexión
// para que las vistas recarguen su histórico y no queden huecos.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SeriesKey } from '@iot/shared';
import { WS_URL, tokenStore } from './api.ts';
import { useAuth } from './auth.tsx';
import type { Sample } from './types.ts';

export type WsStatus = 'connecting' | 'open' | 'reconnecting' | 'offline';

// `userId` solo llega en conexiones de admin; `?` en los numéricos porque un cliente no los recibe.
export type LiveMessage =
  | { type: 'hello'; payload: { role: string } }
  | { type: 'sample'; payload: Sample & { userId: number } }
  | {
      type: 'run_start';
      payload: { runId: number; seriesKey: SeriesKey; startedAt: string; source: 'web' | 'device'; deviceName: string | null; userId?: number };
    }
  | {
      type: 'run_end';
      payload: {
        runId: number;
        seriesKey: SeriesKey;
        endedAt: string;
        sampleCount?: number;
        lastValue?: number | null;
        lastErrorAbs?: number | null;
        userId?: number;
      };
    };

type Listener = (m: LiveMessage) => void;

interface LiveContextValue {
  status: WsStatus;
  connectionId: number;
  subscribe: (fn: Listener) => () => void;
}

const LiveContext = createContext<LiveContextValue>(null!);
export const useLive = () => useContext(LiveContext);

export function LiveProvider({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [status, setStatus] = useState<WsStatus>('connecting');
  const [connectionId, setConnectionId] = useState(0);
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    if (!user) return;
    let ws: WebSocket;
    let retries = 0;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const connect = () => {
      setStatus(retries === 0 ? 'connecting' : retries > 4 ? 'offline' : 'reconnecting');
      ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(tokenStore.get() ?? '')}`);
      ws.onopen = () => {
        retries = 0;
        setStatus('open');
        setConnectionId((n) => n + 1);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as LiveMessage;
          listeners.current.forEach((fn) => fn(msg));
        } catch {
          /* mensaje mal formado: se ignora */
        }
      };
      ws.onclose = (ev) => {
        if (stopped) return;
        if (ev.code === 4401) return logout(); // token inválido o cuenta desactivada
        retries++;
        setStatus(retries > 4 ? 'offline' : 'reconnecting');
        timer = setTimeout(connect, Math.min(1000 * 2 ** (retries - 1), 15_000));
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(timer);
      ws.close();
      setConnectionId(0);
    };
  }, [user?.id, user?.role, logout]); // eslint-disable-line react-hooks/exhaustive-deps

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);

  return <LiveContext.Provider value={{ status, connectionId, subscribe }}>{children}</LiveContext.Provider>;
}

/** Ejecuta `handler` con cada mensaje. El handler puede cambiar sin resuscribir. */
export function useLiveEvents(handler: Listener) {
  const { subscribe } = useLive();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe((m) => ref.current(m)), [subscribe]);
}
