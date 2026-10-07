// Lista de robots del usuario y cuál es el activo.
//
// El robot activo se guarda en localStorage para que al recargar el dashboard siga mirando
// el mismo, y se sincroniza con la sala de Socket.IO.
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.ts';
import { useAuth } from './auth.tsx';
import { useSocket } from './socket.tsx';
import type { Dispositivo } from './types.ts';

interface ValorRobots {
  robots: Dispositivo[];
  cargando: boolean;
  error: Error | null;
  robot: Dispositivo | null;
  elegir: (id: string) => void;
  /** Avanza o retrocede en la lista: es el selector "‹ Roomba Sala ›" de la tarjeta grande. */
  mover: (delta: number) => void;
  recargar: () => void;
}

const ContextoRobots = createContext<ValorRobots>(null!);
export const useRobots = () => useContext(ContextoRobots);

const CLAVE = 'robot-activo';

export function ProveedorRobots({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { robotId, elegirRobot } = useSocket();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery<Dispositivo[]>({
    queryKey: ['dispositivos'],
    queryFn: () => api('/api/dispositivos'),
    enabled: !!user,
  });
  const robots = data ?? [];

  // Elige el robot activo: el guardado si sigue existiendo, si no el primero.
  useEffect(() => {
    if (!robots.length) {
      if (robotId) elegirRobot(null);
      return;
    }
    if (robotId && robots.some((r) => r.id === robotId)) return;
    let guardado: string | null = null;
    try {
      guardado = localStorage.getItem(CLAVE);
    } catch {
      /* navegación privada */
    }
    elegirRobot(robots.find((r) => r.id === guardado)?.id ?? robots[0].id);
  }, [robots, robotId, elegirRobot]);

  useEffect(() => {
    if (!robotId) return;
    try {
      localStorage.setItem(CLAVE, robotId);
    } catch {
      /* navegación privada */
    }
  }, [robotId]);

  const valor = useMemo<ValorRobots>(() => {
    const indice = robots.findIndex((r) => r.id === robotId);
    return {
      robots,
      cargando: isLoading,
      error: (error as Error) ?? null,
      robot: robots[indice] ?? null,
      elegir: elegirRobot,
      mover: (delta) => {
        if (robots.length < 2) return;
        const siguiente = (indice + delta + robots.length) % robots.length;
        elegirRobot(robots[siguiente].id);
      },
      recargar: () => void qc.invalidateQueries({ queryKey: ['dispositivos'] }),
    };
  }, [robots, robotId, isLoading, error, elegirRobot, qc]);

  return <ContextoRobots.Provider value={valor}>{children}</ContextoRobots.Provider>;
}
