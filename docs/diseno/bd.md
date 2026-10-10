# Base de datos: para qué sirve cada tabla y cada campo

PostgreSQL. El esquema completo vive en `apps/api/db/schema.sql` y se aplica de cero con
`pnpm db:reset`; los datos de demostración están en `apps/api/db/seed.sql`.
El diagrama está en [uml-bd.md](./uml-bd.md).

**Todo está en español**: tablas, columnas y los valores de los `CHECK`. Los nombres de los
sensores (`izquierdo` / `central` / `derecho`) y el rango de los motores (−255 a 255) son los
mismos que usa el firmware del ESP32 en `firmware/`, así que el JSON que publica el robot se
guarda sin traducir nada por el camino.

Idea general: un **usuario** posee uno o varios **dispositivos** (robots). Cada robot tiene
exactamente una **configuración** (lo que obedece), y su actividad se parte en **sesiones**.
Dentro de cada sesión el robot escribe **lecturas**: la telemetría continua.

---

## 1. `usuarios` — cuentas que entran al dashboard

| Campo | Tipo | Para qué sirve |
|---|---|---|
| `id` | SERIAL PK | Identificador interno del usuario. |
| `correo` | TEXT UNIQUE | Usuario de inicio de sesión. Único: no hay dos cuentas con el mismo correo. |
| `contrasena` | TEXT | Hash **bcrypt** de la contraseña. Nunca se guarda en claro. |
| `nombre` | TEXT | Nombre visible en la interfaz. |
| `rol` | TEXT | `admin` (ve y administra todo) o `cliente` (solo sus propios robots). El `CHECK` impide cualquier otro valor. |
| `activo` | BOOLEAN | Permite desactivar una cuenta sin borrarla (y sin perder su historial). |
| `creado_en` | TIMESTAMPTZ | Fecha de alta. |

## 2. `dispositivos` — un robot físico

También es la identidad MQTT: el `id` es el usuario con el que el ESP32 se conecta a
Mosquitto, y la ACL lo limita a los tópicos `roomba/{id}/#`. En el firmware es `ROBOT_ID`.

| Campo | Tipo | Para qué sirve |
|---|---|---|
| `id` | TEXT PK | Identificador del robot, p. ej. `roomba-7f3a9c2b`. Es texto porque además es el usuario MQTT. |
| `usuario_id` | FK → `usuarios` | Dueño del robot. Al borrar el usuario se borra el robot (CASCADE). |
| `nombre` | TEXT | Nombre amable, p. ej. "Roomba Sala". |
| `ubicacion` | TEXT | Dónde está (texto libre: "Cocina"). |
| `token_hash` | TEXT | Hash bcrypt del token MQTT. El token en claro solo se muestra una vez, al crear el robot. |
| `revocado` | BOOLEAN | Credencial anulada: el robot queda fuera sin borrar su historial. |
| `en_linea` | BOOLEAN | Si el broker lo ve conectado ahora mismo. Lo actualiza el backend con el `estado` retenido y el *last will* del robot. |
| `ultimo_contacto` | TIMESTAMPTZ | Última vez que llegó algo suyo. Sirve para marcarlo como caído. |
| `version_firmware` | TEXT | Versión que anuncia el ESP32 al conectar; útil para saber a quién actualizar. |
| `creado_en` | TIMESTAMPTZ | Fecha de registro. |

Índice `idx_dispositivos_usuario`: lista rápida de "los robots de este usuario", que es la
consulta que hace el dashboard en cada carga.

## 3. `configuracion_dispositivo` — lo que el robot obedece

Relación **1 a 1** con `dispositivos` (la PK es la propia FK). El backend publica esta fila
como mensaje **retenido** en el tópico `config`, así un robot que se reconecta recibe su
configuración de inmediato. Son solo dos ajustes: lo demás lo decide el firmware.

| Campo | Tipo | Para qué sirve |
|---|---|---|
| `dispositivo_id` | PK + FK | El robot al que pertenece la configuración. |
| `velocidad_base` | SMALLINT 0–255 | PWM de crucero de los motores, en la **misma escala que el firmware** (`PWM_MAXIMO = 255`). Antes era un porcentaje; ahora no hay que convertir nada entre el dashboard y el ESP32. |
| `angulos_sensores` | JSONB | Ángulo de montaje de cada HC-SR04 respecto al frente del robot, por defecto `{"izquierdo":-45,"central":0,"derecho":45}`. Lo usa el radar del dashboard para colocar cada sector. JSONB porque es un objeto pequeño y fijo que se lee completo. |
| `actualizado_en` | TIMESTAMPTZ | Cuándo se cambió por última vez. |

**Trigger `trg_configuracion_por_defecto`**: al insertar un dispositivo, crea automáticamente
su fila de configuración con los valores por defecto. Garantiza que no exista un robot sin
configuración, sin repetir el `INSERT` en cada camino del código.

