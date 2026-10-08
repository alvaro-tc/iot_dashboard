// Panel principal. Las tarjetas viven en una grilla de react-grid-layout: cada cliente las
// mueve y redimensiona a su gusto y la disposición se guarda en su navegador (lib/panel.tsx).
//
// El arrastre y los tiradores solo se activan en "modo edición": las tarjetas tienen dentro
// mapas con pan y gráficas con zoom, y si el arrastre estuviera siempre activo pelearían por
// el mismo gesto. En modo edición un velo encima de cada tarjeta se queda con el ratón.
import React, { useState } from 'react';
import { Check, LayoutGrid, Move, Plus, RotateCcw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveGridLayout, useContainerWidth } from 'react-grid-layout';
import { api } from '../lib/api.ts';
import {
  ALTO_FILA,
  ANCHO_GRILLA,
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
import { ErrorConReintento, Esqueleto, Interruptor, Modal, Vacio } from '../components/ui.tsx';

/** Elige qué tarjetas se ven. El cambio se aplica al momento: el panel lee el contexto. */
function DialogoPersonalizar({ onCerrar }: { onCerrar: () => void }) {
  const { ve, alternar, restablecer, restablecerDisposicion, disposicionTocada, visibles } = usePanelTarjetas();
  return (
    <Modal etiqueta="Personalizar panel" ancho="max-w-sm" onCerrar={onCerrar}>
      <h2 className="tarjeta-titulo mb-1">Personalizar panel</h2>
      <p className="tarjeta-sub mb-5">
        Elige qué tarjetas quieres ver. Para moverlas o cambiarlas de tamaño usa «Mover». Se guarda en este
        navegador.
      </p>
      <ul className="space-y-1">
        {TARJETAS_PANEL.map(({ id, texto, Icono }) => (
          <li key={id} className="flex items-center justify-between gap-4 rounded-2xl px-1 py-2">
            <span className="flex min-w-0 items-center gap-3">
              <span className="chip-icono">
                <Icono className="size-3.5" />
              </span>
              <span className="truncate text-[14px] font-medium">{texto}</span>
            </span>
            <Interruptor activo={ve(id)} onCambiar={() => alternar(id)} etiqueta={`Mostrar ${texto}`} />
          </li>
        ))}
      </ul>
      {!visibles.length && <p className="mt-4 text-[13px] text-precaucion">Sin tarjetas el panel queda vacío.</p>}
      <div className="mt-6 grid gap-2">
        <div className="flex gap-2">
          <button type="button" className="btn flex-1" onClick={restablecer}>
            Mostrar todas
          </button>
          <button type="button" className="btn flex-1" onClick={restablecerDisposicion} disabled={!disposicionTocada}>
            <RotateCcw className="size-4" />
            Disposición original
          </button>
        </div>
        <button type="button" className="btn btn-acento" onClick={onCerrar}>
          Listo
        </button>
      </div>
    </Modal>
  );
}

export function Panel() {
  const { robots, robot, cargando, error, recargar } = useRobots();
  const { robotId } = useSocket();
  const { layout, guardarLayout } = usePanelTarjetas();
  const { width, containerRef, mounted } = useContainerWidth();
  const [nuevoRobot, setNuevoRobot] = useState(false);
  const [personalizar, setPersonalizar] = useState(false);
  const [editando, setEditando] = useState(false);
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

  // En una sola columna no hay nada que reordenar: los tiradores solo estorbarían.
  const puedeEditar = width >= ANCHO_GRILLA;
  const edicionActiva = editando && puedeEditar;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {edicionActiva && (
          <p className="mr-auto text-[13px] text-tinta-suave">
            Arrastra las tarjetas para colocarlas y tira del borde o de la esquina para cambiar su tamaño.
          </p>
        )}
        {puedeEditar && (
          <button
            type="button"
            className={`btn btn-sm ${editando ? 'btn-acento' : ''}`}
            aria-pressed={editando}
            onClick={() => setEditando((v) => !v)}
          >
            {editando ? <Check className="size-4" /> : <Move className="size-4" />}
            {editando ? 'Listo' : 'Mover'}
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={() => setPersonalizar(true)}>
          <LayoutGrid className="size-4" />
          Personalizar
        </button>
      </div>

      <div ref={containerRef as React.RefObject<HTMLDivElement>}>
        {mounted && layout.length > 0 && (
          <ResponsiveGridLayout
            width={width}
            className={edicionActiva ? 'panel-editando' : undefined}
            layouts={{ grande: layout }}
            breakpoints={{ grande: ANCHO_GRILLA, chico: 0 }}
            cols={{ grande: COLUMNAS, chico: 1 }}
            rowHeight={ALTO_FILA}
            margin={[MARGEN, MARGEN]}
            containerPadding={[0, 0]}
            dragConfig={{ enabled: edicionActiva }}
            resizeConfig={{ enabled: edicionActiva, handles: ['se', 'e', 's'] }}
            onLayoutChange={(_actual, todos) => guardarLayout(todos.grande ?? [])}
          >
            {layout.map(({ i }) => (
              <div key={i} className="widget-panel">
                {tarjeta(i as IdTarjeta)}
                {edicionActiva && <div className="velo-editar" aria-hidden />}
              </div>
            ))}
          </ResponsiveGridLayout>
        )}
      </div>

      {!layout.length && (
        <div className="tarjeta">
          <Vacio
            titulo="Panel vacío"
            descripcion="Has ocultado todas las tarjetas."
            accion={
              <button type="button" className="btn btn-acento" onClick={() => setPersonalizar(true)}>
                Personalizar
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
      {personalizar && <DialogoPersonalizar onCerrar={() => setPersonalizar(false)} />}
    </div>
  );
}
