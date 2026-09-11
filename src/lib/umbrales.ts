/**
 * Evaluación de umbrales sobre las muestras entrantes: decide qué eventos
 * dispara cada lectura. Se ejecuta en la ruta de ingesta, de modo que da igual
 * si la muestra vino del simulador o del ESP32 real.
 *
 * Mantiene una ventana deslizante en memoria por sesión (histórico de PM,
 * de pulsos y último voltaje). Si el proceso se reinicia, la ventana arranca
 * vacía y simplemente no se disparan eventos hasta volver a llenarla.
 */
import { caidaTensionAnomala, esZonaSucia, estaAtascado, ruedaTrabada } from "./derivados";
import type { Severidad, TipoEvento, ZonaWifi } from "./constantes";

export type EventoDetectado = {
  tipo: TipoEvento;
  severidad: Severidad;
  sensor?: string;
  valor?: number;
  unidad?: string;
  accion?: string;
  detalle?: Record<string, unknown>;
};

export type ConfigUmbrales = {
  umbralFrontalCm: number;
  umbralLateralCm: number;
  duracionGiroS: number;
  factorZonaSucia: number;
  segundaPasada: boolean;
  bateriaRetornoPct: number;
  bateriaBajaPct: number;
  pmMaxTolerado: number;
  caidaTensionVPorMin: number;
  telemetriaHz: number;
};

export type MuestraEvaluable = {
  t: Date;
  distanciaFrontalCm: number;
  distanciaIzquierdaCm: number;
  distanciaDerechaCm: number;
  densidadPolvoMgM3: number;
  pulsosIzq: number;
  pulsosDer: number;
  velocidadMs: number;
  bateriaPct?: number;
  voltaje?: number;
  zonaWifi?: ZonaWifi;
};

type Ventana = {
  pm: number[];
  pulsos: number[];
  ultimoVoltaje: number | null;
  ultimoT: number | null;
  ultimaZona: ZonaWifi | null;
  avisoBateria: boolean;
  avisoPm: boolean;
  atascoAvisado: boolean;
};

const globalForVentanas = globalThis as unknown as { ventanas?: Map<string, Ventana> };
const ventanas = globalForVentanas.ventanas ?? new Map<string, Ventana>();
globalForVentanas.ventanas = ventanas;

function ventanaDe(clave: string): Ventana {
  let v = ventanas.get(clave);
  if (!v) {
    v = {
      pm: [],
      pulsos: [],
      ultimoVoltaje: null,
      ultimoT: null,
      ultimaZona: null,
      avisoBateria: false,
      avisoPm: false,
      atascoAvisado: false,
    };
    ventanas.set(clave, v);
  }
  return v;
}

export function reiniciarVentana(clave: string): void {
  ventanas.delete(clave);
}

/** Dirección de escape: se gira hacia el lado con más espacio libre. */
function direccionEvasion(izq: number, der: number): "IZQUIERDA" | "DERECHA" {
  return izq >= der ? "IZQUIERDA" : "DERECHA";
}

