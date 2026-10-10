# Prompts para generar las imágenes explicativas

Siete prompts, uno por imagen: seis tablas + el diagrama UML general. Cada uno se usa
adjuntando una imagen de referencia de estilo (el prompt ya empieza pidiéndolo).

**Regla que llevan todos:** el protagonista de la imagen es **la tabla dibujada como tabla
real** — rejilla con fila de encabezado (los nombres de columna exactos) y 2–3 filas de datos
de ejemplo. Las ilustraciones solo rodean esa tabla y se conectan a ella con flechas; nunca la
sustituyen. Poco texto: etiquetas de 1 a 4 palabras, sin párrafos.

---

## 1. Tabla `users` — cuentas

> Usa como template a esta imagen. Genera una ilustración explicativa, limpia y con **muy poco
> texto**, sobre la tabla `users` de una base de datos PostgreSQL de un dashboard de robots
> aspiradores.
>
> **El elemento central y más grande debe ser la tabla dibujada como una tabla real**: rejilla
> con fila de encabezado y 2 filas de datos de ejemplo. Título arriba: `users`. Columnas
> exactas, en este orden:
> `id` | `email` | `password` | `name` | `role` | `is_active` | `created_at`
> Filas de ejemplo:
> `1` | `admin@demo.com` | `$2b$10$…` | `Administración` | `admin` | `true` | `2026-09-01`
> `2` | `alvaro@demo.com` | `$2b$10$…` | `Álvaro Quispe` | `client` | `true` | `2026-09-26`
> Marca `id` con una llave 🔑 en el encabezado y `email` con la etiqueta pequeña "único".
>
> Alrededor de la tabla, anotaciones cortas unidas con flechas a la columna que explican:
> - de `password`, un candado: "hash bcrypt"
> - de `role`, dos avatares: uno con corona `admin` → "ve todo"; otro sencillo `client` → "solo sus robots"
> - de `is_active`, un interruptor en OFF: "desactivar sin borrar"
>
> Estilo: diagrama vectorial plano, fondo claro, 2–3 colores de acento, tipografía sans-serif,
> encabezado de tabla con fondo de color. Formato horizontal 16:9.

---

## 2. Tabla `dispositivos` — el robot

> Usa como template a esta imagen. Genera una ilustración explicativa con **muy poco texto**
> sobre la tabla `dispositivos`: cada fila es un robot aspirador físico y, a la vez, su
> identidad MQTT.
>
> **El elemento central y más grande debe ser la tabla dibujada como una tabla real**: rejilla
> con fila de encabezado y 2 filas de ejemplo. Título arriba: `dispositivos`. Columnas exactas:
> `id` 🔑 | `user_id` | `nombre` | `ubicacion` | `token_hash` | `is_revoked` | `en_linea` | `ultimo_contacto` | `version_firmware` | `creado_en`
> Filas de ejemplo:
> `roomba-sala` | `2` | `Roomba Sala` | `Sala de estar` | `$2b$10$…` | `false` | `true` | `10:42:07` | `1.2.0` | `2026-09-26`
> `roomba-cocina` | `2` | `Roomba Cocina` | `Cocina` | `$2b$10$…` | `false` | `false` | `09:15:30` | `1.2.0` | `2026-10-04`
>
> Alrededor, unido con flechas a la columna correspondiente:
> - a la izquierda, un robot aspirador redondo visto desde arriba, con flecha hacia la celda `roomba-sala`
> - de `user_id`, flecha a una tabla pequeña `users`: "dueño"
> - de `token_hash`, un candado: "hash bcrypt"
> - de `en_linea`, un punto verde y uno gris
> - a la derecha, un icono de broker MQTT con el tópico `roomba/{id}/#` y flecha desde `id`: "el id es el usuario MQTT"
>
> Estilo: diagrama vectorial plano, fondo claro, 2–3 colores de acento, encabezado de tabla con
> fondo de color, etiquetas de 1 a 4 palabras. Formato horizontal 16:9.

---

## 3. Tabla `configuracion_dispositivo` — lo que el robot obedece

