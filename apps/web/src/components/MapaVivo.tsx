// Mapa en vivo: dónde está el robot y qué ha encontrado.
//
// Es una gráfica Chart.js de tipo `scatter` (ejes en cm, misma escala en X e Y) con un
// plugin propio que dibuja encima: trayectoria, obstáculos acumulados, los 3 haces de los
// sensores y el robot visto desde arriba.
//
// Por qué un plugin y no puntos del dataset: el robot es un dibujo rotado (chasis, ruedas,
// flecha de frente) y los haces son sectores; nada de eso se expresa como punto o línea de
// Chart.js. Lo que sí se delega a Chart.js son las escalas, el zoom y el pan, que es la
// parte tediosa.
//
// Fluidez: la pose se interpola con requestAnimationFrame entre mensajes, con un búfer de
// reproducción de ~100 ms que absorbe la irregularidad con la que llegan. Sin eso, a 5 Hz
// el robot daría saltos visibles.
import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import {
  RADIO_ROBOT_CM,
  deltaDeg,
  estadoDistancia,
  normalizaDeg,
  puntoObstaculo,
  type Configuracion,
  type Lectura,
  type Movimiento,
  type Sensor,
} from '@iot/shared';
import { Chart } from '../lib/chart.ts';
import { useColoresTema } from '../lib/tema.tsx';

export interface Pose {
  x: number;
  y: number;
  th: number;
  movimiento: Movimiento;
  distancias: Record<Sensor, number | null>;
}

export interface MapaApi {
  /** Añade una pose a la cola de reproducción. */
  empujar: (l: Lectura) => void;
  /** Carga de golpe un recorrido entero (histórico o repetición). */
  cargar: (poses: Pose[]) => void;
  limpiar: () => void;
  ajustarATodo: () => void;
  capturaPng: () => string | undefined;
  zoom: (factor: number) => void;
}

interface Props {
  config: Configuracion;
  seguir: boolean;
  mostrarHaces: boolean;
  /** Área inicial encuadrada, en cm. */
  area: { ancho: number; alto: number };
  ref?: Ref<MapaApi>;
}

const MAX_TRAYECTORIA = 4000;
const MAX_OBSTACULOS = 6000;
/** Búfer de reproducción: se dibuja 100 ms "por detrás" para poder interpolar. */
const RETARDO_MS = 100;

interface Obstaculo {
  x: number;
  y: number;
  sensor: Sensor;
}

