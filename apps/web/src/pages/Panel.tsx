// Panel principal. Las tarjetas viven en una grilla de react-grid-layout: cada cliente las
// mueve y redimensiona a su gusto y la disposición se guarda en su navegador (lib/panel.tsx).
//
// El arrastre y los tiradores solo se activan en "modo edición": las tarjetas tienen dentro
// mapas con pan y gráficas con zoom, y si el arrastre estuviera siempre activo pelearían por
// el mismo gesto. En modo edición un velo encima de cada tarjeta se queda con el ratón.
//
// Al entrar en edición la grilla cede ANCHO_LATERAL al cajón de widgets: al medir menos ancho
// las tarjetas se encogen solas (la grilla es proporcional), igual que en un escritorio móvil.
// Cada widget saca entonces sus controles de esquina: lápiz para su tamaño y cruz para quitarlo.
import React, { useState } from 'react';
import { Check, LayoutGrid, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveGridLayout, useContainerWidth } from 'react-grid-layout';
import { api } from '../lib/api.ts';
import {
  ALTO_FILA,
  ALTOS,
  ANCHO_GRILLA,
  ANCHO_GRILLA_EDICION,
  ANCHO_LATERAL,
  ANCHOS,
  COLUMNAS,
  MARGEN,
  TARJETAS_PANEL,
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

/**
 * Cajón de widgets del modo edición: arriba los que no están en el panel, para añadirlos de un
 * toque, y abajo los que sí. Es el mismo contenido en el lateral (escritorio) y en el modal
 * (pantalla estrecha, donde la grilla es de una columna y no hay nada que colocar).
 */
function CajonWidgets() {
  const { ve, alternar, restablecer, restablecerDisposicion, disposicionTocada, visibles } = usePanelTarjetas();
  const fuera = TARJETAS_PANEL.filter((t) => !ve(t.id));
  return (
    <>
      <p className="tarjeta-sub mb-3">
        Toca un widget para añadirlo o quitarlo. Arrástralos en el panel para colocarlos y tira del borde o de
        la esquina para cambiar su tamaño. Se guarda en este navegador.
      </p>
      <p className="mb-2 text-[12px] font-semibold tracking-wide text-tinta-suave uppercase">
        {fuera.length ? 'Para añadir' : 'En el panel'}
      </p>
      <ul className="space-y-1">
        {(fuera.length ? fuera : TARJETAS_PANEL).map(({ id, texto, Icono }) => (
          <li key={id}>
            <button
              type="button"
              className="chip w-full justify-start"
              onClick={() => alternar(id)}
              aria-label={`${ve(id) ? 'Quitar' : 'Añadir'} ${texto}`}
            >
              <span className="chip-icono">
                <Icono className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-left">{texto}</span>
              {ve(id) ? <X className="size-4 shrink-0 opacity-60" /> : <Plus className="size-4 shrink-0" />}
            </button>
          </li>
        ))}
      </ul>
      {!!fuera.length && !!visibles.length && (
        <p className="mt-3 text-[12px] text-tinta-suave">
          {visibles.length} widget{visibles.length === 1 ? '' : 's'} en el panel.
        </p>
      )}
      {!visibles.length && <p className="mt-3 text-[13px] text-precaucion">Sin widgets el panel queda vacío.</p>}
      <div className="mt-5 flex gap-2">
        <button type="button" className="btn btn-sm flex-1" onClick={restablecer} disabled={!fuera.length}>
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
  const { layout, fijarTamano } = usePanelTarjetas();
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

  const evasionesHoy =
    (resumen?.evasionesIzq ?? 0) + (resumen?.evasionesCentro ?? 0) + (resumen?.evasionesDer ?? 0);

  /** Una tarjeta por id. El alto del mapa es flexible: lo manda la celda de la grilla. */
  const tarjeta = (id: IdTarjeta) => {
    switch (id) {
      case 'mapa':
        return (
          <TarjetaMapa alto="min-h-0 flex-1" repeticion={repeticion} onSalirRepeticion={() => setRepeticion(null)} />
        );
      case 'sesiones':
        return <TarjetaSesiones repeticion={repeticion} onRepetir={setRepeticion} />;
      case 'estado':
        return <TarjetaEstado evasionesHoy={evasionesHoy} />;
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

  // En una sola columna no hay nada que reordenar: los tiradores solo estorbarían. El umbral se
  // mide sobre el ancho SIN cajón: si no, abrirlo encogería la grilla por debajo del umbral, eso
  // cerraría el modo edición, la grilla volvería a crecer... y el panel entraría en bucle.
  const anchoTotal = editando ? width + ANCHO_LATERAL + MARGEN : width;
  const puedeColocar = anchoTotal >= ANCHO_GRILLA;
  const edicionActiva = editando && puedeColocar;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
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

      <div className={edicionActiva ? 'flex items-start gap-4' : undefined}>
        <div ref={containerRef as React.RefObject<HTMLDivElement>} className="min-w-0 flex-1">
          {mounted && layout.length > 0 && (
            <ResponsiveGridLayout
              width={width}
              className={edicionActiva ? 'panel-editando' : undefined}
              layouts={{ grande: layout }}
              breakpoints={{ grande: edicionActiva ? ANCHO_GRILLA_EDICION : ANCHO_GRILLA, chico: 0 }}
              cols={{ grande: COLUMNAS, chico: 1 }}
              rowHeight={ALTO_FILA}
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

        {edicionActiva && (
          <aside
            aria-label="Widgets"
            className="tarjeta sticky top-4 max-h-[calc(100dvh-6rem)] shrink-0 overflow-y-auto"
            style={{ width: ANCHO_LATERAL }}
          >
            <h2 className="tarjeta-titulo mb-1">Widgets</h2>
            <CajonWidgets />
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
        <p className="px-2 pb-2 text-[12px] text-tinta-suave">
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
