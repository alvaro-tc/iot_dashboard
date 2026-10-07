import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/AuthLayout.tsx';
import { ErrorNote, Field } from '../components/ui.tsx';
import { ApiError } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const fields = error?.fields ?? {};
  return (
    <AuthLayout
      title="Inicia sesión"
      subtitle="Entra para ver tus series en tiempo real."
      footer={
        <>
          ¿Aún no tienes cuenta?{' '}
          <Link to="/signup" className="text-ink underline underline-offset-2">
            Crea una
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Correo" error={fields.email}>
          {(p) => (
            <input
              {...p}
              type="email"
              autoComplete="email"
              placeholder="tu@correo.com"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          )}
        </Field>
        <Field label="Contraseña" error={fields.password}>
          {(p) => (
            <div className="relative">
              <input
                {...p}
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                className="input pr-16"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                className="absolute inset-y-0 right-0 cursor-pointer px-3 text-[13px] text-ink-soft hover:text-ink"
              >
                {show ? 'Ocultar' : 'Ver'}
              </button>
            </div>
          )}
        </Field>
        <ErrorNote>{error && !Object.keys(fields).length ? error.message : ''}</ErrorNote>
        <button className="btn btn-primary mt-1 h-10 justify-center" disabled={busy}>
          {busy ? 'Entrando…' : 'Iniciar sesión'}
        </button>
      </form>
    </AuthLayout>
  );
}
