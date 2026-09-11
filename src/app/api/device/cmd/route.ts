/**
 * Comandos hacia el robot. En producción se publican en el topic roomba/cmd;
 * aquí se aplican directamente sobre el estado local y el simulador los sigue.
 */
import { prisma } from "@/lib/db";
import { DEVICE_ID, fail, getDevice, leerCuerpo, ok } from "@/lib/api";
import { comandoSchema } from "@/lib/schemas";
import { publicar } from "@/lib/bus";
import { reiniciarVentana } from "@/lib/umbrales";
import { detener, iniciar } from "@/lib/simulador";
import type { Modo } from "@/lib/constantes";

export const dynamic = "force-dynamic";

/** Modos desde los que cada comando está permitido. */
const PERMITIDO: Record<string, Modo[]> = {
  start: ["EN_BASE", "PAUSADO", "CARGANDO"],
  pause: ["LIMPIANDO"],
  stop: ["LIMPIANDO", "PAUSADO"],
  dock: ["LIMPIANDO", "PAUSADO", "ATASCADO"],
  reboot: ["EN_BASE", "LIMPIANDO", "PAUSADO", "CARGANDO", "ATASCADO", "OFFLINE"],
  locate: ["EN_BASE", "LIMPIANDO", "PAUSADO", "CARGANDO", "ATASCADO"],
};

export async function POST(req: Request) {
  const parsed = await leerCuerpo(req, comandoSchema);
  if ("respuesta" in parsed) return parsed.respuesta;
  const { cmd } = parsed.datos;

  const device = await getDevice();
  const modo = device.modo as Modo;
  if (!PERMITIDO[cmd].includes(modo)) {
    return fail(409, "COMANDO_NO_PERMITIDO", `El comando "${cmd}" no aplica en modo ${modo}`);
  }

  const activa = await prisma.session.findFirst({
    where: { deviceId: DEVICE_ID, fin: null },
    orderBy: { inicio: "desc" },
  });

  let nuevoModo: Modo = modo;
  let mensaje = "";

  switch (cmd) {
    case "start": {
      nuevoModo = "LIMPIANDO";
      if (!activa) {
        const s = await prisma.session.create({
          data: {
            deviceId: DEVICE_ID,
            potencia: device.config.potenciaSuccion,
            patron: device.config.patron,
            bateriaInicial: device.bateriaPct,
            resultado: "EN_CURSO",
          },
        });
        reiniciarVentana(`live:${s.id}`);
        await prisma.event.create({
          data: {
            sessionId: s.id,
            tipo: "SESION_INICIADA",
            severidad: "INFO",
            accion: `Patron ${device.config.patron}, potencia ${device.config.potenciaSuccion}`,
          },
        });
      }
      iniciar();
      mensaje = "Limpieza iniciada";
      break;
    }
    case "pause":
      nuevoModo = "PAUSADO";
      detener();
      mensaje = "Limpieza pausada";
      break;
    case "stop":
    case "dock": {
      nuevoModo = cmd === "dock" ? "CARGANDO" : "EN_BASE";
      detener();
      if (activa) await cerrarSesion(activa.id, cmd === "dock" ? "COMPLETADA" : "CANCELADA");
      mensaje = cmd === "dock" ? "Volviendo a la base" : "Limpieza detenida";
      break;
    }
    case "reboot":
      nuevoModo = "EN_BASE";
      detener();
      if (activa) await cerrarSesion(activa.id, "CANCELADA");
      await prisma.device.update({ where: { id: DEVICE_ID }, data: { arranqueAt: new Date() } });
      mensaje = "ESP32 reiniciado";
      break;
    case "locate":
      mensaje = "Emitiendo tono de localizacion";
      break;
  }

  const actualizado = await prisma.device.update({
    where: { id: DEVICE_ID },
    data: { modo: nuevoModo, ultimaConexion: new Date(), online: true },
  });

  publicar({
    tipo: "estado",
    datos: {
      modo: actualizado.modo,
      bateriaPct: actualizado.bateriaPct,
      voltaje: actualizado.voltaje,
      rssi: actualizado.rssi,
      zonaWifi: actualizado.zonaWifi,
      online: true,
      distanciaM: activa?.distanciaM ?? 0,
      areaM2: activa?.areaM2 ?? 0,
      ultimaConexion: actualizado.ultimaConexion.toISOString(),
    },
  });

  // El "acuse de recibo" del robot: en MQTT llegaría por roomba/status.
  return ok({ ok: true, cmd, modo: nuevoModo, mensaje, acuseRecibo: true });
}

async function cerrarSesion(id: string, resultado: string) {
  const s = await prisma.session.findUnique({ where: { id } });
  if (!s) return;
  const fin = new Date();
  await prisma.session.update({
    where: { id },
    data: {
      fin,
      duracionS: Math.round((fin.getTime() - s.inicio.getTime()) / 1000),
      resultado,
      motivoCierre: resultado === "COMPLETADA" ? "Retorno a base" : "Detenida desde el dashboard",
    },
  });
  await prisma.event.create({
    data: {
      sessionId: id,
      timestamp: fin,
      tipo: "SESION_FINALIZADA",
      severidad: resultado === "COMPLETADA" ? "INFO" : "ADVERTENCIA",
      accion: resultado,
      detalle: JSON.stringify({ motivo: resultado }),
    },
  });
  reiniciarVentana(`live:${id}`);
}
