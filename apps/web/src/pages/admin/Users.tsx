import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { UserManageDialog } from '../../components/UserManageDialog.tsx';
import { Dialog, ErrorNote, Field, LiveDot, PageHeader } from '../../components/ui.tsx';
import { ApiError, api, errorMessage } from '../../lib/api.ts';
import { useLiveEvents } from '../../lib/live.tsx';
import { seriesLabel } from '../../lib/series-ui.ts';
import { formatDateTime } from '../../lib/time.ts';
import { useToast } from '../../lib/toast.tsx';
import type { AdminUserRow, Role } from '../../lib/types.ts';

function NewUserForm({ onCreated }: { onCreated: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'client' as Role });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFields({});
    setError('');
    try {
      await api('/api/admin/users', { method: 'POST', body: form });
      toast('Usuario creado');
      onCreated();
    } catch (err) {
      const apiErr = err as ApiError;
      setFields(apiErr.fields ?? {});
      if (!Object.keys(apiErr.fields ?? {}).length) setError(apiErr.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Field label="Nombre" error={fields.name}>
        {(p) => <input {...p} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />}
      </Field>
      <Field label="Correo" error={fields.email}>
        {(p) => <input {...p} type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
      </Field>
      <Field label="Contraseña" error={fields.password} hint="Mínimo 8 caracteres, con al menos una letra y un número.">
        {(p) => <input {...p} type="text" autoComplete="off" className="input font-mono" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
      </Field>
      <Field label="Rol" error={fields.role}>
        {(p) => (
          <select {...p} className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            <option value="client">Cliente</option>
            <option value="admin">Administrador</option>
          </select>
        )}
      </Field>
      <ErrorNote>{error}</ErrorNote>
      <div>
        <button className="btn btn-primary" disabled={busy}>
          Crear usuario
        </button>
      </div>
    </form>
  );
}

export function Users() {
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [managingId, setManagingId] = useState<number | null>(null);

  const load = useCallback(() => {
    api<AdminUserRow[]>('/api/admin/users')
      .then((u) => (setUsers(u), setError('')))
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  useLiveEvents((m) => (m.type === 'run_start' || m.type === 'run_end') && load());

  const managing = users?.find((u) => u.id === managingId) ?? null;

  return (
    <>
      <PageHeader
        title="Usuarios"
        right={
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            Nuevo usuario
          </button>
        }
      />
      <ErrorNote>{error}</ErrorNote>
      {users && (
        <div className="panel overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Nombre</th>
                <th scope="col">Correo</th>
                <th scope="col">Rol</th>
                <th scope="col">Estado</th>
                <th scope="col" className="num">Dispositivos</th>
                <th scope="col" className="num">Sesiones</th>
                <th scope="col" className="num">Última actividad</th>
                <th scope="col">Envío</th>
                <th scope="col">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="whitespace-nowrap">
                    {u.role === 'client' ? (
                      <Link to={`/admin/usuarios/${u.id}`} className="underline decoration-grid underline-offset-2 hover:decoration-ink">
                        {u.name}
                      </Link>
                    ) : (
                      u.name
                    )}
                  </td>
                  <td>{u.email}</td>
                  <td>{u.role === 'admin' ? 'Administrador' : 'Cliente'}</td>
                  <td>{u.isActive ? 'Activo' : <span className="text-deviation">Desactivado</span>}</td>
                  <td className="num">{u.deviceCount}</td>
                  <td className="num">{u.runCount}</td>
                  <td className="num">{u.lastActivity ? formatDateTime(u.lastActivity) : '—'}</td>
                  <td className="whitespace-nowrap">
                    {u.activeSeriesKey ? <LiveDot label={seriesLabel(u.activeSeriesKey)} /> : <span className="text-ink-soft">—</span>}
                  </td>
                  <td className="text-right">
                    <button type="button" className="btn btn-sm" onClick={() => setManagingId(u.id)}>
                      Gestionar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={creating} onClose={() => setCreating(false)} title="Nuevo usuario">
        <NewUserForm onCreated={() => (setCreating(false), load())} />
      </Dialog>
      <Dialog open={!!managing} onClose={() => setManagingId(null)} title={managing ? `Gestionar a ${managing.name}` : ''} wide>
        {managing && <UserManageDialog user={managing} onChanged={load} onClose={() => setManagingId(null)} />}
      </Dialog>
    </>
  );
}
