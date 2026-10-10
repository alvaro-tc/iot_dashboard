// pnpm --filter @iot/web check
// Comprueba el cálculo de los widgets de uso: si esto falla, los contadores y las gráficas de
// motor mienten (y mentir con un número grande en pantalla es peor que no mostrarlo).
import assert from 'node:assert/strict';
import { METRICAS, metrica, segundosMotores, usoAcumulado } from './metricas.ts';

type Lectura = Parameters<typeof usoAcumulado>[0][number];

/** Lectura mínima: solo lo que mira el cálculo. */
const l = (medidoEn: number, velIzqPct: number, velDerPct: number) =>
  ({ medidoEn, velIzqPct, velDerPct }) as Lectura;

// Dos tramos de 1 s con el motor en marcha: 2 s acumulados y la serie es monótona.
{
  const serie = usoAcumulado([l(0, 60, 60), l(1000, 60, 60), l(2000, 60, 60)], 'izq');
  assert.deepEqual(
    serie.map((p) => p.y),
    [0, 1, 2],
  );
}
// Parado no suma, y lo que cuenta es el tramo que empieza, no el que acaba: el motor estaba
// en marcha de 0 a 1 s (suma 1) y parado de 1 a 2 s (no suma).
{
  const serie = usoAcumulado([l(0, 60, 0), l(1000, 0, 0), l(2000, 0, 0)], 'izq');
  assert.deepEqual(
    serie.map((p) => p.y),
    [0, 1, 1],
  );
}
// Cada motor va por su cuenta: girando, la rueda derecha va al revés y eso también es uso.
{
  assert.equal(usoAcumulado([l(0, 0, -60), l(1000, 0, -60)], 'der').at(-1)!.y, 1);
  assert.equal(usoAcumulado([l(0, 0, -60), l(1000, 0, -60)], 'izq').at(-1)!.y, 0);
}
// Un corte de conexión de 10 min no son 10 min de motor: el hueco se acota a 2 s.
assert.equal(usoAcumulado([l(0, 60, 60), l(600_000, 60, 60)], 'izq').at(-1)!.y, 2);
// Sin lecturas no hay serie (y la gráfica dibuja vacío, no un cero falso).
assert.deepEqual(usoAcumulado([], 'izq'), []);

const cfg = { intervaloTelemetriaMs: 200 } as Parameters<typeof segundosMotores>[1];
const resumen = (movimientos: Record<string, number> | null) =>
  ({ movimientos }) as unknown as Parameters<typeof segundosMotores>[0];

// 100 lecturas en marcha a 200 ms = 20 s; las detenidas no cuentan.
assert.equal(
  segundosMotores(resumen({ avanzando: 50, girando_izq: 20, girando_der: 20, retrocediendo: 10, detenido: 900 }), cfg),
  20,
);
// Robot nuevo: el servidor manda `movimientos: null` y el contador muestra 0, no NaN.
assert.equal(segundosMotores(resumen(null), cfg), 0);

// Toda métrica escribe algo sin datos de sesión, y una id desconocida cae en la primera.
{
  const ctx = {
    resumen: { segundosHoy: 0, distanciaHoyCm: 0, evasionesIzq: 0, evasionesCentro: 0, evasionesDer: 0, movimientos: null, sesion: null },
    cfg,
    lecturas: [],
    ahora: 0,
  } as Parameters<(typeof METRICAS)[number]['calc']>[0];
  for (const m of METRICAS) assert.ok(m.calc(ctx).length > 0, m.valor);
  assert.equal(metrica('loquesea' as never).valor, METRICAS[0].valor);
}

console.log('metricas.check.ts ok');
