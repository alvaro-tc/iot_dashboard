import { useState, type FormEvent } from 'react';
import { ErrorNote, Field, PageHeader, SectionTitle } from '../components/ui.tsx';
import { ApiError, api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { formatDateTime } from '../lib/time.ts';
import { useToast } from '../lib/toast.tsx';
import type { User } from '../lib/types.ts';

export function Account() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user!.name);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  async function send(body: object, done: string) {
    setFields({});
    setError('');
    try {
      setUser(await api<User>('/api/me', { method: 'PATCH', body }));
      toast(done);
      return true;
    } catch (e) {
      const err = e as ApiError;
      setFields(err.fields ?? {});
      if (!Object.keys(err.fields ?? {}).length) setError(err.message);
      return false;
    }
  }

  return (
    <>
      <PageHeader title="Mi cuenta" subtitle={`${user!.email} · cuenta creada el ${formatDateTime(user!.createdAt)}`} />
      <div className="grid max-w-3xl gap-8 min-[900px]:grid-cols-2">
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            send({ name }, 'Nombre actualizado');
          }}
        >
          <SectionTitle>Datos</SectionTitle>
          <Field label="Nombre" error={fields.name}>
            {(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <div>
            <button className="btn btn-primary">Guardar nombre</button>
          </div>
        </form>
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            if (await send(pw, 'Contraseña cambiada')) setPw({ currentPassword: '', newPassword: '' });
          }}
        >
          <SectionTitle>Contraseña</SectionTitle>
          <Field label="Contraseña actual" error={fields.currentPassword}>
            {(p) => (
              <input {...p} type="password" autoComplete="current-password" className="input" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
            )}
          </Field>
          <Field label="Contraseña nueva" error={fields.newPassword} hint="Mínimo 8 caracteres, con al menos una letra y un número.">
            {(p) => (
              <input {...p} type="password" autoComplete="new-password" className="input" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            )}
          </Field>
          <div>
            <button className="btn btn-primary">Cambiar contraseña</button>
          </div>
        </form>
      </div>
      <div className="mt-4 max-w-3xl">
        <ErrorNote>{error}</ErrorNote>
      </div>
    </>
  );
}
