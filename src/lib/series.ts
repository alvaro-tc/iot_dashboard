/**
 * Aproximaciones por series de Taylor.
 *
 * Cada función devuelve el arreglo COMPLETO de sumas parciales S_0..S_{n-1},
 * de modo que se pueda graficar la convergencia término a término.
 * El índice del arreglo equivale al número de términos usados menos uno.
 */

/** Factorial iterativo. Suficiente hasta ~170 antes de desbordar a Infinity. */
function factorial(k: number): number {
  let acc = 1;
  for (let i = 2; i <= k; i++) acc *= i;
  return acc;
}

/**
 * sin(x) = Σ (-1)^k · x^(2k+1) / (2k+1)!
 * Converge para todo x, pero con |x| grande hay cancelación catastrófica:
 * el mapeo de sensores mantiene x en un rango moderado por esa razón.
 */
export function sinTaylor(x: number, terminos: number): number[] {
  const sumas: number[] = [];
  let suma = 0;
  for (let k = 0; k < terminos; k++) {
    suma += ((-1) ** k * x ** (2 * k + 1)) / factorial(2 * k + 1);
    sumas.push(suma);
  }
  return sumas;
}

/** cos(x) = Σ (-1)^k · x^(2k) / (2k)! */
export function cosTaylor(x: number, terminos: number): number[] {
  const sumas: number[] = [];
  let suma = 0;
  for (let k = 0; k < terminos; k++) {
    suma += ((-1) ** k * x ** (2 * k)) / factorial(2 * k);
    sumas.push(suma);
  }
  return sumas;
}

/**
 * atan(x) = Σ (-1)^k · x^(2k+1) / (2k+1)   (serie de Gregory-Leibniz)
 * OJO: solo converge para |x| <= 1. Para |x| > 1 se usa la identidad
 * atan(x) = sign(x)·π/2 − atan(1/x), aplicando la serie al recíproco.
 */
export function atanTaylor(x: number, terminos: number): number[] {
  const fuera = Math.abs(x) > 1;
  const u = fuera ? 1 / x : x;
  const sumas: number[] = [];
  let suma = 0;
  for (let k = 0; k < terminos; k++) {
    suma += ((-1) ** k * u ** (2 * k + 1)) / (2 * k + 1);
    sumas.push(fuera ? Math.sign(x) * (Math.PI / 2) - suma : suma);
  }
  return sumas;
}

export type Aproximacion = {
  /** suma parcial con `terminos` términos */
  valorAproximado: number;
  /** valor de referencia de Math.* */
  valorReal: number;
  errorAbsoluto: number;
  /** relativo al valor real; si el real es ~0 se normaliza contra 1 */
  errorRelativo: number;
  /** todas las sumas parciales, para el gráfico de convergencia */
  sumasParciales: number[];
};

type Fn = "sin" | "cos" | "atan";

const IMPL: Record<Fn, { serie: (x: number, n: number) => number[]; real: (x: number) => number }> = {
  sin: { serie: sinTaylor, real: Math.sin },
  cos: { serie: cosTaylor, real: Math.cos },
  atan: { serie: atanTaylor, real: Math.atan },
};

/** Envoltura que calcula aproximación, valor real y errores en una pasada. */
export function aproximar(fn: Fn, x: number, terminos: number): Aproximacion {
  const { serie, real } = IMPL[fn];
  const sumasParciales = serie(x, Math.max(1, terminos));
  const valorAproximado = sumasParciales[sumasParciales.length - 1];
  const valorReal = real(x);
  const errorAbsoluto = Math.abs(valorReal - valorAproximado);
  const denominador = Math.abs(valorReal) < 1e-9 ? 1 : Math.abs(valorReal);
  return {
    valorAproximado,
    valorReal,
    errorAbsoluto,
    errorRelativo: errorAbsoluto / denominador,
    sumasParciales,
  };
}
