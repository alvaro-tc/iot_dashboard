import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiError, errorMessage } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { PanelAuth } from '../components/PanelAuth.tsx';

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [recordar, setRecordar] = useState(true);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrores({});
    setGeneral('');
    if (!email.trim()) return setErrores({ email: 'Escribe tu correo.' });
    if (!password) return setErrores({ password: 'Escribe tu contraseña.' });

    setEnviando(true);
    try {
      await login(email.trim(), password, recordar);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrores(err.fields);
      else setGeneral(errorMessage(err));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <PanelAuth />

      <main className="flex items-center justify-center px-6 py-10">
        <form onSubmit={enviar} noValidate className="w-full max-w-sm">
          <h2 className="text-[26px] font-bold">Entrar</h2>
          <p className="mt-1 mb-7 text-[14px] text-tinta-suave">Accede al panel de tus robots.</p>

          {general && (
            <p role="alert" className="mb-4 rounded-2xl bg-evasion/10 px-4 py-3 text-[14px] text-evasion">
              {general}
            </p>
          )}

          <label className="etiqueta" htmlFor="email">
            Correo
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className="campo"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!errores.email}
            placeholder="nombre@dominio.com"
            autoFocus
          />
          {errores.email && <p className="error-campo">{errores.email}</p>}

          <label className="etiqueta mt-4" htmlFor="password">
            Contraseña
          </label>
          <div className="relative">
            <input
              id="password"
              type={verClave ? 'text' : 'password'}
              autoComplete="current-password"
              className="campo pr-12"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!errores.password}
            />
            <button
              type="button"
              aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              className="absolute top-1/2 right-2 inline-flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-tinta-suave hover:bg-tarjeta-tenue"
              onClick={() => setVerClave((v) => !v)}
            >
              {verClave ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {errores.password && <p className="error-campo">{errores.password}</p>}

          <div className="mt-4 flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-[14px] text-tinta-suave">
              <input
                type="checkbox"
                className="size-4 accent-acento"
                checked={recordar}
                onChange={(e) => setRecordar(e.target.checked)}
              />
              Recordarme
            </label>
          </div>

          <button type="submit" className="btn btn-acento mt-6 h-11 w-full" disabled={enviando}>
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>

          <p className="mt-6 text-center text-[14px] text-tinta-suave">
            ¿No tienes cuenta?{' '}
            <Link to="/registro" className="font-medium text-acento">
              Crear una
            </Link>
          </p>
        </form>
      </main>
    </div>
  );
}
