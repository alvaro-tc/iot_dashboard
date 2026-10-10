# Base de datos: para qué sirve cada tabla y cada campo

PostgreSQL. El esquema completo vive en `apps/api/db/schema.sql` y se aplica de cero con
`pnpm db:reset`; los datos de demostración están en `apps/api/db/seed.sql`.
El diagrama está en [uml-bd.md](./uml-bd.md).

Idea general: un **usuario** posee uno o varios **dispositivos** (robots aspiradores). Cada
robot tiene exactamente una **configuración** (lo que obedece), y su actividad se parte en
**sesiones** (un ciclo de limpieza). Dentro de cada sesión el robot escribe **lecturas**
(telemetría continua) y **eventos** (cosas puntuales que pasaron).

---

## 1. `users` — cuentas que entran al dashboard

| Campo | Tipo | Para qué sirve |
|---|---|---|
| `id` | SERIAL PK | Identificador interno del usuario. |
| `email` | TEXT UNIQUE | Usuario de inicio de sesión. Único: no hay dos cuentas con el mismo correo. |
| `password` | TEXT | Hash **bcrypt** de la contraseña. Nunca se guarda en claro. |
| `name` | TEXT | Nombre visible en la interfaz. |
| `role` | TEXT | `admin` (ve y administra todo) o `client` (solo sus propios robots). El `CHECK` impide cualquier otro valor. |
| `is_active` | BOOLEAN | Permite desactivar una cuenta sin borrarla (y sin perder su historial). |
| `created_at` | TIMESTAMPTZ | Fecha de alta. |

## 2. `dispositivos` — un robot físico

También es la identidad MQTT: el `id` es el usuario con el que el ESP32 se conecta a
Mosquitto, y la ACL lo limita a los tópicos `roomba/{id}/#`.

| Campo | Tipo | Para qué sirve |
|---|---|---|
| `id` | TEXT PK | Identificador del robot, p. ej. `roomba-7f3a9c2b`. Es texto porque además es el usuario MQTT. |
| `user_id` | FK → `users` | Dueño del robot. Al borrar el usuario se borra el robot (CASCADE). |
| `nombre` | TEXT | Nombre amable, p. ej. "Roomba Sala". |
| `ubicacion` | TEXT | Dónde está (texto libre: "Cocina"). |
| `token_hash` | TEXT | Hash bcrypt del token MQTT. El token en claro solo se muestra una vez, al crear el robot. |
| `is_revoked` | BOOLEAN | Credencial anulada: el robot queda fuera sin borrar su historial. |
| `en_linea` | BOOLEAN | Si el broker lo ve conectado ahora mismo (lo actualiza el backend con la conexión MQTT / el *last will*). |
| `ultimo_contacto` | TIMESTAMPTZ | Última vez que llegó algo suyo. Sirve para marcarlo como caído. |
| `version_firmware` | TEXT | Versión que reporta el ESP32; útil para saber a quién actualizar. |
| `creado_en` | TIMESTAMPTZ | Fecha de registro. |

Índice `idx_dispositivos_user`: lista rápida de "los robots de este usuario", que es la
consulta que hace el dashboard en cada carga.

## 3. `configuracion_dispositivo` — lo que el robot obedece

Relación **1 a 1** con `dispositivos` (la PK es la propia FK). El backend publica esta fila
como mensaje **retenido** en el tópico `config`, así un robot que se reconecta recibe su
configuración de inmediato.

| Campo | Tipo | Para qué sirve |
|---|---|---|
| `dispositivo_id` | PK + FK | El robot al que pertenece la configuración. |
| `modo` | TEXT | `automatico` (limpiando), `pausado` (parado pero en sesión) o `detenido`. |
| `distancia_evasion_cm` | INTEGER 5–50 | A esta distancia el robot esquiva el obstáculo. |
| `distancia_precaucion_cm` | INTEGER ≤ 100 | A esta distancia empieza a frenar. |
| `velocidad_base_pct` | INTEGER 30–100 | Velocidad de crucero de los motores. |
| `intervalo_telemetria_ms` | INTEGER 100–2000 | Cada cuánto manda una lectura. Es el mando de volumen de datos. |
| `angulos_sensores` | JSONB | Ángulo de montaje de cada ultrasonido, por defecto `{"izq":-45,"centro":0,"der":45}`. Se usa para proyectar los obstáculos en el mapa. JSONB porque es un objeto pequeño y fijo que se lee completo. |
| `area_ancho_cm` / `area_alto_cm` | INTEGER | Tamaño de la habitación; define el lienzo del mapa. |
| `actualizado_en` | TIMESTAMPTZ | Cuándo se cambió por última vez. |

