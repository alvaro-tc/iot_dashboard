// "Batería": equivale a la tarjeta del Bluetooth Speaker de la referencia.
// Gauge semicircular (doughnut con circumference 180) y chips de voltaje y autonomía.
import { useEffect, useMemo, useRef, useState } from 'react';
import { BatteryCharging, Timer } from 'lucide-react';
import { api } from '../lib/api.ts';
import { Chart } from '../lib/chart.ts';
import { duracion, voltios } from '../lib/formato.ts';
import { useRobots } from '../lib/robots.tsx';
import { useSocket, useUltimaLectura } from '../lib/socket.tsx';
import { useColoresTema } from '../lib/tema.tsx';
import { useToast } from '../lib/toast.tsx';
import type { LecturaAgregada } from '../lib/types.ts';
import { Chip, Interruptor, Tarjeta } from './ui.tsx';

/** Intervalo de telemetría en modo ahorro de energía. */
const AHORRO_MS = 1000;
const NORMAL_MS = 200;

function Gauge({ pct, color }: { pct: number; color: string }) {
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

  return <canvas ref={canvasRef} role="img" aria-label={`Batería al ${Math.round(pct)} por ciento`} />;
}

export function TarjetaBateria() {
  const { robot } = useRobots();
  const { config, actualizarConfig } = useSocket();
  const lectura = useUltimaLectura(1);
  const colores = useColoresTema();
  const toast = useToast();

  const [popover, setPopover] = useState(false);
  const [voltajes, setVoltajes] = useState<LecturaAgregada[]>([]);
  const historialVoltaje = useRef<{ t: number; pct: number }[]>([]);

  const pct = lectura?.bateriaPct ?? 0;
  const ahorro = (config?.intervaloTelemetriaMs ?? NORMAL_MS) >= AHORRO_MS;

  // Autonomía: pendiente de descarga de los últimos minutos extrapolada hasta el 0 %.
  // Es una estimación burda y se etiqueta como tal; con la batería recién cargada o el
  // robot parado no hay pendiente de la que tirar.
  const autonomia = useMemo(() => {
    const h = historialVoltaje.current;
    if (h.length < 2) return null;
    const primero = h[0];
    const ultimo = h.at(-1)!;
    const minutos = (ultimo.t - primero.t) / 60_000;
    const caida = primero.pct - ultimo.pct;
    if (minutos < 1 || caida <= 0) return null;
    return (ultimo.pct / (caida / minutos)) * 60; // segundos restantes
  }, [pct]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!lectura) return;
    historialVoltaje.current.push({ t: Date.now(), pct: lectura.bateriaPct });
    if (historialVoltaje.current.length > 600) historialVoltaje.current.shift();
  }, [lectura]);

  useEffect(() => {
    if (!popover || !robot) return;
    const desde = new Date(Date.now() - 3_600_000).toISOString();
    api<LecturaAgregada[]>(`/api/dispositivos/${robot.id}/lecturas?agregacion=minuto&desde=${desde}`)
      .then(setVoltajes)
      .catch(() => setVoltajes([]));
  }, [popover, robot?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const color = pct < 20 ? colores.evasion : pct < 50 ? colores.precaucion : colores.libre;

  const cambiarAhorro = async (activo: boolean) => {
    const r = await actualizarConfig({ intervaloTelemetriaMs: activo ? AHORRO_MS : NORMAL_MS });
    if (!r.ok) toast(r.error ?? 'No se pudo cambiar el modo de ahorro.', 'error');
  };

  return (
    <Tarjeta
      titulo="Batería"
      subtitulo={ahorro ? 'Ahorro de energía activo' : 'Telemetría a 5 Hz'}
      accion={
        <div className="flex items-center gap-2">
          <span className="hidden text-[13px] text-tinta-suave @[22rem]:inline">Ahorro</span>
          <Interruptor activo={ahorro} onCambiar={cambiarAhorro} etiqueta="Ahorro de energía" disabled={!robot} />
        </div>
      }
      pie={
        <>
          <Chip icono={<BatteryCharging className="size-3.5" />} activo={popover} onClick={() => setPopover((v) => !v)}>
            {voltios(lectura?.bateriaV)}
          </Chip>
          <Chip icono={<Timer className="size-3.5" />}>
            {autonomia ? duracion(autonomia) : 'Autonomía —'}
          </Chip>
        </>
      }
    >
      <div className="relative">
        <div className="relative mx-auto h-[120px] max-w-[220px]">
          <Gauge pct={pct} color={color} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 text-center">
            <p className="text-[34px] leading-none font-bold tabular-nums">{pct}</p>
            <p className="text-[13px] text-tinta-suave">por ciento</p>
          </div>
        </div>

        {popover && (
          <div className="absolute inset-x-0 bottom-0 z-10 rounded-2xl border border-borde bg-tarjeta p-3 shadow-lg">
            <p className="mb-2 text-[13px] font-medium">Batería de la última hora</p>
            {voltajes.length ? (
              <ul className="max-h-28 space-y-1 overflow-y-auto text-[12px] text-tinta-suave">
                {voltajes.slice(-12).map((v) => (
                  <li key={v.instante} className="flex justify-between">
                    <span>{new Date(v.instante).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="tabular-nums text-tinta">
                      {v.promBateriaPct === null ? '—' : `${Math.round(v.promBateriaPct)} %`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-tinta-suave">Sin datos en la última hora.</p>
            )}
            <button type="button" className="btn btn-sm mt-2 w-full" onClick={() => setPopover(false)}>
              Cerrar
            </button>
          </div>
        )}
      </div>
    </Tarjeta>
  );
}
