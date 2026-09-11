import { prisma } from "@/lib/db";
import { DEVICE_ID, getDevice, leerCuerpo, ok } from "@/lib/api";
import { scheduleSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  const horarios = await prisma.schedule.findMany({
    where: { deviceId: DEVICE_ID },
    orderBy: { hora: "asc" },
    include: { ejecuciones: { orderBy: { programada: "desc" }, take: 30 } },
  });
  // Los días se guardan como CSV; la API los expone como arreglo.
  return ok(
    horarios.map((h) => ({
      ...h,
      dias: h.dias.split(",").filter(Boolean).map(Number),
    })),
  );
}

export async function POST(req: Request) {
  const parsed = await leerCuerpo(req, scheduleSchema);
  if ("respuesta" in parsed) return parsed.respuesta;
  await getDevice();
  const { dias, ...resto } = parsed.datos;
  const creado = await prisma.schedule.create({
    data: { deviceId: DEVICE_ID, dias: dias.join(","), ...resto },
  });
  return ok({ ...creado, dias }, 201);
}
