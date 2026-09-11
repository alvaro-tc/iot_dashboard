/** KPIs agregados del panel principal. */
import { prisma } from "@/lib/db";
import { DEVICE_ID, getDevice, getThresholds, ok } from "@/lib/api";
import { minutosRestantes } from "@/lib/derivados";

export const dynamic = "force-dynamic";

function inicioDelDia(offsetDias = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - offsetDias);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function GET() {
  const device = await getDevice();
  const umbrales = await getThresholds();
  const hoy = inicioDelDia();
  const ayer = inicioDelDia(1);

  const [sesionesHoy, sesionesAyer, activa] = await Promise.all([
    prisma.session.findMany({ where: { deviceId: DEVICE_ID, inicio: { gte: hoy } } }),
    prisma.session.findMany({
      where: { deviceId: DEVICE_ID, inicio: { gte: ayer, lt: hoy } },
    }),
    prisma.session.findFirst({
      where: { deviceId: DEVICE_ID, fin: null },
      orderBy: { inicio: "desc" },
    }),
  ]);

  const areaHoy = sesionesHoy.reduce((a, s) => a + s.areaM2, 0);
  const areaAyer = sesionesAyer.reduce((a, s) => a + s.areaM2, 0);
  const obstaculosHoy = sesionesHoy.reduce((a, s) => a + s.obstaculos, 0);
  const minutosHoy = sesionesHoy.reduce((a, s) => a + (s.duracionS ?? 0) / 60, 0);

  // Sparkline de batería: últimas 2 h de lecturas con nivel informado.
  const bateriaSerie = await prisma.telemetry.findMany({
    where: { bateriaPct: { not: null }, timestamp: { gte: new Date(Date.now() - 7_200_000) } },
    orderBy: { timestamp: "asc" },
    select: { timestamp: true, bateriaPct: true },
    take: 500,
  });

  // Pendiente de descarga a partir de los extremos de la serie.
  const primero = bateriaSerie[0];
  const ultimo = bateriaSerie[bateriaSerie.length - 1];
  const pctPorMinuto =
    primero && ultimo && ultimo.timestamp > primero.timestamp
      ? ((primero.bateriaPct ?? 0) - (ultimo.bateriaPct ?? 0)) /
        ((ultimo.timestamp.getTime() - primero.timestamp.getTime()) / 60000)
      : 0;

  const efectividadActual =
    activa?.pmInicial && activa.pmInicial > 0 && activa.pmFinal !== null
      ? Math.max(0, ((activa.pmInicial - activa.pmFinal) / activa.pmInicial) * 100)
      : null;

  const ultimas10 = await prisma.session.findMany({
    where: { deviceId: DEVICE_ID, NOT: { fin: null } },
    orderBy: { inicio: "desc" },
    take: 10,
  });

  return ok({
    bateria: {
      pct: device.bateriaPct,
      voltaje: device.voltaje,
      minutosRestantes: minutosRestantes(
        device.bateriaPct,
        pctPorMinuto,
        device.config.bateriaRetornoPct,
      ),
      umbralRetorno: device.config.bateriaRetornoPct,
      serie: bateriaSerie.map((b) => ({ t: b.timestamp, v: b.bateriaPct })),
    },
    efectividad: {
      pct: efectividadActual,
      pmInicial: activa?.pmInicial ?? null,
      pmActual: activa?.pmFinal ?? null,
      objetivo: device.config.pmObjetivo,
      serie: ultimas10.map((s) => ({ t: s.inicio, v: s.efectividadPct ?? 0 })).reverse(),
    },
    obstaculos: {
      hoy: obstaculosHoy,
      porMinuto: minutosHoy > 0 ? obstaculosHoy / minutosHoy : 0,
      serie: sesionesHoy.map((s) => ({ t: s.inicio, v: s.obstaculos })),
    },
    area: {
      hoy: areaHoy,
      ayer: areaAyer,
      delta: areaHoy - areaAyer,
      serie: ultimas10.map((s) => ({ t: s.inicio, v: s.areaM2 })).reverse(),
    },
    umbrales,
    sesionActiva: activa,
  });
}
