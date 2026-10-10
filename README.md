# Roomba — dashboard IoT de un robot aspirador

Robot aspirador doméstico con **ESP32 + MicroPython**: tres sensores ultrasónicos HC-SR04,
tracción diferencial con dos motorreductores, lectura de batería por ADC y un LED de estado.
El dashboard muestra **qué está midiendo y qué están haciendo sus motores, en tiempo real**.

En esta etapa el foco es el **movimiento y la evasión de obstáculos**, no la succión.

```
ESP32 ──MQTT (TLS 8883)──► Mosquitto ──1883 local──► API (Express)
  ▲                                                     │
  │ config retenida                                     ├─ Socket.IO (/live) ─► Dashboard React
  └─────────────────────────────────────────────────────┤
                                                        └─ lotes cada 1 s ──► PostgreSQL
```

## Qué tiene de particular

- **El robot decide solo.** La evasión corre en el ESP32, y las órdenes manuales le llegan
  por ESP-NOW desde su mando. Si se cae el WiFi sigue esquivando muebles: solo deja de
  publicar. El dashboard es de **solo lectura**.
- **El camino en vivo no espera a la base de datos.** Cada lectura se emite por WebSocket
  *antes* de tocar Postgres, y a Postgres va en lotes de un segundo.
- **La base de datos es el JSON del robot.** Lo que publica `firmware/main.py` —distancia de
  cada sensor, PWM con signo de cada rueda y batería— se guarda sin traducir ni derivar nada:
  mismos nombres, misma escala de 0 a 255. El estado de movimiento no se guarda, se deduce de
  las dos ruedas. Campo por campo en [`docs/diseno/bd.md`](docs/diseno/bd.md).

## Arranque rápido (local)

Requisitos: Node.js 22+, pnpm, PostgreSQL y Mosquitto instalados de forma nativa.

```bash
pnpm install
cp .env.example .env          # revisa DATABASE_URL y MQTT_ADMIN_PASS
```

Crea la base de datos:

```bash
psql -U postgres -c "CREATE USER iot WITH PASSWORD 'iot';"
psql -U postgres -c "CREATE DATABASE iot OWNER iot;"
```

Arranca Mosquitto en una terminal (desde la raíz del repo, las rutas del `.conf` son
relativas):

```bash
mosquitto -c mosquitto/mosquitto.conf
```

Esquema y datos de demo:

```bash
pnpm db:reset
```

Esto crea las tablas, genera **siete sesiones de limpieza con trayectorias coherentes** —
simuladas con el mismo motor de física que usa el simulador — y registra las credenciales de
los robots de demo en Mosquitto.

API y dashboard:

```bash
pnpm dev     # API en :4000, dashboard en :5173
```

Y en otra terminal, el robot simulado:

```bash
pnpm simular                  # un robot
pnpm simular -- --robots 3    # los tres del seed a la vez
```

Entra en <http://localhost:5173> con **alvaro@demo.com / cliente123** (o
**admin@demo.com / admin123** para el panel de administración), elige un robot y pulsa el
botón de encendido: el simulador arranca detenido y espera la orden.

## Estructura

```
apps/api/        API: Express + Socket.IO + puente MQTT + persistencia por lotes
apps/web/        Dashboard: React + Vite + Tailwind + Chart.js
packages/shared/ Contratos MQTT, geometría del robot y motor de simulación
simulador/       Robot simulado que publica por MQTT igual que el ESP32
firmware/        MicroPython para el ESP32
infra/           Configuración del VPS: Mosquitto, Caddy, pm2, instalar.sh
mosquitto/       Configuración de Mosquitto para desarrollo local
docs/            Circuito, diagrama ER, API, tópicos MQTT y despliegue
```

## Requisitos de la evaluación ↔ dónde se cumplen

