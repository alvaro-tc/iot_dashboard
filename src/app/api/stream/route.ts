/**
 * Stream SSE de telemetría, eventos y estado.
 *
 * Cada cliente abre una suscripción al bus en proceso. Se envía un comentario
 * de keep-alive cada 20 s para que los proxies no cierren la conexión.
 */
import { bus, type MensajeStream } from "@/lib/bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let cerrado = false;
      const enviar = (texto: string) => {
        if (cerrado) return;
        try {
          controller.enqueue(encoder.encode(texto));
        } catch {
          cerrado = true;
        }
      };

      enviar(`retry: 3000\n\n`);
      enviar(`event: conectado\ndata: {"ok":true}\n\n`);

      const onMensaje = (m: MensajeStream) => {
        enviar(`event: ${m.tipo}\ndata: ${JSON.stringify(m.datos)}\n\n`);
      };
      bus.on("mensaje", onMensaje);

      const keepAlive = setInterval(() => enviar(`: keep-alive\n\n`), 20_000);

      const limpiar = () => {
        if (cerrado) return;
        cerrado = true;
        clearInterval(keepAlive);
        bus.off("mensaje", onMensaje);
        try {
          controller.close();
        } catch {
          // El cliente ya cerró la conexión.
        }
      };

      req.signal.addEventListener("abort", limpiar);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
