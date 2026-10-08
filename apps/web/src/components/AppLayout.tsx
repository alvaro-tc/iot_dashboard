// Estructura de la aplicación: sidebar oscura estrecha (escritorio), barra superior y
// barra de navegación inferior en móvil.
//
//   ≥1280 px  sidebar fija + barra superior + grilla de 2 columnas
//   768–1279  sidebar en iconos, grilla de 2 columnas
//   <768      sin sidebar, nav inferior de 5 iconos, una columna
import { useState } from 'react';
import {
  Bot,
  CalendarClock,
  CircleHelp,
  History,
  PanelLeft,
  LayoutDashboard,
  LogOut,
  Map,
  TriangleAlert,
  UserRound,
  Users,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth.tsx';
import { BarraSuperior } from './BarraSuperior.tsx';
import { Modal } from './ui.tsx';

interface Enlace {
  to: string;
  texto: string;
  Icono: typeof Map;
  /** Los 5 que aparecen en la barra inferior del móvil. */
  movil?: boolean;
  end?: boolean;
}

const ENLACES_CLIENTE: Enlace[] = [
  { to: '/', texto: 'Panel', Icono: LayoutDashboard, movil: true, end: true },
  { to: '/mapa', texto: 'Mapa', Icono: Map, movil: true },
  { to: '/sesiones', texto: 'Sesiones', Icono: CalendarClock, movil: true },
  { to: '/historial', texto: 'Historial', Icono: History },
  { to: '/eventos', texto: 'Eventos', Icono: TriangleAlert, movil: true },
  { to: '/robots', texto: 'Robots', Icono: Bot, movil: true },
  { to: '/perfil', texto: 'Perfil', Icono: UserRound },
];

const ENLACES_ADMIN: Enlace[] = [
  { to: '/admin', texto: 'Panel', Icono: LayoutDashboard, movil: true, end: true },
  { to: '/admin/usuarios', texto: 'Usuarios', Icono: Users, movil: true },
  { to: '/admin/robots', texto: 'Robots', Icono: Bot, movil: true },
  { to: '/eventos', texto: 'Eventos', Icono: TriangleAlert, movil: true },
  { to: '/perfil', texto: 'Perfil', Icono: UserRound, movil: true },
];

function Logo() {
  return (
    <span className="inline-flex size-10 items-center justify-center rounded-2xl bg-acento text-white" aria-hidden>
      <Bot className="size-5" />
    </span>
  );
}

export function AppLayout() {
  const { user, logout } = useAuth();
  const [ayuda, setAyuda] = useState(false);
  const [abierta, setAbierta] = useState(false);
  const enlaces = user!.role === 'admin' ? ENLACES_ADMIN : ENLACES_CLIENTE;
  const enMovil = enlaces.filter((l) => l.movil).slice(0, 5);

  return (
    <div className={`min-h-screen transition-[padding] duration-150 ${abierta ? 'md:pl-[220px]' : 'md:pl-[76px]'}`}>
      {/* ---- Sidebar (≥768 px): estrecha en iconos, se despliega con los nombres ---- */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col gap-2 bg-barra py-5 transition-[width] duration-150 md:flex ${
          abierta ? 'w-[220px] items-stretch px-3' : 'w-[76px] items-center'
        }`}
      >
        <div className={`mb-4 flex items-center gap-2 ${abierta ? 'justify-between' : 'flex-col'}`}>
          <NavLink to="/" aria-label="Inicio" className="flex items-center gap-2">
            <Logo />
            {abierta && <span className="text-[15px] font-semibold text-white">Robots</span>}
          </NavLink>
          <button
            type="button"
            title={abierta ? 'Contraer menú' : 'Desplegar menú'}
            aria-label={abierta ? 'Contraer menú' : 'Desplegar menú'}
            aria-expanded={abierta}
            onClick={() => setAbierta(!abierta)}
            className="inline-flex size-9 cursor-pointer items-center justify-center rounded-full text-white/60 transition-colors duration-150 hover:bg-white/10 hover:text-white"
          >
            <PanelLeft className="size-5" />
          </button>
        </div>
        <nav aria-label="Principal" className="flex flex-1 flex-col gap-2">
          {enlaces.map(({ to, texto, Icono, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={texto}
              aria-label={texto}
              className={({ isActive }) =>
                `flex items-center gap-3 transition-colors duration-150 ${
                  abierta ? 'h-11 rounded-full px-3' : 'size-11 justify-center self-center rounded-full'
                } ${isActive ? 'bg-acento text-white' : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'}`
              }
            >
              <Icono className="size-5 shrink-0" />
              {abierta && <span className="truncate text-[14px]">{texto}</span>}
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          title="Ayuda"
          aria-label="Ayuda"
          onClick={() => setAyuda(true)}
          className={`flex cursor-pointer items-center gap-3 bg-white/5 text-white/60 transition-colors duration-150 hover:bg-white/10 hover:text-white ${
            abierta ? 'h-11 rounded-full px-3' : 'size-11 justify-center self-center rounded-full'
          }`}
        >
          <CircleHelp className="size-5 shrink-0" />
          {abierta && <span className="text-[14px]">Ayuda</span>}
        </button>
        <button
          type="button"
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
          onClick={logout}
          className={`flex cursor-pointer items-center gap-3 bg-evasion/15 text-evasion transition-colors duration-150 hover:bg-evasion hover:text-white ${
            abierta ? 'h-11 rounded-full px-3' : 'size-11 justify-center self-center rounded-full'
          }`}
        >
          <LogOut className="size-5 shrink-0" />
          {abierta && <span className="text-[14px]">Cerrar sesión</span>}
        </button>
      </aside>

      <BarraSuperior />

      {/* pb en móvil: deja sitio a la barra de navegación inferior */}
      <main className="mx-auto w-full max-w-[1500px] px-4 pb-24 sm:px-6 md:pb-8">
        <Outlet />
      </main>

      {/* ---- Navegación inferior (<768 px) ---- */}
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-borde bg-tarjeta md:hidden"
      >
        {enMovil.map(({ to, texto, Icono, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[11px] ${
                isActive ? 'text-acento' : 'text-tinta-suave'
              }`
            }
          >
            <Icono className="size-5" />
            {texto}
          </NavLink>
        ))}
      </nav>

      {ayuda && <DialogoAyuda onCerrar={() => setAyuda(false)} />}
    </div>
  );
}

function DialogoAyuda({ onCerrar }: { onCerrar: () => void }) {
  return (
    <Modal etiqueta="Ayuda" onCerrar={onCerrar}>
      <h2 className="tarjeta-titulo mb-2">¿Cómo funciona?</h2>
        <ul className="list-disc space-y-2 pl-5 text-[14px] text-tinta-suave">
          <li>
            El robot decide a dónde ir <strong className="text-tinta">él solo</strong>: la evasión de obstáculos
            ocurre en el ESP32 y no depende de la red.
          </li>
          <li>
            El mapa dibuja la posición estimada por <strong className="text-tinta">odometría</strong>, que acumula
            error con el tiempo. Los puntos rojos son obstáculos proyectados desde los sensores.
          </li>
          <li>
            Sin hardware a mano, arranca el simulador con <code className="text-tinta">pnpm simular</code>.
          </li>
        </ul>
      <button type="button" className="btn btn-acento mt-5 w-full" onClick={onCerrar}>
        Entendido
      </button>
    </Modal>
  );
}