> Usa como template a esta imagen. Genera una ilustración explicativa con **muy poco texto**
> sobre la tabla `configuracion_dispositivo`: una sola fila por robot (relación 1 a 1) con los
> parámetros que el robot obedece.
>
> **El elemento central y más grande debe ser la tabla dibujada como una tabla real**: rejilla
> con fila de encabezado y 2 filas de ejemplo. Título arriba:
> `configuracion_dispositivo`. Columnas exactas:
> `dispositivo_id` 🔑 | `modo` | `distancia_evasion_cm` | `distancia_precaucion_cm` | `velocidad_base_pct` | `intervalo_telemetria_ms` | `angulos_sensores` | `area_ancho_cm` | `area_alto_cm` | `actualizado_en`
> Filas de ejemplo:
> `roomba-sala` | `automatico` | `15` | `30` | `60` | `200` | `{"izq":-45,"centro":0,"der":45}` | `500` | `400` | `10:40:12`
> `roomba-cocina` | `detenido` | `20` | `45` | `50` | `500` | `{"izq":-45,"centro":0,"der":45}` | `300` | `250` | `09:02:55`
>
> Alrededor, unido con flechas a la columna correspondiente:
> - de `modo`, un selector de 3 posiciones: `automatico` / `pausado` / `detenido`
> - de `distancia_evasion_cm` y `distancia_precaucion_cm`, una vista superior del robot con dos
>   arcos concéntricos delante: el interior rojo "evasión 15 cm", el exterior ámbar
>   "precaución 30 cm", y la nota corta "precaución > evasión"
> - de `angulos_sensores`, un robot con tres líneas a −45°, 0° y +45°
> - de `area_ancho_cm` / `area_alto_cm`, un rectángulo de habitación con cotas
> - arriba, flecha de un icono de robot a la primera celda: "1 robot = 1 fila (trigger)"
>
> Estilo: diagrama vectorial plano, fondo claro, 2–3 colores de acento, encabezado de tabla con
> fondo de color, etiquetas de 1 a 4 palabras. Formato horizontal 16:9.

---

## 4. Tabla `sesiones` — un ciclo de limpieza

> Usa como template a esta imagen. Genera una ilustración explicativa con **muy poco texto**
> sobre la tabla `sesiones`: cada fila es un ciclo de funcionamiento del robot, desde que
> arranca hasta que se detiene.
>
> **El elemento central y más grande debe ser la tabla dibujada como una tabla real**: rejilla
> con fila de encabezado y 3 filas de ejemplo. Título arriba: `sesiones`. Columnas exactas:
> `id` 🔑 | `dispositivo_id` | `iniciada_en` | `finalizada_en` | `total_lecturas` | `total_evasiones` | `distancia_recorrida_cm` | `bateria_inicio_pct` | `bateria_fin_pct`
> Filas de ejemplo:
> `41` | `roomba-sala` | `08:00:00` | `08:12:30` | `3750` | `12` | `4820.5` | `98` | `81`
> `42` | `roomba-cocina` | `09:15:00` | `09:21:10` | `740` | `5` | `1210.0` | `76` | `69`
> `43` | `roomba-sala` | `10:30:00` | **`NULL`** (celda resaltada) | `1180` | `3` | `1540.2` | `92` | `NULL`
>
> Alrededor, unido con flechas a la columna correspondiente:
> - de la celda `NULL` de `finalizada_en`, una etiqueta destacada: "sesión activa"
> - debajo de la tabla, una línea de tiempo corta alineada con la fila `41`: marcador de inicio,
>   marcador de fin, y entre ellos "duración"
> - de `bateria_inicio_pct` y `bateria_fin_pct`, dos iconos de batería (98 % → 81 %): "consumo"
> - a un lado, dos iconos de sesión apuntando al mismo robot, uno tachado con sello de
>   prohibido: "solo una activa por robot"
>
> Estilo: diagrama vectorial plano, fondo claro, 2–3 colores de acento, encabezado de tabla con
> fondo de color, etiquetas de 1 a 4 palabras. Formato horizontal 16:9.

---

## 5. Tabla `lecturas` — la telemetría

