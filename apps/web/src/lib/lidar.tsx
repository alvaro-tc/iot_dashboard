// Modo lidar en el navegador: habitaciones, mapa en vivo y órdenes.
//
// VISIBILIDAD
// `habilitado` sale del usuario (`lidarHabilitado`, que reparte un admin). Cuando es false no
// se pinta el menú, no existe la ruta y no se pide nada a la API; y aunque alguien escribiera
// la URL a mano, el backend responde 404 y el servidor no manda los eventos. O sea: el cliente
// no puede enterarse de que la función existe, que es lo que se pidió.
import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GEOMETRIA_POR_DEFECTO,
  CALIBRACION_POR_DEFECTO,
  rejillaDeBase64,
  type CalibracionRobot,
  type GeometriaRobot,
  type Puerta,
  type Rejilla,
  type Sala,
} from '@iot/shared';
import { api } from './api.ts';
import { useAuth } from './auth.tsx';
import { useRobots } from './robots.tsx';
import { useSocket, type EstadoLidar } from './socket.tsx';

/** Una habitación con el resumen de su mapa, tal como la devuelve la API. */
export interface SalaConMapa extends Sala {
  activa: boolean;
  mapa: { barridos: number; cobertura: number; obstaculos: number; actualizadoEn: string } | null;
}

export interface AjustesRobot {
  geometria: GeometriaRobot;
  calibracion: CalibracionRobot;
  salaActivaId: number | null;
}

export type AccionLidar = 'reconocer' | 'limpiar' | 'parar' | 'calibrar_giro' | 'calibrar_avance';

/** Qué está haciendo el robot, en palabras del cliente. */
export const TEXTO_MODO: Record<EstadoLidar['modo'], string> = {
  inactivo: 'En espera',
  calibrando_giro: 'Midiendo el giro',
  calibrando_avance: 'Midiendo el avance',
  reconociendo: 'Reconociendo la habitación',
  limpiando: 'Limpiando',
};

