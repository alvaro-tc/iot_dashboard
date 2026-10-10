// pnpm --filter @iot/web check
// Comprueba el cálculo de los widgets de uso: si esto falla, los contadores y las gráficas de
// motor mienten (y mentir con un número grande en pantalla es peor que no mostrarlo).
import assert from 'node:assert/strict';
import { INTERVALO_TELEMETRIA_MS, METRICAS, metrica, segundosDeLecturas, usoAcumulado } from './metricas.ts';

type Lectura = Parameters<typeof usoAcumulado>[0][number];

/** Lectura mínima: solo lo que mira el cálculo. */
const l = (creadoEn: number, movimientoIzquierda: number, movimientoDerecha: number) =>
  ({ creadoEn, movimientoIzquierda, movimientoDerecha }) as Lectura;

// Dos tramos de 1 s con el motor en marcha: 2 s acumulados y la serie es monótona.
{
  const serie = usoAcumulado([l(0, 180, 180), l(1000, 180, 180), l(2000, 180, 180)], 'izquierdo');
  assert.deepEqual(
    serie.map((p) => p.y),
    [0, 1, 2],
  );
}
// Parado no suma, y lo que cuenta es el tramo que empieza, no el que acaba: el motor estaba
// en marcha de 0 a 1 s (suma 1) y parado de 1 a 2 s (no suma).
{
  const serie = usoAcumulado([l(0, 180, 0), l(1000, 0, 0), l(2000, 0, 0)], 'izquierdo');
  assert.deepEqual(
    serie.map((p) => p.y),
    [0, 1, 1],
  );
}
// Cada motor va por su cuenta: girando, la rueda derecha va al revés y eso también es uso.
{
  assert.equal(usoAcumulado([l(0, 0, -180), l(1000, 0, -180)], 'derecho').at(-1)!.y, 1);
  assert.equal(usoAcumulado([l(0, 0, -180), l(1000, 0, -180)], 'izquierdo').at(-1)!.y, 0);
}
// PWM por debajo del umbral es ruido, no marcha.
assert.equal(usoAcumulado([l(0, 5, 5), l(1000, 5, 5)], 'izquierdo').at(-1)!.y, 0);
// Un corte de conexión de 10 min no son 10 min de motor: el hueco se acota a 2 s.
assert.equal(usoAcumulado([l(0, 180, 180), l(600_000, 180, 180)], 'izquierdo').at(-1)!.y, 2);
// Sin lecturas no hay serie (y la gráfica dibuja vacío, no un cero falso).
assert.deepEqual(usoAcumulado([], 'izquierdo'), []);

// 100 lecturas en marcha a 500 ms = 50 s.
assert.equal(segundosDeLecturas(100), (100 * INTERVALO_TELEMETRIA_MS) / 1000);
// Robot nuevo: el servidor no manda el campo y el contador muestra 0, no NaN.
assert.equal(segundosDeLecturas(undefined), 0);

// Toda métrica escribe algo sin datos de sesión, y una id desconocida cae en la primera.
{
  const ctx = {
    resumen: {
      segundosHoy: 0,
      lecturasEnMarchaHoy: 0,
      lecturasDetenidoHoy: 0,
      cercaIzquierda: 0,
      cercaCentral: 0,
      cercaDerecha: 0,
      bateriaPorcentaje: null,
      bateriaVoltios: null,
      mensajesPorSegundo: 0,
      segundosTotal: 0,
      lecturasEnMarchaTotal: 0,
      lecturasMarchaIzquierdaTotal: 0,
      lecturasMarchaDerechaTotal: 0,
      sesion: null,
    },
    lecturas: [],
    ahora: 0,
  } as Parameters<(typeof METRICAS)[number]['calc']>[0];
  for (const m of METRICAS) assert.ok(m.calc(ctx).length > 0, m.valor);
  assert.equal(metrica('loquesea' as never).valor, METRICAS[0].valor);
}

console.log('metricas.check.ts ok');
