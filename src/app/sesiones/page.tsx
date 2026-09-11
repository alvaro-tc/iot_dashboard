import { prisma } from "@/lib/db";
import { DEVICE_ID } from "@/lib/api";
import { ListaSesiones } from "@/components/sesiones/lista-sesiones";

export const dynamic = "force-dynamic";

export default async function SesionesPage() {
  const sesiones = await prisma.session.findMany({
    where: { deviceId: DEVICE_ID },
    orderBy: { inicio: "desc" },
    take: 100,
  });

  return (
    <div>
      <header className="border-b border-[var(--border)] px-6 py-4">
        <h1 className="titulo-seccion">Sesiones</h1>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Historial de limpiezas con su resumen, comparativa de rendimiento y replay de telemetría.
        </p>
      </header>
      <ListaSesiones
        sesiones={sesiones.map((s) => ({
          id: s.id,
          inicio: s.inicio.toISOString(),
          duracionS: s.duracionS,
          areaM2: s.areaM2,
          pmInicial: s.pmInicial,
          pmFinal: s.pmFinal,
          efectividadPct: s.efectividadPct,
          bateriaConsumida:
            s.bateriaInicial !== null && s.bateriaFinal !== null
              ? s.bateriaInicial - s.bateriaFinal
              : null,
          obstaculos: s.obstaculos,
          resultado: s.resultado,
          m2PorMin: s.duracionS && s.duracionS > 0 ? s.areaM2 / (s.duracionS / 60) : null,
        }))}
      />
    </div>
  );
}
