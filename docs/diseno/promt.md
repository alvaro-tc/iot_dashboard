# Prompts para generar las imágenes explicativas

Seis prompts, uno por imagen: cinco tablas + el diagrama UML general. Cada uno se usa
adjuntando una imagen de referencia de estilo (el prompt ya empieza pidiéndolo).

**Regla que llevan todos:** el protagonista de la imagen es **la tabla dibujada como tabla
real** — rejilla con fila de encabezado (los nombres de columna exactos) y 2–4 filas de datos
de ejemplo. Las ilustraciones solo rodean esa tabla y se conectan a ella con flechas; nunca la
sustituyen. Poco texto: etiquetas de 1 a 4 palabras, sin párrafos.

Los nombres de columna salen de `apps/api/db/schema.sql` (ver [bd.md](./bd.md)). Están todos
en español, igual que en el firmware del ESP32.

---

## 1. Tabla `usuarios` — cuentas

> Usa como template a esta imagen. Genera una ilustración explicativa, limpia y con **muy poco
> texto**, sobre la tabla `usuarios` de una base de datos PostgreSQL de un dashboard de robots.
>
> **El elemento central y más grande debe ser la tabla dibujada como una tabla real**: rejilla
> con fila de encabezado y 2 filas de datos de ejemplo. Título arriba: `usuarios`. Columnas
> exactas, en este orden:
> `id` | `correo` | `contrasena` | `nombre` | `rol` | `activo` | `creado_en`
> Filas de ejemplo:
> `1` | `admin@demo.com` | `$2b$10$…` | `Administración` | `admin` | `true` | `2026-09-01`
> `2` | `alvaro@demo.com` | `$2b$10$…` | `Álvaro Quispe` | `cliente` | `true` | `2026-09-26`
> Marca `id` con una llave 🔑 en el encabezado y `correo` con la etiqueta pequeña "único".
>
> Alrededor de la tabla, anotaciones cortas unidas con flechas a la columna que explican:
> - de `contrasena`, un candado: "hash bcrypt"
> - de `rol`, dos avatares: uno con corona `admin` → "ve todo"; otro sencillo `cliente` → "solo sus robots"
> - de `activo`, un interruptor en OFF: "desactivar sin borrar"
>
> Estilo: diagrama vectorial plano, fondo claro, 2–3 colores de acento, tipografía sans-serif,
> encabezado de tabla con fondo de color. Formato horizontal 16:9.

---

## 2. Tabla `dispositivos` — el robot

> Usa como template a esta imagen. Genera una ilustración explicativa con **muy poco texto**
> sobre la tabla `dispositivos`: cada fila es un robot físico y, a la vez, su identidad MQTT.
>
> **El elemento central y más grande debe ser la tabla dibujada como una tabla real**: rejilla
> con fila de encabezado y 2 filas de ejemplo. Título arriba: `dispositivos`. Columnas exactas:
> `id` 🔑 | `usuario_id` | `nombre` | `ubicacion` | `token_hash` | `revocado` | `en_linea` | `ultimo_contacto` | `version_firmware` | `creado_en`
> Filas de ejemplo:
> `roomba-sala` | `2` | `Roomba Sala` | `Sala de estar` | `$2b$10$…` | `false` | `true` | `10:42:07` | `1.2.0` | `2026-09-26`
> `roomba-cocina` | `2` | `Roomba Cocina` | `Cocina` | `$2b$10$…` | `false` | `false` | `09:15:30` | `1.2.0` | `2026-10-04`
>
> Alrededor, unido con flechas a la columna correspondiente:
> - a la izquierda, un robot aspirador redondo visto desde arriba, con flecha hacia la celda `roomba-sala`
> - de `usuario_id`, flecha a una tabla pequeña `usuarios`: "dueño"
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
> dos únicos parámetros que el dashboard le manda al robot.
>
> **El elemento central y más grande debe ser la tabla dibujada como una tabla real**: rejilla
> con fila de encabezado y 2 filas de ejemplo. Título arriba: `configuracion_dispositivo`.
> Columnas exactas:
> `dispositivo_id` 🔑 | `velocidad_base` | `angulos_sensores` | `actualizado_en`
> Filas de ejemplo:
> `roomba-sala` | `180` | `{"izquierdo":-45,"central":0,"derecho":45}` | `10:40:12`
> `roomba-cocina` | `130` | `{"izquierdo":-45,"central":0,"derecho":45}` | `09:02:55`
>
> Como la tabla tiene pocas columnas, dibújala grande y ancha, con las celdas holgadas, y deja
> el resto del espacio para las anotaciones, unidas con flechas a su columna:
> - de `velocidad_base`, un deslizador de 0 a 255 con el mando en 180 y la nota corta
>   "PWM, igual que el firmware"
> - de `angulos_sensores`, un robot visto desde arriba con tres líneas de sensor a −45°, 0° y
>   +45°, cada una etiquetada `izquierdo`, `central`, `derecho`
> - arriba, flecha de un icono de robot a la primera celda: "1 robot = 1 fila (trigger)"
> - a un lado, un icono de MQTT con la etiqueta `config` y la nota "mensaje retenido"
>
> Estilo: diagrama vectorial plano, fondo claro, 2–3 colores de acento, encabezado de tabla con
> fondo de color, etiquetas de 1 a 4 palabras. Formato horizontal 16:9.

