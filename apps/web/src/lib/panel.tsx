// Qué tarjetas ve cada cliente en su panel, dónde están y de qué tamaño. Se guarda en este
// navegador, como el tema, y el cambio se aplica al instante (el panel lee este contexto).
//
// La disposición es una grilla de react-grid-layout: `visibles` dice qué se dibuja y `cajas`
// dónde. Se guardan en claves separadas para que ocultar una tarjeta no pierda su sitio.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Layout } from 'react-grid-layout';
import {
  Activity,
  BatteryCharging,
  CalendarClock,
  Gauge,
  Bot,
  Map,
  Radar,
  Wifi,
} from 'lucide-react';

/** 24 columnas: permite mitades, tercios y la partición 58/42 de la referencia sin decimales. */
export const COLUMNAS = 24;
/**
 * El tablero tiene SIEMPRE estas filas, pasen lo que pasen las tarjetas. El alto de fila sale de
 * repartir el alto libre entre ellas, así que no depende de la disposición: si dependiera, mover
 * una tarjeta una fila más abajo reescalaría el tablero entero debajo del cursor mientras se
 * arrastra, y la tarjeta se escaparía del ratón. Con `maxRows` nadie puede pasar de aquí.
 */
export const FILAS = 10;
/** Alto de fila cuando no se reparte (una columna), y suelo por debajo del cual no se lee nada. */
export const ALTO_FILA = 40;
export const ALTO_FILA_MIN = 36;
export const MARGEN = 16;
/** Por debajo de esto la grilla colapsa a una columna y no se puede reordenar. */
export const ANCHO_GRILLA = 1024;
/**
 * Ancho del cajón de widgets del modo edición. El cajón va AL LADO del tablero, nunca encima:
 * tapar las tarjetas mientras se colocan es peor que estrecharlas. Lo que se encoge es el ancho
 * de columna, no la disposición: las cajas siguen en las mismas celdas y al salir vuelven.
 */
export const ANCHO_LATERAL = 340;
/**
 * Tamaño al que se dibuja la miniatura antes de escalarla, y el ancho de su caja en el cajón.
 * `caja` sale de repartir el ancho del cajón en DOS columnas: en una sola, siete widgets no
 * caben de un vistazo y hay que bajar scrolleando para ver qué hay.
 */
export const MINIATURA = { ancho: 560, alto: 240, caja: 144 } as const;

/**
 * `caja` es la posición por defecto; `min` el tamaño por debajo del cual la tarjeta no se lee.
 * Todo cabe en FILAS filas: con el alto típico de una portátil salen filas de ~42 px, así que
 * un `min.h` de 3 son ~160 px y uno de 4 son ~215 px, que es lo que piden estas tarjetas.
 */
export const TARJETAS_PANEL = [
  { id: 'mapa', texto: 'Mapa en vivo', Icono: Map, caja: { x: 0, y: 0, w: 14, h: 6 }, min: { w: 8, h: 4 } },
  { id: 'sesiones', texto: 'Sesiones', Icono: CalendarClock, caja: { x: 14, y: 0, w: 10, h: 3 }, min: { w: 6, h: 2 } },
  { id: 'estado', texto: 'Estado del robot', Icono: Bot, caja: { x: 14, y: 3, w: 5, h: 3 }, min: { w: 4, h: 3 } },
  { id: 'conectividad', texto: 'Conectividad', Icono: Wifi, caja: { x: 19, y: 3, w: 5, h: 3 }, min: { w: 4, h: 3 } },
  { id: 'radar', texto: 'Radar de sensores', Icono: Radar, caja: { x: 0, y: 6, w: 6, h: 4 }, min: { w: 5, h: 3 } },
  { id: 'distancias', texto: 'Distancias', Icono: Activity, caja: { x: 6, y: 6, w: 6, h: 4 }, min: { w: 5, h: 3 } },
  { id: 'bateria', texto: 'Batería', Icono: BatteryCharging, caja: { x: 12, y: 6, w: 6, h: 4 }, min: { w: 5, h: 3 } },
  { id: 'evasion', texto: 'Evasión', Icono: Gauge, caja: { x: 18, y: 6, w: 6, h: 4 }, min: { w: 5, h: 3 } },
] as const;

