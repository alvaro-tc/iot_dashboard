// "Historial de distancias": equivale a la tarjeta de Bedroom Light de la referencia.
// Tres series en ventana deslizante alimentadas por WebSocket, con líneas de umbral.
import { useEffect, useRef, useState } from 'react';
import { Activity, Clock } from 'lucide-react';
import { CONFIG_POR_DEFECTO, type Lectura, type Movimiento } from '@iot/shared';
import { api } from '../lib/api.ts';
import { Chart } from '../lib/chart.ts';
import { useRobots } from '../lib/robots.tsx';
import { useSocket, useTelemetria } from '../lib/socket.tsx';
import { useColoresTema } from '../lib/tema.tsx';
import type { LecturaAgregada } from '../lib/types.ts';
import { Chip, Interruptor, Tarjeta } from './ui.tsx';

type Ventana = '1min' | '5min' | '1h';

const VENTANAS: Record<Ventana, { texto: string; ms: number }> = {
  '1min': { texto: '1 min', ms: 60_000 },
  '5min': { texto: '5 min', ms: 300_000 },
  '1h': { texto: '1 h', ms: 3_600_000 },
};

/** Color de la franja de estado de movimiento bajo el eje X. */
const COLOR_MOVIMIENTO: Record<Movimiento, string> = {
  avanzando: '#10b981',
  girando_izq: '#f59e0b',
  girando_der: '#f59e0b',
  retrocediendo: '#ef4444',
  detenido: '#94a3b8',
};

/**
 * Franja de estados bajo el eje X: un trazo por tramo. Es un plugin porque Chart.js no
 * tiene un tipo de serie "categoría a lo largo del tiempo" que se pinte fuera del área.
 */
function pluginFranja(tramos: () => { x: number; e: Movimiento }[]) {
  return {
    id: 'franjaMovimiento',
    afterDatasetsDraw(chart: Chart) {
      const { ctx, chartArea, scales } = chart;
      const puntos = tramos();
      if (!puntos.length || !scales.x) return;
      const y = chartArea.bottom + 4;
      ctx.save();
      ctx.beginPath();
      ctx.rect(chartArea.left, y, chartArea.right - chartArea.left, 6);
      ctx.clip();
      for (let i = 0; i < puntos.length; i++) {
        const x0 = scales.x.getPixelForValue(puntos[i].x);
        const x1 = i + 1 < puntos.length ? scales.x.getPixelForValue(puntos[i + 1].x) : chartArea.right;
        ctx.fillStyle = COLOR_MOVIMIENTO[puntos[i].e];
        ctx.fillRect(x0, y, Math.max(1, x1 - x0), 6);
      }
      ctx.restore();
    },
  };
}

