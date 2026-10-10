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
  Cog,
  Bot,
  Hash,
  Radar,
  Ruler,
  Wifi,
} from 'lucide-react';
import { METRICAS, metrica, type IdMetrica } from './metricas.ts';

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
  { id: 'radar', texto: 'Radar de sensores', Icono: Radar, caja: { x: 0, y: 0, w: 10, h: 6 }, min: { w: 5, h: 3 } },
  { id: 'distancias', texto: 'Distancias', Icono: Activity, caja: { x: 10, y: 0, w: 14, h: 6 }, min: { w: 5, h: 3 } },
  { id: 'estado', texto: 'Estado del robot', Icono: Bot, caja: { x: 0, y: 6, w: 6, h: 4 }, min: { w: 4, h: 3 } },
  { id: 'bateria', texto: 'Batería', Icono: BatteryCharging, caja: { x: 6, y: 6, w: 6, h: 4 }, min: { w: 5, h: 3 } },
  { id: 'conectividad', texto: 'Conectividad', Icono: Wifi, caja: { x: 12, y: 6, w: 6, h: 4 }, min: { w: 4, h: 3 } },
  { id: 'sesiones', texto: 'Sesiones', Icono: CalendarClock, caja: { x: 18, y: 6, w: 6, h: 4 }, min: { w: 6, h: 3 } },
  // Los de abajo no salen de fábrica (POR_DEFECTO_VISIBLES): con todos a la vez, más los
  // contadores que se añadan, no cabe nada en FILAS filas. Se añaden desde el cajón.
  { id: 'motor-izq', texto: 'Uso motor izquierdo', Icono: Cog, caja: { x: 0, y: 6, w: 6, h: 4 }, min: { w: 5, h: 3 } },
  { id: 'motor-der', texto: 'Uso motor derecho', Icono: Cog, caja: { x: 6, y: 6, w: 6, h: 4 }, min: { w: 5, h: 3 } },
  { id: 'dist-izq', texto: 'Distancia izquierda', Icono: Ruler, caja: { x: 0, y: 6, w: 6, h: 4 }, min: { w: 5, h: 3 } },
  { id: 'dist-centro', texto: 'Distancia central', Icono: Ruler, caja: { x: 6, y: 6, w: 6, h: 4 }, min: { w: 5, h: 3 } },
  { id: 'dist-der', texto: 'Distancia derecha', Icono: Ruler, caja: { x: 12, y: 6, w: 6, h: 4 }, min: { w: 5, h: 3 } },
] as const;

/**
 * El contador no es un widget mas del catalogo: es una plantilla. Cada vez que se anade desde
 * el cajon nace un ejemplar nuevo con su propia metrica, su sitio y su tamano, asi que se
 * pueden tener los que se quieran contando cosas distintas. Los ejemplares viven en la lista
 * de visibles como cualquier otra tarjeta.
 */
export const PLANTILLA_CONTADOR = {
  texto: 'Contador',
  Icono: Hash,
  caja: { x: 0, y: 6, w: 5, h: 3 },
  min: { w: 3, h: 2 },
} as const;

const PREFIJO_CONTADOR = 'contador-';
export const esContador = (id: IdTarjeta) => id.startsWith(PREFIJO_CONTADOR);

/** Lo que define a una tarjeta del tablero, sea del catalogo o un contador instanciado. */
export const infoTarjeta = (id: IdTarjeta) =>
  esContador(id) ? PLANTILLA_CONTADOR : (TARJETAS_PANEL.find((t) => t.id === id) ?? PLANTILLA_CONTADOR);

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

/**
 * Un id del catálogo, o el de un contador instanciado, que no se puede escribir como literal.
 * `infoTarjeta` resuelve cualquiera de los dos.
 */
export type IdTarjeta = (typeof TARJETAS_PANEL)[number]['id'] | (string & {});
interface Caja {
  x: number;
  y: number;
  w: number;
  h: number;
}

// v3: desaparecen los widgets de mapa y de evasión (la base ya no guarda pose ni eventos),
// así que la disposición guardada apuntaba a tarjetas que no existen. Las dos claves suben de
// versión a la vez: se empieza de cero en vez de arrastrar una grilla con huecos.
const CLAVE = 'panel-tarjetas-v3';
const CLAVE_CAJAS = 'panel-disposicion-v4';
const CLAVE_RADAR = 'panel-radar-tema';
const CLAVE_METRICAS = 'panel-contadores';
const TODAS = TARJETAS_PANEL.map((t) => t.id) as IdTarjeta[];
/** Ids que se pueden restaurar de localStorage: los del catálogo y los contadores. */
const conocido = (id: unknown): id is IdTarjeta =>
  typeof id === 'string' && (TODAS.includes(id) || esContador(id));
/**
 * Lo que ve quien entra por primera vez: las seis tarjetas del catálogo base. Los motores,
 * las distancias por sensor y los contadores existen en el cajón, pero juntos no caben en el
 * tablero, así que cada cual añade los que quiera. Quien ya tenía preferencias guardadas no
 * nota nada: `leerVisibles` descarta los ids que no estén en su lista.
 */
export const POR_DEFECTO_VISIBLES = TODAS.slice(0, 6);
const POR_DEFECTO = (id: IdTarjeta): Caja => infoTarjeta(id).caja;

