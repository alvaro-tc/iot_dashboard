import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, errorMessage } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { formatDateTime } from '../lib/time.ts';
import { useToast } from '../lib/toast.tsx';
import type { AdminUserRow, Device, Role } from '../lib/types.ts';
import { CopyButton, ErrorNote, Field } from './ui.tsx';

type Destructive = 'data' | 'delete' | null;

export function UserManageDialog({ user, onChanged, onClose }: { user: AdminUserRow; onChanged: () => void; onClose: () => void }) {
  const { user: me } = useAuth();
  const toast = useToast();
  const isSelf = me!.id === user.id;

  const [form, setForm] = useState({ name: user.name, email: user.email, role: user.role as Role });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState('');
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [destructive, setDestructive] = useState<Destructive>(null);
  const [confirmName, setConfirmName] = useState('');

  const loadDevices = () =>
    api<Device[]>(`/api/admin/users/${user.id}/devices`)
      .then(setDevices)
      .catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    loadDevices();
  }, [user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setFieldErrors({});
    try {
      await action();
    } catch (e) {
      if (e instanceof ApiError) setFieldErrors(e.fields);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: form });
      toast('Cambios guardados');
      onChanged();
    });
  };

  const toggleActive = () =>
    run(async () => {
      await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { isActive: !user.isActive } });
      toast(user.isActive ? 'Usuario desactivado' : 'Usuario activado');
      onChanged();
    });

  const resetPassword = () =>
    run(async () => {
      const r = await api<{ password: string }>(`/api/admin/users/${user.id}/password`, { method: 'POST' });
      setTempPassword(r.password);
    });

  const revoke = (id: string) =>
    run(async () => {
      await api(`/api/admin/devices/${id}`, { method: 'DELETE' });
      toast('Dispositivo revocado');
      setRevoking(null);
      await loadDevices();
      onChanged();
    });

  const confirmDestructive = () =>
    run(async () => {
      if (destructive === 'data') {
        await api(`/api/admin/users/${user.id}/data`, { method: 'DELETE' });
        toast('Datos borrados');
        setDestructive(null);
        setConfirmName('');
        onChanged();
      } else {
        await api(`/api/admin/users/${user.id}`, { method: 'DELETE' });
        toast('Usuario eliminado');
        onChanged();
        onClose();
      }
    });

  return (
    <div className="flex flex-col gap-6">
      <ErrorNote>{error && !Object.keys(fieldErrors).length ? error : ''}</ErrorNote>

      <form onSubmit={save} className="flex flex-col gap-3" noValidate>
        <h3 className="text-[15px] font-medium">Editar</h3>
        <Field label="Nombre" error={fieldErrors.name}>
          {(p) => <input {...p} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
        </Field>
        <Field label="Correo" error={fieldErrors.email}>
          {(p) => <input {...p} type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
        </Field>
        <Field label="Rol" error={fieldErrors.role} hint={isSelf ? 'No puedes quitarte el rol de administrador.' : undefined}>
          {(p) => (
            <select {...p} className="input" value={form.role} disabled={isSelf} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="client">Cliente</option>
              <option value="admin">Administrador</option>
            </select>
          )}
        </Field>
        <div>
          <button className="btn btn-primary" disabled={busy}>
            Guardar cambios
          </button>
        </div>
      </form>

      <section className="flex flex-col gap-2 border-t border-grid pt-4">
        <h3 className="text-[15px] font-medium">Estado</h3>
        <p className="text-[13px] text-ink-soft">
          {user.isActive
            ? 'Activo. Si lo desactivas no podrá iniciar sesión ni publicar datos; su historial se conserva.'
            : 'Desactivado. No puede iniciar sesión ni publicar datos.'}
        </p>
        <div>
          <button type="button" className="btn" disabled={busy || isSelf} onClick={toggleActive}>
            {user.isActive ? 'Desactivar usuario' : 'Activar usuario'}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-2 border-t border-grid pt-4">
        <h3 className="text-[15px] font-medium">Contraseña</h3>
        {tempPassword ? (
          <div className="border-l-2 border-ink bg-paper px-3 py-2 text-[13px]">
            <p className="mb-2">Contraseña temporal. Cópiala ahora: no se volverá a mostrar.</p>
            <div className="flex items-center gap-3">
              <code className="font-mono text-[15px]">{tempPassword}</code>
              <CopyButton text={tempPassword} />
            </div>
          </div>
        ) : (
          <div>
            <button type="button" className="btn" disabled={busy} onClick={resetPassword}>
              Restablecer contraseña
            </button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-grid pt-4">
        <h3 className="text-[15px] font-medium">Dispositivos</h3>
        {devices === null ? (
          <p className="text-[13px] text-ink-soft">Cargando…</p>
        ) : devices.length === 0 ? (
          <p className="text-[13px] text-ink-soft">Este usuario no ha vinculado ningún dispositivo.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Alias</th>
                <th scope="col">Identificador</th>
                <th scope="col" className="num">Última vez visto</th>
                <th scope="col">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td className="font-mono">{d.id}</td>
                  <td className="num">{d.lastSeenAt ? formatDateTime(d.lastSeenAt) : '—'}</td>
                  <td className="text-right whitespace-nowrap">
                    {d.isRevoked ? (
                      <span className="text-ink-soft">revocado</span>
                    ) : revoking === d.id ? (
                      <span className="inline-flex gap-2">
                        <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => revoke(d.id)}>
                          Revocar
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => setRevoking(null)}>
                          Cancelar
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="btn btn-sm" onClick={() => setRevoking(d.id)}>
                        Revocar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-grid pt-4">
        <h3 className="text-[15px] font-medium text-deviation">Acciones destructivas</h3>
        {!destructive ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-danger" onClick={() => setDestructive('data')}>
              Borrar datos
            </button>
            <button type="button" className="btn btn-danger" disabled={isSelf} onClick={() => setDestructive('delete')}>
              Eliminar usuario
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 border-l-2 border-deviation pl-3">
            <p className="text-[13px]">
              {destructive === 'data'
                ? 'Se borrarán todas sus sesiones y muestras. La cuenta y sus dispositivos se conservan.'
                : 'Se eliminará la cuenta con sus dispositivos, sesiones y muestras. No se puede deshacer.'}{' '}
              Escribe <strong className="font-medium">{user.name}</strong> para confirmar.
            </p>
            <Field label="Nombre del usuario">
              {(p) => <input {...p} className="input" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />}
            </Field>
            <div className="flex gap-2">
              <button type="button" className="btn btn-danger" disabled={busy || confirmName !== user.name} onClick={confirmDestructive}>
                {destructive === 'data' ? 'Borrar datos' : 'Eliminar usuario'}
              </button>
              <button type="button" className="btn" onClick={() => (setDestructive(null), setConfirmName(''))}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
