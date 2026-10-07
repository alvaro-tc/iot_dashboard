# Proyecto: Robot aspirador IoT (tipo roomba) — "NovaBot"

Eres un ingeniero full-stack senior. Vas a construir un proyecto académico completo y funcional. Lee todo este documento antes de escribir código, crea un plan por fases y verifica cada fase (que compile, que corra, que no haya errores en consola) antes de pasar a la siguiente.

## 1. Contexto del proyecto

El proyecto es un **robot aspirador para el hogar (tipo roomba)**. En esta etapa el foco es **el movimiento y la evasión de obstáculos**, no la succión.

El robot lleva un nodo IoT **ESP32 con MicroPython** con:

- **3 sensores ultrasónicos HC-SR04** en el frente del robot: izquierdo (−45°), central (0°) y derecho (+45°). Los ángulos deben ser configurables. Miden la distancia a paredes, muebles y obstáculos (2 a 400 cm; en el dashboard el rango útil es 0 a 100 cm, porque es un entorno doméstico).
- **1 batería** cuyo voltaje se lee por ADC con un divisor resistivo.
- **1 LED** como indicador visual del estado del robot (patrones de parpadeo, ver sección 5).
- **Locomoción de tracción diferencial**: **2 ruedas con motorreductor** (una a cada lado) más una rueda loca (caster) de apoyo. El robot avanza con ambas ruedas hacia adelante, gira sobre su eje moviendo las ruedas en sentidos opuestos y retrocede con ambas hacia atrás. Los motores se controlan con un **driver de puente H** (por defecto TB6612FNG; dejar compatible con L298N cambiando solo `config.py`) mediante PWM.

### Posición del robot en tiempo real (odometría)

El dashboard debe mostrar **el movimiento del robot en vivo sobre un mapa**. Para eso el robot calcula y envía su **pose** (x, y en cm y orientación θ en grados) desde el punto donde arrancó la sesión (origen 0, 0, 0°):

- **Implementación base (sin sensores extra)**: *dead reckoning* a partir de los comandos de los motores. Con el PWM de cada rueda y una calibración en `config.py` (velocidad lineal en cm/s al 100 % de PWM por rueda, y distancia entre ruedas en cm) se integran las ecuaciones de tracción diferencial cada ~50 ms:
  - `v = (v_der + v_izq) / 2`, `ω = (v_der − v_izq) / distancia_entre_ruedas`
  - `θ += ω·dt`, `x += v·cos(θ)·dt`, `y += v·sin(θ)·dt`
- Documentar en el README que esta estimación **acumula error** (deriva) porque no mide lo que realmente giran las ruedas, e incluir un procedimiento de calibración.
- Diseñar el módulo de odometría con una interfaz intercambiable, de modo que más adelante se puedan conectar **encoders** en las ruedas y/o un **giroscopio** (ej. MPU6050) sin cambiar el resto del sistema.

### Aspectos pendientes de definir (NO inventar hardware)

Deja el código **modular y preparado** para estos puntos, con interfaces claras, valores en `config.py` y comentarios `TODO`, pero no fijes modelos ni lógica específica:

- Modelo exacto de motorreductor y del driver (los valores por defecto son provisionales).
- Sistema de succión y cepillos.
- Sensores adicionales (encoders, giroscopio, sensores de caída, bumper, etc.).
- Estrategia de limpieza/recorrido (patrones de cobertura).

## 2. Arquitectura

Arquitectura **híbrida**: el **camino en vivo** (baja latencia) va por MQTT y WebSockets en un VPS propio y **no espera a la base de datos**; la **persistencia, el historial y la autenticación** están en **Supabase (nube)**.

```
ESP32 ──MQTT/TLS (8883)──► Mosquitto (VPS)
  ▲                              │
  │ comandos y config            ▼
  └────────MQTT──────────── NestJS (VPS) ──Socket.IO (wss)──► Dashboard React
                                 │                               │
                                 │ lotes cada 1 s (API REST)     │ login, historial (supabase-js)
                                 ▼                               ▼
                           Supabase (nube): PostgreSQL + Auth + API REST
```

- **ESP32 → Mosquitto**: telemetría por MQTT sobre TLS, conexión persistente.
- **NestJS**: se suscribe a los tópicos, valida los datos, calcula eventos, **retransmite al instante por WebSocket** a los navegadores del propietario y **guarda en lotes en Supabase** usando su API REST (`@supabase/supabase-js`, que usa PostgREST).
- **Dashboard React**: login y registro con **Supabase Auth**; datos en vivo por **Socket.IO** autenticado con el JWT de Supabase; historial, sesiones y estadísticas leídos de Supabase (API REST) y del backend.
- **Comandos** (iniciar, pausar, detener, cambiar configuración): Dashboard → WebSocket → NestJS → MQTT → ESP32, en milisegundos.
- **Objetivo de latencia**: menos de 300 ms desde la medición en el ESP32 hasta que el robot se mueve en el mapa del navegador. Medirla y mostrarla en el dashboard.

### Restricciones de infraestructura

- **VPS pequeño, sin Docker.** Todo se instala de forma nativa en Ubuntu: Mosquitto (paquete oficial), Node.js LTS, pm2, Nginx y Certbot.
- **No hay PostgreSQL en el VPS**: la base de datos está en Supabase.
- Para desarrollo local se usa un **segundo proyecto gratuito de Supabase** (entorno de pruebas), no la CLI con Docker.
- Mantener bajo el consumo de memoria del VPS (NestJS en un solo proceso con pm2, Mosquitto con configuración mínima).

