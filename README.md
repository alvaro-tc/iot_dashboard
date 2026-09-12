# Primera Evaluación IoT

Plataforma que recibe, almacena y visualiza en tiempo real series numéricas de aproximación
(π, ln 2, γ, π²/6…) enviadas por ESP32-S3 vía MQTT.

```
ESP32 / simulador ──MQTT──▶ Mosquitto (usuario + ACL por dispositivo)
                              │ telemetry/{userId}/{seriesKey}
                              ▼
                     apps/api  puente MQTT ─▶ lógica de sesiones ─▶ Postgres
                              │                                   (transacción)
                              ▼
                     WebSocket /ws  (filtrado por rol) ─▶ apps/web
```

| Carpeta | Qué contiene |
|---|---|
| `packages/shared` | Las 7 series, `computeTerm`, precisión decimal (`DECIMALS`, `fmt`) y formato de topics. Única fuente de verdad. |
| `apps/api` | Express + `mqtt` + `pg` + `ws`. SQL directo, sin ORM. |
| `apps/web` | React 18 + Vite + Tailwind + Recharts. |
| `mosquitto/` | Configuración del broker. `passwd` y `acl` los escribe la API. |

## Puesta en marcha

Requisitos: Node 20.19+, pnpm 10, Docker.

```bash
cp .env.example .env        # en Windows: copy .env.example .env
docker compose up -d        # Postgres (puerto 5433) y Mosquitto (1883)
pnpm install
pnpm db:reset               # esquema + seed + muestras de historial + credenciales MQTT de demo
pnpm dev                    # API en :4000 y web en http://localhost:5173
```

La API necesita el CLI de `docker` en el PATH: al vincular o revocar un ESP32 escribe
`mosquitto/passwd` y `mosquitto/acl` y recarga el broker con `docker kill -s HUP mosquitto`.

Otros scripts: `pnpm build`, `pnpm lint` (typecheck de ambas apps + autocomprobaciones de
`shared` y del submuestreo).

## Credenciales de prueba

| Rol | Correo | Contraseña | Notas |
|---|---|---|---|
| Admin | `admin@demo.com` | `admin123` | |
| Cliente | `alvaro@demo.com` | `cliente123` | ESP32 vinculado; historial de hoy 08:00–09:40 Leibniz, 09:40–10:00 Wallis, 14:00–14:30 Basilea |
| Cliente | `maria@demo.com` | `cliente123` | Sin dispositivo: puede usar el simulador |
| Cliente | `jorge@demo.com` | `cliente123` | ESP32 vinculado, sin envíos |

Dispositivos de demo (el seed guarda solo el hash; `db:reset` registra el token en Mosquitto):

| Dispositivo | Usuario MQTT | Token |
|---|---|---|
| Sensor laboratorio (Álvaro, userId 2) | `esp32-alvaro01` | `AlvaroDemoToken0123456789abcdefg` |
| Placa de pruebas (Jorge, userId 4) | `esp32-jorge001` | `JorgeDemoToken0123456789abcdefgh` |

## Simular un ESP32 a mano

Con el panel de Álvaro abierto como admin (`/admin/usuarios/2`), publica muestras de Leibniz:

```bash
# Una muestra
docker exec mosquitto mosquitto_pub -h localhost -u esp32-alvaro01 -P AlvaroDemoToken0123456789abcdefg \
  -t telemetry/2/pi_leibniz \
  -m '{"iteration":1,"value":4.0000000000,"deviceId":"esp32-alvaro01"}'
```

Un envío continuo desde bash (valores reales de Leibniz, una muestra cada 200 ms):

```bash
acc=0; for k in $(seq 1 500); do
  acc=$(awk -v a="$acc" -v k="$k" 'BEGIN{ s=(k%2)?1:-1; printf "%.10f", a + 4*s/(2*k-1) }')
  docker exec mosquitto mosquitto_pub -h localhost -u esp32-alvaro01 -P AlvaroDemoToken0123456789abcdefg \
    -t telemetry/2/pi_leibniz -m "{\"iteration\":$k,\"value\":$acc,\"deviceId\":\"esp32-alvaro01\"}"
  sleep 0.2
done
```

Si tienes `mosquitto_pub` instalado en el equipo, quita `docker exec mosquitto` y usa `-h localhost -p 1883`.

Qué comprobar: la ACL rechaza publicar en `telemetry/3/...` con las credenciales de Álvaro; volver a
empezar en `iteration: 1` cierra la sesión y abre otra; cambiar de serie también; tras 2 minutos sin
muestras el barredor cierra la sesión con `ended_at` = hora de la última muestra.

## Payload y topics

- Topic: `telemetry/{userId}/{seriesKey}`
- Payload: `{ "iteration": 42, "value": 3.1571052761, "deviceId": "esp32-7f3a9c2b", "ts": 1757600000 }`
  (`deviceId` lo envía el ESP32; el simulador web no). El ESP32 usa `double` y `%.10f`.

## Decisiones

- **Credenciales MQTT por dispositivo** (usuario + contraseña propios y ACL a `telemetry/{userId}/+`):
  permiten revocar un solo dispositivo y que ninguno suplante a otro cliente, con un firmware trivial.
  mTLS sería lo correcto en producción, pero exige gestionar un certificado por placa. El hash del
  `passwd` se calcula en Node con el mismo formato que `mosquitto_passwd` (`$7$`, PBKDF2-SHA512), para
  no depender de `docker exec` sobre un archivo montado. Ver `apps/api/src/mqtt/broker-credentials.ts`.
- **Sesiones inferidas en el backend** dentro de una transacción que bloquea la fila del usuario, con el
  índice único parcial `uniq_active_run_per_user` como garantía final. Ver `apps/api/src/runs.ts`.
- **Restricción del cliente en el servidor**: los endpoints `/api/client/*` no seleccionan columnas
  numéricas y el WebSocket construye los eventos de cliente por lista blanca. Ver `apps/api/src/ws.ts`.
- **Tiempo real sin polling**: `useLiveSamples` se suscribe antes de cargar el histórico, encola, deduplica
  por `sample.id`, aplica lotes cada 100 ms y recarga al reconectar. Ver `apps/web/src/hooks/useLiveSamples.ts`.

## Variables de entorno

Documentadas en `.env.example`. Todas se leen del `.env` de la raíz (la web usa `envDir: '../..'`).
