/**
 * Reduce `points` a como mucho `max` puntos conservando la forma de la curva:
 * - la mitad del presupuesto se queda con los puntos más recientes, intactos;
 * - los antiguos se resumen en cubos que guardan su mínimo y su máximo en orden.
 * Min/max y no "uno de cada N": Leibniz alterna arriba y abajo en cada iteración, y un
 * muestreo por paso fijo se quedaría solo con un lado y aplanaría la oscilación.
 */
export function downsample<T>(points: T[], max: number, y: (p: T) => number): T[] {
  if (points.length <= max) return points;
  const keepRecent = Math.floor(max / 2);
  const old = points.slice(0, points.length - keepRecent);
  const recent = points.slice(points.length - keepRecent);
  const buckets = Math.max(1, Math.floor((max - keepRecent) / 2));
  const size = old.length / buckets;
  const out: T[] = [];
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * size);
    const end = Math.min(old.length, Math.floor((b + 1) * size));
    if (start >= end) continue;
    let lo = start;
    let hi = start;
    for (let i = start + 1; i < end; i++) {
      if (y(old[i]) < y(old[lo])) lo = i;
      if (y(old[i]) > y(old[hi])) hi = i;
    }
    if (lo === hi) out.push(old[lo]);
    else out.push(old[Math.min(lo, hi)], old[Math.max(lo, hi)]);
  }
  return out.concat(recent);
}