### Requisitos de la evaluación que DEBEN quedar cubiertos (y documentados en el README con dónde se cumple cada uno)

1. **Circuito del nodo** con mínimo 3 sensores → `/docs/circuito.md` y `/firmware`.
2. **Base de datos PostgreSQL en Supabase** con diagrama ER → `/supabase/migrations`, `/docs/diagrama_er.md`.
3. **Inserción y lectura vía API REST de Supabase** → NestJS inserta las lecturas en lotes y lee configuración, sesiones e historial por la API REST; el dashboard lee el historial con supabase-js. Documentar con ejemplos `curl` a `/rest/v1/...`.
4. **Script MicroPython** que lee los sensores y envía los datos → `/firmware` (publica por MQTT; NestJS los persiste en Supabase vía REST). Incluir en el README una sección "Justificación de MQTT" (latencia, conexión persistente, comandos instantáneos, detección de desconexión) y un modo alternativo opcional en el firmware que envíe por REST directo a Supabase (`MODO_ENVIO = "rest"` en `config.py`) por si el docente lo exige.
5. **Registro y autenticación** con Supabase Auth → frontend y guard de NestJS.
6. **Dashboard React en tiempo real con Chart.js conectado a Supabase** → `/frontend`.

## 3. Estructura del repositorio (monorepo)

```
/frontend     → React + Vite (JavaScript/JSX)
/backend      → NestJS (TypeScript, que es el estándar de Nest)
/supabase     → migrations/*.sql, seed.sql
/firmware     → MicroPython para ESP32
/simulador    → script Node.js que simula el robot por MQTT (para demos sin hardware)
/infra        → configuración del VPS: mosquitto, nginx, pm2, script de instalación
/docs         → diagrama ER, circuito, API, tópicos MQTT, despliegue
README.md     → instrucciones de arranque y tabla de requisitos ↔ implementación
```

Usa archivos `.env.example` en cada parte. Nunca subas claves reales. La `service_role` key de Supabase y las credenciales de administración de Mosquitto solo existen en `/backend/.env` del VPS.

## 4. Base de datos (Supabase / PostgreSQL)

Crea todo como migraciones SQL en `/supabase/migrations`. Solo NestJS (con la `service_role` key) escribe lecturas, sesiones y eventos. Los usuarios leen sus datos con RLS.

### Tablas

**perfiles**
- `id uuid PK` → `auth.users(id)` con `on delete cascade`
- `nombre text not null`, `avatar_url text`, `rol text default 'usuario'` (check: 'usuario' | 'admin')
- `creado_en timestamptz default now()`
- Trigger `on auth.users insert` que crea el perfil con el nombre de `raw_user_meta_data`.

**dispositivos** (cada robot)
- `id uuid PK default gen_random_uuid()`
- `propietario_id uuid → perfiles(id)`
- `nombre text` (ej. "NovaBot Sala"), `ubicacion text`
- `mqtt_usuario text unique not null` (el usuario MQTT del robot; la contraseña vive solo en Mosquitto)
- `activo boolean default true`
- `en_linea boolean default false`, `ultimo_contacto timestamptz`
- `version_firmware text`
- `creado_en timestamptz default now()`

**configuracion_dispositivo** (1 a 1 con dispositivos)
- `dispositivo_id uuid PK → dispositivos(id)`
- `modo text default 'detenido'` check ('automatico' | 'pausado' | 'detenido')
- `distancia_evasion_cm int default 15` (check 5–50)
- `distancia_precaucion_cm int default 30` (check > distancia_evasion_cm)
- `velocidad_base_pct int default 60` (check 30–100)
- `intervalo_telemetria_ms int default 200` (check 100–2000)
- `angulos_sensores jsonb default '{"izq":-45,"centro":0,"der":45}'`
- `area_ancho_cm int default 500`, `area_alto_cm int default 400` (encuadre inicial del mapa)
- `actualizado_en timestamptz default now()`

**sesiones** (cada ciclo de funcionamiento)
- `id bigserial PK`, `dispositivo_id uuid`
- `iniciada_en timestamptz`, `finalizada_en timestamptz` (null si sigue activa)
- `total_lecturas int default 0`, `total_evasiones int default 0`, `distancia_recorrida_cm numeric(9,1) default 0`
- `bateria_inicio_pct smallint`, `bateria_fin_pct smallint`

**lecturas**
- `id bigserial PK`
- `dispositivo_id uuid → dispositivos(id)`, `sesion_id bigint → sesiones(id)`
- `secuencia int` (contador del ESP32, para detectar pérdidas y duplicados; único por dispositivo y sesión)
- `dist_izq_cm numeric(5,1)`, `dist_centro_cm numeric(5,1)`, `dist_der_cm numeric(5,1)` (null = sin objeto en rango)
- `estado_movimiento text` check ('avanzando' | 'girando_izq' | 'girando_der' | 'retrocediendo' | 'detenido')
- `pos_x_cm numeric(7,1)`, `pos_y_cm numeric(7,1)`, `orientacion_deg numeric(5,1)`
- `vel_izq_pct smallint`, `vel_der_pct smallint` (PWM con signo, −100 a 100)
- `bateria_v numeric(4,2)`, `bateria_pct smallint`
- `rssi_dbm smallint`
- `medido_en timestamptz` (hora NTP del ESP32), `recibido_en timestamptz` (cuando llegó a NestJS), `creado_en timestamptz default now()`
- Índices en `(dispositivo_id, creado_en desc)` y `(sesion_id, secuencia)`.