/** Presets del diálogo de edición de un widget: columnas y filas, acotados por su mínimo. */
export const ANCHOS = [
  { valor: 8, texto: 'Tercio' },
  { valor: 12, texto: 'Mitad' },
  { valor: 24, texto: 'Completo' },
] as const;
export const ALTOS = [
  { valor: 3, texto: 'Bajo' },
  { valor: 4, texto: 'Medio' },
  { valor: 6, texto: 'Alto' },
] as const;

/**
 * Paletas del radar: con qué criterio se colorean los tres sensores. Se elige al editar el
 * widget porque depende de para qué se mire: `estado` responde "¿hay peligro?" (rojo/ámbar/
 * verde en los tres sectores por igual), `sensor` responde "¿cuál de los tres lo ve?" (un tono
 * por sensor) y `contraste` es `estado` subido de intensidad, para pantallas malas o proyector.
 */
export const TEMAS_RADAR = [
  { valor: 'estado', texto: 'Estado' },
  { valor: 'sensor', texto: 'Sensor' },
  { valor: 'contraste', texto: 'Contraste' },
] as const;
export type TemaRadar = (typeof TEMAS_RADAR)[number]['valor'];

export type IdTarjeta = (typeof TARJETAS_PANEL)[number]['id'];
interface Caja {
  x: number;
  y: number;
  w: number;
  h: number;
}

// v2: el mapa y el radar son ya dos widgets distintos, así que la disposición guardada no
// tiene sitio para el radar y la lista de visibles lo dejaría fuera para siempre. Las dos
// claves suben de versión a la vez: se empieza de cero en vez de arrastrar una grilla a la
// que le falta una tarjeta.
const CLAVE = 'panel-tarjetas-v2';
const CLAVE_CAJAS = 'panel-disposicion-v3';
const CLAVE_RADAR = 'panel-radar-tema';
const TODAS = TARJETAS_PANEL.map((t) => t.id) as IdTarjeta[];
const POR_DEFECTO = Object.fromEntries(TARJETAS_PANEL.map((t) => [t.id, t.caja])) as Record<IdTarjeta, Caja>;

