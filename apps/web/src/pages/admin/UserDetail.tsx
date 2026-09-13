import { SERIES } from '@iot/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RunsTable } from '../../components/RunsTable.tsx';
import { SamplesTable } from '../../components/SamplesTable.tsx';
import { SeriesChart } from '../../components/SeriesChart.tsx';
import { Timeline } from '../../components/Timeline.tsx';
import { ErrorNote, LiveDot, PageHeader, SectionTitle } from '../../components/ui.tsx';
import { useLiveSamples } from '../../hooks/useLiveSamples.ts';
import { api, errorMessage } from '../../lib/api.ts';
import { seriesLabel } from '../../lib/series-ui.ts';
import { localDate } from '../../lib/time.ts';
import type { Sample, User } from '../../lib/types.ts';

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

  // Clave estable: las sesiones cambian de objeto con cada muestra, pero el conjunto visible no.
  const visibleKey = visibleRuns.map((r) => r.id).join(',');
  const visibleIds = useMemo(() => new Set(visibleKey.split(',').filter(Boolean).map(Number)), [visibleKey]);

  const keep = (s: Sample) => (selectedRunId ? s.runId === selectedRunId : visibleIds.has(s.runId));
  const samplesBySeries = useMemo(
    () => Object.fromEntries(SERIES.map((s) => [s.key, live.samples[s.key].filter(keep)])) as Record<string, Sample[]>,
    [live.samples, visibleIds, selectedRunId], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const allSamples = useMemo(() => Object.values(samplesBySeries).flat(), [samplesBySeries]);

  useEffect(() => {
    if (selectedRunId && !visibleIds.has(selectedRunId)) setSelectedRunId(null);
  }, [visibleIds, selectedRunId]);

  const activeRun = live.runs.find((r) => r.status === 'active');
  const selectedRun = live.runs.find((r) => r.id === selectedRunId);

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
        right={activeRun ? <LiveDot label={`enviando · ${seriesLabel(activeRun.seriesKey)}`} /> : <span className="text-ink-soft">sin envío activo</span>}
      />
      <ErrorNote>{userError || live.error}</ErrorNote>

      <nav aria-label="Secciones" className="mb-6 flex gap-2 text-[13px]">
        <a href="#historial" className="btn btn-sm">Historial</a>
        <a href="#series" className="btn btn-sm">Series</a>
        <a href="#muestras" className="btn btn-sm">Muestras</a>
      </nav>

      {/* a) Historial */}
      <section aria-labelledby="historial" className="mb-10">
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
          {selectedRun && (
            <p className="ml-auto flex items-center gap-2 text-[13px]">
              Sesión <span className="font-mono">#{selectedRun.id}</span> · {seriesLabel(selectedRun.seriesKey)}
              <button type="button" className="btn btn-sm" onClick={() => setSelectedRunId(null)}>
                Quitar selección
              </button>
            </p>
          )}
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

      {/* b) Grid de 7 gráficos */}
      <section aria-labelledby="series" className="mb-10">
        <SectionTitle id="series">
          Series {selectedRun ? <span className="text-[13px] text-ink-soft">· solo la sesión #{selectedRun.id}</span> : null}
        </SectionTitle>
        <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-2 min-[1300px]:grid-cols-3">
          {SERIES.map((s) => (
            <SeriesChart key={s.key} series={s} samples={samplesBySeries[s.key]} />
          ))}
        </div>
      </section>

      {/* c) Tabla de muestras */}
      <section aria-labelledby="muestras">
        <SectionTitle id="muestras">Muestras</SectionTitle>
        <SamplesTable samples={allSamples} runs={visibleRuns} selectedRunId={selectedRunId} fresh={live.fresh} />
      </section>
    </>
  );
}
