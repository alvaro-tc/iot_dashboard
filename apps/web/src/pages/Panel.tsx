// Panel principal. La grilla replica la de la referencia:
//   fila 1: tarjeta grande (~58 %) + columna derecha con una tarjeta ancha y dos pequeñas
//   fila 2: tres tarjetas iguales
import { useState } from 'react';
import { LayoutGrid, Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { TARJETAS_PANEL, usePanelTarjetas, type IdTarjeta } from '../lib/panel.tsx';
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
  const { ve, alternar, restablecer, visibles } = usePanelTarjetas();
  return (
    <Modal etiqueta="Personalizar panel" ancho="max-w-sm" onCerrar={onCerrar}>
      <h2 className="tarjeta-titulo mb-1">Personalizar panel</h2>
      <p className="tarjeta-sub mb-5">Elige qué tarjetas quieres ver. Se guarda en este navegador.</p>
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
      {!visibles.length && (
        <p className="mt-4 text-[13px] text-precaucion">Sin tarjetas el panel queda vacío.</p>
      )}
      <div className="mt-6 flex gap-2">
        <button type="button" className="btn flex-1" onClick={restablecer}>
          Mostrar todas
        </button>
        <button type="button" className="btn btn-acento flex-1" onClick={onCerrar}>
          Listo
        </button>
      </div>
    </Modal>
  );
}

export function Panel() {
  const { robots, robot, cargando, error, recargar } = useRobots();
  const { robotId } = useSocket();
  const { ve } = usePanelTarjetas();
  const [nuevoRobot, setNuevoRobot] = useState(false);
  const [personalizar, setPersonalizar] = useState(false);
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

  const columnaDerecha = (['sesiones', 'estado', 'conectividad'] as IdTarjeta[]).some(ve);
  const filaInferior = (['distancias', 'bateria', 'evasion'] as IdTarjeta[]).filter(ve);

  const evasionesHoy =
    (resumen?.evasionesIzq ?? 0) + (resumen?.evasionesCentro ?? 0) + (resumen?.evasionesDer ?? 0);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" className="btn btn-sm" onClick={() => setPersonalizar(true)}>
          <LayoutGrid className="size-4" />
          Personalizar
        </button>
      </div>

      {/* ---- Fila 1: dos columnas solo si el mapa y algo de la derecha están visibles ---- */}
      {(ve('mapa') || columnaDerecha) && (
        <div className={`grid gap-4 ${ve('mapa') && columnaDerecha ? 'xl:grid-cols-[58fr_42fr]' : ''}`}>
          {/* El mapa va primero también en móvil: es la pieza que se quiere ver. */}
          {ve('mapa') && <TarjetaMapa repeticion={repeticion} onSalirRepeticion={() => setRepeticion(null)} />}

          {columnaDerecha && (
            <div className="grid content-start gap-4">
              {ve('sesiones') && <TarjetaSesiones repeticion={repeticion} onRepetir={setRepeticion} />}
              {(ve('estado') || ve('conectividad')) && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {ve('estado') && <TarjetaEstado evasionesHoy={evasionesHoy} />}
                  {ve('conectividad') && (
                    <TarjetaConectividad pctPerdidas={resumen?.sesion?.pctPerdidas ?? null} />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---- Fila 2: tres tarjetas iguales ---- */}
      {filaInferior.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ve('distancias') && <TarjetaDistancias />}
          {ve('bateria') && <TarjetaBateria />}
          {ve('evasion') && <TarjetaEvasion />}
        </div>
      )}

      {!ve('mapa') && !columnaDerecha && !filaInferior.length && (
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