**eventos**
- `id bigserial PK`, `dispositivo_id uuid`, `sesion_id bigint`
- `tipo text` check ('obstaculo' | 'atascado' | 'bateria_baja' | 'conexion' | 'desconexion' | 'cambio_modo')
- `sensor text` check ('izq' | 'centro' | 'der' | null)
- `distancia_cm numeric(5,1)`, `pos_x_cm numeric(7,1)`, `pos_y_cm numeric(7,1)`
- `mensaje text`, `atendido boolean default false`
- `creado_en timestamptz default now()`

### Funciones y vistas

- `obtener_mapa_sesion(p_sesion_id bigint)`: devuelve la trayectoria (pose por lectura) y los **puntos de obstáculo** de la sesión. Cada punto: `x_obs = x + (radio_robot + d)·cos(θ + ángulo_sensor)`, `y_obs = y + (radio_robot + d)·sin(θ + ángulo_sensor)`. Limitar a ~3000 puntos (muestreo si hay más).
- `v_lecturas_por_minuto` y `v_lecturas_por_hora` (`date_trunc`): mínimo y promedio por sensor, evasiones, distribución de estados de movimiento y latencia promedio (`recibido_en − medido_en`).
- `v_resumen_sesion`: duración, distancia, evasiones, batería consumida y porcentaje de lecturas perdidas (por huecos en `secuencia`).

### Seguridad (RLS activado en TODAS las tablas)

- `perfiles`: cada usuario lee y edita solo su perfil.
- `dispositivos`, `configuracion_dispositivo`, `sesiones`, `lecturas`, `eventos`: `select` solo si el dispositivo pertenece a `auth.uid()`.
- `insert`, `update` y `delete` en esas tablas: solo por el backend (service role). El frontend nunca escribe directo; pasa por NestJS.
- Realtime de Supabase **no se usa** (el tiempo real va por Socket.IO).

### Documentación

- Diagrama ER en Mermaid (`/docs/diagrama_er.md`).
- `seed.sql` con un robot demo, 3 sesiones pasadas y lecturas sintéticas realistas (con pose y trayectoria coherentes) para las gráficas históricas.

## 5. Firmware MicroPython para ESP32 (`/firmware`)

### Pines (provisionales, todos en `config.py`)

Respetar las restricciones del ESP32: el ADC2 no funciona con WiFi activo (usar solo ADC1); GPIO 34, 35, 36 y 39 son solo de entrada (sirven para ECHO); evitar los pines de arranque (0, 2, 5, 12, 15).

| Función | Pin ESP32 |
|---|---|
| HC-SR04 izquierdo TRIG / ECHO | GPIO 13 / GPIO 34 |
| HC-SR04 central TRIG / ECHO | GPIO 14 / GPIO 35 |
| HC-SR04 derecho TRIG / ECHO | GPIO 27 / GPIO 39 |
| Batería (ADC1, atenuación 11 dB) | GPIO 36 |
| LED de estado (con 220 Ω) | GPIO 23 |
| TB6612FNG motor izquierdo PWMA / AIN1 / AIN2 | GPIO 25 / 26 / 33 |
| TB6612FNG motor derecho PWMB / BIN1 / BIN2 | GPIO 32 / 18 / 19 |
| TB6612FNG STBY | GPIO 4 |
| Reservados: encoders (futuro) | GPIO 16 / 17 |
| Reservados: I2C para giroscopio (futuro) | GPIO 21 SDA / 22 SCL |

- El ECHO del HC-SR04 da 5 V: **divisor de voltaje obligatorio** (1 kΩ / 2 kΩ) hacia el ESP32 (3.3 V).
- Divisor de la batería con relación configurable; calibrar la lectura del ADC (el del ESP32 no es lineal en los extremos).
- Alimentación de los motores separada de la lógica, con tierras comunes. PWM a 1 kHz.
- Documentar la variante con L298N (ENA/IN1/IN2, ENB/IN3/IN4).

### Módulos

- `sensores.py`: lectura con `machine.time_pulse_us` y timeout; disparo **secuencial** de los 3 sensores (pausa ~25 ms) para evitar interferencia; mediana de 3 mediciones (equilibrio entre ruido y velocidad); descartar valores < 2 o > 400 cm (`None`). Batería promediando 10 muestras ADC.
- `motores.py`: clase `Motor` (PWM con signo de −100 a 100, inversión configurable) y clase `Traccion` con `avanzar(vel)`, `retroceder(vel)`, `girar_izq(vel)`, `girar_der(vel)`, `detener()` y `set_ruedas(izq, der)`. Rampas de aceleración suaves y factor de corrección por rueda para que avance recto.
- `odometria.py`: clase `Odometria` con `actualizar(vel_izq_pct, vel_der_pct, dt)`, `pose()` y `reiniciar()`, usando la calibración de `config.py`. θ normalizado a 0–360°. Interfaz preparada para encoders o giroscopio.
- `movimiento.py`: máquina de estados que decide la acción según las 3 distancias y la configuración:
  - Camino libre → avanzar (más lento si algo está bajo la distancia de precaución).
  - Obstáculo al centro → girar hacia el lado con más espacio.
  - Obstáculo a un lado → girar hacia el lado contrario.
  - Obstáculo en los tres → retroceder y luego girar.
  - Modo 'pausado' o 'detenido' → detenerse.
