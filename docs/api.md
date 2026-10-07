# API

Base: `http://localhost:4000`. Todo bajo `/api`. Autenticación por **JWT propio** en
`Authorization: Bearer <token>`, salvo donde se indique.

## Autenticación

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/api/auth/signup` | Alta. `{name, email, password, confirm}` → `{token, user}` |
| POST | `/api/auth/login` | `{email, password}` → `{token, user}` |
| GET | `/api/me` | El usuario de la sesión |
| PATCH | `/api/me` | Cambiar nombre y contraseña |

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"alvaro@demo.com","password":"cliente123"}' | jq -r .token)
```

## Robots

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/dispositivos` | Los robots del usuario |
| POST | `/api/dispositivos` | Alta. Devuelve la **contraseña MQTT una sola vez** |
| PATCH | `/api/dispositivos/:id` | Nombre y ubicación |
| POST | `/api/dispositivos/:id/regenerar-clave` | Contraseña MQTT nueva |
| DELETE | `/api/dispositivos/:id` | Baja: cierra su sesión y lo quita de Mosquitto |

```bash
curl -s -X POST http://localhost:4000/api/dispositivos \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"nombre":"Roomba Dormitorio","ubicacion":"Dormitorio"}'
```

```json
{
  "dispositivo": { "id": "roomba-3f9a2c7b", "nombre": "Roomba Dormitorio", "...": "..." },
  "token": "V1StGXR8_Z5jdHi6B-myT_la_contrasena_mqtt",
  "config": { "modo": "detenido", "distanciaEvasionCm": 15, "...": "..." },
  "broker": { "host": "192.168.1.100", "port": 1883 }
}
```

## Lecturas

| Método | Ruta | Parámetros |
|---|---|---|
| GET | `/api/dispositivos/:id/lecturas` | `desde`, `hasta`, `agregacion=raw\|minuto\|hora`, `limite` |
| GET | `/api/dispositivos/:id/lecturas/export.csv` | Los mismos. Devuelve CSV |

```bash
# Crudas de la última hora
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4000/api/dispositivos/roomba-sala/lecturas?limite=500"

# Agregado por hora de los últimos 7 días
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4000/api/dispositivos/roomba-sala/lecturas?agregacion=hora&desde=2026-10-01T00:00:00Z"

# Exportar a CSV
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4000/api/dispositivos/roomba-sala/lecturas/export.csv" -o lecturas.csv
```

`agregacion=raw` devuelve las **más recientes** hasta `limite`, en orden temporal ascendente.
`minuto` y `hora` leen de las vistas `v_lecturas_por_minuto` y `v_lecturas_por_hora`.

## Sesiones

| Método | Ruta | Qué devuelve |
|---|---|---|
| GET | `/api/dispositivos/:id/sesiones` | Resumen de cada sesión (`v_resumen_sesion`) |
| GET | `/api/sesiones/:id/lecturas` | Todas las lecturas de la sesión, por `secuencia` |
| GET | `/api/sesiones/:id/mapa` | Trayectoria + obstáculos proyectados. `?puntos=3000` |

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4000/api/sesiones/12/mapa?puntos=800"
```

```json
[
  {
    "secuencia": 1,
    "medido_en": "2026-10-07T12:32:00.000Z",
    "x": "0.0", "y": "0.0", "theta": "0.0",
    "estado_movimiento": "avanzando",
    "bateria_pct": 97,
    "obstaculos": [{ "sensor": "izq", "d": 42.1, "x": "41.7", "y": "-41.7" }]
  }
]
```

## Eventos

| Método | Ruta | Parámetros |
|---|---|---|
| GET | `/api/dispositivos/:id/eventos` | `tipo`, `sensor`, `atendido`, `pagina` (50 por página) |
| PATCH | `/api/eventos/:id/atender` | `{atendido: true}` |