export function useLidar() {
  const { user } = useAuth();
  const { robot } = useRobots();
  const { lidar } = useSocket();
  const qc = useQueryClient();

  // Un admin lo tiene siempre: es quien reparte el permiso y tiene que poder probarlo.
  const habilitado = user?.role === 'admin' || user?.lidarHabilitado === true;
  const robotId = robot?.id ?? null;
  const activo = habilitado && !!robotId;

  const salas = useQuery<SalaConMapa[]>({
    queryKey: ['salas', robotId],
    queryFn: () => api(`/api/lidar/dispositivos/${robotId}/salas`),
    enabled: activo,
  });

  const ajustes = useQuery<AjustesRobot>({
    queryKey: ['lidar-ajustes', robotId],
    queryFn: () => api(`/api/lidar/dispositivos/${robotId}/ajustes`),
    enabled: activo,
  });

  const refrescar = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['salas', robotId] });
    void qc.invalidateQueries({ queryKey: ['lidar-ajustes', robotId] });
  }, [qc, robotId]);

  /**
   * La habitación que se está mirando: la activa del robot. El selector de arriba la cambia en
   * el servidor (no solo aquí) para que el robot y todos los navegadores de la cuenta coincidan
   * en qué cuarto se está trabajando.
   */
  const sala = useMemo(() => {
    const lista = salas.data ?? [];
    return lista.find((s) => s.activa) ?? lista[0] ?? null;
  }, [salas.data]);

  const elegirSala = useMutation({
    mutationFn: (salaId: number | null) =>
      api(`/api/lidar/dispositivos/${robotId}/sala-activa`, { method: 'PUT', body: { salaId } }),
    onSuccess: refrescar,
  });

  const crearSala = useMutation({
    mutationFn: (datos: Partial<Sala>) =>
      api<Sala>(`/api/lidar/dispositivos/${robotId}/salas`, { method: 'POST', body: datos }),
    onSuccess: refrescar,
  });

  const editarSala = useMutation({
    mutationFn: ({ id, ...datos }: Partial<Sala> & { id: number }) =>
      api<Sala>(`/api/lidar/salas/${id}`, { method: 'PATCH', body: datos }),
    onSuccess: refrescar,
  });

  const guardarPuertas = useMutation({
    mutationFn: ({ id, puertas }: { id: number; puertas: Puerta[] }) =>
      api<Sala>(`/api/lidar/salas/${id}/puertas`, { method: 'PUT', body: { puertas } }),
    onSuccess: refrescar,
  });

  const borrarSala = useMutation({
    mutationFn: (id: number) => api(`/api/lidar/salas/${id}`, { method: 'DELETE' }),
    onSuccess: refrescar,
  });

  /** Volver a escanear: se tira el mapa viejo (el cuarto ha cambiado) y se reconoce de nuevo. */
  const borrarMapa = useMutation({
    mutationFn: (id: number) => api(`/api/lidar/salas/${id}/mapa`, { method: 'DELETE' }),
    onSuccess: refrescar,
  });

  const guardarGeometria = useMutation({
    mutationFn: (geometria: GeometriaRobot) =>
      api<AjustesRobot>(`/api/lidar/dispositivos/${robotId}/geometria`, { method: 'PUT', body: geometria }),
    onSuccess: refrescar,
  });

  const guardarCalibracion = useMutation({
    mutationFn: (calibracion: CalibracionRobot) =>
      api<AjustesRobot>(`/api/lidar/dispositivos/${robotId}/calibracion`, { method: 'PUT', body: calibracion }),
    onSuccess: refrescar,
  });

  const ejecutar = useMutation({
    mutationFn: ({
      accion,
      salaId,
      inicio,
    }: {
      accion: AccionLidar;
      salaId?: number;
      /** Dónde está el robot, marcado en el plano. Ver el aviso que devuelve el backend si falta. */
      inicio?: { x: number; y: number } | null;
    }) => api(`/api/lidar/dispositivos/${robotId}/accion`, { method: 'POST', body: { accion, salaId, inicio } }),
  });

  /**
   * La rejilla, ya descodificada. Llega en base64 (un byte por celda) y solo cuando cambia, así
   * que se desempaqueta en un memo atado a la cadena: si no, se volvería a decodificar en cada
   * fotograma del plano.
   */
  const rejilla: Rejilla | null = useMemo(() => {
    const r = lidar?.rejilla;
    return r ? rejillaDeBase64(r.datos, r.cols, r.filas, r.res) : null;
  }, [lidar?.rejilla?.datos, lidar?.rejilla?.cols, lidar?.rejilla?.filas, lidar?.rejilla?.res]);

  const modo = lidar?.modo ?? 'inactivo';

  return {
    habilitado,
    robot,
    salas: salas.data ?? [],
    cargando: salas.isLoading || ajustes.isLoading,
    error: (salas.error as Error | null) ?? null,
    sala,
    // Lo que de verdad se está dibujando: los obstáculos del evento en vivo si hay mapeo en
    // marcha, y si no los del mapa guardado que vino en el ack.
    estado: lidar,
    modo,
    ocupado: modo !== 'inactivo',
    rejilla,
    obstaculos: lidar?.obstaculos ?? [],
    pose: lidar?.pose ?? null,
    cobertura: lidar?.cobertura ?? sala?.mapa?.cobertura ?? 0,
    barridos: lidar?.barridos ?? sala?.mapa?.barridos ?? 0,
    aviso: lidar?.aviso ?? null,
    residuoCm: lidar?.residuoCm ?? null,
    geometria: ajustes.data?.geometria ?? GEOMETRIA_POR_DEFECTO,
    calibracion: ajustes.data?.calibracion ?? CALIBRACION_POR_DEFECTO,
    calibrado: !!ajustes.data?.calibracion.medidoEn,
    refrescar,
    elegirSala,
    crearSala,
    editarSala,
    guardarPuertas,
    borrarSala,
    borrarMapa,
    guardarGeometria,
    guardarCalibracion,
    ejecutar,
  };
}