/** Ignora ids desconocidos: si una tarjeta desaparece del código, la preferencia no rompe. */
function leerVisibles(): IdTarjeta[] {
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

/** Igual con las cajas, y además descarta las mal formadas: una preferencia vieja no rompe. */
function leerCajas(): Partial<Record<IdTarjeta, Caja>> {
  try {
    const guardado = localStorage.getItem(CLAVE_CAJAS);
    if (!guardado) return {};
    const crudo = JSON.parse(guardado) as Record<string, Partial<Caja> | undefined>;
    const cajas: Partial<Record<IdTarjeta, Caja>> = {};
    for (const id of TODAS) {
      const c = crudo?.[id];
      if (!c) continue;
      const nums = [c.x, c.y, c.w, c.h];
      if (nums.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) cajas[id] = c as Caja;
    }
    return cajas;
  } catch {
    return {};
  }
}

/** Igual que el resto: un valor desconocido (versión vieja, usuario curioso) cae al de fábrica. */
function leerTemaRadar(): TemaRadar {
  try {
    const v = localStorage.getItem(CLAVE_RADAR);
    return TEMAS_RADAR.some((t) => t.valor === v) ? (v as TemaRadar) : 'estado';
  } catch {
    return 'estado';
  }
}

interface ValorPanel {
  visibles: IdTarjeta[];
  ve: (id: IdTarjeta) => boolean;
  alternar: (id: IdTarjeta) => void;
  /** Vuelve a mostrar todas las tarjetas, sin tocar la disposición. */
  restablecer: () => void;
  /** Grilla de las tarjetas visibles, lista para react-grid-layout. */
  layout: Layout;
  guardarLayout: (l: Layout) => void;
  restablecerDisposicion: () => void;
  /** Cambia el tamaño de una tarjeta desde el diálogo de edición, respetando su mínimo. */
  fijarTamano: (id: IdTarjeta, w: number, h: number) => void;
  /** Hay posiciones guardadas distintas de las de fábrica. */
  disposicionTocada: boolean;
  /** Paleta del radar. La lee el propio radar, también el de /mapa: es una sola preferencia. */
  temaRadar: TemaRadar;
  fijarTemaRadar: (t: TemaRadar) => void;
}

const Contexto = createContext<ValorPanel>({
  visibles: TODAS,
  ve: () => true,
  alternar: () => {},
  restablecer: () => {},
  layout: [],
  guardarLayout: () => {},
  restablecerDisposicion: () => {},
  fijarTamano: () => {},
  disposicionTocada: false,
  temaRadar: 'estado',
  fijarTemaRadar: () => {},
});
export const usePanelTarjetas = () => useContext(Contexto);

export function ProveedorPanelTarjetas({ children }: { children: ReactNode }) {
  const [visibles, setVisibles] = useState<IdTarjeta[]>(leerVisibles);
  const [cajas, setCajas] = useState<Partial<Record<IdTarjeta, Caja>>>(leerCajas);
  const [temaRadar, setTemaRadar] = useState<TemaRadar>(leerTemaRadar);

  useEffect(() => {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(visibles));
      localStorage.setItem(CLAVE_CAJAS, JSON.stringify(cajas));
      localStorage.setItem(CLAVE_RADAR, temaRadar);
    } catch {
      /* navegación privada: la preferencia solo dura la sesión */
    }
  }, [visibles, cajas, temaRadar]);

  const alternar = useCallback(
    (id: IdTarjeta) =>
      setVisibles((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : TODAS.filter((t) => t === id || xs.includes(t)))),
    [],
  );
  const restablecer = useCallback(() => setVisibles(TODAS), []);
  const restablecerDisposicion = useCallback(() => setCajas({}), []);

  const fijarTamano = useCallback((id: IdTarjeta, w: number, h: number) => {
    const min = TARJETAS_PANEL.find((t) => t.id === id)!.min;
    setCajas((prev) => {
      const c = prev[id] ?? POR_DEFECTO[id];
      const ancho = Math.min(COLUMNAS, Math.max(min.w, w));
      // El alto no puede salirse del tablero: se acota a FILAS y, si hace falta, se sube la caja.
      const alto = Math.min(FILAS, Math.max(min.h, h));
      return {
        ...prev,
        [id]: { x: Math.min(c.x, COLUMNAS - ancho), y: Math.min(c.y, FILAS - alto), w: ancho, h: alto },
      };
    });
  }, []);

  const layout = useMemo<Layout>(
    () =>
      TARJETAS_PANEL.filter((t) => visibles.includes(t.id)).map((t) => ({
        i: t.id,
        ...(cajas[t.id] ?? t.caja),
        minW: t.min.w,
        minH: t.min.h,
      })),
    [visibles, cajas],
  );

  // react-grid-layout avisa también al montar y al compactar; devolver el mismo objeto
  // cuando nada cambió corta el ciclo render → onLayoutChange → render.
  const guardarLayout = useCallback((l: Layout) => {
    setCajas((prev) => {
      let cambio = false;
      const sig = { ...prev };
      for (const { i, x, y, w, h } of l) {
        const p = prev[i as IdTarjeta] ?? POR_DEFECTO[i as IdTarjeta];
        if (p && p.x === x && p.y === y && p.w === w && p.h === h) continue;
        sig[i as IdTarjeta] = { x, y, w, h };
        cambio = true;
      }
      return cambio ? sig : prev;
    });
  }, []);

  return (
    <Contexto.Provider
      value={{
        visibles,
        ve: (id) => visibles.includes(id),
        alternar,
        restablecer,
        layout,
        guardarLayout,
        restablecerDisposicion,
        fijarTamano,
        disposicionTocada: Object.keys(cajas).length > 0,
        temaRadar,
        fijarTemaRadar: setTemaRadar,
      }}
    >
      {children}
    </Contexto.Provider>
  );
}