Restricción `precaucion_mayor_que_evasion`: `distancia_precaucion_cm > distancia_evasion_cm`.
Si no, el robot nunca frenaría antes de esquivar — la regla la impone la base, no la interfaz,
así que ninguna ruta del código puede saltársela.

**Trigger `trg_configuracion_por_defecto`**: al insertar un dispositivo, crea automáticamente
su fila de configuración con los valores por defecto. Garantiza que no exista un robot sin
configuración, sin repetir el `INSERT` en cada camino del código.

## 4. `sesiones` — un ciclo de funcionamiento

Desde que el robot pasa a `automatico` hasta que se detiene. Es la unidad con la que el
dashboard agrupa el historial ("sesión del martes, 12 minutos, 3 evasiones").

| Campo | Tipo | Para qué sirve |
|---|---|---|
| `id` | BIGSERIAL PK | Identificador de la sesión. |
| `dispositivo_id` | FK → `dispositivos` | Robot que la ejecutó. |
| `iniciada_en` | TIMESTAMPTZ | Arranque. |
| `finalizada_en` | TIMESTAMPTZ NULL | Cierre. **`NULL` significa que la sesión sigue activa.** |
| `total_lecturas` | INTEGER | Contador acumulado de lecturas (evita un `count(*)` en cada pantalla). |
| `total_evasiones` | INTEGER | Cuántas veces esquivó un obstáculo. |
| `distancia_recorrida_cm` | NUMERIC(9,1) | Recorrido total estimado por odometría. |
| `bateria_inicio_pct` / `bateria_fin_pct` | SMALLINT | Batería al empezar y al acabar; su resta es el consumo de la sesión. |

Índice único parcial `uniq_sesion_activa_por_dispositivo` sobre `(dispositivo_id) WHERE
finalizada_en IS NULL`: **un robot no puede tener dos sesiones abiertas a la vez.** Es la
protección contra sesiones duplicadas si el robot se reconecta y vuelve a anunciar arranque.

Índice `idx_sesiones_dispositivo (dispositivo_id, iniciada_en DESC)`: historial del robot,
de la más reciente a la más antigua.

## 5. `lecturas` — la telemetría

Una fila por muestra enviada por el ESP32 (cada `intervalo_telemetria_ms`). Es la tabla que
más crece; de ella salen las gráficas y el mapa.

| Campo | Tipo | Para qué sirve |
|---|---|---|
| `id` | BIGSERIAL PK | Identificador de la lectura. |
| `dispositivo_id` | FK | Robot emisor (desnormalizado a propósito: permite consultar por robot sin unir con `sesiones`). |
| `sesion_id` | FK NULL | Sesión a la que pertenece. `NULL` si llegó fuera de una sesión. |
| `secuencia` | INTEGER | Contador propio del ESP32. Permite **detectar lecturas perdidas** (huecos) y **descartar duplicados**. |
| `dist_izq_cm`, `dist_centro_cm`, `dist_der_cm` | NUMERIC(5,1) | Lectura de cada ultrasonido. **`NULL` = no hay objeto dentro del alcance del sensor**, que no es lo mismo que "0 cm". |
| `estado_movimiento` | TEXT | `avanzando`, `girando_izq`, `girando_der`, `retrocediendo` o `detenido`. Con `CHECK`, para que las gráficas de estado no reciban valores inventados. |
| `pos_x_cm`, `pos_y_cm` | NUMERIC(7,1) | Posición estimada en el plano de la habitación. |
| `orientacion_deg` | NUMERIC(5,1) | Hacia dónde mira el robot. Junto a la posición y los ángulos de los sensores, proyecta los obstáculos. |
| `vel_izq_pct`, `vel_der_pct` | SMALLINT −100..100 | Consigna de cada motor; el signo indica el sentido. |
| `bateria_v` | NUMERIC(4,2) | Voltaje medido (el dato crudo). |
| `bateria_pct` | SMALLINT | Porcentaje derivado del voltaje; es lo que se muestra. |
| `rssi_dbm` | SMALLINT | Potencia del WiFi; sirve para explicar cortes y latencias altas. |
| `medido_en` | TIMESTAMPTZ | Hora del propio robot (NTP), *cuándo pasó*. |
| `recibido_en` | TIMESTAMPTZ | Cuándo llegó al backend. |
| `creado_en` | TIMESTAMPTZ | Cuándo se insertó en la base. |

Los tres sellos de tiempo no son redundantes: `recibido_en − medido_en` **es** la latencia
extremo a extremo que publican las vistas, y tener `creado_en` aparte permite ordenar por
llegada aunque el reloj del robot vaya mal.

Índice `idx_lecturas_dispositivo (dispositivo_id, creado_en DESC)`: "últimas N lecturas de
este robot", la consulta del panel en vivo.
Índice único `uniq_lectura_secuencia (sesion_id, secuencia)`: si el robot reenvía un lote
guardado durante un corte de red, la lectura **no se duplica** (idempotencia).

