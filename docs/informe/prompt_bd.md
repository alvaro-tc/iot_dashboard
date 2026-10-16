# Prompt para NotebookLM — Base de datos en detalle (diapositivas complementarias)

Genera una presentación complementaria, centrada **exclusivamente en la base de datos** del proyecto "Aspiradora autónoma IoT con ESP32" (PostgreSQL, informe de Internet de las Cosas, UCB — Álvaro Torrez y Karen Vargas). Esta tanda de diapositivas se usará dentro de la misma exposición de 15 minutos, en la sección de "Diseño de la base de datos", y debe ir **más a detalle** que el resto: cada tabla se explica columna por columna, con su tipo de dato, sus restricciones y por qué existe.

Genera entre **9 y 12 diapositivas**. No inventes columnas, tipos ni reglas que no estén en el contenido de abajo — está extraído literalmente del esquema SQL real del proyecto (`apps/api/db/schema.sql`).

---

## Tema visual (igual que el resto de la presentación — mantener coherencia)

- Fondo blanco/crema con cuadrícula fina tipo papel de cuaderno de ingeniería.
- Formas orgánicas tipo "blob" en las esquinas, en azul petróleo, naranja mostaza, lavanda y verde salvia, nunca sobre el texto.
- Iconos de línea fina estilo boceto/doodle, un solo color por icono, sin 3D ni sombras pesadas.
- Tipografía sans-serif moderna y redondeada, texto en gris oscuro (nunca negro puro).
- **Todas las imágenes e ilustraciones generadas deben ser minimalistas, modernas y a color**, en ese mismo estilo plano — nunca fotorrealistas ni en blanco y negro. Para el diagrama entidad-relación, usar cajas limpias de esquinas redondeadas, una por tabla, con líneas de relación finas y claras entre ellas, coloreadas con la misma paleta (sin perder legibilidad de cardinalidades y nombres de columna).

---

## 1. Portada de la sección
"Diseño de la base de datos" · PostgreSQL nativo en VPS · 8 tablas relacionales.

## 2. Por qué PostgreSQL (y no una solución gestionada)
- Motor: **PostgreSQL** nativo en el VPS (sin Docker), administrado directamente por la API con el cliente `pg`.
- Se descartó una solución gestionada tipo Supabase porque el proyecto ya corre en un VPS pequeño ocupado por Mosquitto, Node.js y Nginx/Caddy.
- Las reglas de integridad del dominio (rangos de PWM y de distancia, una sola sesión activa por robot, configuración obligatoria por robot) se expresan de forma natural con **restricciones CHECK, índices únicos parciales y triggers** del propio motor relacional, sin depender de una capa externa ni de validaciones solo en el código.

## 3. Diagrama entidad-relación (UML) — vista general
Genera un **diagrama entidad-relación completo** (una caja por tabla, con sus columnas clave visibles) que reproduzca exactamente esta estructura y estas cardinalidades:

```
usuarios (1) ──── (1) preferencias_usuario
usuarios (1) ──── (0..*) dispositivos
dispositivos (1) ──── (1) configuracion_dispositivo
dispositivos (1) ──── (0..*) salas
dispositivos (1) ──── (0..*) sesiones
dispositivos (1) ──── (0..*) lecturas
salas (1) ──── (0..1) mapas
salas (0..1) ──── (0..*) configuracion_dispositivo   [sala_activa_id, opcional]
sesiones (0..1) ──── (0..*) lecturas
```

Para cada caja del diagrama, mostrar al menos la clave primaria (PK), las claves foráneas (FK) y 2-3 columnas representativas (no hace falta listar todas en el diagrama; el detalle completo va en las diapositivas siguientes, tabla por tabla). Marcar claramente con una línea distinta (punteada o de otro color) la única relación que no es un `ON DELETE CASCADE` normal: `configuracion_dispositivo.sala_activa_id → salas.id` usa `ON DELETE SET NULL`.