> Usa como template a esta imagen. Genera una ilustración explicativa con **muy poco texto**
> sobre la tabla `lecturas`: una fila por cada muestra de telemetría que manda el robot.
>
> **IMPORTANTE: el elemento central, más grande y dominante de la imagen debe ser la tabla
> dibujada como una tabla real** — rejilla con bordes, fila de encabezado con fondo de color y
> 3 filas de datos. No la reemplaces por tarjetas, bloques ni grupos de iconos: tiene que
> leerse como una hoja de cálculo. Título arriba: `lecturas`. Columnas exactas, en este orden
> (puedes usar dos líneas por encabezado si hace falta):
> `id` 🔑 | `dispositivo_id` | `sesion_id` | `secuencia` | `dist_izq_cm` | `dist_centro_cm` | `dist_der_cm` | `estado_movimiento` | `pos_x_cm` | `pos_y_cm` | `orientacion_deg` | `vel_izq_pct` | `vel_der_pct` | `bateria_v` | `bateria_pct` | `rssi_dbm` | `medido_en` | `recibido_en` | `creado_en`
> Filas de ejemplo:
> `9001` | `roomba-sala` | `43` | `19` | `42.5` | `88.0` | `NULL` | `avanzando` | `120.5` | `84.0` | `90.0` | `60` | `60` | `12.31` | `92` | `-58` | `10:31:02.100` | `10:31:02.142` | `10:31:02.145`
> `9002` | `roomba-sala` | `43` | `21` | `40.1` | `14.2` | `NULL` | `girando_izq` | `121.0` | `86.5` | `118.0` | `-45` | `45` | `12.28` | `91` | `-61` | `10:31:02.300` | `10:31:02.351` | `10:31:02.354`
> `9003` | `roomba-sala` | `43` | `22` | `39.8` | `35.0` | `70.4` | `avanzando` | `121.4` | `89.0` | `118.0` | `60` | `60` | `12.28` | `91` | `-60` | `10:31:02.500` | `10:31:02.539` | `10:31:02.542`
>
> Resalta en la tabla, con color, tres celdas y conéctalas con flechas cortas a su anotación
> fuera de la rejilla:
> - la celda `NULL` de `dist_der_cm` → "nada en rango"
> - el salto de `secuencia` 19 → 21 → "hueco = lectura perdida"
> - las columnas `medido_en` y `recibido_en`, abarcadas por una llave → "latencia"
>
> Ilustraciones pequeñas a los lados, siempre unidas por flecha a su columna y sin tapar la tabla:
> - vista superior del robot con tres conos de ultrasonido etiquetados `izq`, `centro`, `der`
> - cinco iconos diminutos para los valores de `estado_movimiento`: avanzando, girando_izq,
>   girando_der, retrocediendo, detenido
> - iconos de batería y de señal WiFi junto a `bateria_pct` y `rssi_dbm`
>
> Estilo: diagrama vectorial plano, fondo claro, 2–3 colores de acento, tipografía sans-serif,
> números en fuente monoespaciada. Etiquetas de 1 a 4 palabras, sin párrafos. Formato
> horizontal 16:9 y la tabla ocupando al menos el 60 % de la imagen.

---

## 6. Tabla `eventos` — hechos puntuales

> Usa como template a esta imagen. Genera una ilustración explicativa con **muy poco texto**
> sobre la tabla `eventos`: la bitácora de cosas puntuales que le pasan al robot.
>
> **IMPORTANTE: el elemento central, más grande y dominante de la imagen debe ser la tabla
> dibujada como una tabla real** — rejilla con bordes, fila de encabezado con fondo de color y
> 4 filas de datos. No la reemplaces por tarjetas ni por una rejilla de iconos: tiene que
> leerse como una hoja de cálculo. Título arriba: `eventos`. Columnas exactas:
> `id` 🔑 | `dispositivo_id` | `sesion_id` | `tipo` | `sensor` | `distancia_cm` | `pos_x_cm` | `pos_y_cm` | `mensaje` | `atendido` | `creado_en`
> Filas de ejemplo:
> `501` | `roomba-sala` | `43` | `obstaculo` | `centro` | `14.2` | `121.0` | `86.5` | `Obstáculo al frente` | `false` | `10:31:02`
> `502` | `roomba-sala` | `43` | `obstaculo` | `izq` | `13.0` | `160.4` | `92.1` | `Obstáculo a la izquierda` | `true` | `10:33:48`
> `503` | `roomba-sala` | `43` | `bateria_baja` | `NULL` | `NULL` | `210.0` | `130.0` | `Batería al 15 %` | `false` | `10:40:11`
> `504` | `roomba-cocina` | `NULL` | `desconexion` | `NULL` | `NULL` | `NULL` | `NULL` | `Se perdió la conexión` | `true` | `09:22:00`
>
> Resalta con color y conecta por flecha a una anotación corta fuera de la rejilla:
> - la celda `NULL` de `sesion_id` en la última fila → "fuera de sesión"
> - la columna `sensor` → "solo en obstáculo"
> - la columna `atendido` → "ya revisado"
>
> Ilustraciones pequeñas a los lados, unidas por flecha y sin tapar la tabla:
> - una fila horizontal de seis iconos diminutos, uno por valor de `tipo`, cada uno con su
>   palabra debajo: `obstaculo` (muro), `atascado` (rueda bloqueada), `bateria_baja` (batería al
>   10 %), `conexion` (enchufe conectado), `desconexion` (enchufe suelto), `cambio_modo` (selector)
> - un plano pequeño de habitación con la trayectoria del robot y chinchetas en las posiciones
>   de las filas, conectado a las columnas `pos_x_cm` / `pos_y_cm`
>
> Estilo: diagrama vectorial plano, fondo claro, 2–3 colores de acento, números en fuente
> monoespaciada, etiquetas de 1 a 4 palabras. Formato horizontal 16:9 y la tabla ocupando al
> menos el 60 % de la imagen.

