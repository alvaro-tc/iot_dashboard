// "Actividad del motor": la velocidad de una rueda a lo largo del tiempo, con su signo, y el
// tiempo que esa rueda lleva en marcha. Sustituye al antiguo widget "Uso motor", que solo
// dibujaba el acumulado de la ventana en vivo y no decía hacia dónde giraba.
//
// La línea cruza el cero: por encima el motor empuja hacia adelante, por debajo retrocede, y
// el tramo se colorea según su signo, así que girar (una rueda a cada lado) se ve de un golpe.
//
// La ventana se elige al editar el widget (lápiz del modo edición):
//   - En vivo: la telemetría que el socket tiene en memoria, a 2 Hz. PWM instantáneo.
//   - Hoy / Total: agregados de Postgres (por minuto y por hora), con el PWM medio CON signo
//     de cada tramo. Se refrescan solos cada 30 s, así que el widget sigue vivo igual.
import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PWM_MAX } from '@iot/shared';
import { api } from '../lib/api.ts';
import { Chart } from '../lib/chart.ts';
import { duracion } from '../lib/formato.ts';
import {
  AGREGACION,
  NOMBRE_MOTOR,
  segundosMarcha,
  usoAcumulado,
  velocidadAgregada,
  velocidadEnVivo,
  type Alcance,
  type Motor,
  type Punto,
} from '../lib/metricas.ts';
import { useSocket, useUltimaLectura } from '../lib/socket.tsx';
import { useColoresTema } from '../lib/tema.tsx';
import type { LecturaAgregada } from '../lib/types.ts';
import { Tarjeta } from './ui.tsx';

const ETIQUETA: Record<Alcance, string> = {
  vivo: 'Velocidad en vivo',
  hoy: 'Velocidad media por minuto, hoy',
  total: 'Velocidad media por hora, todo el historial',
};

/** Desde cuándo pedir los agregados. "Total" = la vida del robot, que nadie tiene de 1970. */
const desdeDe = (alcance: Alcance) =>
  alcance === 'hoy' ? new Date(new Date().setHours(0, 0, 0, 0)).toISOString() : '1970-01-01T00:00:00.000Z';

/** PWM a texto con dirección: es lo que responde "¿adelante o atrás?" sin mirar el eje. */
const sentido = (v: number | null) =>
  v === null ? '—' : Math.abs(v) < 1 ? 'parado' : `${v > 0 ? 'adelante' : 'atrás'} ${Math.abs(Math.round(v))}`;

export function TarjetaActividadMotor({ motor, alcance }: { motor: Motor; alcance: Alcance }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const colores = useColoresTema();
  const { historial, robotId } = useSocket();
  // 2 Hz: lo que redibuja la ventana en vivo. En las otras ventanas manda el refetch.
  useUltimaLectura(2);

  const envivo = alcance === 'vivo';
  const { data: filas } = useQuery<LecturaAgregada[]>({
    queryKey: ['actividad-motor', robotId, alcance],
    queryFn: () =>
      api(`/api/dispositivos/${robotId}/lecturas?agregacion=${AGREGACION[alcance as 'hoy' | 'total']}&desde=${desdeDe(alcance)}`),
    enabled: !!robotId && !envivo,
    refetchInterval: 30_000,
  });

  const lecturas = historial();
  const agregadas = filas ?? [];
  const serie: Punto[] = envivo ? velocidadEnVivo(lecturas, motor) : velocidadAgregada(agregadas, motor);
  const segundos = envivo
    ? (usoAcumulado(lecturas, motor).at(-1)?.y ?? 0)
    : segundosMarcha(agregadas, motor);
  const ultimo = serie.at(-1)?.y ?? null;

  const adelante = motor === 'izquierdo' ? colores.acento : '#60a5fa';
  const atras = colores.precaucion;
  /** Techo del eje: el PWM máximo en vivo, y lo que dé la media en los agregados. */
  const techo = useMemo(() => {
    const max = serie.reduce((a, p) => Math.max(a, Math.abs(p.y ?? 0)), 0);
    return envivo ? PWM_MAX : Math.max(40, Math.ceil(max / 20) * 20);
  }, [serie, envivo]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Velocidad',
            data: [],
            borderColor: adelante,
            borderWidth: 2,
            pointRadius: 0,
            spanGaps: false,
            fill: 'origin',
            // Un color por tramo según su signo: retroceder se ve sin leer el eje.
            segment: {
              borderColor: (ctx) => ((ctx.p0.parsed.y ?? 0) < 0 ? atras : adelante),
            },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) =>
                new Date(Number(items[0].parsed.x)).toLocaleString('es', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                  ...(alcance === 'vivo' ? { second: '2-digit' } : {}),
                }),
              label: (item) => `${NOMBRE_MOTOR[motor]}: ${sentido(item.parsed.y)}`,
            },
          },
          // El cero no es una línea más de la rejilla: es la frontera entre adelante y atrás.
          annotation: {
            annotations: {
              cero: { type: 'line', yMin: 0, yMax: 0, borderColor: colores.tintaSuave, borderWidth: 1 },
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            grid: { display: false },
            border: { color: colores.borde },
            ticks: {
              color: colores.tintaSuave,
              maxTicksLimit: 5,
              callback: (v) =>
                new Date(Number(v)).toLocaleString(
                  'es',
                  alcance === 'total'
                    ? { day: '2-digit', month: 'short' }
                    : { hour: '2-digit', minute: '2-digit' },
                ),
            },
          },
          y: {
            min: -techo,
            max: techo,
            grid: { color: colores.borde },
            border: { display: false },
            // Sin signo en el eje: el signo lo dice el lado del cero, y "-180" repetido ensucia.
            ticks: { color: colores.tintaSuave, maxTicksLimit: 5, callback: (v) => String(Math.abs(Number(v))) },
          },
        },
      },
    });
    chartRef.current = chart;
    return () => {
      chart.destroy();
      chartRef.current = null;
    };
  }, [colores.tema, adelante, atras, alcance, techo, motor]); // eslint-disable-line react-hooks/exhaustive-deps

  // La serie se recalcula en cada render; aquí solo se le pasa a la gráfica.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data.datasets[0].data = serie;
    chart.update('none');
  });

  return (
    <Tarjeta
      titulo={`Actividad motor ${NOMBRE_MOTOR[motor]}`}
      subtitulo={`${ETIQUETA[alcance]} · ${duracion(segundos)} en marcha`}
    >
      <div className="h-full">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Motor ${NOMBRE_MOTOR[motor]}: ${sentido(ultimo)} de ${PWM_MAX}, ${duracion(segundos)} en marcha (${ETIQUETA[alcance]})`}
        />
      </div>
    </Tarjeta>
  );
}