**Entidades y relaciones a reflejar (texto base para el diagrama):**
- `usuarios` 1 — 1 `preferencias_usuario` (la preferencia se borra en cascada si se borra el usuario).
- `usuarios` 1 — N `dispositivos` (un usuario puede tener varios robots).
- `dispositivos` 1 — 1 `configuracion_dispositivo` (creada automáticamente por un trigger al insertar el dispositivo).
- `dispositivos` 1 — N `salas` (un robot puede tener varias habitaciones mapeadas).
- `salas` 1 — 0..1 `mapas` (cada sala tiene como máximo un mapa asociado).
- `configuracion_dispositivo` N — 0..1 `salas` (vía `sala_activa_id`: qué sala está mapeando el robot ahora mismo; puede ser ninguna).
- `dispositivos` 1 — N `sesiones` (ciclos de limpieza del robot).
- `dispositivos` 1 — N `lecturas` (telemetría cruda).
- `sesiones` 1 — N `lecturas` (cada lectura puede pertenecer a una sesión).

## 4. Tabla `usuarios`
Cuentas que entran al dashboard.

| Columna | Tipo | Restricciones / notas |
|---|---|---|
| `id` | SERIAL | Clave primaria |
| `correo` | TEXT | `UNIQUE NOT NULL` — identifica la cuenta, no se repite |
| `contrasena` | TEXT | `NOT NULL` — hash **bcrypt**, nunca la contraseña en claro |
| `nombre` | TEXT | `NOT NULL` |
| `rol` | TEXT | `NOT NULL`, `CHECK (rol IN ('admin','cliente'))` — solo esos dos valores son válidos, la base los rechaza a nivel de motor, no solo la API |
| `activo` | BOOLEAN | `NOT NULL DEFAULT true` — una cuenta desactivada pierde el acceso en la siguiente petición (se revalida en cada request, no solo al iniciar sesión) |
| `lidar_habilitado` | BOOLEAN | `NOT NULL DEFAULT false` — permiso del modo beta de mapeo de habitaciones, que da y quita un admin. Por defecto **apagado**: un cliente sin este permiso ni siquiera puede saber que la función existe, porque la API responde 404 en `/api/lidar/*` en vez de 403 |
| `creado_en` | TIMESTAMPTZ | `NOT NULL DEFAULT now()` |

## 5. Tabla `preferencias_usuario`
Relación 1 a 1 con `usuarios`, pensada para que la lea y escriba casi sin validar el propio navegador.

| Columna | Tipo | Restricciones / notas |
|---|---|---|
| `usuario_id` | INTEGER | `PRIMARY KEY`, `REFERENCES usuarios(id) ON DELETE CASCADE` — es a la vez PK y FK, por eso la relación es estrictamente 1 a 1 |
| `datos` | JSONB | `NOT NULL DEFAULT '{}'` — tema e interfaz del panel (qué widgets, dónde y con qué ajustes); para la base es un JSONB opaco, la valida el frontend, no el motor |
| `actualizado_en` | TIMESTAMPTZ | `NOT NULL DEFAULT now()` |

Vive en la cuenta (no en el navegador) para que la misma cuenta vea la misma interfaz en cualquier dispositivo.

## 6. Tabla `dispositivos`
Un robot físico. Su `id` de texto es a la vez su usuario MQTT.

