import type { Movimiento, Sensor, TipoEvento } from '@iot/shared';

export type Role = 'admin' | 'client';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface AdminUserRow extends User {
  robots: number;
  sesiones: number;
  ultimaActividad: string | null;
}

export interface Dispositivo {
  id: string;
  userId: number;
  nombre: string;
  ubicacion: string;
  isRevoked: boolean;
  enLinea: boolean;
  ultimoContacto: string | null;
  versionFirmware: string | null;
  creadoEn: string;
  totalSesiones?: number;
  bateriaPct?: number | null;
  usuario?: string;
  usuarioEmail?: string;
}

/** Respuesta de POST /api/dispositivos: el token solo llega aquí, una vez. */
export interface AltaDispositivo {
  dispositivo: Dispositivo;
  token: string;
  config: import('@iot/shared').Configuracion;
  broker: { host: string; port: number };
}

export interface ResumenSesion {
  id: number;
  iniciadaEn: string;
  finalizadaEn: string | null;
  duracionS: number;
  distanciaCm: number;
  evasiones: number;
  lecturas: number;
  bateriaInicioPct: number | null;
  bateriaFinPct: number | null;
  bateriaConsumidaPct: number | null;
  pctPerdidas: number;
  latenciaMs: number | null;
  nAvanzando: number;
  nGirandoIzq: number;
  nGirandoDer: number;
  nRetrocediendo: number;
  nDetenido: number;
  evasionesIzq: number;
  evasionesCentro: number;
  evasionesDer: number;
}

/** Una fila de obtener_mapa_sesion: pose + obstáculos ya proyectados por Postgres. */
export interface PuntoMapa {
  secuencia: number;
  medido_en: string;
  x: number;
  y: number;
  theta: number;
  estado_movimiento: Movimiento;
  bateria_pct: number | null;
  obstaculos: { sensor: Sensor; d: number; x: number; y: number }[];
}

export interface EventoFila {
  id: number;
  tipo: TipoEvento;
  sensor: Sensor | null;
  distanciaCm: number | null;
  posXCm: number | null;
  posYCm: number | null;
  mensaje: string;
  atendido: boolean;
  creadoEn: string;
  sesionId: number | null;
}

export interface LecturaAgregada {
  instante: string;
  lecturas: number;
  minIzqCm: number | null;
  minCentroCm: number | null;
  minDerCm: number | null;
  promIzqCm: number | null;
  promCentroCm: number | null;
  promDerCm: number | null;
  nAvanzando: number;
  nGirandoIzq: number;
  nGirandoDer: number;
  nRetrocediendo: number;
  nDetenido: number;
  promBateriaPct: number | null;
  latenciaMs: number | null;
}

export interface Resumen {
  segundosHoy: number;
  distanciaHoyCm: number;
  evasionesIzq: number;
  evasionesCentro: number;
  evasionesDer: number;
  latenciaMs: number | null;
  bateriaPct: number | null;
  movimientos: Record<Movimiento, number> | null;
  mensajesPorSegundo: number;
  sesion: {
    id: number;
    iniciadaEn: number;
    lecturas: number;
    evasiones: number;
    distanciaCm: number;
    pctPerdidas: number;
  } | null;
}
