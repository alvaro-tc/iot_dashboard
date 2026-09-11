/**
 * Ingesta y consulta de telemetría.
 *
 * POST es el único punto de entrada de datos del robot. El generador simulado
 * y el futuro puente MQTT publican exactamente el mismo payload aquí, así que
 * el frontend no distingue el origen de los datos.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { DEVICE_ID, fail, getDevice, getThresholds, leerCuerpo, leerQuery, ok, rangoFechas } from "@/lib/api";
import { telemetryPayloadSchema, telemetryQuerySchema } from "@/lib/schemas";
import { evaluar } from "@/lib/umbrales";
import { anguloGirado, areaBarrida, metrosRecorridos, velocidadLineal } from "@/lib/derivados";
import { zonaDeRssi } from "@/lib/mapeo-sensores";
import { publicar } from "@/lib/bus";
import type { Prisma } from "@prisma/client";
import type { Senal } from "@/lib/constantes";

export const dynamic = "force-dynamic";

/** Señales de alta frecuencia que se persisten en cada muestra. */
const SENALES_RAPIDAS: Senal[] = ["DIST_FRONTAL", "DIST_IZQ", "DIST_DER", "POLVO", "COBERTURA"];

/** Valor físico de cada señal dentro de una muestra ya validada. */
function valorFisicoDe(senal: Senal, s: {
  distanciaFrontalCm: number;
  distanciaIzquierdaCm: number;
  distanciaDerechaCm: number;
  densidadPolvoMgM3: number;
}, areaAcumulada: number, rssi: number): number {
  switch (senal) {
    case "DIST_FRONTAL":
      return s.distanciaFrontalCm;
    case "DIST_IZQ":
      return s.distanciaIzquierdaCm;
    case "DIST_DER":
      return s.distanciaDerechaCm;
    case "POLVO":
      return s.densidadPolvoMgM3;
    case "COBERTURA":
      return areaAcumulada;
    case "RSSI":
      return rssi;
  }
}

