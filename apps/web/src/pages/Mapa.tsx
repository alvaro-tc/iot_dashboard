// /mapa — el mapa a todo el ancho, con el radar pequeño al lado y los eventos en vivo.
import { useState } from 'react';
import { CONFIG_POR_DEFECTO, type EventoRobot } from '@iot/shared';
import { NOMBRE_EVENTO, haceCuanto } from '../lib/formato.ts';
import { useEventosRobot, useSocket, useUltimaLectura } from '../lib/socket.tsx';
import { RadarSensores } from '../components/RadarSensores.tsx';
import { TarjetaControl } from '../components/TarjetaControl.tsx';
import { TarjetaMapa } from '../components/TarjetaMapa.tsx';
import { Tarjeta, Vacio } from '../components/ui.tsx';

export function Mapa() {
  const { config } = useSocket();
  const lectura = useUltimaLectura(4);
  const [eventos, setEventos] = useState<EventoRobot[]>([]);
  useEventosRobot((e) => setEventos((xs) => [e, ...xs].slice(0, 40)));

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <TarjetaMapa alto="h-[380px] sm:h-[560px]" />

      <div className="grid content-start gap-4">
        <TarjetaControl />

        <Tarjeta titulo="Radar" subtitulo="Lo que ven los sensores ahora">
          <div className="h-[240px] overflow-hidden rounded-[1.25rem] bg-[#0f172a]">
            <RadarSensores config={config ?? CONFIG_POR_DEFECTO} lectura={lectura} />
          </div>
        </Tarjeta>

        <Tarjeta titulo="Eventos en vivo" subtitulo="Llegan por WebSocket">
          {eventos.length === 0 ? (
            <Vacio titulo="Sin eventos" descripcion="Aquí aparecerá cada obstáculo, atasco o desconexión." />
          ) : (
            <ul className="max-h-[320px] divide-y divide-borde overflow-y-auto">
              {eventos.map((e, i) => (
                <li key={`${e.creadoEn}-${i}`} className="py-2.5 first:pt-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium">{NOMBRE_EVENTO[e.tipo]}</span>
                    <span className="shrink-0 text-[12px] text-tinta-suave">{haceCuanto(e.creadoEn)}</span>
                  </div>
                  <p className="text-[13px] text-tinta-suave">{e.mensaje}</p>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>
    </div>
  );
}
