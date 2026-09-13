import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { useLiveEvents } from '../lib/live.tsx';
import type { ClientStatus } from '../lib/types.ts';

/** Evento de ventana para que la barra lateral relea el estado tras vincular/revocar. */
export const CLIENT_STATUS_CHANGED = 'client-status-changed';

function useHasDevice(enabled: boolean) {
  const [hasDevice, setHasDevice] = useState(true); // oculto hasta saberlo
  const load = useCallback(() => {
    if (!enabled) return;
    api<ClientStatus>('/api/client/status')
      .then((s) => setHasDevice(s.hasDevice))
      .catch(() => {});
  }, [enabled]);
  useEffect(() => {
    load();
    window.addEventListener(CLIENT_STATUS_CHANGED, load);
    return () => window.removeEventListener(CLIENT_STATUS_CHANGED, load);
  }, [load]);
  return hasDevice;
}

export function AppLayout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const isClient = user!.role === 'client';
  const hasDevice = useHasDevice(isClient);
  useLiveEvents((m) => isClient && m.type !== 'hello' && window.dispatchEvent(new Event(CLIENT_STATUS_CHANGED)));

  useEffect(() => setOpen(false), [location.pathname]);

  const links = isClient
    ? [
        { to: '/dispositivo', label: 'Mi dispositivo' },
        { to: '/envios', label: 'Mis envíos' },
        ...(!hasDevice ? [{ to: '/simulador', label: 'Simulador' }] : []),
        { to: '/cuenta', label: 'Mi cuenta' },
      ]
    : [
        { to: '/admin', label: 'Panel general', end: true },
        { to: '/admin/usuarios', label: 'Usuarios' },
        { to: '/admin/sesiones', label: 'Sesiones' },
        { to: '/cuenta', label: 'Mi cuenta' },
      ];

  return (
    <div className="min-h-screen">
      {/* Barra superior solo por debajo de 900 px */}
      <div className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-grid bg-surface px-4 min-[900px]:hidden">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-label="Abrir menú"
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen(true)}
        >
          ☰
        </button>
        <span className="text-[15px] font-medium">Primera Evaluación IoT</span>
      </div>

      {open && (
        <div className="fixed inset-0 z-30 bg-ink/30 min-[900px]:hidden" aria-hidden onClick={() => setOpen(false)} />
      )}

      <aside
        id="sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-grid bg-surface ${open ? '' : 'max-[899px]:hidden'}`}
      >
        <div className="border-b border-grid px-5 py-5">
          <p className="text-[18px] leading-tight font-medium">
            Primera
            <br />
            Evaluación IoT
          </p>
        </div>
        <nav aria-label="Principal" className="flex-1 py-3">
          <ul>
            {links.map((l) => (
              <li key={l.to}>
                <NavLink
                  to={l.to}
                  end={'end' in l}
                  className={({ isActive }) =>
                    `block border-l-2 px-5 py-2 text-[15px] ${isActive ? 'border-ink bg-paper font-medium text-ink' : 'border-transparent text-ink-soft hover:text-ink'}`
                  }
                >
                  {l.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-grid px-5 py-4">
          <p className="truncate text-[15px]">{user!.name}</p>
          <p className="mb-3 truncate text-[13px] text-ink-soft">
            {user!.role === 'admin' ? 'Administrador' : 'Cliente'} · {user!.email}
          </p>
          <button type="button" className="btn btn-sm w-full justify-center" onClick={logout}>
            Salir
          </button>
        </div>
      </aside>

      <main className="min-[900px]:pl-60">
        <div className="max-w-[1400px] px-4 py-6 sm:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
