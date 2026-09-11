/**
 * Núcleo de la simulación: convierte el avance de la fase `x` en muestras
 * completas del robot. Lo comparten el seed (escribe en la BD) y el generador
 * en vivo (hace POST a /api/telemetry), de modo que los datos históricos y los
 * datos en tiempo real salen exactamente del mismo modelo físico.
 *
 * Todo lo que hay aquí es simulación pura: ningún acceso a la base de datos.
 */
import { bateriaEnFase, lecturas, pulsosDelIntervalo, zonaDeRssi } from "../mapeo-sensores";
import type { LecturaSenal } from "../mapeo-sensores";
import { anguloGirado, metrosRecorridos, velocidadLineal } from "../derivados";
import type { Senal, ZonaWifi } from "../constantes";

/** Fase final de una sesión completa: con x ≈ 6 la cobertura casi satura. */
export const X_FINAL = 6;

export type OpcionesSesion = {
  /** Instante de la primera muestra. */
  inicio: Date;
  /** Número de muestras de la sesión. */
  muestras: number;
  /** Segundos reales entre muestra y muestra. */
  dtS: number;
  /** Porcentaje de batería al arrancar. */
  bateriaInicial: number;
  /** 0 = ninguna, se corta la sesión en esta muestra (batería baja, atasco). */
  cortarEn?: number;
  /** Semilla para el ruido pseudoaleatorio: sesiones distintas, reproducibles. */
  semilla: number;
};

export type MuestraSimulada = {
  indice: number;
  t: Date;
  /** Número de términos de Taylor: crece con el índice, así la incertidumbre decae. */
  n: number;
  x: number;
  lecturas: Record<Senal, LecturaSenal>;
  pulsosIzq: number;
  pulsosDer: number;
  metros: number;
  metrosAcumulados: number;
  areaAcumulada: number;
  velocidadMs: number;
  anguloGirado: number;
  bateriaPct: number;
  voltaje: number;
  rssi: number;
  zonaWifi: ZonaWifi;
  /** true si en esta muestra los motores están comandados pero no hay pulsos. */
  atascoSimulado: boolean;
};

/** PRNG determinista (mulberry32): mismas sesiones en cada seed. */
export function prng(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Términos de Taylor usados en la muestra i. Cota alta para no desbordar el factorial. */
export function terminosEn(indice: number): number {
  return Math.min(30, 6 + Math.floor(indice / 2));
}

/**
 * Genera las muestras de una sesión completa.
 * La fase avanza linealmente de 0 a X_FINAL a lo largo de `muestras`.
 */
export function* generarSesion(opciones: OpcionesSesion): Generator<MuestraSimulada> {
  const { inicio, muestras, dtS, bateriaInicial, semilla } = opciones;
  const rnd = prng(semilla);
  const dx = X_FINAL / muestras;
  const total = opciones.cortarEn ?? muestras;

  let metrosAcumulados = 0;
  let areaAcumulada = 0;

  for (let i = 0; i < total; i++) {
    const x = i * dx;
    const n = terminosEn(i);
    const lec = lecturas(x, n);

    // Desbalance entre ruedas: casi siempre pequeño (avance recto con deriva),
    // ocasionalmente grande (giro de evasión tras detectar un obstáculo).
    const girando = lec.DIST_FRONTAL.valorFisico < 22;
    const desbalance = girando ? 0.55 + rnd() * 0.3 : (rnd() - 0.5) * 0.12;

    // Un 1.5 % de las muestras simula un atasco: motores ON, encoders en cero.
    const atascoSimulado = rnd() < 0.015;
    const p = pulsosDelIntervalo(x, dx, desbalance);
    const pulsosIzq = atascoSimulado ? 0 : p.izq;
    const pulsosDer = atascoSimulado ? 0 : p.der;

    const metros = metrosRecorridos(pulsosIzq, pulsosDer);
    metrosAcumulados += metros;
    areaAcumulada = lec.COBERTURA.valorFisico;

    const bat = bateriaEnFase(x, bateriaInicial);
    const rssi = Math.round(lec.RSSI.valorFisico);

    yield {
      indice: i,
      t: new Date(inicio.getTime() + i * dtS * 1000),
      n,
      x,
      lecturas: lec,
      pulsosIzq,
      pulsosDer,
      metros,
      metrosAcumulados,
      areaAcumulada,
      velocidadMs: velocidadLineal(pulsosIzq, pulsosDer, dtS),
      anguloGirado: anguloGirado(pulsosIzq, pulsosDer),
      bateriaPct: bat.pct,
      voltaje: bat.voltaje,
      rssi,
      zonaWifi: zonaDeRssi(rssi, -45, -62),
      atascoSimulado,
    };
  }
}
