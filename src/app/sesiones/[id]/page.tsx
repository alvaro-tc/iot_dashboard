import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getDevice } from "@/lib/api";
import { Tarjeta } from "@/components/comunes/tarjeta";
import { Replay, type Frame } from "@/components/sesiones/replay";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDuracion, fmtFechaHora, num } from "@/lib/format";
import { ETIQUETA_RESULTADO, ETIQUETA_SENAL, type ResultadoSesion, type Senal } from "@/lib/constantes";

export const dynamic = "force-dynamic";

export default async function DetalleSesion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sesion = await prisma.session.findUnique({
    where: { id },
    include: { eventos: { orderBy: { timestamp: "asc" } } },
  });
  if (!sesion) notFound();

  const device = await getDevice();
  const telemetria = await prisma.telemetry.findMany({
    where: { sessionId: id },
    orderBy: { timestamp: "asc" },
  });

  // Se pivota a un fotograma por instante para el reproductor.
  const porInstante = new Map<number, Frame>();
  for (const t of telemetria) {
    const clave = t.timestamp.getTime();
    const f = porInstante.get(clave) ?? ({ t: clave, n: t.n } as Frame);
    if (t.senal === "DIST_FRONTAL") {
      f.DIST_FRONTAL = t.valorFisico;
      f.velocidadMs = t.velocidadMs;
      f.pulsosIzq = t.pulsosIzq;
      f.pulsosDer = t.pulsosDer;
      f.bateriaPct = t.bateriaPct;
    }
    if (t.senal === "DIST_IZQ") f.DIST_IZQ = t.valorFisico;
    if (t.senal === "DIST_DER") f.DIST_DER = t.valorFisico;
    if (t.senal === "POLVO") f.POLVO = t.valorFisico;
    porInstante.set(clave, f);
  }
  const frames = [...porInstante.values()].sort((a, b) => a.t - b.t);

  const resumen = [
    { etiqueta: "Inicio", valor: fmtFechaHora(sesion.inicio) },
    { etiqueta: "Duración", valor: fmtDuracion(sesion.duracionS) },
    { etiqueta: "Área estimada", valor: `${num(sesion.areaM2, 1)} m²` },
    { etiqueta: "Distancia", valor: `${num(sesion.distanciaM, 1)} m` },
    { etiqueta: "PM inicial", valor: num(sesion.pmInicial, 3) },
    { etiqueta: "PM final", valor: num(sesion.pmFinal, 3) },
    {
      etiqueta: "Efectividad",
      valor: sesion.efectividadPct !== null ? `${num(sesion.efectividadPct, 1)} %` : "—",
    },
    { etiqueta: "Obstáculos", valor: String(sesion.obstaculos) },
    {
      etiqueta: "Resultado",
      valor: ETIQUETA_RESULTADO[sesion.resultado as ResultadoSesion] ?? "—",
    },
    { etiqueta: "Motivo de cierre", valor: sesion.motivoCierre ?? "—" },
  ];

  return (
    <div>
      <header className="border-b border-[var(--border)] px-6 py-4">
        <Link
          href="/sesiones"
          className="mb-2 inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          <ChevronLeft className="size-3.5" aria-hidden /> Volver al historial
        </Link>
        <h1 className="titulo-seccion">Sesión del {fmtFechaHora(sesion.inicio)}</h1>
      </header>

      <div className="flex flex-col gap-4 p-6">
        <Tarjeta etiqueta="Resumen">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
            {resumen.map((r) => (
              <div key={r.etiqueta}>
                <dt className="etiqueta text-[11px]">{r.etiqueta}</dt>
                <dd className="valor mt-1 text-[var(--text)]">{r.valor}</dd>
              </div>
            ))}
          </dl>
        </Tarjeta>

        <Replay
          frames={frames}
          eventos={sesion.eventos.map((e) => ({
            id: e.id,
            timestamp: e.timestamp.toISOString(),
            tipo: e.tipo,
            severidad: e.severidad,
            sensor: e.sensor,
            valor: e.valor,
            unidad: e.unidad,
            accion: e.accion,
          }))}
          umbralFrontal={device.config.umbralFrontalCm}
          umbralLateral={device.config.umbralLateralCm}
        />

        <Tarjeta etiqueta={`Datos crudos · ${telemetria.length.toLocaleString("es")} registros`}>
          <div className="max-h-[420px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>n</TableHead>
                  <TableHead>Señal</TableHead>
                  <TableHead className="text-right">x</TableHead>
                  <TableHead className="text-right">Valor medido</TableHead>
                  <TableHead className="text-right">Valor real</TableHead>
                  <TableHead className="text-right">Error absoluto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {telemetria.slice(0, 400).map((t) => (
                  <TableRow key={t.id} className="odd:bg-[var(--surface-alt)]/40">
                    <TableCell className="valor text-[var(--text-muted)]">
                      {fmtFechaHora(t.timestamp)}
                    </TableCell>
                    <TableCell className="valor">{t.n}</TableCell>
                    <TableCell>{ETIQUETA_SENAL[t.senal as Senal] ?? t.senal}</TableCell>
                    <TableCell className="valor text-right">{num(t.x, 3)}</TableCell>
                    <TableCell className="valor text-right">{num(t.valorFisico, 3)}</TableCell>
                    <TableCell className="valor text-right text-[var(--text-muted)]">
                      {num(t.valorReal, 4)}
                    </TableCell>
                    <TableCell className="valor text-right">
                      {t.errorAbsoluto.toExponential(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {telemetria.length > 400 && (
            <p className="mt-3 text-[11px] text-[var(--text-faint)]">
              Se muestran los primeros 400 registros. La tabla completa, con filtros y exportación,
              está en la sección de Telemetría.
            </p>
          )}
        </Tarjeta>
      </div>
    </div>
  );
}