---

## 4. Tabla `sesiones` — un ciclo de funcionamiento

> Usa como template a esta imagen. Genera una ilustración explicativa con **muy poco texto**
> sobre la tabla `sesiones`: cada fila es un ciclo de actividad del robot, desde que empieza a
> publicar hasta que se desconecta.
>
> **El elemento central y más grande debe ser la tabla dibujada como una tabla real**: rejilla
> con fila de encabezado y 3 filas de ejemplo. Título arriba: `sesiones`. Columnas exactas:
> `id` 🔑 | `dispositivo_id` | `iniciada_en` | `finalizada_en` | `total_lecturas` | `bateria_inicio_porcentaje` | `bateria_fin_porcentaje`
> Filas de ejemplo:
> `41` | `roomba-sala` | `08:30:00` | `09:05:00` | `4200` | `98` | `81`
> `42` | `roomba-cocina` | `11:00:00` | `11:18:00` | `2160` | `76` | `69`
> `43` | `roomba-sala` | `14:32:00` | **`NULL`** (celda resaltada) | `1180` | `92` | `NULL`
>
> Alrededor, unido con flechas a la columna correspondiente:
> - de la celda `NULL` de `finalizada_en`, una etiqueta destacada: "sesión activa"
> - debajo de la tabla, una línea de tiempo corta alineada con la fila `41`: marcador de inicio,
>   marcador de fin, y entre ellos "duración"
> - de las dos columnas de batería, dos iconos (98 % → 81 %): "consumo"
> - a un lado, dos iconos de sesión apuntando al mismo robot, uno tachado con sello de
>   prohibido: "solo una activa por robot"
>
> Estilo: diagrama vectorial plano, fondo claro, 2–3 colores de acento, encabezado de tabla con
> fondo de color, etiquetas de 1 a 4 palabras. Formato horizontal 16:9.

---

## 5. Tabla `lecturas` — la telemetría

> Usa como template a esta imagen. Genera una ilustración explicativa con **muy poco texto**
> sobre la tabla `lecturas`: una fila por cada mensaje de telemetría que publica el ESP32.
>
> **IMPORTANTE: el elemento central, más grande y dominante de la imagen debe ser la tabla
> dibujada como una tabla real** — rejilla con bordes, fila de encabezado con fondo de color y
> 3 filas de datos. No la reemplaces por tarjetas, bloques ni grupos de iconos: tiene que
> leerse como una hoja de cálculo. Título arriba: `lecturas`. Columnas exactas, en este orden
> (puedes usar dos líneas por encabezado si hace falta):
> `id` 🔑 | `dispositivo_id` | `sesion_id` | `distancia_izquierda_cm` | `distancia_central_cm` | `distancia_derecha_cm` | `movimiento_izquierda` | `movimiento_derecha` | `bateria_voltios` | `bateria_porcentaje` | `creado_en`
> Filas de ejemplo:
> `9001` | `roomba-sala` | `43` | `42.5` | `88.0` | `NULL` | `180` | `180` | `12.31` | `92` | `10:31:02`
> `9002` | `roomba-sala` | `43` | `40.1` | `14.2` | `NULL` | `-145` | `145` | `12.28` | `91` | `10:31:03`
> `9003` | `roomba-sala` | `43` | `39.8` | `35.0` | `70.4` | `0` | `0` | `12.28` | `91` | `10:31:03`
>

