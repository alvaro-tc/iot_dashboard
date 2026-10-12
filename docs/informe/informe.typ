#import "@preview/cetz:0.3.2": canvas, draw
#import "@preview/cetz-plot:0.1.1": chart, plot

// ---------------------------------------------------------------------------
// Configuración general del documento
// ---------------------------------------------------------------------------
#set document(title: "Sistema IoT — Robot aspirador Roomba", author: "Álvaro")
#set page(
  paper: "a4",
  margin: (x: 2.2cm, y: 2.4cm),
  numbering: "1",
  number-align: center,
)
#set text(font: "New Computer Modern", size: 10.5pt, lang: "es")
#set par(justify: true, leading: 0.65em)
#set heading(numbering: "1.1")

#let acento = rgb("#EA580C")
#let tinta = rgb("#16202E")
#let suave = rgb("#FFF1E7")
#let verde = rgb("#047857")
#let ambar = rgb("#B45309")
#let rojo = rgb("#DC2626")

#show heading.where(level: 1): it => {
  pagebreak(weak: true)
  v(0.4em)
  text(size: 20pt, weight: "bold", fill: tinta)[#it]
  v(0.3em)
  line(length: 100%, stroke: 1.5pt + acento)
  v(0.6em)
}
#show heading.where(level: 2): it => {
  v(0.6em)
  text(size: 14pt, weight: "bold", fill: tinta)[#it]
  v(0.2em)
}
#show heading.where(level: 3): it => {
  v(0.4em)
  text(size: 11.5pt, weight: "bold", fill: acento.darken(10%))[#it]
  v(0.1em)
}

#let nota(cuerpo) = block(
  fill: suave, inset: 10pt, radius: 4pt, width: 100%,
  text(size: 9.5pt, fill: tinta, cuerpo),
)

#let figura(cuerpo, titulo: "", num: "") = figure(
  block(stroke: 0.5pt + rgb("#E7E2DD"), inset: 12pt, radius: 4pt, cuerpo),
  caption: titulo,
)

// ---------------------------------------------------------------------------
// Portada
// ---------------------------------------------------------------------------
#page(numbering: none)[
  #v(0.6cm)
  #align(center)[
    #image("assets/ucb_logo.png", width: 58%)
  ]
  #v(0.9cm)
  #align(center)[
    #text(size: 15pt, weight: "bold", fill: tinta, tracking: 1pt)[INFORME]
    #v(0.2cm)
    #text(size: 13pt, weight: "bold", fill: acento, tracking: 1pt)[PRIMERA EVALUACIÓN]
  ]
  #v(1cm)
  #align(center)[
    #line(length: 55%, stroke: 0.6pt + rgb("#CBD5E1"))
    #v(0.25cm)
    #text(size: 10.5pt, fill: rgb("#475569"))[ASIGNATURA]
    #v(0.1cm)
    #text(size: 15pt, weight: "bold", fill: tinta)[Internet de las Cosas]
    #v(0.25cm)
    #line(length: 55%, stroke: 0.6pt + rgb("#CBD5E1"))
  ]
  #v(0.9cm)
  #align(center)[
    #text(size: 10.5pt, fill: rgb("#475569"))[INTEGRANTES]
    #v(0.3cm)
    #text(size: 12.5pt, fill: tinta)[Álvaro Torrez]
    #v(0.15cm)
    #text(size: 12.5pt, fill: tinta)[Karen Vargas]
  ]
  #v(1.3cm)
  #align(center)[
    #grid(
      columns: (1fr, 1fr),
      row-gutter: 0.55cm,
      column-gutter: 1cm,
      [*Docente*], [Ing. Pamela Valenzuela],
      [*Carrera*], [Ingeniería de Sistemas],
      [*Fecha de entrega*], [12 de octubre de 2026],
    )
  ]
  #v(1cm)
  #align(center)[
    #text(size: 11pt, weight: "bold", fill: tinta)[LA PAZ -- BOLIVIA]
    #v(0.1cm)
    #text(size: 11pt, fill: tinta)[2026]
  ]
]

#outline(title: "Índice", indent: auto)
#pagebreak()

// ===========================================================================
= Introducción

== Descripción general del proyecto

El proyecto implementa un *robot aspirador doméstico de tipo Roomba* cuyo nodo físico es
un *ESP32 programado en MicroPython*. En la etapa actual el foco está puesto en el
*movimiento y la evasión de obstáculos*, no en la succión: el robot detecta paredes y
muebles con tres sensores ultrasónicos, decide por sí mismo cómo esquivarlos y reporta su
telemetría a un dashboard web en tiempo real.

El sistema completo —firmware, backend y frontend— vive en un único monorepo gestionado con
`pnpm`, con cuatro paquetes principales:

#figure(
  table(
    columns: (auto, 1fr),
    stroke: 0.5pt + rgb("#E7E2DD"),
    inset: 7pt,
    [*Paquete*], [*Responsabilidad*],
    [`apps/api`], [API en Express + Socket.IO + puente MQTT + persistencia por lotes en PostgreSQL],
    [`apps/web`], [Dashboard en React + Vite + Tailwind + Chart.js],
    [`packages/shared`], [Contratos MQTT, geometría del robot y motor de simulación físico],
    [`firmware`], [MicroPython para el ESP32: sensores, motores, MQTT, ESP-NOW],
    [`simulador`], [Robot simulado que publica por MQTT igual que el ESP32 real, para probar sin hardware],
    [`infra`], [Configuración del VPS: Mosquitto, Caddy (TLS), pm2],
  ),
  caption: [Estructura del monorepo.],
)

== Planteamiento del problema

Un robot aspirador doméstico necesita evitar colisiones con paredes y muebles sin
intervención humana continua, y su propietario necesita poder *ver qué está haciendo el
robot mientras limpia*: qué tan cerca están los obstáculos, cuánta batería le queda y si
sigue conectado. Sin esa visibilidad, el único indicio de un problema (el robot atascado, sin
batería o fuera de línea) es notarlo físicamente horas después.

El problema técnico se divide en tres partes:

1. *A bordo*: leer tres sensores ultrasónicos y la batería con suficiente frecuencia para
  reaccionar antes de chocar, y mover dos motorreductores con un driver de puente H.
2. *En tránsito*: llevar esa telemetría del robot a un navegador con la menor latencia
  posible, sin que una base de datos lenta o caída bloquee el camino en vivo.
3. *En reposo*: guardar un historial consultable (sesiones de limpieza, lecturas, consumo de
  batería) sin inventar datos que el hardware no puede medir — en particular, la posición del
  robot, que sin encoders ni GPS no se puede calcular de forma fiable.

== Objetivos

*Objetivo general*: construir un sistema IoT extremo a extremo —firmware, protocolo de
transporte, persistencia, API REST y dashboard— que reporte en tiempo real la telemetría de
un robot aspirador y permita consultar su historial de limpiezas.

*Objetivos específicos*:

