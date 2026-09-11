"use client";

import { useState } from "react";
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
import { Tarjeta } from "@/components/comunes/tarjeta";
import { TooltipGrafico } from "@/components/comunes/graficos";
import { Vacio } from "@/components/comunes/estados";
import { fmtHora } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PuntoVivo } from "@/lib/bus";

const SERIES = [
  { clave: "distanciaFrontalCm", etiqueta: "Frontal", color: "var(--sensor-frontal)", eje: "izq" },
  { clave: "distanciaIzquierdaCm", etiqueta: "Izquierda", color: "var(--sensor-izq)", eje: "izq" },
  { clave: "distanciaDerechaCm", etiqueta: "Derecha", color: "var(--sensor-der)", eje: "izq" },
  { clave: "densidadPolvoMgM3", etiqueta: "Polvo", color: "var(--polvo)", eje: "der" },
] as const;

const UNIDADES: Record<string, string> = {
  distanciaFrontalCm: "cm",
  distanciaIzquierdaCm: "cm",
  distanciaDerechaCm: "cm",
  densidadPolvoMgM3: "mg/m³",
};

const ETIQUETAS: Record<string, string> = {
  distanciaFrontalCm: "Frontal",
  distanciaIzquierdaCm: "Izquierda",
  distanciaDerechaCm: "Derecha",
  densidadPolvoMgM3: "Polvo",
};

/**
 * Ventana deslizante de los últimos 120 s. Eje izquierdo en cm para los tres
 * ultrasónicos, eje derecho en mg/m³ para el polvo. Las marcas verticales
 * señalan los instantes con maniobra de evasión.
 */
export function GraficoVivo({
  puntos,
  evasiones,
}: {
  puntos: PuntoVivo[];
  evasiones: number[];
}) {
  const [ocultas, setOcultas] = useState<Set<string>>(new Set());

  const alternar = (clave: string) =>
    setOcultas((prev) => {
      const s = new Set(prev);
      if (s.has(clave)) s.delete(clave);
      else s.add(clave);
      return s;
    });

  const datos = puntos.map((p) => ({ ...p, ms: new Date(p.t).getTime() }));

  const leyenda = (
    <ul className="flex flex-wrap items-center gap-3">
      {SERIES.map((s) => (
        <li key={s.clave}>
          <button
            type="button"
            onClick={() => alternar(s.clave)}
            aria-pressed={!ocultas.has(s.clave)}
            className={cn(
              "flex items-center gap-1.5 text-[11px] transition-opacity duration-150",
              ocultas.has(s.clave) ? "opacity-35" : "opacity-100",
            )}
          >
            <span
              className="size-2 rounded-[2px]"
              style={{ background: s.color }}
              aria-hidden
            />
            <span className="text-[var(--text-muted)]">{s.etiqueta}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <Tarjeta etiqueta="Telemetría en vivo · últimos 120 s" accion={leyenda} className="h-full">
      {datos.length < 2 ? (
        <Vacio mensaje="Esperando telemetría del robot. En cuanto llegue la primera muestra la curva empieza a dibujarse." />
      ) : (
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={datos} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid vertical={false} strokeDasharray="0" />
              <XAxis
                dataKey="ms"
                type="number"
                domain={["dataMin", "dataMax"]}
                scale="time"
                tickFormatter={(v: number) => fmtHora(new Date(v))}
                axisLine={false}
                tickLine={false}
                minTickGap={48}
              />
              <YAxis
                yAxisId="izq"
                domain={[0, 220]}
                axisLine={false}
                tickLine={false}
                width={44}
                label={undefined}
              />
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
              {evasiones.map((ms) => (
                <ReferenceLine
                  key={ms}
                  x={ms}
                  yAxisId="izq"
                  stroke="var(--text-faint)"
                  strokeDasharray="2 3"
                />
              ))}
              {SERIES.filter((s) => !ocultas.has(s.clave)).map((s) => (
                <Line
                  key={s.clave}
                  yAxisId={s.eje}
                  type="monotone"
                  dataKey={s.clave}
                  name={s.etiqueta}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Tarjeta>
  );
}