>
> Ilustraciones pequeñas a los lados, siempre unidas por flecha a su columna y sin tapar la tabla:
> - vista superior del robot con tres conos de ultrasonido etiquetados `izquierdo`, `central`, `derecho`
> - un par de ruedas con una flecha de sentido en cada una y la escala "-255 … 0 … 255"
> - un icono de batería junto a las dos columnas de batería
>
> Estilo: diagrama vectorial plano, fondo claro, 2–3 colores de acento, tipografía sans-serif,
> números en fuente monoespaciada. Etiquetas de 1 a 4 palabras, sin párrafos. Formato
> horizontal 16:9 y la tabla ocupando al menos el 60 % de la imagen.

---

## 6. Diagrama UML general de la base de datos

> Usa como template a esta imagen. Genera un **diagrama UML de clases / entidad-relación** de
> la base de datos PostgreSQL de un dashboard de robots, limpio y con poco texto.
>
> **IMPORTANTE: cada entidad debe dibujarse como una caja UML de tabla real** — rectángulo con
> una cabecera de color que lleva el nombre de la tabla y, debajo, la lista de sus columnas con
> el tipo, una por línea, separada de la cabecera por una línea horizontal. Marca las claves
> primarias con una llave 🔑 y las ajenas con la etiqueta `FK`. No las dibujes como iconos,
> burbujas ni tarjetas decorativas: son tablas.
>
> Las cinco tablas y sus columnas:
> - **`usuarios`**: `id` 🔑 SERIAL, `correo` TEXT, `contrasena` TEXT, `nombre` TEXT, `rol` TEXT, `activo` BOOL, `creado_en` TIMESTAMPTZ
> - **`dispositivos`**: `id` 🔑 TEXT, `usuario_id` FK INT, `nombre` TEXT, `ubicacion` TEXT, `token_hash` TEXT, `revocado` BOOL, `en_linea` BOOL, `ultimo_contacto`, `version_firmware`, `creado_en`
> - **`configuracion_dispositivo`**: `dispositivo_id` 🔑 FK TEXT, `velocidad_base` SMALLINT (0..255), `angulos_sensores` JSONB, `actualizado_en` TIMESTAMPTZ
> - **`sesiones`**: `id` 🔑 BIGSERIAL, `dispositivo_id` FK, `iniciada_en`, `finalizada_en`, `total_lecturas`, `bateria_inicio_porcentaje`, `bateria_fin_porcentaje`
> - **`lecturas`**: `id` 🔑 BIGSERIAL, `dispositivo_id` FK, `sesion_id` FK, `distancia_izquierda_cm`, `distancia_central_cm`, `distancia_derecha_cm`, `movimiento_izquierda` (-255..255), `movimiento_derecha` (-255..255), `bateria_voltios`, `bateria_porcentaje`, `creado_en`
>
> Relaciones, con la cardinalidad escrita en los extremos de cada línea y la línea saliendo de
> la columna concreta:
> - `usuarios` **1 → 0..\*** `dispositivos`
> - `dispositivos` **1 → 1** `configuracion_dispositivo`
> - `dispositivos` **1 → 0..\*** `sesiones`
> - `sesiones` **1 → 0..\*** `lecturas`
> - `dispositivos` **1 → 0..\*** `lecturas`, con una línea más tenue
>
> Distribución: en cascada de izquierda a derecha siguiendo la jerarquía
> usuario → robot → sesión → lecturas, con `lecturas` dentro de una zona sombreada etiquetada
> "datos de serie temporal".
>

>
> Estilo: UML vectorial plano y moderno, fondo claro, cajas con esquinas suaves y cabecera de
> color, 3 colores de acento como máximo, tipografía sans-serif con los nombres de columna en
> monoespaciada, sin sombras pesadas. Formato horizontal 16:9, legible al reducirlo.
