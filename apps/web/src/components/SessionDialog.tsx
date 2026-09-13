import { seriesByKey } from '@iot/shared';
import { useMemo } from 'react';
import { useLiveSamples } from '../hooks/useLiveSamples.ts';
import { downloadCsv } from '../lib/csv.ts';
import { seriesLabel } from '../lib/series-ui.ts';
import { formatDateTime } from '../lib/time.ts';
import type { Run, Sample } from '../lib/types.ts';
import { SamplesTable } from './SamplesTable.tsx';
import { SeriesChart } from './SeriesChart.tsx';
import { Dialog, Elapsed, ErrorNote, LiveDot } from './ui.tsx';

/** Modal de una sesión: datos arriba, su única gráfica a la izquierda y sus muestras a la derecha. */
export function SessionDialog({
  run,
  samples,
  fresh,
  userName,
  onClose,
}: {
  run: Run | undefined;
  samples: Sample[];
  fresh: Set<number>;
  userName: string;
  onClose: () => void;
}) {
  const facts = run && [
    ['Cliente', userName],
    ['Serie', seriesLabel(run.seriesKey)],
    ['Origen', run.source === 'device' ? `ESP32 · ${run.deviceName ?? 'dispositivo eliminado'}` : 'Simulador web'],
    ['Inicio', <span className="font-mono">{formatDateTime(run.startedAt)}</span>],
    ['Fin', run.endedAt ? <span className="font-mono">{formatDateTime(run.endedAt)}</span> : '—'],
    ['Duración', <Elapsed from={run.startedAt} to={run.endedAt} />],
    ['Iteraciones', <span className="font-mono">{samples.length ? samples.at(-1)!.iteration : (run.lastIteration ?? 0)}</span>],
    ['Estado', run.status === 'active' ? <LiveDot label="en vivo" /> : <span className="text-ink-soft">finalizada</span>],
  ];

  return (
    <Dialog open={!!run} onClose={onClose} title={run ? `Sesión #${run.id}` : ''} xl>
      {run && (
        <>
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              className="btn btn-sm"
              disabled={!samples.length}
              onClick={() =>
                downloadCsv(
                  `sesion-${run.id}-${run.seriesKey}.csv`,
                  ['iteracion', 'valor', 'error_absoluto', 'fecha'],
                  samples.map((s) => [s.iteration, s.value, s.errorAbs, formatDateTime(s.createdAt)]),
                )
              }
            >
              Exportar CSV
            </button>
          </div>
          <dl className="panel mb-4 grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 text-[13px] min-[900px]:grid-cols-4">
            {facts!.map(([label, value]) => (
              <div key={label as string}>
                <dt className="text-ink-soft">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="grid grid-cols-1 gap-4 min-[1000px]:grid-cols-[3fr_2fr]">
            <SeriesChart series={seriesByKey[run.seriesKey]} samples={samples} chartClass="h-[440px]" />
            <SamplesTable samples={samples} runs={[run]} selectedRunId={run.id} fresh={fresh} compact />
          </div>
        </>
      )}
    </Dialog>
  );
}

/** Igual, pero carga los datos en vivo del cliente (para el panel general). */
export function LiveSessionDialog({ userId, runId, userName, onClose }: { userId: number; runId: number; userName: string; onClose: () => void }) {
  const live = useLiveSamples(userId);
  const run = live.runs.find((r) => r.id === runId);
  const samples = useMemo(() => (run ? live.samples[run.seriesKey].filter((s) => s.runId === runId) : []), [live.samples, run?.seriesKey, runId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {live.error && <ErrorNote>{live.error}</ErrorNote>}
      <SessionDialog run={run} samples={samples} fresh={live.fresh} userName={userName} onClose={onClose} />
    </>
  );
}
