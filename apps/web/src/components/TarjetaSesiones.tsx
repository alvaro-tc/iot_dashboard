// "Sesiones": las últimas sesiones del robot, de la más reciente a la más antigua.
//
// Antes esta tarjeta reproducía el recorrido sobre el mapa. La base ya no guarda la pose del
// robot, así que no hay trayectoria que repetir: lo que queda de cada sesión es cuánto duró,
// cuántas lecturas llegaron, cuánto tiempo estuvo en marcha y qué batería gastó.
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { duracion, fechaHora, pct } from '../lib/formato.ts';
import { INTERVALO_TELEMETRIA_MS } from '../lib/metricas.ts';
import { useRobots } from '../lib/robots.tsx';
import type { ResumenSesion } from '../lib/types.ts';
import { Badge, Esqueleto, Tarjeta, Vacio } from './ui.tsx';

/** Segundos en marcha de una sesión: cada lectura con PWM vale un intervalo de telemetría. */
const segundosEnMarcha = (s: ResumenSesion) => ((s.lecturasEnMarcha ?? 0) * INTERVALO_TELEMETRIA_MS) / 1000;

export function TarjetaSesiones() {
  const { robot } = useRobots();

  const { data: sesiones, isLoading } = useQuery<ResumenSesion[]>({
    queryKey: ['sesiones', robot?.id],
    queryFn: () => api(`/api/dispositivos/${robot!.id}/sesiones`),
    enabled: !!robot,
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <Tarjeta titulo="Sesiones">
        <Esqueleto className="h-[132px]" />
      </Tarjeta>
    );
  }

  const lista = (sesiones ?? []).filter((s) => s.lecturas > 0);

  if (!lista.length) {
    return (
      <Tarjeta titulo="Sesiones" subtitulo="Historial de actividad">
        <Vacio
          titulo="Todavía no hay sesiones"
          descripcion="En cuanto el robot empiece a publicar telemetría, aquí aparecerá cada ciclo de actividad."
        />
      </Tarjeta>
    );
  }

  return (
    <Tarjeta titulo="Sesiones" subtitulo={`Últimas ${Math.min(lista.length, 6)} de ${lista.length}`}>
      <ul className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto pr-1">
        {lista.slice(0, 6).map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between gap-3 rounded-2xl bg-tarjeta-tenue px-3 py-2 text-[13px]"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-tinta">{fechaHora(s.iniciadaEn)}</p>
              <p className="truncate text-tinta-suave">
                {duracion(s.duracionS)} · {duracion(segundosEnMarcha(s))} en marcha ·{' '}
                {s.lecturas.toLocaleString('es')} lecturas
                {s.bateriaConsumidaPorcentaje !== null && ` · ${pct(s.bateriaConsumidaPorcentaje)} batería`}
              </p>
            </div>
            {s.finalizadaEn === null && <Badge tono="ok">En curso</Badge>}
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}
