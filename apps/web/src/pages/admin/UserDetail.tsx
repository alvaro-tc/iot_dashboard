import { SERIES } from '@iot/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RunsTable } from '../../components/RunsTable.tsx';
import { SessionDialog } from '../../components/SessionDialog.tsx';
import { Timeline } from '../../components/Timeline.tsx';
import { ErrorNote, LiveDot, PageHeader, SectionTitle } from '../../components/ui.tsx';
import { useLiveSamples } from '../../hooks/useLiveSamples.ts';
import { api, errorMessage } from '../../lib/api.ts';
import { seriesLabel } from '../../lib/series-ui.ts';
import { localDate } from '../../lib/time.ts';
import type { User } from '../../lib/types.ts';

export function UserDetail() {
  const id = Number(useParams().id);
  const [user, setUser] = useState<User | null>(null);
  const [userError, setUserError] = useState('');
  const live = useLiveSamples(id);

  const [view, setView] = useState<'table' | 'timeline'>('table');
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [filters, setFilters] = useState({ from: '', to: '', seriesKey: '' });

  useEffect(() => {
    api<User>(`/api/admin/users/${id}`)
      .then(setUser)
      .catch((e) => setUserError(errorMessage(e)));
  }, [id]);

  const visibleRuns = useMemo(() => {
    const from = filters.from ? localDate(filters.from).getTime() : -Infinity;
    const to = filters.to ? localDate(filters.to).getTime() + 86_400_000 : Infinity;
    return live.runs.filter((r) => {
      const start = new Date(r.startedAt).getTime();
      const end = r.endedAt ? new Date(r.endedAt).getTime() : Date.now();
      return (!filters.seriesKey || r.seriesKey === filters.seriesKey) && end >= from && start < to;
    });
  }, [live.runs, filters]);

  const activeRun = live.runs.find((r) => r.status === 'active');
  const selectedRun = live.runs.find((r) => r.id === selectedRunId);
  const selectedSamples = useMemo(
    () => (selectedRun ? live.samples[selectedRun.seriesKey].filter((s) => s.runId === selectedRun.id) : []),
    [live.samples, selectedRun?.id, selectedRun?.seriesKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <>
      <p className="mb-2 text-[13px]">
        <Link to="/admin/usuarios" className="text-ink-soft hover:text-ink">
          ← Usuarios
        </Link>
      </p>
      <PageHeader
        title={user?.name ?? 'Cliente'}
        subtitle={user?.email}
        right={
          activeRun ? (
            <button type="button" className="btn btn-sm" onClick={() => setSelectedRunId(activeRun.id)}>
              <LiveDot label={`enviando · ${seriesLabel(activeRun.seriesKey)}`} />
            </button>
          ) : (
            <span className="text-ink-soft">sin envío activo</span>
          )
        }
      />
      <ErrorNote>{userError || live.error}</ErrorNote>

      <section aria-labelledby="historial">
        <SectionTitle
          id="historial"
          right={
            <div role="group" aria-label="Vista del historial" className="flex">
              <button type="button" className="seg" aria-pressed={view === 'table'} onClick={() => setView('table')}>
                Tabla
              </button>
              <button type="button" className="seg" aria-pressed={view === 'timeline'} onClick={() => setView('timeline')}>
                Línea de tiempo
              </button>
            </div>
          }
        >
          Historial de sesiones
        </SectionTitle>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="f-from">Desde</label>
            <input id="f-from" type="date" className="input font-mono" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="f-to">Hasta</label>
            <input id="f-to" type="date" className="input font-mono" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="f-series">Serie</label>
            <select id="f-series" className="input w-56" value={filters.seriesKey} onChange={(e) => setFilters({ ...filters, seriesKey: e.target.value })}>
              <option value="">Todas</option>
              {SERIES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
          {(filters.from || filters.to || filters.seriesKey) && (
            <button type="button" className="btn btn-ghost" onClick={() => setFilters({ from: '', to: '', seriesKey: '' })}>
              Quitar filtros
            </button>
          )}
          <p className="ml-auto text-[13px] text-ink-soft">Haz clic en una sesión para ver su gráfica y sus muestras.</p>
        </div>
        {live.loading && !live.runs.length ? (
          <p className="text-ink-soft">Cargando historial…</p>
        ) : view === 'table' ? (
          <RunsTable
            runs={visibleRuns}
            numeric
            selectedRunId={selectedRunId}
            onSelect={setSelectedRunId}
            emptyText="Este cliente aún no ha enviado datos en este rango."
          />
        ) : (
          <Timeline runs={visibleRuns} selectedRunId={selectedRunId} onSelect={setSelectedRunId} />
        )}
      </section>

      <SessionDialog
        run={selectedRun}
        samples={selectedSamples}
        fresh={live.fresh}
        userName={user?.name ?? ''}
        onClose={() => setSelectedRunId(null)}
      />
    </>
  );
}
