export type Role = 'admin' | 'cliente';

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

/** Una fila de v_resumen_sesion. */
export interface ResumenSesion {
  id: number;
  iniciadaEn: string;
  finalizadaEn: string | null;
  duracionS: number;
  lecturas: number;
  bateriaInicioPorcentaje: number | null;
  bateriaFinPorcentaje: number | null;
  bateriaConsumidaPorcentaje: number | null;
  lecturasEnMarcha: number;
  lecturasDetenido: number;
  promPwmIzquierda: number | null;
  promPwmDerecha: number | null;
  minIzquierdaCm: number | null;
  minCentralCm: number | null;
  minDerechaCm: number | null;
  cercaIzquierda: number;
  cercaCentral: number;
  cercaDerecha: number;
}

/** Una fila de v_lecturas_por_minuto / v_lecturas_por_hora. */
export interface LecturaAgregada {
  instante: string;
  lecturas: number;
  minIzquierdaCm: number | null;
  minCentralCm: number | null;
  minDerechaCm: number | null;
  promIzquierdaCm: number | null;
  promCentralCm: number | null;
  promDerechaCm: number | null;
  promPwmIzquierda: number | null;
  promPwmDerecha: number | null;
  /** PWM medio CON signo de cada rueda: negativo = ese tramo fue marcha atrás. */
  promMovIzquierda: number | null;
  promMovDerecha: number | null;
  lecturasMarchaIzquierda: number;
  lecturasMarchaDerecha: number;
  lecturasEnMarcha: number;
  lecturasDetenido: number;
  promBateriaPorcentaje: number | null;
  /** Solo en la agregación por hora: lecturas con ese sensor a 15 cm o menos. */
  cercaIzquierda?: number;
  cercaCentral?: number;
  cercaDerecha?: number;
}

/** Una lectura cruda tal como la devuelve la API (igual que `Lectura`, con fechas ISO). */
export interface LecturaFila {
  id: number;
  sesionId: number | null;
  distanciaIzquierdaCm: number | null;
  distanciaCentralCm: number | null;
  distanciaDerechaCm: number | null;
  movimientoIzquierda: number;
  movimientoDerecha: number;
  bateriaVoltios: number | null;
  bateriaPorcentaje: number | null;
  creadoEn: string;
}

export interface Resumen {
  segundosHoy: number;
  lecturasEnMarchaHoy: number;
  lecturasDetenidoHoy: number;
  cercaIzquierda: number;
  cercaCentral: number;
  cercaDerecha: number;
  bateriaPorcentaje: number | null;
  bateriaVoltios: number | null;
  mensajesPorSegundo: number;
  /** Acumulados de toda la vida del robot, no solo de hoy. */
  segundosTotal: number;
  lecturasEnMarchaTotal: number;
  lecturasMarchaIzquierdaTotal: number;
  lecturasMarchaDerechaTotal: number;
  sesion: {
    id: number;
    iniciadaEn: number;
    lecturas: number;
    bateriaInicioPorcentaje: number | null;
    bateriaPorcentaje: number | null;
  } | null;
}