## Configuración

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/dispositivos/:id/configuracion` | La configuración vigente |
| PATCH | `/api/dispositivos/:id/configuracion` | Cambio parcial. **Publica `config` retenido**, el robot lo recibe al instante |

```bash
curl -s -X PATCH http://localhost:4000/api/dispositivos/roomba-sala/configuracion \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"distanciaEvasionCm":20,"distanciaPrecaucionCm":40}'
```

## Estadísticas y salud

| Método | Ruta | Qué devuelve |
|---|---|---|
| GET | `/api/dispositivos/:id/resumen` | Tiempo en marcha hoy, distancia, evasiones por sensor, latencia, batería, mensajes/s y la sesión activa |
| GET | `/api/salud` | Estado de Postgres y Mosquitto, tamaño del buffer de persistencia y clientes WebSocket |

```bash
curl -s http://localhost:4000/api/salud
# {"ok":true,"postgres":true,"mosquitto":true,"bufferPersistencia":0,"clientesWebSocket":2}
```

## Ingesta REST (para el firmware)

`POST /api/ingesta` es el camino alternativo a MQTT, el que usa el firmware con
`MODO_ENVIO = "rest"`. **No usa el JWT de usuario**: el robot se identifica con su propia
contraseña MQTT.

```bash
curl -s -X POST http://localhost:4000/api/ingesta \
  -H 'Authorization: Bearer SalaDemoToken0123456789abcdefgh' \
  -H 'Content-Type: application/json' \
  -d '{
        "dispositivoId": "roomba-sala",
        "lecturas": [{
          "seq": 1, "t": 1739980800000, "d": [40, null, 25], "e": "avanzando",
          "x": 0, "y": 0, "th": 0, "vi": 60, "vd": 60, "bv": 8.1, "rssi": -55
        }]
      }'
# {"recibidas":1,"aceptadas":1}
```

Las lecturas siguen exactamente el mismo camino que las de MQTT: se emiten por WebSocket
antes de tocar la base de datos y luego entran en el buffer de persistencia.

## Administración

Requieren rol `admin`.

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/admin/resumen` | Totales de la flota y sesiones en curso |
| GET | `/api/admin/robots` | Todos los robots, de todos los usuarios |
| GET/POST | `/api/admin/users` | Listar y crear cuentas |
| GET/PATCH/DELETE | `/api/admin/users/:id` | Ver, editar y eliminar |
| GET | `/api/admin/users/:id/robots` | Los robots de ese usuario |
| POST | `/api/admin/users/:id/password` | Contraseña nueva, se muestra una vez |
| DELETE | `/api/admin/users/:id/datos` | Borra su historial sin borrar la cuenta |

---

# Socket.IO

Namespace **`/live`**. El JWT va en el handshake.

```js
import { io } from 'socket.io-client';
const socket = io('http://localhost:4000/live', { auth: { token: TOKEN } });
```

Sin token válido, la conexión se rechaza con `unauthorized`. Cada robot tiene su **sala**
`robot:{id}`: la telemetría de un robot no viaja a navegadores que están mirando otro.

## Cliente → servidor

| Evento | Carga | Respuesta (ack) |
|---|---|---|
| `unirse` | `"roomba-sala"` | `{ok, estado, config, historial}` — las últimas 50 lecturas, para que el mapa no arranque vacío |
| `salir` | `"roomba-sala"` | — |
| `comando` | `{dispositivoId, accion}` | `{ok, id, confirmado, modo}` |
| `actualizar_config` | `{dispositivoId, cambio}` | `{ok, config}` |
| `sincronizar_reloj` | `Date.now()` | `{enviadoEn, servidor}` |

`confirmado: false` significa que el robot no contestó al `cmd/ack` en 2 s: el comando salió,
pero nadie lo recogió.

`sincronizar_reloj` existe porque la latencia que muestra el dashboard es `Date.now() - t`,
y sin corregir el desfase entre el reloj del navegador y el del servidor ese número mediría
la diferencia de relojes en vez de la latencia.

## Servidor → cliente

| Evento | Carga |
|---|---|
| `telemetria` | Una `Lectura` normalizada (ver `@iot/shared`) |
| `evento` | `{tipo, sensor, distanciaCm, posXCm, posYCm, mensaje, creadoEn}` |
| `estado` | `{enLinea, versionFirmware, ultimoContacto}` |
| `config` | La configuración completa tras un cambio |
| `comando_ack` | `{id, confirmado}` |

## El orden importa

```
MQTT → validar → emitir por Socket.IO → contadores → eventos → cola de persistencia
                 ╰─ aquí, antes de tocar Postgres
```

Emitir **antes** de persistir es lo que mantiene la latencia del mapa por debajo de 300 ms
aunque la base de datos esté lenta o caída.
