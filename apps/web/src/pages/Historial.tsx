// /historial — agregados desde Postgres: distancia mínima por hora y sensor, reparto entre
// marcha y parada, PWM medio de cada rueda y heatmap de obstáculos (24 h × 7 días).
//
// Todo sale de v_lecturas_por_hora: la vista ya hace las cuentas y aquí solo se dibujan.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { BASE, api, tokenStore } from '../lib/api.ts';
import { Chart } from '../lib/chart.ts';
import { useRobots } from '../lib/robots.tsx';
import { useColoresTema } from '../lib/tema.tsx';
import { useToast } from '../lib/toast.tsx';
import type { LecturaAgregada } from '../lib/types.ts';
import { Esqueleto, Segmentado, Tarjeta, Vacio } from '../components/ui.tsx';

type Rango = '24h' | '7d' | '30d';
const DIAS: Record<Rango, number> = { '24h': 1, '7d': 7, '30d': 30 };

/** Gráfica genérica: se crea una vez y se actualiza con los datos. */
function useGrafica(config: () => ConstructorParameters<typeof Chart>[1], deps: unknown[]) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const chart = new Chart(canvas, config());
    return () => chart.destroy();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return canvasRef;
}

const ETIQUETA_HORA = (iso: string) =>
  new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit' });

