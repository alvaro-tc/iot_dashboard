/** Validación de toda entrada de la API. Nada entra sin pasar por aquí. */
import { z } from "zod";
import {
  CONSUMIBLES,
  MODOS,
  PATRONES,
  POTENCIAS,
  SENALES,
  SEVERIDADES,
  TIPOS_EVENTO,
  ZONAS_WIFI,
} from "./constantes";

export const senalSchema = z.enum(SENALES);
export const potenciaSchema = z.enum(POTENCIAS);
export const patronSchema = z.enum(PATRONES);
export const modoSchema = z.enum(MODOS);
export const zonaWifiSchema = z.enum(ZONAS_WIFI);
export const severidadSchema = z.enum(SEVERIDADES);
export const tipoEventoSchema = z.enum(TIPOS_EVENTO);
export const consumibleSchema = z.enum(CONSUMIBLES);

/* ---------------------------------------------------------------- */
/* Ingesta de telemetría: mismo contrato para HTTP y para MQTT.      */
/* ---------------------------------------------------------------- */

const aproxSchema = z.object({
  valorAproximado: z.number(),
  valorReal: z.number(),
});

export const muestraSchema = z.object({
  t: z.iso.datetime({ offset: true }).or(z.iso.datetime()),
  n: z.number().int().min(1).max(200),
  /** Fase de la serie. El ESP32 real la omite: solo la usa el simulador. */
  x: z.number().nullable().optional(),
  sensores: z.object({
    distanciaFrontalCm: z.number().min(0).max(500),
    distanciaIzquierdaCm: z.number().min(0).max(500),
    distanciaDerechaCm: z.number().min(0).max(500),
    densidadPolvoMgM3: z.number().min(0).max(10),
    /** Pulsos del intervalo, no acumulados. */
    pulsosIzq: z.number().int().min(0),
    pulsosDer: z.number().int().min(0),
  }),
  /** Solo lo llena el simulador; sin él, el gráfico de error queda vacío. */
  aprox: z.partialRecord(senalSchema, aproxSchema).optional(),
});

export const estadoSchema = z.object({
  modo: modoSchema,
  voltajeBateria: z.number().min(0).max(30),
  nivelBateriaPct: z.number().min(0).max(100),
  rssiDbm: z.number().int().min(-120).max(0),
  zonaWifi: zonaWifiSchema,
  distanciaAcumuladaM: z.number().min(0),
  areaEstimadaM2: z.number().min(0),
  potenciaSuccion: potenciaSchema,
});

export const telemetryPayloadSchema = z.object({
  deviceId: z.string().min(1),
  sessionId: z.string().nullable().optional(),
  fw: z.string().optional(),
  seq: z.number().int().min(0).optional(),
  muestras: z.array(muestraSchema).min(1).max(50),
  estado: estadoSchema.optional(),
});

export type TelemetryPayload = z.infer<typeof telemetryPayloadSchema>;
export type Muestra = z.infer<typeof muestraSchema>;

/* ---------------------------------------------------------------- */
/* Consultas                                                         */
/* ---------------------------------------------------------------- */

export const telemetryQuerySchema = z.object({
  senal: senalSchema.optional(),
  sessionId: z.string().optional(),
  nMin: z.coerce.number().int().optional(),
  nMax: z.coerce.number().int().optional(),
  desde: z.string().optional(),
  hasta: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(5000).default(50),
  orderBy: z
    .enum(["timestamp", "n", "senal", "valorFisico", "errorAbsoluto", "errorRelativo"])
    .default("timestamp"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export const eventsQuerySchema = z.object({
  tipo: tipoEventoSchema.optional(),
  severidad: severidadSchema.optional(),
  sessionId: z.string().optional(),
  desde: z.string().optional(),
  hasta: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

/* ---------------------------------------------------------------- */
/* Comandos y ajustes                                                */
/* ---------------------------------------------------------------- */

export const comandoSchema = z.object({
  cmd: z.enum(["start", "pause", "stop", "dock", "reboot", "locate"]),
});

export const configSchema = z.object({
  potenciaSuccion: potenciaSchema,
  velocidadMs: z.number().min(0.1).max(0.4),
  umbralFrontalCm: z.number().min(10).max(40),
  umbralLateralCm: z.number().min(5).max(25),
  duracionGiroS: z.number().min(0.2).max(1.5),
  patron: patronSchema,
  duracionMaxMin: z.number().int().min(10).max(120),
  bateriaRetornoPct: z.number().min(10).max(40),
  factorZonaSucia: z.number().min(1.2).max(3),
  segundaPasada: z.boolean(),
  terminarAlLimpiar: z.boolean(),
  pmObjetivo: z.number().min(0.01).max(1),
  telemetriaHz: z.union([z.literal(0.5), z.literal(1), z.literal(2)]),
  modoSilencioso: z.boolean(),
  silencioDesde: z.string().regex(/^\d{2}:\d{2}$/),
  silencioHasta: z.string().regex(/^\d{2}:\d{2}$/),
  nombre: z.string().min(1).max(40),
});

export const calibracionSchema = z.object({
  mmPorPulso: z.number().min(1).max(50),
  distanciaEjesMm: z.number().min(50).max(500),
  anchoCepilloM: z.number().min(0.05).max(0.5),
  pulsosPorMetro: z.number().min(10).max(1000),
  rssiCerca: z.number().int().min(-90).max(-20),
  rssiMedia: z.number().int().min(-100).max(-20),
  pmBaseline: z.number().min(0).max(1),
});

export const thresholdsSchema = z.object({
  bateriaBajaPct: z.number().min(5).max(50),
  pmMaxTolerado: z.number().min(0.05).max(2),
  caidaTensionVPorMin: z.number().min(0.01).max(2),
  horasFiltro: z.number().min(1).max(1000),
  horasCepillo: z.number().min(1).max(1000),
  minSinTelemetria: z.number().int().min(1).max(60),
});

export const scheduleSchema = z.object({
  nombre: z.string().min(1).max(40),
  /** Días de la semana 0=domingo .. 6=sábado. */
  dias: z.array(z.number().int().min(0).max(6)).min(1),
  hora: z.string().regex(/^\d{2}:\d{2}$/),
  duracionMaxMin: z.number().int().min(10).max(120),
  potencia: potenciaSchema,
  patron: patronSchema,
  saltarSiBateria: z.boolean(),
  bateriaMinPct: z.number().min(0).max(100),
  activo: z.boolean(),
});

export const schedulePatchSchema = scheduleSchema.partial();

export const maintenanceSchema = z.object({
  consumible: consumibleSchema,
  accion: z.literal("reset"),
});

export const simulatorSchema = z.object({
  accion: z.enum(["start", "stop"]),
  /** Multiplicador de velocidad del generador: 1 = tiempo real. */
  velocidad: z.number().min(0.25).max(20).optional(),
});

export const exportQuerySchema = telemetryQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(100000).default(10000),
});
