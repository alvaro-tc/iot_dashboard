import { prisma } from "@/lib/db";
import { fail, leerCuerpo, ok } from "@/lib/api";
import { schedulePatchSchema } from "@/lib/schemas";
import { z } from "zod";

const saltarSchema = z.object({
  accion: z.literal("saltar"),
  programada: z.string(),
});

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = await leerCuerpo(req, schedulePatchSchema);
  if ("respuesta" in parsed) return parsed.respuesta;

  const existe = await prisma.schedule.findUnique({ where: { id } });
  if (!existe) return fail(404, "NO_ENCONTRADO", `No existe el horario ${id}`);

  const { dias, ...resto } = parsed.datos;
  const actualizado = await prisma.schedule.update({
    where: { id },
    data: { ...resto, ...(dias ? { dias: dias.join(",") } : {}) },
  });
  return ok({ ...actualizado, dias: actualizado.dias.split(",").filter(Boolean).map(Number) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const existe = await prisma.schedule.findUnique({ where: { id } });
  if (!existe) return fail(404, "NO_ENCONTRADO", `No existe el horario ${id}`);
  await prisma.schedule.delete({ where: { id } });
  return ok({ ok: true, id });
}

/** Marca la próxima ejecución como omitida ("Saltar esta vez"). */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = await leerCuerpo(req, saltarSchema);
  if ("respuesta" in parsed) return parsed.respuesta;

  const existe = await prisma.schedule.findUnique({ where: { id } });
  if (!existe) return fail(404, "NO_ENCONTRADO", `No existe el horario ${id}`);

  const run = await prisma.scheduleRun.create({
    data: {
      scheduleId: id,
      programada: new Date(parsed.datos.programada),
      resultado: "OMITIDA",
      motivo: "Omitida manualmente desde el dashboard",
    },
  });
  return ok(run, 201);
}