export function Historial() {
  const { robot } = useRobots();
  const colores = useColoresTema();
  const toast = useToast();
  const [rango, setRango] = useState<Rango>('7d');

  const desde = useMemo(() => new Date(Date.now() - DIAS[rango] * 86_400_000).toISOString(), [rango]);

  const { data: filas, isLoading } = useQuery<LecturaAgregada[]>({
    queryKey: ['historial', robot?.id, rango],
    queryFn: () => api(`/api/dispositivos/${robot!.id}/lecturas?agregacion=hora&desde=${desde}`),
    enabled: !!robot,
  });

  const datos = filas ?? [];

  const refDistancias = useGrafica(
    () => ({
      type: 'bar',
      data: {
        labels: datos.map((f) => ETIQUETA_HORA(f.instante)),
        datasets: [
          { label: 'Izquierdo', data: datos.map((f) => f.minIzquierdaCm), backgroundColor: '#60a5fa', borderRadius: 4 },
          { label: 'Central', data: datos.map((f) => f.minCentralCm), backgroundColor: colores.acento, borderRadius: 4 },
          { label: 'Derecho', data: datos.map((f) => f.minDerechaCm), backgroundColor: '#a78bfa', borderRadius: 4 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: colores.tintaSuave, boxWidth: 10, usePointStyle: true } },
          tooltip: { callbacks: { label: (i) => `${i.dataset.label}: ${i.parsed.y?.toFixed(1) ?? '—'} cm` } },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: colores.tintaSuave, maxTicksLimit: 10 } },
          y: {
            beginAtZero: true,
            grid: { color: colores.borde },
            border: { display: false },
            ticks: { color: colores.tintaSuave, callback: (v) => `${v} cm` },
          },
        },
      },
    }),
    [datos, colores.tema],
  );

  const refEstados = useGrafica(
    () => ({
      type: 'bar',
      data: {
        labels: datos.map((f) => ETIQUETA_HORA(f.instante)),
        datasets: [
          { label: 'En marcha', data: datos.map((f) => f.lecturasEnMarcha), backgroundColor: colores.libre },
          { label: 'Detenido', data: datos.map((f) => f.lecturasDetenido), backgroundColor: colores.tintaSuave },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: colores.tintaSuave, boxWidth: 10, usePointStyle: true } },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { color: colores.tintaSuave, maxTicksLimit: 10 } },
          y: { stacked: true, grid: { color: colores.borde }, border: { display: false }, ticks: { color: colores.tintaSuave } },
        },
      },
    }),
    [datos, colores.tema],
  );

  const refPwm = useGrafica(
    () => ({
      type: 'line',
      data: {
        labels: datos.map((f) => ETIQUETA_HORA(f.instante)),
        datasets: [
          {
            label: 'Rueda izquierda',
            data: datos.map((f) => f.promPwmIzquierda),
            borderColor: colores.acento,
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.3,
          },
          {
            label: 'Rueda derecha',
            data: datos.map((f) => f.promPwmDerecha),
            borderColor: '#60a5fa',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: colores.tintaSuave, boxWidth: 10, usePointStyle: true } },
          tooltip: { callbacks: { label: (i) => `${i.dataset.label}: ${Math.round(i.parsed.y ?? 0)} de 255` } },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: colores.tintaSuave, maxTicksLimit: 8 } },
          y: {
            beginAtZero: true,
            suggestedMax: 255,
            grid: { color: colores.borde },
            border: { display: false },
            ticks: { color: colores.tintaSuave },
          },
        },
      },
    }),
    [datos, colores.tema],
  );

  // Heatmap 24 h × 7 días: se dibuja con una tabla, no con Chart.js. Una matriz de celdas de
  // color no necesita escalas ni ejes, y así es accesible con title por celda.
  // Cada celda suma las lecturas en las que algún sensor vio algo a 15 cm o menos.
  const matriz = useMemo(() => {
    const m: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const f of datos) {
      const d = new Date(f.instante);
      m[(d.getDay() + 6) % 7][d.getHours()] +=
        (f.cercaIzquierda ?? 0) + (f.cercaCentral ?? 0) + (f.cercaDerecha ?? 0); // lunes primero
    }
    return m;
  }, [datos]);
  const maximo = Math.max(1, ...matriz.flat());

  const exportarCsv = async () => {
    if (!robot) return;
    try {
      const res = await fetch(
        `${BASE}/api/dispositivos/${robot.id}/lecturas/export.csv?desde=${encodeURIComponent(desde)}`,
        { headers: { Authorization: `Bearer ${tokenStore.get() ?? ''}` } },
      );
      if (!res.ok) throw new Error(`La API respondió ${res.status}.`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lecturas-${robot.id}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'No se pudo exportar el CSV.', 'error');
    }
  };

  if (isLoading) return <Esqueleto className="h-[400px]" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmentado
          etiqueta="Rango"
          valor={rango}
          onCambiar={setRango}
          opciones={[
            { valor: '24h' as Rango, texto: '24 h' },
            { valor: '7d' as Rango, texto: '7 días' },
            { valor: '30d' as Rango, texto: '30 días' },
          ]}
        />
        <button type="button" className="btn btn-acento" onClick={exportarCsv} disabled={!robot}>
          <Download className="size-4" />
          Exportar CSV
        </button>
      </div>

      {!datos.length ? (
        <Tarjeta titulo="Historial">
          <Vacio titulo="Sin datos en este rango" descripcion="Pon el robot en marcha y vuelve a mirar." />
        </Tarjeta>
      ) : (
        <>
          <Tarjeta titulo="Distancia mínima por hora" subtitulo="Lo más cerca que estuvo un obstáculo en cada hora">
            <div className="h-[280px]">
              <canvas ref={(c) => void (refDistancias.current = c)} />
            </div>
          </Tarjeta>

          <div className="grid gap-4 xl:grid-cols-2">
            <Tarjeta titulo="Marcha y parada por hora" subtitulo="Lecturas apiladas">
              <div className="h-[280px]">
                <canvas ref={(c) => void (refEstados.current = c)} />
              </div>
            </Tarjeta>

            <Tarjeta titulo="PWM medio por rueda" subtitulo="Valor absoluto, de 0 a 255">
              <div className="h-[280px]">
                <canvas ref={(c) => void (refPwm.current = c)} />
              </div>
            </Tarjeta>
          </div>

          <Tarjeta titulo="Obstáculos por hora y día" subtitulo="Cuándo se encuentra más muebles">
            <div className="overflow-x-auto">
              <table className="border-separate border-spacing-[2px]">
                <caption className="sr-only">Mapa de calor de obstáculos por día de la semana y hora del día</caption>
                <thead>
                  <tr>
                    <th />
                    {Array.from({ length: 24 }, (_, h) => (
                      <th key={h} className="p-0 text-[10px] font-normal text-tinta-suave">
                        {h % 3 === 0 ? h : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((dia, d) => (
                    <tr key={dia}>
                      <th scope="row" className="pr-2 text-[11px] font-normal text-tinta-suave">
                        {dia}
                      </th>
                      {matriz[d].map((n, h) => (
                        <td
                          key={h}
                          title={`${dia} ${h}:00 — ${n} lecturas con obstáculo cerca`}
                          className="size-4 rounded-[3px]"
                          style={{
                            background:
                              n === 0 ? 'var(--color-tarjeta-tenue)' : `color-mix(in srgb, var(--color-acento) ${(n / maximo) * 100}%, transparent)`,
                          }}
                        />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Tarjeta>
        </>
      )}
    </div>
  );
}