- Leer de forma no bloqueante tres sensores de distancia HC-SR04, el voltaje de batería por
  ADC y reportar el estado de dos motores con PWM con signo.
- Transportar la telemetría del ESP32 al backend por MQTT sobre una conexión persistente, con
  detección de desconexión mediante *Last Will* y configuración retenida.
- Emitir cada lectura por WebSocket *antes* de escribirla en PostgreSQL, para que la base de
  datos nunca sea un cuello de botella del camino en vivo.
- Diseñar un esquema relacional que solo almacene lo que el hardware mide realmente, con las
  reglas de integridad (`CHECK`, índices únicos, triggers) resueltas en la propia base.
- Exponer esa información mediante una API REST autenticada, con lectura cruda, agregada
  (por minuto/hora) y exportable a CSV.
- Construir un dashboard en React que visualice la telemetría en vivo con gráficas reales
  (Chart.js) y permita revisar el historial de sesiones.
- Implementar registro e inicio de sesión propios (bcrypt + JWT), sin depender de un
  proveedor externo de autenticación.

== Alcance

Queda dentro del alcance: el nodo ESP32 con sus tres sensores y dos motores, el transporte
MQTT y su alternativa por API REST, la base de datos PostgreSQL con su API de lectura, el
sistema de autenticación propio y el dashboard en tiempo real con su historial.

Queda *fuera* del alcance de esta etapa —y así se deja documentado en el propio código, sin
simular hardware que no existe—: la succión y los cepillos, la estimación de posición por
odometría (el robot no tiene encoders), los sensores adicionales (giroscopio, bumper, caída) y
cualquier estrategia de cobertura de limpieza. El `README.md` del repositorio dedica una
sección completa, *Pendiente de definir*, a enumerar estos puntos explícitamente.

// ===========================================================================
= Diseño del Sistema IoT

== Arquitectura general

El sistema sigue una arquitectura de *tres capas* con una regla de diseño explícita: *el
camino en vivo nunca espera a la base de datos*. Cada lectura del robot se retransmite por
WebSocket al instante y solo después se encola para guardarse en PostgreSQL en lotes de un
segundo.

#figura(
  titulo: [Arquitectura general del sistema: nodo IoT, transporte, backend y dashboard.],
  canvas(length: 0.7cm, {
    import draw: *

    let caja(pos, w, h, etiqueta, color: white) = {
      rect((pos.at(0), pos.at(1)), (pos.at(0) + w, pos.at(1) + h), fill: color, stroke: 1pt + tinta, radius: 2pt)
      content(
        (pos.at(0) + w / 2, pos.at(1) + h / 2),
        box(width: (w - 0.4) * 1cm, text(size: 7.3pt, align(center, etiqueta))),
      )
    }

    // Nodo físico
    caja((0, 3.6), 4.2, 2, [*ESP32* \ MicroPython \ 3×US · ADC · PWM], color: suave)
    caja((0, 0.4), 4.2, 1.4, [*Mando ESP-NOW* \ órdenes manuales], color: white)
    line((2.1, 1.8), (2.1, 3.6), mark: (end: "stealth"), stroke: 1pt + tinta)

    // Broker
    caja((6.4, 3.6), 3.8, 2, [*Mosquitto* \ TLS : 8883 (VPS) \ ACL por robot], color: white)
    line((4.2, 4.9), (6.4, 4.9), mark: (end: "stealth"), stroke: 1pt + acento)
    content((5.3, 5.25), text(size: 6pt, fill: acento)[telemetría / estado])
    line((6.4, 4.3), (4.2, 4.3), mark: (end: "stealth"), stroke: 1pt + rgb("#475569"))
    content((5.3, 3.95), text(size: 6pt, fill: rgb("#475569"))[config retenida])

    // API
    caja((12.6, 3.6), 4.2, 2, [*API Express* \ puente MQTT \ Socket.IO · REST], color: suave)
    line((10.2, 4.9), (12.6, 4.9), mark: (end: "stealth"), stroke: 1pt + acento)
    content((11.4, 5.25), text(size: 6pt, fill: acento)[MQTT])

    // Postgres
    caja((12.6, 0.4), 4.2, 1.6, [*PostgreSQL* \ lotes cada 1 s], color: white)
    line((14.7, 3.6), (14.7, 2), mark: (end: "stealth"), stroke: 1pt + rgb("#475569"))
    content((16.2, 2.8), text(size: 6pt, fill: rgb("#475569"))[lotes de 1 s])

    // Dashboard
    caja((19.2, 3.6), 4, 2, [*Dashboard React* \ Socket.IO · Chart.js], color: suave)
    line((16.8, 4.9), (19.2, 4.9), mark: (end: "stealth"), stroke: 1pt + acento)
    content((18, 5.25), text(size: 6pt, fill: acento)[WebSocket])
    line((19.2, 4), (16.8, 4), mark: (end: "stealth"), stroke: 1pt + rgb("#475569"))
    content((18, 3.65), text(size: 6pt, fill: rgb("#475569"))[REST: historial / login])
  }),
)

El flujo tiene cuatro tramos:

1. *ESP32 → Mosquitto*: telemetría por MQTT sobre TLS (puerto 8883 en producción, 1883 en
  desarrollo local), con conexión persistente y *Last Will* para anunciar desconexión.
2. *Mosquitto → API*: la API se suscribe como usuario de servicio a `roomba/#`, valida cada
  mensaje con Zod y lo encola por robot (una cola por `dispositivoId`, para no invertir el
  orden de dos lecturas consecutivas del mismo robot).
3. *API → Dashboard*: cada lectura válida se emite de inmediato por Socket.IO a la sala del
  robot (`robot:{id}`) y *solo después* entra en el buffer que se vacía a PostgreSQL una
  vez por segundo.
4. *API → PostgreSQL*: persistencia por lotes, pensada para no hacer un `INSERT` por mensaje
  cuando el robot publica varias veces por segundo.

Como alternativa a MQTT, la API expone `POST /api/ingesta`: un firmware que no pueda abrir una
conexión MQTT puede enviar lotes de lecturas por HTTP, autenticado con el mismo token del
robot. Pierde la configuración retenida y la detección de caída por *Last Will*, pero prueba
que la inserción también funciona por API REST pura.

== Protocolos utilizados

#figure(
  table(
    columns: (auto, auto, 1fr),
    stroke: 0.5pt + rgb("#E7E2DD"),
    inset: 7pt,
    [*Protocolo*], [*Tramo*], [*Para qué*],
    [MQTT (TCP 1883 / TLS 8883)], [ESP32 ↔ Mosquitto ↔ API],
      [Telemetría, estado de conexión y configuración retenida, con *QoS 1* en estado/config
       y *Last Will* para desconexión],
    [ESP-NOW], [Mando ↔ ESP32], [Órdenes manuales de baja latencia sin pasar por Wi-Fi ni
      por el backend; sigue funcionando si la red cae],
    [WebSocket (Socket.IO, `wss`)], [API ↔ Dashboard], [Telemetría, estado y configuración
      en tiempo real, autenticado con el JWT en el *handshake*],
    [HTTP/REST (JSON)], [Dashboard / robot ↔ API], [Login, historial, exportación CSV,
      administración y la vía alternativa de ingesta `POST /api/ingesta`],
  ),
  caption: [Protocolos de transporte usados en cada tramo del sistema.],
)

