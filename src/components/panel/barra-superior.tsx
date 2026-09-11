"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Home, Pause, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BadgeEnVivo, ChipEstado } from "@/components/comunes/estados";
import { fmtHora } from "@/lib/format";
import type { Modo } from "@/lib/constantes";

type Comando = "start" | "pause" | "stop" | "dock";

/** Modos desde los que cada botón está habilitado. Los demás se atenúan. */
const HABILITADO: Record<Comando, Modo[]> = {
  start: ["EN_BASE", "PAUSADO", "CARGANDO"],
  pause: ["LIMPIANDO"],
  stop: ["LIMPIANDO", "PAUSADO"],
  dock: ["LIMPIANDO", "PAUSADO", "ATASCADO"],
};

const BOTONES: Array<{ cmd: Comando; etiqueta: string; Icono: typeof Play }> = [
  { cmd: "start", etiqueta: "Iniciar limpieza", Icono: Play },
  { cmd: "pause", etiqueta: "Pausar", Icono: Pause },
  { cmd: "stop", etiqueta: "Detener", Icono: Square },
  { cmd: "dock", etiqueta: "Volver a base", Icono: Home },
];

export function BarraSuperior({
  nombre,
  modo,
  ultimaTelemetria,
  enVivo,
}: {
  nombre: string;
  modo: Modo;
  ultimaTelemetria: string | null;
  enVivo: boolean;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState<Comando | null>(null);
  const [, startTransition] = useTransition();

  async function enviar(cmd: Comando) {
    setEnviando(cmd);
    try {
      const r = await fetch("/api/device/cmd", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cmd }),
      });
      const json = (await r.json()) as { mensaje?: string; detalle?: string };
      if (!r.ok) {
        toast.error("El robot rechazó el comando", { description: json.detalle });
        return;
      }
      // El toast confirma solo cuando el robot acusa recibo.
      toast.success(json.mensaje ?? "Comando aplicado");
      startTransition(() => router.refresh());
    } catch {
      toast.error("No se pudo enviar el comando", {
        description: "Revisa la conexión con el backend",
      });
    } finally {
      setEnviando(null);
    }
  }

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-[var(--border)] bg-[var(--bg)]/95 px-6 py-3 backdrop-blur">
      <h1 className="titulo-seccion mr-1">{nombre}</h1>
      <ChipEstado modo={modo} />
      <BadgeEnVivo activo={enVivo} />
      <span className="valor text-[var(--text-muted)]">
        {ultimaTelemetria ? `Última telemetría ${fmtHora(ultimaTelemetria)}` : "Sin telemetría"}
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-2" role="group" aria-label="Comandos del robot">
        {BOTONES.map(({ cmd, etiqueta, Icono }) => {
          const activo = HABILITADO[cmd].includes(modo);
          return (
            <Button
              key={cmd}
              size="sm"
              variant={cmd === "start" ? "default" : "outline"}
              disabled={!activo || enviando !== null}
              onClick={() => void enviar(cmd)}
              aria-disabled={!activo}
              title={activo ? etiqueta : `No disponible en modo ${modo}`}
            >
              <Icono className="size-3.5" aria-hidden />
              {etiqueta}
            </Button>
          );
        })}
      </div>
    </header>
  );
}
