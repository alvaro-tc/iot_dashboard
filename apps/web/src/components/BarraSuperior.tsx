// Barra superior: buscador de robots, "+ Agregar robot", campana de notificaciones,
// toggle de tema y menú de usuario.
import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, Moon, Plus, Search, Sun } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { EventoRobot } from '@iot/shared';
import { useAuth } from '../lib/auth.tsx';
import { NOMBRE_EVENTO, haceCuanto } from '../lib/formato.ts';
import { useRobots } from '../lib/robots.tsx';
import { useEventosRobot } from '../lib/socket.tsx';
import { useTema } from '../lib/tema.tsx';
import { useToast } from '../lib/toast.tsx';
import { DialogoNuevoRobot } from './DialogoNuevoRobot.tsx';

/** Eventos que merecen un toast además de entrar en la campana. */
const URGENTES = new Set(['atascado', 'bateria_baja', 'desconexion']);

export function BarraSuperior() {
  const { user, logout } = useAuth();
  const { tema, alternar } = useTema();
  const { robots, robot, elegir } = useRobots();
  const toast = useToast();
  const navigate = useNavigate();

  const [busqueda, setBusqueda] = useState('');
  const [abierto, setAbierto] = useState<'usuario' | 'campana' | null>(null);
  const [nuevoRobot, setNuevoRobot] = useState(false);
  const [notificaciones, setNotificaciones] = useState<EventoRobot[]>([]);
  const [sinLeer, setSinLeer] = useState(0);
  const contenedor = useRef<HTMLDivElement>(null);

  useEventosRobot((e) => {
    setNotificaciones((xs) => [e, ...xs].slice(0, 30));
    setSinLeer((n) => n + 1);
    if (URGENTES.has(e.tipo)) toast(`${NOMBRE_EVENTO[e.tipo]}: ${e.mensaje}`, 'error');
  });

  // Cierra los menús al pulsar fuera o con Escape.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (ev: MouseEvent) => {
      if (!contenedor.current?.contains(ev.target as Node)) setAbierto(null);
    };
    const escape = (ev: KeyboardEvent) => ev.key === 'Escape' && setAbierto(null);
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', escape);
    };
  }, [abierto]);

  const coincidencias = busqueda.trim()
    ? robots.filter((r) => `${r.nombre} ${r.ubicacion}`.toLowerCase().includes(busqueda.trim().toLowerCase()))
    : [];

  return (
    <div ref={contenedor} className="sticky top-0 z-20 px-4 pt-4 pb-2 sm:px-6">
      <div className="flex items-center gap-2 rounded-[var(--radius-tarjeta)] border border-borde bg-tarjeta px-3 py-2.5 shadow-[0_1px_2px_rgba(28,25,23,0.04)] sm:gap-3 sm:px-4">
        {/* Buscador: en móvil se reduce a un icono que abre el campo */}
        <div className="relative min-w-0 flex-1">
          <label className="sr-only" htmlFor="buscar-robot">
            Buscar robot
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-tinta-suave" />
          <input
            id="buscar-robot"
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar robot…"
            className="h-10 w-full rounded-full bg-transparent pl-9 text-[14px] outline-none placeholder:text-tinta-suave"
          />
          {coincidencias.length > 0 && (
            <ul className="absolute top-12 left-0 z-30 w-full overflow-hidden rounded-2xl border border-borde bg-tarjeta shadow-lg">
              {coincidencias.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="w-full cursor-pointer px-4 py-2.5 text-left text-[14px] hover:bg-tarjeta-tenue"
                    onClick={() => {
                      elegir(r.id);
                      setBusqueda('');
                    }}
                  >
                    {r.nombre}
                    <span className="ml-2 text-[13px] text-tinta-suave">{r.ubicacion}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {user!.role === 'client' && (
          <button type="button" className="btn btn-acento shrink-0 px-3 sm:px-4" onClick={() => setNuevoRobot(true)}>
            <Plus className="size-4" />
            <span className="hidden sm:inline">Agregar robot</span>
          </button>
        )}

        {/* Campana */}
        <div className="relative shrink-0">
          <button
            type="button"
            aria-label={`Notificaciones${sinLeer ? ` (${sinLeer} sin leer)` : ''}`}
            aria-expanded={abierto === 'campana'}
            className="btn-fantasma relative inline-flex size-10 cursor-pointer items-center justify-center rounded-full hover:bg-tarjeta-tenue"
            onClick={() => {
              setAbierto(abierto === 'campana' ? null : 'campana');
              setSinLeer(0);
            }}
          >
            <Bell className="size-5" />
            {sinLeer > 0 && <span className="absolute top-2 right-2 size-2 rounded-full bg-evasion" />}
          </button>
          {abierto === 'campana' && (
            <div className="absolute right-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-borde bg-tarjeta shadow-lg">
              <p className="border-b border-borde px-4 py-3 text-[14px] font-semibold">Notificaciones</p>
              {notificaciones.length === 0 ? (
                <p className="px-4 py-6 text-center text-[13px] text-tinta-suave">Nada por ahora.</p>
              ) : (
                <ul className="max-h-80 overflow-y-auto">
                  {notificaciones.map((e, i) => (
                    <li key={`${e.creadoEn}-${i}`} className="border-b border-borde px-4 py-2.5 last:border-0">
                      <p className="text-[13px] font-medium">{NOMBRE_EVENTO[e.tipo]}</p>
                      <p className="text-[13px] text-tinta-suave">{e.mensaje}</p>
                      <p className="text-[12px] text-tinta-suave">{haceCuanto(e.creadoEn)}</p>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                to="/eventos"
                className="block border-t border-borde px-4 py-2.5 text-center text-[13px] text-acento"
                onClick={() => setAbierto(null)}
              >
                Ver todos los eventos
              </Link>
            </div>
          )}
        </div>

        {/* Toggle de tema: píldora con luna y sol, como en la referencia */}
        <button
          type="button"
          role="switch"
          aria-checked={tema === 'oscuro'}
          aria-label="Tema oscuro"
          onClick={alternar}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-tarjeta-tenue p-1"
        >
          <span
            className={`inline-flex size-8 items-center justify-center rounded-full transition-colors duration-150 ${
              tema === 'oscuro' ? 'bg-acento text-white' : 'text-tinta-suave'
            }`}
          >
            <Moon className="size-4" />
          </span>
          <span
            className={`inline-flex size-8 items-center justify-center rounded-full transition-colors duration-150 ${
              tema === 'claro' ? 'bg-acento text-white' : 'text-tinta-suave'
            }`}
          >
            <Sun className="size-4" />
          </span>
        </button>

        {/* Menú de usuario */}
        <div className="relative shrink-0">
          <button
            type="button"
            aria-expanded={abierto === 'usuario'}
            aria-label="Menú de usuario"
            className="flex cursor-pointer items-center gap-2 rounded-full p-1 hover:bg-tarjeta-tenue"
            onClick={() => setAbierto(abierto === 'usuario' ? null : 'usuario')}
          >
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-acento/15 text-[14px] font-semibold text-acento">
              {user!.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="hidden min-w-0 text-left lg:block">
              <span className="block max-w-[140px] truncate text-[14px] font-medium">{user!.name}</span>
              <span className="block max-w-[140px] truncate text-[12px] text-tinta-suave">{user!.email}</span>
            </span>
            <ChevronDown className="hidden size-4 text-tinta-suave lg:block" />
          </button>
          {abierto === 'usuario' && (
            <div className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-2xl border border-borde bg-tarjeta shadow-lg">
              <div className="border-b border-borde px-4 py-3">
                <p className="truncate text-[14px] font-medium">{user!.name}</p>
                <p className="truncate text-[12px] text-tinta-suave">{user!.email}</p>
              </div>
              <button
                type="button"
                className="w-full cursor-pointer px-4 py-2.5 text-left text-[14px] hover:bg-tarjeta-tenue"
                onClick={() => {
                  setAbierto(null);
                  navigate('/perfil');
                }}
              >
                Mi perfil
              </button>
              <button
                type="button"
                className="w-full cursor-pointer px-4 py-2.5 text-left text-[14px] text-evasion hover:bg-tarjeta-tenue"
                onClick={logout}
              >
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Robot activo en móvil: la tarjeta del mapa lo muestra en escritorio */}
      {robot && (
        <p className="mt-2 px-2 text-[13px] text-tinta-suave sm:hidden">
          Robot activo: <span className="font-medium text-tinta">{robot.nombre}</span>
        </p>
      )}

      {nuevoRobot && <DialogoNuevoRobot onCerrar={() => setNuevoRobot(false)} />}
    </div>
  );
}