## 6. `eventos` — hechos puntuales

Lo que merece una entrada en la bitácora y, si toca, una alerta en pantalla.

| Campo | Tipo | Para qué sirve |
|---|---|---|
| `id` | BIGSERIAL PK | Identificador del evento. |
| `dispositivo_id` | FK | Robot afectado. |
| `sesion_id` | FK NULL | Sesión en curso; `NULL` para eventos fuera de sesión (una `conexion`, por ejemplo). |
| `tipo` | TEXT | `obstaculo`, `atascado`, `bateria_baja`, `conexion`, `desconexion`, `cambio_modo`. Lista cerrada por `CHECK`. |
| `sensor` | TEXT NULL | Qué sensor lo disparó (`izq`/`centro`/`der`). Solo aplica a `obstaculo`; de ahí salen las evasiones por sensor. |
| `distancia_cm` | NUMERIC(5,1) | A qué distancia ocurrió. |
| `pos_x_cm`, `pos_y_cm` | NUMERIC(7,1) | Dónde ocurrió, para marcarlo en el mapa. |
| `mensaje` | TEXT | Texto legible para la bitácora. |
| `atendido` | BOOLEAN | Si el usuario ya lo revisó; permite filtrar lo pendiente. |
| `creado_en` | TIMESTAMPTZ | Cuándo se registró. |

Índices: `idx_eventos_dispositivo (dispositivo_id, creado_en DESC)` para la bitácora reciente,
e `idx_eventos_sesion (sesion_id, creado_en)` para la repetición cronológica de una sesión.

---

## Vistas (consultas guardadas, no almacenan datos)

### `v_lecturas_por_minuto`
Agrega las lecturas por robot, sesión y minuto. Devuelve cuántas lecturas hubo, el mínimo y el
promedio de cada sensor, cuántas lecturas en cada estado de movimiento, la batería promedio y
la **latencia media en ms** (`recibido_en − medido_en`). Alimenta las gráficas históricas sin
mandar al navegador miles de puntos.

### `v_lecturas_por_hora`
Lo mismo pero por hora y sin separar por sesión, para rangos largos. Añade `cerca_izq`,
`cerca_centro` y `cerca_der`: cuántas lecturas tuvieron ese sensor a 15 cm o menos, es decir,
en qué dirección se topa más el robot.

### `v_resumen_sesion`
Una fila por sesión con todo lo que pide la pantalla de detalle:
- `duracion_s` — usa `now()` si la sesión sigue abierta.
- `bateria_consumida_pct` — inicio menos fin.
- `pct_perdidas` — **lecturas perdidas**, calculado con los huecos de `secuencia`: si llegaron
  180 lecturas pero la secuencia máxima es 200, se perdió el 10 %.
- `latencia_ms` — latencia media de la sesión.
- `n_avanzando`, `n_girando_izq`, `n_girando_der`, `n_retrocediendo`, `n_detenido` — reparto del tiempo.
- `evasiones_izq`, `evasiones_centro`, `evasiones_der` — obstáculos por sensor, desde `eventos`.

## Función `obtener_mapa_sesion(p_sesion_id, p_max_puntos = 3000)`

Devuelve la trayectoria de una sesión y, en cada punto, los obstáculos vistos como JSONB.
Dos detalles importantes:

1. **Proyección de obstáculos.** Para cada sensor con lectura:
   `x_obs = x + (radio + d)·cos(θ + ángulo)`, `y_obs = y + (radio + d)·sin(θ + ángulo)`,
   con `radio = 17 cm` (el chasis) y el ángulo tomado de `angulos_sensores`. Es la misma
   fórmula que `puntoObstaculo` en `@iot/shared`, para que el mapa en vivo y la repetición
   histórica dibujen exactamente lo mismo.
2. **Muestreo uniforme.** Toma una fila cada `paso` (`row_number() % paso`) para no pasar de
   `p_max_puntos`. Un `LIMIT` recortaría el final del recorrido; esto reduce la densidad pero
   conserva el trayecto completo.

---

## Resumen de decisiones de diseño

- **Las reglas viven en la base**, no solo en la aplicación: `CHECK` para los valores válidos,
  `precaucion_mayor_que_evasion`, un índice único parcial para "una sola sesión activa" y otro
  para la idempotencia de las lecturas.
- **`ON DELETE CASCADE` en toda la jerarquía**: borrar un usuario o un robot no deja filas huérfanas.
- **El trigger garantiza la configuración**, así que el resto del código puede dar por hecho que existe.
- **`NULL` significa algo concreto** en las distancias (sin objeto en rango) y en `finalizada_en`
  (sesión activa); no es "falta el dato".
- **Agregación en vistas**, no en el navegador: los paneles piden resúmenes, no telemetría cruda.
