// "Barras de distancia": dos modos sobre el mismo dibujo (una barra por lectura, roja si está
// muy cerca). `sensores` son las 3 barras en vivo, una por sensor ultrasónico, siempre al día
// con la última lectura. `historial` son las últimas N lecturas de UN sensor a elegir, para ver
// cómo varió en el tiempo. Cuál de los dos se elige al editar el widget (lápiz del modo edición).
//
// Sin objeto en rango la lectura es `null`: se dibuja una barra mínima gris con un guion en vez
// de inventar un cero, igual que el resto del dashboard (TarjetaDistancias, TarjetaRadar...).
import {
  DIST_VISTA_CM,
  SENSORES,
  SENSORES_DE,
  estadoDistancia,
  distanciaDe,
  type EstadoDistancia,
  type Lectura,
} from '@iot/shared';
import { useEffect, useRef, useState } from 'react';
import { distancia as fmtDistancia, NOMBRE_SENSOR } from '../lib/formato.ts';
import { BARRAS_POR_DEFECTO, usePanelTarjetas, type IdTarjeta } from '../lib/panel.tsx';
import { useSocket, useTelemetria, useUltimaLectura } from '../lib/socket.tsx';
import { Tarjeta } from './ui.tsx';

const COLOR_ESTADO: Record<EstadoDistancia, string> = {
  libre: 'bg-libre',
  precaucion: 'bg-precaucion',
  evasion: 'bg-evasion',
};

/** Una barra: alto proporcional a la distancia, gris y mínima si no hay lectura. */
function Barra({ d, etiqueta }: { d: number | null | undefined; etiqueta: string }) {
  const estado = d === undefined ? null : estadoDistancia(d);
  const alto = d == null ? 6 : Math.max(6, Math.min(100, (d / DIST_VISTA_CM) * 100));
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-end gap-1">
      <div
        title={d == null ? 'sin objeto en rango' : fmtDistancia(d)}
        className={`w-full rounded-t transition-[height] duration-150 ${estado ? COLOR_ESTADO[estado] : 'bg-borde'}`}
        style={{ height: `${alto}%` }}
      />
      <span className="shrink-0 truncate text-[11px] text-tinta-suave">{etiqueta}</span>
    </div>
  );
}

/** Modo en vivo: una barra por sensor, siempre con la lectura más reciente del robot. */
function BarrasSensores() {
  const lectura = useUltimaLectura(4);
  const datos = lectura ? SENSORES_DE(lectura) : [];
  return (
    <div className="flex h-full min-h-0 items-stretch gap-2">
      {datos.length
        ? datos.map(({ sensor, d }) => <Barra key={sensor} d={d} etiqueta={NOMBRE_SENSOR[sensor]} />)
        : SENSORES.map((s) => <Barra key={s} d={undefined} etiqueta={NOMBRE_SENSOR[s]} />)}
    </div>
  );
}

/** Modo historial: las últimas N lecturas de un solo sensor, la más reciente a la derecha. */
function BarrasHistorial({ id }: { id: IdTarjeta }) {
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

  // Huecos (sin lectura todavía) a la izquierda: la barra más reciente queda siempre a la
  // derecha en vez de desplazar índices al vuelo.
  const fila: (number | null | undefined)[] = [...Array(Math.max(0, n - valores.length)).fill(undefined), ...valores];

  return (
    <div className="flex h-full min-h-0 items-stretch gap-1">
      {fila.map((d, i) => (
        <Barra key={i} d={d} etiqueta="" />
      ))}
    </div>
  );
}

export function TarjetaBarrasDistancia({ id }: { id: IdTarjeta }) {
  const { barras } = usePanelTarjetas();
  const cfg = barras[id] ?? BARRAS_POR_DEFECTO;

  if (cfg.modo === 'sensores') {
    return (
      <Tarjeta titulo="Distancias en vivo" subtitulo="Los 3 sensores">
        <BarrasSensores />
      </Tarjeta>
    );
  }
  return (
    <Tarjeta titulo={`Distancia ${NOMBRE_SENSOR[cfg.sensor]}`} subtitulo={`Últimas ${cfg.n} lecturas`}>
      <BarrasHistorial id={id} />
    </Tarjeta>
  );
}