- `led.py`: patrones no bloqueantes (comparando `ticks_ms`):
  - Encendido fijo: en movimiento (modo automático).
  - Parpadeo lento (1 Hz): pausado o detenido.
  - Parpadeo rápido (4 Hz): evadiendo un obstáculo.
  - Doble parpadeo cada 2 s: batería baja.
  - Parpadeo muy rápido: conectando a WiFi o MQTT.
- `red.py`: WiFi con reintentos y reconexión automática; sincronización NTP periódica.
- `mqtt_cliente.py`: basado en `umqtt.simple` (o `umqtt.robust`) con **TLS**, `keepalive` de 30 s, usuario y contraseña del robot, y **Last Will** retenido en `novabot/{id}/estado` con `{"en_linea": false}`. Al conectar publica `{"en_linea": true, "firmware": "x.y"}` retenido y se suscribe a `cmd` y `config`. Reconexión con espera exponencial. Lectura de mensajes no bloqueante (`check_msg()`) dentro del bucle.
- `main.py`:
  - Arranque: WiFi → NTP → MQTT → recibe la configuración retenida.
  - Bucle de control (cada ~50 ms): leer sensores → decidir movimiento → aplicar PWM → actualizar odometría → actualizar LED → `check_msg()`. **La evasión ocurre localmente y no depende de la red.**
  - Cada `intervalo_telemetria_ms` (200 ms por defecto): publicar la telemetría (QoS 0) con JSON compacto y un contador `seq`.
  - Al pasar a modo 'automatico' se reinicia la odometría y `seq` (nueva sesión).
  - Sin conexión: el robot sigue funcionando; guarda hasta 100 lecturas (submuestreadas a 1 por segundo) y al reconectar las publica en `telemetria/lote` con QoS 1.
  - `gc.collect()` periódico y `machine.WDT` (watchdog 8 s).
  - Modo alternativo `MODO_ENVIO = "rest"`: envía lotes cada 1 s directo a la API REST de Supabase (función RPC `registrar_lecturas`, crear también esa función en una migración opcional) en lugar de MQTT.
- `config.example.py`: WiFi, servidor y puerto MQTT, usuario y contraseña MQTT, ID del robot, pines, inversión de motores, factores de corrección y calibración de odometría.
- `calibrar.py`: hace avanzar el robot 5 s y girar 2 s para medir y ajustar la calibración.

## 6. Protocolo MQTT (`/docs/mqtt.md`)

Prefijo `novabot/{dispositivo_id}/`:

| Tópico | Sentido | QoS | Retenido | Contenido |
|---|---|---|---|---|
| `telemetria` | ESP32 → servidor | 0 | No | `{"seq","t","d":[izq,centro,der],"e","x","y","th","vi","vd","bv","rssi"}` |
| `telemetria/lote` | ESP32 → servidor | 1 | No | Arreglo de lecturas diferidas |
| `estado` | ESP32 → servidor | 1 | Sí | `{"en_linea", "firmware"}` (con Last Will) |
| `evento` | ESP32 → servidor | 1 | No | Eventos detectados en el robot (ej. atascado) |
| `cmd` | servidor → ESP32 | 1 | No | `{"accion":"iniciar"|"pausar"|"detener","id"}` |
| `cmd/ack` | ESP32 → servidor | 1 | No | Confirmación con el mismo `id` |
| `config` | servidor → ESP32 | 1 | Sí | Configuración completa vigente |

- Claves cortas en la telemetría para reducir el tamaño de los mensajes.
- `t` es el tiempo en milisegundos UTC (NTP).

## 7. Simulador (`/simulador`)

Script Node.js (`npm run simular`) con `mqtt.js` que se comporta **exactamente como el ESP32**: mismos tópicos, mismo formato, Last Will, respuesta a comandos y configuración retenida. Simula un robot de tracción diferencial en una habitación con muebles: calcula las 3 distancias según su posición, aplica la misma lógica de evasión, integra la cinemática y publica la pose a 5 Hz, con algo de deriva artificial, descarga lenta de batería, RSSI con ruido y cortes ocasionales de conexión. Puede lanzar varios robots a la vez (`--robots 3`).

## 8. Backend NestJS (`/backend`)

NestJS + TypeScript. Dependencias: `@nestjs/microservices` (transporte MQTT) o `mqtt` directo, `@nestjs/websockets` + `@nestjs/platform-socket.io`, `@supabase/supabase-js` con service role, `class-validator`, Swagger en `/api/docs`. Un solo proceso, ligero.

### Autenticación

- **HTTP**: guard que valida `Authorization: Bearer <jwt de Supabase>`. Verificar el JWT **localmente** (con el secreto o JWKS del proyecto) para no hacer una petición a Supabase por cada llamada; usar `supabase.auth.getUser` solo como respaldo.
- **WebSocket**: el cliente envía el JWT en el handshake (`auth.token`). Si no es válido, se rechaza la conexión. Al unirse a la sala de un robot se verifica que el usuario sea el propietario.