/** Ignora ids desconocidos: si una tarjeta desaparece del código, la preferencia no rompe. */
function leerVisibles(): IdTarjeta[] {
  try {
    const guardado = localStorage.getItem(CLAVE);
    if (!guardado) return POR_DEFECTO_VISIBLES;
    const ids = JSON.parse(guardado) as unknown;
    if (!Array.isArray(ids)) return POR_DEFECTO_VISIBLES;
    // Orden del catálogo para las fijas y detrás los contadores, como se crearon.
    return [...TODAS.filter((id) => ids.includes(id)), ...ids.filter(esContador)] as IdTarjeta[];
  } catch {
    return POR_DEFECTO_VISIBLES;
  }
}

/** Igual con las cajas, y además descarta las mal formadas: una preferencia vieja no rompe. */
function leerCajas(): Partial<Record<IdTarjeta, Caja>> {
  try {
    const guardado = localStorage.getItem(CLAVE_CAJAS);
    if (!guardado) return {};
    const crudo = JSON.parse(guardado) as Record<string, Partial<Caja> | undefined>;
    const cajas: Partial<Record<IdTarjeta, Caja>> = {};
    for (const [id, c] of Object.entries(crudo ?? {})) {
      if (!c || !conocido(id)) continue;
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

/** Igual: una métrica que ya no exista en el catálogo cae en la primera (lo hace `metrica`). */
function leerMetricas(): Record<string, IdMetrica> {
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE_METRICAS) ?? '{}') as Record<string, string>;
    return Object.fromEntries(
      Object.entries(crudo ?? {})
        .filter(([id]) => esContador(id))
        .map(([id, m]) => [id, metrica(m as IdMetrica).valor]),
    );
  } catch {
    return {};
  }
}

interface ValorPanel {
  visibles: IdTarjeta[];
  ve: (id: IdTarjeta) => boolean;
  alternar: (id: IdTarjeta) => void;
  /** Vuelve al juego de tarjetas de fábrica, sin tocar la disposición. */
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
  /** Qué cuenta cada contador del tablero, por su id. */
  metricas: Record<string, IdMetrica>;
  fijarMetrica: (id: IdTarjeta, m: IdMetrica) => void;
  /** Pone un contador nuevo en el tablero y devuelve su id, para abrir su diálogo. */
  anadirContador: () => IdTarjeta;
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
  metricas: {},
  fijarMetrica: () => {},
  anadirContador: () => '',
});
export const usePanelTarjetas = () => useContext(Contexto);

export function ProveedorPanelTarjetas({ children }: { children: ReactNode }) {
  const [visibles, setVisibles] = useState<IdTarjeta[]>(leerVisibles);
  const [cajas, setCajas] = useState<Partial<Record<IdTarjeta, Caja>>>(leerCajas);
  const [temaRadar, setTemaRadar] = useState<TemaRadar>(leerTemaRadar);
  const [metricas, setMetricas] = useState<Record<string, IdMetrica>>(leerMetricas);

  useEffect(() => {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(visibles));
      localStorage.setItem(CLAVE_CAJAS, JSON.stringify(cajas));
      localStorage.setItem(CLAVE_RADAR, temaRadar);
      localStorage.setItem(CLAVE_METRICAS, JSON.stringify(metricas));
    } catch {
      /* navegación privada: la preferencia solo dura la sesión */
    }
  }, [visibles, cajas, temaRadar, metricas]);

  const alternar = useCallback((id: IdTarjeta) => {
    setVisibles((xs) =>
      xs.includes(id)
        ? xs.filter((x) => x !== id)
        : [...TODAS.filter((t) => t === id || xs.includes(t)), ...xs.filter(esContador)],
    );
    // Quitar un contador se lleva su métrica: no deja basura en localStorage al cabo de meses.
    if (esContador(id)) setMetricas(({ [id]: _, ...resto }) => resto);
  }, []);

  /**
   * Contador nuevo. Estrena la primera métrica que no esté ya en el tablero: añadir tres
   * seguidos da tres números distintos, no el mismo tres veces.
   */
  const anadirContador = useCallback(() => {
    const id = `${PREFIJO_CONTADOR}${Date.now().toString(36)}`;
    setVisibles((xs) => [...xs, id]);
    setMetricas((prev) => {
      const usadas = Object.values(prev);
      return { ...prev, [id]: (METRICAS.find((m) => !usadas.includes(m.valor)) ?? METRICAS[0]).valor };
    });
    return id;
  }, []);
  const restablecer = useCallback(() => {
    setVisibles(POR_DEFECTO_VISIBLES);
    setMetricas({}); // los contadores se van con ellos: no dejan su métrica huérfana detrás
  }, []);
  const fijarMetrica = useCallback((id: IdTarjeta, m: IdMetrica) => setMetricas((prev) => ({ ...prev, [id]: m })), []);
  const restablecerDisposicion = useCallback(() => setCajas({}), []);

  const fijarTamano = useCallback((id: IdTarjeta, w: number, h: number) => {
    const min = TARJETAS_PANEL.find((t) => t.id === id)!.min;
    setCajas((prev) => {
      const c = prev[id] ?? POR_DEFECTO(id);
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
      visibles.map((id) => {
        const info = infoTarjeta(id);
        return { i: id, ...(cajas[id] ?? info.caja), minW: info.min.w, minH: info.min.h };
      }),
    [visibles, cajas],
  );

  // react-grid-layout avisa también al montar y al compactar; devolver el mismo objeto
  // cuando nada cambió corta el ciclo render → onLayoutChange → render.
  const guardarLayout = useCallback((l: Layout) => {
    setCajas((prev) => {
      let cambio = false;
      const sig = { ...prev };
      for (const { i, x, y, w, h } of l) {
        const p = prev[i as IdTarjeta] ?? POR_DEFECTO(i as IdTarjeta);
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
        metricas,
        fijarMetrica,
        anadirContador,
      }}
    >
      {children}
    </Contexto.Provider>
  );
}
