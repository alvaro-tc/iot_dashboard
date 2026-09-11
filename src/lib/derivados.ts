/**
 * Magnitudes derivadas en el backend. Ninguna se mide directamente:
 * todas salen de los encoders, el ADC de batería o el sensor de polvo.
 * No hay IMU, ni sensor de corriente, ni de temperatura.
 */
import { HARDWARE } from "./constantes";

/**
 * Velocidad lineal = (promedio de pulsos de ambas ruedas × mm/pulso) / Δt.
 * Devuelve m/s.
 */
export function velocidadLineal(
  pulsosIzq: number,
  pulsosDer: number,
  deltaS: number,
  mmPorPulso: number = HARDWARE.mmPorPulso,
): number {
  if (deltaS <= 0) return 0;
  const mm = ((pulsosIzq + pulsosDer) / 2) * mmPorPulso;
  return mm / 1000 / deltaS;
}

/**
 * Ángulo girado por odometría diferencial, en radianes:
 *   θ = (distancia_derecha − distancia_izquierda) / distancia_entre_ejes
 * Sin IMU esta es la única fuente de orientación, y acumula deriva.
 */
export function anguloGirado(
  pulsosIzq: number,
  pulsosDer: number,
  mmPorPulso: number = HARDWARE.mmPorPulso,
  ejesMm: number = HARDWARE.distanciaEjesMm,
): number {
  return ((pulsosDer - pulsosIzq) * mmPorPulso) / ejesMm;
}

/** Metros recorridos por el promedio de ambas ruedas. */
export function metrosRecorridos(
  pulsosIzq: number,
  pulsosDer: number,
  mmPorPulso: number = HARDWARE.mmPorPulso,
): number {
  return (((pulsosIzq + pulsosDer) / 2) * mmPorPulso) / 1000;
}

/** Área barrida = distancia lineal × ancho efectivo del cepillo. */
export function areaBarrida(metros: number, anchoM: number = HARDWARE.anchoCepilloM): number {
  return metros * anchoM;
}

/**
 * Atascado: motores comandados ON pero los encoders no cuentan
 * durante más de `ventanaS` segundos seguidos.
 */
export function estaAtascado(
  motoresOn: boolean,
  pulsosRecientes: number[],
  segundosPorMuestra: number,
  ventanaS = 3,
): boolean {
  if (!motoresOn) return false;
  const muestrasNecesarias = Math.ceil(ventanaS / segundosPorMuestra);
  if (pulsosRecientes.length < muestrasNecesarias) return false;
  return pulsosRecientes.slice(-muestrasNecesarias).every((p) => p <= 1);
}

/** Rueda trabada: una rueda cuenta pulsos y la otra está en cero. */
export function ruedaTrabada(pulsosIzq: number, pulsosDer: number): "IZQUIERDA" | "DERECHA" | null {
  if (pulsosIzq <= 1 && pulsosDer > 4) return "IZQUIERDA";
  if (pulsosDer <= 1 && pulsosIzq > 4) return "DERECHA";
  return null;
}

/**
 * Caída de tensión anómala. Sustituye al sensor de corriente que se descartó:
 * si el voltaje cae más rápido de lo esperado, el motor está exigiendo más
 * corriente de la normal, típicamente por un cepillo trabado con pelo.
 */
export function caidaTensionAnomala(
  voltajeAnterior: number,
  voltajeActual: number,
  deltaS: number,
  umbralVPorMin: number,
): boolean {
  if (deltaS <= 0) return false;
  const caidaPorMinuto = ((voltajeAnterior - voltajeActual) / deltaS) * 60;
  return caidaPorMinuto > umbralVPorMin;
}

/** Efectividad = (PM inicial − PM final) / PM inicial × 100. */
export function efectividadLimpieza(pmInicial: number, pmFinal: number): number {
  if (pmInicial <= 0) return 0;
  return Math.max(0, ((pmInicial - pmFinal) / pmInicial) * 100);
}

/** Media móvil simple sobre las últimas `ventana` muestras. */
export function mediaMovil(valores: number[], ventana = 20): number {
  if (valores.length === 0) return 0;
  const trozo = valores.slice(-ventana);
  return trozo.reduce((a, b) => a + b, 0) / trozo.length;
}

/** Zona sucia: pico de PM por encima de `factor` veces la media móvil. */
export function esZonaSucia(pmActual: number, historicoPm: number[], factor: number): boolean {
  if (historicoPm.length < 5) return false;
  const media = mediaMovil(historicoPm);
  return media > 0 && pmActual > media * factor;
}

/** Minutos de autonomía restantes a partir de la pendiente de descarga. */
export function minutosRestantes(
  pctActual: number,
  pctPorMinuto: number,
  pctCorte: number,
): number | null {
  if (pctPorMinuto <= 0) return null;
  return Math.max(0, (pctActual - pctCorte) / pctPorMinuto);
}
