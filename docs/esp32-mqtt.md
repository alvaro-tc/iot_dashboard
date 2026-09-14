# Conectar un ESP32 por MQTT

## 1. Vincula el dispositivo en la web

1. Entra a la app web como cliente → **Mi dispositivo** → **Vincular ESP32**.
2. Copia el bloque de configuración que aparece (`DEVICE_ID`, `DEVICE_TOKEN`, `MQTT_HOST`, `MQTT_PORT`, `MQTT_TOPIC`). **El token solo se muestra una vez.**
3. Si lo pierdes: revoca el dispositivo y vincula uno nuevo (genera token distinto).

`MQTT_HOST` sale de `MQTT_PUBLIC_HOST` en el `.env` del backend — debe ser la IP de tu PC en la LAN (`192.168.x.x`), no `localhost`. Si el ESP32 no puede resolver el host, revisa esa variable.

## 2. Firmware (PubSubClient)

```cpp
#include <WiFi.h>
#include <PubSubClient.h>

#define WIFI_SSID     "tu-red"
#define WIFI_PASS     "tu-clave"

#define DEVICE_ID     "..."   // del panel web
#define DEVICE_TOKEN  "..."   // del panel web
#define MQTT_HOST     "192.168.1.100"
#define MQTT_PORT     1883
#define MQTT_TOPIC    "telemetry/<userId>/pi_leibniz"

WiFiClient net;
PubSubClient mqtt(net);

void connectAll() {
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(300);

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  while (!mqtt.connected()) {
    // usuario = DEVICE_ID, contraseña = DEVICE_TOKEN
    if (mqtt.connect(DEVICE_ID, DEVICE_ID, DEVICE_TOKEN)) break;
    delay(1000);
  }
}

void loop() {
  if (!mqtt.connected()) connectAll();
  mqtt.loop();

  static int k = 0;
  double value = /* tu cálculo */ 0.0;
  char buf[128];
  snprintf(buf, sizeof buf, "{\"iteration\":%d,\"value\":%.10f,\"deviceId\":\"%s\"}", k++, value, DEVICE_ID);
  mqtt.publish(MQTT_TOPIC, buf);
  delay(1000);
}
```

Puntos que rompen la conexión si fallan:

- **Usuario/contraseña**: `mqtt.connect(clientId, user, pass)` — el 2º y 3er argumento son obligatorios. Sin ellos, Mosquitto rechaza la conexión (`allow_anonymous false`).
- **Topic exacto**: debe ser `telemetry/{userId}/{seriesKey}`, con el `userId` numérico que te dio el panel. Si publicas en otro topic, la ACL lo bloquea (el dispositivo solo tiene `write telemetry/{userId}/+`).
- **`seriesKey`** solo admite `[a-z0-9_]+` (ver `packages/shared/src/topics.ts`).
- **Payload JSON**: `value` como número (double), no string; `deviceId` debe coincidir con `DEVICE_ID`.
- **Buffer de PubSubClient**: si tu payload supera 256 bytes, agranda con `mqtt.setBufferSize(512)` antes de conectar.

## 3. Verificar que llega

- En el panel web, "Mi dispositivo" debe mostrar **en línea** y actualizar "Última vez visto".
- Desde el servidor: `docker logs mosquitto` para ver conexiones/rechazos, o `docker exec -it mosquitto mosquitto_sub -u iot-backend -P <MQTT_ADMIN_PASS> -t 'telemetry/#' -v`.
- Rechazo de conexión (`rc=5` / `Connection refused: not authorized`) = usuario o token incorrectos, o dispositivo revocado.
- Conecta pero no llegan datos = topic mal formado o ACL no permite ese topic (revisa `userId` en el topic vs. el token).
- No conecta en absoluto = revisa `MQTT_HOST`/`MQTT_PORT`, firewall del PC (puerto 1883 abierto en la LAN), y que el ESP32 y el PC estén en la misma red.
