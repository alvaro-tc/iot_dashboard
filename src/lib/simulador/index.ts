/**
 * Generador de datos simulados.
 *
 * Publica contra POST /api/telemetry con el mismo payload que enviará el ESP32,
 * de modo que la ruta completa (validación, derivados, umbrales, eventos, SSE)
 * se ejercita desde el primer día. No escribe nunca en la base de datos.
 *
 * Se apaga por completo con SIMULADOR_ENABLED=false: la app sigue funcionando
 * y se queda esperando datos reales.
 */
import { bateriaEnFase, lecturas, pulsosDelIntervalo } from "../mapeo-sensores";
import { prng, terminosEn, X_FINAL } from "./nucleo";
import type { TelemetryPayload } from "../schemas";
import type { Senal } from "../constantes";

const SENALES_APROX: Senal[] = ["DIST_FRONTAL", "DIST_IZQ", "DIST_DER", "POLVO", "COBERTURA"];

export function simuladorHabilitado(): boolean {
  return process.env.SIMULADOR_ENABLED !== "false";
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

type Estado = {
  timer: NodeJS.Timeout | null;
  corriendo: boolean;
  /** Multiplicador de velocidad: 1 = tiempo real. */
  velocidad: number;
  /** Índice de muestra dentro de la pasada actual. */
  indice: number;
  bateriaInicial: number;
  seq: number;
  rnd: () => number;
};

const globalForSim = globalThis as unknown as { simulador?: Estado };

const estado: Estado = globalForSim.simulador ?? {
  timer: null,
  corriendo: false,
  velocidad: 1,
  indice: 0,
  bateriaInicial: 100,
  seq: 0,
  rnd: prng(20260910),
};
globalForSim.simulador = estado;

/** Muestras que componen una pasada completa del cuarto. */
const MUESTRAS_POR_PASADA = 600;
const HZ = Number(process.env.SIM_HZ ?? 2);

/** Construye el lote de una muestra con el mismo contrato que el ESP32. */
function construirPayload(): TelemetryPayload {
  const dx = X_FINAL / MUESTRAS_POR_PASADA;
  const x = (estado.indice % MUESTRAS_POR_PASADA) * dx;
  const n = terminosEn(estado.indice % MUESTRAS_POR_PASADA);
  const lec = lecturas(x, n);

  const girando = lec.DIST_FRONTAL.valorFisico < 22;
  const desbalance = girando ? 0.55 + estado.rnd() * 0.3 : (estado.rnd() - 0.5) * 0.12;
  const atasco = estado.rnd() < 0.01;
  const p = pulsosDelIntervalo(x, dx, desbalance);

  const bat = bateriaEnFase(x, estado.bateriaInicial);
  const rssi = Math.round(lec.RSSI.valorFisico);

  const aprox: NonNullable<TelemetryPayload["muestras"][number]["aprox"]> = {};
  for (const s of SENALES_APROX) {
    aprox[s] = {
      valorAproximado: lec[s].valorAproximado,
      valorReal: lec[s].valorReal,
    };
  }

  estado.seq += 1;

  return {
    deviceId: "robot-1",
    fw: "0.1.0-sim",
    seq: estado.seq,
    muestras: [
      {
        t: new Date().toISOString(),
        n,
        x,
        sensores: {
          distanciaFrontalCm: lec.DIST_FRONTAL.valorFisico,
          distanciaIzquierdaCm: lec.DIST_IZQ.valorFisico,
          distanciaDerechaCm: lec.DIST_DER.valorFisico,
          densidadPolvoMgM3: lec.POLVO.valorFisico,
          pulsosIzq: atasco ? 0 : p.izq,
          pulsosDer: atasco ? 0 : p.der,
        },
        aprox,
      },
    ],
    // El bloque de estado es de frecuencia media: uno de cada diez lotes.
    estado:
      estado.indice % 10 === 0
        ? {
            modo: "LIMPIANDO",
            voltajeBateria: bat.voltaje,
            nivelBateriaPct: bat.pct,
            rssiDbm: rssi,
            zonaWifi: rssi >= -45 ? "CERCA" : rssi >= -62 ? "MEDIA" : "LEJOS",
            distanciaAcumuladaM: 0,
            areaEstimadaM2: lec.COBERTURA.valorFisico,
            potenciaSuccion: "NORMAL",
          }
        : undefined,
  };
}

async function tick(): Promise<void> {
  try {
    await fetch(`${baseUrl()}/api/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(construirPayload()),
      cache: "no-store",
    });
  } catch {
    // Si el servidor aún no acepta conexiones se reintenta en el siguiente tick.
  }
  estado.indice += 1;
  // Al terminar una pasada se reinicia la fase y se arranca con menos batería.
  if (estado.indice % MUESTRAS_POR_PASADA === 0) {
    estado.bateriaInicial = Math.max(35, estado.bateriaInicial - 10);
  }
}

export function iniciar(velocidad?: number): void {
  if (!simuladorHabilitado()) return;
  if (velocidad) estado.velocidad = velocidad;
  if (estado.timer) clearInterval(estado.timer);
  const periodoMs = 1000 / (HZ * estado.velocidad);
  estado.timer = setInterval(() => void tick(), periodoMs);
  estado.corriendo = true;
}

export function detener(): void {
  if (estado.timer) clearInterval(estado.timer);
  estado.timer = null;
  estado.corriendo = false;
}

export function estadoSimulador() {
  return {
    habilitado: simuladorHabilitado(),
    corriendo: estado.corriendo,
    velocidad: estado.velocidad,
    hz: HZ,
    muestrasEmitidas: estado.seq,
  };
}