export function TarjetaDistancias() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const colores = useColoresTema();
  const { config, idConexion, historial } = useSocket();
  const { robot } = useRobots();
  const cfg = config ?? CONFIG_POR_DEFECTO;

  const [ventana, setVentana] = useState<Ventana>('1min');
  const [enVivo, setEnVivo] = useState(true);
  const datos = useRef<{ izq: { x: number; y: number }[]; centro: { x: number; y: number }[]; der: { x: number; y: number }[] }>({
    izq: [],
    centro: [],
    der: [],
  });
  const estados = useRef<{ x: number; e: Movimiento }[]>([]);
  const pendiente = useRef(false);

  const agregar = (l: Lectura) => {
    const t = l.medidoEn;
    // null = sin objeto en rango: se corta la línea en vez de dibujar un cero falso.
    datos.current.izq.push({ x: t, y: l.distIzqCm as number });
    datos.current.centro.push({ x: t, y: l.distCentroCm as number });
    datos.current.der.push({ x: t, y: l.distDerCm as number });
    const ultimo = estados.current.at(-1);
    if (!ultimo || ultimo.e !== l.movimiento) estados.current.push({ x: t, e: l.movimiento });
  };

  const podar = () => {
    const corte = Date.now() - VENTANAS[ventana].ms;
    for (const k of ['izq', 'centro', 'der'] as const) {
      datos.current[k] = datos.current[k].filter((p) => p.x > corte);
    }
    estados.current = estados.current.filter((p, i) => p.x > corte || estados.current[i + 1]?.x > corte);
  };

  // Las gráficas de línea se limitan a 10 fps: a 5 Hz por robot y 3 series, redibujar en
  // cada mensaje no aporta nada que el ojo vea.
  useTelemetria((l) => {
    if (!enVivo || ventana === '1h') return;
    agregar(l);
    if (pendiente.current) return;
    pendiente.current = true;
    setTimeout(() => {
      pendiente.current = false;
      podar();
      chartRef.current?.update('none');
    }, 100);
  });

  // Al conectar o cambiar de ventana, se siembra con el historial en memoria.
  useEffect(() => {
    if (ventana === '1h') return;
    datos.current = { izq: [], centro: [], der: [] };
    estados.current = [];
    for (const l of historial()) agregar(l);
    podar();
    chartRef.current?.update('none');
  }, [idConexion, ventana]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ventana de 1 h: agregado por minuto desde Postgres, no desde el WebSocket.
  useEffect(() => {
    if (ventana !== '1h' || !robot) return;
    let cancelado = false;
    const desde = new Date(Date.now() - 3_600_000).toISOString();
    api<LecturaAgregada[]>(`/api/dispositivos/${robot.id}/lecturas?agregacion=minuto&desde=${desde}`)
      .then((filas) => {
        if (cancelado) return;
        datos.current = {
          izq: filas.map((f) => ({ x: new Date(f.instante).getTime(), y: f.minIzqCm as number })),
          centro: filas.map((f) => ({ x: new Date(f.instante).getTime(), y: f.minCentroCm as number })),
          der: filas.map((f) => ({ x: new Date(f.instante).getTime(), y: f.minDerCm as number })),
        };
        estados.current = [];
        chartRef.current?.update('none');
      })
      .catch(() => {
        /* la tarjeta se queda con lo que tenga; el error ya se ve en otras vistas */
      });
    return () => {
      cancelado = true;
    };
  }, [ventana, robot?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const serie = (etiqueta: string, color: string, clave: 'izq' | 'centro' | 'der') => ({
      label: etiqueta,
      data: datos.current[clave],
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.25,
      spanGaps: false,
    });

    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [
          serie('Izquierdo', '#60a5fa', 'izq'),
          serie('Central', colores.acento, 'centro'),
          serie('Derecho', '#a78bfa', 'der'),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        layout: { padding: { bottom: 12 } }, // sitio para la franja de estados
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: { color: colores.tintaSuave, boxWidth: 10, boxHeight: 10, usePointStyle: true },
          },
          tooltip: {
            callbacks: {
              title: (items) => new Date(Number(items[0].parsed.x)).toLocaleTimeString('es'),
              label: (item) => `${item.dataset.label}: ${item.parsed.y?.toFixed(1) ?? '—'} cm`,
            },
          },
          zoom: {
            zoom: { wheel: { enabled: true, speed: 0.1 }, pinch: { enabled: true }, mode: 'x' },
            pan: { enabled: true, mode: 'x' },
          },
          annotation: {
            annotations: {
              evasion: {
                type: 'line',
                yMin: cfg.distanciaEvasionCm,
                yMax: cfg.distanciaEvasionCm,
                borderColor: colores.evasion,
                borderWidth: 1,
                borderDash: [4, 4],
                label: { display: true, content: 'Evasión', position: 'start', font: { size: 10 } },
              },
              precaucion: {
                type: 'line',
                yMin: cfg.distanciaPrecaucionCm,
                yMax: cfg.distanciaPrecaucionCm,
                borderColor: colores.precaucion,
                borderWidth: 1,
                borderDash: [4, 4],
                label: { display: true, content: 'Precaución', position: 'start', font: { size: 10 } },
              },
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
              maxTicksLimit: 6,
              callback: (v) => new Date(Number(v)).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
            },
          },
          y: {
            min: 0,
            suggestedMax: 100,
            grid: { color: colores.borde },
            border: { display: false },
            ticks: { color: colores.tintaSuave, callback: (v) => `${v} cm` },
          },
        },
      },
      plugins: [pluginFranja(() => estados.current)],
    });
    chartRef.current = chart;
    return () => {
      chart.destroy();
      chartRef.current = null;
    };
  }, [colores.tema, cfg.distanciaEvasionCm, cfg.distanciaPrecaucionCm]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Tarjeta
      titulo="Historial de distancias"
      subtitulo="Lo que mide cada sensor"
      accion={
        <div className="flex items-center gap-2">
          <span className="hidden text-[13px] text-tinta-suave @[22rem]:inline">Seguir en vivo</span>
          <Interruptor
            activo={enVivo && ventana !== '1h'}
            onCambiar={setEnVivo}
            etiqueta="Seguir en vivo"
            disabled={ventana === '1h'}
          />
        </div>
      }
      pie={
        <>
          {(['1min', '5min'] as Ventana[]).map((v) => (
            <Chip key={v} icono={<Activity className="size-3.5" />} activo={ventana === v} onClick={() => setVentana(v)}>
              {VENTANAS[v].texto}
            </Chip>
          ))}
          <Chip icono={<Clock className="size-3.5" />} activo={ventana === '1h'} onClick={() => setVentana('1h')}>
            1 h
          </Chip>
        </>
      }
    >
      <div className="h-full min-h-[160px]">
        <canvas ref={canvasRef} />
      </div>
    </Tarjeta>
  );
}