La justificación de usar MQTT en vez de solo REST para la telemetría, documentada en el
`README.md` del proyecto, se apoya en cuatro motivos: *latencia* (una conexión persistente
evita abrir TCP+TLS en cada envío a 2 Hz), *configuración sin sondeo* (el robot se suscribe a
`config` y recibe el cambio sin tener que preguntar), *detección de caída gratuita* (el *Last
Will* publica `en_linea: false` sin esperar un timeout) y *configuración retenida* (un robot
que arranca, o un dashboard que se abre, ven el estado vigente sin pedirlo).

== Descripción de componentes y sensores

El nodo físico es un *ESP32* con los siguientes componentes (pines reales de
`firmware/configuracion.py`):

#figure(
  table(
    columns: (auto, auto, 1fr),
    stroke: 0.5pt + rgb("#E7E2DD"),
    inset: 7pt,
    [*Componente*], [*Pines (ESP32)*], [*Función*],
    [3× HC-SR04 (ultrasónico)], [Izq. `TRIG 19 / ECHO 21`\ Centro `TRIG 5 / ECHO 18`\
      Der. `TRIG 22 / ECHO 23`], [Distancia a obstáculos de 2 a 400 cm (rango útil mostrado
      en el dashboard: 0–100 cm). Montados a −45°, 0° y +45° respecto al frente del robot],
    [Driver TB6612FNG (puente H)], [`PWMA 25, AIN1 26, AIN2 27`\ `PWMB 13, BIN1 14, BIN2 32`\
      `STBY 4`], [Control de dos motorreductores por PWM a 20 kHz, con sentido
      independiente por rueda (tracción diferencial)],
    [Divisor resistivo + ADC], [`PIN 34`, atenuación 11 dB], [Lectura del voltaje de batería;
      el factor del divisor y los límites de voltaje (6.0–8.4 V) se calibran en `configuracion.py`],
    [LED de estado], [reservado en el firmware], [Indicador visual del estado del robot],
    [ESP-NOW (radio interna del ESP32)], [sin pines externos], [Recepción de órdenes del
      mando; filtrable por MAC para aceptar solo un mando autorizado],
  ),
  caption: [Componentes y sensores del nodo IoT (mínimo exigido: tres sensores; implementados: tres HC-SR04 + batería).],
)

#figura(
  titulo: [Diagrama de conexión: ESP32, driver de motores, sensores ultrasónicos y batería.],
  canvas(length: 1cm, {
    import draw: *
    let caja(pos, w, h, etiqueta, color: white, tam: 7.5pt) = {
      rect((pos.at(0), pos.at(1)), (pos.at(0) + w, pos.at(1) + h), fill: color, stroke: 1pt + tinta, radius: 2pt)
      content((pos.at(0) + w / 2, pos.at(1) + h / 2), text(size: tam, etiqueta))
    }
    let pin(desde, hasta, etiqueta) = {
      line(desde, hasta, stroke: 0.8pt + rgb("#475569"))
      content(((desde.at(0) + hasta.at(0)) / 2, (desde.at(1) + hasta.at(1)) / 2 + 0.22),
        text(size: 6pt, fill: rgb("#475569"), etiqueta))
    }

    caja((6, 2.2), 4, 3, [*ESP32*], color: suave, tam: 10pt)

    caja((0, 5.6), 2.6, 1.1, [HC-SR04\ izquierdo (−45°)])
    caja((7, 6.6), 2.6, 1.1, [HC-SR04\ central (0°)])
    caja((13.5, 5.6), 2.6, 1.1, [HC-SR04\ derecho (+45°)])
    pin((1.3, 5.6), (6.8, 4.6), "TRIG 19 / ECHO 21")
    pin((8.3, 6.6), (8.3, 5.2), "TRIG 5 / ECHO 18")
    pin((14.8, 5.6), (10.2, 4.6), "TRIG 22 / ECHO 23")

    caja((0.3, 0.2), 4.2, 1.6, [TB6612FNG\ rueda izquierda], color: white)
    caja((13.6, 0.2), 4.2, 1.6, [TB6612FNG\ rueda derecha], color: white)
    pin((4.5, 1.2), (6, 2.6), "PWMA 25 / AIN1 26 / AIN2 27")
    pin((13.6, 1.2), (10, 2.6), "PWMB 13 / BIN1 14 / BIN2 32")

    caja((5.2, 0.4), 1.6, 0.9, [STBY])
    pin((6, 1.3), (7, 2.2), "GPIO 4")

    caja((8, -2.1), 3, 1.1, [Divisor resistivo\ + batería])
    pin((9.5, -1), (9.5, 2.2), "ADC 34 (atn. 11dB)")

    caja((2.8, 2.6), 1.8, 0.9, [LED estado])
  }),
)

El esquema anterior es la vista lógica de pines. El montaje real del nodo, tal como está
cableado hoy y como lo refleja `firmware/configuracion.py`, es el siguiente:

#figure(
  image("assets/image.png", width: 100%),
  caption: [Diagrama actual de conexiones del firmware: ESP32 alimentado desde dos celdas
    18650 a través de un regulador LM2596 (5 V), driver TB6612FNG hacia los dos motores TT, y
    los tres HC-SR04 con divisor resistivo en cada línea ECHO para adaptar los 5 V del sensor
    a los 3.3 V que tolera el ESP32.],
)

#nota[
  *Detalles del cableado que no se ven en el esquema de pines.* (1) Los HC-SR04 se alimentan a
  5 V —por debajo de eso el transductor pierde alcance—, pero su salida ECHO entrega 5 V, que
  el ESP32 no tolera: por eso cada ECHO pasa por un divisor resistivo antes de entrar al GPIO.
  Las líneas TRIG sí van directas, porque el sensor reconoce el pulso de 3.3 V como nivel alto.
  (2) La batería de dos celdas 18650 (6.0–8.4 V) alimenta al LM2596, que fija el riel de 5 V
  común para el ESP32, el driver y los sensores; los motores se alimentan de ese mismo riel a
  través del TB6612FNG. (3) Todas las masas —batería, regulador, driver, sensores y ESP32—
  están unidas a un único GND: sin esa referencia común las medidas de ECHO y del ADC de
  batería se vuelven ruidosas o directamente incorrectas.
]

// ===========================================================================
= Diseño de la Base de Datos

== Tipo de base de datos y justificación

