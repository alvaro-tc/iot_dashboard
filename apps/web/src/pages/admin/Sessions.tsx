import { SERIES } from '@iot/shared';
import { useCallback, useEffect, useState } from 'react';
import { RunsTable } from '../../components/RunsTable.tsx';
import { ErrorNote, PageHeader } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { useLiveEvents } from '../../lib/live.tsx';
import { localDate } from '../../lib/time.ts';
import type { AdminUserRow, Run } from '../../lib/types.ts';

export function Sessions() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [clients, setClients] = useState<AdminUserRow[]>([]);
  const [error, setError] = useState('');
  const [f, setF] = useState({ userId: '', seriesKey: '', status: '', from: '', to: '' });

  useEffect(() => {
    api<AdminUserRow[]>('/api/admin/users')
      .then((u) => setClients(u.filter((x) => x.role === 'client')))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (f.userId) q.set('userId', f.userId);
    if (f.seriesKey) q.set('seriesKey', f.seriesKey);
    if (f.status) q.set('status', f.status);
    if (f.from) q.set('from', localDate(f.from).toISOString());
    if (f.to) q.set('to', new Date(localDate(f.to).getTime() + 86_400_000).toISOString());
    api<Run[]>(`/api/admin/runs?${q}`)
      .then((r) => (setRuns(r), setError('')))
      .catch((e) => setError(errorMessage(e)));
  }, [f]);
  useEffect(load, [load]);
  useLiveEvents((m) => (m.type === 'run_start' || m.type === 'run_end') && load());

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <>
      <PageHeader title="Sesiones" subtitle="Todas las sesiones de todos los clientes." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="s-user">Cliente</label>
          <select id="s-user" className="input w-52" value={f.userId} onChange={set('userId')}>
            <option value="">Todos</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="s-series">Serie</label>
          <select id="s-series" className="input w-56" value={f.seriesKey} onChange={set('seriesKey')}>
            <option value="">Todas</option>
            {SERIES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="s-status">Estado</label>
          <select id="s-status" className="input w-40" value={f.status} onChange={set('status')}>
            <option value="">Todos</option>
            <option value="active">En curso</option>
            <option value="finished">Finalizada</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="s-from">Desde</label>
          <input id="s-from" type="date" className="input font-mono" value={f.from} onChange={set('from')} />
        </div>
        <div>
          <label className="label" htmlFor="s-to">Hasta</label>
          <input id="s-to" type="date" className="input font-mono" value={f.to} onChange={set('to')} />
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {runs && <RunsTable runs={runs} numeric showUser emptyText="No hay sesiones con estos filtros." />}
    </>
  );
}
