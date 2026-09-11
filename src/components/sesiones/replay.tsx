"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Tarjeta } from "@/components/comunes/tarjeta";
import { TooltipGrafico } from "@/components/comunes/graficos";
import { BadgeSeveridad, Vacio } from "@/components/comunes/estados";
import { Button } from "@/components/ui/button";
import { SensoresUltrasonicos } from "@/components/panel/sensores-ultrasonicos";
import { fmtHora, num } from "@/lib/format";
import { ETIQUETA_EVENTO, type TipoEvento } from "@/lib/constantes";
import { cn } from "@/lib/utils";

export type Frame = {
  t: number;
  n: number;
  DIST_FRONTAL?: number | null;
  DIST_IZQ?: number | null;
  DIST_DER?: number | null;
  POLVO?: number | null;
  velocidadMs?: number | null;
  pulsosIzq?: number | null;
  pulsosDer?: number | null;
  bateriaPct?: number | null;
};

export type EventoSesion = {
  id: string;
  timestamp: string;
  tipo: string;
  severidad: string;
  sensor: string | null;
  valor: number | null;
  unidad: string | null;
  accion: string | null;
};

const VELOCIDADES = [1, 2, 4] as const;

const UNIDADES = {
  DIST_FRONTAL: "cm",
  DIST_IZQ: "cm",
  DIST_DER: "cm",
  POLVO: "mg/m³",
};

const ETIQUETAS = {
  DIST_FRONTAL: "Frontal",
  DIST_IZQ: "Izquierda",
  DIST_DER: "Derecha",
  POLVO: "Polvo",
};

/**
 * Reproductor de la sesión: avanza fotograma a fotograma sobre la telemetría
 * ya almacenada. Un fotograma equivale a un instante de muestreo.
 */
