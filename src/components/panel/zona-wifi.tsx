"use client";

import { Info } from "lucide-react";
import { Tarjeta } from "@/components/comunes/tarjeta";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ZONAS_WIFI, type ZonaWifi } from "@/lib/constantes";
import { cn } from "@/lib/utils";

const ETIQUETA: Record<ZonaWifi, string> = {
  CERCA: "Cerca",
  MEDIA: "Media",
  LEJOS: "Lejos",
};

/**
 * Clasificación gruesa de la posición respecto al router.
 * Nunca se convierte a metros: en interiores el RSSI tiene un error de varios
 * metros por paredes, muebles y reflexiones.
 */
export function IndicadorZonaWifi({ zona, rssi }: { zona: ZonaWifi; rssi: number }) {
  return (
    <Tarjeta
      etiqueta="Zona WiFi"
      accion={
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Por qué esto es una estimación"
                className="text-[var(--text-faint)]"
              />
            }
          >
            <Info className="size-3.5" aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="left">
            El RSSI en interiores se desvía varios metros por paredes y reflexiones. Solo sirve
            para clasificar en zonas gruesas, nunca para calcular distancia.
          </TooltipContent>
        </Tooltip>
      }
      className="h-full"
    >
      <div className="flex gap-1.5" role="group" aria-label={`Zona actual: ${ETIQUETA[zona]}`}>
        {ZONAS_WIFI.map((z) => (
          <div
            key={z}
            aria-current={z === zona ? "true" : undefined}
            className={cn(
              "flex-1 rounded-md border px-2 py-2 text-center text-[11px] transition-colors duration-150",
              z === zona
                ? "border-[var(--sensor-frontal)]/40 bg-[var(--sensor-frontal)]/10 text-[var(--sensor-frontal)]"
                : "border-[var(--border)] text-[var(--text-faint)]",
            )}
          >
            {ETIQUETA[z]}
          </div>
        ))}
      </div>

      <p className="valor mt-4 text-base">
        {rssi} <span className="text-[var(--text-muted)]">dBm</span>
      </p>
      <p className="mt-1 text-[11px] text-[var(--text-faint)]">
        Estimación por intensidad de señal. No es una posición.
      </p>
    </Tarjeta>
  );
}
