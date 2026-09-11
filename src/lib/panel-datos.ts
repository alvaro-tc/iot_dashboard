/** Consultas que alimentan el panel principal en el servidor. */
import { prisma } from "./db";
import { DEVICE_ID, getDevice, getThresholds } from "./api";
import { minutosRestantes } from "./derivados";
import type { PuntoVivo } from "./bus";

/** Últimos 240 instantes de la sesión activa, ya pivotados a puntos. */
export async function puntosIniciales(sessionId: string | null): Promise<PuntoVivo[]> {
  if (!sessionId) return [];
  const filas = await prisma.telemetry.findMany({
    where: { sessionId, senal: { in: ["DIST_FRONTAL", "DIST_IZQ", "DIST_DER", "POLVO"] } },
    orderBy: { timestamp: "desc" },
    take: 240 * 4,
  });

  const porInstante = new Map<number, PuntoVivo>();
  for (const f of filas.reverse()) {
    const clave = f.timestamp.getTime();
    const p =
      porInstante.get(clave) ??
      ({
        t: f.timestamp.toISOString(),
        sessionId,
        distanciaFrontalCm: 0,
        distanciaIzquierdaCm: 0,
        distanciaDerechaCm: 0,
        densidadPolvoMgM3: 0,
        pulsosIzq: 0,
        pulsosDer: 0,
        velocidadMs: 0,
        anguloGirado: 0,
        n: f.n,
        errorFrontalCm: 0,
      } satisfies PuntoVivo);
    if (f.senal === "DIST_FRONTAL") {
      p.distanciaFrontalCm = f.valorFisico;
      p.pulsosIzq = f.pulsosIzq ?? 0;
      p.pulsosDer = f.pulsosDer ?? 0;
      p.velocidadMs = f.velocidadMs ?? 0;
      p.anguloGirado = f.anguloGirado ?? 0;
      // El error de la serie se expresa en las unidades físicas del sensor.
      p.errorFrontalCm = f.errorAbsoluto * 95;
    }
    if (f.senal === "DIST_IZQ") p.distanciaIzquierdaCm = f.valorFisico;
    if (f.senal === "DIST_DER") p.distanciaDerechaCm = f.valorFisico;
    if (f.senal === "POLVO") p.densidadPolvoMgM3 = f.valorFisico;
    porInstante.set(clave, p);
  }
  return [...porInstante.values()].slice(-240);
}

/** Próxima ejecución programada entre los horarios activos. */
export async function proximaLimpieza() {
  const horarios = await prisma.schedule.findMany({
    where: { deviceId: DEVICE_ID, activo: true },
    include: { ejecuciones: { where: { resultado: "OMITIDA" } } },
  });

  let mejor: {
    id: string;
    nombre: string;
    hora: string;
    iso: string;
    dia: number;
    patron: string;
    potencia: string;
  } | null = null;

  const ahora = new Date();
  for (const h of horarios) {
    const dias = h.dias.split(",").filter(Boolean).map(Number);
    const [hh, mm] = h.hora.split(":").map(Number);
    // Se busca la primera ocurrencia en los próximos 8 días.
    for (let offset = 0; offset <= 8; offset++) {
      const cand = new Date(ahora);
      cand.setDate(cand.getDate() + offset);
      cand.setHours(hh, mm, 0, 0);
      if (cand <= ahora) continue;
      if (!dias.includes(cand.getDay())) continue;
      // Si ya se marcó como omitida, se salta a la siguiente ocurrencia.
      const omitida = h.ejecuciones.some(
        (e) => Math.abs(e.programada.getTime() - cand.getTime()) < 60_000,
      );
      if (omitida) continue;
      if (!mejor || cand.getTime() < new Date(mejor.iso).getTime()) {
        mejor = {
          id: h.id,
          nombre: h.nombre,
          hora: h.hora,
          iso: cand.toISOString(),
          dia: cand.getDay(),
          patron: h.patron,
          potencia: h.potencia,
        };
      }
      break;
    }
  }
  return mejor;
}

