/** Exportación a CSV de la telemetría, respetando los mismos filtros que la tabla. */
import { prisma } from "@/lib/db";
import { leerQuery, rangoFechas } from "@/lib/api";
import { exportQuerySchema } from "@/lib/schemas";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const COLUMNAS = [
  "timestamp",
  "sessionId",
  "n",
  "senal",
  "x",
  "valorFisico",
  "valorAproximado",
  "valorReal",
  "errorAbsoluto",
  "errorRelativo",
  "pulsosIzq",
  "pulsosDer",
  "velocidadMs",
  "bateriaPct",
  "voltaje",
  "rssi",
] as const;

/** Escapa un campo CSV solo cuando hace falta. */
function celda(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const q = leerQuery(req.url, exportQuerySchema);
  if ("respuesta" in q) return q.respuesta;
  const { senal, sessionId, nMin, nMax, desde, hasta, pageSize, orderBy, order } = q.datos;

  const where: Prisma.TelemetryWhereInput = {
    ...(senal ? { senal } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(nMin !== undefined || nMax !== undefined
      ? { n: { ...(nMin !== undefined ? { gte: nMin } : {}), ...(nMax !== undefined ? { lte: nMax } : {}) } }
      : {}),
    ...(rangoFechas(desde, hasta) ? { timestamp: rangoFechas(desde, hasta) } : {}),
  };

  const filas = await prisma.telemetry.findMany({
    where,
    orderBy: { [orderBy]: order },
    take: pageSize,
  });

  const cuerpo = [
    COLUMNAS.join(","),
    ...filas.map((f) => COLUMNAS.map((c) => celda(f[c])).join(",")),
  ].join("\n");

  const nombre = `telemetria-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response("﻿" + cuerpo, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${nombre}"`,
    },
  });
}
