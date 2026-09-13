import { useCallback, useEffect, useState } from 'react';
import { RunsTable } from '../../components/RunsTable.tsx';
import { Timeline } from '../../components/Timeline.tsx';
import { Elapsed, ErrorNote, LiveDot, PageHeader, SectionTitle } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { useLive, useLiveEvents } from '../../lib/live.tsx';
import { seriesLabel } from '../../lib/series-ui.ts';
import { formatTime } from '../../lib/time.ts';
import type { ClientStatus, Run } from '../../lib/types.ts';

/** Historial del cliente. La API no le envía valores, errores ni iteraciones. */
export function MyRuns() {
  const { connectionId } = useLive();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [status, setStatus] = useState<ClientStatus | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([api<Run[]>('/api/client/runs'), api<ClientStatus>('/api/client/status')])
      .then(([r, s]) => (setRuns(r), setStatus(s), setError('')))
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load, connectionId]); // recarga al reconectar
  useLiveEvents((m) => m.type !== 'hello' && load());

  const active = status?.activeRun;

  return (
    <>
      <PageHeader title="Mis envíos" right={active ? <LiveDot label="enviando" /> : <span className="text-ink-soft">sin envío activo</span>} />
      <ErrorNote>{error}</ErrorNote>

      {active && (
        <section className="panel mb-8 flex flex-wrap items-center gap-x-10 gap-y-3 border-l-2 border-l-signal px-5 py-4" aria-label="Sesión en curso">
          <div>
            <p className="text-[13px] text-ink-soft">
              <LiveDot label="En curso" />
            </p>
            <p className="text-[24px] leading-tight">{seriesLabel(active.seriesKey)}</p>
          </div>
          <div>
            <p className="text-[13px] text-ink-soft">Inicio</p>
            <p className="font-mono text-[18px]">{formatTime(active.startedAt)}</p>
          </div>
          <div>
            <p className="text-[13px] text-ink-soft">Transcurrido</p>
            <p className="text-[24px] leading-tight">
              <Elapsed from={active.startedAt} />
            </p>
          </div>
          <div>
            <p className="text-[13px] text-ink-soft">Origen</p>
            <p>{active.source === 'device' ? `ESP32 · ${active.deviceName ?? ''}` : 'Simulador web'}</p>
          </div>
        </section>
      )}

      {runs && (
        <>
          <section className="mb-8">
            <SectionTitle>Línea de tiempo</SectionTitle>
            <Timeline runs={runs} />
          </section>
          <section>
            <SectionTitle>Historial</SectionTitle>
            <RunsTable
              runs={runs}
              numeric={false}
              emptyText={status?.hasDevice ? 'Tu ESP32 aún no ha enviado datos.' : 'Aún no has enviado datos. Vincula un ESP32 o usa el simulador.'}
            />
          </section>
        </>
      )}
    </>
  );
}
