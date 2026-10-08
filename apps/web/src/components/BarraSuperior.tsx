// Barra superior: selector del robot activo, campana de notificaciones,
// toggle de tema y menú de usuario.
import { useEffect, useRef, useState } from 'react';
import { Bell, Bot, ChevronDown, Moon, Plus, Sun } from 'lucide-react';
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

  const [abierto, setAbierto] = useState<'usuario' | 'campana' | 'robot' | null>(null);
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

  return (
    <div ref={contenedor} className="sticky top-0 z-20 px-4 pt-4 pb-2 sm:px-6">
      <div className="flex items-center gap-2 rounded-[var(--radius-tarjeta)] border border-borde bg-tarjeta px-3 py-2.5 shadow-[0_1px_2px_rgba(28,25,23,0.04)] sm:gap-3 sm:px-4">
        {/* Selector del robot activo */}
        <div className="relative min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={abierto === 'robot'}
            aria-label="Robot activo"
            className="flex max-w-full cursor-pointer items-center gap-2 rounded-full px-2 py-1.5 hover:bg-tarjeta-tenue"
            onClick={() => setAbierto(abierto === 'robot' ? null : 'robot')}
          >
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-acento/15 text-acento">
              <Bot className="size-5" />
            </span>
            <span className="min-w-0 text-left">
              <span className="block max-w-[180px] truncate text-[14px] font-medium">
                {robot?.nombre ?? 'Sin robots'}
              </span>
              {robot && (
                <span className="block max-w-[180px] truncate text-[12px] text-tinta-suave">{robot.ubicacion}</span>
              )}
            </span>
            <ChevronDown className="size-4 shrink-0 text-tinta-suave" />
          </button>
          {abierto === 'robot' && (
            <div className="absolute top-12 left-0 z-30 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-borde bg-tarjeta shadow-lg">
              <ul className="max-h-80 overflow-y-auto">
                {robots.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className={`w-full cursor-pointer px-4 py-2.5 text-left text-[14px] hover:bg-tarjeta-tenue ${
                        r.id === robot?.id ? 'text-acento' : ''
                      }`}
                      onClick={() => {
                        elegir(r.id);
                        setAbierto(null);
                      }}
                    >
                      {r.nombre}
                      <span className="ml-2 text-[13px] text-tinta-suave">{r.ubicacion}</span>
                    </button>
                  </li>
                ))}
                {robots.length === 0 && (
                  <li className="px-4 py-6 text-center text-[13px] text-tinta-suave">Aún no tienes robots.</li>
                )}
              </ul>
              {user!.role === 'client' && (
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 border-t border-borde px-4 py-2.5 text-left text-[14px] text-acento hover:bg-tarjeta-tenue"
                  onClick={() => {
                    setAbierto(null);
                    setNuevoRobot(true);
                  }}
                >
                  <Plus className="size-4" />
                  Añadir robot
                </button>
              )}
            </div>
          )}
        </div>

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

      {nuevoRobot && <DialogoNuevoRobot onCerrar={() => setNuevoRobot(false)} />}
    </div>
  );
}

