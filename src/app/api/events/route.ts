import { prisma } from "@/lib/db";
import { leerQuery, ok, rangoFechas } from "@/lib/api";
import { eventsQuerySchema } from "@/lib/schemas";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = leerQuery(req.url, eventsQuerySchema);
  if ("respuesta" in q) return q.respuesta;
  const { tipo, severidad, sessionId, desde, hasta, limit } = q.datos;

  const where: Prisma.EventWhereInput = {
    ...(tipo ? { tipo } : {}),
    ...(severidad ? { severidad } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(rangoFechas(desde, hasta) ? { timestamp: rangoFechas(desde, hasta) } : {}),
  };

  const eventos = await prisma.event.findMany({
    where,
    orderBy: { timestamp: "desc" },
    take: limit,
  });
  return ok(eventos);
}
