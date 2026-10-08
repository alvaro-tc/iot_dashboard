// "Batería": equivale a la tarjeta del Bluetooth Speaker de la referencia.
// Gauge semicircular (doughnut con circumference 180) y chip de voltaje. Es de solo vista: el
// modo de ahorro de energía se cambia desde el control del robot (/mapa).
import { useEffect, useRef } from 'react';
import { Chart } from '../lib/chart.ts';
import { voltios } from '../lib/formato.ts';
import { useUltimaLectura } from '../lib/socket.tsx';
import { useColoresTema } from '../lib/tema.tsx';
import { Chip, Tarjeta } from './ui.tsx';

function Gauge({ pct, color }: { pct: number; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const colores = useColoresTema();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Carga', 'Restante'],
        datasets: [{ data: [pct, 100 - pct], backgroundColor: [color, colores.borde], borderWidth: 0 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // Semicírculo abierto hacia arriba, como el dial de la referencia.
        circumference: 180,
        rotation: -90,
        cutout: '72%',
        animation: { duration: 300 },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
    });
    chartRef.current = chart;
    return () => {
      chart.destroy();
      chartRef.current = null;
    };
  }, [colores.borde]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data.datasets[0].data = [pct, 100 - pct];
    chart.data.datasets[0].backgroundColor = [color, colores.borde];
    chart.update();
  }, [pct, color, colores.borde]);

  return <canvas ref={canvasRef} role="img" aria-label={`Batería al ${Math.round(pct)} por ciento`} />;
}

export function TarjetaBateria() {
  const lectura = useUltimaLectura(1);
  const colores = useColoresTema();

  const pct = lectura?.bateriaPct ?? 0;
  const color = pct < 20 ? colores.evasion : pct < 50 ? colores.precaucion : colores.libre;

  return (
    <Tarjeta titulo="Batería" pie={lectura?.bateriaV != null ? <Chip>{voltios(lectura.bateriaV)}</Chip> : undefined}>
      <div className="flex h-full min-h-0 items-center justify-center">
        {/* El semicírculo ocupa 2:1, así que la caja lo es también: el centro del dial
            cae en su borde inferior y el número se alinea justo encima. */}
        <div className="relative aspect-[2/1] w-full max-w-[220px]">
          <Gauge pct={pct} color={color} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 text-center">
            <p className="text-[34px] leading-none font-bold tabular-nums">{Math.round(pct)}</p>
            <p className="text-[13px] leading-tight text-tinta-suave">por ciento</p>
          </div>
        </div>
      </div>
    </Tarjeta>
  );
}
