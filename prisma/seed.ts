/**
 * Seed del dashboard: deja la base poblada para que el panel se vea con datos
 * desde el primer arranque.
 *
 * Usa el mismo núcleo de simulación que el generador en vivo
 * (src/lib/simulador/nucleo.ts), así que los datos históricos y los datos que
 * llegan en tiempo real salen del mismo modelo físico.
 */
import { PrismaClient } from "@prisma/client";
import { generarSesion, prng } from "../src/lib/simulador/nucleo";
import { evaluar, reiniciarVentana } from "../src/lib/umbrales";
import { efectividadLimpieza } from "../src/lib/derivados";
import type { Senal } from "../src/lib/constantes";

const prisma = new PrismaClient();

const DEVICE_ID = "robot-1";

/** Señales que se persisten en cada muestra de alta frecuencia. */
const SENALES_RAPIDAS: Senal[] = ["DIST_FRONTAL", "DIST_IZQ", "DIST_DER", "POLVO", "COBERTURA"];

const CFG_UMBRALES = {
  umbralFrontalCm: 20,
  umbralLateralCm: 12,
  duracionGiroS: 0.6,
  factorZonaSucia: 1.5,
  segundaPasada: true,
  bateriaRetornoPct: 20,
  bateriaBajaPct: 20,
  pmMaxTolerado: 0.4,
  caidaTensionVPorMin: 0.06,
  telemetriaHz: 2,
};

type PlanSesion = {
  /** Días hacia atrás desde hoy. */
  diasAtras: number;
  horaInicio: number;
  muestras: number;
  /** Segundos entre muestras: comprime una sesión de ~30 min en pocas muestras. */
  dtS: number;
  bateriaInicial: number;
  resultado: "COMPLETADA" | "BATERIA_BAJA" | "CANCELADA" | "ATASCADA";
  potencia: "ECO" | "NORMAL" | "TURBO";
  patron: "ZIGZAG" | "ESPIRAL" | "PERIMETRO" | "ALEATORIO";
  /** Fracción de la sesión realmente ejecutada (1 = completa). */
  fraccion: number;
};

/** 12 sesiones repartidas en las últimas tres semanas, con resultados variados. */
const PLAN: PlanSesion[] = [
  { diasAtras: 20, horaInicio: 9, muestras: 35, dtS: 52, bateriaInicial: 100, resultado: "COMPLETADA", potencia: "NORMAL", patron: "ZIGZAG", fraccion: 1 },
  { diasAtras: 18, horaInicio: 18, muestras: 35, dtS: 48, bateriaInicial: 96, resultado: "COMPLETADA", potencia: "ECO", patron: "PERIMETRO", fraccion: 1 },
  { diasAtras: 16, horaInicio: 9, muestras: 35, dtS: 55, bateriaInicial: 88, resultado: "BATERIA_BAJA", potencia: "TURBO", patron: "ZIGZAG", fraccion: 0.72 },
  { diasAtras: 14, horaInicio: 11, muestras: 35, dtS: 50, bateriaInicial: 100, resultado: "COMPLETADA", potencia: "NORMAL", patron: "ESPIRAL", fraccion: 1 },
  { diasAtras: 12, horaInicio: 19, muestras: 35, dtS: 45, bateriaInicial: 94, resultado: "CANCELADA", potencia: "NORMAL", patron: "ZIGZAG", fraccion: 0.4 },
  { diasAtras: 10, horaInicio: 8, muestras: 35, dtS: 58, bateriaInicial: 100, resultado: "COMPLETADA", potencia: "TURBO", patron: "ZIGZAG", fraccion: 1 },
  { diasAtras: 9, horaInicio: 15, muestras: 35, dtS: 47, bateriaInicial: 91, resultado: "ATASCADA", potencia: "NORMAL", patron: "ALEATORIO", fraccion: 0.55 },
  { diasAtras: 7, horaInicio: 9, muestras: 35, dtS: 53, bateriaInicial: 100, resultado: "COMPLETADA", potencia: "NORMAL", patron: "ZIGZAG", fraccion: 1 },
  { diasAtras: 5, horaInicio: 20, muestras: 35, dtS: 44, bateriaInicial: 97, resultado: "COMPLETADA", potencia: "ECO", patron: "PERIMETRO", fraccion: 1 },
  { diasAtras: 3, horaInicio: 9, muestras: 35, dtS: 56, bateriaInicial: 100, resultado: "COMPLETADA", potencia: "NORMAL", patron: "ESPIRAL", fraccion: 1 },
  { diasAtras: 2, horaInicio: 17, muestras: 35, dtS: 49, bateriaInicial: 85, resultado: "BATERIA_BAJA", potencia: "TURBO", patron: "ZIGZAG", fraccion: 0.66 },
  { diasAtras: 1, horaInicio: 9, muestras: 35, dtS: 51, bateriaInicial: 100, resultado: "COMPLETADA", potencia: "NORMAL", patron: "ZIGZAG", fraccion: 1 },
];

