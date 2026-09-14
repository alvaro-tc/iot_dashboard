import { DECIMALS, fmt, type Series } from '@iot/shared';
import { memo, useMemo, useState } from 'react';
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { downsample } from '../lib/downsample.ts';
import { texToText } from '../lib/series-ui.ts';
import { usePrefersReducedMotion } from '../lib/time.ts';
import type { Sample } from '../lib/types.ts';
import { Digits } from './ui.tsx';

const MAX_POINTS = 2000;
const INK = '#16324F';
const INK_SOFT = '#5E7186';
const DEVIATION = '#B3202C'; // --color-deviation
const LOG_FLOOR = 1e-16; // el error puede ser 0 exacto; la escala log no admite 0

const axisTick = { fontFamily: 'IBM Plex Mono', fontSize: 11, fill: INK_SOFT };

/** Etiqueta del eje log sin notación científica: 1e-7 -> 0.0000001. */
function fixedTick(x: number): string {
  if (x >= 1) return x.toFixed(0);
  return x.toFixed(Math.min(20, Math.ceil(-Math.log10(x))));
}

type Mode = 'value' | 'error';

/**
 * Tarjeta de una serie. `samples` ya viene filtrado por sesión/rango y ordenado por sesión e iteración.
 * Sin sesión seleccionada se dibuja una línea por sesión, más clara cuanto más antigua.
 */
