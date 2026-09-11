/**
 * Puente MQTT — stub listo para conectar cuando exista el prototipo físico.
 *
 * El ESP32 publica sobre MQTT con TLS contra Mosquitto o HiveMQ Cloud:
 *
 *   roomba/telemetry   lote a 2 Hz          -> mismo payload que POST /api/telemetry
 *   roomba/event       por evento           -> se persiste igual que los derivados
 *   roomba/status      retained + Last Will  -> online/offline del dispositivo
 *   roomba/session     resumen al cerrar
 *   roomba/cmd         comandos del dashboard hacia el robot
 *
 * Como el contrato del payload es idéntico al de la ruta HTTP, conectar esto
 * consiste en reenviar el mensaje recibido a POST /api/telemetry. Nada del
 * frontend ni del resto del backend cambia.
 *
 * Para activarlo:
 *   1. npm i mqtt
 *   2. descomentar el bloque de abajo
 *   3. llamar a conectarMqtt() desde src/instrumentation.ts
 *   4. poner SIMULADOR_ENABLED=false en .env
 */

export type OpcionesMqtt = {
  url: string;
  usuario?: string;
  password?: string;
  /** Prefijo de los topics; por defecto "roomba". */
  prefijo?: string;
};

export function conectarMqtt(_opciones: OpcionesMqtt): void {
  throw new Error(
    "Puente MQTT no implementado: instalar el paquete mqtt y descomentar el cuerpo de bridge.stub.ts",
  );
}

/*
import mqtt from "mqtt";

export function conectarMqtt(opciones: OpcionesMqtt): void {
  const prefijo = opciones.prefijo ?? "roomba";
  const cliente = mqtt.connect(opciones.url, {
    username: opciones.usuario,
    password: opciones.password,
    // Last Will: si el ESP32 se cae, el broker publica el offline por él.
    will: {
      topic: `${prefijo}/status`,
      payload: JSON.stringify({ online: false }),
      qos: 1,
      retain: true,
    },
  });

  cliente.on("connect", () => {
    cliente.subscribe([
      `${prefijo}/telemetry`,
      `${prefijo}/event`,
      `${prefijo}/status`,
      `${prefijo}/session`,
    ]);
  });

  cliente.on("message", async (topic, buffer) => {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    // El payload de roomba/telemetry ya cumple el contrato de la ruta HTTP.
    if (topic === `${prefijo}/telemetry`) {
      await fetch(`${base}/api/telemetry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: buffer.toString(),
      });
    }
    // roomba/event, roomba/status y roomba/session se mapearian a sus propias
    // rutas siguiendo el mismo patron.
  });
}
*/
