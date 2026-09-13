import { fmt, seriesByKey } from '@iot/shared';
import { Fragment, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { seriesLabel } from '../lib/series-ui.ts';
import { dayKey, formatDayLabel, formatTime } from '../lib/time.ts';
import type { Run } from '../lib/types.ts';
import { Digits, Elapsed, LiveDot } from './ui.tsx';

/**
 * Historial de sesiones agrupado por día, con las activas arriba.
 * `numeric = false` es la versión del cliente: sin iteraciones, valor ni error.
 */
export function RunsTable({
  runs,
  numeric,
  showUser,
  selectedRunId,
  onSelect,
  emptyText = 'No hay sesiones en este rango.',
}: {
  runs: Run[];
  numeric: boolean;
  showUser?: boolean;
  selectedRunId?: number | null;
  onSelect?: (id: number | null) => void;
  emptyText?: string;
}) {
  const groups = useMemo(() => {
    const out: { key: string; label: string; runs: Run[] }[] = [];
    const active = runs.filter((r) => r.status === 'active');
    if (active.length) out.push({ key: 'active', label: 'En curso', runs: active });
    for (const r of runs) {
      if (r.status === 'active') continue;
      const k = dayKey(r.startedAt);
      let g = out.find((x) => x.key === k);
      if (!g) out.push((g = { key: k, label: formatDayLabel(r.startedAt), runs: [] }));
      g.runs.push(r);
    }
    return out;
  }, [runs]);

  const cols = 5 + (numeric ? 4 : 0) + (showUser ? 1 : 0);

  if (!runs.length) return <p className="panel px-4 py-6 text-ink-soft">{emptyText}</p>;

  return (
    <div className="panel overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            {showUser && <th scope="col">Cliente</th>}
            <th scope="col">Serie</th>
            {numeric && <th scope="col">Origen</th>}
            <th scope="col" className="num">Inicio</th>
            <th scope="col" className="num">Fin</th>
            <th scope="col" className="num">Duración</th>
            {numeric && (
              <>
                <th scope="col" className="num">Iteraciones</th>
                <th scope="col" className="num">Valor final</th>
                <th scope="col" className="num">Error final</th>
              </>
            )}
            <th scope="col">Estado</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.key}>
              <tr>
                <th colSpan={cols} scope="colgroup" className="bg-paper text-ink">
                  {g.label}
                </th>
              </tr>
              {g.runs.map((r) => {
                const selected = selectedRunId === r.id;
                return (
                  <tr key={r.id} aria-selected={onSelect ? selected : undefined} className={selected ? 'bg-paper' : undefined}>
                    {showUser && (
                      <td>
                        <Link to={`/admin/usuarios/${r.userId}`} className="underline decoration-grid underline-offset-2 hover:decoration-ink">
                          {r.userName}
                        </Link>
                      </td>
                    )}
                    <td>
                      {onSelect ? (
                        <button
                          type="button"
                          className={`cursor-pointer text-left underline-offset-2 hover:underline ${selected ? 'font-medium' : ''}`}
                          onClick={() => onSelect(selected ? null : r.id)}
                          aria-pressed={selected}
                        >
                          {seriesLabel(r.seriesKey)}
                        </button>
                      ) : (
                        seriesLabel(r.seriesKey)
                      )}
                    </td>
                    {numeric && (
                      <td className="whitespace-nowrap">
                        {r.source === 'device' ? (
                          <>
                            ESP32 · <span>{r.deviceName ?? 'dispositivo eliminado'}</span>
                          </>
                        ) : (
                          'Simulador web'
                        )}
                      </td>
                    )}
                    <td className="num">{formatTime(r.startedAt)}</td>
                    <td className="num">{r.endedAt ? formatTime(r.endedAt) : '—'}</td>
                    <td className="num">
                      <Elapsed from={r.startedAt} to={r.endedAt} />
                    </td>
                    {numeric && (
                      <>
                        <td className="num">{r.lastIteration ?? 0}</td>
                        <td className="num">
                          {r.lastValue != null ? <Digits value={r.lastValue} real={seriesByKey[r.seriesKey].realValue} /> : '—'}
                        </td>
                        <td className="num">{r.lastErrorAbs != null ? fmt.errorAbs(r.lastErrorAbs) : '—'}</td>
                      </>
                    )}
                    <td className="whitespace-nowrap">
                      {r.status === 'active' ? <LiveDot label="en curso" /> : <span className="text-ink-soft">finalizada</span>}
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
