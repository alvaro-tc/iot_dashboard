"use client";

import { useState } from "react";
import { AlertTriangle, Inbox, RotateCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ETIQUETA_MODO, type Modo, type Severidad } from "@/lib/constantes";
import { fmtRelativo } from "@/lib/format";

/** Estado vacío: icono tenue, una frase y la acción que lo resuelve. */
export function Vacio({
  mensaje,
  accion,
}: {
  mensaje: string;
  accion?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <Inbox className="size-6 text-[var(--text-faint)]" aria-hidden />
      <p className="max-w-xs text-sm text-[var(--text-muted)]">{mensaje}</p>
      {accion}
    </div>
  );
}

/** Estado de error: mensaje corto, detalle técnico plegable y reintentar. */
export function ErrorPanel({
  mensaje,
  detalle,
  onReintentar,
}: {
  mensaje: string;
  detalle?: string;
  onReintentar?: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div role="alert" className="flex flex-col items-start gap-3 py-6">
      <div className="flex items-center gap-2 text-sm text-[var(--critical)]">
        <AlertTriangle className="size-4" aria-hidden />
        <span>{mensaje}</span>
      </div>
      {detalle && (
        <div className="w-full">
          <button
            type="button"
            onClick={() => setAbierto((a) => !a)}
            aria-expanded={abierto}
            className="text-xs text-[var(--text-muted)] underline underline-offset-2"
          >
            {abierto ? "Ocultar detalle técnico" : "Ver detalle técnico"}
          </button>
          {abierto && (
            <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-[var(--surface-alt)] p-3 text-xs text-[var(--text-muted)]">
              {detalle}
            </pre>
          )}
        </div>
      )}
      {onReintentar && (
        <Button size="sm" variant="outline" onClick={onReintentar}>
          <RotateCw className="size-3.5" aria-hidden /> Reintentar
        </Button>
      )}
    </div>
  );
}

const COLOR_MODO: Record<Modo, string> = {
  LIMPIANDO: "text-[var(--ok)] border-[var(--ok)]/40 bg-[var(--ok)]/10",
  EN_BASE: "text-[var(--text-muted)] border-[var(--border)] bg-[var(--surface-alt)]",
  CARGANDO: "text-[var(--sensor-frontal)] border-[var(--sensor-frontal)]/40 bg-[var(--sensor-frontal)]/10",
  PAUSADO: "text-[var(--warn)] border-[var(--warn)]/40 bg-[var(--warn)]/10",
  ATASCADO: "text-[var(--critical)] border-[var(--critical)]/40 bg-[var(--critical)]/10",
  OFFLINE: "text-[var(--text-faint)] border-[var(--border)] bg-transparent",
};

export function ChipEstado({ modo }: { modo: Modo }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
        COLOR_MODO[modo] ?? COLOR_MODO.EN_BASE,
      )}
      role="status"
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {ETIQUETA_MODO[modo] ?? modo}
    </span>
  );
}

const COLOR_SEVERIDAD: Record<Severidad, string> = {
  INFO: "text-[var(--text-muted)] border-[var(--border)]",
  ADVERTENCIA: "text-[var(--warn)] border-[var(--warn)]/40",
  CRITICO: "text-[var(--critical)] border-[var(--critical)]/40",
};

export function BadgeSeveridad({ severidad }: { severidad: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("text-[11px]", COLOR_SEVERIDAD[severidad as Severidad] ?? COLOR_SEVERIDAD.INFO)}
    >
      {severidad}
    </Badge>
  );
}

/** Badge "EN VIVO" con punto pulsante. */
export function BadgeEnVivo({ activo }: { activo: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium tracking-[0.04em]",
        activo
          ? "border-[var(--ok)]/40 bg-[var(--ok)]/10 text-[var(--ok)]"
          : "border-[var(--border)] text-[var(--text-faint)]",
      )}
      aria-live="polite"
    >
      <span className={cn("size-1.5 rounded-full bg-current", activo && "latido")} aria-hidden />
      {activo ? "EN VIVO" : "SIN SEÑAL"}
    </span>
  );
}

/** Banner discreto cuando el robot lleva rato sin publicar telemetría. */
export function BannerOffline({ ultimaConexion }: { ultimaConexion: string | Date }) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-alt)] px-6 py-2 text-xs text-[var(--text-muted)]"
    >
      <WifiOff className="size-3.5" aria-hidden />
      Sin telemetría desde hace {fmtRelativo(ultimaConexion).replace("hace ", "")}. Los datos
      mostrados son los últimos recibidos.
    </div>
  );
}
