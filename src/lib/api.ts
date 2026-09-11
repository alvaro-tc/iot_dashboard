/** Utilidades comunes a todas las rutas de la API. */
import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { prisma } from "./db";

export const DEVICE_ID = "robot-1";

export function ok<T>(datos: T, status = 200) {
  return NextResponse.json(datos, { status });
}

/** Todos los errores salen con la misma forma: { error, detalle }. */
export function fail(status: number, error: string, detalle: string) {
  return NextResponse.json({ error, detalle }, { status });
}

/** Valida un cuerpo JSON. Devuelve el dato o una respuesta de error. */
export async function leerCuerpo<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<{ datos: T } | { respuesta: NextResponse }> {
  let crudo: unknown;
  try {
    crudo = await req.json();
  } catch {
    return { respuesta: fail(400, "JSON_INVALIDO", "El cuerpo no es JSON válido") };
  }
  const r = schema.safeParse(crudo);
  if (!r.success) {
    const primero = r.error.issues[0];
    return {
      respuesta: fail(400, "VALIDACION", `${primero.path.join(".")}: ${primero.message}`),
    };
  }
  return { datos: r.data };
}

/** Valida los search params de una URL contra un schema. */
export function leerQuery<T>(
  url: string,
  schema: ZodType<T>,
): { datos: T } | { respuesta: NextResponse } {
  const params = Object.fromEntries(new URL(url).searchParams.entries());
  const r = schema.safeParse(params);
  if (!r.success) {
    const primero = r.error.issues[0];
    return {
      respuesta: fail(400, "VALIDACION", `${primero.path.join(".")}: ${primero.message}`),
    };
  }
  return { datos: r.data };
}

/** Device con su configuración y calibración; las crea si aún no existen. */
export async function getDevice() {
  const existente = await prisma.device.findUnique({
    where: { id: DEVICE_ID },
    include: { config: true, calibracion: true },
  });
  if (existente?.config && existente.calibracion) {
    return existente as typeof existente & {
      config: NonNullable<typeof existente.config>;
      calibracion: NonNullable<typeof existente.calibracion>;
    };
  }
  const creado = await prisma.device.upsert({
    where: { id: DEVICE_ID },
    update: {},
    create: { id: DEVICE_ID },
    include: { config: true, calibracion: true },
  });
  if (!creado.config) await prisma.config.create({ data: { deviceId: DEVICE_ID } });
  if (!creado.calibracion) await prisma.calibracion.create({ data: { deviceId: DEVICE_ID } });
  const final = await prisma.device.findUniqueOrThrow({
    where: { id: DEVICE_ID },
    include: { config: true, calibracion: true },
  });
  return final as typeof final & {
    config: NonNullable<typeof final.config>;
    calibracion: NonNullable<typeof final.calibracion>;
  };
}

export async function getThresholds() {
  return prisma.thresholds.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });
}

/** Sesión abierta (sin fecha de fin), si la hay. */
export function getSesionActiva() {
  return prisma.session.findFirst({
    where: { deviceId: DEVICE_ID, fin: null },
    orderBy: { inicio: "desc" },
  });
}

/** Rango de fechas opcional para las consultas. */
export function rangoFechas(desde?: string, hasta?: string) {
  if (!desde && !hasta) return undefined;
  return {
    ...(desde ? { gte: new Date(desde) } : {}),
    ...(hasta ? { lte: new Date(hasta) } : {}),
  };
}