function fechaDe(diasAtras: number, hora: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - diasAtras);
  d.setHours(hora, Math.floor(Math.random() * 30), 0, 0);
  return d;
}

type FilaTelemetria = {
  sessionId: string;
  timestamp: Date;
  n: number;
  senal: string;
  x: number;
  valorAproximado: number;
  valorReal: number;
  errorAbsoluto: number;
  errorRelativo: number;
  valorFisico: number;
  pulsosIzq: number | null;
  pulsosDer: number | null;
  voltaje: number | null;
  bateriaPct: number | null;
  rssi: number | null;
  velocidadMs: number | null;
  anguloGirado: number | null;
};

type FilaEvento = {
  sessionId: string;
  timestamp: Date;
  tipo: string;
  severidad: string;
  sensor: string | null;
  valor: number | null;
  unidad: string | null;
  accion: string | null;
  detalle: string | null;
};

/**
 * Genera las filas de una sesión: telemetría, eventos y resumen.
 * `maxEventos` recorta los eventos detectados para que el histórico total
 * quede en el orden de magnitud pedido (~180) sin dejar de ser representativo.
 */
function construirSesion(
  sessionId: string,
  inicio: Date,
  muestras: number,
  dtS: number,
  bateriaInicial: number,
  semilla: number,
  maxEventos: number,
) {
  const telemetria: FilaTelemetria[] = [];
  const eventos: FilaEvento[] = [];
  const detectados: FilaEvento[] = [];
  const clave = `seed:${sessionId}`;
  reiniciarVentana(clave);

  let pmInicial: number | null = null;
  let pmFinal = 0;
  let distancia = 0;
  let area = 0;
  let bateriaFinal = bateriaInicial;
  let obstaculos = 0;
  let ultima = inicio;

  for (const m of generarSesion({ inicio, muestras, dtS, bateriaInicial, semilla })) {
    ultima = m.t;
    for (const senal of SENALES_RAPIDAS) {
      const l = m.lecturas[senal];
      telemetria.push({
        sessionId,
        timestamp: m.t,
        n: l.n,
        senal,
        x: l.x,
        valorAproximado: l.valorAproximado,
        valorReal: l.valorReal,
        errorAbsoluto: l.errorAbsoluto,
        errorRelativo: l.errorRelativo,
        valorFisico: l.valorFisico,
        pulsosIzq: senal === "DIST_FRONTAL" ? m.pulsosIzq : null,
        pulsosDer: senal === "DIST_FRONTAL" ? m.pulsosDer : null,
        voltaje: senal === "DIST_FRONTAL" ? m.voltaje : null,
        bateriaPct: senal === "DIST_FRONTAL" ? m.bateriaPct : null,
        rssi: senal === "DIST_FRONTAL" ? m.rssi : null,
        velocidadMs: senal === "DIST_FRONTAL" ? m.velocidadMs : null,
        anguloGirado: senal === "DIST_FRONTAL" ? m.anguloGirado : null,
      });
    }

    // El RSSI es de frecuencia media (cada ~5 s), no de alta frecuencia.
    if (m.indice % 10 === 0) {
      const l = m.lecturas.RSSI;
      telemetria.push({
        sessionId,
        timestamp: m.t,
        n: l.n,
        senal: "RSSI",
        x: l.x,
        valorAproximado: l.valorAproximado,
        valorReal: l.valorReal,
        errorAbsoluto: l.errorAbsoluto,
        errorRelativo: l.errorRelativo,
        valorFisico: l.valorFisico,
        pulsosIzq: null,
        pulsosDer: null,
        voltaje: m.voltaje,
        bateriaPct: m.bateriaPct,
        rssi: m.rssi,
        velocidadMs: null,
        anguloGirado: null,
      });
    }

    const pm = m.lecturas.POLVO.valorFisico;
    if (pmInicial === null) pmInicial = pm;
    pmFinal = pm;
    distancia = m.metrosAcumulados;
    area = m.areaAcumulada;
    bateriaFinal = m.bateriaPct;

    for (const e of evaluar(clave, {
      t: m.t,
      distanciaFrontalCm: m.lecturas.DIST_FRONTAL.valorFisico,
      distanciaIzquierdaCm: m.lecturas.DIST_IZQ.valorFisico,
      distanciaDerechaCm: m.lecturas.DIST_DER.valorFisico,
      densidadPolvoMgM3: pm,
      pulsosIzq: m.pulsosIzq,
      pulsosDer: m.pulsosDer,
      velocidadMs: m.velocidadMs,
      bateriaPct: m.bateriaPct,
      voltaje: m.voltaje,
      zonaWifi: m.zonaWifi,
    }, CFG_UMBRALES)) {
      if (e.tipo === "OBSTACULO_DETECTADO") obstaculos++;
      detectados.push({
        sessionId,
        timestamp: m.t,
        tipo: e.tipo,
        severidad: e.severidad,
        sensor: e.sensor ?? null,
        valor: e.valor ?? null,
        unidad: e.unidad ?? null,
        accion: e.accion ?? null,
        detalle: e.detalle ? JSON.stringify(e.detalle) : null,
      });
    }
  }

  // Se conservan todos los eventos graves y una muestra de los informativos.
  const graves = detectados.filter((e) => e.severidad !== "INFO");
  const infos = detectados.filter((e) => e.severidad === "INFO");
  const rnd = prng(semilla + 7);
  const paso = Math.max(1, Math.ceil(infos.length / Math.max(1, maxEventos - graves.length)));
  eventos.push(...graves, ...infos.filter((_, i) => i % paso === 0 && rnd() > 0.15));

  return {
    telemetria,
    eventos,
    resumen: {
      pmInicial: pmInicial ?? 0,
      pmFinal,
      distancia,
      area,
      bateriaFinal,
      obstaculos,
      fin: ultima,
    },
  };
}