El sistema usa *PostgreSQL* nativo en el VPS (sin Docker), administrado directamente por la
API con el cliente `pg`. Se eligió PostgreSQL —y no una solución gestionada tipo Supabase—
porque el proyecto corre en un VPS pequeño ya ocupado por Mosquitto, Node.js y Nginx/Caddy, y
porque las reglas de integridad del dominio (rangos de PWM y distancia, una sola sesión activa
por robot, configuración obligatoria por robot) se expresan de forma natural con
restricciones `CHECK`, índices únicos parciales y *triggers* del propio motor relacional,
sin depender de una capa externa.

#nota[
  *Nota sobre la rúbrica.* El documento original de requisitos pedía Supabase (PostgreSQL
  gestionado + su Auth + su API REST vía PostgREST). La implementación real usa PostgreSQL
  propio, autenticación propia (bcrypt + JWT) y una API REST propia en Express. La lógica es
  equivalente punto por punto —tablas relacionales, políticas de acceso por propietario,
  inserción/lectura por API REST, JWT de sesión— pero sin depender de un proveedor externo,
  lo cual es preferible en un VPS de bajo consumo donde no conviene añadir una dependencia de
  red más al camino crítico.
]

== Estructura de tablas y campos

El esquema completo vive en `apps/api/db/schema.sql` y se aplica desde cero con
`pnpm db:reset`. Cinco tablas cubren todo el dominio:

#figure(
  table(
    columns: (auto, 1fr),
    stroke: 0.5pt + rgb("#E7E2DD"),
    inset: 7pt,
    [*Tabla*], [*Qué guarda*],
    [`usuarios`], [Cuentas que entran al dashboard: correo, hash bcrypt de la contraseña,
      nombre, rol (`admin` / `cliente`) y si está activa],
    [`dispositivos`], [Un robot físico. Su `id` de texto es a la vez el usuario MQTT
      (`roomba-sala`, …), con hash bcrypt de su token, estado de conexión y versión de
      firmware],
    [`configuracion_dispositivo`], [Relación 1 a 1 con `dispositivos`: PWM de crucero y
      ángulos de montaje de los tres sensores. Es lo único que el robot "obedece"],
    [`sesiones`], [Un ciclo de funcionamiento del robot: inicio, fin (`NULL` = activa),
      total de lecturas y batería al inicio/fin],
    [`lecturas`], [Telemetría: una fila por mensaje publicado por el ESP32 — distancia de
      cada sensor, PWM con signo de cada rueda, voltaje y porcentaje de batería],
  ),
  caption: [Tablas del esquema relacional.],
)

#figura(
  titulo: [Diagrama entidad-relación del esquema (`apps/api/db/schema.sql`).],
  canvas(length: 1cm, {
    import draw: *
    let entidad(pos, w, h, titulo, campos) = {
      rect((pos.at(0), pos.at(1)), (pos.at(0) + w, pos.at(1) + h), fill: white, stroke: 1pt + tinta, radius: 2pt)
      rect((pos.at(0), pos.at(1) + h - 0.6), (pos.at(0) + w, pos.at(1) + h), fill: suave, stroke: 1pt + tinta, radius: 2pt)
      content((pos.at(0) + w / 2, pos.at(1) + h - 0.3), text(size: 8pt, weight: "bold", titulo))
      for (i, c) in campos.enumerate() {
        content((pos.at(0) + 0.15, pos.at(1) + h - 1 - i * 0.42), anchor: "west", text(size: 6.3pt, c))
      }
    }
    let rel(a, b, et) = {
      line(a, b, stroke: 1pt + rgb("#475569"))
      content(((a.at(0)+b.at(0))/2, (a.at(1)+b.at(1))/2 + 0.2), text(size: 6pt, fill: rgb("#475569"), et))
    }

    entidad((0, 6.4), 4.4, 2.6, "usuarios", ("id PK", "correo UK", "contrasena (bcrypt)", "rol"))
    entidad((6, 6.4), 4.6, 2.6, "dispositivos", ("id PK (= usuario MQTT)", "usuario_id FK", "token_hash", "en_linea"))
    entidad((12.2, 8.6), 4.6, 2, "configuracion_dispositivo", ("dispositivo_id PK/FK", "velocidad_base", "angulos_sensores"))
    entidad((12.2, 5), 4.6, 2, "sesiones", ("id PK", "dispositivo_id FK", "finalizada_en (NULL=activa)"))
    entidad((6, 0.2), 8.2, 2.6, "lecturas", ("id PK", "dispositivo_id FK · sesion_id FK", "distancia_*_cm (NULL=sin eco)", "movimiento_izquierda/derecha (-255..255)"))

    rel((4.4, 7.7), (6, 7.7), "1 — 0..*")
    rel((10.6, 9.2), (12.2, 9.2), "1 — 1")
    rel((10.6, 6.5), (12.2, 6.5), "1 — 0..*")
    rel((8.2, 6.4), (10.5, 2.8), "1 — 0..*")
    rel((14, 5), (12, 2.8), "1 — 0..*")
  }),
)

== Restricciones y tipos de datos

Las reglas de integridad viven en la propia base, no solo en el código de la API:

- `rol CHECK (rol IN ('admin','cliente'))` en `usuarios`.
- `movimiento_izquierda`/`movimiento_derecha SMALLINT CHECK (… BETWEEN -255 AND 255)` en
  `lecturas`: el PWM con signo nunca puede salirse de la escala real del driver.
- `distancia_*_cm NUMERIC(5,1) CHECK (… BETWEEN 0 AND 400)`: rango físico del HC-SR04;
  `NULL` significa explícitamente "el eco no volvió", no "falta el dato".
- `bateria_porcentaje SMALLINT CHECK (… BETWEEN 0 AND 100)`.
- Índice único parcial `uniq_sesion_activa_por_dispositivo ON sesiones (dispositivo_id)
  WHERE finalizada_en IS NULL`: impone a nivel de base que *un robot no puede tener dos
  sesiones abiertas a la vez*.
- `ON DELETE CASCADE` en toda la jerarquía usuarios → dispositivos → configuración / sesiones
  → lecturas: borrar una cuenta no deja filas huérfanas.
- *Trigger* `trg_configuracion_por_defecto`: al insertar un `dispositivo`, crea automáticamente
  su fila de `configuracion_dispositivo`, así el resto del código puede asumir que siempre
  existe.
- Tres *vistas* (`v_lecturas_por_minuto`, `v_lecturas_por_hora`, `v_resumen_sesion`) agregan la
  telemetría en el propio motor de base de datos para no mandar miles de filas crudas al
  navegador en cada gráfica.

== Seguridad (control de acceso a los datos)

El esquema no usa *Row Level Security* de PostgreSQL porque el acceso se decide en la API, no
en consultas directas del cliente a la base: el dashboard nunca habla con PostgreSQL
directamente, solo con la API REST y el WebSocket, que son los únicos procesos con
credenciales de base de datos. La política de acceso equivalente a RLS se aplica en dos capas:

1. *Autenticación*: todo endpoint de datos exige un JWT válido (`requireAuth`), que se
  revalida contra la tabla `usuarios` en cada petición —no solo contra la firma del token—
  para que una cuenta desactivada o con el rol cambiado pierda el acceso de inmediato, sin
  esperar a que caduque el token.
