# Roomba — dashboard IoT de un robot aspirador

Robot aspirador doméstico con **ESP32 + MicroPython**: tres sensores ultrasónicos HC-SR04,
tracción diferencial con dos motorreductores, lectura de batería por ADC y un LED de estado.
El dashboard muestra **dónde está el robot y qué está esquivando, en tiempo real**.

En esta etapa el foco es el **movimiento y la evasión de obstáculos**, no la succión.

```
ESP32 ──MQTT (TLS 8883)──► Mosquitto ──1883 local──► API (Express)
  ▲                                                     │
  │ cmd y config                                        ├─ Socket.IO (/live) ─► Dashboard React
  └─────────────────────────────────────────────────────┤
                                                        └─ lotes cada 1 s ──► PostgreSQL
```

## Qué tiene de particular

- **El robot decide solo.** La evasión corre en el ESP32. Si se cae el WiFi, sigue
  esquivando muebles; solo deja de publicar, y guarda hasta 100 lecturas para reenviarlas.
- **El camino en vivo no espera a la base de datos.** Cada lectura se emite por WebSocket
  *antes* de tocar Postgres. Objetivo: menos de 300 ms desde la medición hasta que el robot
  se mueve en el mapa del navegador. El dashboard la mide y la enseña.
- **El mapa se construye solo.** Cada distancia medida se proyecta desde la pose del robot a
  un punto del plano. Con los minutos, esos puntos dibujan las paredes y los muebles.

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
| 2 | **Base de datos PostgreSQL** con diagrama ER | [`apps/api/db/schema.sql`](apps/api/db/schema.sql) · [`docs/diagrama_er.md`](docs/diagrama_er.md) |
| 3 | **Inserción y lectura vía API REST** | Inserción: `POST /api/ingesta` ([`routes/ingesta.ts`](apps/api/src/routes/ingesta.ts)) y la persistencia por lotes ([`persistencia.ts`](apps/api/src/persistencia.ts)). Lectura: `GET /api/dispositivos/:id/lecturas` y familia ([`routes/datos.ts`](apps/api/src/routes/datos.ts)). Ejemplos `curl` en [`docs/api.md`](docs/api.md) |
| 4 | **Script MicroPython** que lee los sensores y envía los datos | [`firmware/`](firmware/) — `main.py` publica por MQTT; con `MODO_ENVIO = "rest"` envía lotes por HTTP. Justificación de MQTT: [abajo](#por-qué-mqtt-y-no-rest-a-secas) |
| 5 | **Registro y autenticación** | [`routes/auth.ts`](apps/api/src/routes/auth.ts) (bcrypt + JWT), guard HTTP y del WebSocket en [`auth.ts`](apps/api/src/auth.ts) y [`ws.ts`](apps/api/src/ws.ts). Pantallas: [`Login.tsx`](apps/web/src/pages/Login.tsx) y [`Registro.tsx`](apps/web/src/pages/Registro.tsx) |
| 6 | **Dashboard React en tiempo real con Chart.js** | [`apps/web/`](apps/web/) — mapa y radar ([`MapaVivo.tsx`](apps/web/src/components/MapaVivo.tsx), [`RadarSensores.tsx`](apps/web/src/components/RadarSensores.tsx)), series, dona, barras, gauge y heatmap |

## Por qué MQTT y no REST a secas

Los cuatro motivos, en orden de peso:

1. **Latencia.** Una conexión MQTT persistente evita abrir TCP + TLS en cada envío. A 5 Hz,
   el coste de establecer una conexión HTTP por lectura superaría al del dato.
2. **Comandos instantáneos.** Con REST, el robot tendría que *preguntar* cada pocos segundos
   si hay órdenes nuevas. Con MQTT está suscrito: un «detener» desde el dashboard llega en
   milisegundos y sin tráfico de sondeo cuando no pasa nada.
3. **Detección de desconexión gratis.** El **Last Will** hace que Mosquitto publique
   `{"en_linea": false}` por el robot si este desaparece. Con REST habría que esperar a que
   venza un timeout para *deducir* lo mismo.
4. **Configuración retenida.** Un robot que arranca recibe su configuración en cuanto se
   suscribe, sin pedirla, y un dashboard que se abre ve el estado actual sin esperar.

Aun así, el firmware trae `MODO_ENVIO = "rest"`: envía lotes cada segundo contra
`POST /api/ingesta`. Pierde los comandos y la detección de caídas, pero sirve si en alguna
red no se puede usar MQTT.

## La posición del robot: odometría y su error

El robot no tiene GPS ni encoders. Calcula su posición por **dead reckoning**: integra las
ecuaciones de tracción diferencial a partir del PWM que le está dando a cada rueda.

```
v = (v_der + v_izq) / 2
ω = (v_der − v_izq) / distancia_entre_ruedas
θ += ω·dt     x += v·cos(θ)·dt     y += v·sin(θ)·dt
```

**Esto acumula error**, y conviene decirlo claro: no se mide lo que las ruedas giran de
verdad, sino lo que se les pidió. Una rueda que patina, una alfombra, una pila a media carga
o una calibración un 5 % corta se traducen en metros de desvío tras unos minutos. El error
angular es el que más estropea el mapa: un grado de desvío se convierte en 17 cm de error
tras un metro de avance.

Por eso el dashboard avisa bajo el mapa, y por eso **pasar a «detenido» y volver a
«iniciar» reinicia el origen** de la sesión.

### Calibración

Dos números deciden si el mapa se parece a la realidad. Mídelos con
[`firmware/calibrar.py`](firmware/calibrar.py):

```python
import calibrar
calibrar.avance()   # avanza 5 s al 100 %; mide los cm recorridos
                    # VEL_MAX_CM_S = cm_medidos / 5
calibrar.giro()     # gira 2 s al 100 %; mide los grados
                    # DISTANCIA_RUEDAS_CM = (2 · VEL_MAX_CM_S · 2 · 57.2958) / grados
calibrar.recto()    # ¿se desvía? ajusta FACTOR_IZQ / FACTOR_DER en pasos de 0.02
calibrar.bateria()  # compara con un multímetro y ajusta BAT_FACTOR_CORRECCION
```

### Preparado para encoders y giroscopio

[`firmware/odometria.py`](firmware/odometria.py) expone una sola entrada,
`actualizar(vel_izq_pct, vel_der_pct, dt)`. Sustituir la clase por una que lea pulsos de
encoder o el ángulo de un MPU6050 no obliga a tocar nada más: ni `main.py`, ni el protocolo,
ni el servidor, ni el dashboard. Los pines ya están reservados en `config.py`
(GPIO 16/17 para encoders, 21/22 para I2C).

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
pnpm lint                              # tipos de las tres apps + autocomprobante de shared
pnpm build                             # compila API y dashboard
node packages/shared/src/robot.check.ts # geometría, ángulos, umbrales y simulación
python firmware/movimiento.py          # máquina de estados de evasión (sin hardware)
```

Los dos autocomprobantes cubren lo que de verdad puede romperse en silencio: que la fórmula
de proyección de obstáculos del cliente coincida con la de SQL, y que el robot no se quede
bamboleándose contra una esquina en vez de esquivarla.

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