async function main() {
  // Borrado en orden de dependencia.
  await prisma.telemetry.deleteMany();
  await prisma.event.deleteMany();
  await prisma.scheduleRun.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.session.deleteMany();
  await prisma.maintenance.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.config.deleteMany();
  await prisma.calibracion.deleteMany();
  await prisma.thresholds.deleteMany();
  await prisma.device.deleteMany();

  const arranque = new Date();
  arranque.setDate(arranque.getDate() - 21);

  await prisma.device.create({
    data: {
      id: DEVICE_ID,
      nombre: "Roomba UNI",
      modo: "LIMPIANDO",
      bateriaPct: 78,
      voltaje: 15.6,
      rssi: -54,
      zonaWifi: "MEDIA",
      online: true,
      arranqueAt: arranque,
      config: { create: {} },
      calibracion: { create: {} },
    },
  });

  await prisma.thresholds.create({ data: { id: "default" } });

  // Consumibles parcialmente gastados.
  await prisma.maintenance.createMany({
    data: [
      { deviceId: DEVICE_ID, consumible: "FILTRO", horasUso: 74.5, horasVida: 120 },
      { deviceId: DEVICE_ID, consumible: "CEPILLO_LATERAL", horasUso: 31.2, horasVida: 80 },
      { deviceId: DEVICE_ID, consumible: "BATERIA", horasUso: 186, horasVida: 500 },
    ],
  });

  let totalTelemetria = 0;
  let totalEventos = 0;

  for (const [i, plan] of PLAN.entries()) {
    const inicio = fechaDe(plan.diasAtras, plan.horaInicio);
    const muestras = Math.max(6, Math.round(plan.muestras * plan.fraccion));
    const sesion = await prisma.session.create({
      data: {
        deviceId: DEVICE_ID,
        inicio,
        potencia: plan.potencia,
        patron: plan.patron,
        bateriaInicial: plan.bateriaInicial,
        resultado: plan.resultado,
      },
    });

    const { telemetria, eventos, resumen } = construirSesion(
      sesion.id,
      inicio,
      plan.muestras,
      plan.dtS,
      plan.bateriaInicial,
      1000 + i * 37,
      10,
    );
    const recorte = telemetria.filter((t) => t.timestamp <= new Date(inicio.getTime() + muestras * plan.dtS * 1000));
    const eventosRecorte = eventos.filter((e) => e.timestamp <= new Date(inicio.getTime() + muestras * plan.dtS * 1000));

    const duracionS = muestras * plan.dtS;
    const fin = new Date(inicio.getTime() + duracionS * 1000);
    const escala = plan.fraccion;

    await prisma.telemetry.createMany({ data: recorte });
    await prisma.event.createMany({
      data: [
        {
          sessionId: sesion.id,
          timestamp: inicio,
          tipo: "SESION_INICIADA",
          severidad: "INFO",
          accion: `Patron ${plan.patron}, potencia ${plan.potencia}`,
        },
        ...eventosRecorte,
        {
          sessionId: sesion.id,
          timestamp: fin,
          tipo: "SESION_FINALIZADA",
          severidad: plan.resultado === "COMPLETADA" ? "INFO" : "ADVERTENCIA",
          accion: plan.resultado,
          detalle: JSON.stringify({ motivo: plan.resultado }),
        },
      ],
    });

    const pmFinal = resumen.pmFinal;
    await prisma.session.update({
      where: { id: sesion.id },
      data: {
        fin,
        duracionS,
        areaM2: resumen.area * escala,
        distanciaM: resumen.distancia * escala,
        pmInicial: resumen.pmInicial,
        pmFinal,
        efectividadPct: efectividadLimpieza(resumen.pmInicial, pmFinal),
        bateriaFinal: resumen.bateriaFinal,
        obstaculos: resumen.obstaculos,
        motivoCierre:
          plan.resultado === "COMPLETADA"
            ? "Cobertura completa"
            : plan.resultado === "BATERIA_BAJA"
              ? "Bateria por debajo del umbral de retorno"
              : plan.resultado === "ATASCADA"
                ? "Encoders sin pulsos con motores activos"
                : "Detenida desde el dashboard",
      },
    });

    totalTelemetria += recorte.length;
    totalEventos += eventosRecorte.length + 2;
  }

  // --- Sesión en curso, para que el modo en vivo tenga algo que mostrar ---
  const inicioActual = new Date(Date.now() - 120 * 4 * 1000);
  const actual = await prisma.session.create({
    data: {
      deviceId: DEVICE_ID,
      inicio: inicioActual,
      potencia: "NORMAL",
      patron: "ZIGZAG",
      bateriaInicial: 100,
      resultado: "EN_CURSO",
    },
  });
  const viva = construirSesion(actual.id, inicioActual, 120, 4, 100, 4242, 16);
  await prisma.telemetry.createMany({ data: viva.telemetria });
  await prisma.event.createMany({
    data: [
      {
        sessionId: actual.id,
        timestamp: inicioActual,
        tipo: "SESION_INICIADA",
        severidad: "INFO",
        accion: "Patron ZIGZAG, potencia NORMAL",
      },
      ...viva.eventos,
    ],
  });
  await prisma.session.update({
    where: { id: actual.id },
    data: {
      areaM2: viva.resumen.area,
      distanciaM: viva.resumen.distancia,
      pmInicial: viva.resumen.pmInicial,
      pmFinal: viva.resumen.pmFinal,
      efectividadPct: efectividadLimpieza(viva.resumen.pmInicial, viva.resumen.pmFinal),
      obstaculos: viva.resumen.obstaculos,
    },
  });
  await prisma.device.update({
    where: { id: DEVICE_ID },
    data: {
      bateriaPct: viva.resumen.bateriaFinal,
      ultimaConexion: new Date(),
    },
  });
  totalTelemetria += viva.telemetria.length;
  totalEventos += viva.eventos.length + 1;

  // --- Alertas activas y resueltas ---------------------------------------
  await prisma.alert.createMany({
    data: [
      {
        tipo: "FILTRO",
        severidad: "ADVERTENCIA",
        mensaje: "El filtro HEPA supera el 60 % de su vida util",
        valor: 74.5,
      },
      {
        tipo: "CAIDA_TENSION_ANOMALA",
        severidad: "ADVERTENCIA",
        mensaje: "Caida de tension por encima de lo esperado: revisar cepillo",
        valor: 0.09,
      },
      {
        tipo: "BATERIA_BAJA",
        severidad: "INFO",
        mensaje: "La sesion del 16/08 termino por bateria baja",
        valor: 19,
        creadaAt: new Date(Date.now() - 16 * 86400000),
        resueltaAt: new Date(Date.now() - 16 * 86400000 + 3600000),
      },
    ],
  });

  // --- Horarios: tres, uno desactivado -----------------------------------
  const horarios = [
    { nombre: "Diaria manana", dias: "1,2,3,4,5", hora: "08:30", potencia: "NORMAL", patron: "ZIGZAG", activo: true, duracionMaxMin: 45 },
    { nombre: "Fin de semana", dias: "0,6", hora: "11:00", potencia: "TURBO", patron: "ESPIRAL", activo: true, duracionMaxMin: 60 },
    { nombre: "Repaso nocturno", dias: "2,4", hora: "22:15", potencia: "ECO", patron: "PERIMETRO", activo: false, duracionMaxMin: 30 },
  ];
  for (const h of horarios) {
    const creado = await prisma.schedule.create({ data: { deviceId: DEVICE_ID, ...h } });
    // Historial de cumplimiento de las últimas dos semanas.
    const runs = [];
    for (let d = 14; d >= 1; d--) {
      const fecha = new Date();
      fecha.setDate(fecha.getDate() - d);
      const [hh, mm] = h.hora.split(":").map(Number);
      fecha.setHours(hh, mm, 0, 0);
      if (!h.dias.split(",").includes(String(fecha.getDay()))) continue;
      const omitida = d % 5 === 0;
      const retrasoS = omitida ? null : Math.floor(Math.random() * 180);
      runs.push({
        scheduleId: creado.id,
        programada: fecha,
        ejecutada: omitida ? null : new Date(fecha.getTime() + (retrasoS ?? 0) * 1000),
        retrasoS,
        resultado: omitida ? "OMITIDA" : "EJECUTADA",
        motivo: omitida ? "Bateria por debajo del minimo configurado" : null,
      });
    }
    if (runs.length) await prisma.scheduleRun.createMany({ data: runs });
  }

  process.stdout.write(
    `Seed listo: ${totalTelemetria} registros de telemetria, ${totalEventos} eventos, ${PLAN.length + 1} sesiones.\n`,
  );
}

main()
  .catch((e) => {
    process.exitCode = 1;
    process.stderr.write(String(e) + "\n");
  })
  .finally(() => prisma.$disconnect());