## 4. `sesiones` — un ciclo de funcionamiento

Se abre con la primera lectura que llega de un robot y se cierra cuando el robot se desconecta
o deja de publicar (lo hace `presencia.ts` y el barrido de inactivas). Es la unidad con la que
el dashboard agrupa el historial.

| Campo | Tipo | Para qué sirve |
|---|---|---|
| `id` | BIGSERIAL PK | Identificador de la sesión. |
| `dispositivo_id` | FK → `dispositivos` | Robot que la ejecutó. |
| `iniciada_en` | TIMESTAMPTZ | Arranque. |
| `finalizada_en` | TIMESTAMPTZ NULL | Cierre. **`NULL` significa que la sesión sigue activa.** |
| `total_lecturas` | INTEGER | Contador acumulado de lecturas (evita un `count(*)` en cada pantalla). |
| `bateria_inicio_porcentaje` | SMALLINT | Batería en la primera lectura de la sesión. |
| `bateria_fin_porcentaje` | SMALLINT | Batería en la última; la resta es el consumo de la sesión. |

Índice único parcial `uniq_sesion_activa_por_dispositivo` sobre `(dispositivo_id) WHERE
finalizada_en IS NULL`: **un robot no puede tener dos sesiones abiertas a la vez.** Es la
protección contra sesiones duplicadas cuando el robot se reconecta.

Índice `idx_sesiones_dispositivo (dispositivo_id, iniciada_en DESC)`: historial del robot,
de la más reciente a la más antigua.

## 5. `lecturas` — la telemetría

Una fila por mensaje publicado por el ESP32 (cada `INTERVALO_MQTT_MS`, 500 ms por defecto).
Es la tabla que más crece, y de ella sale todo lo que se dibuja.

| Campo | Tipo | Para qué sirve |
|---|---|---|
| `id` | BIGSERIAL PK | Identificador de la lectura. |
| `dispositivo_id` | FK | Robot emisor (desnormalizado a propósito: permite consultar por robot sin unir con `sesiones`). |
| `sesion_id` | FK NULL | Sesión a la que pertenece. `NULL` si llegó fuera de una sesión. |
| `distancia_izquierda_cm` | NUMERIC(5,1) | Lectura del ultrasonido izquierdo. **`NULL` = el eco no volvió: no hay objeto dentro del alcance**, que no es lo mismo que "0 cm". |
| `distancia_central_cm` | NUMERIC(5,1) | Lo mismo con el central. |
| `distancia_derecha_cm` | NUMERIC(5,1) | Lo mismo con el derecho. |
| `movimiento_izquierda` | SMALLINT −255..255 | **PWM con signo de la rueda izquierda**: positivo avanza, negativo retrocede, 0 parada. |
| `movimiento_derecha` | SMALLINT −255..255 | Lo mismo con la rueda derecha. |
| `bateria_voltios` | NUMERIC(4,2) | Voltaje medido (el dato crudo del ADC). |
| `bateria_porcentaje` | SMALLINT 0..100 | Porcentaje que calcula el propio robot; es lo que se muestra. |
| `creado_en` | TIMESTAMPTZ | Cuándo llegó la lectura al backend. Es la única marca de tiempo. |

### Por qué dos columnas de motor en lugar de un `estado_movimiento`

Antes había una columna de texto con el estado (`avanzando`, `girando_izq`, …) que el firmware
tenía que mantener en sincronía con lo que hacían de verdad los motores. Ahora se guarda lo
que el firmware ya tiene —el PWM de cada rueda— y **el estado se deduce de los dos valores**
(`movimiento()` en `@iot/shared`):

| Rueda izquierda | Rueda derecha | Estado |
|---|---|---|
| > 0 | > 0 | avanzando |
| < 0 | < 0 | retrocediendo |
| signos opuestos, derecha mayor | | girando a la izquierda |
| signos opuestos, izquierda mayor | | girando a la derecha |
| ambos por debajo de 10 | | detenido |

Así el estado no puede contradecir a los motores, y además se sabe *cuánta* potencia llevaba
cada rueda, no solo la etiqueta.

### Por qué una sola marca de tiempo

Antes había tres (`medido_en` del reloj NTP del robot, `recibido_en` y `creado_en`) para medir
la latencia extremo a extremo. El firmware no sincroniza reloj, así que la marca del robot no
existe: queda `creado_en`, la hora del servidor. Lo que el dashboard mide ahora es la
**cadencia** (mensajes por segundo), que no necesita el reloj del robot.

Índices:
- `idx_lecturas_dispositivo (dispositivo_id, creado_en DESC)`: "últimas N lecturas de este
  robot", la consulta del panel en vivo.
