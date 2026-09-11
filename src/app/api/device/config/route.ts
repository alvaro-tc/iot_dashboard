import { prisma } from "@/lib/db";
import { DEVICE_ID, getDevice, leerCuerpo, ok } from "@/lib/api";
import { configSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  const device = await getDevice();
  return ok({ ...device.config, nombre: device.nombre });
}

/** Guarda los ajustes. En MQTT esto se publicaría además en roomba/cmd/config. */
export async function PUT(req: Request) {
  const parsed = await leerCuerpo(req, configSchema);
  if ("respuesta" in parsed) return parsed.respuesta;
  const { nombre, ...config } = parsed.datos;

  await getDevice();
  const guardada = await prisma.config.update({ where: { deviceId: DEVICE_ID }, data: config });
  await prisma.device.update({ where: { id: DEVICE_ID }, data: { nombre } });

  return ok({ ...guardada, nombre, acuseRecibo: true });
}
