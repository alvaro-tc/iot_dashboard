import { prisma } from "@/lib/db";
import { DEVICE_ID, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Historial de sesiones con su resumen. */
export async function GET(req: Request) {
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 50);
  const sesiones = await prisma.session.findMany({
    where: { deviceId: DEVICE_ID },
    orderBy: { inicio: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
    include: { _count: { select: { eventos: true, telemetria: true } } },
  });

  return ok(
    sesiones.map((s) => ({
      ...s,
      // m² por minuto: la métrica más honesta para comparar sesiones de
      // duración distinta.
      m2PorMin: s.duracionS && s.duracionS > 0 ? s.areaM2 / (s.duracionS / 60) : null,
      bateriaConsumida:
        s.bateriaInicial !== null && s.bateriaFinal !== null
          ? s.bateriaInicial - s.bateriaFinal
          : null,
    })),
  );
}