### Módulos

- **MqttModule**: cliente MQTT conectado a Mosquitto por `localhost:1883` (listener solo local) con un usuario de servicio. Se suscribe a `novabot/+/telemetria`, `telemetria/lote`, `estado`, `evento` y `cmd/ack`. Publica en `cmd` y `config`.
- **TelemetriaService**:
  1. Valida y normaliza cada mensaje (descarta los mal formados, detecta duplicados por `seq`).
  2. **Emite inmediatamente** por WebSocket a la sala `robot:{id}` (antes de cualquier escritura en la base de datos).
  3. Calcula eventos en memoria: `obstaculo` (distancia ≤ evasión, sin repetir el mismo sensor en menos de 3 s), `atascado` (los 3 sensores bajo la distancia de evasión más de 5 s), `bateria_baja` (< 20 %). Los emite al instante y los encola para guardar.
  4. Lleva la sesión activa en memoria (distancia recorrida, evasiones, contador de lecturas).
  5. Encola la lectura en un **buffer de persistencia**.
- **PersistenciaService**: cada 1 s (o al llegar a 200 filas) inserta en lote en `lecturas` y `eventos` mediante la API REST de Supabase. Si falla, reintenta con espera exponencial y, si el problema persiste, guarda en un archivo NDJSON local (`/var/lib/novabot/pendientes`) que se reenvía después. Al apagarse el proceso, vacía el buffer.
- **PresenciaService**: con los mensajes de `estado` (incluido el Last Will) actualiza `en_linea` y `ultimo_contacto`, registra eventos `conexion` y `desconexion` y avisa por WebSocket.
- **ComandosService**: recibe los comandos del dashboard por WebSocket o HTTP, los publica en `cmd` con un `id`, espera el `ack` (timeout de 2 s) y responde al dashboard si se confirmó o no. Al cambiar el modo, actualiza `configuracion_dispositivo`, abre o cierra la sesión y publica la configuración retenida.
- **LiveGateway** (Socket.IO, namespace `/live`):
  - Cliente → servidor: `unirse` (id del robot), `salir`, `comando`, `actualizar_config`.
  - Servidor → cliente: `telemetria`, `evento`, `estado`, `config`, `comando_ack`.
  - Al unirse, envía al instante el último estado y las últimas 50 lecturas guardadas en memoria, para que el mapa no arranque vacío.
- **DispositivosModule**: `GET /dispositivos`, `POST /dispositivos` (crea el robot, genera usuario y contraseña MQTT y los registra en Mosquitto con el **plugin Dynamic Security**, con un rol que solo permite `novabot/{id}/#`; devuelve la contraseña una sola vez), `PATCH /dispositivos/:id`, `DELETE /dispositivos/:id` (también lo elimina de Mosquitto), `POST /dispositivos/:id/regenerar-clave`.
- **ConfiguracionModule**: `GET` y `PATCH /dispositivos/:id/configuracion` (valida rangos, guarda en Supabase y publica en `config` retenido).
- **LecturasModule**: `GET /dispositivos/:id/lecturas?desde&hasta&agregacion=raw|minuto|hora` y `GET /dispositivos/:id/lecturas/export.csv` (leídos de Supabase por la API REST).
- **SesionesModule**: `GET /dispositivos/:id/sesiones`, `GET /sesiones/:id/lecturas` (repetición) y `GET /sesiones/:id/mapa`.
- **EventosModule**: `GET /dispositivos/:id/eventos?tipo&sensor&pagina`, `PATCH /eventos/:id/atender`.
- **EstadisticasModule**: `GET /dispositivos/:id/resumen` → tiempo en funcionamiento hoy, distancia recorrida, evasiones por sensor, distribución de estados de movimiento, autonomía estimada de batería, **latencia** (ESP32 → servidor y servidor → navegador), mensajes por segundo y porcentaje de lecturas perdidas.
- **SaludModule**: `GET /salud` con el estado de la conexión a Mosquitto, a Supabase, tamaño del buffer y clientes WebSocket conectados.

Tests unitarios de TelemetriaService (detección de eventos y duplicados) y PersistenciaService (reintentos).

## 9. Infraestructura del VPS sin Docker (`/infra`)

