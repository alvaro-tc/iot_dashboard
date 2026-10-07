// /perfil — nombre, contraseña y preferencia de tema.
import { useState } from 'react';
import { ApiError, api, errorMessage } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useTema } from '../lib/tema.tsx';
import { useToast } from '../lib/toast.tsx';
import type { User } from '../lib/types.ts';
import { Interruptor, Tarjeta } from '../components/ui.tsx';

export function Perfil() {
  const { user, setUser } = useAuth();
  const { tema, alternar } = useTema();
  const toast = useToast();

  const [nombre, setNombre] = useState(user!.name);
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrores({});
    setEnviando(true);
    try {
      const cuerpo: Record<string, string> = { name: nombre.trim() };
      if (nueva) {
        cuerpo.currentPassword = actual;
        cuerpo.newPassword = nueva;
      }
      const actualizado = await api<User>('/api/me', { method: 'PATCH', body: cuerpo });
      setUser(actualizado);
      setActual('');
      setNueva('');
      toast('Perfil actualizado.');
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrores(err.fields);
      else toast(errorMessage(err), 'error');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Tarjeta titulo="Mi cuenta" subtitulo={user!.email}>
        <form onSubmit={guardar} noValidate>
          <label className="etiqueta" htmlFor="perfil-nombre">
            Nombre
          </label>
          <input
            id="perfil-nombre"
            className="campo"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            aria-invalid={!!errores.name}
          />
          {errores.name && <p className="error-campo">{errores.name}</p>}

          <p className="mt-6 mb-2 text-[14px] font-semibold">Cambiar contraseña</p>

          <label className="etiqueta" htmlFor="perfil-actual">
            Contraseña actual
          </label>
          <input
            id="perfil-actual"
            type="password"
            autoComplete="current-password"
            className="campo"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            aria-invalid={!!errores.currentPassword}
          />
          {errores.currentPassword && <p className="error-campo">{errores.currentPassword}</p>}

          <label className="etiqueta mt-4" htmlFor="perfil-nueva">
            Contraseña nueva
          </label>
          <input
            id="perfil-nueva"
            type="password"
            autoComplete="new-password"
            className="campo"
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            aria-invalid={!!errores.newPassword}
          />
          {errores.newPassword && <p className="error-campo">{errores.newPassword}</p>}
          <p className="mt-1 text-[12px] text-tinta-suave">Déjala en blanco si no quieres cambiarla.</p>

          <button type="submit" className="btn btn-acento mt-6 w-full" disabled={enviando}>
            {enviando ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </form>
      </Tarjeta>

      <Tarjeta titulo="Preferencias" subtitulo="Se guardan en este navegador">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[14px] font-medium">Tema oscuro</p>
            <p className="text-[13px] text-tinta-suave">
              La primera vez se usa la preferencia del sistema; a partir de ahí manda esta.
            </p>
          </div>
          <Interruptor activo={tema === 'oscuro'} onCambiar={alternar} etiqueta="Tema oscuro" />
        </div>

        <dl className="mt-6 space-y-2 text-[13px]">
          <div className="flex justify-between">
            <dt className="text-tinta-suave">Rol</dt>
            <dd className="font-medium">{user!.role === 'admin' ? 'Administrador' : 'Cliente'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-tinta-suave">Cuenta creada</dt>
            <dd className="font-medium">{new Date(user!.createdAt).toLocaleDateString('es')}</dd>
          </div>
        </dl>
      </Tarjeta>
    </div>
  );
}
