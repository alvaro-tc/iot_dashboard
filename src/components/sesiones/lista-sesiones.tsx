"use client";

import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Tarjeta } from "@/components/comunes/tarjeta";
import { TooltipGrafico } from "@/components/comunes/graficos";
import { Vacio } from "@/components/comunes/estados";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDuracion, fmtFecha, fmtHoraCorta, num } from "@/lib/format";
import { ETIQUETA_RESULTADO, type ResultadoSesion } from "@/lib/constantes";
import { cn } from "@/lib/utils";

export type SesionFila = {
  id: string;
  inicio: string;
  duracionS: number | null;
  areaM2: number;
  pmInicial: number | null;
  pmFinal: number | null;
  efectividadPct: number | null;
  bateriaConsumida: number | null;
  obstaculos: number;
  resultado: string | null;
  m2PorMin: number | null;
};

const COLOR_RESULTADO: Record<string, string> = {
  COMPLETADA: "text-[var(--ok)] border-[var(--ok)]/40",
  EN_CURSO: "text-[var(--sensor-frontal)] border-[var(--sensor-frontal)]/40",
  BATERIA_BAJA: "text-[var(--warn)] border-[var(--warn)]/40",
  CANCELADA: "text-[var(--text-muted)] border-[var(--border)]",
  ATASCADA: "text-[var(--critical)] border-[var(--critical)]/40",
};

export function ListaSesiones({ sesiones }: { sesiones: SesionFila[] }) {
  const ultimas10 = [...sesiones]
    .filter((s) => s.resultado !== "EN_CURSO")
    .slice(0, 10)
    .reverse()
    .map((s) => ({
      etiqueta: `${fmtFecha(s.inicio).slice(0, 6)}`,
      efectividad: s.efectividadPct ?? 0,
      m2PorMin: s.m2PorMin ?? 0,
    }));

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Tarjeta etiqueta="Efectividad de las últimas 10 sesiones (%)">
          {ultimas10.length === 0 ? (
            <Vacio mensaje="Aún no hay sesiones cerradas que comparar." />
          ) : (
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ultimas10} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="etiqueta" axisLine={false} tickLine={false} />
                  <YAxis axisLine={false} tickLine={false} width={44} />
                  <Tooltip
                    cursor={{ fill: "var(--surface-alt)" }}
                    content={
                      <TooltipGrafico
                        unidades={{ efectividad: "%" }}
                        etiquetas={{ efectividad: "Efectividad" }}
                      />
                    }
                  />
                  <Bar dataKey="efectividad" fill="var(--polvo)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Tarjeta>

        <Tarjeta etiqueta="Rendimiento: m² por minuto">
          {ultimas10.length === 0 ? (
            <Vacio mensaje="Aún no hay sesiones cerradas que comparar." />
          ) : (
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ultimas10} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="etiqueta" axisLine={false} tickLine={false} />
                  <YAxis axisLine={false} tickLine={false} width={44} />
                  <Tooltip
                    cursor={{ fill: "var(--surface-alt)" }}
                    content={
                      <TooltipGrafico
                        unidades={{ m2PorMin: "m²/min" }}
                        etiquetas={{ m2PorMin: "Rendimiento" }}
                      />
                    }
                  />
                  <Bar dataKey="m2PorMin" fill="var(--bateria)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Tarjeta>
      </div>

      <Tarjeta etiqueta="Historial de sesiones">
        {sesiones.length === 0 ? (
          <Vacio mensaje="No hay sesiones registradas todavía." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Duración</TableHead>
                  <TableHead className="text-right">Área</TableHead>
                  <TableHead className="text-right">PM inicial</TableHead>
                  <TableHead className="text-right">PM final</TableHead>
                  <TableHead className="text-right">Efectividad</TableHead>
                  <TableHead className="text-right">Batería</TableHead>
                  <TableHead className="text-right">Obstáculos</TableHead>
                  <TableHead>Resultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sesiones.map((s) => (
                  <TableRow key={s.id} className="odd:bg-[var(--surface-alt)]/40">
                    <TableCell>
                      <Link
                        href={`/sesiones/${s.id}`}
                        className="text-[var(--text)] underline-offset-2 hover:underline"
                      >
                        {fmtFecha(s.inicio)}{" "}
                        <span className="valor text-[var(--text-muted)]">
                          {fmtHoraCorta(s.inicio)}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="valor text-right">{fmtDuracion(s.duracionS)}</TableCell>
                    <TableCell className="valor text-right">{num(s.areaM2, 1)} m²</TableCell>
                    <TableCell className="valor text-right text-[var(--text-muted)]">
                      {num(s.pmInicial, 3)}
                    </TableCell>
                    <TableCell className="valor text-right text-[var(--text-muted)]">
                      {num(s.pmFinal, 3)}
                    </TableCell>
                    <TableCell className="valor text-right text-[var(--ok)]">
                      {s.efectividadPct !== null ? `${num(s.efectividadPct, 1)} %` : "—"}
                    </TableCell>
                    <TableCell className="valor text-right">
                      {s.bateriaConsumida !== null ? `−${num(s.bateriaConsumida, 0)} %` : "—"}
                    </TableCell>
                    <TableCell className="valor text-right">{s.obstaculos}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[11px]",
                          COLOR_RESULTADO[s.resultado ?? ""] ?? COLOR_RESULTADO.CANCELADA,
                        )}
                      >
                        {ETIQUETA_RESULTADO[s.resultado as ResultadoSesion] ?? "—"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Tarjeta>
    </div>
  );
}
