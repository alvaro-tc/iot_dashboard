// Qué tarjetas ve cada cliente en su panel. Se guarda en este navegador, como el tema,
// y el cambio se aplica al instante (el panel lee este contexto).
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  BatteryCharging,
  CalendarClock,
  Gauge,
  Bot,
  Map,
  Wifi,
} from 'lucide-react';

export const TARJETAS_PANEL = [
  { id: 'mapa', texto: 'Mapa en vivo', Icono: Map },
  { id: 'sesiones', texto: 'Sesiones', Icono: CalendarClock },
  { id: 'estado', texto: 'Estado del robot', Icono: Bot },
  { id: 'conectividad', texto: 'Conectividad', Icono: Wifi },
  { id: 'distancias', texto: 'Distancias', Icono: Activity },
  { id: 'bateria', texto: 'Batería', Icono: BatteryCharging },
  { id: 'evasion', texto: 'Evasión', Icono: Gauge },
] as const;

export type IdTarjeta = (typeof TARJETAS_PANEL)[number]['id'];

const CLAVE = 'panel-tarjetas';
const TODAS = TARJETAS_PANEL.map((t) => t.id) as IdTarjeta[];

/** Ignora ids desconocidos: si una tarjeta desaparece del código, la preferencia no rompe. */
function leer(): IdTarjeta[] {
  try {
    const guardado = localStorage.getItem(CLAVE);
    if (!guardado) return TODAS;
    const ids = JSON.parse(guardado) as unknown;
    if (!Array.isArray(ids)) return TODAS;
    return TODAS.filter((id) => ids.includes(id));
  } catch {
    return TODAS;
  }
}

interface ValorPanel {
  visibles: IdTarjeta[];
  ve: (id: IdTarjeta) => boolean;
  alternar: (id: IdTarjeta) => void;
  restablecer: () => void;
}

const Contexto = createContext<ValorPanel>({ visibles: TODAS, ve: () => true, alternar: () => {}, restablecer: () => {} });
export const usePanelTarjetas = () => useContext(Contexto);

export function ProveedorPanelTarjetas({ children }: { children: ReactNode }) {
  const [visibles, setVisibles] = useState<IdTarjeta[]>(leer);

  useEffect(() => {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(visibles));
    } catch {
      /* navegación privada: la preferencia solo dura la sesión */
    }
  }, [visibles]);

  const alternar = useCallback(
    (id: IdTarjeta) =>
      setVisibles((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : TODAS.filter((t) => t === id || xs.includes(t)))),
    [],
  );
  const restablecer = useCallback(() => setVisibles(TODAS), []);

  return (
    <Contexto.Provider value={{ visibles, ve: (id) => visibles.includes(id), alternar, restablecer }}>
      {children}
    </Contexto.Provider>
  );
}
