/**
 * Arranque del proceso servidor.
 *
 * Si el simulador está habilitado y el robot quedó en modo LIMPIANDO, el
 * generador se reanuda solo para que el panel tenga datos en vivo al abrirlo.
 * Con SIMULADOR_ENABLED=false no se carga nada y la app espera al ESP32 real
 * (o al puente MQTT de src/lib/mqtt/bridge.stub.ts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.SIMULADOR_ENABLED === "false") return;

  const { iniciar } = await import("@/lib/simulador");
  const { prisma } = await import("@/lib/db");

  const device = await prisma.device.findUnique({ where: { id: "robot-1" } });
  if (device?.modo === "LIMPIANDO") iniciar();
}
