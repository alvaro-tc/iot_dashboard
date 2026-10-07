# Protocolo MQTT

Todos los tópicos cuelgan de `roomba/{dispositivoId}/`. El `dispositivoId` es a la vez el
identificador del robot en la base de datos y su **usuario MQTT**, de modo que la ACL puede
atarlo a un único prefijo sin consultar nada.

## Tópicos

| Tópico | Sentido | QoS | Retenido | Contenido |
|---|---|---|---|---|
| `telemetria` | robot → servidor | 0 | No | `{"seq","t","d":[izq,centro,der],"e","x","y","th","vi","vd","bv","rssi"}` |
| `telemetria/lote` | robot → servidor | 1 | No | Arreglo de lecturas diferidas durante un corte |
| `estado` | robot → servidor | 1 | **Sí** | `{"en_linea":true,"firmware":"1.2.0"}` (y Last Will con `false`) |
| `evento` | robot → servidor | 1 | No | Eventos detectados en el robot: `{"tipo","sensor","distancia_cm","mensaje"}` |
| `cmd` | servidor → robot | 1 | No | `{"accion":"iniciar"\|"pausar"\|"detener","id":"uuid"}` |
| `cmd/ack` | robot → servidor | 1 | No | `{"id":"uuid","accion":"iniciar"}` — mismo `id` que el comando |
| `config` | servidor → robot | 1 | **Sí** | Configuración completa vigente |

## Por qué cada QoS

- **`telemetria` con QoS 0.** A 5 Hz, una lectura perdida no cambia nada: la siguiente llega
  en 200 ms. El ack de QoS 1 añadiría una ida y vuelta justo en el camino que queremos
  rápido, y el objetivo es menos de 300 ms de extremo a extremo.
- **`telemetria/lote` con QoS 1.** Estas lecturas ya perdieron su momento en vivo; si no
  llegan, el historial queda con un agujero. Aquí sí merece la pena la confirmación.
- **`cmd`, `cmd/ack`, `evento` y `estado` con QoS 1.** Son hechos puntuales: perder un
  "detener" o una desconexión sí se nota.

## Por qué retenido

`estado` y `config` son **retenidos** porque describen una situación, no un suceso:

- Un dashboard que se abre a las 3 de la tarde necesita saber si el robot está encendido
  **ahora**, sin esperar a que el robot vuelva a publicarlo.
- Un robot que arranca recibe su configuración en cuanto se suscribe, sin pedirla.

## Telemetría: claves cortas

```json
{"seq":1423,"t":1739980800123,"d":[42.1,null,18.7],"e":"girando_izq",
 "x":138.4,"y":-62.0,"th":217.5,"vi":-48,"vd":48,"bv":7.84,"rssi":-57}
```

| Clave | Significado |
|---|---|
| `seq` | Contador de la sesión. Detecta duplicados y, por los huecos, las lecturas perdidas |
| `t` | Epoch **en milisegundos UTC**, del reloj NTP del ESP32 |
| `d` | `[izquierdo, centro, derecho]` en cm. `null` = sin objeto dentro del rango del sensor |
| `e` | `avanzando` \| `girando_izq` \| `girando_der` \| `retrocediendo` \| `detenido` |
| `x`, `y` | Posición en cm desde el origen de la sesión |
| `th` | Orientación en grados, 0–360 |
| `vi`, `vd` | PWM con signo de cada rueda, −100 a 100 |
| `bv` | Voltaje de la batería |
| `rssi` | Señal WiFi en dBm |

Los nombres van abreviados a propósito: con claves largas el JSON casi duplica su tamaño, y
el ESP32 tiene que construirlo en RAM 5 veces por segundo.

## Last Will

El robot registra al conectar:

```
tópico:  roomba/{id}/estado
payload: {"en_linea": false}
qos: 1, retain: true
```

Si el robot se queda sin batería a mitad de limpieza, Mosquitto publica ese mensaje por él.
El servidor se entera en cuestión de segundos sin sondear nada, cierra la sesión abierta y
avisa al dashboard. Es la razón principal por la que este proyecto usa MQTT y no HTTP: con
peticiones REST habría que esperar a un timeout para deducir lo mismo.

## ACL

`apps/api/src/mqtt/broker-credentials.ts` regenera `mosquitto/acl` entera desde la base de
datos en cada cambio. El resultado es:

```
user iot-backend
topic readwrite roomba/#

user roomba-7f3a9c2b
topic readwrite roomba/roomba-7f3a9c2b/#
```

Cada robot solo puede hablar bajo su propio prefijo: no puede publicar telemetría falsa en
nombre de otro ni espiar la de nadie. Dar de baja un robot lo quita del `passwd` y de la
ACL, y Mosquitto recarga con SIGHUP sin cortar las conexiones existentes.

## Probarlo a mano

```bash
# Ver todo lo que publica un robot
mosquitto_sub -h localhost -p 1883 -u iot-backend -P "$MQTT_ADMIN_PASS" -t 'roomba/#' -v

# Mandarle un comando (el robot responde en cmd/ack)
mosquitto_pub -h localhost -p 1883 -u iot-backend -P "$MQTT_ADMIN_PASS" \
  -t 'roomba/roomba-sala/cmd' -q 1 \
  -m '{"accion":"iniciar","id":"prueba-1"}'

# Publicar una lectura como si fueras el robot
mosquitto_pub -h localhost -p 1883 -u roomba-sala -P 'SalaDemoToken0123456789abcdefgh' \
  -t 'roomba/roomba-sala/telemetria' \
  -m '{"seq":1,"t":1739980800000,"d":[40,null,25],"e":"avanzando","x":0,"y":0,"th":0,"vi":60,"vd":60,"bv":8.1,"rssi":-55}'
```