- `instalar.sh` para Ubuntu 22.04/24.04: instala Mosquitto (repositorio oficial), Node.js LTS, pm2, Nginx, Certbot y configura el firewall `ufw` (22, 80, 443, 8883).
- `mosquitto/novabot.conf`:
  - Listener `8883` con TLS (certificados de Let's Encrypt) para los robots.
  - Listener `1883` solo en `127.0.0.1` para NestJS.
  - `allow_anonymous false`, plugin **Dynamic Security** para usuarios y ACL por robot.
  - Límites de memoria y de mensajes en cola razonables para un VPS pequeño.
- Hook de Certbot que copia los certificados para Mosquitto y lo recarga al renovarlos.
- `nginx/novabot.conf`: sirve el frontend compilado como archivos estáticos (con fallback a `index.html` para React Router), hace proxy de `/api` y de `/socket.io` (con cabeceras `Upgrade` y `Connection` para WebSocket) hacia NestJS, HTTPS obligatorio, gzip y caché de archivos estáticos.
- `ecosystem.config.js` de pm2 para el backend, con límite de memoria y reinicio automático.
- `/docs/despliegue.md` con los pasos completos: dominio, DNS, certificados, variables de entorno, compilar y publicar el frontend, y cómo ver logs.

## 10. Frontend React (`/frontend`)

React + Vite (JavaScript/JSX), **Tailwind CSS** (dark mode por clase), React Router, `@supabase/supabase-js` (Auth y lectura de historial), **`socket.io-client`** (tiempo real), **Chart.js con react-chartjs-2**, `chartjs-plugin-annotation`, `chartjs-plugin-zoom`, `lucide-react` para iconos y TanStack Query para llamadas al backend.

### 10.1 Sistema de diseño (replicar la imagen de referencia)

La imagen de referencia es un dashboard de hogar inteligente. Mantén su estética exacta y adapta el contenido al robot:

- **Acento naranja** `#F97316` (hover `#EA580C`), fondos en tonos durazno muy suaves (`#FFF7F1`, `#FDEDE3`), tarjetas blancas con esquinas `rounded-3xl`, sombras muy suaves, mucho espacio en blanco, tipografía *Inter* o *Plus Jakarta Sans*.
- **Sidebar** vertical oscura (`#0F172A`) y estrecha, con logo arriba, iconos circulares (el activo en naranja sólido) y abajo "Ayuda" y "Cerrar sesión" (en rojo).
- Tarjetas con encabezado (título + subtítulo gris), un botón circular de acción arriba a la derecha (contorno naranja) y chips o píldoras de acción en la parte inferior (icono en círculo + texto).
- Algunas tarjetas con fondo degradado suave del color de su estado (como la de Temperatura en durazno y la de Wi-Fi en verde menta).
- **Tema oscuro**: fondo `#0B1120`, tarjetas `#111827` / `#1F2937`, bordes `#1F2937`, mismo naranja, textos claros. Los degradados pasan a versiones oscuras desaturadas. Las gráficas de Chart.js leen los colores del tema y se redibujan al cambiarlo.
- **Toggle de tema** como en la imagen (píldora con luna y sol). Respeta `prefers-color-scheme` la primera vez y guarda la preferencia en `localStorage`.
- Animaciones sutiles (150–200 ms, entrada de tarjetas, pulso en el badge "En vivo"). Respeta `prefers-reduced-motion`.

### 10.2 Autenticación (páginas públicas, Supabase Auth)

- **/login**: pantalla dividida. Izquierda (oculta en móvil): panel naranja con el logo, el lema "Tu hogar limpio, monitoreado en tiempo real" y una animación SVG de un robot circular visto desde arriba moviéndose y esquivando un obstáculo. Derecha: email y contraseña (mostrar/ocultar), "Recordarme", "¿Olvidaste tu contraseña?", botón naranja, enlace a registro y botón opcional "Continuar con Google".
- **/registro**: nombre, email, contraseña con indicador de fortaleza, confirmar contraseña y aceptar términos. Guarda `nombre` en `user_metadata`. Pantalla "Revisa tu correo" si la confirmación está activa.
- **/recuperar** y **/restablecer**: flujo de recuperación de Supabase.
- Validación en el cliente con mensajes en línea, estados de carga, errores traducidos al español y botón bloqueado mientras se envía.
- `AuthProvider` con `onAuthStateChange`, `ProtectedRoute` que redirige a `/login`, y redirección a `/` si ya hay sesión. Al renovarse el token, se actualiza también la conexión de Socket.IO.

### 10.3 Layout responsivo

- **Escritorio (≥1280 px)**: sidebar fija + barra superior + grilla como la imagen (fila 1: tarjeta grande a la izquierda ~58 %, columna derecha con una tarjeta ancha y dos pequeñas; fila 2: tres tarjetas iguales).
- **Tablet (768–1279 px)**: sidebar colapsada a iconos, grilla de 2 columnas.
- **Móvil (<768 px)**: sin sidebar; **barra de navegación inferior** con 5 iconos; barra superior compacta (logo, campana, avatar; la búsqueda pasa a un icono). Tarjetas en una columna, el mapa primero y con altura adecuada. Objetivos táctiles de al menos 44 px.
- Sin scroll horizontal en ningún tamaño.

### 10.4 Barra superior

- Buscador "Buscar robot…" que filtra y cambia el robot activo.
- Botón naranja **"+ Agregar robot"**: modal que llama a `POST /dispositivos` y muestra **una sola vez** el ID, el usuario y la contraseña MQTT, con botón de copiar y un fragmento de `config.py` listo para pegar.
- **Campana de notificaciones** con punto rojo: recibe los eventos por WebSocket; toast cuando el robot queda `atascado`, con `bateria_baja` o se desconecta.
- Toggle de tema y menú del usuario (avatar, nombre, email, "Perfil", "Cerrar sesión").

### 10.5 Dashboard principal (`/`) — qué va en cada tarjeta de la imagen

**Tarjeta grande (en la imagen: "Smart CCTV") → "Mapa en vivo / Radar"**

Es la pieza central. Tiene dos vistas que se alternan con un control segmentado en el encabezado: **Mapa** (por defecto) y **Radar**.

- Subtítulo: nombre y ubicación del robot. Botón circular de encendido arriba a la derecha que alterna el modo entre 'automatico' y 'detenido' (por WebSocket, con estado "enviando…" hasta recibir el `ack`).
- Badge **"● En vivo"** arriba a la izquierda (gris "Desconectado" según el estado MQTT del robot o si se cae el WebSocket) y selector de robot "‹ NovaBot Sala ›" arriba a la derecha, igual que "Camera -2" en la imagen.
- Fondo oscuro dentro del recuadro (como la imagen de la cámara), en ambos temas.

**Vista Mapa — el movimiento del robot en tiempo real**
- **Gráfica Chart.js tipo `scatter`** con ejes en cm (rejilla tenue cada 50 cm, misma escala en X e Y) y un **plugin propio** que dibuja:
  - **el robot** en su pose actual: círculo visto desde arriba, con las **dos ruedas** como rectángulos a los costados y una flecha que indica el frente, rotado según θ;
  - **los 3 haces de los sensores** con longitud igual a la distancia medida y color por estado (rojo ≤ evasión, ámbar ≤ precaución, verde libre);
  - **la trayectoria** como línea naranja con opacidad decreciente en los tramos antiguos;
  - **los obstáculos detectados** como puntos rojos pequeños (calculados en el cliente con la pose y cada distancia). Con el tiempo dibujan las paredes y muebles;
  - el **origen** de la sesión con un icono de casa.
- **Movimiento fluido**: interpolar la pose del robot entre mensajes con `requestAnimationFrame` (posición lineal, ángulo por el camino más corto), con un pequeño búfer de reproducción (~100 ms) para absorber la variación de llegada de los mensajes.
- Botones propios de esta vista: **Seguir al robot**, **Ajustar a todo el recorrido**, **Limpiar mapa** (solo en pantalla), **Mostrar u ocultar haces** y **Zoom +/−** (plugin zoom, con pellizco en móvil).
- Leyenda pequeña y, bajo el mapa, la pose actual (x, y, θ) y la distancia recorrida en la sesión.

**Vista Radar — lo que ven los sensores ahora mismo**
- **Gráfica Chart.js tipo `scatter`** con ejes ocultos y un **plugin propio** que dibuja el robot abajo al centro, anillos a 25, 50, 75 y 100 cm, y 3 sectores de ±18° centrados en los ángulos de cada sensor, divididos en bandas (los límites siguen a `distancia_evasion_cm` y `distancia_precaucion_cm`).
- La banda donde está el objeto se rellena con el color del estado; las más lejanas en tono tenue. Un punto marca el obstáculo, con un rastro de las últimas 6 lecturas.
- Indicador del estado de movimiento sobre el robot y tooltip con sensor, distancia y hora.

**Comunes a ambas vistas**
- Fila inferior de botones circulares translúcidos como en la imagen: **Iniciar/Pausar**, **Detener**, **Vista ampliada** (layout más alto, sin la API de pantalla completa) y **Captura PNG** (`chart.toBase64Image()`).
- Banner de estado: "Avanzando — camino libre" / "Girando a la derecha — obstáculo a 12 cm (izquierdo)" / "Atascado" / "Pausado".

**Tarjeta ancha superior derecha (en la imagen: reproductor de música) → "Sesiones de limpieza"**
- Lista de sesiones. La "carátula" es una miniatura del **mapa del recorrido** de esa sesión.
- Título: "Sesión 14:32"; subtítulo: duración, distancia, evasiones y batería consumida.
- Barra de progreso naranja con tiempo actual y total; botones anterior / reproducir-pausar / siguiente; velocidades 1x, 2x y 4x.
- Al reproducir, el mapa y el radar entran en "modo repetición" (badge "Repetición"): el robot recorre de nuevo el camino de esa sesión, con datos leídos de Supabase. Botón para volver a "En vivo".

**Tarjeta pequeña 1 (en la imagen: "Temperature") → "Estado del robot"**
- Texto grande con el estado de movimiento actual y el modo como subtítulo.
- Fondo degradado según el estado (verde avanzando, ámbar evadiendo, gris detenido, rojo atascado).
- Datos: "Obstáculo más cercano" (cm y sensor) y "Evasiones hoy".
- **Velocidad de cada rueda**: dos barras horizontales centradas en cero (−100 % a 100 %).
- **LED virtual** que imita el patrón de parpadeo del LED físico.

**Tarjeta pequeña 2 (en la imagen: "Wi-Fi") → "Conectividad"**
- Señal WiFi del robot (porcentaje y dBm desde el RSSI) y estado de MQTT y del WebSocket.
- Datos: **latencia de extremo a extremo** (medición en el ESP32 → navegador, en ms) y mensajes por segundo; porcentaje de lecturas perdidas en la sesión.
- Fondo verde menta si todo está en línea, gris si no, con un **sparkline Chart.js** de la latencia de los últimos 2 minutos.

**Fila inferior, tarjeta 1 (en la imagen: "Bedroom Light") → "Historial de distancias"**
- Interruptor: "Seguir en vivo".
- **Gráfica de líneas Chart.js** con 3 series en ventana deslizante (alimentada por WebSocket), líneas de umbral (annotation), zoom y leyenda clicable.
- Franja de color bajo el eje X con el estado de movimiento en cada momento.
- Chips: **1 min**, **5 min** (en vivo) y **1 h** (agregado desde Supabase).

**Fila inferior, tarjeta 2 (en la imagen: "Bluetooth Speaker") → "Batería"**
- Interruptor: "Ahorro de energía" (sube `intervalo_telemetria_ms` a 1000).
- Porcentaje grande y **gauge semicircular Chart.js** (`doughnut` con `circumference: 180`, `rotation: -90`) coloreado por nivel.
- Chips: **Voltaje** y **Autonomía** (del endpoint de resumen). Al pulsar un chip, popover con la gráfica del voltaje de la última hora.

**Fila inferior, tarjeta 3 (en la imagen: "Air Conditioner") → "Distancia de evasión"**
- Interruptor: "Modo automático" (automatico ↔ pausado).
- **Dial semicircular interactivo** (como el de 15–32 °C de la imagen) de 5 a 50 cm. Al soltar, se envía la nueva configuración; el robot la recibe por MQTT al instante y el dashboard muestra la confirmación.
- Chips: **Perfil** (cuidadoso 25/45, normal 15/30, ajustado 8/18), **Sensores** (ángulos de cada sensor) y **Velocidad** (velocidad base).

### 10.6 Otras páginas (sidebar)

- **/mapa**: el mapa en vivo a todo el ancho, con el radar pequeño en una esquina y la lista de eventos en vivo al lado (debajo en móvil).
- **/sesiones**: lista de sesiones con detalle: **mapa completo del recorrido** (con zoom), distancia, duración, evasiones, batería consumida, **dona Chart.js** con la distribución de estados de movimiento y **barras** de evasiones por sensor.
- **/historial**: selector de rango; **barras agrupadas** con distancia mínima por hora y sensor; **barras apiladas** de estados de movimiento por hora; **heatmap** (24 horas × 7 días) de evasiones; **línea de latencia** promedio; botón "Exportar CSV".
- **/eventos**: tabla paginada con filtros (tipo, sensor, atendido), marcar como atendido, nuevos eventos en vivo. En móvil, tarjetas en lugar de tabla.
- **/robots**: lista con estado en línea, modo, último contacto, batería y versión de firmware; editar, desactivar, regenerar credenciales MQTT y eliminar (con confirmación).
- **/perfil**: editar nombre y avatar, cambiar contraseña y preferencias de tema.

### 10.7 Tiempo real

- Un solo `SocketProvider` con la conexión a `/live`, autenticada con el JWT de Supabase, con reconexión automática e indicador de estado.
- Un store (Context o Zustand) recibe `telemetria`, `evento`, `estado` y `config`, y todas las tarjetas leen de ahí.
- Al cambiar de robot: `salir` de la sala anterior y `unirse` a la nueva. Al reconectar, volver a unirse.
- Latencia de extremo a extremo: `Date.now() − t` del mensaje (corrigiendo el desfase de reloj del navegador con una sincronización simple contra el servidor al conectar).
- Chart.js con `chart.update('none')`. Las gráficas de líneas se limitan a 10 fps; el mapa usa `requestAnimationFrame` para la capa del robot y los haces, y un canvas de fondo en caché para la trayectoria y los obstáculos acumulados.

### 10.8 Estados y calidad

- Skeletons de carga, estado vacío ("Conecta tu primer robot" con botón de agregar) y estado de error con reintento.
- Accesibilidad: `aria-label` en botones de solo icono, contraste AA en ambos temas, navegación con teclado y resumen textual del mapa y el radar para lectores de pantalla.
- Números formateados (1 decimal para cm, enteros para %).
- Sin `console.log` sobrantes ni warnings de React.

## 11. Documentación y entrega

- `README.md`: requisitos, configuración de Supabase (producción y pruebas), migraciones, variables de entorno, cómo correr todo en local (Mosquitto instalado nativamente o un broker de pruebas), simulador, firmware, **tabla de requisitos ↔ implementación**, sección "Justificación de MQTT" con el diagrama de arquitectura, y sección "Pendiente de definir".
- `/docs/circuito.md`: tabla de conexiones, divisores calculados, restricciones de pines del ESP32, tabla de patrones del LED, cableado de los motores con TB6612FNG (y la variante L298N) y diagrama en Mermaid o ASCII.
- `/docs/diagrama_er.md`: diagrama ER en Mermaid.
- `/docs/api.md`: endpoints de NestJS, eventos de Socket.IO y ejemplos `curl` a la API REST de Supabase (inserción y lectura).
- `/docs/mqtt.md`: tópicos, formatos, QoS y ACL.
- `/docs/despliegue.md`: instalación del VPS sin Docker.

## 12. Orden de trabajo

1. Migraciones SQL, RLS, funciones, vistas y seed en Supabase.
2. Mosquitto local con TLS opcional en desarrollo, Dynamic Security y documento de tópicos.
3. Simulador publicando por MQTT.
4. Backend NestJS: MQTT, telemetría, persistencia en lotes, gateway Socket.IO, autenticación y módulos REST. Verificar la latencia con el simulador.
5. Frontend: sistema de diseño, tema claro/oscuro, layout responsivo y autenticación.
6. Dashboard con cada tarjeta, mapa en vivo y radar con Chart.js, y tiempo real por WebSocket.
7. Páginas secundarias.
8. Firmware MicroPython para ESP32 (sensores, LED, motores, odometría, movimiento, MQTT, modo REST alternativo y calibración).
9. Infraestructura del VPS y documentación.

Al terminar cada fase, ejecuta el build y las pruebas, revisa la responsividad en 375 px, 768 px y 1440 px en ambos temas, y resume qué hiciste y qué queda pendiente.
