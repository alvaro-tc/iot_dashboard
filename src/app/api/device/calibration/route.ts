import { prisma } from "@/lib/db";
import { DEVICE_ID, getDevice, leerCuerpo, ok } from "@/lib/api";
import { calibracionSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  const device = await getDevice();
  return ok(device.calibracion);
}

/** Pulsos por metro, tabla RSSI→zona y línea base de PM del cuarto limpio. */
export async function PUT(req: Request) {
  const parsed = await leerCuerpo(req, calibracionSchema);
  if ("respuesta" in parsed) return parsed.respuesta;
  await getDevice();
  const guardada = await prisma.calibracion.update({
    where: { deviceId: DEVICE_ID },
    data: parsed.datos,
  });
  return ok({ ...guardada, acuseRecibo: true });
}
