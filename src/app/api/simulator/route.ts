import { fail, leerCuerpo, ok } from "@/lib/api";
import { simulatorSchema } from "@/lib/schemas";
import { detener, estadoSimulador, iniciar, simuladorHabilitado } from "@/lib/simulador";

export const dynamic = "force-dynamic";

export async function GET() {
  return ok(estadoSimulador());
}

export async function POST(req: Request) {
  const parsed = await leerCuerpo(req, simulatorSchema);
  if ("respuesta" in parsed) return parsed.respuesta;

  if (!simuladorHabilitado()) {
    return fail(
      409,
      "SIMULADOR_DESHABILITADO",
      "SIMULADOR_ENABLED=false: la app espera datos reales del ESP32",
    );
  }

  if (parsed.datos.accion === "start") iniciar(parsed.datos.velocidad);
  else detener();

  return ok(estadoSimulador());
}
