/** Constantes físicas del prototipo y valores por defecto de calibración. */

export const HARDWARE = {
  /** Disco ranurado HC020K de 20 ranuras sobre rueda de 65 mm de diámetro:
   *  perímetro = π · 65 mm ≈ 204.2 mm → 204.2 / 20 ≈ 10.2 mm por pulso. */
  mmPorPulso: 10.2,
  /** Separación entre ruedas, usada en la odometría diferencial. */
  distanciaEjesMm: 150,
  /** Ancho barrido por el cepillo, usado para estimar área cubierta. */
  anchoCepilloM: 0.18,
  /** Pulsos necesarios para recorrer 1 m: 1000 / 10.2 ≈ 98.04 */
  pulsosPorMetro: 1000 / 10.2,
} as const;

export const SENALES = [
  "DIST_FRONTAL",
  "DIST_IZQ",
  "DIST_DER",
  "POLVO",
  "COBERTURA",
  "RSSI",
] as const;
export type Senal = (typeof SENALES)[number];

export const ETIQUETA_SENAL: Record<Senal, string> = {
  DIST_FRONTAL: "Distancia frontal",
  DIST_IZQ: "Distancia izquierda",
  DIST_DER: "Distancia derecha",
  POLVO: "Densidad de polvo",
  COBERTURA: "Cobertura",
  RSSI: "RSSI",
};

export const UNIDAD_SENAL: Record<Senal, string> = {
  DIST_FRONTAL: "cm",
  DIST_IZQ: "cm",
  DIST_DER: "cm",
  POLVO: "mg/m³",
  COBERTURA: "m²",
  RSSI: "dBm",
};

export const COLOR_SENAL: Record<Senal, string> = {
  DIST_FRONTAL: "var(--sensor-frontal)",
  DIST_IZQ: "var(--sensor-izq)",
  DIST_DER: "var(--sensor-der)",
  POLVO: "var(--polvo)",
  COBERTURA: "var(--bateria)",
  RSSI: "var(--text-muted)",
};

export const MODOS = [
  "EN_BASE",
  "LIMPIANDO",
  "PAUSADO",
  "CARGANDO",
  "ATASCADO",
  "OFFLINE",
] as const;
export type Modo = (typeof MODOS)[number];

export const ETIQUETA_MODO: Record<Modo, string> = {
  EN_BASE: "En base",
  LIMPIANDO: "Limpiando",
  PAUSADO: "Pausado",
  CARGANDO: "Cargando",
  ATASCADO: "Atascado",
  OFFLINE: "Sin conexión",
};

export const SEVERIDADES = ["INFO", "ADVERTENCIA", "CRITICO"] as const;
export type Severidad = (typeof SEVERIDADES)[number];

export const TIPOS_EVENTO = [
  "OBSTACULO_DETECTADO",
  "MANIOBRA_EVASION",
  "ZONA_SUCIA_DETECTADA",
  "ATASCADO",
  "RUEDA_TRABADA",
  "BATERIA_BAJA",
  "CAIDA_TENSION_ANOMALA",
  "CAMBIO_DE_ZONA_WIFI",
  "RECONEXION_WIFI",
  "SESION_INICIADA",
  "SESION_FINALIZADA",
] as const;
export type TipoEvento = (typeof TIPOS_EVENTO)[number];

export const ETIQUETA_EVENTO: Record<TipoEvento, string> = {
  OBSTACULO_DETECTADO: "Obstáculo detectado",
  MANIOBRA_EVASION: "Maniobra de evasión",
  ZONA_SUCIA_DETECTADA: "Zona sucia detectada",
  ATASCADO: "Atascado",
  RUEDA_TRABADA: "Rueda trabada",
  BATERIA_BAJA: "Batería baja",
  CAIDA_TENSION_ANOMALA: "Caída de tensión anómala",
  CAMBIO_DE_ZONA_WIFI: "Cambio de zona WiFi",
  RECONEXION_WIFI: "Reconexión WiFi",
  SESION_INICIADA: "Sesión iniciada",
  SESION_FINALIZADA: "Sesión finalizada",
};

export const POTENCIAS = ["ECO", "NORMAL", "TURBO"] as const;
export type Potencia = (typeof POTENCIAS)[number];

export const PATRONES = ["ZIGZAG", "ESPIRAL", "PERIMETRO", "ALEATORIO"] as const;
export type Patron = (typeof PATRONES)[number];

export const ETIQUETA_PATRON: Record<Patron, string> = {
  ZIGZAG: "Zigzag",
  ESPIRAL: "Espiral",
  PERIMETRO: "Perímetro",
  ALEATORIO: "Aleatorio",
};

export const ZONAS_WIFI = ["CERCA", "MEDIA", "LEJOS"] as const;
export type ZonaWifi = (typeof ZONAS_WIFI)[number];

export const RESULTADOS_SESION = [
  "EN_CURSO",
  "COMPLETADA",
  "BATERIA_BAJA",
  "CANCELADA",
  "ATASCADA",
] as const;
export type ResultadoSesion = (typeof RESULTADOS_SESION)[number];

export const ETIQUETA_RESULTADO: Record<ResultadoSesion, string> = {
  EN_CURSO: "En curso",
  COMPLETADA: "Completada",
  BATERIA_BAJA: "Batería baja",
  CANCELADA: "Cancelada",
  ATASCADA: "Atascada",
};

export const CONSUMIBLES = ["FILTRO", "CEPILLO_LATERAL", "BATERIA"] as const;
export type Consumible = (typeof CONSUMIBLES)[number];

export const ETIQUETA_CONSUMIBLE: Record<Consumible, string> = {
  FILTRO: "Filtro HEPA",
  CEPILLO_LATERAL: "Cepillo lateral",
  BATERIA: "Ciclos de batería",
};

export const DIAS_SEMANA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] as const;

/** Batería 4S Li-ion: 16.8 V a plena carga, 12.0 V vacía. */
export const BATERIA = { vMax: 16.8, vMin: 12.0 } as const;
