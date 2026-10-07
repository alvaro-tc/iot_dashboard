// "Conectividad": equivale a la tarjeta de Wi-Fi de la referencia.
// Señal del robot, estado de MQTT y del WebSocket, latencia extremo a extremo y msg/s.
import { useEffect, useRef, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import { Chart } from '../lib/chart.ts';
import { ms, senalPct } from '../lib/formato.ts';
import { useSocket, useTelemetria, useUltimaLectura } from '../lib/socket.tsx';
import { useColoresTema } from '../lib/tema.tsx';
import { Tarjeta } from './ui.tsx';

const VENTANA_MS = 120_000; // sparkline de los últimos 2 minutos

/** Sparkline de la latencia. Chart.js en modo mínimo: sin ejes, sin leyenda, sin tooltip. */
function SparklineLatencia({ puntos }: { puntos: { x: number; y: number }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const colores = useColoresTema();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [
          {
            data: [],
            borderColor: colores.libre,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.35,
            fill: true,
            backgroundColor: 'rgba(16,185,129,0.12)',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false, type: 'linear' }, y: { display: false, min: 0 } },
      },
    });
    chartRef.current = chart;
    return () => {
      chart.destroy();
      chartRef.current = null;
    };
  }, [colores.libre]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.data.datasets[0].data = puntos;
    chart.update('none');
  }, [puntos]);

  return <canvas ref={canvasRef} className="size-full" role="img" aria-label="Latencia de los últimos 2 minutos" />;
}

export function TarjetaConectividad({ pctPerdidas }: { pctPerdidas: number | null }) {
  const { estado, estadoRobot, desfaseReloj } = useSocket();
  const lectura = useUltimaLectura(2);
  const [latencias, setLatencias] = useState<{ x: number; y: number }[]>([]);
  const [msgPorSeg, setMsgPorSeg] = useState(0);
  const marcas = useRef<number[]>([]);

  useTelemetria((l) => {
    const ahora = Date.now();
    // La latencia se corrige con el desfase de relojes medido al conectar; si no, mediría
    // la diferencia entre el reloj del navegador y el NTP del robot.
    const latencia = Math.max(0, ahora - desfaseReloj() - l.medidoEn);
    setLatencias((xs) => [...xs, { x: ahora, y: latencia }].filter((p) => p.x > ahora - VENTANA_MS));
    marcas.current.push(ahora);
  });

  useEffect(() => {
    const id = setInterval(() => {
      const corte = Date.now() - 1000;
      marcas.current = marcas.current.filter((m) => m > corte);
      setMsgPorSeg(marcas.current.length);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const wsOk = estado === 'conectado';
  const robotOk = !!estadoRobot?.enLinea;
  const todoOk = wsOk && robotOk;
  const senal = senalPct(lectura?.rssiDbm);
  const ultimaLatencia = latencias.at(-1)?.y ?? null;

  return (
    <Tarjeta
      titulo="Conectividad"
      subtitulo={robotOk ? 'Robot en línea' : 'Robot fuera de línea'}
      className={todoOk ? 'bg-gradient-to-br from-menta to-transparent' : ''}
      accion={
        <span className={`btn-circulo ${todoOk ? 'border-libre/40 text-libre' : 'border-borde text-tinta-suave'}`}>
          {todoOk ? <Wifi className="size-5" /> : <WifiOff className="size-5" />}
        </span>
      }
    >
      <div className="flex items-end gap-2">
        <span className="text-[32px] leading-none font-bold tabular-nums">{senal ?? '—'}</span>
        <span className="pb-1 text-[14px] text-tinta-suave">
          % {lectura?.rssiDbm !== undefined && lectura?.rssiDbm !== null ? `· ${lectura.rssiDbm} dBm` : ''}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-tarjeta-tenue">
        <div className="h-full rounded-full bg-libre transition-[width] duration-300" style={{ width: `${senal ?? 0}%` }} />
      </div>

      <div className="mt-3 h-12">
        <SparklineLatencia puntos={latencias} />
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
        <div>
          <dt className="text-tinta-suave">Latencia</dt>
          <dd className="font-medium tabular-nums">{ms(ultimaLatencia)}</dd>
        </div>
        <div>
          <dt className="text-tinta-suave">Mensajes/s</dt>
          <dd className="font-medium tabular-nums">{msgPorSeg}</dd>
        </div>
        <div>
          <dt className="text-tinta-suave">WebSocket</dt>
          <dd className={`font-medium ${wsOk ? 'text-libre' : 'text-evasion'}`}>
            {wsOk ? 'Conectado' : estado === 'reconectando' ? 'Reconectando…' : 'Sin conexión'}
          </dd>
        </div>
        <div>
          <dt className="text-tinta-suave">Lecturas perdidas</dt>
          <dd className="font-medium tabular-nums">{pctPerdidas === null ? '—' : `${pctPerdidas} %`}</dd>
        </div>
      </dl>
    </Tarjeta>
  );
}
