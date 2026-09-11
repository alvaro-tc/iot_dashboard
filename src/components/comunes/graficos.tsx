"use client";

import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { num } from "@/lib/format";

/** Tooltip común: tarjeta con borde de 1 px, valores monoespaciados y unidad. */
export function TooltipGrafico({
  active,
  payload,
  label,
  unidades = {},
  etiquetas = {},
  formateaLabel,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; name?: string; value?: number; color?: string }>;
  label?: string | number;
  unidades?: Record<string, string>;
  etiquetas?: Record<string, string>;
  formateaLabel?: (v: string | number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 shadow-sm">
      {label !== undefined && (
        <p className="mb-1.5 text-[11px] text-[var(--text-muted)]">
          {formateaLabel ? formateaLabel(label) : label}
        </p>
      )}
      <ul className="space-y-1">
        {payload.map((p, i) => {
          const clave = String(p.dataKey ?? p.name ?? i);
          return (
            <li key={clave + i} className="flex items-center gap-2 text-xs">
              <span
                className="size-2 shrink-0 rounded-[2px]"
                style={{ background: p.color }}
                aria-hidden
              />
              <span className="text-[var(--text-muted)]">{etiquetas[clave] ?? p.name ?? clave}</span>
              <span className="valor ml-auto text-[var(--text)]">
                {typeof p.value === "number" ? num(p.value, 2) : "—"}
                {unidades[clave] ? ` ${unidades[clave]}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Sparkline de fondo para las tarjetas de KPI. Sin ejes, sin interacción. */
export function Sparkline({
  datos,
  color,
}: {
  datos: Array<{ v: number | null }>;
  color: string;
}) {
  if (datos.length < 2) return null;
  const id = `spark-${color.replace(/[^a-z]/gi, "")}`;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 opacity-40" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={datos} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${id})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
