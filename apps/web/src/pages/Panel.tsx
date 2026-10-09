// Panel principal. Las tarjetas viven en una grilla de react-grid-layout: cada cliente las
// mueve y redimensiona a su gusto y la disposición se guarda en su navegador (lib/panel.tsx).
//
// El panel es un tablero de FILAS filas fijas que se reparten el alto libre hasta el borde de la
// ventana: el alto de fila NO depende de la disposición. Si dependiera (tantas filas como ocupen
// las tarjetas), bajar una tarjeta una fila reescalaría el tablero entero mientras se arrastra y
// la tarjeta se escaparía del cursor; y pasadas ~12 filas los márgenes solos se comen el alto
// disponible, las tarjetas quedan en tiras ilegibles y la grilla acaba siendo más alta que su
// caja. `maxRows` impide salirse por abajo, y si aun así no cabe (ventana muy baja) el tablero
// hace scroll en vez de recortar: más vale desplazar que cortar una tarjeta por la mitad.
//
// El arrastre y los tiradores solo se activan en "modo edición": las tarjetas tienen dentro
// mapas con pan y gráficas con zoom, y si el arrastre estuviera siempre activo pelearían por
// el mismo gesto. En modo edición un velo encima de cada tarjeta se queda con el ratón.
//
// El cajón de widgets del modo edición se abre AL LADO del tablero y le cede ANCHO_LATERAL:
// encima taparía justo las tarjetas que vas a colocar. Encoger el tablero solo cambia el ancho
// de columna; las cajas siguen en las mismas celdas y recuperan su tamaño al salir.
//
// El umbral de "¿cabe una grilla?" se mide sobre la FILA entera, que no cambia al abrir el cajón,
// y el breakpoint se le pasa a la grilla a mano. Midiéndolo sobre el ancho ya encogido, abrir el
// cajón bajaría del umbral, eso cerraría la edición, el tablero volvería a crecer... y a empezar.
//
// El cajón muestra cada widget en miniatura (el widget de verdad, dibujado a tamaño real y
// escalado) en dos columnas, para verlos todos sin scroll. Cada widget del tablero saca entonces
// sus controles de esquina: lápiz para su tamaño y cruz para quitarlo.
import React, { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, LayoutGrid, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveGridLayout, useContainerWidth } from 'react-grid-layout';
import { api } from '../lib/api.ts';
import {
  ALTO_FILA,
  ALTO_FILA_MIN,
  ALTOS,
  ANCHO_GRILLA,
  ANCHO_LATERAL,
  ANCHOS,
  COLUMNAS,
  FILAS,
  MARGEN,
  MINIATURA,
  TARJETAS_PANEL,
  TEMAS_RADAR,
  usePanelTarjetas,
  type IdTarjeta,
} from '../lib/panel.tsx';
import { useRobots } from '../lib/robots.tsx';
import { useSocket } from '../lib/socket.tsx';
import type { Resumen } from '../lib/types.ts';
import { DialogoNuevoRobot } from '../components/DialogoNuevoRobot.tsx';
import { TarjetaBateria } from '../components/TarjetaBateria.tsx';
import { TarjetaConectividad } from '../components/TarjetaConectividad.tsx';
import { TarjetaDistancias } from '../components/TarjetaDistancias.tsx';
import { TarjetaEstado } from '../components/TarjetaEstado.tsx';
import { TarjetaEvasion } from '../components/TarjetaEvasion.tsx';
import { TarjetaMapa } from '../components/TarjetaMapa.tsx';
import { TarjetaSesiones, type EstadoRepeticion } from '../components/TarjetaSesiones.tsx';
import { ErrorConReintento, Esqueleto, Modal, Segmentado, Vacio } from '../components/ui.tsx';

