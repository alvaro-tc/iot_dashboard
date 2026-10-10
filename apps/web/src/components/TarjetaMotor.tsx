// "Uso del motor": cuánto tiempo lleva en marcha cada rueda. Un widget por motor (el panel
// monta este mismo componente con `motor="izquierdo"` y `motor="derecho"`).
//
// La línea es el tiempo acumulado en marcha, así que solo sube: los tramos planos son el
// robot parado y las cuestas, trabajo del motor. Se recalcula entera desde el historial que
// el socket ya tiene en memoria (lib/metricas.ts), así que no hay contador propio que se
// desincronice al ocultar y volver a mostrar el widget.
//
// Ventana: la del historial del socket (~2 min). El total del día va en el widget contador,
// que lo saca del servidor; aquí interesa la forma, no el acumulado histórico.
import { useEffect, useRef } from 'react';
import { Chart } from '../lib/chart.ts';
import { duracion } from '../lib/formato.ts';
import { NOMBRE_MOTOR, usoAcumulado, type Motor } from '../lib/metricas.ts';
import { useSocket, useUltimaLectura } from '../lib/socket.tsx';
import { useColoresTema } from '../lib/tema.tsx';
import { Tarjeta } from './ui.tsx';

/** Eje Y: segundos hasta los dos minutos, luego minutos. "132 s" se lee peor que "2,2 min". */
const tiempoCorto = (s: number) => (s < 120 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);

export function TarjetaMotor({ motor }: { motor: Motor }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const colores = useColoresTema();
  const { historial } = useSocket();
  // 2 Hz basta: la serie es acumulada, no da saltos. Este render es lo que redibuja la gráfica.
  useUltimaLectura(2);

  const serie = usoAcumulado(historial(), motor);
  const total = serie.at(-1)?.y ?? 0;
  const color = motor === 'izquierdo' ? colores.acento : '#60a5fa';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'En marcha',
            data: [],
            borderColor: color,
            backgroundColor: `${color}22`,
            borderWidth: 2,
            pointRadius: 0,
            fill: true,
            stepped: false,
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
              title: (items) => new Date(Number(items[0].parsed.x)).toLocaleTimeString('es'),
              label: (item) => `En marcha: ${duracion(item.parsed.y)}`,
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
              callback: (v) => new Date(Number(v)).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
            },
          },
          y: {
            min: 0,
            suggestedMax: 10,
            grid: { color: colores.borde },
            border: { display: false },
            ticks: { color: colores.tintaSuave, maxTicksLimit: 5, callback: (v) => tiempoCorto(Number(v)) },
          },
        },
      },
    });
    chartRef.current = chart;
    return () => {
      chart.destroy();
      chartRef.current = null;
    };
  }, [colores.tema, color]); // eslint-disable-line react-hooks/exhaustive-deps

  // La serie se recalcula en cada render (2 Hz); aquí solo se le pasa a la gráfica.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data.datasets[0].data = serie;
    chart.update('none');
  });

  return (
    <Tarjeta titulo={`Uso motor ${NOMBRE_MOTOR[motor]}`} subtitulo="Tiempo en marcha acumulado">
      <div className="h-full">
        <canvas ref={canvasRef} role="img" aria-label={`Motor ${NOMBRE_MOTOR[motor]}: ${duracion(total)} en marcha`} />
      </div>
    </Tarjeta>
  );
}
