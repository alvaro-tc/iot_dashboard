import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Detalle completo de una sesión: toda la telemetría para el replay. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const sesion = await prisma.session.findUnique({
    where: { id },
    include: { eventos: { orderBy: { timestamp: "asc" } } },
  });
  if (!sesion) return fail(404, "NO_ENCONTRADA", `No existe la sesión ${id}`);

  const telemetria = await prisma.telemetry.findMany({
    where: { sessionId: id },
    orderBy: { timestamp: "asc" },
  });

  // Se pivota a un punto por instante para que el reproductor avance por
  // fotogramas y no por filas sueltas de cada señal.
  const porInstante = new Map<number, Record<string, number | null>>();
  for (const t of telemetria) {
    const clave = t.timestamp.getTime();
    const punto = porInstante.get(clave) ?? { t: clave, n: t.n };
    punto[t.senal] = t.valorFisico;
    if (t.pulsosIzq !== null) {
      punto.pulsosIzq = t.pulsosIzq;
      punto.pulsosDer = t.pulsosDer;
      punto.velocidadMs = t.velocidadMs;
      punto.bateriaPct = t.bateriaPct;
      punto.voltaje = t.voltaje;
      punto.anguloGirado = t.anguloGirado;
    }
    if (t.rssi !== null) punto.rssi = t.rssi;
    porInstante.set(clave, punto);
  }

  return ok({
    sesion,
    frames: [...porInstante.values()],
    telemetria,
  });
}