export function evaluar(
  clave: string,
  m: MuestraEvaluable,
  cfg: ConfigUmbrales,
): EventoDetectado[] {
  const v = ventanaDe(clave);
  const eventos: EventoDetectado[] = [];
  const dt = v.ultimoT ? (m.t.getTime() - v.ultimoT) / 1000 : 1 / cfg.telemetriaHz;

  // --- Obstáculo frontal y su maniobra de evasión -------------------------
  if (m.distanciaFrontalCm < cfg.umbralFrontalCm) {
    eventos.push({
      tipo: "OBSTACULO_DETECTADO",
      severidad: m.distanciaFrontalCm < 10 ? "ADVERTENCIA" : "INFO",
      sensor: "FRONTAL",
      valor: m.distanciaFrontalCm,
      unidad: "cm",
      accion: "Frenado y giro",
      detalle: { velocidadMs: m.velocidadMs },
    });
    const dir = direccionEvasion(m.distanciaIzquierdaCm, m.distanciaDerechaCm);
    // Ángulo estimado por odometría: ω ≈ 2·v / distancia entre ejes,
    // integrado durante la duración de giro configurada. Sin IMU no hay más.
    const anguloEstimado = ((2 * Math.max(m.velocidadMs, 0.1)) / 0.15) * cfg.duracionGiroS;
    eventos.push({
      tipo: "MANIOBRA_EVASION",
      severidad: "INFO",
      sensor: dir === "IZQUIERDA" ? "IZQUIERDO" : "DERECHO",
      valor: (anguloEstimado * 180) / Math.PI,
      unidad: "grados",
      accion: dir === "IZQUIERDA" ? "Giro a la izquierda" : "Giro a la derecha",
      detalle: {
        direccion: dir,
        duracionS: cfg.duracionGiroS,
        anguloEstimadoRad: anguloEstimado,
        exito: Math.max(m.distanciaIzquierdaCm, m.distanciaDerechaCm) > cfg.umbralLateralCm,
      },
    });
  }

  // --- Obstáculo lateral --------------------------------------------------
  const lateralMin = Math.min(m.distanciaIzquierdaCm, m.distanciaDerechaCm);
  if (lateralMin < cfg.umbralLateralCm) {
    eventos.push({
      tipo: "OBSTACULO_DETECTADO",
      severidad: "INFO",
      sensor: m.distanciaIzquierdaCm < m.distanciaDerechaCm ? "IZQUIERDO" : "DERECHO",
      valor: lateralMin,
      unidad: "cm",
      accion: "Corrección de rumbo",
    });
  }

  // --- Zona sucia: pico de PM sobre la media móvil ------------------------
  if (esZonaSucia(m.densidadPolvoMgM3, v.pm, cfg.factorZonaSucia)) {
    eventos.push({
      tipo: "ZONA_SUCIA_DETECTADA",
      severidad: "INFO",
      sensor: "POLVO",
      valor: m.densidadPolvoMgM3,
      unidad: "mg/m3",
      accion: cfg.segundaPasada ? "Segunda pasada" : "Registrada",
      detalle: { segundaPasada: cfg.segundaPasada },
    });
  }
  v.pm.push(m.densidadPolvoMgM3);
  if (v.pm.length > 60) v.pm.shift();

  // --- PM por encima del máximo tolerado ----------------------------------
  if (m.densidadPolvoMgM3 > cfg.pmMaxTolerado) {
    if (!v.avisoPm) {
      v.avisoPm = true;
      eventos.push({
        tipo: "ZONA_SUCIA_DETECTADA",
        severidad: "ADVERTENCIA",
        sensor: "POLVO",
        valor: m.densidadPolvoMgM3,
        unidad: "mg/m3",
        accion: "PM sobre el maximo tolerado",
      });
    }
  } else {
    v.avisoPm = false;
  }

  // --- Atasco y rueda trabada --------------------------------------------
  v.pulsos.push(m.pulsosIzq + m.pulsosDer);
  if (v.pulsos.length > 40) v.pulsos.shift();
  // Con telemetría entrante se asume que los motores están comandados ON:
  // el ESP32 solo publica a 2 Hz mientras hay sesión activa.
  if (estaAtascado(true, v.pulsos, 1 / cfg.telemetriaHz)) {
    if (!v.atascoAvisado) {
      v.atascoAvisado = true;
      eventos.push({
        tipo: "ATASCADO",
        severidad: "CRITICO",
        sensor: "ENCODERS",
        valor: 0,
        unidad: "pulsos",
        accion: "Sesion detenida",
      });
    }
  } else {
    v.atascoAvisado = false;
  }

  const trabada = ruedaTrabada(m.pulsosIzq, m.pulsosDer);
  if (trabada) {
    eventos.push({
      tipo: "RUEDA_TRABADA",
      severidad: "ADVERTENCIA",
      sensor: trabada === "IZQUIERDA" ? "ENCODER_IZQ" : "ENCODER_DER",
      valor: trabada === "IZQUIERDA" ? m.pulsosIzq : m.pulsosDer,
      unidad: "pulsos",
      accion: "Maniobra de liberacion",
      detalle: { rueda: trabada },
    });
  }

  // --- Batería ------------------------------------------------------------
  if (m.bateriaPct !== undefined) {
    if (m.bateriaPct <= cfg.bateriaBajaPct && !v.avisoBateria) {
      v.avisoBateria = true;
      eventos.push({
        tipo: "BATERIA_BAJA",
        severidad: m.bateriaPct <= cfg.bateriaRetornoPct ? "ADVERTENCIA" : "INFO",
        sensor: "BATERIA",
        valor: m.bateriaPct,
        unidad: "%",
        accion: m.bateriaPct <= cfg.bateriaRetornoPct ? "Retorno a base" : "Aviso",
      });
    }
    if (m.bateriaPct > cfg.bateriaBajaPct + 5) v.avisoBateria = false;
  }

  // --- Caída de tensión anómala (sustituye al sensor de corriente) --------
  if (m.voltaje !== undefined) {
    if (
      v.ultimoVoltaje !== null &&
      caidaTensionAnomala(v.ultimoVoltaje, m.voltaje, dt, cfg.caidaTensionVPorMin)
    ) {
      eventos.push({
        tipo: "CAIDA_TENSION_ANOMALA",
        severidad: "ADVERTENCIA",
        sensor: "BATERIA",
        valor: m.voltaje,
        unidad: "V",
        accion: "Revisar cepillo",
        detalle: { voltajeAnterior: v.ultimoVoltaje, deltaS: dt },
      });
    }
    v.ultimoVoltaje = m.voltaje;
  }

  // --- Cambio de zona WiFi ------------------------------------------------
  if (m.zonaWifi && v.ultimaZona && m.zonaWifi !== v.ultimaZona) {
    eventos.push({
      tipo: "CAMBIO_DE_ZONA_WIFI",
      severidad: "INFO",
      sensor: "WIFI",
      accion: v.ultimaZona + " -> " + m.zonaWifi,
      detalle: { desde: v.ultimaZona, hasta: m.zonaWifi },
    });
  }
  if (m.zonaWifi) v.ultimaZona = m.zonaWifi;

  v.ultimoT = m.t.getTime();
  return eventos;
}
