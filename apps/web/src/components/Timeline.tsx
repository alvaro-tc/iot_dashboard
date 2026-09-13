import { useMemo, useState } from 'react';
import { SERIES_COLORS, seriesLabel } from '../lib/series-ui.ts';
import { dayKey, formatDayLabel, formatDuration, formatHM, minutesOfDay, useNow } from '../lib/time.ts';
import type { Run } from '../lib/types.ts';

const TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

/** Un carril por día, de 00:00 a 24:00, con un bloque por sesión. Sin valores numéricos. */
export function Timeline({
  runs,
  selectedRunId,
  onSelect,
}: {
  runs: Run[];
  selectedRunId?: number | null;
  onSelect?: (id: number | null) => void;
}) {
  const hasActive = runs.some((r) => r.status === 'active');
  const now = useNow(5000, hasActive);
  const [hover, setHover] = useState<{ run: Run; left: number } | null>(null);

  const days = useMemo(() => {
    const map = new Map<string, Run[]>();
    for (const r of runs) {
      const k = dayKey(r.startedAt);
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return [...map].sort((a, b) => b[0].localeCompare(a[0]));
  }, [runs]);

  if (!runs.length) return <p className="panel px-4 py-6 text-ink-soft">No hay sesiones en este rango.</p>;

  return (
    <div className="panel px-4 py-3">
      {days.map(([key, dayRuns]) => (
        <div key={key} className="py-2">
          <p className="mb-1 text-[13px] text-ink-soft">{formatDayLabel(dayRuns[0].startedAt)}</p>
          <div className="relative h-8 border border-grid bg-paper/50">
            {TICKS.slice(1, -1).map((h) => (
              <span key={h} className="absolute inset-y-0 w-px bg-grid" style={{ left: `${(h / 24) * 100}%` }} aria-hidden />
            ))}
            {dayRuns.map((r) => {
              const start = new Date(r.startedAt);
              const end = r.endedAt ? new Date(r.endedAt) : new Date(now);
              const startMin = minutesOfDay(start);
              const endMin = dayKey(end) === key ? minutesOfDay(end) : 1440;
              const left = (startMin / 1440) * 100;
              const width = Math.max(((endMin - startMin) / 1440) * 100, 0.3);
              const selected = selectedRunId === r.id;
              const label = `${seriesLabel(r.seriesKey)}, ${formatHM(start)} a ${r.endedAt ? formatHM(end) : 'ahora'}`;
              return (
                <button
                  key={r.id}
                  type="button"
                  aria-label={label}
                  aria-pressed={selected}
                  onClick={() => onSelect?.(selected ? null : r.id)}
                  onMouseEnter={() => setHover({ run: r, left })}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover({ run: r, left })}
                  onBlur={() => setHover(null)}
                  className={`absolute top-1 bottom-1 cursor-pointer ${selected ? 'outline-2 outline-offset-1 outline-ink' : ''} ${r.status === 'active' ? 'border-r-2 border-signal' : ''}`}
                  style={{ left: `${left}%`, width: `${width}%`, background: SERIES_COLORS[r.seriesKey] }}
                />
              );
            })}
            {hover && dayKey(hover.run.startedAt) === key && (
              <div
                role="tooltip"
                className="pointer-events-none absolute top-full z-10 mt-1 w-max border border-grid bg-surface px-3 py-2 text-[13px] shadow-none"
                style={{ left: `min(${hover.left}%, calc(100% - 220px))` }}
              >
                <p className="font-medium">{seriesLabel(hover.run.seriesKey)}</p>
                <p className="font-mono text-ink-soft">
                  {formatHM(hover.run.startedAt)}–{hover.run.endedAt ? formatHM(hover.run.endedAt) : 'ahora'} ·{' '}
                  {formatDuration((hover.run.endedAt ? new Date(hover.run.endedAt).getTime() : now) - new Date(hover.run.startedAt).getTime())}
                </p>
                <p className="text-ink-soft">
                  {hover.run.source === 'device' ? `ESP32 · ${hover.run.deviceName ?? 'dispositivo eliminado'}` : 'Simulador web'}
                </p>
              </div>
            )}
          </div>
          <div className="relative mt-0.5 h-4 font-mono text-[11px] text-ink-soft" aria-hidden>
            {TICKS.map((h) => (
              <span
                key={h}
                className="absolute"
                style={{ left: `${(h / 24) * 100}%`, transform: h === 0 ? 'none' : h === 24 ? 'translateX(-100%)' : 'translateX(-50%)' }}
              >
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>
        </div>
      ))}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-grid pt-2 text-[13px] text-ink-soft">
        {[...new Set(runs.map((r) => r.seriesKey))].map((k) => (
          <li key={k} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5" style={{ background: SERIES_COLORS[k] }} aria-hidden />
            {seriesLabel(k)}
          </li>
        ))}
      </ul>
    </div>
  );
}