2. *Autorización por propiedad*: `exigirPropiedad(dispositivoId, usuario)` comprueba en cada
  ruta de `datos.ts` que el robot pedido pertenece al usuario autenticado, salvo que su rol
  sea `admin`. La misma comprobación (`puedeVer`) se aplica al unirse a una sala de Socket.IO,
  para que la telemetría de un robot no llegue a un navegador que no es su propietario.

Las contraseñas de usuario se guardan con *bcrypt* (factor de coste 10) y nunca en claro; el
token MQTT de cada robot también se guarda como hash bcrypt, y solo se muestra en texto claro
una vez, al crear el robot desde el dashboard.

// ===========================================================================
= Integración mediante API REST

== Uso de la API REST

La API expone rutas bajo el prefijo `/api`, agrupadas por responsabilidad: `auth.ts`
(registro/login), `dispositivos.ts` (alta y gestión de robots), `datos.ts` (lecturas,
sesiones, configuración, estadísticas) e `ingesta.ts` (inserción alternativa por HTTP).
Todas las rutas de datos pasan por el middleware `requireAuth` y, cuando aplica, por
`exigirPropiedad`.

#figure(
  table(
    columns: (auto, 1fr),
    stroke: 0.5pt + rgb("#E7E2DD"),
    inset: 6.5pt,
    [*Método y ruta*], [*Función*],
    [`POST /api/auth/signup` · `/auth/login`], [Registro e inicio de sesión; devuelven un JWT],
    [`POST /api/ingesta`], [Inserción de lotes de lecturas vía REST, autenticada con el
      token del robot],
    [`GET /api/dispositivos/:id/lecturas`], [Lectura cruda o agregada (`raw` / `minuto` /
      `hora`) por rango de fechas],
    [`GET /api/dispositivos/:id/lecturas/export.csv`], [Exportación a CSV del mismo rango],
    [`GET /api/dispositivos/:id/sesiones`], [Historial de sesiones de limpieza del robot],
    [`GET` / `PATCH /api/dispositivos/:id/configuracion`], [Lectura y cambio del PWM de
      crucero y los ángulos de los sensores],
    [`GET /api/dispositivos/:id/resumen`], [Estadísticas del día y acumuladas: tiempo en
      marcha, batería actual, mensajes por segundo],
    [`GET /api/salud`], [Estado de PostgreSQL, Mosquitto, tamaño del buffer de persistencia
      y clientes WebSocket conectados],
  ),
  caption: [Rutas principales de la API REST (`apps/api/src/routes/`).],
)

== Inserción de datos (POST)

`POST /api/ingesta` acepta lotes de hasta 200 lecturas, validadas con el mismo esquema Zod que
usa el puente MQTT (`telemetriaSchema`), para que ambos caminos de entrada —MQTT y REST—
terminen en la misma función `procesarTelemetria`:

```http
POST /api/ingesta
Authorization: Bearer SalaDemoToken0123456789abcdefgh
Content-Type: application/json

{
  "dispositivoId": "roomba-sala",
  "lecturas": [{
    "distancias_cm": { "izquierdo": 42.5, "central": 18.0, "derecho": null },
    "bateria_v": 7.8,
    "motores": { "izquierda_pwm": 180, "derecha_pwm": 180 }
  }]
}
```

El token se compara con `bcrypt.compare` contra el hash guardado en `dispositivos.token_hash`,
con una caché en memoria de 5 minutos por robot para no pagar el coste de bcrypt (~100 ms) en
cada lote recibido cada segundo.

== Lectura de datos (GET)

```bash
curl -H "Authorization: Bearer <jwt-de-usuario>" \
  "https://<host>/api/dispositivos/roomba-sala/lecturas?agregacion=minuto&desde=2026-10-10T00:00:00Z"
```

El parámetro `agregacion` decide si la respuesta sale de la tabla cruda `lecturas` (para
ventanas cortas, p. ej. el panel en vivo) o de una de las vistas agregadas
`v_lecturas_por_minuto` / `v_lecturas_por_hora` (para rangos largos, como el historial), con un
límite máximo de 5000 filas por respuesta.

== Manejo de errores

Todas las rutas comparten un error handler centralizado (`http.ts`): los errores de validación
Zod se traducen a `400` con un mensaje por campo, los errores de negocio se lanzan como
`HttpError(status, mensaje)` con el código HTTP correcto (`401` sin token o credenciales
incorrectas, `403` cuenta desactivada o ruta de administrador, `404` recurso inexistente,
`409` correo duplicado) y cualquier error no previsto cae en un `500` genérico que se registra
en el log del servidor sin filtrar detalles internos al cliente.

```ts
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, fields: err.fields });
    return;
  }
  // ...
  res.status(500).json({ error: "Error interno del servidor." });
};
```

El puente MQTT aplica la misma filosofía del lado del transporte: ningún mensaje mal formado
puede tumbar el proceso. Un payload que no es JSON válido, o que no pasa el esquema Zod, se
registra en el log y se descarta; el robot que lo envió sigue publicando normalmente en el
siguiente ciclo.

// ===========================================================================
= Desarrollo en MicroPython

== Configuración de red

`firmware/conexion_wifi.py` conecta el ESP32 en modo estación (`network.STA_IF`) con un
*timeout* explícito de 10 segundos; si no logra conectar, lanza `OSError` y el programa
principal lo captura sin detenerse: el robot sigue esquivando obstáculos y aceptando órdenes
por ESP-NOW aunque no tenga Wi-Fi ni MQTT.

```python
def conectar_wifi():
    wifi = network.WLAN(network.STA_IF)
    wifi.active(True)
    if not wifi.isconnected():
        wifi.connect(cfg.WIFI_SSID, cfg.WIFI_CLAVE)
        inicio = time.ticks_ms()
        while not wifi.isconnected():
            if time.ticks_diff(time.ticks_ms(), inicio) > 10000:
                raise OSError("Tiempo agotado al conectar Wi-Fi")
            time.sleep_ms(100)
    return wifi
```

== Lectura de datos (mínimo tres variables)

El bucle principal (`main.py`) actualiza *un sensor ultrasónico por iteración* (ronda
rotativa entre izquierdo, central y derecho cada ≥15 ms) para no bloquear el resto del
programa con los hasta 12 ms que puede tardar un `HC-SR04` en responder, y lee la batería en
la misma cadencia:

```python
if time.ticks_diff(ahora, ultima_lectura) >= 15:
    ultima_lectura = ahora
    sensores.actualizar_un_sensor()
    voltaje_bateria, porcentaje_bateria = sensores.leer_bateria()
```

Las *tres variables mínimas exigidas* que el robot reporta son, por tanto: distancia de
cada uno de los tres sensores (`distancias_cm`), voltaje/porcentaje de batería (`bateria_v`,
`bateria_porcentaje`) y el PWM con signo de cada motor (`motores.izquierda_pwm/derecha_pwm`),
además del estado del receptor ESP-NOW.

