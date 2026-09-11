import { prisma } from "@/lib/db";
import { fail, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const [activas, resueltas] = await Promise.all([
    prisma.alert.findMany({ where: { resueltaAt: null }, orderBy: { creadaAt: "desc" } }),
    prisma.alert.findMany({
      where: { NOT: { resueltaAt: null } },
      orderBy: { resueltaAt: "desc" },
      take: 50,
    }),
  ]);
  return ok({ activas, resueltas });
}

/** Marca una alerta como resuelta. */
export async function POST(req: Request) {
  let cuerpo: { id?: string };
  try {
    cuerpo = (await req.json()) as { id?: string };
  } catch {
    return fail(400, "JSON_INVALIDO", "El cuerpo no es JSON válido");
  }
  if (!cuerpo.id) return fail(400, "VALIDACION", "id: requerido");
  const existe = await prisma.alert.findUnique({ where: { id: cuerpo.id } });
  if (!existe) return fail(404, "NO_ENCONTRADA", `No existe la alerta ${cuerpo.id}`);
  const resuelta = await prisma.alert.update({
    where: { id: cuerpo.id },
    data: { resueltaAt: new Date() },
  });
  return ok(resuelta);
}