| Columna | Tipo | Restricciones / notas |
|---|---|---|
| `id` | TEXT | `PRIMARY KEY`, ej. `roomba-7f3a9c2b` — la ACL de Mosquitto ata este mismo id a `roomba/{id}/#` |
| `usuario_id` | INTEGER | `NOT NULL`, `REFERENCES usuarios(id) ON DELETE CASCADE` |
| `nombre` | TEXT | `NOT NULL`, ej. `Roomba Sala` |
| `ubicacion` | TEXT | `NOT NULL DEFAULT ''` |
| `token_hash` | TEXT | `NOT NULL` — hash bcrypt del token MQTT, valida `POST /api/ingesta` |
| `token_cifrado` | TEXT | cifrado con AES-256-GCM (no bcrypt) para que el propietario pueda volver a verlo desde el panel, cosa que un hash no permite |
| `revocado` | BOOLEAN | `NOT NULL DEFAULT false` |
| `en_linea` | BOOLEAN | `NOT NULL DEFAULT false` — lo actualiza el Last Will de MQTT |
| `ultimo_contacto` | TIMESTAMPTZ | nulo hasta el primer mensaje |
| `version_firmware` | TEXT | |
| `creado_en` | TIMESTAMPTZ | `NOT NULL DEFAULT now()` |

Índice: `idx_dispositivos_usuario` sobre `usuario_id` (listar los robots de un usuario rápido).

## 7. Tabla `configuracion_dispositivo`
Relación 1 a 1 con `dispositivos`; lo que el robot obedece. El backend la publica retenida en el tópico MQTT `config`.

| Columna | Tipo | Restricciones / notas |
|---|---|---|
| `dispositivo_id` | TEXT | `PRIMARY KEY`, `REFERENCES dispositivos(id) ON DELETE CASCADE` |
| `velocidad_base` | SMALLINT | `NOT NULL DEFAULT 180`, `CHECK (BETWEEN 0 AND 255)` — PWM de crucero, misma escala que el firmware (`PWM_MAXIMO = 255`) |
| `angulos_sensores` | JSONB | `NOT NULL DEFAULT {"izquierdo":-45,"central":0,"derecho":45}` — ángulo de montaje de cada HC-SR04 respecto al frente del robot |
| `geometria` | JSONB | medidas del chasis y posición de cada sensor (cm desde el centro del eje). Importa para el mapeo: el haz del sensor no nace en el centro del robot, y sin ese desplazamiento el punto medido queda desviado |
| `calibracion` | JSONB | lo que hay que medir a mano porque no hay encoders: grados/segundo girando y cm/s avanzando, con el PWM al que se midieron; `medidoEn = null` significa "sin calibrar" y el modo mapeo lo avisa |
| `sala_activa_id` | BIGINT | `REFERENCES salas(id) ON DELETE SET NULL` — qué habitación está mapeando el robot ahora; columna añadida después con `ALTER TABLE` para que sea imposible tener dos salas activas a la vez, y para que borrar la sala no deje al robot apuntando a una fila inexistente |
| `actualizado_en` | TIMESTAMPTZ | `NOT NULL DEFAULT now()` |

**Trigger importante:** `trg_configuracion_por_defecto` se dispara `AFTER INSERT ON dispositivos` y crea automáticamente la fila de configuración — ningún camino del código puede dejar un robot sin configuración.

## 8. Tablas `salas` y `mapas` (modo beta de mapeo)
**`salas`** — una habitación de un robot. La forma es siempre un polígono de paredes rectas (un rectángulo es un polígono de 4 vértices), para que el mismo algoritmo de encaje sirva para una sala cuadrada o en L.

| Columna | Tipo | Restricciones / notas |
|---|---|---|
| `id` | BIGSERIAL | `PRIMARY KEY` |
| `dispositivo_id` | TEXT | `NOT NULL`, `REFERENCES dispositivos(id) ON DELETE CASCADE` |
| `nombre` | TEXT | `NOT NULL` |
| `forma` | TEXT | `DEFAULT 'rectangulo'`, `CHECK (forma IN ('rectangulo','poligono'))` — solo cambia qué editor muestra la interfaz |
| `vertices` | JSONB | `NOT NULL` — lista `[{x,y},…]` en cm, polígono cerrado (la validación de mínimo 3 vértices la hace Zod en la API, no un CHECK) |
| `ancho_estimado_cm` / `alto_estimado_cm` | INTEGER | `NOT NULL`, `CHECK (BETWEEN 50 AND 2000)` — lo que estimó el usuario antes de mapear; es la semilla del encaje y se guarda aparte para comparar cuánto se equivocaba |
| `ancho_real_cm` / `alto_real_cm` | NUMERIC(6,1) | caja del polígono ya mapeado; `null` hasta el primer barrido que encaje |
| `puertas` | JSONB | `DEFAULT '[]'` — huecos que NO son salida; el robot los trata como pared para no escaparse |
| `creado_en` / `actualizado_en` | TIMESTAMPTZ | `NOT NULL DEFAULT now()` |

