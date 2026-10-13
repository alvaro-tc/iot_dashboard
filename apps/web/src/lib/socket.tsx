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
import { useQueryClient } from '@tanstack/react-query';
import type { Configuracion, Lectura, Obstaculo, Pose } from '@iot/shared';
import { io, type Socket } from 'socket.io-client';
import { SOCKET_URL, tokenStore } from './api.ts';
import { useAuth } from './auth.tsx';
import { decidir, type Entrada } from './prefs.ts';

export type EstadoSocket = 'conectando' | 'conectado' | 'reconectando' | 'sin-conexion';

/**
 * Estado del mapeo que manda el backend (apps/api/src/lidar/mapeo.ts). Llega por el ack de
 * `unirse` (con el mapa guardado, para que el plano aparezca ya dibujado) y después en cada
 * evento `lidar`. El servidor solo lo manda a quien tiene el permiso, así que a un cliente sin
 * él esto se queda en null para siempre.
 */
export interface EstadoLidar {
  modo: 'inactivo' | 'calibrando_giro' | 'calibrando_avance' | 'reconociendo' | 'limpiando';
  salaId: number | null;
  pose: Pose | null;
  barridos: number;
  cobertura: number;
  residuoCm: number | null;
  obstaculos: Obstaculo[];
  aviso: string | null;
  rejilla?: { datos: string; cols: number; filas: number; res: number };
}

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
  /**
   * Preferencias de interfaz de la cuenta (tema, panel), con la hora de su última edición.
   * `null` mientras no han llegado: hasta entonces nadie publica nada, para no pisar con el
   * estado de este navegador lo que la cuenta ya tenga guardado.
   */
  prefs: Record<string, Entrada> | null;
  guardarPref: (clave: string, entrada: Entrada) => void;
  /** Modo lidar: null si la cuenta no tiene el permiso (el servidor no manda nada). */
  lidar: EstadoLidar | null;
}

const ContextoSocket = createContext<ValorSocket>(null!);
export const useSocket = () => useContext(ContextoSocket);

const MAX_HISTORIAL = 600; // ~5 min a 2 Hz: suficiente para las gráficas en vivo