export const SeriesChart = memo(function SeriesChart({ series, samples, chartClass = 'h-[220px]' }: { series: Series; samples: Sample[]; chartClass?: string }) {
  const [mode, setMode] = useState<Mode>('value');
  const reduced = usePrefersReducedMotion();
  const last = samples.at(-1);

  const { lines, logDomain, logTicks } = useMemo(() => {
    const byRun = new Map<number, Sample[]>();
    for (const s of samples) byRun.set(s.runId, [...(byRun.get(s.runId) ?? []), s]);
    const groups = [...byRun.entries()]; // en orden de inicio de sesión
    const budget = Math.max(200, Math.floor(MAX_POINTS / Math.max(1, groups.length)));
    let min = Infinity;
    let max = 0;
    const lines = groups.map(([runId, pts], i) => {
      const data = pts.map((s) => ({
        iteration: s.iteration,
        y: mode === 'value' ? s.value : Math.max(s.errorAbs, LOG_FLOOR),
        e: Math.max(s.errorAbs, LOG_FLOOR), // error en el eje log derecho (modo valor)
        band: [series.realValue, s.value] as [number, number], // franja del error: entre el valor real y la aproximación
      }));
      for (const d of data) (min = Math.min(min, d.e)), (max = Math.max(max, d.e));
      return {
        runId,
        data: downsample(data, budget, (d) => d.y),
        opacity: groups.length === 1 ? 1 : 0.3 + (0.7 * (i + 1)) / groups.length,
      };
    });
    if (!lines.length) return { lines, logDomain: undefined, logTicks: undefined };
    const lo = Math.floor(Math.log10(min));
    const hi = Math.max(lo + 1, Math.ceil(Math.log10(max)));
    const step = Math.ceil((hi - lo) / 6);
    const ticks: number[] = [];
    for (let p = lo; p <= hi; p += step) ticks.push(10 ** p);
    return { lines, logDomain: [10 ** lo, 10 ** hi] as [number, number], logTicks: ticks };
  }, [samples, mode, series.realValue]);

  const empty = samples.length === 0;

  return (
    <article className="panel flex min-w-0 flex-col" aria-label={`Serie ${series.label}`}>
      <header className="border-b border-grid px-4 pt-3 pb-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className={`text-[15px] ${empty ? 'text-muted' : ''}`}>
            <span className="mr-2 font-mono">{series.symbol}</span>
            {series.label}
          </h3>
          <div role="group" aria-label="Escala del gráfico" className="flex shrink-0">
            <button type="button" className="seg" aria-pressed={mode === 'value'} onClick={() => setMode('value')}>
              valor
            </button>
            <button type="button" className="seg" aria-pressed={mode === 'error'} onClick={() => setMode('error')}>
              error log
            </button>
          </div>
        </div>
        <p className="mt-0.5 font-mono text-[13px] text-ink-soft">{texToText(series.formulaTex)}</p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 text-[13px] leading-[1.4]">
          <dt className="text-ink-soft">Último</dt>
          <dd className="num">{last ? <Digits value={last.value} real={series.realValue} /> : <span className="text-muted">—</span>}</dd>
          <dt className="text-ink-soft">Real</dt>
          <dd className="num">{fmt.realValue(series.realValue)}</dd>
          <dt className="text-ink-soft">Error</dt>
          <dd className="num">{last ? fmt.errorAbs(last.errorAbs) : <span className="text-muted">—</span>}</dd>
        </dl>
      </header>
      <div className={`graph-paper relative ${chartClass}`}>
        {empty ? (
          <p className="absolute inset-0 grid place-items-center text-[13px] text-muted">sin envíos</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart margin={{ top: 12, right: 16, bottom: 4, left: 4 }}>
              <XAxis
                type="number"
                dataKey="iteration"
                domain={['dataMin', 'dataMax']}
                allowDuplicatedCategory={false}
                tick={axisTick}
                stroke={INK_SOFT}
                tickLine={false}
              />
              {mode === 'value' ? (
                <YAxis
                  type="number"
                  domain={['auto', 'auto']}
                  tickFormatter={(v: number) => v.toFixed(DECIMALS.chartAxis)}
                  tick={axisTick}
                  stroke={INK_SOFT}
                  tickLine={false}
                  width={78}
                />
              ) : (
                <YAxis
                  type="number"
                  scale="log"
                  domain={logDomain}
                  ticks={logTicks}
                  allowDataOverflow
                  tickFormatter={fixedTick}
                  tick={axisTick}
                  stroke={INK_SOFT}
                  tickLine={false}
                  width={96}
                />
              )}
              {mode === 'value' && (
                // eje derecho: el error en escala log, visible aunque en el eje de valores la franja sea de 1 px
                <YAxis
                  yAxisId="err"
                  orientation="right"
                  type="number"
                  scale="log"
                  domain={logDomain}
                  ticks={logTicks}
                  allowDataOverflow
                  tickFormatter={fixedTick}
                  tick={{ ...axisTick, fill: DEVIATION }}
                  stroke={DEVIATION}
                  tickLine={false}
                  width={96}
                />
              )}
              {mode === 'value' && (
                <ReferenceLine y={series.realValue} stroke={INK_SOFT} strokeDasharray="4 3" ifOverflow="extendDomain" />
              )}
              <Tooltip
                isAnimationActive={false}
                formatter={(v: number, _name: string, item: { dataKey?: unknown }) =>
                  mode === 'value' && item.dataKey === 'y' ? fmt.value(v) : fmt.errorAbs(v)
                }
                labelFormatter={(l) => `iteración ${l}`}
                contentStyle={{ fontFamily: 'IBM Plex Mono', fontSize: 12, border: '1px solid #D7DEE4', borderRadius: 0 }}
              />
              {mode === 'value' &&
                lines.map((l) => (
                  <Area
                    key={`err-${l.runId}`}
                    data={l.data}
                    dataKey="band"
                    type="linear"
                    stroke="none"
                    fill={DEVIATION}
                    fillOpacity={0.15 * l.opacity}
                    tooltipType="none"
                    activeDot={false}
                    isAnimationActive={false}
                  />
                ))}
              {mode === 'value' &&
                lines.map((l) => (
                  <Line
                    key={`e-${l.runId}`}
                    yAxisId="err"
                    name={`error #${l.runId}`}
                    data={l.data}
                    dataKey="e"
                    type="linear"
                    stroke={DEVIATION}
                    strokeOpacity={l.opacity}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 3, fill: DEVIATION }}
                    isAnimationActive={false}
                  />
                ))}
              {lines.map((l) => (
                <Line
                  key={l.runId}
                  name={`sesión #${l.runId}`}
                  data={l.data}
                  dataKey="y"
                  type="linear"
                  stroke={mode === 'value' ? INK : DEVIATION}
                  strokeOpacity={l.opacity}
                  strokeWidth={1.5}
                  dot={l.data.length <= 300 ? { r: 1.5, fill: INK, stroke: 'none', fillOpacity: l.opacity } : false}
                  activeDot={{ r: 3 }}
                  isAnimationActive={!reduced}
                  animationDuration={150}
                  animationEasing="linear"
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </article>
  );
});