export async function POST(req: Request) {
  const parsed = await leerCuerpo(req, telemetryPayloadSchema);
  if ("respuesta" in parsed) return parsed.respuesta;
  const payload = parsed.datos;

  if (payload.deviceId !== DEVICE_ID) {
    return fail(404, "DEVICE_DESCONOCIDO", `El dispositivo ${payload.deviceId} no está registrado`);
  }

  const device = await getDevice();
  const umbrales = await getThresholds();
  const cfg = device.config;
  const cal = device.calibracion;

  // Sesión destino: la indicada en el payload o la que esté abierta.
  let sessionId = payload.sessionId ?? null;
  if (sessionId) {
    const existe = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!existe) return fail(404, "SESION_NO_ENCONTRADA", `No existe la sesión ${sessionId}`);
  } else {
    const abierta = await prisma.session.findFirst({
      where: { deviceId: DEVICE_ID, fin: null },
      orderBy: { inicio: "desc" },
    });
    sessionId = abierta?.id ?? null;
  }

  const sesion = sessionId
    ? await prisma.session.findUniqueOrThrow({ where: { id: sessionId } })
    : null;

  const deltaS = 1 / (cfg.telemetriaHz || 2);
  const filas: Prisma.TelemetryCreateManyInput[] = [];
  const eventosCreados: string[] = [];

  let distanciaAcum = sesion?.distanciaM ?? 0;
  let areaAcum = sesion?.areaM2 ?? 0;
  let pmUltimo = sesion?.pmFinal ?? null;
  let pmPrimero = sesion?.pmInicial ?? null;
  let obstaculos = sesion?.obstaculos ?? 0;
  const rssiActual = payload.estado?.rssiDbm ?? device.rssi;

  for (const m of payload.muestras) {
    const t = new Date(m.t);
    const s = m.sensores;

    // --- Derivados: nunca vienen del dispositivo, se calculan aquí --------
    const metros = metrosRecorridos(s.pulsosIzq, s.pulsosDer, cal.mmPorPulso);
    distanciaAcum += metros;
    areaAcum += areaBarrida(metros, cal.anchoCepilloM);
    const velocidadMs = velocidadLineal(s.pulsosIzq, s.pulsosDer, deltaS, cal.mmPorPulso);
    const angulo = anguloGirado(s.pulsosIzq, s.pulsosDer, cal.mmPorPulso, cal.distanciaEjesMm);
    const zona = zonaDeRssi(rssiActual, cal.rssiCerca, cal.rssiMedia);

    if (pmPrimero === null) pmPrimero = s.densidadPolvoMgM3;
    pmUltimo = s.densidadPolvoMgM3;

    if (sessionId) {
      for (const senal of SENALES_RAPIDAS) {
        const a = m.aprox?.[senal];
        const valorFisico = valorFisicoDe(senal, s, areaAcum, rssiActual);
        const valorAproximado = a?.valorAproximado ?? valorFisico;
        const valorReal = a?.valorReal ?? valorFisico;
        const errorAbsoluto = Math.abs(valorReal - valorAproximado);
        const denom = Math.abs(valorReal) < 1e-9 ? 1 : Math.abs(valorReal);
        filas.push({
          sessionId,
          timestamp: t,
          n: m.n,
          senal,
          x: m.x ?? 0,
          valorAproximado,
          valorReal,
          errorAbsoluto,
          errorRelativo: errorAbsoluto / denom,
          valorFisico,
          // Los crudos del lote se anclan a la señal frontal para no repetirlos.
          pulsosIzq: senal === "DIST_FRONTAL" ? s.pulsosIzq : null,
          pulsosDer: senal === "DIST_FRONTAL" ? s.pulsosDer : null,
          voltaje: senal === "DIST_FRONTAL" ? (payload.estado?.voltajeBateria ?? null) : null,
          bateriaPct: senal === "DIST_FRONTAL" ? (payload.estado?.nivelBateriaPct ?? null) : null,
          rssi: senal === "DIST_FRONTAL" ? rssiActual : null,
          velocidadMs: senal === "DIST_FRONTAL" ? velocidadMs : null,
          anguloGirado: senal === "DIST_FRONTAL" ? angulo : null,
        });
      }
    }

    // --- Umbrales -> eventos ---------------------------------------------
    const detectados = evaluar(
      `live:${sessionId ?? "sin-sesion"}`,
      {
        t,
        distanciaFrontalCm: s.distanciaFrontalCm,
        distanciaIzquierdaCm: s.distanciaIzquierdaCm,
        distanciaDerechaCm: s.distanciaDerechaCm,
        densidadPolvoMgM3: s.densidadPolvoMgM3,
        pulsosIzq: s.pulsosIzq,
        pulsosDer: s.pulsosDer,
        velocidadMs,
        bateriaPct: payload.estado?.nivelBateriaPct,
        voltaje: payload.estado?.voltajeBateria,
        zonaWifi: zona,
      },
      {
        umbralFrontalCm: cfg.umbralFrontalCm,
        umbralLateralCm: cfg.umbralLateralCm,
        duracionGiroS: cfg.duracionGiroS,
        factorZonaSucia: cfg.factorZonaSucia,
        segundaPasada: cfg.segundaPasada,
        bateriaRetornoPct: cfg.bateriaRetornoPct,
        bateriaBajaPct: umbrales.bateriaBajaPct,
        pmMaxTolerado: umbrales.pmMaxTolerado,
        caidaTensionVPorMin: umbrales.caidaTensionVPorMin,
        telemetriaHz: cfg.telemetriaHz,
      },
    );

    for (const e of detectados) {
      if (e.tipo === "OBSTACULO_DETECTADO") obstaculos++;
      const guardado = await prisma.event.create({
        data: {
          sessionId,
          timestamp: t,
          tipo: e.tipo,
          severidad: e.severidad,
          sensor: e.sensor ?? null,
          valor: e.valor ?? null,
          unidad: e.unidad ?? null,
          accion: e.accion ?? null,
          detalle: e.detalle ? JSON.stringify(e.detalle) : null,
        },
      });
      eventosCreados.push(e.tipo);
      publicar({
        tipo: "evento",
        datos: {
          id: guardado.id,
          timestamp: guardado.timestamp.toISOString(),
          tipo: guardado.tipo,
          severidad: guardado.severidad,
          sensor: guardado.sensor,
          valor: guardado.valor,
          unidad: guardado.unidad,
          accion: guardado.accion,
        },
      });
      // Los eventos críticos abren una alerta activa.
      if (e.severidad === "CRITICO") {
        await prisma.alert.create({
          data: {
            tipo: e.tipo,
            severidad: e.severidad,
            mensaje: e.accion ?? e.tipo,
            valor: e.valor ?? null,
          },
        });
      }
    }

    publicar({
      tipo: "telemetria",
      datos: {
        t: t.toISOString(),
        sessionId,
        distanciaFrontalCm: s.distanciaFrontalCm,
        distanciaIzquierdaCm: s.distanciaIzquierdaCm,
        distanciaDerechaCm: s.distanciaDerechaCm,
        densidadPolvoMgM3: s.densidadPolvoMgM3,
        pulsosIzq: s.pulsosIzq,
        pulsosDer: s.pulsosDer,
        velocidadMs,
        anguloGirado: angulo,
        n: m.n,
        errorFrontalCm: m.aprox?.DIST_FRONTAL
          ? Math.abs(m.aprox.DIST_FRONTAL.valorReal - m.aprox.DIST_FRONTAL.valorAproximado) * 95
          : 0,
      },
    });
  }

  if (filas.length) await prisma.telemetry.createMany({ data: filas });

  if (sessionId) {
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        distanciaM: distanciaAcum,
        // El área se acumula siempre desde los encoders: la estimación que
        // manda el dispositivo es redundante y puede reiniciarse entre pasadas.
        areaM2: areaAcum,
        pmInicial: pmPrimero,
        pmFinal: pmUltimo,
        efectividadPct:
          pmPrimero && pmPrimero > 0 && pmUltimo !== null
            ? Math.max(0, ((pmPrimero - pmUltimo) / pmPrimero) * 100)
            : null,
        obstaculos,
        bateriaFinal: payload.estado?.nivelBateriaPct ?? undefined,
      },
    });
  }

  if (payload.estado) {
    const e = payload.estado;
    const zona = zonaDeRssi(e.rssiDbm, cal.rssiCerca, cal.rssiMedia);
    await prisma.device.update({
      where: { id: DEVICE_ID },
      data: {
        modo: e.modo,
        bateriaPct: e.nivelBateriaPct,
        voltaje: e.voltajeBateria,
        rssi: e.rssiDbm,
        zonaWifi: zona,
        online: true,
        ultimaConexion: new Date(),
      },
    });
    publicar({
      tipo: "estado",
      datos: {
        modo: e.modo,
        bateriaPct: e.nivelBateriaPct,
        voltaje: e.voltajeBateria,
        rssi: e.rssiDbm,
        zonaWifi: zona,
        online: true,
        distanciaM: distanciaAcum,
        areaM2: e.areaEstimadaM2,
        ultimaConexion: new Date().toISOString(),
      },
    });
  } else {
    await prisma.device.update({
      where: { id: DEVICE_ID },
      data: { online: true, ultimaConexion: new Date() },
    });
  }

  return ok(
    {
      ok: true,
      recibidas: payload.muestras.length,
      eventosGenerados: eventosCreados,
      sessionId,
    },
    201,
  );
}

export async function GET(req: Request) {
  const q = leerQuery(req.url, telemetryQuerySchema);
  if ("respuesta" in q) return q.respuesta;
  const { senal, sessionId, nMin, nMax, desde, hasta, page, pageSize, orderBy, order } = q.datos;

  const where: Prisma.TelemetryWhereInput = {
    ...(senal ? { senal } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(nMin !== undefined || nMax !== undefined
      ? { n: { ...(nMin !== undefined ? { gte: nMin } : {}), ...(nMax !== undefined ? { lte: nMax } : {}) } }
      : {}),
    ...(rangoFechas(desde, hasta) ? { timestamp: rangoFechas(desde, hasta) } : {}),
  };

  const [total, datos] = await Promise.all([
    prisma.telemetry.count({ where }),
    prisma.telemetry.findMany({
      where,
      orderBy: { [orderBy]: order },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({ total, page, pageSize, datos });
}
