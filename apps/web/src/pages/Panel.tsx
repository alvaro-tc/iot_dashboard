// Panel principal. La grilla replica la de la referencia:
//   fila 1: tarjeta grande (~58 %) + columna derecha con una tarjeta ancha y dos pequeñas
//   fila 2: tres tarjetas iguales
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
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
import { ErrorConReintento, Esqueleto, Vacio } from '../components/ui.tsx';

export function Panel() {
  const { robots, robot, cargando, error, recargar } = useRobots();
  const { robotId } = useSocket();
  const [nuevoRobot, setNuevoRobot] = useState(false);
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

  return (
    <div className="space-y-4">
      {/* ---- Fila 1 ---- */}
      <div className="grid gap-4 xl:grid-cols-[58fr_42fr]">
        {/* El mapa va primero también en móvil: es la pieza que se quiere ver. */}
        <TarjetaMapa repeticion={repeticion} onSalirRepeticion={() => setRepeticion(null)} />

        <div className="grid content-start gap-4">
          <TarjetaSesiones repeticion={repeticion} onRepetir={setRepeticion} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TarjetaEstado evasionesHoy={evasionesHoy} />
            <TarjetaConectividad pctPerdidas={resumen?.sesion?.pctPerdidas ?? null} />
          </div>
        </div>
      </div>

      {/* ---- Fila 2: tres tarjetas iguales ---- */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <TarjetaDistancias />
        <TarjetaBateria />
        <TarjetaEvasion />
      </div>

      {robot && (
        <p className="px-2 pb-2 text-[12px] text-tinta-suave">
          La posición del mapa es una estimación por odometría y acumula error con el tiempo. Pulsa «Detener» y
          vuelve a «Iniciar» para reiniciar el origen.
        </p>
      )}

      {nuevoRobot && <DialogoNuevoRobot onCerrar={() => setNuevoRobot(false)} />}
    </div>
  );
}
