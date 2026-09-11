"use client";

import { Tarjeta } from "@/components/comunes/tarjeta";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Odometría de las dos ruedas. La barra de simetría es el atajo visual para
 * detectar una rueda trabada: si se desplaza mucho hacia un lado, esa rueda
 * está contando muchos menos pulsos que la otra.
 */
export function Odometria({
  distanciaM,
  velocidadMs,
  pulsosIzq,
  pulsosDer,
}: {
  distanciaM: number;
  velocidadMs: number;
  pulsosIzq: number;
  pulsosDer: number;
}) {
  const total = pulsosIzq + pulsosDer;
  // 50 % = ruedas perfectamente simétricas.
  const proporcionIzq = total > 0 ? (pulsosIzq / total) * 100 : 50;
  const desviacion = Math.abs(proporcionIzq - 50);
  const tono =
    desviacion > 35 ? "var(--critical)" : desviacion > 18 ? "var(--warn)" : "var(--ok)";

  return (
    <Tarjeta etiqueta="Odometría" className="h-full">
      <dl className="grid grid-cols-2 gap-4">
        <div>
          <dt className="etiqueta text-[11px]">Distancia</dt>
          <dd className="valor mt-1 text-base">
            {num(distanciaM, 1)} <span className="text-[var(--text-muted)]">m</span>
          </dd>
        </div>
        <div>
          <dt className="etiqueta text-[11px]">Velocidad</dt>
          <dd className="valor mt-1 text-base">
            {num(velocidadMs, 2)} <span className="text-[var(--text-muted)]">m/s</span>
          </dd>
        </div>
        <div>
          <dt className="etiqueta text-[11px]">Pulsos izq.</dt>
          <dd className="valor mt-1">{pulsosIzq.toLocaleString("es")}</dd>
        </div>
        <div>
          <dt className="etiqueta text-[11px]">Pulsos der.</dt>
          <dd className="valor mt-1">{pulsosDer.toLocaleString("es")}</dd>
        </div>
      </dl>

      <div className="mt-5 border-t border-[var(--border)] pt-4">
        <div className="flex items-center justify-between">
          <span className="etiqueta text-[11px]">Simetría de ruedas</span>
          <span className="valor text-[11px]" style={{ color: tono }}>
            {num(proporcionIzq, 0)} / {num(100 - proporcionIzq, 0)}
          </span>
        </div>
        <div
          className="relative mt-2 h-2 w-full rounded-full bg-[var(--surface-alt)]"
          role="meter"
          aria-valuenow={Math.round(proporcionIzq)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Reparto de pulsos entre rueda izquierda y derecha"
        >
          {/* Marca del centro: el equilibrio perfecto. */}
          <span
            className="absolute top-1/2 left-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-[var(--text-faint)]"
            aria-hidden
          />
          <span
            className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left] duration-150"
            style={{ left: `${proporcionIzq}%`, background: tono }}
            aria-hidden
          />
        </div>
        <p className={cn("mt-2 text-[11px]", desviacion > 18 ? "text-[var(--warn)]" : "text-[var(--text-faint)]")}>
          {desviacion > 35
            ? "Una rueda apenas cuenta pulsos: posible rueda trabada."
            : desviacion > 18
              ? "Reparto asimétrico: el robot está girando o derrapando."
              : "Reparto equilibrado entre ambas ruedas."}
        </p>
      </div>
    </Tarjeta>
  );
}
