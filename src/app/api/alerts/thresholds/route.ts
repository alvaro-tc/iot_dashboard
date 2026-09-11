import { prisma } from "@/lib/db";
import { getThresholds, leerCuerpo, ok } from "@/lib/api";
import { thresholdsSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok(await getThresholds());
}

export async function PUT(req: Request) {
  const parsed = await leerCuerpo(req, thresholdsSchema);
  if ("respuesta" in parsed) return parsed.respuesta;
  await getThresholds();
  const guardados = await prisma.thresholds.update({
    where: { id: "default" },
    data: parsed.datos,
  });
  return ok(guardados);
}