== Envío de datos

Cada `INTERVALO_MQTT_MS` (500 ms por defecto, 2 Hz) el firmware publica un único JSON por MQTT
en `roomba/{ROBOT_ID}/telemetria`:

```python
datos = {
    "robot_id": cfg.ROBOT_ID,
    "distancias_cm": sensores.obtener_distancias(),
    "bateria_v": voltaje_bateria,
    "bateria_porcentaje": porcentaje_bateria,
    "motores": motores.obtener_estado(),
    "espnow": radio.obtener_estado(),
}
mqtt.publicar_telemetria(datos)
```

Las claves del diccionario son las mismas que valida el backend y las mismas que terminan
como columnas en PostgreSQL: el esquema de la base *es* el JSON del robot, sin traducir
nombres por el camino.

== Manejo de errores y reconexión

`ClienteMQTT` (`comunicacion_mqtt.py`) encapsula tres mecanismos de resiliencia:

1. *Last Will*: al conectar, registra un mensaje retenido (`en_linea: false`) que Mosquitto
  publica automáticamente si el robot se desconecta sin avisar (corte de energía, pérdida de
  señal). El backend lo usa para marcar el robot fuera de línea sin necesitar un *timeout*.
2. *Reconexión con espera fija de 5 s*: `intentar_reconectar()` se llama en cada vuelta del
  bucle principal; si no está conectado y pasaron ≥5000 ms desde el último intento, reconecta.
  No bloquea el bucle: los sensores y motores siguen funcionando mientras tanto.
3. *Degradación explícita*: si `umqtt.simple` no está instalado, o Wi-Fi no conecta, el error
  se captura en `main.py` y se imprime, pero el programa continúa. La prioridad en el bucle es
  siempre: 1) órdenes ESP-NOW y seguridad, 2) sensores, 3) telemetría MQTT — en ese orden, así
  que un fallo de red nunca compromete la evasión de obstáculos.

```python
def intentar_reconectar(self):
    if self.conectado:
        return
    if time.ticks_diff(time.ticks_ms(), self.ultimo_intento_ms) < 5000:
        return
    self.ultimo_intento_ms = time.ticks_ms()
    try:
        self.conectar()
    except Exception as error:
        self.desconectar()
        print("MQTT no disponible:", error)
```

Adicionalmente, `motores.py` aplica un *tiempo de parada de seguridad*
(`TIEMPO_PARADA_MS = 250`): si no llega ninguna orden nueva en ese plazo, el robot detiene los
motores, para no seguir avanzando a ciegas si pierde la comunicación con su mando.

// ===========================================================================
= Sistema de Autenticación

== Registro e inicio de sesión

El registro (`POST /api/auth/signup`) valida con Zod un nombre (2–80 caracteres), un correo
(normalizado a minúsculas) y una contraseña de al menos 8 caracteres con letra y número, y
confirma que coincide con su repetición. La contraseña se guarda con *bcrypt* (factor 10);
toda cuenta nueva se crea con rol `cliente`. El inicio de sesión (`POST /api/auth/login`)
compara la contraseña con `bcrypt.compare` y rechaza cuentas desactivadas (`activo = false`)
con un `403` explícito.

```ts
const hash = await bcrypt.hash(body.password, 10);
await pool.query(
  `INSERT INTO usuarios (correo, contrasena, nombre, rol)
   VALUES ($1, $2, $3, 'cliente') RETURNING ...`,
  [body.email, hash, body.name],
);
```

== Gestión de sesiones

La sesión de usuario se mantiene con un *JWT firmado* (`jsonwebtoken`, `HS256`), con
expiración de 12 horas, emitido en login/registro y enviado por el cliente en la cabecera
`Authorization: Bearer <token>`. A diferencia de un JWT "ciego", `userFromToken` *relee el
usuario en PostgreSQL en cada petición* (`WHERE id = $1 AND activo`): si un administrador
desactiva una cuenta o le cambia el rol, el acceso se corta en la siguiente petición, sin
esperar a que el token expire. La misma verificación protege el *handshake* de Socket.IO, y
`disconnectUser(id)` desconecta activamente los sockets abiertos de un usuario que deja de
tener acceso.

== Seguridad de acceso

- Contraseñas y tokens de robot nunca se guardan en claro (bcrypt).
- El rol (`admin` / `cliente`) se valida tanto a nivel de esquema (`CHECK`) como de
  aplicación (`requireAdmin` como middleware de Express).
- Separación de identidades: el JWT de usuario autentica al *dashboard*; el token bcrypt
  del robot autentica al *ESP32* (vía MQTT, con su propia credencial en Mosquitto, o vía
  `Bearer` en `POST /api/ingesta`). Un ESP32 nunca inicia sesión como usuario.
- Autorización por propiedad en cada recurso (`exigirPropiedad`), no solo autenticación: estar
  logueado no implica poder ver los robots de otra cuenta.
- Un usuario `admin` puede resetear la contraseña de otro usuario desde el panel de
  administración: cubre la recuperación de cuenta mientras el flujo de correo (`/recuperar`)
  no tiene un servidor SMTP configurado, limitación que el propio `README.md` declara
  abiertamente en vez de simular un envío de correo que no ocurre.

// ===========================================================================
= Dashboard en Tiempo Real

== Diseño del dashboard

El frontend (`apps/web`) es una aplicación React + Vite + TailwindCSS, estructurada en páginas
(`Login`, `Registro`, `Panel`, `Historial`, `Sesiones`, `Robots`, `Perfil`, y el panel de
administración `PanelAdmin` / `Usuarios` / `RobotsAdmin`) y un conjunto de componentes de
tarjeta reutilizables para cada magnitud: `TarjetaBateria`, `TarjetaDistancias`,
`TarjetaBarrasDistancia`, `RadarSensores`, `TarjetaActividadMotor`, `TarjetaConectividad`,
`TarjetaSesiones`, `TarjetaContador` y `TarjetaEstado`.

== Visualización de datos

Las gráficas se construyen con *Chart.js*, registrado una sola vez en `lib/chart.ts` para
evitar el error clásico de "controller no registrado" al añadir un gráfico nuevo. El panel
combina varios tipos de visualización sobre la misma telemetría:

- *Radar* de los tres sensores de distancia, posicionado según los ángulos reales de montaje
  (`angulos_sensores`), coloreado con los umbrales `DIST_EVASION_CM = 15 cm` (rojo) y
  `DIST_PRECAUCION_CM = 30 cm` (ámbar).
- *Serie de líneas* de distancia en el tiempo, con zoom y *pan* (`chartjs-plugin-zoom`).
- *Gauge* de batería.
- *Barra de cadencia* de conectividad (última lectura frente a la cadencia esperada).

