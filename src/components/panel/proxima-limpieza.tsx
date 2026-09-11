"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Tarjeta } from "@/components/comunes/tarjeta";
import { Button } from "@/components/ui/button";
import { Vacio } from "@/components/comunes/estados";
import { fmtDuracion } from "@/lib/format";
import { DIAS_SEMANA, ETIQUETA_PATRON, type Patron } from "@/lib/constantes";

export function ProximaLimpieza({
  proxima,
}: {
  proxima: {
    id: string;
    nombre: string;
    hora: string;
    iso: string;
    dia: number;
    patron: string;
    potencia: string;
  } | null;
}) {
  const router = useRouter();
  const [restante, setRestante] = useState<number | null>(null);
  const [saltando, setSaltando] = useState(false);

  // La cuenta regresiva se calcula en el cliente para no desincronizar el SSR.
  useEffect(() => {
    if (!proxima) return;
    const objetivo = new Date(proxima.iso).getTime();
    const tick = () => setRestante(Math.max(0, (objetivo - Date.now()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [proxima]);

  async function saltar() {
    if (!proxima) return;
    setSaltando(true);
    try {
      const r = await fetch(`/api/schedules/${proxima.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accion: "saltar", programada: proxima.iso }),
      });
      if (!r.ok) {
        const json = (await r.json()) as { detalle?: string };
        toast.error("No se pudo saltar la limpieza", { description: json.detalle });
        return;
      }
      toast.success("Se saltará esta ejecución");
      router.refresh();
    } finally {
      setSaltando(false);
    }
  }

  return (
    <Tarjeta etiqueta="Próxima limpieza" className="h-full">
      {!proxima ? (
        <Vacio mensaje="No hay horarios activos programados." />
      ) : (
        <>
          <p className="kpi mt-1 text-2xl">
            {restante === null ? "—" : fmtDuracion(restante)}
          </p>
          <p className="mt-2 text-sm text-[var(--text)]">{proxima.nombre}</p>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            {DIAS_SEMANA[proxima.dia]} {proxima.hora} ·{" "}
            {ETIQUETA_PATRON[proxima.patron as Patron] ?? proxima.patron} ·{" "}
            {proxima.potencia.toLowerCase()}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-4 w-full"
            onClick={() => void saltar()}
            disabled={saltando}
          >
            Saltar esta vez
          </Button>
        </>
      )}
    </Tarjeta>
  );
}
