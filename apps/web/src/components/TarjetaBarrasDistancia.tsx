// "Barras de distancia": las últimas N lecturas de un sensor ultrasónico como barras, la más
// reciente a la derecha. Sirve para cualquiera de los tres (izquierdo/central/derecho): qué
// sensor y cuántas barras se eligen al editar el widget (lápiz del modo edición), así que es
// un solo componente reutilizable y no uno por sensor.
//
// Sin objeto en rango la lectura es `null`: se dibuja una barra mínima gris con un guion en vez
// de inventar un cero, igual que el resto del dashboard (TarjetaDistancias, TarjetaRadar...).
import { DIST_VISTA_CM, estadoDistancia, distanciaDe, type Lectura } from '@iot/shared';
import { useEffect, useRef, useState } from 'react';
import { distancia as fmtDistancia, NOMBRE_SENSOR } from '../lib/formato.ts';
import { BARRAS_POR_DEFECTO, usePanelTarjetas, type IdTarjeta } from '../lib/panel.tsx';
import { useSocket, useTelemetria } from '../lib/socket.tsx';
import { Tarjeta } from './ui.tsx';

const COLOR_ESTADO = {
  libre: 'bg-libre',
  precaucion: 'bg-precaucion',
  evasion: 'bg-evasion',
} as const;

export function TarjetaBarrasDistancia({ id }: { id: IdTarjeta }) {
  const { barras } = usePanelTarjetas();
  const { sensor, n } = barras[id] ?? BARRAS_POR_DEFECTO;
  const { idConexion, historial } = useSocket();
  const [valores, setValores] = useState<(number | null)[]>([]);
  const valoresRef = useRef<(number | null)[]>([]);

  const agregar = (d: number | null) => {
    valoresRef.current = [...valoresRef.current, d].slice(-n);
    setValores(valoresRef.current);
  };

  useTelemetria((l: Lectura) => agregar(distanciaDe(l, sensor)));

  // Al conectar o al cambiar de sensor/cantidad, se parte del historial en memoria.
  useEffect(() => {
    valoresRef.current = historial().slice(-n).map((l) => distanciaDe(l, sensor));
    setValores(valoresRef.current);
  }, [idConexion, sensor, n]); // eslint-disable-line react-hooks/exhaustive-deps

  const ultimo = valores.at(-1) ?? null;
  // Barras a la derecha, huecos (sin lectura todavía) a la izquierda: se rellena el hueco
  // delante en vez de desplazar índices al vuelo.
  const fila: (number | null | undefined)[] = [...Array(Math.max(0, n - valores.length)).fill(undefined), ...valores];

  return (
    <Tarjeta titulo={`Distancia ${NOMBRE_SENSOR[sensor]}`} subtitulo={fmtDistancia(ultimo)}>
      <div className="flex h-full min-h-0 items-end gap-1">
        {fila.map((d, i) => {
          const estado = d === undefined ? null : estadoDistancia(d);
          const alto = d == null ? 6 : Math.max(6, Math.min(100, (d / DIST_VISTA_CM) * 100));
          return (
            <div
              key={i}
              title={d == null ? 'sin objeto en rango' : fmtDistancia(d)}
              className={`flex-1 rounded-t transition-[height] duration-150 ${estado ? COLOR_ESTADO[estado] : 'bg-borde'}`}
              style={{ height: `${alto}%` }}
            />
          );
        })}
      </div>
    </Tarjeta>
  );
}