Las siguientes son capturas reales del panel en producción (`https://iot-dashboard.tumype.com/`,
cuenta `alvaro@demo.com`). Como en ese momento no hay ningún robot ni simulador publicando,
las gráficas aparecen vacías — es el estado real que vería cualquier visitante del enlace, no
uno maquillado con datos de relleno:

#figura(
  titulo: [Radar de sensores, con los tres sectores (izquierdo, central, derecho) según los
    ángulos reales de `angulos_sensores`.],
  image("assets/cap-panel-grafico-radar.png", width: 100%),
)

#figura(
  titulo: [Historial de distancias: serie de líneas de los últimos 5 minutos, con las líneas
    de umbral `DIST_EVASION_CM = 15` y `DIST_PRECAUCION_CM = 30`. Sin datos porque el robot
    está fuera de línea en el momento de la captura.],
  image("assets/cap-panel-grafico-historial.png", width: 100%),
)

#figura(
  titulo: [Gauge de batería del robot activo.],
  image("assets/cap-panel-grafico-bateria.png", width: 100%),
)

#figura(
  titulo: [Tarjeta de conectividad: mensajes por segundo, última lectura y cadencia
    esperada.],
  image("assets/cap-panel-grafico-conectividad.png", width: 100%),
)

== Actualización en tiempo real

El dashboard se conecta al *namespace* `/live` de Socket.IO al cargar un robot: envía su JWT
en el `handshake.auth.token`, se une a la sala `robot:{id}` y recibe de golpe el *estado
inicial* (conexión, configuración y hasta 50 últimas lecturas en memoria), para no arrancar
con el panel vacío esperando la próxima lectura. A partir de ahí, cada evento `telemetria` que
emite el servidor actualiza las gráficas sin recargar la página ni volver a pedir datos por
REST. Las animaciones de Chart.js están deshabilitadas globalmente (`Chart.defaults.animation
= false`) porque compiten con actualizaciones a 2 Hz: una animación de 400 ms no llega a
terminar antes de que entre el siguiente punto.

El reloj del navegador se sincroniza contra el del servidor (`sincronizar_reloj`) para que la
latencia mostrada en la tarjeta de conectividad mida el retraso real del mensaje y no el
desfase entre dos relojes de sistema distintos.

== Interactividad

- *Zoom y desplazamiento* en las gráficas de series temporales (`chartjs-plugin-zoom`).
- *Filtros de rango e agregación* en el historial (`raw` / `minuto` / `hora`, fecha
  "desde"/"hasta"), con exportación a CSV del mismo rango filtrado.
- *Edición de configuración* del robot (velocidad de crucero, ángulos de sensor) desde el
  panel, que se envía por `actualizar_config` por WebSocket y se retransmite al robot como
  mensaje retenido en el tópico `config`.
- *Alta de robots* (`DialogoNuevoRobot`): genera el `ROBOT_ID` y el token MQTT, y entrega al
  usuario un `config.py` listo para copiar al firmware. El token se guarda cifrado
  (AES-256-GCM con clave derivada del `JWT_SECRET`), así que su dueño puede volver a
  consultarlo en «Credenciales» sin regenerarlo.
- *Modo oscuro* y vistas responsivas (comprobadas en 375 px, 768 px y 1440 px de ancho, ver
  anexos).

== Manejo de errores

El cliente de socket reintenta la conexión automáticamente (reconexión nativa de Socket.IO) y
la tarjeta de conectividad refleja en vivo si el robot está `en_linea` según el último evento
de *Last Will* o de estado recibido. Si el *handshake* no trae un JWT válido, el middleware de Socket.IO
rechaza la conexión antes de que se una a ninguna sala (`next(new Error('unauthorized'))`), y
el cliente HTTP (`lib/api.ts`) traduce cualquier respuesta `4xx`/`5xx` de la API en un mensaje
de error visible al usuario (vía `toast.tsx`) en vez de fallar en silencio.

// ===========================================================================
= Conclusiones

== Resultados obtenidos

El sistema cubre de punta a punta los seis requisitos de evaluación: un nodo IoT con tres
sensores y dos motores controlados por PWM, una base de datos relacional con reglas de
integridad resueltas en el propio motor, inserción y lectura por API REST (tanto vía MQTT como
vía HTTP directo), un script MicroPython que lee los sensores y envía los datos con
reconexión automática, un sistema de autenticación propio con bcrypt + JWT, y un dashboard en
React que visualiza la telemetría en tiempo real con gráficas de Chart.js y permite consultar
el historial de sesiones. El diseño prioriza una latencia baja en el camino en vivo (emitir
por WebSocket antes de tocar la base de datos) y una base de datos que *solo guarda lo que el
hardware puede medir de verdad*, sin inventar campos "por si acaso".

== Problemas y soluciones

#figure(
  table(
    columns: (1fr, 1fr),
    stroke: 0.5pt + rgb("#E7E2DD"),
    inset: 7pt,
    [*Problema*], [*Solución adoptada*],
    [El robot no tiene encoders ni GPS: no se puede calcular su posición de forma fiable.],
    [Se eliminó del esquema toda columna de pose (`pos_x_cm`, `pos_y_cm`, `orientacion_deg`)
      en vez de simularla; el estado de movimiento se deduce del PWM real de los motores.],

    [Guardar cada lectura inmediatamente en PostgreSQL añadía latencia al camino en vivo.],
    [Se invirtió el orden: emitir por WebSocket primero, y solo encolar la escritura en un
      buffer que se vacía por lotes cada segundo.],

    [Un mensaje MQTT mal formado (firmware con un bug) podía propagar una excepción y tumbar
      el proceso de la API.],
    [Todo el camino de entrada (`manejar()`, `procesarTelemetria`) captura y registra
      cualquier error sin relanzarlo; el robot que lo causó sigue publicando en el siguiente
      ciclo sin reiniciar la API.],

    [Un `estado_movimiento` de texto mantenido a mano por el firmware podía desincronizarse
      de lo que hacían realmente los motores.],
    [Se sustituyó por las dos columnas de PWM con signo, y el estado se deduce siempre con la
      misma función (`movimiento()` en `@iot/shared`), igual en el backend y en el frontend.],

    [Comparar bcrypt en cada lote de `POST /api/ingesta` (varias veces por segundo por robot)
      resultaba costoso para la CPU.],
    [Caché en memoria del hash del token por robot, con una expiración de 5 minutos para que
      una regeneración de credenciales siga surtiendo efecto sin reiniciar la API.],
  ),
  caption: [Problemas de diseño encontrados durante el desarrollo y cómo se resolvieron.],
)

== Aprendizaje logrado

El proyecto deja tres lecciones de ingeniería aplicables más allá de este robot concreto:
primero, que la *latencia percibida* de un sistema en tiempo real depende del orden en que
se hacen las cosas, no solo de la velocidad de cada pieza por separado (emitir antes de
persistir). Segundo, que un esquema de base de datos es más robusto cuando *se niega a
guardar lo que no se puede medir* en vez de rellenar el hueco con una estimación poco
fiable —la pose por odometría sin encoders siendo el ejemplo central—. Y tercero, que separar
con claridad las identidades de un sistema (JWT de usuario del dashboard, token bcrypt del
robot vía MQTT/HTTP) simplifica la seguridad más que intentar unificar todo bajo un único
mecanismo de autenticación.