/** Alto libre desde el elemento hasta el borde inferior de la ventana; 0 si no se ajusta. */
function useAltoLibre(ref: React.RefObject<HTMLElement | null>, activo: boolean) {
  const [alto, setAlto] = useState(0);
  useLayoutEffect(() => {
    if (!activo) {
      setAlto(0);
      return;
    }
    const medir = () => {
      const el = ref.current;
      if (!el) return;
      // El <main> lleva su propio padding inferior: si no se descuenta, sobra justo ese alto
      // por debajo de la ventana y vuelve a aparecer la barra de scroll.
      const main = el.closest('main');
      const hueco = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      setAlto(Math.max(360, Math.floor(window.innerHeight - el.getBoundingClientRect().top - hueco)));
    };
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [ref, activo]);
  return alto;
}

/**
 * Caja de un elemento, que la fija el flex y no su contenido. Se mide ya en el primer paso de
 * layout: si se esperase al ResizeObserver, el primer pintado usaría el alto de fila de reserva
 * y la grilla aparecería del doble de alto antes de encogerse de golpe.
 */
function useCajaMedida(ref: React.RefObject<HTMLElement | null>) {
  const [caja, setCaja] = useState({ ancho: 0, alto: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCaja({ ancho: r.width, alto: r.height });
    const ro = new ResizeObserver(([e]) =>
      setCaja({ ancho: e.contentRect.width, alto: e.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return caja;
}

/** El widget de verdad, dibujado a tamaño real y escalado: preview fiel sin código aparte. */
function Miniatura({ children }: { children: ReactNode }) {
  const escala = MINIATURA.caja / MINIATURA.ancho;
  return (
    <div className="miniatura" style={{ height: Math.round(MINIATURA.alto * escala) }}>
      <div
        className="origin-top-left"
        style={{ width: MINIATURA.ancho, height: MINIATURA.alto, transform: `scale(${escala})` }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Lista de widgets del modo edición: todos, con su miniatura, marcados los que ya están en el
 * panel. Es el mismo contenido en el lateral (escritorio) y en el modal (pantalla estrecha,
 * donde la grilla es de una columna, no hay nada que colocar y la miniatura no cabe).
 */
function CajonWidgets({ vista }: { vista?: (id: IdTarjeta) => ReactNode }) {
  const { ve, alternar, restablecer, restablecerDisposicion, disposicionTocada, visibles } = usePanelTarjetas();
  const fuera = TARJETAS_PANEL.length - visibles.length;
  return (
    <>
      <p className="tarjeta-sub mb-3">
        Toca un widget para añadirlo o quitarlo. En el panel, arrástralos para colocarlos y tira del borde para
        cambiar su tamaño. Se guarda en este navegador.
      </p>
      {/* Dos columnas con miniatura: los siete widgets se ven de un vistazo, sin scrollear. */}
      <ul className={vista ? 'grid grid-cols-2 gap-2' : 'space-y-1'}>
        {TARJETAS_PANEL.map(({ id, texto, Icono }) => (
          <li key={id}>
            <button
              type="button"
              aria-pressed={ve(id)}
              aria-label={`${ve(id) ? 'Quitar' : 'Añadir'} ${texto}`}
              className={
                vista
                  ? `w-full cursor-pointer rounded-2xl border p-1.5 text-left transition-colors duration-150 ${
                      ve(id) ? 'border-acento/50 bg-acento/5' : 'border-borde hover:border-acento/40'
                    }`
                  : 'chip w-full justify-start'
              }
              onClick={() => alternar(id)}
            >
              <span className={vista ? 'mb-1.5 flex items-center gap-1.5' : 'flex min-w-0 flex-1 items-center gap-2'}>
                <span className={`chip-icono shrink-0 ${vista ? 'size-5' : ''}`}>
                  <Icono className={vista ? 'size-3' : 'size-3.5'} />
                </span>
                <span className="min-w-0 flex-1 truncate text-left text-[12px] font-medium">{texto}</span>
                {ve(id) ? <X className="size-3.5 shrink-0 opacity-60" /> : <Plus className="size-3.5 shrink-0" />}
              </span>
              {vista && <Miniatura>{vista(id)}</Miniatura>}
            </button>
          </li>
        ))}
      </ul>
      {!visibles.length && <p className="mt-3 text-[13px] text-precaucion">Sin widgets el panel queda vacío.</p>}
      <div className="mt-5 flex gap-2">
        <button type="button" className="btn btn-sm flex-1" onClick={restablecer} disabled={!fuera}>
          Añadir todos
        </button>
        <button
          type="button"
          className="btn btn-sm flex-1"
          onClick={restablecerDisposicion}
          disabled={!disposicionTocada}
        >
          <RotateCcw className="size-4" />
          Original
        </button>
      </div>
    </>
  );
}

/** Tamaño de un widget por presets. Lo fino se sigue haciendo arrastrando los tiradores. */
function DialogoWidget({ id, onCerrar }: { id: IdTarjeta; onCerrar: () => void }) {
  const { layout, fijarTamano, temaRadar, fijarTemaRadar } = usePanelTarjetas();
  const { texto, min } = TARJETAS_PANEL.find((t) => t.id === id)!;
  const caja = layout.find((l) => l.i === id);
  const w = caja?.w ?? min.w;
  const h = caja?.h ?? min.h;
  /** Preset activo: el más cercano, para que el segmentado no quede siempre en blanco. */
  const cerca = (opts: readonly { valor: number }[], v: number) =>
    opts.reduce((a, b) => (Math.abs(b.valor - v) < Math.abs(a.valor - v) ? b : a)).valor;
  return (
    <Modal etiqueta={`Editar ${texto}`} ancho="max-w-xs" onCerrar={onCerrar}>
      <h2 className="tarjeta-titulo mb-1">{texto}</h2>
      <p className="tarjeta-sub mb-5">
        Tamaño en la grilla. Mínimo {min.w} de ancho y {min.h} de alto para que siga legible.
      </p>
      <div className="space-y-4">
        <div>
          <span className="etiqueta">Ancho</span>
          <Segmentado
            etiqueta="Ancho del widget"
            valor={String(cerca(ANCHOS, w))}
            onCambiar={(v) => fijarTamano(id, Number(v), h)}
            opciones={ANCHOS.map((o) => ({ valor: String(o.valor), texto: o.texto }))}
          />
        </div>
        <div>
          <span className="etiqueta">Alto</span>
          <Segmentado
            etiqueta="Alto del widget"
            valor={String(cerca(ALTOS, h))}
            onCambiar={(v) => fijarTamano(id, w, Number(v))}
            opciones={ALTOS.map((o) => ({ valor: String(o.valor), texto: o.texto }))}
          />
        </div>
        {/* Opción propia del radar: con qué criterio se colorean los tres sensores. */}
        {id === 'radar' && (
          <div>
            <span className="etiqueta">Colores</span>
            <Segmentado
              etiqueta="Paleta del radar"
              valor={temaRadar}
              onCambiar={fijarTemaRadar}
              opciones={TEMAS_RADAR.map((o) => ({ valor: o.valor, texto: o.texto }))}
            />
            <p className="mt-1.5 text-[12px] text-tinta-suave">
              {temaRadar === 'estado'
                ? 'Rojo, ámbar y verde según la distancia al obstáculo.'
                : temaRadar === 'sensor'
                  ? 'Un tono por sensor: se ve de un golpe cuál de los tres detecta.'
                  : 'Más saturación y bordes marcados, para proyector o poca luz.'}
            </p>
          </div>
        )}
      </div>
      <button type="button" className="btn btn-acento mt-6 w-full" onClick={onCerrar}>
        Listo
      </button>
    </Modal>
  );
}

export function Panel() {
  const { robots, robot, cargando, error, recargar } = useRobots();
  const { robotId } = useSocket();
  const { layout, guardarLayout, alternar } = usePanelTarjetas();
  const { width, containerRef, mounted } = useContainerWidth();
  const marcoRef = useRef<HTMLDivElement>(null);
  const filaRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const [nuevoRobot, setNuevoRobot] = useState(false);
  const [editando, setEditando] = useState(false);
  const [widget, setWidget] = useState<IdTarjeta | null>(null);
  const [repeticion, setRepeticion] = useState<EstadoRepeticion | null>(null);

  const { data: resumen } = useQuery<Resumen>({
    queryKey: ['resumen', robotId],
    queryFn: () => api(`/api/dispositivos/${robotId}/resumen`),
    enabled: !!robotId,
    refetchInterval: 10_000,
  });

  // En una sola columna no hay nada que reordenar ni forma de que todo quepa sin scroll: los
  // tiradores solo estorbarían. Se decide con el ancho de la FILA, que no cambia al abrir el
  // cajón: con el de la grilla ya encogida, abrirlo bajaría del umbral y el panel entraría en
  // bucle (cierra edición → la grilla crece → vuelve a caber → abre edición → ...).
  const fila = useCajaMedida(filaRef);
  const puedeColocar = fila.ancho >= ANCHO_GRILLA;
  const edicionActiva = editando && puedeColocar;
  /** Ajustar a la ventana solo donde la grilla es de verdad una grilla. */
  const ajustar = puedeColocar && layout.length > 0;
  const altoMarco = useAltoLibre(marcoRef, ajustar);
  const { alto: altoArea } = useCajaMedida(areaRef);
  // Reparto fijo: FILAS filas y sus márgenes. No mira la disposición, así que arrastrar no
  // reescala el tablero. El suelo evita filas ilegibles en ventanas bajas, a costa de scroll.
  const altoFila =
    ajustar && altoArea ? Math.max(ALTO_FILA_MIN, (altoArea - (FILAS - 1) * MARGEN) / FILAS) : ALTO_FILA;

  if (cargando) {
    return (
      <div className="grid gap-4 xl:grid-cols-[58fr_42fr]">
        <Esqueleto className="h-[520px]" />
        <div className="grid gap-4">
          <Esqueleto className="h-[180px]" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Esqueleto className="h-[300px]" />
            <Esqueleto className="h-[300px]" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tarjeta">
        <ErrorConReintento mensaje={error.message} onReintentar={recargar} />
      </div>
    );
  }

  if (!robots.length) {
    return (
      <div className="tarjeta">
        <Vacio
          titulo="Conecta tu primer robot"
          descripcion="Dale de alta y te daremos sus credenciales MQTT y el config.py listo para el ESP32. Sin hardware a mano, el simulador vale igual."
          accion={
            <button type="button" className="btn btn-acento" onClick={() => setNuevoRobot(true)}>
              <Plus className="size-4" />
              Agregar robot
            </button>
          }
        />
        {nuevoRobot && <DialogoNuevoRobot onCerrar={() => setNuevoRobot(false)} />}
      </div>
    );
  }


  /** Una tarjeta por id. El alto del mapa es flexible: lo manda la celda de la grilla. */
  const tarjeta = (id: IdTarjeta) => {
    switch (id) {
      case 'mapa':
        return <TarjetaMapa vista="mapa" alto="min-h-0 flex-1" repeticion={repeticion} soloVista />;
      case 'radar':
        return <TarjetaMapa vista="radar" alto="min-h-0 flex-1" soloVista />;
      case 'sesiones':
        return <TarjetaSesiones repeticion={repeticion} onRepetir={setRepeticion} />;
      case 'estado':
        return <TarjetaEstado />;
      case 'conectividad':
        return <TarjetaConectividad pctPerdidas={resumen?.sesion?.pctPerdidas ?? null} />;
      case 'distancias':
        return <TarjetaDistancias />;
      case 'bateria':
        return <TarjetaBateria />;
      case 'evasion':
        return <TarjetaEvasion />;
    }
  };

  return (
    <div
      ref={marcoRef}
      className={`flex flex-col gap-3 ${ajustar ? 'overflow-hidden' : ''}`}
      style={ajustar && altoMarco ? { height: altoMarco } : undefined}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {edicionActiva && (
          <p className="mr-auto text-[13px] text-tinta-suave">
            Modo edición: arrastra los widgets, tira del borde para cambiarlos de tamaño y usa los botones de
            cada esquina para editarlo o quitarlo.
          </p>
        )}
        <button
          type="button"
          className={`btn btn-sm ${editando ? 'btn-acento' : ''}`}
          aria-pressed={editando}
          onClick={() => setEditando((v) => !v)}
        >
          {editando ? <Check className="size-4" /> : <LayoutGrid className="size-4" />}
          {editando ? 'Listo' : 'Editar panel'}
        </button>
      </div>

      <div ref={filaRef} className="flex min-h-0 flex-1 items-stretch gap-4">
        <div ref={areaRef} className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div ref={containerRef as React.RefObject<HTMLDivElement>} className="h-full">
            {mounted && layout.length > 0 && (
              <ResponsiveGridLayout
                width={width}
                className={edicionActiva ? 'panel-editando' : undefined}
                layouts={{ grande: layout }}
                // A mano, no por el ancho ya encogido: con el cajón abierto la grilla puede bajar
                // de ANCHO_GRILLA y colapsaría a una columna en plena edición.
                breakpoint={puedeColocar ? 'grande' : 'chico'}
                breakpoints={{ grande: ANCHO_GRILLA, chico: 0 }}
                cols={{ grande: COLUMNAS, chico: 1 }}
                rowHeight={altoFila}
                maxRows={ajustar ? FILAS : undefined}
                margin={[MARGEN, MARGEN]}
                containerPadding={[0, 0]}
                dragConfig={{ enabled: edicionActiva }}
                resizeConfig={{ enabled: edicionActiva, handles: ['se', 'e', 's'] }}
                onLayoutChange={(_actual, todos) => guardarLayout(todos.grande ?? [])}
              >
                {layout.map(({ i }) => {
                  const id = i as IdTarjeta;
                  const texto = TARJETAS_PANEL.find((t) => t.id === id)?.texto ?? id;
                  return (
                    <div key={i} className="widget-panel">
                      {tarjeta(id)}
                      {edicionActiva && (
                        <>
                          <div className="velo-editar" aria-hidden />
                          <div className="acciones-widget">
                            <button
                              type="button"
                              className="boton-widget"
                              aria-label={`Editar ${texto}`}
                              title={`Editar ${texto}`}
                              onClick={() => setWidget(id)}
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              className="boton-widget boton-widget-quitar"
                              aria-label={`Quitar ${texto}`}
                              title={`Quitar ${texto}`}
                              onClick={() => alternar(id)}
                            >
                              <X className="size-4" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </ResponsiveGridLayout>
            )}
          </div>
        </div>

        {edicionActiva && (
          <aside aria-label="Widgets" className="cajon-widgets" style={{ width: ANCHO_LATERAL }}>
            <h2 className="tarjeta-titulo mb-1 shrink-0">Widgets</h2>
            <div className="-mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
              <CajonWidgets vista={tarjeta} />
            </div>
          </aside>
        )}
      </div>

      {!layout.length && (
        <div className="tarjeta">
          <Vacio
            titulo="Panel vacío"
            descripcion="Has quitado todos los widgets."
            accion={
              <button type="button" className="btn btn-acento" onClick={() => setEditando(true)}>
                <LayoutGrid className="size-4" />
                Editar panel
              </button>
            }
          />
        </div>
      )}

      {robot && (
        <p className="shrink-0 px-2 text-[12px] text-tinta-suave">
          La posición del mapa es una estimación por odometría y acumula error con el tiempo. Pulsa «Detener» y
          vuelve a «Iniciar» para reiniciar el origen.
        </p>
      )}

      {nuevoRobot && <DialogoNuevoRobot onCerrar={() => setNuevoRobot(false)} />}
      {widget && <DialogoWidget id={widget} onCerrar={() => setWidget(null)} />}
      {/* Pantalla estrecha: no hay dónde colocar, pero sí qué mostrar y qué ocultar. */}
      {editando && !puedeColocar && (
        <Modal etiqueta="Widgets" ancho="max-w-sm" onCerrar={() => setEditando(false)}>
          <h2 className="tarjeta-titulo mb-1">Widgets</h2>
          <CajonWidgets />
          <button type="button" className="btn btn-acento mt-3 w-full" onClick={() => setEditando(false)}>
            Listo
          </button>
        </Modal>
      )}
    </div>
  );
}
