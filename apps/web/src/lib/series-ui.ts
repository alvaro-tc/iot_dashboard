import { seriesByKey, type SeriesKey } from '@iot/shared';

// Color por serie para la línea de tiempo. Tonos apagados: el teal y el rojo quedan
// reservados para "vivo ahora" y "error".
export const SERIES_COLORS: Record<SeriesKey, string> = {
  pi_leibniz: '#16324F',
  ln2_alternating: '#5B7DB1',
  wallis_pi: '#8C6BB1',
  euler_gamma: '#A88532',
  basel: '#6E8B3D',
  pi2_over_8: '#A0714F',
  catalan: '#B0607D',
};

export const seriesLabel = (key: string) => seriesByKey[key as SeriesKey]?.label ?? key;

/** TeX mínimo -> texto legible. Evita cargar un motor de TeX para siete fórmulas de una línea. */
export function texToText(tex: string): string {
  let s = tex.replace(/\^\{([^{}]*)\}/g, '^($1)');
  for (let i = 0; i < 3; i++) {
    s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a: string, b: string) =>
      `${/^[\w\\]+$/.test(a) ? a : `(${a})`}/${/^\w+$/.test(b) ? b : `(${b})`}`,
    );
  }
  return s
    .replace(/\\sum_\{k\\ge1\}/g, 'Σ ')
    .replace(/\\prod_\{k\\ge1\}/g, 'Π ')
    .replace(/\\lim_\{n\\to\\infty\}/g, 'lim ')
    .replace(/\\pi/g, 'π')
    .replace(/\\gamma/g, 'γ')
    .replace(/\\ln/g, 'ln')
    .replace(/\\cdot/g, '·')
    .replace(/\^2/g, '²')
    .replace(/\s+/g, ' ')
    .trim();
}
