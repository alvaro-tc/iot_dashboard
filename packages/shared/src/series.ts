// Única fuente de verdad sobre las 7 series. Ni la web ni la API redefinen esto.

export type SeriesKey =
  | 'pi_leibniz'
  | 'ln2_alternating'
  | 'wallis_pi'
  | 'euler_gamma'
  | 'basel'
  | 'pi2_over_8'
  | 'catalan';

export interface Series {
  key: SeriesKey;
  label: string;
  symbol: string;
  realValue: number;
  formulaTex: string;
  description: string;
}

export const SERIES: readonly Series[] = [
  {
    key: 'pi_leibniz',
    label: 'Leibniz–Gregory',
    symbol: 'π',
    realValue: 3.141592653589793,
    formulaTex: '\\pi = \\sum_{k\\ge1} \\frac{4(-1)^{k+1}}{2k-1}',
    description: 'Suma alternada de 4/(2k−1). Oscila alrededor de π; el error cae como 1/(2n).',
  },
  {
    key: 'ln2_alternating',
    label: 'Armónica alternada',
    symbol: 'ln 2',
    realValue: 0.693147180559945,
    formulaTex: '\\ln 2 = \\sum_{k\\ge1} \\frac{(-1)^{k+1}}{k}',
    description: 'Suma alternada de 1/k. Oscila alrededor de ln 2; el error cae como 1/(2n).',
  },
  {
    key: 'wallis_pi',
    label: 'Producto de Wallis',
    symbol: 'π',
    realValue: 3.141592653589793,
    formulaTex: '\\pi = 2\\prod_{k\\ge1} \\frac{2k}{2k-1}\\cdot\\frac{2k}{2k+1}',
    description: 'Producto infinito que se reporta multiplicado por 2. Sube hacia π; error ~1/n.',
  },
  {
    key: 'euler_gamma',
    label: 'Euler–Mascheroni',
    symbol: 'γ',
    realValue: 0.577215664901533,
    formulaTex: '\\gamma = \\lim_{n\\to\\infty} H(n) - \\ln n',
    description: 'Diferencia entre la serie armónica y el logaritmo. Baja hacia γ; error ~1/(2n).',
  },
  {
    key: 'basel',
    label: 'Problema de Basilea',
    symbol: 'π²/6',
    realValue: 1.644934066848226,
    formulaTex: '\\frac{\\pi^2}{6} = \\sum_{k\\ge1} \\frac{1}{k^2}',
    description: 'Suma de los inversos de los cuadrados. Sube hacia π²/6; error ~1/n.',
  },
  {
    key: 'pi2_over_8',
    label: 'Suma de impares al cuadrado',
    symbol: 'π²/8',
    realValue: 1.233700550136169,
    formulaTex: '\\frac{\\pi^2}{8} = \\sum_{k\\ge1} \\frac{1}{(2k-1)^2}',
    description: 'Suma de los inversos de los impares al cuadrado. Sube hacia π²/8; error ~1/(2n).',
  },
  {
    key: 'catalan',
    label: 'Constante de Catalan',
    symbol: 'G',
    realValue: 0.915965594177219,
    formulaTex: 'G = \\sum_{k\\ge1} \\frac{(-1)^{k+1}}{(2k-1)^2}',
    description: 'Suma alternada de 1/(2k−1)². La más rápida: error ~1/n². Sirve de contraste.',
  },
] as const;

export const SERIES_KEYS = SERIES.map((s) => s.key) as [SeriesKey, ...SeriesKey[]];

export const seriesByKey: Record<SeriesKey, Series> = Object.fromEntries(
  SERIES.map((s) => [s.key, s]),
) as Record<SeriesKey, Series>;

export function isSeriesKey(x: string): x is SeriesKey {
  return x in seriesByKey;
}

/** Acumulador inicial: 1 para el producto de Wallis, 0 para el resto. */
export function initialAcc(key: SeriesKey): number {
  return key === 'wallis_pi' ? 1 : 0;
}

/**
 * Aplica el término k (k desde 1) al acumulador y devuelve el nuevo acumulador
 * y el valor a reportar en la iteración k. Pura: sin estado.
 *
 *   let acc = initialAcc(key);
 *   for (let k = 1; ; k++) ({ acc, value } = computeTerm(key, k, acc));
 */
export function computeTerm(key: SeriesKey, k: number, acc: number): { acc: number; value: number } {
  const sign = k % 2 === 1 ? 1 : -1; // (-1)^(k+1)
  const odd = 2 * k - 1;
  switch (key) {
    case 'pi_leibniz':
      acc += (4 * sign) / odd;
      return { acc, value: acc };
    case 'ln2_alternating':
      acc += sign / k;
      return { acc, value: acc };
    case 'wallis_pi':
      acc *= ((2 * k) / odd) * ((2 * k) / (2 * k + 1));
      return { acc, value: 2 * acc };
    case 'euler_gamma':
      acc += 1 / k; // acc = H(k)
      return { acc, value: acc - Math.log(k) };
    case 'basel':
      acc += 1 / (k * k);
      return { acc, value: acc };
    case 'pi2_over_8':
      acc += 1 / (odd * odd);
      return { acc, value: acc };
    case 'catalan':
      acc += sign / (odd * odd);
      return { acc, value: acc };
  }
}
