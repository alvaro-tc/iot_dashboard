"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Brush,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
  BarChart,
  Legend,
} from "recharts";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import { Tarjeta } from "@/components/comunes/tarjeta";
import { TooltipGrafico } from "@/components/comunes/graficos";
import { ErrorPanel, Vacio } from "@/components/comunes/estados";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { cientifico, fmtFechaHora, fmtHora, num } from "@/lib/format";
import {
  COLOR_SENAL,
  ETIQUETA_SENAL,
  SENALES,
  UNIDAD_SENAL,
  type Senal,
} from "@/lib/constantes";
import { cn } from "@/lib/utils";

type Fila = {
  id: string;
  timestamp: string;
  sessionId: string | null;
  n: number;
  senal: string;
  x: number;
  valorFisico: number;
  valorAproximado: number;
  valorReal: number;
  errorAbsoluto: number;
  errorRelativo: number;
};

type Filtros = {
  senal: string;
  sessionId: string;
  nMin: string;
  nMax: string;
  desde: string;
  hasta: string;
};

const FILTROS_VACIOS: Filtros = {
  senal: "todas",
  sessionId: "todas",
  nMin: "",
  nMax: "",
  desde: "",
  hasta: "",
};

const COLUMNAS = [
  { clave: "timestamp", etiqueta: "Timestamp" },
  { clave: "sessionId", etiqueta: "Sesión" },
  { clave: "n", etiqueta: "n" },
  { clave: "senal", etiqueta: "Señal" },
  { clave: "valorFisico", etiqueta: "Valor medido" },
  { clave: "valorReal", etiqueta: "Valor real" },
  { clave: "errorAbsoluto", etiqueta: "Error absoluto" },
  { clave: "errorRelativo", etiqueta: "Error relativo" },
] as const;

type ClaveColumna = (typeof COLUMNAS)[number]["clave"];

const POR_PAGINA = 25;

/** Construye la query compartida por la tabla y la exportación. */
function aQuery(f: Filtros, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams(extra);
  if (f.senal !== "todas") p.set("senal", f.senal);
  if (f.sessionId !== "todas") p.set("sessionId", f.sessionId);
  if (f.nMin) p.set("nMin", f.nMin);
  if (f.nMax) p.set("nMax", f.nMax);
  if (f.desde) p.set("desde", new Date(f.desde).toISOString());
  if (f.hasta) p.set("hasta", new Date(f.hasta).toISOString());
  return p.toString();
}

