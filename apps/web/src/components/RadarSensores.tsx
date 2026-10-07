// Radar: lo que ven los tres sensores AHORA, sin historia ni mapa.
//
// El robot va abajo al centro; los anillos marcan 25, 50, 75 y 100 cm; cada sensor ocupa un
// sector de ±18° centrado en su ángulo. El sector se parte en tres bandas cuyos límites son
// `distanciaEvasionCm` y `distanciaPrecaucionCm`: la banda donde cae el objeto se rellena
// con el color del estado y las de más allá quedan tenues.
//
// Igual que el mapa: Chart.js pone el lienzo y el tooltip; el dibujo es un plugin propio,
// porque un sector de corona circular no es un tipo de gráfica.
import { useEffect, useRef } from 'react';
import { DIST_VISTA_CM, estadoDistancia, type Configuracion, type Lectura, type Sensor } from '@iot/shared';
import { Chart } from '../lib/chart.ts';
import { NOMBRE_MOVIMIENTO, NOMBRE_SENSOR } from '../lib/formato.ts';
import { useColoresTema } from '../lib/tema.tsx';

const SENSORES: Sensor[] = ['izq', 'centro', 'der'];
const SEMIANCHO_DEG = 18;
const ANILLOS = [25, 50, 75, 100];
const RASTRO = 6; // últimas lecturas que dejan estela

interface Props {
  config: Configuracion;
  lectura: Lectura | null;
}

export function RadarSensores({ config, lectura }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const colores = useColoresTema();

  const configRef = useRef(config);
  configRef.current = config;
  const actual = useRef<Lectura | null>(lectura);
  actual.current = lectura;
  const rastro = useRef<Record<Sensor, number[]>>({ izq: [], centro: [], der: [] });

  // Estela: las últimas lecturas de cada sensor.
  useEffect(() => {
    if (!lectura) return;
    const d: Record<Sensor, number | null> = {
      izq: lectura.distIzqCm,
      centro: lectura.distCentroCm,
      der: lectura.distDerCm,
    };
    for (const s of SENSORES) {
      if (d[s] === null) continue;
      rastro.current[s].push(d[s]!);
      if (rastro.current[s].length > RASTRO) rastro.current[s].shift();
    }
  }, [lectura]);

  const plugin = useRef({
    id: 'capaRadar',
    afterDraw(chart: Chart) {
      const { ctx, chartArea } = chart;
      const ancho = chartArea.right - chartArea.left;
      const alto = chartArea.bottom - chartArea.top;
      if (ancho <= 0 || alto <= 0) return;

      // El robot va abajo al centro; el radar barre el semiplano de delante.
      const cx = chartArea.left + ancho / 2;
      const cy = chartArea.bottom - alto * 0.12;
      const radio = Math.min(ancho / 2, alto * 0.86);
      const escala = radio / DIST_VISTA_CM;
      const cfg = configRef.current;
      const l = actual.current;

      // El 0° del radar apunta "hacia arriba" en pantalla. El ángulo del sensor es relativo
      // al frente del robot, así que se convierte a ángulo de lienzo restando 90°.
      const aLienzo = (deg: number) => ((deg - 90) * Math.PI) / 180;

      ctx.save();

      // --- Anillos de distancia ---
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.font = '11px system-ui';
      ctx.textAlign = 'center';
      for (const anillo of ANILLOS) {
        const r = anillo * escala;
        ctx.beginPath();
        ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI);
        ctx.stroke();
        ctx.fillText(`${anillo}`, cx, cy - r + 12);
      }

      // --- Un sector por sensor, partido en bandas ---
      for (const sensor of SENSORES) {
        const d = l ? ({ izq: l.distIzqCm, centro: l.distCentroCm, der: l.distDerCm }[sensor] ?? null) : null;
        const centroDeg = cfg.angulosSensores[sensor];
        const desde = aLienzo(centroDeg - SEMIANCHO_DEG);
        const hasta = aLienzo(centroDeg + SEMIANCHO_DEG);
        const estado = estadoDistancia(d, cfg);

        const bandas: [number, number, string][] = [
          [0, cfg.distanciaEvasionCm, colores.evasion],
          [cfg.distanciaEvasionCm, cfg.distanciaPrecaucionCm, colores.precaucion],
          [cfg.distanciaPrecaucionCm, DIST_VISTA_CM, colores.libre],
        ];

        for (const [desdeCm, hastaCm, color] of bandas) {
          const dentro = d !== null && d > desdeCm && d <= hastaCm;
          ctx.globalAlpha = dentro ? 0.42 : 0.07;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(cx, cy, hastaCm * escala, desde, hasta);
          ctx.arc(cx, cy, desdeCm * escala, hasta, desde, true);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        // Estela de las últimas lecturas, de más tenue a más viva.
        const historia = rastro.current[sensor];
        const a = aLienzo(centroDeg);
        historia.forEach((valor, i) => {
          ctx.globalAlpha = 0.12 + (0.5 * (i + 1)) / historia.length;
          ctx.fillStyle = colores.tintaSuave;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * valor * escala, cy + Math.sin(a) * valor * escala, 2, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;

        // Punto del obstáculo actual
        if (d !== null) {
          const color = estado === 'evasion' ? colores.evasion : estado === 'precaucion' ? colores.precaucion : colores.libre;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * d * escala, cy + Math.sin(a) * d * escala, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = '600 11px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText(`${d.toFixed(0)}`, cx + Math.cos(a) * d * escala, cy + Math.sin(a) * d * escala - 10);
        }
      }

      // --- El robot ---
      ctx.fillStyle = colores.acento;
      ctx.beginPath();
      ctx.arc(cx, cy, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx - 4, cy + 2);
      ctx.lineTo(cx + 4, cy + 2);
      ctx.closePath();
      ctx.fill();

      // Estado de movimiento sobre el robot
      if (l) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '600 12px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(NOMBRE_MOVIMIENTO[l.movimiento], cx, cy + 24);
      }

      ctx.restore();
    },
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const chart = new Chart(canvas, {
      type: 'scatter',
      data: { datasets: [{ data: [], pointRadius: 0 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        // Ejes ocultos: el radar los sustituye por los anillos.
        scales: { x: { display: false, min: 0, max: 1 }, y: { display: false, min: 0, max: 1 } },
      },
      plugins: [plugin.current],
    });
    chartRef.current = chart;
    return () => {
      chart.destroy();
      chartRef.current = null;
    };
  }, []);

  // Repinta en cada lectura y al cambiar de tema.
  useEffect(() => {
    chartRef.current?.update('none');
  }, [lectura, colores.tema]);

  const resumen = lectura
    ? SENSORES.map((s) => {
        const d = { izq: lectura.distIzqCm, centro: lectura.distCentroCm, der: lectura.distDerCm }[s];
        return `sensor ${NOMBRE_SENSOR[s]}: ${d === null ? 'sin objeto' : `${d.toFixed(0)} centímetros`}`;
      }).join('; ')
    : 'sin datos';

  return (
    <canvas
      ref={canvasRef}
      className="size-full"
      role="img"
      aria-label={`Radar de sensores. ${resumen}.`}
    />
  );
}
