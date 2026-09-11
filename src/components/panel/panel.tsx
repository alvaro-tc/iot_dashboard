"use client";

import { useEffect, useMemo, useState } from "react";
import { useStream } from "@/hooks/use-stream";
import { BannerOffline } from "@/components/comunes/estados";
import { BarraSuperior } from "./barra-superior";
import { KpiCard } from "./kpi-card";
import { SensoresUltrasonicos } from "./sensores-ultrasonicos";
import { GraficoVivo } from "./grafico-vivo";
import { CurvaDescontaminacion } from "./curva-descontaminacion";
import { Odometria } from "./odometria";
import { GaugeBateria } from "./gauge-bateria";
import { IndicadorZonaWifi } from "./zona-wifi";
import { ProximaLimpieza } from "./proxima-limpieza";
import { TablaEventos } from "./tabla-eventos";
import { fmtDuracion, num } from "@/lib/format";
import type { DatosPanel } from "@/lib/panel-datos";
import type { Modo, ZonaWifi } from "@/lib/constantes";

/**
 * Orquestador del panel: parte del snapshot servido por el servidor y lo
 * va fusionando con lo que llega por SSE, sin recargar la página.
 */
export function Panel({ inicial }: { inicial: DatosPanel }) {
  const { puntos, eventos, estado, conexion, ultimoMensaje } = useStream();
  const [buffer, setBuffer] = useState(inicial.puntos);

  // El buffer del cliente arranca con lo que ya había en la base y se rellena
  // con los puntos del stream, descartando los más antiguos.
  useEffect(() => {
    if (puntos.length === 0) return;
    setBuffer((prev) => [...prev, ...puntos.slice(-1)].slice(-240));
  }, [puntos]);

  const ultimo = buffer[buffer.length - 1];
  const modo = (estado?.modo ?? inicial.device.modo) as Modo;
  const bateriaPct = estado?.bateriaPct ?? inicial.device.bateriaPct;
  const voltaje = estado?.voltaje ?? inicial.device.voltaje;
  const rssi = estado?.rssi ?? inicial.device.rssi;
  const zona = (estado?.zonaWifi ?? inicial.device.zonaWifi) as ZonaWifi;

  const eventosFusionados = useMemo(
    () => [...eventos, ...inicial.eventos].slice(0, 20),
    [eventos, inicial.eventos],
  );

  // Detecciones de la sesión: las del servidor más las llegadas en vivo.
  const detecciones = useMemo(() => {
    const extra = { frontal: 0, izq: 0, der: 0 };
    for (const e of eventos) {
      if (e.tipo !== "OBSTACULO_DETECTADO") continue;
      if (e.sensor === "FRONTAL") extra.frontal++;
      else if (e.sensor === "IZQUIERDO") extra.izq++;
      else if (e.sensor === "DERECHO") extra.der++;
    }
    return {
      frontal: inicial.detecciones.frontal + extra.frontal,
      izq: inicial.detecciones.izq + extra.izq,
      der: inicial.detecciones.der + extra.der,
    };
  }, [eventos, inicial.detecciones]);

  const curvaPm = useMemo(() => {
    const vivos = buffer.map((p) => ({ ms: new Date(p.t).getTime(), pm: p.densidadPolvoMgM3 }));
    const todos = [...inicial.curvaPm, ...vivos];
    // Se deduplica por instante para que el replay del buffer no repita puntos.
    const mapa = new Map(todos.map((d) => [d.ms, d]));
    return [...mapa.values()].sort((a, b) => a.ms - b.ms);
  }, [buffer, inicial.curvaPm]);

  const evasiones = useMemo(() => {
    const vivos = eventos
      .filter((e) => e.tipo === "MANIOBRA_EVASION")
      .map((e) => new Date(e.timestamp).getTime());
    const desde = buffer.length ? new Date(buffer[0].t).getTime() : 0;
    return [...new Set([...inicial.evasiones, ...vivos])].filter((ms) => ms >= desde);
  }, [eventos, inicial.evasiones, buffer]);

  const pulsosIzq = buffer.reduce((a, p) => a + p.pulsosIzq, 0);
  const pulsosDer = buffer.reduce((a, p) => a + p.pulsosDer, 0);
  const efectividad = useMemo(() => {
    if (curvaPm.length < 2) return inicial.kpis.efectividad.pct;
    const inicio = curvaPm[0].pm;
    const fin = curvaPm[curvaPm.length - 1].pm;
    return inicio > 0 ? Math.max(0, ((inicio - fin) / inicio) * 100) : null;
  }, [curvaPm, inicial.kpis.efectividad.pct]);

  const enVivo = conexion === "sse" && ultimoMensaje !== null && Date.now() - ultimoMensaje < 15_000;
  const ultimaTelemetria = ultimo?.t ?? inicial.device.ultimaConexion;

  return (
    <div className="flex min-h-dvh flex-col">
      <BarraSuperior
        nombre={inicial.device.nombre}
        modo={modo}
        ultimaTelemetria={ultimaTelemetria}
        enVivo={enVivo}
      />
      {!inicial.device.online && !enVivo && (
        <BannerOffline ultimaConexion={inicial.device.ultimaConexion} />
      )}

      <div className="grid flex-1 grid-cols-1 gap-4 p-6 md:grid-cols-6 lg:grid-cols-12">
        {/* Fila de KPIs */}
        <div className="md:col-span-3 lg:col-span-3">
          <KpiCard
            etiqueta="Batería"
            valor={num(bateriaPct, 0)}
            unidad="%"
            tono={
              bateriaPct <= inicial.config.bateriaRetornoPct
                ? "critical"
                : bateriaPct <= inicial.config.bateriaRetornoPct + 15
                  ? "warn"
                  : "neutro"
            }
            contexto={
              inicial.kpis.bateria.minutosRestantes !== null
                ? `${fmtDuracion(inicial.kpis.bateria.minutosRestantes * 60)} restantes`
                : "Autonomía sin estimar"
            }
            serie={inicial.kpis.bateria.serie}
            color="var(--bateria)"
          />
        </div>
        <div className="md:col-span-3 lg:col-span-3">
          <KpiCard
            etiqueta="Efectividad de limpieza"
            valor={efectividad !== null ? num(efectividad, 1) : "—"}
            unidad="%"
            contexto="Reducción de PM en la sesión"
            serie={inicial.kpis.efectividad.serie}
            color="var(--polvo)"
          />
        </div>
        <div className="md:col-span-3 lg:col-span-3">
          <KpiCard
            etiqueta="Obstáculos evitados hoy"
            valor={String(inicial.kpis.obstaculos.hoy + eventos.filter((e) => e.tipo === "OBSTACULO_DETECTADO").length)}
            contexto={`${num(inicial.kpis.obstaculos.porMinuto, 2)} por minuto`}
            serie={inicial.kpis.obstaculos.serie}
            color="var(--sensor-frontal)"
          />
        </div>
        <div className="md:col-span-3 lg:col-span-3">
          <KpiCard
            etiqueta="Área estimada hoy"
            valor={num(inicial.kpis.area.hoy, 1)}
            unidad="m²"
            contexto={
              <span
                className={
                  inicial.kpis.area.delta >= 0 ? "text-[var(--ok)]" : "text-[var(--text-muted)]"
                }
              >
                {inicial.kpis.area.delta >= 0 ? "+" : ""}
                {num(inicial.kpis.area.delta, 1)} m² respecto a ayer
              </span>
            }
            serie={inicial.kpis.area.serie}
            color="var(--sensor-der)"
          />
        </div>

        {/* Gráfico en vivo + widget de sensores */}
        <div className="md:col-span-6 lg:col-span-8">
          <GraficoVivo puntos={buffer} evasiones={evasiones} />
        </div>
        <div className="md:col-span-6 lg:col-span-4">
          <SensoresUltrasonicos
            frontal={ultimo?.distanciaFrontalCm ?? 0}
            izquierda={ultimo?.distanciaIzquierdaCm ?? 0}
            derecha={ultimo?.distanciaDerechaCm ?? 0}
            umbralFrontal={inicial.config.umbralFrontalCm}
            umbralLateral={inicial.config.umbralLateralCm}
            detecciones={detecciones}
          />
        </div>

        {/* Descontaminación, odometría y batería */}
        <div className="md:col-span-6 lg:col-span-6">
          <CurvaDescontaminacion
            datos={curvaPm}
            objetivo={inicial.config.pmObjetivo}
            efectividad={efectividad}
          />
        </div>
        <div className="md:col-span-3 lg:col-span-3">
          <Odometria
            distanciaM={inicial.sesion?.distanciaM ?? 0}
            velocidadMs={ultimo?.velocidadMs ?? 0}
            pulsosIzq={pulsosIzq}
            pulsosDer={pulsosDer}
          />
        </div>
        <div className="md:col-span-3 lg:col-span-3">
          <GaugeBateria
            pct={bateriaPct}
            voltaje={voltaje}
            minutosRestantes={inicial.kpis.bateria.minutosRestantes}
            umbralRetorno={inicial.config.bateriaRetornoPct}
            serie={inicial.kpis.bateria.serie}
          />
        </div>

        {/* Zona WiFi, próxima limpieza y eventos */}
        <div className="md:col-span-3 lg:col-span-3">
          <IndicadorZonaWifi zona={zona} rssi={rssi} />
        </div>
        <div className="md:col-span-3 lg:col-span-3">
          <ProximaLimpieza proxima={inicial.proxima} />
        </div>
        <div className="md:col-span-6 lg:col-span-6">
          <TablaEventos eventos={eventosFusionados} />
        </div>
      </div>
    </div>
  );
}