| # | Requisito | Dónde |
|---|---|---|
| 1 | **Circuito del nodo** con mínimo 3 sensores | [`docs/circuito.md`](docs/circuito.md) · [`firmware/sensores.py`](firmware/sensores.py) · tabla de pines en [`firmware/config.example.py`](firmware/config.example.py) |
| 2 | **Base de datos PostgreSQL** con diagrama ER | [`apps/api/db/schema.sql`](apps/api/db/schema.sql) · diagrama en [`docs/diseno/uml-bd.md`](docs/diseno/uml-bd.md) · campo por campo en [`docs/diseno/bd.md`](docs/diseno/bd.md) |
| 3 | **Inserción y lectura vía API REST** | Inserción: `POST /api/ingesta` ([`routes/ingesta.ts`](apps/api/src/routes/ingesta.ts)) y la persistencia por lotes ([`persistencia.ts`](apps/api/src/persistencia.ts)). Lectura: `GET /api/dispositivos/:id/lecturas` y familia ([`routes/datos.ts`](apps/api/src/routes/datos.ts)). Ejemplos `curl` en [`docs/api.md`](docs/api.md) |
| 4 | **Script MicroPython** que lee los sensores y envía los datos | [`firmware/`](firmware/) — `main.py` publica por MQTT; `POST /api/ingesta` acepta lotes por HTTP como alternativa. Justificación de MQTT: [abajo](#por-qué-mqtt-y-no-rest-a-secas) |
| 5 | **Registro y autenticación** | [`routes/auth.ts`](apps/api/src/routes/auth.ts) (bcrypt + JWT), guard HTTP y del WebSocket en [`auth.ts`](apps/api/src/auth.ts) y [`ws.ts`](apps/api/src/ws.ts). Pantallas: [`Login.tsx`](apps/web/src/pages/Login.tsx) y [`Registro.tsx`](apps/web/src/pages/Registro.tsx) |
| 6 | **Dashboard React en tiempo real con Chart.js** | [`apps/web/`](apps/web/) — radar de sensores ([`RadarSensores.tsx`](apps/web/src/components/RadarSensores.tsx)), series de distancia, dona, barras, gauge de batería y heatmap |

## Por qué MQTT y no REST a secas

Los cuatro motivos, en orden de peso:

1. **Latencia.** Una conexión MQTT persistente evita abrir TCP + TLS en cada envío. A 5 Hz,
   el coste de establecer una conexión HTTP por lectura superaría al del dato.
2. **Configuración sin sondeo.** Con REST, el robot tendría que *preguntar* cada pocos
   segundos si su configuración cambió. Con MQTT está suscrito a `config`: el cambio le llega
   en milisegundos y sin tráfico cuando no pasa nada.
3. **Detección de desconexión gratis.** El **Last Will** hace que Mosquitto publique
   `{"en_linea": false}` por el robot si este desaparece. Con REST habría que esperar a que
   venza un timeout para *deducir* lo mismo.
4. **Configuración retenida.** Un robot que arranca recibe su configuración en cuanto se
   suscribe, sin pedirla, y un dashboard que se abre ve el estado actual sin esperar.

Aun así, la API mantiene `POST /api/ingesta`, que acepta lotes de lecturas por HTTP con el
token del robot. Pierde la configuración retenida y la detección de caídas, pero sirve si en
alguna red no se puede usar MQTT.

## Qué se guarda de cada lectura

El robot no tiene GPS ni encoders, así que **no hay posición**: no se puede calcular a bordo
nada que no sea "lo que se les pidió a las ruedas", y eso acumula metros de error en minutos.
En lugar de guardar una posición inventada, la tabla `lecturas` guarda solo lo medido:

| Columna | De dónde sale |
|---|---|
| `distancia_izquierda_cm` · `distancia_central_cm` · `distancia_derecha_cm` | Eco de cada HC-SR04. `NULL` = no volvió: nada dentro del alcance. |
| `movimiento_izquierda` · `movimiento_derecha` | PWM con signo de cada rueda, de −255 a 255 (negativo retrocede). Es el mismo valor que aplica el driver TB6612FNG. |
| `bateria_voltios` · `bateria_porcentaje` | ADC con divisor resistivo; el porcentaje lo calcula el propio robot. |
| `creado_en` | Hora del servidor al recibirla. |

Avanzar, retroceder o girar **se deduce de las dos ruedas** (`movimiento()` en
`@iot/shared`), así que la etiqueta nunca puede contradecir a los motores. El detalle está en
[`docs/diseno/bd.md`](docs/diseno/bd.md).

### Calibración

La batería es el único valor que hay que ajustar al hardware real, en
[`firmware/configuracion.py`](firmware/configuracion.py):

```python
FACTOR_DIVISOR = 2.0          # el real de tu divisor resistivo
VOLTAJE_MIN_BATERIA = 6.0     # pack vacío
VOLTAJE_MAX_BATERIA = 8.4     # pack lleno
```

Compara el `bateria_v` que publica el robot con un multímetro y corrige `FACTOR_DIVISOR`
hasta que coincidan.

## Firmware

```bash
# Instalar MicroPython en la placa
pip install esptool mpremote
esptool.py --port COM3 erase_flash
esptool.py --port COM3 write_flash -z 0x1000 ESP32_GENERIC-*.bin

# Copiar el firmware
cd firmware
cp config.example.py config.py      # rellena WiFi, ROBOT_ID y la contraseña MQTT
mpremote connect COM3 fs cp *.py :
mpremote connect COM3 reset
```

El `ROBOT_ID` y la contraseña te los da el dashboard al pulsar **«Agregar robot»**, junto con
un `config.py` listo para pegar. La contraseña se muestra **una sola vez**: en la base queda
su hash bcrypt y en Mosquitto su hash PBKDF2.

> `firmware/config.py` está en `.gitignore`: lleva la clave del WiFi y la del broker.

## Comprobaciones

```bash
pnpm lint                               # tipos de las tres apps + autocomprobantes
pnpm build                              # compila API y dashboard
node packages/shared/src/robot.check.ts # umbrales, batería, movimiento y simulación
node apps/web/src/lib/metricas.check.ts # lo que cuentan los widgets de uso
```

Los dos autocomprobantes cubren lo que puede romperse en silencio: que avanzar, girar y estar
detenido se lean bien del PWM de las dos ruedas, y que los contadores de tiempo de motor no
inflen el número cuando hay un corte de conexión.

## Despliegue

VPS sin Docker, todo nativo. Paso a paso en [`docs/despliegue.md`](docs/despliegue.md);
`infra/instalar.sh` automatiza la parte de paquetes y permisos.

## Pendiente de definir

Lo que el código deja preparado pero **no inventa**:

- **Modelo exacto del motorreductor y del driver.** Los valores de `config.example.py` son
  provisionales. El driver por defecto es TB6612FNG y cambiar a L298N es una línea
  (`DRIVER = "l298n"`); la correspondencia de pines está en `docs/circuito.md`.
- **Succión y cepillos.** No hay nada: esta etapa es solo movimiento y evasión.
- **Sensores adicionales.** Encoders, giroscopio, sensores de caída y bumper: pines
  reservados e interfaz de odometría intercambiable, pero sin implementación.
- **Estrategia de limpieza.** La máquina de estados actual es reactiva (esquiva lo que
  encuentra). No hay patrones de cobertura —espiral, zigzag, barrido por franjas—, que es lo
  que convertiría la evasión en una limpieza sistemática.
- **Recuperación de contraseña por correo.** El flujo de `/recuperar` necesita un servidor de
  correo que este proyecto no tiene. Mientras tanto, un administrador puede resetear la
  contraseña de un usuario desde el panel.
