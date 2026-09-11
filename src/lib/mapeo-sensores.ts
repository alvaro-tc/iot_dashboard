/**
 * Traducción de cada serie de Taylor a una señal física del robot.
 *
 * La idea: la fase `x` avanza con el tiempo de la sesión y cada sensor lee
 * una proyección distinta de esa fase. Así las señales quedan correlacionadas
 * entre sí (como lo estarían en un robot real que recorre un cuarto) pero
 * nunca sincronizadas, porque cada ultrasónico usa un desfase propio.
 *
 * El valor que muestra la UI es `valorFisico` (ya escalado a unidades reales);
 * `errorAbsoluto` se presenta como "incertidumbre de la medición".
 */
import { aproximar, atanTaylor, type Aproximacion } from "./series";
import { BATERIA, HARDWARE, type Senal, type ZonaWifi } from "./constantes";

/** Desfases de los tres ultrasónicos, en radianes. */
const DESFASE = { frontal: 0, izquierda: 1.1, derecha: 2.3 } as const;

export type LecturaSenal = Aproximacion & {
  senal: Senal;
  x: number;
  n: number;
  valorFisico: number;
};

/**
 * Distancia ultrasónica: 110 + 95·sin(x + desfase) → 15–205 cm.
 * Se recorta al rango útil del HC-SR04 igual que haría el sensor real:
 * con pocos términos la serie puede dispararse fuera de todo rango físico.
 */
function distancia(aprox: Aproximacion): number {
  return Math.max(15, Math.min(205, 110 + 95 * aprox.valorAproximado));
}

/**
 * Densidad de polvo: 0.25 + 0.22·cos(x) → 0.03–0.47 mg/m³.
 *
 * La oscilación del coseno aporta la textura del cuarto (los picos son las
 * zonas sucias). Sobre ella se aplica un decaimiento exponencial ligado al
 * avance de la cobertura: es lo que hace que la curva de descontaminación
 * baje desde el pico inicial en lugar de oscilar para siempre.
 */
function polvo(aprox: Aproximacion, progreso: number): number {
  const bruto = 0.25 + 0.22 * aprox.valorAproximado;
  const decaimiento = 0.22 + 0.78 * Math.exp(-2.6 * Math.max(0, Math.min(1, progreso)));
  return Math.max(0.03, bruto * decaimiento);
}

/** Cobertura: 18·atan(x)/(π/2) → 0–18 m². Monótona creciente, como el área barrida. */
function cobertura(aprox: Aproximacion): number {
  return (18 * aprox.valorAproximado) / (Math.PI / 2);
}

/**
 * Lecturas de un instante. `n` es el número de términos de Taylor usados:
 * crece con el número de registro, de modo que la incertidumbre decae
 * visiblemente a lo largo de la sesión.
 */
export function lecturas(x: number, n: number): Record<Senal, LecturaSenal> {
  const frontal = aproximar("sin", x + DESFASE.frontal, n);
  const izq = aproximar("sin", x + DESFASE.izquierda, n);
  const der = aproximar("sin", x + DESFASE.derecha, n);
  const pm = aproximar("cos", x, n);
  const cob = aproximar("atan", x, n);
  // Fracción del área objetivo ya barrida; alimenta el decaimiento del polvo.
  const progreso = cobertura(cob) / 18;
  const rssiAprox = aproximar("atan", x * 0.35, n);

  const wrap = (senal: Senal, a: Aproximacion, xx: number, fisico: number): LecturaSenal => ({
    ...a,
    senal,
    x: xx,
    n,
    valorFisico: fisico,
  });

  return {
    DIST_FRONTAL: wrap("DIST_FRONTAL", frontal, x + DESFASE.frontal, distancia(frontal)),
    DIST_IZQ: wrap("DIST_IZQ", izq, x + DESFASE.izquierda, distancia(izq)),
    DIST_DER: wrap("DIST_DER", der, x + DESFASE.derecha, distancia(der)),
    POLVO: wrap("POLVO", pm, x, polvo(pm, progreso)),
    COBERTURA: wrap("COBERTURA", cob, x, cobertura(cob)),
    // El RSSI deriva lentamente con la fase del atan: −35 dBm junto al router,
    // −78 dBm en el extremo opuesto del piso.
    RSSI: wrap("RSSI", rssiAprox, x * 0.35, -35 - 43 * (rssiAprox.valorAproximado / (Math.PI / 2))),
  };
}

/**
 * Pulsos de encoder del intervalo.
 *
 * Se derivan de la pendiente de atan: d/dx atan(x) = 1/(1+x²). Como la cobertura
 * es proporcional a atan(x), la distancia recorrida en Δx es proporcional a esa
 * derivada, y los pulsos son esa distancia dividida entre mm/pulso.
 *
 * El sesgo `desbalance` reparte los pulsos entre ambas ruedas: cuando el robot
 * gira una rueda avanza más que la otra, y eso es exactamente lo que mide la
 * odometría diferencial.
 */
export function pulsosDelIntervalo(
  x: number,
  dx: number,
  desbalance: number,
): { izq: number; der: number; metros: number } {
  // Área bajo la derivada de atan entre x y x+dx, escalada como la cobertura.
  const dArea = ((18 / (Math.PI / 2)) * dx) / (1 + x * x);
  // De área barrida a metros lineales: área = distancia × ancho del cepillo.
  const metros = Math.max(0, dArea / HARDWARE.anchoCepilloM);
  const pulsosTotales = metros * HARDWARE.pulsosPorMetro;
  return {
    izq: Math.round((pulsosTotales * (1 - desbalance)) / 2),
    der: Math.round((pulsosTotales * (1 + desbalance)) / 2),
    metros,
  };
}

/** Descarga de batería: sigue atan(x), igual que la cobertura (gastar = avanzar). */
export function bateriaEnFase(x: number, inicialPct: number): { pct: number; voltaje: number } {
  const consumido = (atanTaylor(x, 24).at(-1)! / (Math.PI / 2)) * 55;
  const pct = Math.max(0, Math.min(100, inicialPct - consumido));
  return { pct, voltaje: BATERIA.vMin + (BATERIA.vMax - BATERIA.vMin) * (pct / 100) };
}

/** Clasificación gruesa del RSSI. No es distancia: solo tres zonas calibrables. */
export function zonaDeRssi(rssi: number, rssiCerca: number, rssiMedia: number): ZonaWifi {
  if (rssi >= rssiCerca) return "CERCA";
  if (rssi >= rssiMedia) return "MEDIA";
  return "LEJOS";
}
