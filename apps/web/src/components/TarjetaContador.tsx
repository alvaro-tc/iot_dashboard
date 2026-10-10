// "Contador": un número grande y nada más. Lo que cuenta se elige al editar el widget (lápiz
// del modo edición) de entre el catálogo de lib/metricas.ts, y se pueden poner varios con
// métricas distintas: el tiempo de motores de hoy, la batería, las lecturas de la sesión...
//
// Todos los contadores comparten una sola consulta de resumen con el panel (misma queryKey),
// así que tener cuatro no son cuatro peticiones.
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { metrica } from '../lib/metricas.ts';
import { usePanelTarjetas, type IdTarjeta } from '../lib/panel.tsx';
import { useSocket, useUltimaLectura } from '../lib/socket.tsx';
import type { Resumen } from '../lib/types.ts';
import { Tarjeta } from './ui.tsx';

/** El resumen del robot, refrescado cada 10 s. Compartido por el panel y los contadores. */
export function useResumen() {
  const { robotId } = useSocket();
  return useQuery<Resumen>({
    queryKey: ['resumen', robotId],
    queryFn: () => api(`/api/dispositivos/${robotId}/resumen`),
    enabled: !!robotId,
    refetchInterval: 10_000,
  });
}


export function TarjetaContador({ id }: { id: IdTarjeta }) {
  const { metricas } = usePanelTarjetas();
  const { historial } = useSocket();
  const { data: resumen } = useResumen();
  // El resumen del servidor llega cada 10 s, pero las metricas en vivo (motores, duracion de
  // la sesion) cambian antes: este 1 Hz es lo que las mantiene al dia.
  useUltimaLectura(1);
  const m = metrica(metricas[id]);
  // Sin resumen todavía: el hueco se rellena con un guion, no con un cero que parecería real.
  const texto = resumen
    ? m.calc({ resumen, lecturas: historial(), ahora: Date.now() })
    : '—';

  return (
    <Tarjeta titulo={m.texto} subtitulo={m.alcance}>
      <div className="flex h-full min-h-0 items-center justify-center">
        {/* Encoge con el ancho de la tarjeta: un contador de 3 columnas no puede usar 40 px. */}
        <p className="truncate text-[clamp(22px,8cqw,40px)] leading-none font-bold tabular-nums">{texto}</p>
      </div>
    </Tarjeta>
  );
}