// ===========================================================================
= Anexos

== Código fuente

Repositorio completo (monorepo `pnpm`):
#link("https://github.com/alvaro-tc/iot_dashboard")[github.com/alvaro-tc/iot\_dashboard].

Despliegue en producción, en vivo:
#link("https://iot-dashboard.tumype.com/")[iot-dashboard.tumype.com] — cuentas de
demostración en `docs/cuentas-de-prueba.md` (`alvaro@demo.com` / `cliente123` y
`admin@demo.com` / `admin123`).

Secciones citadas a lo largo de este informe —

- Esquema de base de datos: `apps/api/db/schema.sql`, datos de demostración:
  `apps/api/db/seed.sql`.
- API REST y puente MQTT: `apps/api/src/routes/*.ts`, `apps/api/src/mqtt/bridge.ts`,
  `apps/api/src/ws.ts`, `apps/api/src/telemetria.ts`, `apps/api/src/auth.ts`.
- Firmware MicroPython: `firmware/main.py`, `sensores.py`, `motores.py`,
  `comunicacion_mqtt.py`, `conexion_wifi.py`, `radio_espnow.py`, `configuracion.py`.
- Dashboard: `apps/web/src/pages/`, `apps/web/src/components/`, `apps/web/src/lib/`.
- Geometría y simulación compartidas: `packages/shared/src/robot.ts`,
  `packages/shared/src/simulacion.ts`.
- Infraestructura de despliegue (VPS sin Docker): `infra/`.

== Capturas de pantalla

#figure(
  image("../../_ppt_assets/cap-login.png", width: 85%),
  caption: [Pantalla de inicio de sesión.],
)
#figure(
  image("../../_ppt_assets/cap-registro.png", width: 85%),
  caption: [Pantalla de registro de una cuenta nueva.],
)
#figure(
  image("../../_ppt_assets/cap-panel-completo.png", width: 100%),
  caption: [Panel en tiempo real de un robot: radar de sensores, series de distancia,
    batería, actividad de motores y conectividad.],
)
#figure(
  image("../../_ppt_assets/cap-historial-completo.png", width: 100%),
  caption: [Historial de telemetría con filtros de rango y agregación.],
)
#figure(
  image("../../_ppt_assets/cap-sesiones-completo.png", width: 100%),
  caption: [Listado de sesiones de limpieza con su resumen (duración, batería consumida,
    obstáculos cercanos por sensor).],
)
#figure(
  image("../../_ppt_assets/cap-robots.png", width: 85%),
  caption: [Gestión de robots del usuario: alta, token MQTT y estado de conexión.],
)
#figure(
  image("../../_ppt_assets/cap-admin.png", width: 85%),
  caption: [Panel de administración: usuarios y robots de todas las cuentas.],
)

== Capturas del despliegue en producción

Las siguientes capturas se tomaron directamente del despliegue en vivo
(`https://iot-dashboard.tumype.com/`), entrando con las cuentas de demostración de
`docs/cuentas-de-prueba.md` (`alvaro@demo.com` y `admin@demo.com`). Como en el VPS no hay un
robot físico ni el simulador publicando en ese momento, los robots aparecen *fuera de línea*
con batería y telemetría de la última sesión registrada — el estado real que vería cualquier
visitante del enlace, sin maquillar.

#figure(
  image("assets/cap-panel-radar.jpg", width: 85%),
  caption: [Panel en producción, cuenta `alvaro@demo.com`: radar de los tres sensores e
    historial de distancias de `Roomba Sala`.],
)
#figure(
  image("assets/cap-panel-estado-bateria.jpg", width: 85%),
  caption: [Panel en producción (continuación al desplazar): estado del robot, PWM de cada
    rueda y gauge de batería.],
)
#figure(
  image("assets/cap-panel-conectividad-sesiones.jpg", width: 85%),
  caption: [Panel en producción (continuación): tarjeta de conectividad (mensajes/s,
    cadencia esperada) y listado de sesiones recientes.],
)
#figure(
  image("assets/cap-panel-oscuro.jpg", width: 85%),
  caption: [El mismo panel en modo oscuro.],
)
#figure(
  image("assets/cap-historial-live.jpg", width: 85%),
  caption: [Historial en producción: distancia mínima por hora y marcha/parada, agregados en
    PostgreSQL por `v_lecturas_por_hora`.],
)
#figure(
  image("assets/cap-sesiones-live.jpg", width: 85%),
  caption: [Sesiones de limpieza reales del robot de demostración, con su resumen de
    duración, batería consumida y PWM medio.],
)
#figure(
  image("assets/cap-robots-live.jpg", width: 85%),
  caption: [Robots de la cuenta `alvaro@demo.com` en producción: `roomba-sala` y
    `roomba-cocina`, ambos fuera de línea por falta de hardware/simulador conectado.],
)
#figure(
  image("assets/cap-admin-dashboard.jpg", width: 85%),
  caption: [Panel de administración en producción (`admin@demo.com`): 2 clientes, 3 robots,
    0 en línea y 0 sesiones activas en el momento de la captura.],
)
#figure(
  image("assets/cap-admin-usuarios.jpg", width: 85%),
  caption: [Gestión de usuarios en producción: las tres cuentas de demostración con su rol,
    número de robots y sesiones.],
)

// ===========================================================================
= Referencias

- Repositorio del proyecto. #link("https://github.com/alvaro-tc/iot_dashboard")
- Despliegue en producción. #link("https://iot-dashboard.tumype.com/")
- PostgreSQL 16 — Documentación oficial. #link("https://www.postgresql.org/docs/")
- MQTT Version 5.0 — OASIS Standard. #link("https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html")
- Eclipse Mosquitto — Documentación. #link("https://mosquitto.org/documentation/")
- Express.js — Guía de referencia. #link("https://expressjs.com/")
- Socket.IO — Documentación. #link("https://socket.io/docs/v4/")
- React — Documentación oficial. #link("https://react.dev/")
- Chart.js — Documentación. #link("https://www.chartjs.org/docs/latest/")
- MicroPython — Documentación para ESP32. #link("https://docs.micropython.org/en/latest/esp32/quickref.html")
- Espressif — ESP-NOW Protocol Guide. #link("https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/network/esp_now.html")
- JSON Web Tokens (RFC 7519). #link("https://datatracker.ietf.org/doc/html/rfc7519")
- bcrypt — *A Future-Adaptable Password Scheme*, Provos & Mazières (USENIX 1999).
- Zod — Validación de esquemas TypeScript. #link("https://zod.dev/")
- HC-SR04 Ultrasonic Ranging Module — hoja de datos del fabricante.
- TB6612FNG — hoja de datos, Toshiba (driver de puente H dual).
