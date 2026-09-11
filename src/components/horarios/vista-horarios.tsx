"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Tarjeta } from "@/components/comunes/tarjeta";
import { ErrorPanel, Vacio } from "@/components/comunes/estados";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { fmtFechaHora, num } from "@/lib/format";
import {
  DIAS_SEMANA,
  ETIQUETA_PATRON,
  PATRONES,
  POTENCIAS,
  type Patron,
  type Potencia,
} from "@/lib/constantes";
import { cn } from "@/lib/utils";

type Ejecucion = {
  id: string;
  programada: string;
  ejecutada: string | null;
  retrasoS: number | null;
  resultado: string;
  motivo: string | null;
};

type Horario = {
  id: string;
  nombre: string;
  dias: number[];
  hora: string;
  duracionMaxMin: number;
  potencia: string;
  patron: string;
  saltarSiBateria: boolean;
  bateriaMinPct: number;
  activo: boolean;
  ejecuciones: Ejecucion[];
};

type Borrador = Omit<Horario, "id" | "ejecuciones"> & { id: string | null };

const NUEVO: Borrador = {
  id: null,
  nombre: "Nueva limpieza",
  dias: [1, 3, 5],
  hora: "09:00",
  duracionMaxMin: 45,
  potencia: "NORMAL",
  patron: "ZIGZAG",
  saltarSiBateria: true,
  bateriaMinPct: 30,
  activo: true,
};

/** Franja horaria que dibuja el calendario semanal. */
const HORAS = Array.from({ length: 17 }, (_, i) => i + 6); // 06:00 a 22:00