---

## 7. Diagrama UML general de la base de datos

> Usa como template a esta imagen. Genera un **diagrama UML de clases / entidad-relación** de
> la base de datos PostgreSQL de un dashboard de robots aspiradores, limpio y con poco texto.
>
> **IMPORTANTE: cada entidad debe dibujarse como una caja UML de tabla real** — rectángulo con
> una cabecera de color que lleva el nombre de la tabla y, debajo, la lista de sus columnas con
> el tipo, una por línea, separada de la cabecera por una línea horizontal. Marca las claves
> primarias con una llave 🔑 y las ajenas con la etiqueta `FK`. No las dibujes como iconos,
> burbujas ni tarjetas decorativas: son tablas.
>
> Las seis tablas y sus columnas:
> - **`users`**: `id` 🔑 SERIAL, `email` TEXT, `password` TEXT, `name` TEXT, `role` TEXT, `is_active` BOOL, `created_at` TIMESTAMPTZ
> - **`dispositivos`**: `id` 🔑 TEXT, `user_id` FK INT, `nombre` TEXT, `ubicacion` TEXT, `token_hash` TEXT, `is_revoked` BOOL, `en_linea` BOOL, `ultimo_contacto`, `version_firmware`, `creado_en`
> - **`configuracion_dispositivo`**: `dispositivo_id` 🔑 FK, `modo`, `distancia_evasion_cm`, `distancia_precaucion_cm`, `velocidad_base_pct`, `intervalo_telemetria_ms`, `angulos_sensores` JSONB, `area_ancho_cm`, `area_alto_cm`, `actualizado_en`
> - **`sesiones`**: `id` 🔑 BIGSERIAL, `dispositivo_id` FK, `iniciada_en`, `finalizada_en`, `total_lecturas`, `total_evasiones`, `distancia_recorrida_cm`, `bateria_inicio_pct`, `bateria_fin_pct`
> - **`lecturas`**: `id` 🔑 BIGSERIAL, `dispositivo_id` FK, `sesion_id` FK, `secuencia`, `dist_izq_cm`, `dist_centro_cm`, `dist_der_cm`, `estado_movimiento`, `pos_x_cm`, `pos_y_cm`, `orientacion_deg`, `vel_izq_pct`, `vel_der_pct`, `bateria_v`, `bateria_pct`, `rssi_dbm`, `medido_en`, `recibido_en`, `creado_en`
> - **`eventos`**: `id` 🔑 BIGSERIAL, `dispositivo_id` FK, `sesion_id` FK, `tipo`, `sensor`, `distancia_cm`, `pos_x_cm`, `pos_y_cm`, `mensaje`, `atendido`, `creado_en`
>
> Relaciones, con la cardinalidad escrita en los extremos de cada línea y la línea saliendo de
> la columna concreta:
> - `users` **1 → 0..\*** `dispositivos`
> - `dispositivos` **1 → 1** `configuracion_dispositivo`
> - `dispositivos` **1 → 0..\*** `sesiones`
> - `sesiones` **1 → 0..\*** `lecturas`
> - `sesiones` **1 → 0..\*** `eventos`
> - `dispositivos` **1 → 0..\*** hacia `lecturas` y `eventos`, con líneas más tenues
>
> Distribución: en cascada de izquierda a derecha siguiendo la jerarquía
> usuario → robot → sesión → datos, con `lecturas` y `eventos` dentro de una zona sombreada
> etiquetada "datos de serie temporal".
>
> Debajo, separadas por una línea discontinua, cuatro cajas más pequeñas con el mismo estilo de
> caja UML: `«view» v_lecturas_por_minuto`, `«view» v_lecturas_por_hora`,
> `«view» v_resumen_sesion` y `«function» obtener_mapa_sesion()`, cada una listando 3 o 4
> campos de salida, con flechas punteadas de lectura hacia `lecturas`, `eventos` y `sesiones`.
>
> Anotaciones solo como etiquetas cortas sobre las líneas: `ON DELETE CASCADE`.
>
> Estilo: UML vectorial plano y moderno, fondo claro, cajas con esquinas suaves y cabecera de
> color, 3 colores de acento como máximo, tipografía sans-serif con los nombres de columna en
> monoespaciada, sin sombras pesadas. Formato horizontal 16:9, legible al reducirlo.
