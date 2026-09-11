"use client";

import { useEffect, useRef, useState } from "react";
import type { EstadoVivo, EventoVivo, PuntoVivo } from "@/lib/bus";

/** 120 s de ventana a 2 Hz. */
const CAPACIDAD = 240;
const MAX_INTENTOS_SSE = 3;

export type EstadoConexion = "conectando" | "sse" | "polling" | "error";

/**
 * Suscripción SSE a /api/stream con reconexión de retroceso exponencial.
 * Tras tres fallos consecutivos se cae a polling cada 5 s contra /api/telemetry.
 */
export function useStream() {
  const [puntos, setPuntos] = useState<PuntoVivo[]>([]);
  const [eventos, setEventos] = useState<EventoVivo[]>([]);
  const [estado, setEstado] = useState<EstadoVivo | null>(null);
  const [conexion, setConexion] = useState<EstadoConexion>("conectando");
  const [ultimoMensaje, setUltimoMensaje] = useState<number | null>(null);
  const intentos = useRef(0);

  useEffect(() => {
    let fuente: EventSource | null = null;
    let reconexion: ReturnType<typeof setTimeout> | null = null;
    let sondeo: ReturnType<typeof setInterval> | null = null;
    let vivo = true;

    const empujar = (p: PuntoVivo) => {
      setUltimoMensaje(Date.now());
      // Buffer circular: se descartan los puntos más antiguos.
      setPuntos((prev) => (prev.length >= CAPACIDAD ? [...prev.slice(1), p] : [...prev, p]));
    };

    /** Plan B: si el SSE no levanta, se consulta la API cada 5 s. */
    const iniciarPolling = () => {
      if (sondeo) return;
      setConexion("polling");
      const consultar = async () => {
        try {
          const r = await fetch("/api/telemetry?senal=DIST_FRONTAL&pageSize=1", {
            cache: "no-store",
          });
          if (!r.ok) return;
          const json = (await r.json()) as { datos: Array<Record<string, number | string>> };
          const fila = json.datos?.[0];
          if (fila) setUltimoMensaje(Date.now());
        } catch {
          // Se reintenta en el siguiente ciclo.
        }
      };
      void consultar();
      sondeo = setInterval(() => void consultar(), 5000);
    };

    const conectar = () => {
      if (!vivo) return;
      fuente = new EventSource("/api/stream");

      fuente.addEventListener("conectado", () => {
        intentos.current = 0;
        setConexion("sse");
      });
      fuente.addEventListener("telemetria", (e) => {
        empujar(JSON.parse((e as MessageEvent<string>).data) as PuntoVivo);
      });
      fuente.addEventListener("evento", (e) => {
        const ev = JSON.parse((e as MessageEvent<string>).data) as EventoVivo;
        setEventos((prev) => [ev, ...prev].slice(0, 50));
      });
      fuente.addEventListener("estado", (e) => {
        setEstado(JSON.parse((e as MessageEvent<string>).data) as EstadoVivo);
      });

      fuente.onerror = () => {
        fuente?.close();
        fuente = null;
        intentos.current += 1;
        if (intentos.current >= MAX_INTENTOS_SSE) {
          iniciarPolling();
          return;
        }
        setConexion("error");
        // Retroceso exponencial: 1 s, 2 s, 4 s.
        const espera = 1000 * 2 ** (intentos.current - 1);
        reconexion = setTimeout(conectar, espera);
      };
    };

    conectar();

    return () => {
      vivo = false;
      fuente?.close();
      if (reconexion) clearTimeout(reconexion);
      if (sondeo) clearInterval(sondeo);
    };
  }, []);

  return { puntos, eventos, estado, conexion, ultimoMensaje };
}
