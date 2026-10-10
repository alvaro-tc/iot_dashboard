// "Conectividad": estado de la cadena robot -> broker -> navegador.
//
// Ya no hay RSSI ni marca de tiempo del robot en la lectura, así que no se puede medir la
// latencia extremo a extremo ni la señal WiFi. Lo que sí se mide desde aquí es la CADENCIA:
// cuántos mensajes llegan por segundo y cuánto hace que llegó el último. Si el robot publica
// cada 500 ms, 2 msg/s es lo normal y menos significa que algo va mal por el camino.
import { useEffect, useRef, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import { Chart } from '../lib/chart.ts';
import { haceCuanto } from '../lib/formato.ts';
import { useSocket, useTelemetria, useUltimaLectura } from '../lib/socket.tsx';
import { useColoresTema } from '../lib/tema.tsx';
import { Tarjeta } from './ui.tsx';

const VENTANA_MS = 120_000; // sparkline de los últimos 2 minutos
/** Cadencia esperada con INTERVALO_MQTT_MS = 500 ms: 2 mensajes por segundo. */
const ESPERADO_MSG_S = 2;

/** Sparkline de la cadencia. Chart.js en modo mínimo: sin ejes, sin leyenda, sin tooltip. */
function SparklineCadencia({ puntos }: { puntos: { x: number; y: number }[] }) {
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

  return <canvas ref={canvasRef} className="size-full" role="img" aria-label="Mensajes por segundo de los últimos 2 minutos" />;
}

export function TarjetaConectividad() {
  const { estado, estadoRobot } = useSocket();
  const lectura = useUltimaLectura(1);
  const [cadencia, setCadencia] = useState<{ x: number; y: number }[]>([]);
  const [msgPorSeg, setMsgPorSeg] = useState(0);
  const marcas = useRef<number[]>([]);

  useTelemetria(() => marcas.current.push(Date.now()));

  useEffect(() => {
    const id = setInterval(() => {
      const ahora = Date.now();
      marcas.current = marcas.current.filter((m) => m > ahora - 1000);
      const n = marcas.current.length;
      setMsgPorSeg(n);
      setCadencia((xs) => [...xs, { x: ahora, y: n }].filter((p) => p.x > ahora - VENTANA_MS));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const wsOk = estado === 'conectado';
  const robotOk = !!estadoRobot?.enLinea;
  const todoOk = wsOk && robotOk;
  // Porcentaje de la cadencia esperada, acotado a 100: es la "barra de señal" de la cadena.
  const salud = Math.min(100, Math.round((msgPorSeg / ESPERADO_MSG_S) * 100));

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
        <span className="text-[32px] leading-none font-bold tabular-nums">{msgPorSeg}</span>
        <span className="pb-1 text-[14px] text-tinta-suave">mensajes/s</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-tarjeta-tenue">
        <div className="h-full rounded-full bg-libre transition-[width] duration-300" style={{ width: `${salud}%` }} />
      </div>

      <div className="mt-3 h-12">
        <SparklineCadencia puntos={cadencia} />
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
        <div>
          <dt className="text-tinta-suave">Última lectura</dt>
          <dd className="font-medium">{lectura ? haceCuanto(lectura.creadoEn) : '—'}</dd>
        </div>
        <div>
          <dt className="text-tinta-suave">Cadencia esperada</dt>
          <dd className="font-medium tabular-nums">{ESPERADO_MSG_S} msg/s</dd>
        </div>
        <div>
          <dt className="text-tinta-suave">WebSocket</dt>
          <dd className={`font-medium ${wsOk ? 'text-libre' : 'text-evasion'}`}>
            {wsOk ? 'Conectado' : estado === 'reconectando' ? 'Reconectando…' : 'Sin conexión'}
          </dd>
        </div>
        <div>
          <dt className="text-tinta-suave">Firmware</dt>
          <dd className="font-medium">{estadoRobot?.versionFirmware ?? '—'}</dd>
        </div>
      </dl>
    </Tarjeta>
  );
}