export async function datosDelPanel() {
  const device = await getDevice();
  const umbrales = await getThresholds();

  const sesion = await prisma.session.findFirst({
    where: { deviceId: DEVICE_ID, fin: null },
    orderBy: { inicio: "desc" },
  });
  const sessionId = sesion?.id ?? null;

  const [eventos, deteccionesPorSensor, pmFilas, bateriaSerie, puntos, proxima] =
    await Promise.all([
      prisma.event.findMany({ orderBy: { timestamp: "desc" }, take: 20 }),
      prisma.event.groupBy({
        by: ["sensor"],
        where: { sessionId, tipo: "OBSTACULO_DETECTADO" },
        _count: { _all: true },
      }),
      prisma.telemetry.findMany({
        where: { sessionId, senal: "POLVO" },
        orderBy: { timestamp: "asc" },
        select: { timestamp: true, valorFisico: true },
      }),
      prisma.telemetry.findMany({
        where: { bateriaPct: { not: null }, timestamp: { gte: new Date(Date.now() - 7_200_000) } },
        orderBy: { timestamp: "asc" },
        select: { timestamp: true, bateriaPct: true },
        take: 400,
      }),
      puntosIniciales(sessionId),
      proximaLimpieza(),
    ]);

  const evasiones = await prisma.event.findMany({
    where: { sessionId, tipo: "MANIOBRA_EVASION" },
    orderBy: { timestamp: "desc" },
    take: 40,
    select: { timestamp: true },
  });

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const ayer = new Date(hoy);
  ayer.setDate(ayer.getDate() - 1);

  const [sesionesHoy, sesionesAyer, ultimas10] = await Promise.all([
    prisma.session.findMany({ where: { deviceId: DEVICE_ID, inicio: { gte: hoy } } }),
    prisma.session.findMany({
      where: { deviceId: DEVICE_ID, inicio: { gte: ayer, lt: hoy } },
    }),
    prisma.session.findMany({
      where: { deviceId: DEVICE_ID, NOT: { fin: null } },
      orderBy: { inicio: "desc" },
      take: 10,
    }),
  ]);

  const areaHoy = sesionesHoy.reduce((a, s) => a + s.areaM2, 0);
  const areaAyer = sesionesAyer.reduce((a, s) => a + s.areaM2, 0);
  const obstaculosHoy = sesionesHoy.reduce((a, s) => a + s.obstaculos, 0);
  const minutosHoy = sesionesHoy.reduce(
    (a, s) => a + (s.duracionS ?? (Date.now() - s.inicio.getTime()) / 1000) / 60,
    0,
  );

  const primero = bateriaSerie[0];
  const ultimo = bateriaSerie[bateriaSerie.length - 1];
  const pctPorMinuto =
    primero && ultimo && ultimo.timestamp > primero.timestamp
      ? ((primero.bateriaPct ?? 0) - (ultimo.bateriaPct ?? 0)) /
        ((ultimo.timestamp.getTime() - primero.timestamp.getTime()) / 60000)
      : 0;

  const cuenta = (sensor: string) =>
    deteccionesPorSensor.find((d) => d.sensor === sensor)?._count._all ?? 0;

  const msSinTelemetria = Date.now() - device.ultimaConexion.getTime();
  const offline = msSinTelemetria > umbrales.minSinTelemetria * 60_000;

  return {
    device: {
      nombre: device.nombre,
      modo: offline ? "OFFLINE" : device.modo,
      bateriaPct: device.bateriaPct,
      voltaje: device.voltaje,
      rssi: device.rssi,
      zonaWifi: device.zonaWifi,
      online: !offline,
      ultimaConexion: device.ultimaConexion.toISOString(),
    },
    config: {
      umbralFrontalCm: device.config.umbralFrontalCm,
      umbralLateralCm: device.config.umbralLateralCm,
      bateriaRetornoPct: device.config.bateriaRetornoPct,
      pmObjetivo: device.config.pmObjetivo,
    },
    sesion: sesion
      ? {
          id: sesion.id,
          inicio: sesion.inicio.toISOString(),
          areaM2: sesion.areaM2,
          distanciaM: sesion.distanciaM,
          efectividadPct: sesion.efectividadPct,
          obstaculos: sesion.obstaculos,
        }
      : null,
    kpis: {
      bateria: {
        pct: device.bateriaPct,
        voltaje: device.voltaje,
        minutosRestantes: minutosRestantes(
          device.bateriaPct,
          pctPorMinuto,
          device.config.bateriaRetornoPct,
        ),
        serie: bateriaSerie.map((b) => ({ v: b.bateriaPct })),
      },
      efectividad: {
        pct: sesion?.efectividadPct ?? null,
        serie: ultimas10.map((s) => ({ v: s.efectividadPct ?? 0 })).reverse(),
      },
      obstaculos: {
        hoy: obstaculosHoy,
        porMinuto: minutosHoy > 0 ? obstaculosHoy / minutosHoy : 0,
        serie: sesionesHoy.map((s) => ({ v: s.obstaculos })),
      },
      area: {
        hoy: areaHoy,
        delta: areaHoy - areaAyer,
        serie: ultimas10.map((s) => ({ v: s.areaM2 })).reverse(),
      },
    },
    detecciones: {
      frontal: cuenta("FRONTAL"),
      izq: cuenta("IZQUIERDO"),
      der: cuenta("DERECHO"),
    },
    curvaPm: pmFilas.map((f) => ({ ms: f.timestamp.getTime(), pm: f.valorFisico })),
    evasiones: evasiones.map((e) => e.timestamp.getTime()),
    puntos,
    eventos: eventos.map((e) => ({
      id: e.id,
      timestamp: e.timestamp.toISOString(),
      tipo: e.tipo,
      severidad: e.severidad,
      sensor: e.sensor,
      valor: e.valor,
      unidad: e.unidad,
      accion: e.accion,
    })),
    proxima,
  };
}

export type DatosPanel = Awaited<ReturnType<typeof datosDelPanel>>;
