// /admin/usuarios — alta, edición, reseteo de contraseña y baja de cuentas.
import { useState } from 'react';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api, errorMessage } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { haceCuanto } from '../../lib/formato.ts';
import { useToast } from '../../lib/toast.tsx';
import type { AdminUserRow } from '../../lib/types.ts';
import { Badge, Esqueleto, Interruptor, Tarjeta } from '../../components/ui.tsx';

function DialogoNuevoUsuario({ onCerrar }: { onCerrar: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'client' });
  const [errores, setErrores] = useState<Record<string, string>>({});

  const crear = useMutation({
    mutationFn: () => api('/api/admin/users', { method: 'POST', body: form }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
      toast('Usuario creado.');
      onCerrar();
    },
    onError: (e) => {
      if (e instanceof ApiError && Object.keys(e.fields).length) setErrores(e.fields);
      else toast(errorMessage(e), 'error');
    },
  });

  const campo = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={onCerrar}>
      <form
        className="tarjeta w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          setErrores({});
          crear.mutate();
        }}
      >
        <h2 className="tarjeta-titulo mb-4">Nuevo usuario</h2>
        {(['name', 'email', 'password'] as const).map((k) => (
          <div key={k} className={k === 'name' ? '' : 'mt-4'}>
            <label className="etiqueta" htmlFor={`nu-${k}`}>
              {k === 'name' ? 'Nombre' : k === 'email' ? 'Correo' : 'Contraseña'}
            </label>
            <input
              id={`nu-${k}`}
              type={k === 'password' ? 'password' : k === 'email' ? 'email' : 'text'}
              className="campo"
              value={form[k]}
              onChange={campo(k)}
              aria-invalid={!!errores[k]}
            />
            {errores[k] && <p className="error-campo">{errores[k]}</p>}
          </div>
        ))}
        <label className="etiqueta mt-4" htmlFor="nu-role">
          Rol
        </label>
        <select id="nu-role" className="campo cursor-pointer" value={form.role} onChange={campo('role')}>
          <option value="client">Cliente</option>
          <option value="admin">Administrador</option>
        </select>
        <div className="mt-6 flex gap-2">
          <button type="button" className="btn flex-1" onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-acento flex-1" disabled={crear.isPending}>
            Crear
          </button>
        </div>
      </form>
    </div>
  );
}

export function Usuarios() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [nuevo, setNuevo] = useState(false);

  const { data, isLoading } = useQuery<AdminUserRow[]>({
    queryKey: ['admin-users'],
    queryFn: () => api('/api/admin/users'),
  });

  const refrescar = () => void qc.invalidateQueries({ queryKey: ['admin-users'] });

  const actualizar = useMutation({
    mutationFn: ({ id, cambio }: { id: number; cambio: Record<string, unknown> }) =>
      api(`/api/admin/users/${id}`, { method: 'PATCH', body: cambio }),
    onSuccess: refrescar,
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const resetear = useMutation({
    mutationFn: (id: number) => api<{ password: string }>(`/api/admin/users/${id}/password`, { method: 'POST' }),
    onSuccess: (r) => toast(`Contraseña nueva: ${r.password} — cópiala, solo se muestra ahora.`),
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const borrar = useMutation({
    mutationFn: (id: number) => api(`/api/admin/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refrescar();
      toast('Usuario eliminado.');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (isLoading) return <Esqueleto className="h-80" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" className="btn btn-acento" onClick={() => setNuevo(true)}>
          <Plus className="size-4" />
          Nuevo usuario
        </button>
      </div>

      <Tarjeta titulo="Usuarios" subtitulo={`${data?.length ?? 0} cuentas`}>
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Rol</th>
                <th className="num">Robots</th>
                <th className="num">Sesiones</th>
                <th>Última actividad</th>
                <th>Activo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((u) => (
                <tr key={u.id} className={u.isActive ? '' : 'opacity-55'}>
                  <td className="font-medium">{u.name}</td>
                  <td>{u.email}</td>
                  <td>
                    <Badge tono={u.role === 'admin' ? 'alerta' : 'neutro'}>
                      {u.role === 'admin' ? 'Administrador' : 'Cliente'}
                    </Badge>
                  </td>
                  <td className="num">{u.robots}</td>
                  <td className="num">{u.sesiones}</td>
                  <td className="whitespace-nowrap">{haceCuanto(u.ultimaActividad)}</td>
                  <td>
                    <Interruptor
                      activo={u.isActive}
                      etiqueta={`Cuenta activa de ${u.name}`}
                      disabled={u.id === user!.id || actualizar.isPending}
                      onCambiar={(v) => actualizar.mutate({ id: u.id, cambio: { isActive: v } })}
                    />
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="btn btn-sm btn-fantasma"
                        aria-label={`Resetear la contraseña de ${u.name}`}
                        title="Resetear contraseña"
                        onClick={() => resetear.mutate(u.id)}
                      >
                        <KeyRound className="size-4" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-fantasma text-evasion"
                        aria-label={`Eliminar a ${u.name}`}
                        title="Eliminar"
                        disabled={u.id === user!.id}
                        onClick={() => {
                          if (confirm(`¿Eliminar a ${u.name}? Se borran sus robots y todo su historial.`)) {
                            borrar.mutate(u.id);
                          }
                        }}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      {nuevo && <DialogoNuevoUsuario onCerrar={() => setNuevo(false)} />}
    </div>
  );
}
