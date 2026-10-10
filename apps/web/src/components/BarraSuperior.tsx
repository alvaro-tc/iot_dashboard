// Barra superior: selector del robot activo, campana de notificaciones,
// toggle de tema y menú de usuario.
import { useEffect, useRef, useState } from 'react';
import { Bell, Bot, ChevronDown, Moon, Plus, Sun } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DIST_EVASION_CM, SENSORES_DE } from '@iot/shared';
import { useAuth } from '../lib/auth.tsx';
import { haceCuanto } from '../lib/formato.ts';
import { useRobots } from '../lib/robots.tsx';
import { useTelemetria } from '../lib/socket.tsx';
import { useTema } from '../lib/tema.tsx';
import { useToast } from '../lib/toast.tsx';
import { DialogoNuevoRobot } from './DialogoNuevoRobot.tsx';

/**
 * Avisos de la campana. Ya no hay tabla de eventos: se deducen aquí de la telemetría que
 * llega por WebSocket, así que viven mientras la pestaña esté abierta.
 *
 * Cada aviso se da UNA vez y no vuelve hasta que la condición se despeja (histéresis): sin
 * eso, una batería al 19 % llenaría la campana con un aviso cada medio segundo.
 */
const BATERIA_BAJA_PCT = 20;
const BATERIA_OK_PCT = 30;

interface Aviso {
  titulo: string;
  mensaje: string;
  creadoEn: number;
  urgente: boolean;
}

export function BarraSuperior() {
  const { user, logout } = useAuth();
  const { tema, alternar } = useTema();
  const { robots, robot, elegir } = useRobots();
  const toast = useToast();
  const navigate = useNavigate();

  const [abierto, setAbierto] = useState<'usuario' | 'campana' | 'robot' | null>(null);
  const [nuevoRobot, setNuevoRobot] = useState(false);
  const [notificaciones, setNotificaciones] = useState<Aviso[]>([]);
  const [sinLeer, setSinLeer] = useState(0);
  const contenedor = useRef<HTMLDivElement>(null);
  /** Condiciones ya avisadas, para no repetir el mismo aviso en cada lectura. */
  const avisado = useRef({ bateria: false, atascado: false });

  const avisar = (a: Aviso) => {
    setNotificaciones((xs) => [a, ...xs].slice(0, 30));
    setSinLeer((n) => n + 1);
    if (a.urgente) toast(`${a.titulo}: ${a.mensaje}`, 'error');
  };

  useTelemetria((l) => {
    const ahora = Date.now();

    if (l.bateriaPorcentaje < BATERIA_BAJA_PCT && !avisado.current.bateria) {
      avisado.current.bateria = true;
      avisar({
        titulo: 'Batería baja',
        mensaje: `El robot está al ${Math.round(l.bateriaPorcentaje)} %`,
        creadoEn: ahora,
        urgente: true,
      });
    } else if (l.bateriaPorcentaje > BATERIA_OK_PCT) {
      avisado.current.bateria = false; // se recargó: vuelve a poder avisar
    }

    // Los tres sensores por debajo de la distancia de evasión: no tiene por dónde salir.
    const d = SENSORES_DE(l).map((x) => x.d);
    const rodeado = d.every((x) => x !== null && x <= DIST_EVASION_CM);
    if (rodeado && !avisado.current.atascado) {
      avisado.current.atascado = true;
      avisar({
        titulo: 'Posible atasco',
        mensaje: 'Los tres sensores ven un obstáculo muy cerca',
        creadoEn: ahora,
        urgente: true,
      });
    } else if (!rodeado) {
      avisado.current.atascado = false;
    }
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
              {user!.role === 'cliente' && (
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
                  {notificaciones.map((a, i) => (
                    <li key={`${a.creadoEn}-${i}`} className="border-b border-borde px-4 py-2.5 last:border-0">
                      <p className="text-[13px] font-medium">{a.titulo}</p>
                      <p className="text-[13px] text-tinta-suave">{a.mensaje}</p>
                      <p className="text-[12px] text-tinta-suave">{haceCuanto(a.creadoEn)}</p>
                    </li>
                  ))}
                </ul>
              )}
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

