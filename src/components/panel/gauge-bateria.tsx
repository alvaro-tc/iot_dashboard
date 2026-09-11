"use client";

import { Area, AreaChart, ReferenceLine, ResponsiveContainer, YAxis } from "recharts";
import { Tarjeta } from "@/components/comunes/tarjeta";
import { fmtDuracion, num } from "@/lib/format";

const CIRCUNFERENCIA = 2 * Math.PI * 52;

/** Anillo de carga más la curva de descarga de las últimas 2 h. */
export function GaugeBateria({
  pct,
  voltaje,
  minutosRestantes,
  umbralRetorno,
  serie,
}: {
  pct: number;
  voltaje: number;
  minutosRestantes: number | null;
  umbralRetorno: number;
  serie: Array<{ v: number | null }>;
}) {
  const color =
    pct <= umbralRetorno
      ? "var(--critical)"
      : pct <= umbralRetorno + 15
        ? "var(--warn)"
        : "var(--bateria)";

  return (
    <Tarjeta etiqueta="Batería" className="h-full">
      <div className="flex items-center gap-5">
        <svg
          viewBox="0 0 120 120"
          className="size-28 shrink-0 -rotate-90"
          role="meter"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Batería al ${Math.round(pct)} por ciento`}
        >
          <circle cx={60} cy={60} r={52} fill="none" stroke="var(--surface-alt)" strokeWidth={8} />
          <circle
            cx={60}
            cy={60}
            r={52}
            fill="none"
            stroke={color}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={CIRCUNFERENCIA}
            strokeDashoffset={CIRCUNFERENCIA * (1 - Math.max(0, Math.min(100, pct)) / 100)}
            style={{ transition: "stroke-dashoffset 150ms ease-out" }}
          />
        </svg>

        <dl className="min-w-0 flex-1 space-y-2">
          <div>
            <dt className="etiqueta text-[11px]">Carga</dt>
            <dd className="valor text-xl" style={{ color }}>
              {num(pct, 0)} %
            </dd>
          </div>
          <div>
            <dt className="etiqueta text-[11px]">Tensión</dt>
            <dd className="valor">{num(voltaje, 2)} V</dd>
          </div>
          <div>
            <dt className="etiqueta text-[11px]">Autonomía estimada</dt>
            <dd className="valor">
              {minutosRestantes !== null ? fmtDuracion(minutosRestantes * 60) : "—"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-4 h-16 w-full border-t border-[var(--border)] pt-3">
        {serie.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={serie} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="grad-bateria" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--bateria)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--bateria)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis domain={[0, 100]} hide />
              <ReferenceLine
                y={umbralRetorno}
                stroke="var(--text-faint)"
                strokeDasharray="3 3"
              />
              <Area
                type="monotone"
                dataKey="v"
                stroke="var(--bateria)"
                strokeWidth={2}
                fill="url(#grad-bateria)"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-[11px] text-[var(--text-faint)]">
            Sin histórico de descarga en las últimas 2 h.
          </p>
        )}
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-faint)]">
        Línea punteada: umbral de retorno a base ({num(umbralRetorno, 0)} %)
      </p>
    </Tarjeta>
  );
}
