"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Label,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Tarjeta } from "@/components/comunes/tarjeta";
import { TooltipGrafico } from "@/components/comunes/graficos";
import { Vacio } from "@/components/comunes/estados";
import { fmtHora, num } from "@/lib/format";

/**
 * Curva de descontaminación: el PM de la sesión desde su pico inicial hacia
 * abajo. Es el único gráfico con relleno, porque el área bajo la curva
 * comunica el volumen de polvo todavía en suspensión.
 */
export function CurvaDescontaminacion({
  datos,
  objetivo,
  efectividad,
}: {
  datos: Array<{ ms: number; pm: number }>;
  objetivo: number;
  efectividad: number | null;
}) {
  return (
    <Tarjeta
      etiqueta="Curva de descontaminación"
      accion={
        efectividad !== null ? (
          <span className="valor text-[var(--ok)]">−{num(efectividad, 1)} % PM</span>
        ) : null
      }
      className="h-full"
    >
      {datos.length < 2 ? (
        <Vacio mensaje="La curva aparece en cuanto haya una sesión con lecturas del sensor de polvo." />
      ) : (
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={datos} margin={{ top: 8, right: 44, bottom: 0, left: -14 }}>
              <defs>
                <linearGradient id="grad-polvo" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--polvo)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--polvo)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
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
                domain={[0, "auto"]}
                axisLine={false}
                tickLine={false}
                width={48}
                tickFormatter={(v: number) => v.toFixed(2)}
              />
              <Tooltip
                content={
                  <TooltipGrafico
                    unidades={{ pm: "mg/m³" }}
                    etiquetas={{ pm: "Densidad de polvo" }}
                    formateaLabel={(v) => fmtHora(new Date(Number(v)))}
                  />
                }
              />
              <ReferenceLine
                y={objetivo}
                stroke="var(--text-faint)"
                strokeDasharray="3 3"
                ifOverflow="extendDomain"
              >
                <Label
                  value={`objetivo ${num(objetivo, 2)}`}
                  position="right"
                  fill="var(--text-faint)"
                  fontSize={11}
                />
              </ReferenceLine>
              <Area
                type="monotone"
                dataKey="pm"
                stroke="var(--polvo)"
                strokeWidth={2}
                fill="url(#grad-polvo)"
                dot={false}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Tarjeta>
  );
}
