// "Historial de distancias": equivale a la tarjeta de Bedroom Light de la referencia.
// Tres series en ventana deslizante alimentadas por WebSocket, con líneas de umbral.
// Es de solo vista: siempre en vivo, ventana fija de 5 minutos.
//
// Con `solo` dibuja un único sensor: es el mismo componente, y así el panel puede tener una
// gráfica por sensor (tres widgets) además de la de los tres juntos. Los datos y los umbrales
// son los mismos; cambia qué series se pintan.
import { useEffect, useRef } from 'react';
import {
  DIST_EVASION_CM,
  DIST_PRECAUCION_CM,
  SENSORES,
  movimiento,
  type Lectura,
  type Movimiento,
  type Sensor,
} from '@iot/shared';
import { Chart } from '../lib/chart.ts';
import { NOMBRE_SENSOR } from '../lib/formato.ts';
import { useSocket, useTelemetria } from '../lib/socket.tsx';
import { useColoresTema } from '../lib/tema.tsx';
import { Tarjeta } from './ui.tsx';

const VENTANA_MS = 300_000; // 5 minutos

/**
 * Color de la franja de movimiento bajo el eje X. El movimiento no viene en la lectura: se
 * deduce del PWM de las dos ruedas (`movimiento` en @iot/shared).
 */
const COLOR_MOVIMIENTO: Record<Movimiento, string> = {
  avanzando: '#10b981',
  girando_izquierda: '#f59e0b',
  girando_derecha: '#f59e0b',
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

export function TarjetaDistancias({ solo }: { solo?: Sensor } = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const colores = useColoresTema();
  const { idConexion, historial } = useSocket();

  const datos = useRef<{
    izquierdo: { x: number; y: number }[];
    central: { x: number; y: number }[];
    derecho: { x: number; y: number }[];
  }>({ izquierdo: [], central: [], derecho: [] });
  const estados = useRef<{ x: number; e: Movimiento }[]>([]);
  const pendiente = useRef(false);

  const agregar = (l: Lectura) => {
    const t = l.creadoEn;
    // null = sin objeto en rango: se corta la línea en vez de dibujar un cero falso.
    datos.current.izquierdo.push({ x: t, y: l.distanciaIzquierdaCm as number });
    datos.current.central.push({ x: t, y: l.distanciaCentralCm as number });
    datos.current.derecho.push({ x: t, y: l.distanciaDerechaCm as number });
    const e = movimiento(l.movimientoIzquierda, l.movimientoDerecha);
    const ultimo = estados.current.at(-1);
    if (!ultimo || ultimo.e !== e) estados.current.push({ x: t, e });
  };

  const podar = () => {
    const corte = Date.now() - VENTANA_MS;
    for (const k of SENSORES) {
      datos.current[k] = datos.current[k].filter((p) => p.x > corte);
    }
    estados.current = estados.current.filter((p, i) => p.x > corte || estados.current[i + 1]?.x > corte);
  };

  // Las gráficas de línea se limitan a 10 fps: redibujar en cada mensaje no aporta nada
  // que el ojo vea.
  useTelemetria((l) => {
    agregar(l);
    if (pendiente.current) return;
    pendiente.current = true;
    setTimeout(() => {
      pendiente.current = false;
      podar();
      chartRef.current?.update('none');
    }, 100);
  });

  // Al conectar, se siembra con el historial en memoria.
  useEffect(() => {
    datos.current = { izquierdo: [], central: [], derecho: [] };
    estados.current = [];
    for (const l of historial()) agregar(l);
    podar();
    chartRef.current?.update('none');
  }, [idConexion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const serie = (etiqueta: string, color: string, clave: Sensor) => ({
      label: etiqueta,
      data: datos.current[clave],
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.25,
      spanGaps: false,
    });

    const todas = [
      serie('Izquierdo', '#60a5fa', 'izquierdo'),
      serie('Central', colores.acento, 'central'),
      serie('Derecho', '#a78bfa', 'derecho'),
    ];

    const chart = new Chart(canvas, {
      type: 'line',
      data: { datasets: solo ? [todas[SENSORES.indexOf(solo)]] : todas },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        parsing: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        layout: { padding: { bottom: 12 } }, // sitio para la franja de estados
        plugins: {
          legend: {
            display: !solo,
            position: 'bottom',
            labels: { color: colores.tintaSuave, boxWidth: 10, boxHeight: 10, usePointStyle: true },
          },
          tooltip: {
            callbacks: {
              title: (items) => new Date(Number(items[0].parsed.x)).toLocaleTimeString('es'),
              label: (item) => `${item.dataset.label}: ${item.parsed.y?.toFixed(1) ?? '—'} cm`,
            },
          },
          annotation: {
            annotations: {
              evasion: {
                type: 'line',
                yMin: DIST_EVASION_CM,
                yMax: DIST_EVASION_CM,
                borderColor: colores.evasion,
                borderWidth: 1,
                borderDash: [4, 4],
                label: { display: true, content: 'Evasión', position: 'start', font: { size: 10 } },
              },
              precaucion: {
                type: 'line',
                yMin: DIST_PRECAUCION_CM,
                yMax: DIST_PRECAUCION_CM,
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
  }, [colores.tema, solo]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Tarjeta
      titulo={solo ? `Distancia sensor ${NOMBRE_SENSOR[solo]}` : 'Historial de distancias'}
      subtitulo="Últimos 5 minutos"
    >
      <div className="h-full">
        <canvas ref={canvasRef} />
      </div>
    </Tarjeta>
  );
}