export function VistaHorarios() {
  const [horarios, setHorarios] = useState<Horario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetch("/api/schedules", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setHorarios((await r.json()) as Horario[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function guardar() {
    if (!borrador) return;
    setGuardando(true);
    try {
      const { id, ...cuerpo } = borrador;
      const r = await fetch(id ? `/api/schedules/${id}` : "/api/schedules", {
        method: id ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cuerpo),
      });
      if (!r.ok) {
        const j = (await r.json()) as { detalle?: string };
        toast.error("No se pudo guardar el horario", { description: j.detalle });
        return;
      }
      toast.success(id ? "Horario actualizado" : "Horario creado");
      setBorrador(null);
      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(id: string) {
    const r = await fetch(`/api/schedules/${id}`, { method: "DELETE" });
    if (!r.ok) {
      toast.error("No se pudo borrar el horario");
      return;
    }
    toast.success("Horario eliminado");
    await cargar();
  }

  async function alternarActivo(h: Horario) {
    const r = await fetch(`/api/schedules/${h.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activo: !h.activo }),
    });
    if (!r.ok) {
      toast.error("No se pudo cambiar el estado");
      return;
    }
    toast.success(h.activo ? "Horario desactivado" : "Horario activado");
    await cargar();
  }

  const ejecuciones = useMemo(
    () =>
      horarios
        .flatMap((h) => h.ejecuciones.map((e) => ({ ...e, horario: h.nombre })))
        .sort((a, b) => new Date(b.programada).getTime() - new Date(a.programada).getTime())
        .slice(0, 40),
    [horarios],
  );

  // Cumplimiento del mes en curso.
  const cumplimiento = useMemo(() => {
    const mes = new Date().getMonth();
    const delMes = horarios
      .flatMap((h) => h.ejecuciones)
      .filter((e) => new Date(e.programada).getMonth() === mes);
    if (delMes.length === 0) return { pct: 0, ejecutadas: 0, total: 0 };
    const ejecutadas = delMes.filter((e) => e.resultado === "EJECUTADA").length;
    return { pct: (ejecutadas / delMes.length) * 100, ejecutadas, total: delMes.length };
  }, [horarios]);

  const itemsPotencia = POTENCIAS.map((p) => ({ value: p, label: p }));
  const itemsPatron = PATRONES.map((p) => ({ value: p, label: ETIQUETA_PATRON[p] }));

  if (cargando) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-72" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      {error && (
        <Tarjeta>
          <ErrorPanel
            mensaje="No se pudieron cargar los horarios"
            detalle={error}
            onReintentar={() => void cargar()}
          />
        </Tarjeta>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* ---------------- Calendario semanal ---------------- */}
        <div className="lg:col-span-9">
          <Tarjeta
            etiqueta="Semana programada"
            accion={
              <Button size="sm" onClick={() => setBorrador(NUEVO)}>
                <Plus className="size-3.5" aria-hidden /> Nuevo horario
              </Button>
            }
          >
            <div className="overflow-x-auto">
              <div className="grid min-w-[620px] grid-cols-[52px_repeat(7,1fr)] gap-px">
                <div />
                {DIAS_SEMANA.map((d) => (
                  <div key={d} className="etiqueta pb-2 text-center text-[11px]">
                    {d}
                  </div>
                ))}
                {HORAS.map((hora) => (
                  <div key={hora} className="contents">
                    <div className="valor pr-2 text-right text-[10px] text-[var(--text-faint)]">
                      {String(hora).padStart(2, "0")}:00
                    </div>
                    {DIAS_SEMANA.map((_, dia) => {
                      const bloques = horarios.filter(
                        (h) => h.dias.includes(dia) && Number(h.hora.split(":")[0]) === hora,
                      );
                      return (
                        <div
                          key={`${hora}-${dia}`}
                          className="relative min-h-7 border-t border-[var(--border)]"
                        >
                          {bloques.map((b) => (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() => setBorrador({ ...b, id: b.id })}
                              className={cn(
                                "absolute inset-x-0.5 top-0.5 rounded-[4px] px-1.5 py-1 text-left text-[10px] leading-tight transition-opacity duration-150",
                                b.activo
                                  ? "bg-[var(--sensor-frontal)]/15 text-[var(--sensor-frontal)]"
                                  : "bg-[var(--surface-alt)] text-[var(--text-faint)] line-through",
                              )}
                              title={`${b.nombre} · ${b.hora}`}
                            >
                              {b.hora} {b.nombre}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            {horarios.length === 0 && (
              <Vacio
                mensaje="No hay horarios programados."
                accion={
                  <Button size="sm" onClick={() => setBorrador(NUEVO)}>
                    Crear el primero
                  </Button>
                }
              />
            )}
          </Tarjeta>
        </div>

        {/* ---------------- Anillo de cumplimiento ---------------- */}
        <div className="lg:col-span-3">
          <Tarjeta etiqueta="Cumplimiento del mes" className="h-full">
            <div className="flex flex-col items-center gap-3">
              <svg
                viewBox="0 0 120 120"
                className="size-32 -rotate-90"
                role="meter"
                aria-valuenow={Math.round(cumplimiento.pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Cumplimiento ${Math.round(cumplimiento.pct)} por ciento`}
              >
                <circle cx={60} cy={60} r={50} fill="none" stroke="var(--surface-alt)" strokeWidth={10} />
                <circle
                  cx={60}
                  cy={60}
                  r={50}
                  fill="none"
                  stroke="var(--ok)"
                  strokeWidth={10}
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 50}
                  strokeDashoffset={2 * Math.PI * 50 * (1 - cumplimiento.pct / 100)}
                />
              </svg>
              <p className="kpi text-2xl">{num(cumplimiento.pct, 0)} %</p>
              <p className="text-center text-xs text-[var(--text-muted)]">
                {cumplimiento.ejecutadas} de {cumplimiento.total} ejecuciones programadas
              </p>
            </div>
          </Tarjeta>
        </div>
      </div>

      {/* ---------------- Lista de horarios ---------------- */}
      <Tarjeta etiqueta="Horarios">
        {horarios.length === 0 ? (
          <Vacio mensaje="Todavía no hay horarios creados." />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {horarios.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-4 py-3">
                <div className="min-w-40 flex-1">
                  <p className="text-sm text-[var(--text)]">{h.nombre}</p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {h.dias.map((d) => DIAS_SEMANA[d]).join(" · ")} a las{" "}
                    <span className="valor">{h.hora}</span> · máx {h.duracionMaxMin} min ·{" "}
                    {ETIQUETA_PATRON[h.patron as Patron]} · {h.potencia.toLowerCase()}
                  </p>
                </div>
                {h.saltarSiBateria && (
                  <Badge variant="outline" className="text-[11px] text-[var(--text-muted)]">
                    Salta bajo {num(h.bateriaMinPct, 0)} %
                  </Badge>
                )}
                <Switch
                  checked={h.activo}
                  onCheckedChange={() => void alternarActivo(h)}
                  aria-label={`${h.activo ? "Desactivar" : "Activar"} ${h.nombre}`}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setBorrador({ ...h, id: h.id })}
                  aria-label={`Editar ${h.nombre}`}
                >
                  <Pencil className="size-3.5" aria-hidden />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void borrar(h.id)}
                  aria-label={`Borrar ${h.nombre}`}
                  className="text-[var(--critical)]"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      {/* ---------------- Tabla de cumplimiento ---------------- */}
      <Tarjeta etiqueta="Ejecuciones recientes">
        {ejecuciones.length === 0 ? (
          <Vacio mensaje="Sin ejecuciones registradas todavía." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Horario</TableHead>
                  <TableHead>Programada</TableHead>
                  <TableHead>Ejecutada</TableHead>
                  <TableHead className="text-right">Retraso</TableHead>
                  <TableHead>Resultado</TableHead>
                  <TableHead>Motivo de omisión</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ejecuciones.map((e) => (
                  <TableRow key={e.id} className="odd:bg-[var(--surface-alt)]/40">
                    <TableCell>{e.horario}</TableCell>
                    <TableCell className="valor text-[var(--text-muted)]">
                      {fmtFechaHora(e.programada)}
                    </TableCell>
                    <TableCell className="valor text-[var(--text-muted)]">
                      {e.ejecutada ? fmtFechaHora(e.ejecutada) : "—"}
                    </TableCell>
                    <TableCell className="valor text-right">
                      {e.retrasoS !== null ? `${e.retrasoS} s` : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[11px]",
                          e.resultado === "EJECUTADA"
                            ? "text-[var(--ok)] border-[var(--ok)]/40"
                            : e.resultado === "OMITIDA"
                              ? "text-[var(--warn)] border-[var(--warn)]/40"
                              : "text-[var(--critical)] border-[var(--critical)]/40",
                        )}
                      >
                        {e.resultado}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-[var(--text-muted)]">{e.motivo ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Tarjeta>

      {/* ---------------- Panel lateral de edición ---------------- */}
      <Sheet open={borrador !== null} onOpenChange={(o) => !o && setBorrador(null)}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{borrador?.id ? "Editar horario" : "Nuevo horario"}</SheetTitle>
            <SheetDescription>
              El robot arrancará solo a la hora indicada, si la batería lo permite.
            </SheetDescription>
          </SheetHeader>

          {borrador && (
            <div className="flex flex-col gap-5 overflow-y-auto px-4 py-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="h-nombre" className="etiqueta text-[11px]">
                  Nombre
                </Label>
                <Input
                  id="h-nombre"
                  value={borrador.nombre}
                  onChange={(e) => setBorrador({ ...borrador, nombre: e.target.value })}
                />
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="etiqueta text-[11px]">Días de la semana</legend>
                <div className="flex flex-wrap gap-1.5">
                  {DIAS_SEMANA.map((d, i) => {
                    const activo = borrador.dias.includes(i);
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={activo}
                        onClick={() =>
                          setBorrador({
                            ...borrador,
                            dias: activo
                              ? borrador.dias.filter((x) => x !== i)
                              : [...borrador.dias, i].sort(),
                          })
                        }
                        className={cn(
                          "rounded-md border px-2.5 py-1 text-xs transition-colors duration-150",
                          activo
                            ? "border-[var(--sensor-frontal)]/40 bg-[var(--sensor-frontal)]/10 text-[var(--sensor-frontal)]"
                            : "border-[var(--border)] text-[var(--text-muted)]",
                        )}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="h-hora" className="etiqueta text-[11px]">
                  Hora de inicio
                </Label>
                <Input
                  id="h-hora"
                  type="time"
                  value={borrador.hora}
                  onChange={(e) => setBorrador({ ...borrador, hora: e.target.value })}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label className="etiqueta text-[11px]">
                  Duración máxima · <span className="valor">{borrador.duracionMaxMin} min</span>
                </Label>
                <Slider
                  min={10}
                  max={120}
                  step={5}
                  value={[borrador.duracionMaxMin]}
                  onValueChange={(v) =>
                    setBorrador({
                      ...borrador,
                      duracionMaxMin: Array.isArray(v) ? v[0] : v,
                    })
                  }
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="h-potencia" className="etiqueta text-[11px]">
                  Potencia
                </Label>
                <Select
                  items={itemsPotencia}
                  value={borrador.potencia}
                  onValueChange={(v) => setBorrador({ ...borrador, potencia: String(v) as Potencia })}
                >
                  <SelectTrigger id="h-potencia" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {itemsPotencia.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="h-patron" className="etiqueta text-[11px]">
                  Patrón
                </Label>
                <Select
                  items={itemsPatron}
                  value={borrador.patron}
                  onValueChange={(v) => setBorrador({ ...borrador, patron: String(v) as Patron })}
                >
                  <SelectTrigger id="h-patron" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {itemsPatron.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="h-saltar" className="text-sm">
                  Saltar si la batería está por debajo de {num(borrador.bateriaMinPct, 0)} %
                </Label>
                <Switch
                  id="h-saltar"
                  checked={borrador.saltarSiBateria}
                  onCheckedChange={(c) => setBorrador({ ...borrador, saltarSiBateria: c })}
                />
              </div>
              {borrador.saltarSiBateria && (
                <Slider
                  min={0}
                  max={100}
                  step={5}
                  value={[borrador.bateriaMinPct]}
                  onValueChange={(v) =>
                    setBorrador({ ...borrador, bateriaMinPct: Array.isArray(v) ? v[0] : v })
                  }
                  aria-label="Batería mínima para ejecutar"
                />
              )}

              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="h-activo" className="text-sm">
                  Horario activo
                </Label>
                <Switch
                  id="h-activo"
                  checked={borrador.activo}
                  onCheckedChange={(c) => setBorrador({ ...borrador, activo: c })}
                />
              </div>
            </div>
          )}

          <SheetFooter>
            <Button onClick={() => void guardar()} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar"}
            </Button>
            <Button variant="outline" onClick={() => setBorrador(null)}>
              Cancelar
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
