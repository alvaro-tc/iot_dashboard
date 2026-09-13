import { SERIES, errorRelPct, fmt, seriesByKey } from '@iot/shared';
import { useMemo, useState } from 'react';
import { seriesLabel } from '../lib/series-ui.ts';
import { formatHM, formatTime } from '../lib/time.ts';
import type { Run, Sample } from '../lib/types.ts';
import { Digits } from './ui.tsx';

const PAGE = 100; // como mucho 200 filas en el DOM; aquí 100

export function SamplesTable({
  samples,
  runs,
  selectedRunId,
  fresh,
}: {
  samples: Sample[];
  runs: Run[];
  selectedRunId: number | null;
  fresh: Set<number>;
}) {
  const [seriesFilter, setSeriesFilter] = useState('');
  const [runFilter, setRunFilter] = useState('');
  const [page, setPage] = useState(0);
  const runId = selectedRunId ?? (runFilter ? Number(runFilter) : null);

  const rows = useMemo(() => {
    const out = samples.filter((s) => (!seriesFilter || s.seriesKey === seriesFilter) && (!runId || s.runId === runId));
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.iteration - a.iteration);
  }, [samples, seriesFilter, runId]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages - 1);
  const visible = rows.slice(current * PAGE, (current + 1) * PAGE);
  const runById = useMemo(() => new Map(runs.map((r) => [r.id, r])), [runs]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="samples-series">
            Serie
          </label>
          <select id="samples-series" className="input w-56" value={seriesFilter} onChange={(e) => (setSeriesFilter(e.target.value), setPage(0))}>
            <option value="">Todas</option>
            {SERIES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="samples-run">
            Sesión
          </label>
          <select
            id="samples-run"
            className="input w-64"
            value={selectedRunId ? String(selectedRunId) : runFilter}
            disabled={!!selectedRunId}
            onChange={(e) => (setRunFilter(e.target.value), setPage(0))}
          >
            <option value="">Todas</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                #{r.id} · {seriesLabel(r.seriesKey)} · {formatHM(r.startedAt)}
              </option>
            ))}
          </select>
        </div>
        <p className="ml-auto font-mono text-[13px] text-ink-soft">{rows.length} muestras</p>
      </div>

      <div className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Sesión</th>
              <th scope="col" className="num">Iteración</th>
              <th scope="col" className="num">Valor aproximado</th>
              <th scope="col" className="num">Valor real</th>
              <th scope="col" className="num">Error absoluto</th>
              <th scope="col" className="num">Error relativo (%)</th>
              <th scope="col" className="num">Hora</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const real = seriesByKey[s.seriesKey].realValue;
              const run = runById.get(s.runId);
              return (
                <tr key={s.id} className={fresh.has(s.id) ? 'flash' : undefined}>
                  <td className="whitespace-nowrap">
                    <span className="font-mono">#{s.runId}</span> <span className="text-ink-soft">{run ? seriesLabel(run.seriesKey) : ''}</span>
                  </td>
                  <td className="num">{s.iteration}</td>
                  <td className="num">
                    <Digits value={s.value} real={real} />
                  </td>
                  <td className="num">{fmt.realValue(real)}</td>
                  <td className="num">{fmt.errorAbs(s.errorAbs)}</td>
                  <td className="num">{fmt.errorRel(errorRelPct(s.value, real))}</td>
                  <td className="num">{formatTime(s.createdAt)}</td>
                </tr>
              );
            })}
            {!visible.length && (
              <tr>
                <td colSpan={7} className="py-6 text-ink-soft">
                  No hay muestras con estos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <nav aria-label="Paginación de muestras" className="mt-3 flex items-center gap-3 text-[13px]">
          <button type="button" className="btn btn-sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Más recientes
          </button>
          <span className="font-mono text-ink-soft">
            {current + 1} / {pages}
          </span>
          <button type="button" className="btn btn-sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Más antiguas
          </button>
        </nav>
      )}
    </div>
  );
}