export function MapaVivo({ config, seguir, mostrarHaces, area, ref }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const colores = useColoresTema();

  // Estado del dibujo, fuera de React: cambia a 60 fps y no debe provocar renders.
  const trayectoria = useRef<Pose[]>([]);
  const obstaculos = useRef<Obstaculo[]>([]);
  const cola = useRef<{ t: number; pose: Pose }[]>([]);
  const actual = useRef<Pose | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const seguirRef = useRef(seguir);
  seguirRef.current = seguir;
  const hacesRef = useRef(mostrarHaces);
  hacesRef.current = mostrarHaces;

  const poseDeLectura = useCallback(
    (l: Lectura): Pose => ({
      x: l.posXCm,
      y: l.posYCm,
      th: l.orientacionDeg,
      movimiento: l.movimiento,
      distancias: { izq: l.distIzqCm, centro: l.distCentroCm, der: l.distDerCm },
    }),
    [],
  );

  const registrarObstaculos = useCallback((p: Pose) => {
    const ang = configRef.current.angulosSensores;
    for (const sensor of ['izq', 'centro', 'der'] as Sensor[]) {
      const d = p.distancias[sensor];
      // Solo lo que está razonablemente cerca es un obstáculo del hogar; más allá es ruido
      // o una pared lejana que el sensor apenas resuelve.
      if (d === null || d > 100) continue;
      const q = puntoObstaculo(p.x, p.y, p.th, ang[sensor], d);
      obstaculos.current.push({ x: q.x, y: q.y, sensor });
    }
    if (obstaculos.current.length > MAX_OBSTACULOS) {
      obstaculos.current.splice(0, obstaculos.current.length - MAX_OBSTACULOS);
    }
  }, []);

  // ---- Plugin de dibujo ----
  const plugin = useRef({
    id: 'capaRobot',
    afterDatasetsDraw(chart: Chart) {
      const { ctx, chartArea } = chart;
      const ex = chart.scales.x;
      const ey = chart.scales.y;
      if (!ex || !ey) return;
      const px = (v: number) => ex.getPixelForValue(v);
      const py = (v: number) => ey.getPixelForValue(v);
      const escala = Math.abs(px(100) - px(0)) / 100; // píxeles por cm

      ctx.save();
      ctx.beginPath();
      ctx.rect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, chartArea.bottom - chartArea.top);
      ctx.clip();

      // --- Obstáculos acumulados: con el tiempo dibujan las paredes y los muebles ---
      ctx.fillStyle = colores.evasion;
      for (const o of obstaculos.current) {
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(px(o.x), py(o.y), 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // --- Trayectoria: naranja, más tenue cuanto más antigua ---
      const tr = trayectoria.current;
      if (tr.length > 1) {
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = colores.acento;
        // Se dibuja por tramos para poder variar la opacidad sin un gradiente por píxel.
        const tramos = 24;
        const porTramo = Math.ceil(tr.length / tramos);
        for (let i = 0; i < tr.length - 1; i += porTramo) {
          const fin = Math.min(i + porTramo + 1, tr.length);
          ctx.globalAlpha = 0.15 + 0.85 * (i / tr.length);
          ctx.beginPath();
          ctx.moveTo(px(tr[i].x), py(tr[i].y));
          for (let k = i + 1; k < fin; k++) ctx.lineTo(px(tr[k].x), py(tr[k].y));
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // --- Origen de la sesión: icono de casa ---
      if (tr.length) {
        const ox = px(0);
        const oy = py(0);
        ctx.strokeStyle = 'rgba(255,255,255,0.65)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ox - 6, oy + 5);
        ctx.lineTo(ox - 6, oy - 1);
        ctx.lineTo(ox, oy - 7);
        ctx.lineTo(ox + 6, oy - 1);
        ctx.lineTo(ox + 6, oy + 5);
        ctx.closePath();
        ctx.stroke();
      }

      const p = actual.current;
      if (!p) {
        ctx.restore();
        return;
      }

      const cx = px(p.x);
      const cy = py(p.y);
      const r = Math.max(6, RADIO_ROBOT_CM * escala);
      const cfg = configRef.current;

      // --- Haces de los 3 sensores ---
      if (hacesRef.current) {
        for (const sensor of ['izq', 'centro', 'der'] as Sensor[]) {
          const d = p.distancias[sensor];
          const estado = estadoDistancia(d, cfg);
          const color = estado === 'evasion' ? colores.evasion : estado === 'precaucion' ? colores.precaucion : colores.libre;
          // Sin eco: se dibuja el haz corto y tenue, no se oculta (es información también).
          const largo = (d ?? 35) * escala;
          const a = ((p.th + cfg.angulosSensores[sensor]) * Math.PI) / 180;
          // El eje Y del lienzo crece hacia abajo; el del mapa, hacia arriba.
          const dx = Math.cos(a);
          const dy = -Math.sin(a);
          ctx.globalAlpha = d === null ? 0.18 : 0.55;
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cx + dx * r, cy + dy * r);
          ctx.lineTo(cx + dx * (r + largo), cy + dy * (r + largo));
          ctx.stroke();
          if (d !== null) {
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(cx + dx * (r + largo), cy + dy * (r + largo), 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }

      // --- El robot, rotado según θ ---
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((-p.th * Math.PI) / 180); // negativo: el lienzo gira al revés que el mapa

      // Ruedas, una a cada lado
      ctx.fillStyle = '#0f172a';
      const anchoRueda = r * 0.28;
      const largoRueda = r * 0.85;
      ctx.fillRect(-largoRueda / 2, -r - anchoRueda * 0.35, largoRueda, anchoRueda);
      ctx.fillRect(-largoRueda / 2, r - anchoRueda * 0.65, largoRueda, anchoRueda);

      // Chasis
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = colores.acento;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.stroke();

      // Flecha del frente
      ctx.beginPath();
      ctx.moveTo(r * 0.75, 0);
      ctx.lineTo(r * 0.1, -r * 0.4);
      ctx.lineTo(r * 0.1, r * 0.4);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      ctx.restore();
      ctx.restore();
    },
  });

  // ---- Creación de la gráfica ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const chart = new Chart(canvas, {
      type: 'scatter',
      data: { datasets: [{ data: [], pointRadius: 0 }] },
      options: {
        responsive: true,
        animation: false,
        // La misma escala en los dos ejes: si no, un giro de 90° se vería como una elipse.
        aspectRatio: 1,
        maintainAspectRatio: false,
        parsing: false,
        events: ['mousedown', 'mousemove', 'mouseup', 'wheel', 'touchstart', 'touchmove', 'touchend'],
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
          zoom: {
            zoom: {
              wheel: { enabled: true, speed: 0.08 },
              pinch: { enabled: true },
              mode: 'xy',
            },
            pan: { enabled: true, mode: 'xy' },
            limits: { x: { min: -3000, max: 3000 }, y: { min: -3000, max: 3000 } },
          },
        },
        scales: {
          x: {
            type: 'linear',
            min: -area.ancho / 2,
            max: area.ancho / 2,
            grid: { color: colores.rejillaMapa, drawTicks: false },
            border: { display: false },
            ticks: { stepSize: 50, color: 'rgba(255,255,255,0.35)', maxTicksLimit: 12, callback: (v) => `${v}` },
          },
          y: {
            type: 'linear',
            min: -area.alto / 2,
            max: area.alto / 2,
            grid: { color: colores.rejillaMapa, drawTicks: false },
            border: { display: false },
            ticks: { stepSize: 50, color: 'rgba(255,255,255,0.35)', maxTicksLimit: 12 },
          },
        },
      },
      plugins: [plugin.current],
    });
    chartRef.current = chart;

    return () => {
      chart.destroy();
      chartRef.current = null;
    };
    // area y colores se aplican en efectos aparte: recrear la gráfica perdería el zoom.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cambio de tema: se repintan rejilla y capa propia sin recrear la gráfica.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const rejilla = { color: colores.rejillaMapa };
    Object.assign(chart.options.scales!.x!.grid!, rejilla);
    Object.assign(chart.options.scales!.y!.grid!, rejilla);
    chart.update('none');
  }, [colores.rejillaMapa, colores.acento, colores.evasion, colores.libre, colores.precaucion]);

  // ---- Bucle de interpolación ----
  useEffect(() => {
    let raf = 0;
    const paso = () => {
      raf = requestAnimationFrame(paso);
      const chart = chartRef.current;
      if (!chart) return;

      const objetivo = Date.now() - RETARDO_MS;
      const q = cola.current;
      // Descarta lo ya reproducido, dejando una muestra por detrás para interpolar desde ella.
      while (q.length > 2 && q[1].t <= objetivo) q.shift();

      if (q.length >= 2 && q[0].t <= objetivo) {
        const [a, b] = q;
        const k = Math.max(0, Math.min(1, (objetivo - a.t) / (b.t - a.t)));
        actual.current = {
          ...b.pose,
          x: a.pose.x + (b.pose.x - a.pose.x) * k,
          y: a.pose.y + (b.pose.y - a.pose.y) * k,
          // El ángulo se interpola por el camino corto: de 350° a 10° son +20°, no -340°.
          th: normalizaDeg(a.pose.th + deltaDeg(a.pose.th, b.pose.th) * k),
        };
      } else if (q.length === 1) {
        actual.current = q[0].pose;
      }

      if (seguirRef.current && actual.current) {
        const ex = chart.scales.x;
        const ey = chart.scales.y;
        const anchoVista = ex.max - ex.min;
        const altoVista = ey.max - ey.min;
        chart.options.scales!.x!.min = actual.current.x - anchoVista / 2;
        chart.options.scales!.x!.max = actual.current.x + anchoVista / 2;
        chart.options.scales!.y!.min = actual.current.y - altoVista / 2;
        chart.options.scales!.y!.max = actual.current.y + altoVista / 2;
      }
      chart.update('none');
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- API imperativa ----
  const ajustarATodo = useCallback(() => {
    const chart = chartRef.current;
    const puntos = [...trayectoria.current, ...obstaculos.current.map((o) => ({ x: o.x, y: o.y }))];
    if (!chart) return;
    if (!puntos.length) {
      chart.options.scales!.x!.min = -area.ancho / 2;
      chart.options.scales!.x!.max = area.ancho / 2;
      chart.options.scales!.y!.min = -area.alto / 2;
      chart.options.scales!.y!.max = area.alto / 2;
      chart.update('none');
      return;
    }
    const xs = puntos.map((p) => p.x);
    const ys = puntos.map((p) => p.y);
    const margen = 40;
    // Mismo span en los dos ejes para no deformar el recorrido.
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 100) / 2 + margen;
    chart.options.scales!.x!.min = cx - span;
    chart.options.scales!.x!.max = cx + span;
    chart.options.scales!.y!.min = cy - span;
    chart.options.scales!.y!.max = cy + span;
    chart.update('none');
  }, [area.ancho, area.alto]);

  useImperativeHandle(
    ref,
    (): MapaApi => ({
      empujar: (l) => {
        const pose = poseDeLectura(l);
        cola.current.push({ t: Date.now(), pose });
        if (cola.current.length > 40) cola.current.shift();
        trayectoria.current.push(pose);
        if (trayectoria.current.length > MAX_TRAYECTORIA) trayectoria.current.shift();
        registrarObstaculos(pose);
      },
      cargar: (poses) => {
        trayectoria.current = poses.slice(-MAX_TRAYECTORIA);
        obstaculos.current = [];
        for (const p of trayectoria.current) registrarObstaculos(p);
        cola.current = [];
        actual.current = poses.at(-1) ?? null;
        ajustarATodo();
      },
      limpiar: () => {
        trayectoria.current = [];
        obstaculos.current = [];
        cola.current = [];
        chartRef.current?.update('none');
      },
      ajustarATodo,
      capturaPng: () => chartRef.current?.toBase64Image(),
      zoom: (factor) => {
        const chart = chartRef.current;
        if (!chart) return;
        const ex = chart.scales.x;
        const ey = chart.scales.y;
        const cx = (ex.min + ex.max) / 2;
        const cy = (ey.min + ey.max) / 2;
        const sx = ((ex.max - ex.min) / 2) * factor;
        const sy = ((ey.max - ey.min) / 2) * factor;
        chart.options.scales!.x!.min = cx - sx;
        chart.options.scales!.x!.max = cx + sx;
        chart.options.scales!.y!.min = cy - sy;
        chart.options.scales!.y!.max = cy + sy;
        chart.update('none');
      },
    }),
    [ajustarATodo, poseDeLectura, registrarObstaculos],
  );

  return <canvas ref={canvasRef} className="size-full" role="img" aria-label="Mapa del recorrido del robot" />;
}