export function ProveedorSocket({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const [estado, setEstado] = useState<EstadoSocket>('conectando');
  const [idConexion, setIdConexion] = useState(0);
  const [robotId, setRobotId] = useState<string | null>(null);
  const [config, setConfig] = useState<Configuracion | null>(null);
  const [estadoRobot, setEstadoRobot] = useState<EstadoRobot | null>(null);
  const [prefs, setPrefs] = useState<Record<string, Entrada> | null>(null);
  const [lidar, setLidar] = useState<EstadoLidar | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const historialRef = useRef<Lectura[]>([]);
  const desfaseRef = useRef(0);
  const oyentesTel = useRef(new Set<OyenteTelemetria>());
  // La sala a la que hay que (re)unirse. En una ref para que el handler de 'connect' lea
  // siempre el robot actual sin tener que recrear el socket al cambiar de robot.
  const salaRef = useRef<string | null>(null);
  salaRef.current = robotId;

  const unirse = useCallback((socket: Socket, id: string) => {
    socket.emit(
      'unirse',
      id,
      (r: {
        ok: boolean;
        config?: Configuracion;
        estado?: EstadoRobot;
        historial?: Lectura[];
        lidar?: EstadoLidar;
      }) => {
        if (!r?.ok) return;
        historialRef.current = r.historial ?? [];
        setConfig(r.config ?? null);
        setEstadoRobot(r.estado ?? null);
        setLidar(r.lidar ?? null);
        setIdConexion((n) => n + 1);
      },
    );
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
    // Al conectar llegan todas; después, solo la que acaba de cambiar en otro dispositivo.
    socket.on('preferencias', (p: Record<string, Entrada>) => setPrefs(p ?? {}));
    socket.on('pref', ({ clave, valor, ts }: { clave: string } & Entrada) =>
      setPrefs((prev) => ({ ...(prev ?? {}), [clave]: { valor, ts } })),
    );
    socket.on('estado', (e: EstadoRobot) => setEstadoRobot(e));
    // El mapa en vivo. La rejilla solo viene cuando ha cambiado (una vez por barrido), así que
    // si el mensaje no la trae se conserva la que había y solo se actualizan pose y obstáculos.
    socket.on('lidar', (e: EstadoLidar) =>
      setLidar((prev) => ({ ...e, rejilla: e.rejilla ?? prev?.rejilla })),
    );

    // Lo que cambia en Postgres llega ya calculado y se mete en la caché de react-query:
    // la vista que lo esté usando se redibuja sin un solo GET. Es lo que mantiene vivas las
    // listas (robots, sesiones, usuarios, resúmenes) sin recargar la página ni sondear.
    socket.on('datos', ({ clave, valor }: { clave: unknown[]; valor: unknown }) => {
      qc.setQueryData(clave, valor);
    });

    // Y lo que el servidor no puede recalcular por su cuenta (el histórico y la actividad por
    // motor dependen del rango abierto aquí) se marca como obsoleto y react-query lo repide.
    socket.on('invalidar', (claves: string[]) => {
      for (const clave of claves) void qc.invalidateQueries({ queryKey: [clave] });
    });

    return () => {
      socket.close();
      socketRef.current = null;
      historialRef.current = [];
      setIdConexion(0);
      // Otra cuenta son otras preferencias: no se heredan las de la anterior.
      setPrefs(null);
    };
  }, [user?.id, logout, unirse, qc]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setLidar(null); // otro robot es otro mapa: no se hereda el del anterior
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
      lidar,
      prefs,
      guardarPref: (clave, entrada) => {
        setPrefs((prev) => ({ ...(prev ?? {}), [clave]: entrada }));
        // El servidor solo guarda si su copia es más vieja. Si gana la suya, la devuelve en el
        // ack y es la que vale: se mete en `prefs` y `usePrefRemota` la aplica.
        socketRef.current?.emit('guardar_pref', { clave, ...entrada }, (r: { ok: boolean } & Partial<Entrada>) => {
          if (r?.ok || typeof r?.valor !== 'string' || typeof r.ts !== 'number') return;
          setPrefs((prev) => ({ ...(prev ?? {}), [clave]: { valor: r.valor as string, ts: r.ts as number } }));
        });
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
    [estado, idConexion, robotId, config, estadoRobot, prefs, lidar],
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

/**
 * Hora de la última edición de una preferencia en ESTE navegador. Se guarda aparte del valor
 * porque tiene que sobrevivir a cerrar el navegador: si no, al volver a abrir no se sabría si
 * lo de aquí es más nuevo o más viejo que lo de la cuenta, y lo rancio podría ganar.
 */
const CLAVE_TS = (clave: string) => `pref-ts:${clave}`;
const tsGuardado = (clave: string) => {
  try {
    return Number(localStorage.getItem(CLAVE_TS(clave))) || 0;
  } catch {
    return 0;
  }
};
const guardarTs = (clave: string, ts: number) => {
  try {
    localStorage.setItem(CLAVE_TS(clave), String(ts));
  } catch {
    /* sin almacenamiento: la hora se pierde al recargar y la cuenta gana los empates */
  }
};

/**
 * Ata una preferencia de la cuenta a un estado local: sube `valor` al servidor cuando cambia
 * aquí y llama a `aplicar` con el que llegue de otro dispositivo (o con el guardado, al
 * conectar). `valor` es la cadena serializada, la misma que va a localStorage, así que
 * comparar por igualdad basta para saber si hay cambio real. Quién gana lo decide `decidir`.
 */
export function usePrefRemota(clave: string, valor: string, aplicar: (crudo: string) => void): void {
  const { prefs, guardarPref, desfaseReloj } = useSocket();
  const aplicarRef = useRef(aplicar);
  aplicarRef.current = aplicar;

  // Lo último acordado con el servidor: lo que corta el ciclo aplicar → publicar. Arranca con
  // lo que ya había en este navegador y la hora en que se editó, que es lo que se compara.
  const sincronizado = useRef<Entrada | null>(null);
  sincronizado.current ??= { valor, ts: tsGuardado(clave) };

  const remoto = prefs?.[clave];
  useEffect(() => {
    // Reloj del servidor: el del navegador puede ir descuadrado y las horas se comparan
    // entre dispositivos.
    const d = decidir(remoto, valor, sincronizado.current!, prefs !== null, Date.now() - desfaseReloj());
    if (d.sincronizado !== undefined) {
      sincronizado.current = d.sincronizado;
      guardarTs(clave, d.sincronizado.ts);
    }
    if (d.aplicar !== undefined) aplicarRef.current(d.aplicar);
    if (d.publicar !== undefined) guardarPref(clave, d.publicar);
  }, [remoto, valor, prefs, clave, guardarPref, desfaseReloj]);
}
