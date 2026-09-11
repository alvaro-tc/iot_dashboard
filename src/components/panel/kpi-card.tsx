"use client";

import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/comunes/graficos";

/**
 * Tarjeta de KPI: número grande, contexto debajo y sparkline de fondo.
 * El valor cambia con una transición breve, sin conteo animado.
 */
export function KpiCard({
  etiqueta,
  valor,
  unidad,
  contexto,
  serie,
  color,
  tono = "neutro",
}: {
  etiqueta: string;
  valor: string;
  unidad?: string;
  contexto?: React.ReactNode;
  serie?: Array<{ v: number | null }>;
  color: string;
  tono?: "neutro" | "ok" | "warn" | "critical";
}) {
  const colorValor =
    tono === "ok"
      ? "text-[var(--ok)]"
      : tono === "warn"
        ? "text-[var(--warn)]"
        : tono === "critical"
          ? "text-[var(--critical)]"
          : "text-[var(--text)]";

  return (
    <section className="tarjeta relative overflow-hidden">
      <h2 className="etiqueta">{etiqueta}</h2>
      <p className={cn("kpi mt-3 transition-colors duration-150", colorValor)}>
        {valor}
        {unidad && (
          <span className="ml-1 text-base font-normal text-[var(--text-muted)]">{unidad}</span>
        )}
      </p>
      <div className="relative z-10 mt-1 min-h-5 text-xs text-[var(--text-muted)]">{contexto}</div>
      {serie && serie.length > 1 && <Sparkline datos={serie} color={color} />}
    </section>
  );
}
