export const DECIMALS = {
  value: 10, // valor aproximado
  realValue: 10, // constante de referencia, misma escala para comparar de un vistazo
  errorAbs: 10, // error absoluto |aprox - real|
  errorRel: 8, // error relativo en porcentaje
  chartAxis: 6, // etiquetas de los ejes
} as const;

export const fmt = {
  value: (x: number) => x.toFixed(DECIMALS.value),
  realValue: (x: number) => x.toFixed(DECIMALS.realValue),
  errorAbs: (x: number) => x.toFixed(DECIMALS.errorAbs),
  errorRel: (x: number) => x.toFixed(DECIMALS.errorRel) + ' %',
  chartAxis: (x: number) => x.toFixed(DECIMALS.chartAxis),
};

/** Error relativo en porcentaje. */
export function errorRelPct(value: number, realValue: number): number {
  return (Math.abs(value - realValue) / Math.abs(realValue)) * 100;
}

/**
 * Longitud del prefijo de `fmt.value(value)` que coincide con `fmt.realValue(real)`.
 * La web pinta ese prefijo en tinta y el resto en gris.
 */
export function correctPrefixLength(value: number, realValue: number): number {
  const a = fmt.value(value);
  const b = fmt.realValue(realValue);
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  // Un punto decimal suelto al final no es un dígito correcto.
  return a[i - 1] === '.' ? i - 1 : i;
}
