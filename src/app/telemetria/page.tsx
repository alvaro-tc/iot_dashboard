import { prisma } from "@/lib/db";
import { DEVICE_ID } from "@/lib/api";
import { VistaTelemetria } from "@/components/telemetria/vista-telemetria";
import { fmtFecha, fmtHoraCorta } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TelemetriaPage() {
  const sesiones = await prisma.session.findMany({
    where: { deviceId: DEVICE_ID },
    orderBy: { inicio: "desc" },
    take: 50,
    select: { id: true, inicio: true, resultado: true },
  });

  return (
    <div>
      <header className="border-b border-[var(--border)] px-6 py-4">
        <h1 className="titulo-seccion">Telemetría</h1>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Series completas de los sensores y precisión de la estimación frente al número de muestras.
        </p>
      </header>
      <VistaTelemetria
        sesiones={sesiones.map((s) => ({
          id: s.id,
          etiqueta: `${fmtFecha(s.inicio)} ${fmtHoraCorta(s.inicio)}${s.resultado === "EN_CURSO" ? " · en curso" : ""}`,
        }))}
      />
    </div>
  );
}
