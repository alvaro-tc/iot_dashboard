// Un solo Socket.IO por pestaña, contra el namespace /live, autenticado con el JWT.
//
// El store vive aquí: todas las tarjetas leen del mismo estado y no se re-renderizan en
// cascada por cada mensaje. Lo que cambia con cada lectura (distancias, motores) se expone
// por suscripción imperativa (useTelemetria) en vez de por estado de React; lo que cambia
// poco (config, estado en línea) sí es estado.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Configuracion, Lectura } from '@iot/shared';
import { io, type Socket } from 'socket.io-client';
import { SOCKET_URL, tokenStore } from './api.ts';
import { useAuth } from './auth.tsx';

export type EstadoSocket = 'conectando' | 'conectado' | 'reconectando' | 'sin-conexion';

export interface EstadoRobot {
  enLinea: boolean;
  ultimoContacto: string | number | null;
  versionFirmware: string | null;
}

type OyenteTelemetria = (l: Lectura) => void;

interface ValorSocket {
  estado: EstadoSocket;
  /** Cambia en cada (re)conexión: las vistas lo usan para recargar su histórico. */
  idConexion: number;
  robotId: string | null;
  elegirRobot: (id: string | null) => void;
  config: Configuracion | null;
  estadoRobot: EstadoRobot | null;
  /** Últimas lecturas conocidas (las que mandó el servidor al unirse + las vivas). */
  historial: () => Lectura[];
  ultima: () => Lectura | null;
  /** Desfase del reloj del navegador respecto al servidor, en ms. */
  desfaseReloj: () => number;
  suscribirTelemetria: (fn: OyenteTelemetria) => () => void;
  actualizarConfig: (cambio: Partial<Configuracion>) => Promise<{ ok: boolean; error?: string }>;
}

const ContextoSocket = createContext<ValorSocket>(null!);
export const useSocket = () => useContext(ContextoSocket);

const MAX_HISTORIAL = 600; // ~5 min a 2 Hz: suficiente para las gráficas en vivo

export function ProveedorSocket({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [estado, setEstado] = useState<EstadoSocket>('conectando');
  const [idConexion, setIdConexion] = useState(0);
  const [robotId, setRobotId] = useState<string | null>(null);
  const [config, setConfig] = useState<Configuracion | null>(null);
  const [estadoRobot, setEstadoRobot] = useState<EstadoRobot | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const historialRef = useRef<Lectura[]>([]);
  const desfaseRef = useRef(0);
  const oyentesTel = useRef(new Set<OyenteTelemetria>());
  // La sala a la que hay que (re)unirse. En una ref para que el handler de 'connect' lea
  // siempre el robot actual sin tener que recrear el socket al cambiar de robot.
  const salaRef = useRef<string | null>(null);
  salaRef.current = robotId;

  const unirse = useCallback((socket: Socket, id: string) => {
    socket.emit('unirse', id, (r: { ok: boolean; config?: Configuracion; estado?: EstadoRobot; historial?: Lectura[] }) => {
      if (!r?.ok) return;
      historialRef.current = r.historial ?? [];
      setConfig(r.config ?? null);
      setEstadoRobot(r.estado ?? null);
      setIdConexion((n) => n + 1);
    });
  }, []);

  useEffect(() => {
    if (!user) return;

    const socket = io(`${SOCKET_URL}/live`, {
      auth: { token: tokenStore.get() ?? '' },
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 15_000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setEstado('conectado');
      // Desfase de relojes: sin esto, la "latencia" mostrada mediría la diferencia entre el
      // reloj del navegador y el del robot, que puede ser de segundos.
      const t0 = Date.now();
      socket.emit('sincronizar_reloj', t0, (r: { servidor: number }) => {
        const ida = (Date.now() - t0) / 2;
        desfaseRef.current = Date.now() - (r.servidor + ida);
      });
      if (salaRef.current) unirse(socket, salaRef.current);
    });

    socket.on('disconnect', () => setEstado('reconectando'));
    socket.io.on('reconnect_attempt', (n) => setEstado(n > 4 ? 'sin-conexion' : 'reconectando'));
    socket.on('connect_error', (e) => {
      // El servidor rechaza el handshake si el JWT caducó o la cuenta se desactivó.
      if (e.message === 'unauthorized') logout();
      else setEstado('reconectando');
    });

    socket.on('telemetria', (l: Lectura) => {
      historialRef.current.push(l);
      if (historialRef.current.length > MAX_HISTORIAL) historialRef.current.shift();
      oyentesTel.current.forEach((fn) => fn(l));
    });
    socket.on('config', (c: Configuracion) => setConfig(c));
    socket.on('estado', (e: EstadoRobot) => setEstadoRobot(e));

    return () => {
      socket.close();
      socketRef.current = null;
      historialRef.current = [];
      setIdConexion(0);
    };
  }, [user?.id, logout, unirse]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cambio de robot: salir de la sala anterior y entrar en la nueva.
  const anteriorRef = useRef<string | null>(null);
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    if (anteriorRef.current && anteriorRef.current !== robotId) socket.emit('salir', anteriorRef.current);
    anteriorRef.current = robotId;
    historialRef.current = [];
    setConfig(null);
    setEstadoRobot(null);
    if (robotId && socket.connected) unirse(socket, robotId);
  }, [robotId, unirse]);

  const valor = useMemo<ValorSocket>(
    () => ({
      estado,
      idConexion,
      robotId,
      elegirRobot: setRobotId,
      config,
      estadoRobot,
      historial: () => historialRef.current,
      ultima: () => historialRef.current.at(-1) ?? null,
      desfaseReloj: () => desfaseRef.current,
      suscribirTelemetria: (fn) => {
        oyentesTel.current.add(fn);
        return () => void oyentesTel.current.delete(fn);
      },
      actualizarConfig: (cambio) =>
        new Promise((resolve) => {
          const socket = socketRef.current;
          if (!socket || !robotId) return resolve({ ok: false, error: 'Sin conexión con el servidor.' });
          socket.emit('actualizar_config', { dispositivoId: robotId, cambio }, (r: { ok: boolean; config?: Configuracion; error?: string }) => {
            if (r?.ok && r.config) setConfig(r.config);
            resolve(r);
          });
        }),
    }),
    [estado, idConexion, robotId, config, estadoRobot],
  );

  return <ContextoSocket.Provider value={valor}>{children}</ContextoSocket.Provider>;
}

/** Llama a `fn` con cada lectura. El handler puede cambiar sin volver a suscribirse. */
export function useTelemetria(fn: OyenteTelemetria): void {
  const { suscribirTelemetria } = useSocket();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => suscribirTelemetria((l) => ref.current(l)), [suscribirTelemetria]);
}

/**
 * Re-renderiza con la última lectura, como mucho `hz` veces por segundo. Las tarjetas de
 * texto no necesitan refrescarse con cada mensaje; las gráficas usan useTelemetria directamente.
 */
export function useUltimaLectura(hz = 2): Lectura | null {
  const { ultima, idConexion } = useSocket();
  const [, forzar] = useState(0);
  const pendiente = useRef(false);

  useTelemetria(() => {
    if (pendiente.current) return;
    pendiente.current = true;
    setTimeout(() => {
      pendiente.current = false;
      forzar((n) => n + 1);
    }, 1000 / hz);
  });

  useEffect(() => forzar((n) => n + 1), [idConexion]);
  return ultima();
}