Índice `idx_salas_dispositivo` (dispositivo_id, creado_en) y único `uniq_sala_nombre_por_dispositivo` (dispositivo_id, lower(nombre)) — dos salas del mismo robot no pueden llamarse igual.

**`mapas`** — el mapa en curso de una sala, 1 a 1 con ella, en tabla aparte porque la rejilla pesa (una sala de 5×4 m son 8000 celdas).

| Columna | Tipo | Restricciones / notas |
|---|---|---|
| `sala_id` | BIGINT | `PRIMARY KEY`, `REFERENCES salas(id) ON DELETE CASCADE` |
| `rejilla` | TEXT | rejilla de ocupación en log-odds, un byte por celda, codificada en base64 |
| `cols` / `filas` | INTEGER | `NOT NULL`, `CHECK (> 0)` |
| `resolucion_cm` | SMALLINT | `DEFAULT 5`, `CHECK (> 0)` — tamaño de celda en cm |
| `obstaculos` | JSONB | `DEFAULT '[]'` — formas ya extraídas de la rejilla, para no recalcularlas en cada carga del panel |
| `barridos` | INTEGER | `DEFAULT 0` — cuántos barridos se acumularon |
| `cobertura` | NUMERIC(4,3) | `DEFAULT 0` — fracción de la sala con una opinión (libre u ocupada), de 0 a 1 |
| `actualizado_en` | TIMESTAMPTZ | `NOT NULL DEFAULT now()` |

## 9. Tabla `sesiones`
Un ciclo de funcionamiento del robot: se abre con la primera lectura que llega y se cierra cuando el robot se desconecta o deja de publicar.

| Columna | Tipo | Restricciones / notas |
|---|---|---|
| `id` | BIGSERIAL | `PRIMARY KEY` |
| `dispositivo_id` | TEXT | `NOT NULL`, `REFERENCES dispositivos(id) ON DELETE CASCADE` |
| `iniciada_en` | TIMESTAMPTZ | `NOT NULL DEFAULT now()` |
| `finalizada_en` | TIMESTAMPTZ | `null` = la sesión sigue activa |
| `total_lecturas` | INTEGER | `NOT NULL DEFAULT 0` |
| `bateria_inicio_porcentaje` / `bateria_fin_porcentaje` | SMALLINT | batería al empezar y al terminar el ciclo |

**Regla de integridad clave:** índice único parcial `uniq_sesion_activa_por_dispositivo` sobre `(dispositivo_id) WHERE finalizada_en IS NULL` — impuesto por la base, no por la API: un mismo robot **no puede tener dos sesiones abiertas a la vez**. Índice adicional `idx_sesiones_dispositivo` (dispositivo_id, iniciada_en DESC) para listar el historial rápido.

## 10. Tabla `lecturas`
Telemetría cruda: una fila por cada mensaje publicado por el robot. Es la tabla que más crece — la materia prima de todas las gráficas del panel.

