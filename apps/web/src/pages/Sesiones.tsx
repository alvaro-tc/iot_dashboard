// /sesiones — lista de sesiones con el detalle de la seleccionada: mapa completo del
// recorrido, dona de estados de movimiento y barras de evasiones por sensor.
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { Chart } from '../lib/chart.ts';
import { distancia, duracion, fechaHora, hora, ms, pct } from '../lib/formato.ts';
import { useRobots } from '../lib/robots.tsx';
import { useColoresTema } from '../lib/tema.tsx';
import type { PuntoMapa, ResumenSesion } from '../lib/types.ts';
import { MapaVivo, type MapaApi } from '../components/MapaVivo.tsx';
import { aPose } from '../components/TarjetaSesiones.tsx';
import { Esqueleto, Tarjeta, Vacio } from '../components/ui.tsx';
import { CONFIG_POR_DEFECTO } from '@iot/shared';
import { useSocket } from '../lib/socket.tsx';

function DonaMovimientos({ s }: { s: ResumenSesion }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colores = useColoresTema();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Avanzando', 'Girando izq.', 'Girando der.', 'Retrocediendo', 'Detenido'],
        datasets: [
          {
            data: [s.nAvanzando, s.nGirandoIzq, s.nGirandoDer, s.nRetrocediendo, s.nDetenido],
            backgroundColor: [colores.libre, colores.precaucion, '#fbbf24', colores.evasion, colores.tintaSuave],
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
        },
      },
    });
    return () => chart.destroy();
  }, [s, colores.tema]); // eslint-disable-line react-hooks/exhaustive-deps

  return <canvas ref={canvasRef} role="img" aria-label="Distribución de estados de movimiento" />;
}

function BarrasEvasiones({ s }: { s: ResumenSesion }) {
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
            label: 'Evasiones',
            data: [s.evasionesIzq, s.evasionesCentro, s.evasionesDer],
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

  return <canvas ref={canvasRef} role="img" aria-label="Evasiones por sensor" />;
}

export function Sesiones() {
  const { robot } = useRobots();
  const { config } = useSocket();
  const [seleccion, setSeleccion] = useState<number | null>(null);
  const mapa = useRef<MapaApi>(null);

  const { data: sesiones, isLoading } = useQuery<ResumenSesion[]>({
    queryKey: ['sesiones', robot?.id],
    queryFn: () => api(`/api/dispositivos/${robot!.id}/sesiones`),
    enabled: !!robot,
  });

  const lista = sesiones ?? [];
  const actual = lista.find((s) => s.id === seleccion) ?? lista[0] ?? null;

  const { data: recorrido } = useQuery<PuntoMapa[]>({
    queryKey: ['mapa-sesion-completo', actual?.id],
    queryFn: () => api(`/api/sesiones/${actual!.id}/mapa`),
    enabled: !!actual,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!recorrido) return;
    mapa.current?.cargar(recorrido.map(aPose));
  }, [recorrido]);

  if (isLoading) return <Esqueleto className="h-[400px]" />;

  if (!lista.length) {
    return (
      <Tarjeta titulo="Sesiones">
        <Vacio
          titulo="Sin sesiones todavía"
          descripcion="Cada vez que el robot pase a modo automático se abrirá una sesión y aparecerá aquí."
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
                  {fechaHora(s.iniciadaEn)} · {duracion(s.duracionS)} · {distancia(s.distanciaCm)}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </Tarjeta>

      {actual && (
        <div className="grid content-start gap-4">
          <Tarjeta
            titulo={`Recorrido de la sesión ${hora(actual.iniciadaEn)}`}
            subtitulo={`${actual.lecturas} lecturas · ${pct(actual.pctPerdidas)} perdidas · latencia media ${ms(actual.latenciaMs)}`}
          >
            <div className="h-[340px] overflow-hidden rounded-[1.25rem] bg-[#0f172a]">
              <MapaVivo
                ref={mapa}
                config={config ?? CONFIG_POR_DEFECTO}
                seguir={false}
                mostrarHaces={false}
                area={{ ancho: config?.areaAnchoCm ?? 500, alto: config?.areaAltoCm ?? 400 }}
              />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
              <Dato etiqueta="Duración" valor={duracion(actual.duracionS)} />
              <Dato etiqueta="Distancia" valor={distancia(actual.distanciaCm)} />
              <Dato etiqueta="Evasiones" valor={String(actual.evasiones)} />
              <Dato etiqueta="Batería consumida" valor={pct(actual.bateriaConsumidaPct)} />
            </dl>
          </Tarjeta>

          <div className="grid gap-4 md:grid-cols-2">
            <Tarjeta titulo="Estados de movimiento" subtitulo="Reparto de las lecturas">
              <div className="h-[240px]">
                <DonaMovimientos s={actual} />
              </div>
            </Tarjeta>
            <Tarjeta titulo="Evasiones por sensor" subtitulo="Qué lado encontró más muebles">
              <div className="h-[240px]">
                <BarrasEvasiones s={actual} />
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
