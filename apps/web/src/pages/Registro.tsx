import { useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ApiError, errorMessage } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { PanelAuth } from '../components/PanelAuth.tsx';

/** Fortaleza de la contraseña: los tres primeros puntos son los que exige el backend. */
function fortaleza(clave: string): { nivel: 0 | 1 | 2 | 3 | 4; texto: string } {
  let n = 0;
  if (clave.length >= 8) n++;
  if (/[A-Za-z]/.test(clave)) n++;
  if (/\d/.test(clave)) n++;
  if (clave.length >= 12 && /[^A-Za-z0-9]/.test(clave)) n++;
  const textos = ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Fuerte'] as const;
  return { nivel: n as 0 | 1 | 2 | 3 | 4, texto: textos[n] };
}

export function Registro() {
  const { signup } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [acepta, setAcepta] = useState(false);
  const [verClave, setVerClave] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState('');
  const [enviando, setEnviando] = useState(false);

  const fuerza = useMemo(() => fortaleza(form.password), [form.password]);
  const cambiar = (campo: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [campo]: e.target.value });

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrores({});
    setGeneral('');

    const locales: Record<string, string> = {};
    if (form.name.trim().length < 2) locales.name = 'Escribe tu nombre.';
    if (!form.email.trim()) locales.email = 'Escribe tu correo.';
    if (form.password.length < 8) locales.password = 'La contraseña debe tener al menos 8 caracteres.';
    if (form.password !== form.confirm) locales.confirm = 'Las contraseñas no coinciden.';
    if (!acepta) locales.acepta = 'Tienes que aceptar los términos.';
    if (Object.keys(locales).length) return setErrores(locales);

    setEnviando(true);
    try {
      await signup({ ...form, name: form.name.trim(), email: form.email.trim() });
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
          <h2 className="text-[26px] font-bold">Crear cuenta</h2>
          <p className="mt-1 mb-7 text-[14px] text-tinta-suave">Gratis, y puedes empezar con el simulador.</p>

          {general && (
            <p role="alert" className="mb-4 rounded-2xl bg-evasion/10 px-4 py-3 text-[14px] text-evasion">
              {general}
            </p>
          )}

          <label className="etiqueta" htmlFor="name">
            Nombre
          </label>
          <input
            id="name"
            className="campo"
            autoComplete="name"
            value={form.name}
            onChange={cambiar('name')}
            aria-invalid={!!errores.name}
            autoFocus
          />
          {errores.name && <p className="error-campo">{errores.name}</p>}

          <label className="etiqueta mt-4" htmlFor="email">
            Correo
          </label>
          <input
            id="email"
            type="email"
            className="campo"
            autoComplete="email"
            value={form.email}
            onChange={cambiar('email')}
            aria-invalid={!!errores.email}
            placeholder="nombre@dominio.com"
          />
          {errores.email && <p className="error-campo">{errores.email}</p>}

          <label className="etiqueta mt-4" htmlFor="password">
            Contraseña
          </label>
          <div className="relative">
            <input
              id="password"
              type={verClave ? 'text' : 'password'}
              className="campo pr-12"
              autoComplete="new-password"
              value={form.password}
              onChange={cambiar('password')}
              aria-invalid={!!errores.password}
              aria-describedby="fortaleza"
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
          <div id="fortaleza" className="mt-2 flex items-center gap-2">
            <div className="flex flex-1 gap-1">
              {[1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className={`h-1 flex-1 rounded-full ${
                    fuerza.nivel >= i ? (fuerza.nivel <= 2 ? 'bg-evasion' : fuerza.nivel === 3 ? 'bg-precaucion' : 'bg-libre') : 'bg-borde'
                  }`}
                />
              ))}
            </div>
            <span className="w-20 text-right text-[12px] text-tinta-suave">{form.password ? fuerza.texto : ''}</span>
          </div>
          {errores.password && <p className="error-campo">{errores.password}</p>}

          <label className="etiqueta mt-4" htmlFor="confirm">
            Repite la contraseña
          </label>
          <input
            id="confirm"
            type={verClave ? 'text' : 'password'}
            className="campo"
            autoComplete="new-password"
            value={form.confirm}
            onChange={cambiar('confirm')}
            aria-invalid={!!errores.confirm}
          />
          {errores.confirm && <p className="error-campo">{errores.confirm}</p>}

          <label className="mt-5 flex cursor-pointer items-start gap-2 text-[14px] text-tinta-suave">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-acento"
              checked={acepta}
              onChange={(e) => setAcepta(e.target.checked)}
              aria-invalid={!!errores.acepta}
            />
            Acepto los términos del servicio y el tratamiento de los datos de telemetría de mis robots.
          </label>
          {errores.acepta && <p className="error-campo">{errores.acepta}</p>}

          <button type="submit" className="btn btn-acento mt-6 h-11 w-full" disabled={enviando}>
            {enviando ? 'Creando cuenta…' : 'Crear cuenta'}
          </button>

          <p className="mt-6 text-center text-[14px] text-tinta-suave">
            ¿Ya tienes cuenta?{' '}
            <Link to="/login" className="font-medium text-acento">
              Entrar
            </Link>
          </p>
        </form>
      </main>
    </div>
  );
}
