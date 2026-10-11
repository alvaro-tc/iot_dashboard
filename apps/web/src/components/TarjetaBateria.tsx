// "Batería": equivale a la tarjeta del Bluetooth Speaker de la referencia.
// Gauge semicircular (doughnut con circumference 180) y chip de voltaje. Es de solo vista:
// el robot manda el porcentaje y el voltaje en cada lectura.
import { useEffect, useRef } from 'react';
import { Chart } from '../lib/chart.ts';
import { voltios } from '../lib/formato.ts';
import { useSocket, useUltimaLectura } from '../lib/socket.tsx';
import { useColoresTema } from '../lib/tema.tsx';
import { Chip, Tarjeta } from './ui.tsx';

function Gauge({ pct, color, conectado }: { pct: number; color: string; conectado: boolean }) {
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

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={conectado ? `Batería al ${Math.round(pct)} por ciento` : 'Batería sin datos: robot desconectado'}
    />
  );
}

export function TarjetaBateria() {
  const { estado, estadoRobot } = useSocket();
  const lectura = useUltimaLectura(1);
  const colores = useColoresTema();

  const conectado = estado === 'conectado' && !!estadoRobot?.enLinea && lectura?.bateriaPorcentaje != null;
  const pct = conectado ? lectura!.bateriaPorcentaje : 0;
  // Rojo cuando queda poca batería, verde cuando está cargada; gris si no hay robot.
  const color = !conectado ? colores.borde : pct < 20 ? colores.evasion : colores.libre;

  return (
    <Tarjeta
      titulo="Batería"
      pie={conectado && lectura?.bateriaVoltios != null ? <Chip>{voltios(lectura.bateriaVoltios)}</Chip> : undefined}
    >
      <div className="flex h-full min-h-0 items-center justify-center px-4 py-2 sm:px-6 sm:py-3">
        {/* El semicírculo ocupa 2:1, así que la caja lo es también: el centro del dial cae en
            su borde inferior. El hueco (cutout 72%) ocupa el 72% del radio = 72% de la altura
            de la caja desde abajo; el número se centra dentro de ese hueco. */}
        <div className="relative aspect-[2/1] w-full max-w-[180px] sm:max-w-[220px]">
          <Gauge pct={pct} color={color} conectado={conectado} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[72%] flex-col items-center justify-center">
            <p
              className={`text-[28px] leading-none font-bold tabular-nums sm:text-[32px] ${conectado ? '' : 'text-tinta-suave'}`}
            >
              {conectado ? Math.round(pct) : '—'}
              {conectado && <span className="ml-0.5 text-[15px] font-semibold text-tinta-suave">%</span>}
            </p>
          </div>
        </div>
      </div>
    </Tarjeta>
  );
}