| Columna | Tipo | Restricciones / notas |
|---|---|---|
| `id` | BIGSERIAL | `PRIMARY KEY` |
| `dispositivo_id` | TEXT | `NOT NULL`, `REFERENCES dispositivos(id) ON DELETE CASCADE` |
| `sesion_id` | BIGINT | `REFERENCES sesiones(id) ON DELETE CASCADE` (opcional) |
| `distancia_izquierda_cm` / `distancia_central_cm` / `distancia_derecha_cm` | NUMERIC(5,1) | `CHECK (BETWEEN 0 AND 400)` — rango físico real del HC-SR04; `NULL` significa explícitamente "el eco no volvió" (no hay objeto dentro del alcance), no "falta el dato" |
| `movimiento_izquierda` / `movimiento_derecha` | SMALLINT | `NOT NULL`, `CHECK (BETWEEN -255 AND 255)` — PWM **con signo** de cada rueda: negativo retrocede, positivo avanza, 0 parada. Sustituye a un antiguo campo de texto `estado_movimiento`: con las dos ruedas numéricas se deduce si el robot avanza, retrocede o gira (y hacia dónde) sin inventar una etiqueta intermedia que se podía desincronizar del PWM real |
| `bateria_voltios` | NUMERIC(4,2) | `CHECK (>= 0)` |
| `bateria_porcentaje` | SMALLINT | `CHECK (BETWEEN 0 AND 100)` |
| `creado_en` | TIMESTAMPTZ | `NOT NULL DEFAULT now()` |

Índices: `idx_lecturas_dispositivo` (dispositivo_id, creado_en DESC) para el historial por robot, `idx_lecturas_sesion` (sesion_id, creado_en) para agrupar por ciclo de limpieza.

## 11. Automatismos del motor: trigger y vistas
- **Trigger `trg_configuracion_por_defecto`:** se ejecuta `AFTER INSERT ON dispositivos`, llama a la función `crear_configuracion_por_defecto()` y crea automáticamente la fila correspondiente en `configuracion_dispositivo`. Garantiza que **nunca** exista un robot sin su configuración, sin depender de que el código de la API se acuerde de crearla.
- **Tres vistas agregadas** (mencionadas en el informe, no recreadas aquí en detalle): `v_lecturas_por_minuto`, `v_lecturas_por_hora` y `v_resumen_sesion` — resumen de la telemetría calculado por el propio PostgreSQL, para no mandar miles de filas crudas de `lecturas` al navegador en cada gráfica del historial.

## 12. Resumen de reglas de integridad (cierre de la sección)
- **CHECK de rango físico:** PWM de motor (-255..255), distancia de sensor (0..400 cm), batería (0..100%), tamaño de sala (50..2000 cm), rol de usuario y forma de sala limitados a una lista fija.
- **Índices únicos:** una sola sesión activa por robot; nombres de sala únicos por robot (sin distinguir mayúsculas).
- **Borrado en cascada:** `ON DELETE CASCADE` recorre toda la jerarquía `usuarios → dispositivos → configuracion_dispositivo / salas / sesiones → mapas / lecturas`, salvo `configuracion_dispositivo.sala_activa_id`, que usa `ON DELETE SET NULL` para no bloquear el robot si se borra la sala que tenía activa.
- Conclusión para el jurado: las reglas de negocio más importantes (una sesión activa, rangos físicos imposibles de violar, nunca un robot sin configuración) están garantizadas **por el propio motor relacional**, no solo por validaciones en el código de la API.

---

## Instrucciones de formato para NotebookLM
- Reproduce las tablas de columnas tal como están arriba, como tablas reales (columna / tipo / restricciones), no como párrafos de texto corrido.
- El diagrama entidad-relación de la diapositiva 3 es el elemento gráfico más importante de esta sección: debe ser una imagen clara, generada en el estilo minimalista/moderno/a color del tema (ver arriba), con cajas redondeadas por tabla y líneas de relación legibles, no un diagrama genérico de base de datos.
- No resumas ni omitas columnas de las tablas: el objetivo explícito de esta tanda de diapositivas es el detalle, a diferencia del resto de la presentación.
- No agregues columnas, tipos de dato ni restricciones que no aparezcan en el contenido de arriba.
