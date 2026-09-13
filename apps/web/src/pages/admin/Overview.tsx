import type { SeriesKey } from '@iot/shared';
import { startOfDay } from 'date-fns';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LiveSessionDialog } from '../../components/SessionDialog.tsx';
import { Elapsed, ErrorNote, LiveDot, PageHeader, SectionTitle } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { useLiveEvents } from '../../lib/live.tsx';
import { seriesLabel } from '../../lib/series-ui.ts';
import { formatTime } from '../../lib/time.ts';

interface Stats {
  clients: number;
  devices: number;
  runsToday: number;
  sendingNow: number;
  activeRuns: {
    runId: number;
    userId: number;
    userName: string;
    seriesKey: SeriesKey;
    startedAt: string;
    source: 'web' | 'device';
    deviceName: string | null;
    sampleCount: number;
  }[];
}

export function Overview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [watching, setWatching] = useState<Stats['activeRuns'][number] | null>(null);

  const load = useCallback(() => {
    api<Stats>(`/api/admin/stats?since=${startOfDay(new Date()).toISOString()}`)
      .then((s) => (setStats(s), setError('')))
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  useLiveEvents((m) => (m.type === 'run_start' || m.type === 'run_end') && load());

  const tiles = stats
    ? [
        { label: 'Clientes', value: stats.clients },
        { label: 'Dispositivos vinculados', value: stats.devices },
        { label: 'Sesiones hoy', value: stats.runsToday },
        { label: 'Enviando ahora', value: stats.sendingNow, live: stats.sendingNow > 0 },
      ]
    : [];

  return (
    <>
      <PageHeader title="Panel general" />
      <ErrorNote>{error}</ErrorNote>
      {stats && (
        <>
          <dl className="panel mb-8 grid grid-cols-2 min-[900px]:grid-cols-4">
            {tiles.map((t, i) => (
              <div key={t.label} className={`px-5 py-4 ${i > 0 ? 'min-[900px]:border-l' : ''} ${i % 2 ? 'border-l' : ''} ${i > 1 ? 'max-[899px]:border-t' : ''} border-grid`}>
                <dt className="flex items-center gap-2 text-[13px] text-ink-soft">
                  {t.live && <LiveDot />}
                  {t.label}
                </dt>
                <dd className="font-mono text-[32px] leading-tight">{t.value}</dd>
              </div>
            ))}
          </dl>

          <SectionTitle>Enviando ahora</SectionTitle>
          {stats.activeRuns.length === 0 ? (
            <p className="panel px-4 py-6 text-ink-soft">Ningún cliente está enviando ahora.</p>
          ) : (
            <div className="panel overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Cliente</th>
                    <th scope="col">Serie</th>
                    <th scope="col">Origen</th>
                    <th scope="col" className="num">Inicio</th>
                    <th scope="col" className="num">Transcurrido</th>
                    <th scope="col">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.activeRuns.map((r) => (
                    <tr key={r.runId}>
                      <td>
                        <LiveDot />{' '}
                        <Link to={`/admin/usuarios/${r.userId}`} className="underline decoration-grid underline-offset-2 hover:decoration-ink">
                          {r.userName}
                        </Link>
                      </td>
                      <td>{seriesLabel(r.seriesKey)}</td>
                      <td>{r.source === 'device' ? `ESP32 · ${r.deviceName ?? ''}` : 'Simulador web'}</td>
                      <td className="num">{formatTime(r.startedAt)}</td>
                      <td className="num">
                        <Elapsed from={r.startedAt} />
                      </td>
                      <td className="text-right">
                        <button type="button" className="btn btn-sm" onClick={() => setWatching(r)}>
                          Ver en vivo
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {watching && (
        <LiveSessionDialog userId={watching.userId} runId={watching.runId} userName={watching.userName} onClose={() => setWatching(null)} />
      )}
    </>
  );
}
