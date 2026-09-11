import { prisma } from "@/lib/db";
import { DEVICE_ID, getDevice, getThresholds, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Estado actual del robot: modo, batería, RSSI, zona, uptime y última conexión. */
export async function GET() {
  const device = await getDevice();
  const umbrales = await getThresholds();

  // Sin telemetría reciente el robot se considera desconectado, aunque la BD
  // siga diciendo online: el Last Will de MQTT puede no haber llegado.
  const msSinTelemetria = Date.now() - device.ultimaConexion.getTime();
  const offline = msSinTelemetria > umbrales.minSinTelemetria * 60_000;

  const sesionActiva = await prisma.session.findFirst({
    where: { deviceId: DEVICE_ID, fin: null },
    orderBy: { inicio: "desc" },
  });

  return ok({
    id: device.id,
    nombre: device.nombre,
    modo: offline ? "OFFLINE" : device.modo,
    bateriaPct: device.bateriaPct,
    voltaje: device.voltaje,
    rssi: device.rssi,
    zonaWifi: device.zonaWifi,
    online: !offline,
    fwVersion: device.fwVersion,
    ultimaConexion: device.ultimaConexion,
    segundosSinTelemetria: Math.round(msSinTelemetria / 1000),
    uptimeS: Math.round((Date.now() - device.arranqueAt.getTime()) / 1000),
    sesionActiva: sesionActiva
      ? {
          id: sesionActiva.id,
          inicio: sesionActiva.inicio,
          areaM2: sesionActiva.areaM2,
          distanciaM: sesionActiva.distanciaM,
          obstaculos: sesionActiva.obstaculos,
          pmInicial: sesionActiva.pmInicial,
          pmFinal: sesionActiva.pmFinal,
          efectividadPct: sesionActiva.efectividadPct,
        }
      : null,
    config: device.config,
    calibracion: device.calibracion,
  });
}
