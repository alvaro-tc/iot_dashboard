"use client";

import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tarjeta } from "@/components/comunes/tarjeta";
import { BadgeSeveridad, Vacio } from "@/components/comunes/estados";
import { fmtHora, num } from "@/lib/format";
import { ETIQUETA_EVENTO, type TipoEvento } from "@/lib/constantes";

export type FilaEvento = {
  id: string;
  timestamp: string;
  tipo: string;
  severidad: string;
  sensor: string | null;
  valor: number | null;
  unidad: string | null;
  accion: string | null;
};

export function TablaEventos({ eventos }: { eventos: FilaEvento[] }) {
  return (
    <Tarjeta
      etiqueta="Eventos recientes"
      accion={
        <Link
          href="/sesiones"
          className="text-[11px] text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text)]"
        >
          Ver historial
        </Link>
      }
    >
      {eventos.length === 0 ? (
        <Vacio mensaje="Todavía no se han registrado eventos. Aparecerán en cuanto el robot cruce algún umbral." />
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Hora</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead className="w-28">Severidad</TableHead>
                <TableHead className="w-28">Sensor</TableHead>
                <TableHead className="w-28 text-right">Valor</TableHead>
                <TableHead>Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {eventos.slice(0, 20).map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="valor text-[var(--text-muted)]">
                    {fmtHora(e.timestamp)}
                  </TableCell>
                  <TableCell className="text-[var(--text)]">
                    {ETIQUETA_EVENTO[e.tipo as TipoEvento] ?? e.tipo}
                  </TableCell>
                  <TableCell>
                    <BadgeSeveridad severidad={e.severidad} />
                  </TableCell>
                  <TableCell className="text-[var(--text-muted)]">{e.sensor ?? "—"}</TableCell>
                  <TableCell className="valor text-right">
                    {e.valor !== null ? `${num(e.valor, 1)} ${e.unidad ?? ""}` : "—"}
                  </TableCell>
                  <TableCell className="text-[var(--text-muted)]">{e.accion ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Tarjeta>
  );
}
