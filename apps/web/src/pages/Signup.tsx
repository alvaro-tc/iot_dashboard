import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout.tsx';
import { ErrorNote, Field } from '../components/ui.tsx';
import { ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';

export function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    // Comprobación local rápida; el servidor valida lo mismo y tiene la última palabra.
    if (form.confirm !== form.password) return setFields({ confirm: 'Las contraseñas no coinciden.' });
    setBusy(true);
    setFields({});
    try {
      await signup(form);
      navigate('/', { replace: true });
    } catch (err) {
      const apiErr = err as ApiError;
      setFields(apiErr.fields ?? {});
      if (!Object.keys(apiErr.fields ?? {}).length) setError(apiErr.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Crea tu cuenta"
      footer={
        <>
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="text-ink underline underline-offset-2">
            Inicia sesión
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Nombre" error={fields.name}>
          {(p) => <input {...p} autoComplete="name" className="input" value={form.name} onChange={set('name')} autoFocus />}
        </Field>
        <Field label="Correo" error={fields.email}>
          {(p) => <input {...p} type="email" autoComplete="email" className="input" value={form.email} onChange={set('email')} />}
        </Field>
        <Field label="Contraseña" error={fields.password} hint="Mínimo 8 caracteres, con al menos una letra y un número.">
          {(p) => <input {...p} type="password" autoComplete="new-password" className="input" value={form.password} onChange={set('password')} />}
        </Field>
        <Field label="Confirma la contraseña" error={fields.confirm}>
          {(p) => <input {...p} type="password" autoComplete="new-password" className="input" value={form.confirm} onChange={set('confirm')} />}
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn btn-primary justify-center" disabled={busy}>
          {busy ? 'Creando cuenta…' : 'Crear cuenta'}
        </button>
      </form>
    </AuthLayout>
  );
}
