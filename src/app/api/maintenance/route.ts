import { prisma } from "@/lib/db";
import { DEVICE_ID, fail, getDevice, getThresholds, leerCuerpo, ok } from "@/lib/api";
import { maintenanceSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

const VIDA_POR_DEFECTO: Record<string, number> = {
  FILTRO: 120,
  CEPILLO_LATERAL: 80,
  BATERIA: 500,
};

export async function GET() {
  await getDevice();
  const umbrales = await getThresholds();
  let consumibles = await prisma.maintenance.findMany({ where: { deviceId: DEVICE_ID } });

  if (consumibles.length === 0) {
    await prisma.maintenance.createMany({
      data: Object.entries(VIDA_POR_DEFECTO).map(([consumible, horasVida]) => ({
        deviceId: DEVICE_ID,
        consumible,
        horasVida,
      })),
    });
    consumibles = await prisma.maintenance.findMany({ where: { deviceId: DEVICE_ID } });
  }

  return ok(
    consumibles.map((c) => {
      // Los umbrales de alerta mandan sobre la vida nominal del consumible.
      const vida =
        c.consumible === "FILTRO"
          ? umbrales.horasFiltro
          : c.consumible === "CEPILLO_LATERAL"
            ? umbrales.horasCepillo
            : c.horasVida;
      return {
        ...c,
        horasVida: vida,
        restantes: Math.max(0, vida - c.horasUso),
        porcentaje: Math.min(100, (c.horasUso / vida) * 100),
      };
    }),
  );
}

/** Reset del contador de un consumible ("mantenimiento hecho"). */
export async function POST(req: Request) {
  const parsed = await leerCuerpo(req, maintenanceSchema);
  if ("respuesta" in parsed) return parsed.respuesta;
  const { consumible } = parsed.datos;

  const existe = await prisma.maintenance.findUnique({
    where: { deviceId_consumible: { deviceId: DEVICE_ID, consumible } },
  });
  if (!existe) return fail(404, "NO_ENCONTRADO", `No hay contador para ${consumible}`);

  const reseteado = await prisma.maintenance.update({
    where: { deviceId_consumible: { deviceId: DEVICE_ID, consumible } },
    data: { horasUso: 0, ultimoReset: new Date() },
  });
  return ok(reseteado);
}