- `idx_lecturas_sesion (sesion_id, creado_en)`: recorrer una sesión en orden.

---

## Vistas (consultas guardadas, no almacenan datos)

En las tres, **"en marcha"** significa que alguna rueda llevaba un PWM de al menos 10 (de 255).
Por debajo de eso el motor no mueve el chasis: contarlo como marcha infla el tiempo de uso con
ruido eléctrico.

### `v_lecturas_por_minuto`
Agrega por robot, sesión y minuto: cuántas lecturas hubo, el mínimo y el promedio de cada
sensor, el PWM medio de cada rueda, cuántas lecturas en marcha y cuántas detenido, y la
batería media. Alimenta las gráficas sin mandar al navegador miles de puntos.

### `v_lecturas_por_hora`
Lo mismo por hora y sin separar por sesión, para rangos largos. Añade `cerca_izquierda`,
`cerca_central` y `cerca_derecha`: cuántas lecturas tuvieron ese sensor a 15 cm o menos, es
decir, en qué dirección se topa más el robot. De ahí sale el mapa de calor del historial.

### `v_resumen_sesion`
Una fila por sesión con todo lo que pide la pantalla de detalle:
- `duracion_s` — usa `now()` si la sesión sigue abierta.
- `total_lecturas`.
- `bateria_inicio_porcentaje`, `bateria_fin_porcentaje` y `bateria_consumida_porcentaje`.
- `lecturas_en_marcha` y `lecturas_detenido` — el reparto del tiempo.
- `prom_pwm_izquierda` y `prom_pwm_derecha` — cuánta potencia se usó de media.
- `min_izquierda_cm`, `min_central_cm`, `min_derecha_cm` — lo más cerca que estuvo algo.
- `cerca_izquierda`, `cerca_central`, `cerca_derecha` — obstáculos por sensor.

---

## Qué se quitó y por qué

| Quitado | Motivo |
|---|---|
| Tabla `eventos` | Lo que detectaba (obstáculo, atascado, batería baja) se puede deducir de las lecturas en el momento de mirarlas: una tabla más que mantener para datos derivados. Los avisos de la campana se calculan ahora en el navegador desde la telemetría en vivo. |
| `lecturas.secuencia` | Era el contador del ESP32 y servía para detectar lecturas perdidas y descartar duplicados. El firmware real no lleva contador, así que la columna solo podía quedar vacía o inventada. |
| `pos_x_cm`, `pos_y_cm`, `orientacion_deg` | Era la pose estimada por odometría: el robot no tiene encoders, así que no hay forma de calcularla a bordo. Con ella se va el mapa y la función `obtener_mapa_sesion`. |
| `estado_movimiento` | Sustituido por `movimiento_izquierda` / `movimiento_derecha` (ver arriba). |
| `vel_izq_pct`, `vel_der_pct` | Eran el mismo dato que los motores, pero en porcentaje: duplicado. |
| `rssi_dbm` | El firmware no lo publica. |
| `medido_en`, `recibido_en` | Sin reloj NTP en el robot no hay latencia que medir (ver arriba). |
| `sesiones.total_evasiones` | Se contaba desde la tabla `eventos`; ahora se mira `cerca_*` en la vista. |
| `sesiones.distancia_recorrida_cm` | Se integraba de la odometría, que ya no existe. |
| `configuracion.modo` | El robot no recibe órdenes del dashboard: se maneja con el mando ESP-NOW. El dashboard es de solo lectura. |
| `distancia_evasion_cm`, `distancia_precaucion_cm` | Los umbrales los decide el firmware. En el dashboard son dos constantes (`DIST_EVASION_CM`, `DIST_PRECAUCION_CM`) que solo sirven para colorear. |
| `intervalo_telemetria_ms` | Lo fija `INTERVALO_MQTT_MS` en el firmware. |
| `area_ancho_cm`, `area_alto_cm` | Eran el lienzo del mapa. |

---

## Resumen de decisiones de diseño

- **El esquema es el JSON del robot.** Lo que publica `firmware/main.py` se guarda tal cual:
  mismos nombres de sensor, misma escala de PWM. Ningún campo existe "por si acaso".
- **Las reglas viven en la base**, no solo en la aplicación: `CHECK` para los rangos de PWM,
  de distancia y de batería, y un índice único parcial para "una sola sesión activa".
- **`ON DELETE CASCADE` en toda la jerarquía**: borrar un usuario o un robot no deja filas
  huérfanas.
- **El trigger garantiza la configuración**, así que el resto del código puede dar por hecho
  que existe.
- **`NULL` significa algo concreto**: en las distancias, que no hay objeto en rango; en
  `finalizada_en`, que la sesión sigue activa. No es "falta el dato".
- **Lo derivado no se guarda**: el estado de movimiento sale de los motores y los agregados
  salen de las vistas.
