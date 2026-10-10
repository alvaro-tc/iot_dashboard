// /sesiones — lista de sesiones con el detalle de la seleccionada: reparto entre marcha y
// parada, PWM medio de cada rueda y en qué sensor se encontró más obstáculos.
//
// Ya no hay recorrido que dibujar: la base guarda distancias, motores y batería, no la pose.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { Chart } from '../lib/chart.ts';
import { cm, duracion, fechaHora, hora, pct } from '../lib/formato.ts';
import { INTERVALO_TELEMETRIA_MS } from '../lib/metricas.ts';
import { useRobots } from '../lib/robots.tsx';
import { useColoresTema } from '../lib/tema.tsx';
import type { ResumenSesion } from '../lib/types.ts';
import { Esqueleto, Tarjeta, Vacio } from '../components/ui.tsx';

/** Segundos de una cuenta de lecturas: cada lectura vale un intervalo de telemetría. */
const segundos = (lecturas: number | null) => ((lecturas ?? 0) * INTERVALO_TELEMETRIA_MS) / 1000;

function DonaMarcha({ s }: { s: ResumenSesion }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colores = useColoresTema();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['En marcha', 'Detenido'],
        datasets: [
          {
            data: [s.lecturasEnMarcha ?? 0, s.lecturasDetenido ?? 0],
            backgroundColor: [colores.libre, colores.tintaSuave],
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '58%',
        plugins: {
          legend: { position: 'bottom', labels: { color: colores.tintaSuave, boxWidth: 10, usePointStyle: true } },
          tooltip: { callbacks: { label: (i) => `${i.label}: ${duracion(segundos(Number(i.parsed)))}` } },
        },
      },
    });
    return () => chart.destroy();
  }, [s, colores.tema]); // eslint-disable-line react-hooks/exhaustive-deps

  return <canvas ref={canvasRef} role="img" aria-label="Reparto entre tiempo en marcha y detenido" />;
}

function BarrasObstaculos({ s }: { s: ResumenSesion }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colores = useColoresTema();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: ['Izquierdo', 'Central', 'Derecho'],
        datasets: [
          {
            label: 'Lecturas con obstáculo cerca',
            data: [s.cercaIzquierda ?? 0, s.cercaCentral ?? 0, s.cercaDerecha ?? 0],
            backgroundColor: colores.acento,
            borderRadius: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: colores.tintaSuave } },
          y: {
            beginAtZero: true,
            grid: { color: colores.borde },
            border: { display: false },
            ticks: { color: colores.tintaSuave, precision: 0 },
          },
        },
      },
    });
    return () => chart.destroy();
  }, [s, colores.tema]); // eslint-disable-line react-hooks/exhaustive-deps

  return <canvas ref={canvasRef} role="img" aria-label="Lecturas con obstáculo cerca, por sensor" />;
}

export function Sesiones() {
  const { robot } = useRobots();
  const [seleccion, setSeleccion] = useState<number | null>(null);

  const { data: sesiones, isLoading } = useQuery<ResumenSesion[]>({
    queryKey: ['sesiones', robot?.id],
    queryFn: () => api(`/api/dispositivos/${robot!.id}/sesiones`),
    enabled: !!robot,
  });

  const lista = sesiones ?? [];
  const actual = lista.find((s) => s.id === seleccion) ?? lista[0] ?? null;

  if (isLoading) return <Esqueleto className="h-[400px]" />;

  if (!lista.length) {
    return (
      <Tarjeta titulo="Sesiones">
        <Vacio
          titulo="Sin sesiones todavía"
          descripcion="En cuanto el robot empiece a publicar telemetría se abrirá una sesión y aparecerá aquí."
        />
      </Tarjeta>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
      <Tarjeta titulo="Sesiones" subtitulo={`${lista.length} en total`}>
        <ul className="max-h-[540px] divide-y divide-borde overflow-y-auto">
          {lista.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                aria-current={actual?.id === s.id}
                onClick={() => setSeleccion(s.id)}
                className={`w-full cursor-pointer rounded-xl px-3 py-2.5 text-left transition-colors duration-150 ${
                  actual?.id === s.id ? 'bg-acento/10' : 'hover:bg-tarjeta-tenue'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[14px] font-medium">Sesión {hora(s.iniciadaEn)}</span>
                  {!s.finalizadaEn && <span className="badge bg-evasion/15 text-evasion">en curso</span>}
                </div>
                <p className="text-[12px] text-tinta-suave">
                  {fechaHora(s.iniciadaEn)} · {duracion(s.duracionS)} · {s.lecturas.toLocaleString('es')} lecturas
                </p>
              </button>
            </li>
          ))}
        </ul>
      </Tarjeta>

      {actual && (
        <div className="grid content-start gap-4">
          <Tarjeta
            titulo={`Sesión ${hora(actual.iniciadaEn)}`}
            subtitulo={`${actual.lecturas.toLocaleString('es')} lecturas · ${
              actual.finalizadaEn ? `terminó ${hora(actual.finalizadaEn)}` : 'en curso'
            }`}
          >
            <dl className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
              <Dato etiqueta="Duración" valor={duracion(actual.duracionS)} />
              <Dato etiqueta="En marcha" valor={duracion(segundos(actual.lecturasEnMarcha))} />
              <Dato etiqueta="Batería consumida" valor={pct(actual.bateriaConsumidaPorcentaje)} />
              <Dato
                etiqueta="PWM medio"
                valor={`${Math.round(actual.promPwmIzquierda ?? 0)} / ${Math.round(actual.promPwmDerecha ?? 0)}`}
              />
              <Dato etiqueta="Mínima izquierda" valor={cm(actual.minIzquierdaCm)} />
              <Dato etiqueta="Mínima central" valor={cm(actual.minCentralCm)} />
              <Dato etiqueta="Mínima derecha" valor={cm(actual.minDerechaCm)} />
              <Dato
                etiqueta="Batería"
                valor={`${pct(actual.bateriaInicioPorcentaje)} → ${pct(actual.bateriaFinPorcentaje)}`}
              />
            </dl>
          </Tarjeta>

          <div className="grid gap-4 md:grid-cols-2">
            <Tarjeta titulo="Marcha y parada" subtitulo="Reparto de las lecturas">
              <div className="h-[240px]">
                <DonaMarcha s={actual} />
              </div>
            </Tarjeta>
            <Tarjeta titulo="Obstáculos por sensor" subtitulo="Lecturas a 15 cm o menos">
              <div className="h-[240px]">
                <BarrasObstaculos s={actual} />
              </div>
            </Tarjeta>
          </div>
        </div>
      )}
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-tinta-suave">{etiqueta}</dt>
      <dd className="font-medium tabular-nums">{valor}</dd>
    </div>
  );
}