export function Replay({
  frames,
  eventos,
  umbralFrontal,
  umbralLateral,
}: {
  frames: Frame[];
  eventos: EventoSesion[];
  umbralFrontal: number;
  umbralLateral: number;
}) {
  const [indice, setIndice] = useState(0);
  const [reproduciendo, setReproduciendo] = useState(false);
  const [velocidad, setVelocidad] = useState<(typeof VELOCIDADES)[number]>(1);
  const temporizador = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!reproduciendo || frames.length === 0) return;
    // 500 ms por fotograma a ×1: el mismo ritmo que la telemetría a 2 Hz.
    temporizador.current = setInterval(() => {
      setIndice((i) => {
        if (i >= frames.length - 1) {
          setReproduciendo(false);
          return i;
        }
        return i + 1;
      });
    }, 500 / velocidad);
    return () => {
      if (temporizador.current) clearInterval(temporizador.current);
    };
  }, [reproduciendo, velocidad, frames.length]);

  const actual = frames[indice];
  const hasta = useMemo(() => frames.slice(0, indice + 1), [frames, indice]);

  const inicio = frames[0]?.t ?? 0;
  const fin = frames[frames.length - 1]?.t ?? 0;
  const duracion = Math.max(1, fin - inicio);

  if (frames.length === 0) {
    return (
      <Tarjeta etiqueta="Replay de la sesión">
        <Vacio mensaje="Esta sesión no tiene telemetría almacenada para reproducir." />
      </Tarjeta>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="lg:col-span-8">
        <Tarjeta
          etiqueta={`Replay · fotograma ${indice + 1} de ${frames.length}`}
          accion={
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setReproduciendo((r) => !r)}
                aria-label={reproduciendo ? "Pausar replay" : "Reproducir replay"}
              >
                {reproduciendo ? (
                  <Pause className="size-3.5" aria-hidden />
                ) : (
                  <Play className="size-3.5" aria-hidden />
                )}
                {reproduciendo ? "Pausa" : "Play"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIndice(0);
                  setReproduciendo(false);
                }}
                aria-label="Reiniciar replay"
              >
                <RotateCcw className="size-3.5" aria-hidden />
              </Button>
              <div className="flex overflow-hidden rounded-md border border-[var(--border)]">
                {VELOCIDADES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVelocidad(v)}
                    aria-pressed={velocidad === v}
                    className={cn(
                      "valor px-2 py-1 text-[11px] transition-colors duration-150",
                      velocidad === v
                        ? "bg-[var(--surface-alt)] text-[var(--text)]"
                        : "text-[var(--text-muted)]",
                    )}
                  >
                    ×{v}
                  </button>
                ))}
              </div>
            </div>
          }
        >
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={hasta} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={[inicio, fin]}
                  scale="time"
                  tickFormatter={(v: number) => fmtHora(new Date(v))}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={48}
                />
                <YAxis yAxisId="izq" domain={[0, 220]} axisLine={false} tickLine={false} width={44} />
                <YAxis
                  yAxisId="der"
                  orientation="right"
                  domain={[0, 0.55]}
                  axisLine={false}
                  tickLine={false}
                  width={46}
                />
                <Tooltip
                  content={
                    <TooltipGrafico
                      unidades={UNIDADES}
                      etiquetas={ETIQUETAS}
                      formateaLabel={(v) => fmtHora(new Date(Number(v)))}
                    />
                  }
                />
                {actual && (
                  <ReferenceLine x={actual.t} yAxisId="izq" stroke="var(--text-faint)" />
                )}
                <Line yAxisId="izq" type="monotone" dataKey="DIST_FRONTAL" stroke="var(--sensor-frontal)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="izq" type="monotone" dataKey="DIST_IZQ" stroke="var(--sensor-izq)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="izq" type="monotone" dataKey="DIST_DER" stroke="var(--sensor-der)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="der" type="monotone" dataKey="POLVO" stroke="var(--polvo)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <label className="mt-4 block">
            <span className="sr-only">Posición del replay</span>
            <input
              type="range"
              min={0}
              max={frames.length - 1}
              value={indice}
              onChange={(e) => setIndice(Number(e.target.value))}
              className="w-full accent-[var(--sensor-frontal)]"
              aria-valuetext={actual ? fmtHora(new Date(actual.t)) : undefined}
            />
          </label>

          {/* Timeline horizontal de eventos de la sesión. */}
          <div className="relative mt-4 h-8 border-t border-[var(--border)] pt-3">
            {eventos.map((e) => {
              const pos = ((new Date(e.timestamp).getTime() - inicio) / duracion) * 100;
              if (pos < 0 || pos > 100) return null;
              const color =
                e.severidad === "CRITICO"
                  ? "var(--critical)"
                  : e.severidad === "ADVERTENCIA"
                    ? "var(--warn)"
                    : "var(--text-faint)";
              return (
                <span
                  key={e.id}
                  title={`${ETIQUETA_EVENTO[e.tipo as TipoEvento] ?? e.tipo} · ${fmtHora(e.timestamp)}`}
                  className="absolute top-3 size-1.5 -translate-x-1/2 rounded-full"
                  style={{ left: `${pos}%`, background: color }}
                />
              );
            })}
          </div>
        </Tarjeta>
      </div>

      <div className="lg:col-span-4">
        <SensoresUltrasonicos
          frontal={actual?.DIST_FRONTAL ?? 0}
          izquierda={actual?.DIST_IZQ ?? 0}
          derecha={actual?.DIST_DER ?? 0}
          umbralFrontal={umbralFrontal}
          umbralLateral={umbralLateral}
          detecciones={{ frontal: 0, izq: 0, der: 0 }}
        />
      </div>

      <div className="lg:col-span-12">
        <Tarjeta etiqueta="Línea de tiempo de eventos">
          {eventos.length === 0 ? (
            <Vacio mensaje="La sesión no registró eventos." />
          ) : (
            <ol className="max-h-72 space-y-2 overflow-y-auto pr-2">
              {eventos.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] pb-2 text-xs last:border-0"
                >
                  <span className="valor w-16 text-[var(--text-muted)]">{fmtHora(e.timestamp)}</span>
                  <BadgeSeveridad severidad={e.severidad} />
                  <span className="text-[var(--text)]">
                    {ETIQUETA_EVENTO[e.tipo as TipoEvento] ?? e.tipo}
                  </span>
                  {e.valor !== null && (
                    <span className="valor text-[var(--text-muted)]">
                      {num(e.valor, 1)} {e.unidad ?? ""}
                    </span>
                  )}
                  <span className="ml-auto text-[var(--text-faint)]">{e.accion ?? ""}</span>
                </li>
              ))}
            </ol>
          )}
        </Tarjeta>
      </div>
    </div>
  );
}
