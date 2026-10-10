# Prompts para generar las imágenes explicativas

Siete prompts, uno por imagen: seis tablas + el diagrama UML general. Cada uno se usa
adjuntando una imagen de referencia de estilo (el prompt ya empieza pidiéndolo).

Reglas comunes que ya van dentro de cada prompt: poco texto, nombres de campo reales,
iconos antes que frases, una sola idea central por imagen.

---

## 1. Tabla `users` — cuentas

> Usa como template a esta imagen. Genera una ilustración explicativa, limpia y con **muy poco
> texto**, que explique la tabla `users` de una base de datos PostgreSQL de un dashboard de
> robots aspiradores.
>
> Centro: una tarjeta tipo "ficha de usuario" con el título `users` y sus campos en lista
> vertical, cada uno con un icono pequeño a la izquierda:
> `id` (llave 🔑), `email` (sobre, etiqueta "único"), `password` (candado, etiqueta "hash
> bcrypt"), `name`, `role`, `is_active` (interruptor), `created_at` (reloj).
>
> A la derecha, dos avatares conectados al campo `role` con una flecha: uno con corona
> etiquetado `admin` → "ve todo"; otro sencillo etiquetado `client` → "solo sus robots".
>
> Abajo a la izquierda, un detalle visual del campo `is_active`: un interruptor en OFF con la
> nota corta "desactivar sin borrar historial".
>
> Estilo: diagrama vectorial plano, fondo claro, 2–3 colores de acento, tipografía sans-serif.
> Sin párrafos: solo etiquetas de 1 a 4 palabras. Formato horizontal 16:9.

---

## 2. Tabla `dispositivos` — el robot

> Usa como template a esta imagen. Genera una ilustración explicativa con **muy poco texto**
> sobre la tabla `dispositivos`: cada fila es un robot aspirador físico, y además es su
> identidad MQTT.
>
> Izquierda: un robot aspirador redondo visto desde arriba, con una etiqueta que sale de él:
> `id = roomba-7f3a9c2b`.
> Centro: la tarjeta de la tabla `dispositivos` con los campos y un icono cada uno:
> `id` (llave 🔑), `user_id` (flecha a `users`), `nombre`, `ubicacion` (pin de mapa),
> `token_hash` (candado, "hash bcrypt"), `is_revoked` (sello de prohibido), `en_linea`
> (punto verde), `ultimo_contacto` (reloj), `version_firmware` (chip), `creado_en`.
>
> Derecha: un icono de broker MQTT con el tópico `roomba/{id}/#` y una flecha desde el campo
> `id`, con la nota corta "el id es el usuario MQTT".
>
> Estilo: diagrama vectorial plano, fondo claro, 2–3 colores de acento, etiquetas de 1 a 4
> palabras, sin párrafos. Formato horizontal 16:9.

---

## 3. Tabla `configuracion_dispositivo` — lo que el robot obedece

> Usa como template a esta imagen. Genera una ilustración explicativa con **muy poco texto**
> sobre la tabla `configuracion_dispositivo`: una sola fila por robot (relación 1 a 1) con los
> parámetros que el robot obedece.
>
> Izquierda: la tarjeta de la tabla, cada campo dibujado como un control físico:
> `modo` (selector de 3 posiciones: `automatico` / `pausado` / `detenido`),
> `distancia_evasion_cm` (deslizador 5–50), `distancia_precaucion_cm` (deslizador ≤100),
> `velocidad_base_pct` (deslizador 30–100), `intervalo_telemetria_ms` (deslizador 100–2000),
> `angulos_sensores` (etiqueta JSONB `{izq:-45, centro:0, der:45}`), `area_ancho_cm` y
> `area_alto_cm` (rectángulo de habitación con cotas).
>
> Derecha: vista superior del robot con dos arcos concéntricos delante: el interior rojo
> etiquetado "evasión" y el exterior ámbar etiquetado "precaución", con una nota corta:
> "precaución > evasión (lo exige la base)".
>
> Arriba: una flecha de un icono de robot hacia la tarjeta, con la etiqueta "1 robot = 1 fila
> (trigger automático)".
>
> Estilo: diagrama vectorial plano, fondo claro, 2–3 colores de acento, etiquetas de 1 a 4
> palabras, sin párrafos. Formato horizontal 16:9.

---

## 4. Tabla `sesiones` — un ciclo de limpieza

> Usa como template a esta imagen. Genera una ilustración explicativa con **muy poco texto**
> sobre la tabla `sesiones`: cada fila es un ciclo de funcionamiento del robot, desde que
> arranca hasta que se detiene.
>
> Centro: una línea de tiempo horizontal con un marcador de inicio (`iniciada_en`) y otro de
> fin (`finalizada_en`), y entre ambos la etiqueta `duracion_s`. Un segundo tramo más abajo,
> sin marcador de fin, con la etiqueta `finalizada_en = NULL` y la nota corta "sesión activa".
>
> Alrededor de la línea de tiempo, cuatro contadores tipo tarjeta métrica:
> `total_lecturas`, `total_evasiones`, `distancia_recorrida_cm` y un indicador de batería que
> va de `bateria_inicio_pct` a `bateria_fin_pct`.
>
> Abajo: dos iconos de sesión hacia un mismo robot, uno de ellos tachado con un sello de
> prohibido y la etiqueta corta "solo una sesión activa por robot".
>
> Estilo: diagrama vectorial plano, fondo claro, 2–3 colores de acento, etiquetas de 1 a 4
> palabras, sin párrafos. Formato horizontal 16:9.

---

## 5. Tabla `lecturas` — la telemetría

> Usa como template a esta imagen. Genera una ilustración explicativa con **muy poco texto**
> sobre la tabla `lecturas`: una fila por cada muestra de telemetría que manda el robot.
>
> Izquierda: vista superior del robot con tres conos de ultrasonido etiquetados
> `dist_izq_cm`, `dist_centro_cm`, `dist_der_cm`; uno de los conos sin obstáculo, marcado
> `NULL = nada en rango`. Sobre el robot, los ejes de posición `pos_x_cm`, `pos_y_cm` y una
> flecha de orientación `orientacion_deg`.
>
> Centro: la tarjeta de la tabla con los campos agrupados en bloques pequeños y con icono:
> identidad (`id`, `dispositivo_id`, `sesion_id`), `secuencia` (contador), distancias,
> `estado_movimiento` (5 iconos: avanzando, girando izq, girando der, retrocediendo,
> detenido), motores (`vel_izq_pct`, `vel_der_pct`, de −100 a 100), salud (`bateria_v`,
> `bateria_pct`, `rssi_dbm`).
>
> Derecha: tres relojes en fila, `medido_en` → `recibido_en` → `creado_en`, con una llave que
> abarca los dos primeros y la etiqueta corta "latencia".
> Debajo: una tira de números `...18, 19, __, 21...` con un hueco resaltado y la etiqueta
> "hueco = lectura perdida".
>
> Estilo: diagrama vectorial plano, fondo claro, 2–3 colores de acento, etiquetas de 1 a 4
> palabras, sin párrafos. Formato horizontal 16:9.

---

## 6. Tabla `eventos` — hechos puntuales

> Usa como template a esta imagen. Genera una ilustración explicativa con **muy poco texto**
> sobre la tabla `eventos`: la bitácora de cosas puntuales que le pasan al robot.
>
> Izquierda: la tarjeta de la tabla con sus campos e iconos: `id`, `dispositivo_id`,
> `sesion_id`, `tipo`, `sensor` (izq/centro/der), `distancia_cm`, `pos_x_cm`, `pos_y_cm`,
> `mensaje`, `atendido` (casilla marcada), `creado_en`.
>
> Centro: los seis valores de `tipo` como iconos en rejilla, con una palabra cada uno:
> `obstaculo` (muro), `atascado` (rueda bloqueada), `bateria_baja` (batería al 10 %),
> `conexion` (enchufe conectado), `desconexion` (enchufe suelto), `cambio_modo` (selector).
>
> Derecha: un plano pequeño de habitación con la trayectoria del robot y chinchetas de evento
> colocadas en `pos_x_cm`, `pos_y_cm`; una de ellas con una marca de visto y la etiqueta corta
> `atendido`.
>
> Estilo: diagrama vectorial plano, fondo claro, 2–3 colores de acento, etiquetas de 1 a 4
> palabras, sin párrafos. Formato horizontal 16:9.

---

## 7. Diagrama UML general de la base de datos

> Usa como template a esta imagen. Genera un **diagrama UML entidad-relación** limpio y
> explicativo, con **poco texto**, de la base de datos PostgreSQL de un dashboard de robots
> aspiradores. Muestra las tablas como cajas UML (nombre en la cabecera, campos clave debajo,
> sin listar todos) y las relaciones con sus cardinalidades:
>
> - `users` (id, email, role) **1 → 0..\*** `dispositivos`
> - `dispositivos` (id, nombre, en_linea) **1 → 1** `configuracion_dispositivo` (modo, distancias, área)
> - `dispositivos` **1 → 0..\*** `sesiones` (iniciada_en, finalizada_en, totales)
> - `sesiones` **1 → 0..\*** `lecturas` (secuencia, distancias, posición, batería)
> - `sesiones` **1 → 0..\*** `eventos` (tipo, sensor, posición)
> - `dispositivos` también **1 → 0..\*** hacia `lecturas` y `eventos`, con líneas más tenues
>
> Coloca las entidades en cascada de izquierda a derecha siguiendo la jerarquía
> usuario → robot → sesión → datos, y agrupa `lecturas` y `eventos` en una zona sombreada
> etiquetada "datos de serie temporal".
>
> Debajo, separadas por una línea discontinua, tres cajas de vistas con el estereotipo
> `«view»`: `v_lecturas_por_minuto`, `v_lecturas_por_hora`, `v_resumen_sesion`, y una caja
> `«function»` `obtener_mapa_sesion()`, con flechas punteadas de lectura hacia `lecturas`,
> `eventos` y `sesiones`.
>
> Marca con una etiqueta pequeña, no con texto largo: "ON DELETE CASCADE" sobre las líneas de
> relación, y una llave 🔑 junto a cada clave primaria.
>
> Estilo: UML vectorial plano y moderno, fondo claro, cajas con esquinas suaves, 3 colores de
> acento máximo, tipografía sans-serif, sin sombras pesadas. Etiquetas de 1 a 4 palabras.
> Formato horizontal 16:9, legible al reducirlo.