export function VistaTelemetria({
  sesiones,
}: {
  sesiones: Array<{ id: string; etiqueta: string }>;
}) {
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orden, setOrden] = useState<{ clave: ClaveColumna; dir: "asc" | "desc" }>({
    clave: "timestamp",
    dir: "desc",
  });
  const [pagina, setPagina] = useState(1);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/telemetry?${aQuery(filtros, { pageSize: "3000", orderBy: "timestamp", order: "asc" })}`,
        { cache: "no-store" },
      );
      if (!r.ok) {
        const j = (await r.json()) as { detalle?: string };
        throw new Error(j.detalle ?? `HTTP ${r.status}`);
      }
      const j = (await r.json()) as { datos: Fila[] };
      setFilas(j.datos);
      setPagina(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setCargando(false);
    }
  }, [filtros]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /* ---- Series para el gráfico temporal multi-señal ------------------- */
  const serieTemporal = useMemo(() => {
    const mapa = new Map<number, Record<string, number>>();
    for (const f of filas) {
      const ms = new Date(f.timestamp).getTime();
      const p = mapa.get(ms) ?? { ms };
      p[f.senal] = f.valorFisico;
      mapa.set(ms, p);
    }
    return [...mapa.values()].sort((a, b) => a.ms - b.ms);
  }, [filas]);

  const senalesPresentes = useMemo(
    () => SENALES.filter((s) => filas.some((f) => f.senal === s)),
    [filas],
  );

  /* ---- Histograma de distancias por sensor --------------------------- */
  const histograma = useMemo(() => {
    const anchoBin = 20;
    const bins = Array.from({ length: 11 }, (_, i) => ({
      bin: `${i * anchoBin}`,
      DIST_FRONTAL: 0,
      DIST_IZQ: 0,
      DIST_DER: 0,
    }));
    for (const f of filas) {
      if (!["DIST_FRONTAL", "DIST_IZQ", "DIST_DER"].includes(f.senal)) continue;
      const idx = Math.min(bins.length - 1, Math.floor(f.valorFisico / anchoBin));
      bins[idx][f.senal as "DIST_FRONTAL" | "DIST_IZQ" | "DIST_DER"] += 1;
    }
    return bins;
  }, [filas]);

  /* ---- Precisión: error medio por n, una línea por señal -------------- */
  const precision = useMemo(() => {
    const acum = new Map<number, Record<string, { suma: number; cuenta: number }>>();
    for (const f of filas) {
      if (f.errorAbsoluto <= 0) continue;
      const porN = acum.get(f.n) ?? {};
      const c = porN[f.senal] ?? { suma: 0, cuenta: 0 };
      c.suma += f.errorAbsoluto;
      c.cuenta += 1;
      porN[f.senal] = c;
      acum.set(f.n, porN);
    }
    return [...acum.entries()]
      .map(([n, porSenal]) => {
        const fila: Record<string, number> = { n };
        for (const [senal, c] of Object.entries(porSenal)) fila[senal] = c.suma / c.cuenta;
        return fila;
      })
      .sort((a, b) => a.n - b.n);
  }, [filas]);

  const dispersion = useMemo(
    () =>
      filas
        .filter((f) => f.errorAbsoluto > 0)
        .slice(0, 1500)
        .map((f) => ({ n: f.n, error: f.errorAbsoluto, senal: f.senal })),
    [filas],
  );

  /* ---- Tabla ordenable y paginada ------------------------------------ */
  const ordenadas = useMemo(() => {
    const copia = [...filas];
    copia.sort((a, b) => {
      const va = a[orden.clave];
      const vb = b[orden.clave];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      const cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb));
      return orden.dir === "asc" ? cmp : -cmp;
    });
    return copia;
  }, [filas, orden]);

  const totalPaginas = Math.max(1, Math.ceil(ordenadas.length / POR_PAGINA));
  const visibles = ordenadas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  const alternarOrden = (clave: ClaveColumna) =>
    setOrden((o) => ({ clave, dir: o.clave === clave && o.dir === "asc" ? "desc" : "asc" }));

  const itemsSenal = [
    { value: "todas", label: "Todas las señales" },
    ...SENALES.map((s) => ({ value: s, label: ETIQUETA_SENAL[s] })),
  ];
  const itemsSesion = [
    { value: "todas", label: "Todas las sesiones" },
    ...sesiones.map((s) => ({ value: s.id, label: s.etiqueta })),
  ];

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* ---------------- Filtros ---------------- */}
      <Tarjeta
        etiqueta="Filtros"
        accion={
          <Button
            size="sm"
            variant="outline"
            render={<a href={`/api/export?${aQuery(filtros)}`} download />}
          >
            <Download className="size-3.5" aria-hidden /> Exportar CSV
          </Button>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f-senal" className="etiqueta text-[11px]">
              Señal
            </Label>
            <Select
              items={itemsSenal}
              value={filtros.senal}
              onValueChange={(v) => setFiltros((f) => ({ ...f, senal: String(v) }))}
            >
              <SelectTrigger id="f-senal" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {itemsSenal.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f-sesion" className="etiqueta text-[11px]">
              Sesión
            </Label>
            <Select
              items={itemsSesion}
              value={filtros.sessionId}
              onValueChange={(v) => setFiltros((f) => ({ ...f, sessionId: String(v) }))}
            >
              <SelectTrigger id="f-sesion" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {itemsSesion.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f-desde" className="etiqueta text-[11px]">
              Desde
            </Label>
            <Input
              id="f-desde"
              type="datetime-local"
              value={filtros.desde}
              onChange={(e) => setFiltros((f) => ({ ...f, desde: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f-hasta" className="etiqueta text-[11px]">
              Hasta
            </Label>
            <Input
              id="f-hasta"
              type="datetime-local"
              value={filtros.hasta}
              onChange={(e) => setFiltros((f) => ({ ...f, hasta: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f-nmin" className="etiqueta text-[11px]">
              n mínimo
            </Label>
            <Input
              id="f-nmin"
              type="number"
              min={1}
              value={filtros.nMin}
              onChange={(e) => setFiltros((f) => ({ ...f, nMin: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f-nmax" className="etiqueta text-[11px]">
              n máximo
            </Label>
            <Input
              id="f-nmax"
              type="number"
              min={1}
              value={filtros.nMax}
              onChange={(e) => setFiltros((f) => ({ ...f, nMax: e.target.value }))}
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button size="sm" variant="ghost" onClick={() => setFiltros(FILTROS_VACIOS)}>
            Limpiar filtros
          </Button>
          <span className="text-xs text-[var(--text-muted)]">
            {cargando ? "Cargando…" : `${filas.length.toLocaleString("es")} registros`}
          </span>
        </div>
      </Tarjeta>

      {error && (
        <Tarjeta>
          <ErrorPanel
            mensaje="No se pudo cargar la telemetría"
            detalle={error}
            onReintentar={() => void cargar()}
          />
        </Tarjeta>
      )}

      {cargando ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      ) : filas.length === 0 ? (
        <Tarjeta>
          <Vacio
            mensaje="Ningún registro coincide con estos filtros."
            accion={
              <Button size="sm" variant="outline" onClick={() => setFiltros(FILTROS_VACIOS)}>
                Limpiar filtros
              </Button>
            }
          />
        </Tarjeta>
      ) : (
        <>
          {/* ---------------- Serie temporal con zoom por brush ---------------- */}
          <Tarjeta etiqueta="Serie temporal · arrastra en la banda inferior para hacer zoom">
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={serieTemporal} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="ms"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    scale="time"
                    tickFormatter={(v: number) => fmtHora(new Date(v))}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={48}
                  />
                  <YAxis axisLine={false} tickLine={false} width={48} />
                  <Tooltip
                    content={
                      <TooltipGrafico
                        etiquetas={ETIQUETA_SENAL}
                        unidades={UNIDAD_SENAL}
                        formateaLabel={(v) => fmtFechaHora(new Date(Number(v)))}
                      />
                    }
                  />
                  {senalesPresentes.map((s) => (
                    <Line
                      key={s}
                      type="monotone"
                      dataKey={s}
                      name={ETIQUETA_SENAL[s]}
                      stroke={COLOR_SENAL[s]}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls
                    />
                  ))}
                  <Brush
                    dataKey="ms"
                    height={22}
                    travellerWidth={8}
                    stroke="var(--border)"
                    fill="var(--surface-alt)"
                    tickFormatter={(v: number) => fmtHora(new Date(v))}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Tarjeta>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* ---------------- Histograma de distancias ---------------- */}
            <Tarjeta etiqueta="Distribución de distancias por sensor (cm)">
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histograma} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="bin" axisLine={false} tickLine={false} />
                    <YAxis axisLine={false} tickLine={false} width={44} />
                    <Tooltip
                      content={<TooltipGrafico etiquetas={ETIQUETA_SENAL} />}
                      cursor={{ fill: "var(--surface-alt)" }}
                    />
                    <Legend
                      formatter={(v: string) => (
                        <span className="text-[11px] text-[var(--text-muted)]">
                          {ETIQUETA_SENAL[v as Senal] ?? v}
                        </span>
                      )}
                    />
                    <Bar dataKey="DIST_FRONTAL" fill="var(--sensor-frontal)" />
                    <Bar dataKey="DIST_IZQ" fill="var(--sensor-izq)" />
                    <Bar dataKey="DIST_DER" fill="var(--sensor-der)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-3 text-[11px] text-[var(--text-faint)]">
                Concentración en los bins bajos: el robot trabaja pegado a las paredes.
              </p>
            </Tarjeta>

            {/* ---------------- Precisión frente a n (eje log) ---------------- */}
            <Tarjeta etiqueta="Precisión de la estimación según número de muestras (n)">
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={precision} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="n"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      scale="log"
                      domain={["auto", "auto"]}
                      axisLine={false}
                      tickLine={false}
                      width={62}
                      tickFormatter={(v: number) => cientifico(v, 0)}
                    />
                    <Tooltip
                      content={<TooltipGrafico etiquetas={ETIQUETA_SENAL} />}
                    />
                    {senalesPresentes.map((s) => (
                      <Line
                        key={s}
                        type="monotone"
                        dataKey={s}
                        name={ETIQUETA_SENAL[s]}
                        stroke={COLOR_SENAL[s]}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-3 text-[11px] text-[var(--text-faint)]">
                Eje logarítmico: la incertidumbre de la medición cae varios órdenes de magnitud al
                aumentar el número de términos usados.
              </p>
            </Tarjeta>
          </div>

          {/* ---------------- Dispersión error vs n ---------------- */}
          <Tarjeta etiqueta="Dispersión del error frente a n">
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="n"
                    type="number"
                    name="n"
                    domain={["dataMin", "dataMax"]}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    dataKey="error"
                    type="number"
                    scale="log"
                    domain={["auto", "auto"]}
                    axisLine={false}
                    tickLine={false}
                    width={62}
                    tickFormatter={(v: number) => cientifico(v, 0)}
                  />
                  <Tooltip
                    cursor={{ stroke: "var(--border)" }}
                    content={<TooltipGrafico etiquetas={{ error: "Error absoluto", n: "n" }} />}
                  />
                  <Scatter data={dispersion} isAnimationActive={false}>
                    {dispersion.map((d, i) => (
                      <Cell key={i} fill={COLOR_SENAL[d.senal as Senal] ?? "var(--text-muted)"} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </Tarjeta>

          {/* ---------------- Tabla completa ---------------- */}
          <Tarjeta
            etiqueta="Registros"
            accion={
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pagina <= 1}
                  onClick={() => setPagina((p) => p - 1)}
                >
                  Anterior
                </Button>
                <span className="valor text-[11px] text-[var(--text-muted)]">
                  {pagina} / {totalPaginas}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pagina >= totalPaginas}
                  onClick={() => setPagina((p) => p + 1)}
                >
                  Siguiente
                </Button>
              </div>
            }
          >
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {COLUMNAS.map((c) => (
                      <TableHead key={c.clave}>
                        <button
                          type="button"
                          onClick={() => alternarOrden(c.clave)}
                          className="flex items-center gap-1 hover:text-[var(--text)]"
                          aria-sort={
                            orden.clave === c.clave
                              ? orden.dir === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                        >
                          {c.etiqueta}
                          {orden.clave === c.clave &&
                            (orden.dir === "asc" ? (
                              <ArrowUp className="size-3" aria-hidden />
                            ) : (
                              <ArrowDown className="size-3" aria-hidden />
                            ))}
                        </button>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibles.map((f) => (
                    <TableRow key={f.id} className="odd:bg-[var(--surface-alt)]/40">
                      <TableCell className="valor text-[var(--text-muted)]">
                        {fmtFechaHora(f.timestamp)}
                      </TableCell>
                      <TableCell className="valor text-[var(--text-faint)]">
                        {f.sessionId ? f.sessionId.slice(-6) : "—"}
                      </TableCell>
                      <TableCell className="valor">{f.n}</TableCell>
                      <TableCell>
                        <span
                          className={cn("inline-flex items-center gap-1.5")}
                          style={{ color: COLOR_SENAL[f.senal as Senal] }}
                        >
                          <span className="size-2 rounded-[2px] bg-current" aria-hidden />
                          <span className="text-[var(--text)]">
                            {ETIQUETA_SENAL[f.senal as Senal] ?? f.senal}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="valor">
                        {num(f.valorFisico, 2)} {UNIDAD_SENAL[f.senal as Senal]}
                      </TableCell>
                      <TableCell className="valor text-[var(--text-muted)]">
                        {num(f.valorReal, 4)}
                      </TableCell>
                      <TableCell className="valor">{cientifico(f.errorAbsoluto)}</TableCell>
                      <TableCell className="valor text-[var(--text-muted)]">
                        {cientifico(f.errorRelativo)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Tarjeta>
        </>
      )}
    </div>
  );
}
