# Prompt: "Primera Evaluación IoT" — plataforma de telemetría de series de aproximación

Construye un **monorepo** completo y funcional para una plataforma que recibe, almacena y visualiza en tiempo real series numéricas de aproximación enviadas por dispositivos ESP32-S3 vía MQTT, con autenticación de usuarios, vinculación de dispositivos e historial de sesiones de envío.

El producto se llama **Primera Evaluación IoT**.

---

## 1. Stack y estructura

- **Monorepo** con pnpm workspaces (`pnpm-workspace.yaml` en la raíz y `package.json` con scripts `dev`, `build`, `lint` que orquesten ambas apps en paralelo con `concurrently`).
- **Frontend:** React 18 + Vite + TypeScript, React Router, Recharts, `date-fns`. Estilos con Tailwind o CSS Modules. Sin librerías de componentes prefabricados (nada de MUI, Ant, Chakra): el diseño es propio.
- **Backend:** Node.js + Express + TypeScript, `mqtt.js`, `pg`, `ws`, `jsonwebtoken`, `bcrypt`, `nanoid`, `zod` para validación.
- **Base de datos:** PostgreSQL.
- **Broker MQTT:** Mosquitto vía Docker, con autenticación por usuario y ACL.
- **Docker Compose** en la raíz levantando Postgres y Mosquitto con volúmenes persistentes.

```
/
├─ package.json
├─ pnpm-workspace.yaml
├─ docker-compose.yml
├─ .env.example
├─ mosquitto/
│  ├─ mosquitto.conf
│  ├─ passwd          # generado y mantenido por el backend
│  └─ acl             # generado y mantenido por el backend
├─ apps/
│  ├─ web/
│  └─ api/
└─ packages/
   └─ shared/
```

`packages/shared` es la única fuente de verdad sobre las series, la precisión decimal y los formatos de topic. Ninguna app redefine esa información.

---

## 2. Las 7 series

Series clásicas, de una sola línea, fáciles de explicar y de **convergencia lenta** — la lentitud es intencional: el objetivo visual es ver la curva acercándose poco a poco al valor real.

| key | Serie | Término k (k desde 1) | Converge a | Valor real | Orden del error |
|---|---|---|---|---|---|
| `pi_leibniz` | Leibniz–Gregory | `4·(-1)^(k+1)/(2k-1)` (suma) | π | 3.141592653589793 | ~1/(2n) |
| `ln2_alternating` | Armónica alternada | `(-1)^(k+1)/k` (suma) | ln 2 | 0.693147180559945 | ~1/(2n) |
| `wallis_pi` | Producto de Wallis | `(2k/(2k-1))·(2k/(2k+1))` (producto), ×2 al reportar | π | 3.141592653589793 | ~1/n |
| `euler_gamma` | Euler–Mascheroni | `H(n) - ln(n)`, con `H(n)=Σ1/k` | γ | 0.577215664901533 | ~1/(2n) |
| `basel` | Problema de Basilea | `1/k²` (suma) | π²/6 | 1.644934066848226 | ~1/n |
| `pi2_over_8` | Suma de impares al cuadrado | `1/(2k-1)²` (suma) | π²/8 | 1.233700550136169 | ~1/(2n) |
| `catalan` | Constante de Catalan | `(-1)^(k+1)/(2k-1)²` (suma) | G | 0.915965594177219 | ~1/n² |

- Todas son acumulativas: en la iteración `n` se reporta la suma (o producto) de los primeros `n` términos, no el término suelto.
- `wallis_pi` es el único producto: acumulador inicializado en 1, se reporta `2 × acumulado`.
- `euler_gamma` acumula `H(n)` y reporta `H(n) - ln(n)`.
- Las cuatro primeras son muy lentas: Leibniz necesita ~200 iteraciones para dos decimales correctos de π y ~2000 para tres. `catalan` es la más rápida y sirve de contraste.

`packages/shared/src/series.ts` exporta la lista con `key`, `label`, `symbol`, `realValue`, `formulaTex`, `description`, y una función pura `computeTerm(key, k, acc)` usada tanto por el simulador del frontend como por validaciones del backend.

---

## 3. Precisión decimal

- **Almacenamiento:** `DOUBLE PRECISION` en Postgres. No uses `NUMERIC`.
- **Transporte MQTT:** el valor viaja como número JSON con 10 decimales. El ESP32 usa `double` (no `float`) y formatea con `%.10f`.
- **Visualización:** decimales fijos, siempre con `toFixed`, nunca notación científica ni decimales variables.

```ts
export const DECIMALS = {
  value:     10,  // valor aproximado
  realValue: 10,  // constante de referencia, misma escala para comparar de un vistazo
  errorAbs:  10,  // error absoluto |aprox - real|
  errorRel:   8,  // error relativo en porcentaje
  chartAxis:  6,  // etiquetas de los ejes
} as const;

export const fmt = {
  value:     (x: number) => x.toFixed(DECIMALS.value),
  realValue: (x: number) => x.toFixed(DECIMALS.realValue),
  errorAbs:  (x: number) => x.toFixed(DECIMALS.errorAbs),
  errorRel:  (x: number) => x.toFixed(DECIMALS.errorRel) + ' %',
};
```

Ningún componente formatea números por su cuenta: todos usan estos helpers.

- **Resaltado de dígitos correctos:** en la columna del valor aproximado, renderiza con color de tinta el prefijo de dígitos que ya coincide con el valor real y en gris claro el resto. Con Leibniz se ve literalmente cómo `3.1` se vuelve `3.14` y luego `3.141`. Es el detalle que hace legible una serie lenta.
- **Alineación:** fuente monoespaciada y alineación a la derecha en todas las celdas numéricas.

---

## 4. Base de datos

Cuatro tablas. Las series no van en base de datos: viven en `packages/shared`.

```sql
CREATE TABLE users (
  id          SERIAL PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,              -- hash bcrypt
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin','client')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un ESP32 vinculado a un cliente.
CREATE TABLE devices (
  id            TEXT PRIMARY KEY,              -- ej. 'esp32-7f3a9c2b'
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                 -- alias legible, ej. 'Sensor laboratorio'
  token_hash    TEXT NOT NULL,                 -- hash bcrypt del token MQTT
  is_revoked    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ
);
CREATE INDEX idx_devices_user ON devices (user_id);

-- Una sesión de envío: un tramo continuo en el que un cliente
-- estuvo mandando datos de UNA sola serie.
CREATE TABLE runs (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id       TEXT REFERENCES devices(id) ON DELETE SET NULL,  -- null si vino del simulador web
  series_key      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','finished')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  sample_count    INTEGER NOT NULL DEFAULT 0,
  last_iteration  INTEGER NOT NULL DEFAULT 0,
  last_value      DOUBLE PRECISION,
  last_error_abs  DOUBLE PRECISION,
  source          TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web','device'))
);

-- Regla de negocio impuesta por la base de datos:
-- un cliente solo puede tener UNA sesión activa a la vez.
CREATE UNIQUE INDEX uniq_active_run_per_user
  ON runs (user_id) WHERE status = 'active';
CREATE INDEX idx_runs_user ON runs (user_id, started_at DESC);

CREATE TABLE samples (
  id          BIGSERIAL PRIMARY KEY,
  run_id      BIGINT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  iteration   INTEGER NOT NULL,
  value       DOUBLE PRECISION NOT NULL,
  error_abs   DOUBLE PRECISION NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_samples_run ON samples (run_id, iteration);
```

`samples` no guarda `user_id` ni `series_key`: se derivan del `run_id`.

Archivos `apps/api/db/schema.sql` y `apps/api/db/seed.sql` (un admin `admin@demo.com`/`admin123`, tres clientes, uno de ellos llamado Álvaro con historial precargado de varias sesiones en distintas horas del mismo día para poder ver la línea de tiempo sin esperar). Script `pnpm db:reset`. Sin ORM: SQL directo con `pg`.

---

## 5. Autenticación

### 5.1 Usuarios (web)

- **Registro** (`/signup`): nombre, correo, contraseña, confirmación. Crea siempre un usuario con `role='client'`; el rol admin solo se asigna desde el seed o desde el panel de administración. Valida fuerza mínima de contraseña y correo único, con mensajes de error claros y específicos por campo.
- **Inicio de sesión** (`/login`): correo y contraseña. Devuelve un JWT con `{ sub, role }` y expiración de 12 h.
- **Cierre de sesión**: botón en el pie de la barra lateral. Descarta el token, limpia el estado en memoria, cierra el WebSocket y redirige a `/login`.
- El JWT se guarda en `localStorage`; un interceptor lo adjunta en `Authorization: Bearer` y, ante un 401, fuerza logout. Las rutas están protegidas por rol: un cliente que intente entrar a `/admin/*` recibe un 403 y es redirigido a su panel.
- Un usuario con `is_active = false` no puede iniciar sesión, y si tiene sesión abierta sus peticiones son rechazadas.

### 5.2 Dispositivos ESP32 — método elegido y por qué

**Credenciales MQTT por dispositivo, gestionadas por el backend contra Mosquitto.** Cada ESP32 tiene su propio usuario y contraseña del broker, y una ACL que le permite publicar únicamente en su propio prefijo de topic.

Descarté las alternativas por estas razones: un usuario y contraseña compartidos entre todos los dispositivos hace imposible revocar uno solo y permite que cualquier nodo publique suplantando a otro cliente; certificados TLS mutuos (mTLS) son la opción más segura y la correcta en producción, pero exigen generar, distribuir y rotar un certificado por dispositivo y complican mucho el firmware; y un JWT dentro del payload no sirve porque el dispositivo no puede renovarlo sin lógica adicional y el token viajaría repetido en cada mensaje. Las credenciales por dispositivo dan aislamiento y revocación real con un firmware de cuatro líneas de configuración.

**Flujo de vinculación:**

1. El cliente entra a "Mis dispositivos" y pulsa **Vincular ESP32**, dándole un nombre.
2. El backend genera `deviceId = 'esp32-' + nanoid(8)` y un `token` aleatorio de 32 caracteres. Guarda solo el hash bcrypt del token.
3. Escribe las credenciales en el archivo de contraseñas de Mosquitto (`mosquitto_passwd -b`) y añade a la ACL:
   ```
   user esp32-7f3a9c2b
   topic write telemetry/{userId}/+
   ```
   Después recarga el broker (`SIGHUP` al proceso de Mosquitto, o `docker kill -s HUP mosquitto`). Encapsula esto en un módulo `apps/api/src/mqtt/broker-credentials.ts` para que el resto del código no sepa cómo se hace.
4. La UI muestra el token **una sola vez**, con aviso de que no se volverá a mostrar, botón de copiar, y un bloque de código C listo para pegar en el firmware con `deviceId`, token, topic y URL del broker ya rellenados.
5. `last_seen_at` se actualiza cada vez que llega una muestra de ese dispositivo.
6. **Revocar** marca `is_revoked`, elimina la entrada del archivo de contraseñas, recarga el broker y cierra cualquier sesión activa del dispositivo.

El backend, al recibir una muestra, verifica que el `userId` del topic corresponda al dueño del dispositivo. La ACL ya lo impide a nivel de broker, pero es una defensa en profundidad barata.

---

## 6. Lógica de sesiones

El dispositivo no gestiona sesiones: solo publica muestras. El backend infiere los tramos. Al recibir una muestra de `userId` con `seriesKey`:

1. Busca la sesión activa de ese usuario (`status='active'`).
2. **No hay activa** → crea una nueva con ese `series_key`, `started_at = now()`.
3. **Hay activa, misma serie, `iteration > last_iteration`** → inserta la muestra y actualiza el resumen.
4. **Hay activa pero de otra serie** → cierra la actual (`status='finished'`, `ended_at` = timestamp de su última muestra) y abre una nueva. Este es el caso "a las 9:40 Álvaro pasó de una serie a otra".
5. **Hay activa, misma serie, `iteration <= last_iteration`** → el cliente reinició la serie: cierra la sesión y abre una nueva.

Un **barredor de inactividad** corre cada 30 s y cierra toda sesión activa cuya última muestra tenga más de `RUN_IDLE_TIMEOUT_MS` (por defecto 120 000 ms), poniendo `ended_at` en el `created_at` de su última muestra — **no** en `now()` — para que la duración registrada refleje el envío real y no el momento de la detección.

Los pasos 1–5 van dentro de una **transacción**, para que dos mensajes casi simultáneos no creen dos sesiones. Si el índice único parcial provoca un conflicto, reintenta una vez.

Cada apertura y cierre de sesión se emite por WebSocket.

---

## 7. Backend (`apps/api`)

### Puente MQTT
- Se suscribe a `telemetry/+/+`. Topic: `telemetry/{userId}/{seriesKey}`.
- Payload: `{ "iteration": 42, "value": 3.1571052761, "deviceId": "esp32-7f3a9c2b", "ts": 1757600000 }`. El campo `deviceId` es opcional (el simulador web no lo envía).
- Valida con `zod` que `seriesKey` exista y que `iteration` y `value` sean numéricos finitos. Si no, loguea y descarta; nunca debe tumbar el proceso.
- Calcula `error_abs = Math.abs(value - realValue)`, aplica la lógica de sesiones, persiste y reemite por WebSocket.
- Reconexión automática al broker con backoff exponencial.

### WebSocket
`/ws`, autenticado por token en el query string. El servidor solo reenvía a cada conexión los eventos que le corresponden por rol.

```
{ type: 'sample',    payload: { runId, seriesKey, iteration, value, errorAbs, createdAt } }
{ type: 'run_start', payload: { runId, seriesKey, startedAt, source, deviceName } }
{ type: 'run_end',   payload: { runId, endedAt, sampleCount, lastValue, lastErrorAbs } }
```

**Importante:** a una conexión de rol `client` el servidor **nunca** envía `value`, `errorAbs` ni `iteration` (ver §9). Filtra en el servidor, no en el cliente.

### API REST

```
POST   /api/auth/signup             -> { token, user }
POST   /api/auth/login              -> { token, user }
GET    /api/me

-- Administración de usuarios (solo admin)
GET    /api/admin/users             -- listado con nº de sesiones, muestras, dispositivos,
                                       última actividad y sesión activa
POST   /api/admin/users             -- alta { name, email, password, role }
PATCH  /api/admin/users/:id         -- editar nombre, correo, rol, is_active
POST   /api/admin/users/:id/password -- restablecer contraseña
DELETE /api/admin/users/:id         -- eliminar usuario y todo su historial
DELETE /api/admin/users/:id/data    -- borrar solo runs y samples

-- Datos (solo admin)
GET    /api/admin/users/:id/runs         -- ?from&to&seriesKey
GET    /api/admin/runs/:runId/samples    -- ?limit&offset
GET    /api/admin/users/:id/series/:key  -- muestras de una serie a través de todas sus sesiones

-- Dispositivos
GET    /api/devices                 -- los del usuario autenticado
POST   /api/devices                 -- vincular { name } -> devuelve el token UNA vez
DELETE /api/devices/:id             -- revocar

-- Cliente
GET    /api/client/runs             -- historial propio SIN valores ni errores
GET    /api/client/status           -- { hasDevice, deviceOnline, activeRun }
POST   /api/simulate/start          -- solo si el cliente NO tiene dispositivo vinculado
POST   /api/simulate/stop
```

Middleware `requireAuth` y `requireAdmin`. Toda entrada validada con `zod`.

---

## 8. Diseño visual

El producto es un instrumento de medición, no una app de productividad. La referencia estética es el **papel milimetrado de un cuaderno de laboratorio**: retícula fina, tinta azul, anotaciones precisas, cifras alineadas. Minimalista y moderno, pero con carácter propio — nada de tarjetas redondeadas idénticas con sombra gris difusa, ni fondos crema con acento terracota, ni degradados decorativos.

### Paleta

```
--paper       #EDF0F3   fondo de la aplicación, gris azulado de papel técnico
--surface     #FFFFFF   tarjetas, tablas, barra lateral
--grid        #D7DEE4   retícula y bordes hairline de 1px
--ink         #16324F   texto principal y trazo de los gráficos, azul de tinta
--ink-soft    #5E7186   texto secundario, etiquetas de ejes
--signal      #1B9E77   verde teal: sesión activa, dispositivo en línea, dígitos correctos
--deviation   #B3202C   rojo: error, divergencia, acciones destructivas
```

El teal es el único color saturado que aparece en reposo, y está reservado para una sola idea: **algo está vivo ahora**. Punto de conexión, sesión en curso, dígitos ya convergidos. Si aparece en cualquier otro sitio, pierde su significado.

### Tipografía

Una sola superfamilia, **IBM Plex**, en dos cortes con roles distintos:

- **IBM Plex Sans** para toda la interfaz: navegación, títulos, prosa, botones.
- **IBM Plex Mono** para **todo número**: valores, errores, iteraciones, horas, duraciones, IDs de dispositivo. No es decorativo: la alineación de dígitos es funcional en una tabla donde el usuario compara decimales columna contra columna.

Escala: 32/24/18/15/13 px, interlineado 1.5 en prosa y 1.4 en tablas. Títulos en peso 500, nunca 700. Sin versalitas ni mayúsculas forzadas en las etiquetas.

### Layout

Barra lateral fija de 240 px a la izquierda, contenido a la derecha con un ancho máximo de 1400 px. Todo alineado a la izquierda. Separación mediante líneas hairline de 1 px en `--grid` y espacio en blanco, no mediante sombras. Radio de esquina de 4 px como máximo, y solo en controles interactivos; las tablas y los paneles de datos van con esquinas rectas.

```
┌────────────┬──────────────────────────────────────────────┐
│ Primera    │  Álvaro Quispe                    ● enviando │
│ Evaluación │  ──────────────────────────────────────────  │
│ IoT        │  [ Historial ] [ Series ] [ Muestras ]       │
│            │  ┌───────────┬───────────┬───────────┐       │
│ ▸ Panel    │  │  Leibniz  │  Wallis   │  Basilea  │       │
│ ▸ Usuarios │  │  ╱‾╲╱‾╲__ │  ╱‾‾‾‾‾‾  │  ╱‾‾‾‾‾‾  │       │
│ ▸ Sesiones │  │  3.1465…  │  3.1290…  │  1.6395…  │       │
│            │  └───────────┴───────────┴───────────┘       │
│            │  Iter  Aproximado      Real          Error   │
│ ──────     │  0142  3.1465677472   3.1415926536  0.00497  │
│ Álvaro Q.  │  0141  3.1365926536   3.1415926536  0.00500  │
│ Salir      │                                              │
└────────────┴──────────────────────────────────────────────┘
```

El **área de los gráficos lleva una retícula de fondo de 8 px** en `--grid` al 40 % de opacidad, como papel milimetrado. Es el único ornamento de la interfaz y es el que le da identidad; no lo repitas en tarjetas, cabeceras ni barra lateral.

La línea de referencia del valor real es punteada en `--ink-soft`; el trazo de la aproximación es sólido en `--ink`, de 1.5 px, sin relleno bajo la curva y sin suavizado de spline (los datos son discretos y la curva debe mostrarse como es).

### Movimiento

Un solo momento animado en todo el producto: **la entrada de un punto nuevo en el gráfico en vivo**, con una transición de 150 ms del último segmento y un destello breve de la fila recién llegada en la tabla. Nada más. Sin animaciones de entrada por sección, sin transiciones en hover sobre cada tarjeta. Respeta `prefers-reduced-motion` desactivando el destello.

### Autenticación

Login y registro en una pantalla partida: a la izquierda, sobre fondo `--ink`, el nombre del producto y una animación en bucle, discreta, de la curva de Leibniz oscilando hacia su asíntota, dibujada en `--signal` sobre la retícula. A la derecha, sobre `--surface`, el formulario alineado a la izquierda con un máximo de 360 px. Es el único lugar donde el producto se permite ser expresivo.

### Redacción de la interfaz

Voz activa, frases en minúscula de oración, sin relleno. "Vincular ESP32", no "Gestión de dispositivos IoT". "Aún no has vinculado ningún dispositivo. Vincula uno para empezar a recibir datos.", no "No data available". Los errores dicen qué pasó y qué hacer; no se disculpan. El nombre de una acción es el mismo en el botón, el diálogo y la confirmación: si el botón dice "Revocar", el aviso dice "Dispositivo revocado".

---

## 9. Frontend — barra lateral y roles

La navegación es una **barra lateral fija** con el nombre del producto arriba, los enlaces en medio, y el usuario con el botón de salir abajo. Los enlaces dependen del rol.

### Menú del administrador
- **Panel general** — resumen: nº de clientes, dispositivos vinculados, sesiones hoy, cuántos clientes están enviando ahora mismo.
- **Usuarios** — gestión completa.
- **Sesiones** — todas las sesiones de todos los clientes, filtrables.
- **Mi cuenta**

### Menú del cliente
- **Mi dispositivo**
- **Mis envíos**
- **Mi cuenta**

### Vista ADMIN — Usuarios (gestión)

Tabla con: nombre, correo, rol, estado, nº de dispositivos, nº de sesiones, última actividad, e indicador de sesión activa (punto `--signal` con el nombre de la serie en curso). Acciones:

- **Nuevo usuario** (modal): nombre, correo, contraseña, rol.
- **Editar**: nombre, correo, rol.
- **Activar / desactivar**: un usuario desactivado no puede iniciar sesión ni publicar; su historial se conserva.
- **Restablecer contraseña**: genera una temporal y la muestra una vez.
- **Borrar datos**: elimina sesiones y muestras, conserva la cuenta. Pide confirmación escribiendo el nombre del usuario.
- **Eliminar usuario**: borra todo en cascada. Misma confirmación.
- **Dispositivos del usuario**: lista, con opción de revocar desde el panel de administración.

Un administrador no puede desactivarse ni eliminarse a sí mismo, y no se puede eliminar el último administrador que quede.

### Vista ADMIN — Detalle del cliente

Tres bloques, en este orden:

**a) Historial de sesiones.** Dos representaciones del mismo dato, con un conmutador:

- *Tabla:* `Serie | Origen | Inicio | Fin | Duración | Iteraciones | Valor final | Error final | Estado`. Agrupada por día con encabezado de fecha. Las activas arriba, con el reloj corriendo. La columna Origen distingue el simulador web del dispositivo, mostrando el alias del ESP32.
- *Línea de tiempo:* un carril horizontal por día, eje de 00:00 a 24:00, con bloques de color por serie situados según su inicio y fin. Para el caso de Álvaro se ven tres bloques: uno largo de 8:00 a 9:40, uno corto de 9:40 a 10:00, y otro de 14:00 a 14:30. Tooltip al pasar el cursor; al hacer clic se selecciona la sesión y los bloques (b) y (c) se filtran a ella.

Filtros por rango de fechas y por serie.

**b) Grid de 7 gráficos.** Una tarjeta por serie:
- Eje X: iteración. Eje Y: valor. Retícula de papel milimetrado de fondo.
- Trazo de los valores enviados, con puntos pequeños.
- `ReferenceLine` horizontal punteada en el valor real.
- Cabecera: símbolo, fórmula, último valor a 10 decimales, valor real y error actual.
- Crece **en vivo** conforme llegan muestras.
- Conmutador por tarjeta: "valor" ↔ "error absoluto en escala logarítmica".
- Con una sesión seleccionada en (a), muestra solo esa; sin selección, muestra el acumulado de todas con variación de tono por sesión.
- Series sin datos: en gris, con la leyenda "sin envíos".

**c) Tabla de muestras.** `Sesión | Iteración | Valor aproximado | Valor real | Error absoluto | Error relativo (%) | Hora`. Orden descendente por iteración, destello en las filas nuevas, paginación o scroll virtual, filtrable por serie y sesión. Cifras siempre con los helpers de `shared` y con el resaltado de dígitos correctos.

### Vista CLIENTE

El cliente tiene acceso **restringido a los datos numéricos**. Puede ver cuándo envió y si está enviando ahora, pero **no** los valores, ni los errores, ni los gráficos. Esta restricción se aplica **en el servidor**: los endpoints de cliente y los eventos WebSocket dirigidos a un rol `client` no incluyen `value`, `error_abs` ni `iteration`. Ocultarlo solo en la interfaz no cuenta.

**Mi dispositivo**
- Sin dispositivo vinculado: estado vacío con el botón **Vincular ESP32** y una explicación breve de qué pasará.
- Con dispositivo: alias, identificador, fecha de vinculación, última vez visto, e indicador de estado — *en línea* (`--signal`) si hay sesión activa, *inactivo* si no. Botón de revocar con confirmación.
- Al vincular: el token aparece una sola vez, con botón de copiar y el fragmento de configuración para el firmware.

**Mis envíos**
- Tabla: `Serie | Inicio | Fin | Duración | Estado`. Sin columnas de valor, error ni número de iteraciones.
- Arriba, cuando hay una sesión activa, una tarjeta destacada: nombre de la serie, hora de inicio y **tiempo transcurrido corriendo en vivo**, con el punto teal. Es la única señal en vivo que recibe el cliente, y llega por WebSocket igual que las del admin, pero sin datos numéricos.
- La misma línea de tiempo por día que ve el admin, también sin valores.

**Simulador**: solo aparece en el menú si el cliente **no** tiene un dispositivo vinculado. En cuanto vincula uno, la opción desaparece y `POST /api/simulate/start` responde 409 con el mensaje de que el envío lo controla ahora el ESP32. Un cliente con dispositivo únicamente consulta su historial.

---

## 10. Tiempo real — requisito no negociable

El panel del administrador se actualiza en vivo, sin recargar y sin polling, mientras un cliente está enviando:

- Un hook `useLiveSamples(userId)` abre el WebSocket, mantiene el buffer en memoria y expone los datos deduplicados por `sample.id`.
- Al abrir la vista: primero carga el histórico por REST, después se suscribe al WebSocket. La unión no debe producir duplicados ni huecos; si llega un evento durante la carga, se encola y se aplica al terminar.
- Cada `sample` añade un punto al gráfico y una fila a la tabla, y actualiza la cabecera de la tarjeta.
- Cada `run_start` / `run_end` actualiza el historial y el indicador de "enviando ahora".
- **Agrupamiento:** acumula los eventos entrantes y aplica el estado de React como máximo cada 100 ms. Actualizar el estado por cada mensaje congela la interfaz con intervalos de envío cortos.
- **Ventana deslizante:** máximo 2000 puntos por serie en el gráfico, submuestreando los antiguos y conservando la forma de la curva; máximo 200 filas en el DOM de la tabla.
- Indicador del estado del WebSocket (conectado / reconectando / sin conexión) en la cabecera, y recarga automática del histórico al reconectar, para no dejar huecos.

---

## 11. Calidad

- `.env.example` documentado: `DATABASE_URL`, `MQTT_URL`, `MQTT_ADMIN_USER`, `MQTT_ADMIN_PASS`, `MOSQUITTO_PASSWD_PATH`, `MOSQUITTO_ACL_PATH`, `MOSQUITTO_CONTAINER`, `JWT_SECRET`, `PORT`, `RUN_IDLE_TIMEOUT_MS`, `VITE_API_URL`, `VITE_WS_URL`.
- README en la raíz: `docker compose up -d`, `pnpm install`, `pnpm db:reset`, `pnpm dev`, credenciales de prueba, y un ejemplo de `mosquitto_pub` con credenciales de dispositivo para simular un ESP32 a mano.
- Timestamps en UTC en base de datos; conversión a hora local solo en presentación.
- Reconexión automática del cliente MQTT y del WebSocket.
- Errores visibles en la interfaz, no solo en `console.error`.
- Accesible: foco de teclado visible, contraste suficiente, tablas con encabezados asociados, `prefers-reduced-motion` respetado. Responsive: por debajo de 900 px la barra lateral colapsa a un cajón y el grid de gráficos pasa a una columna.
- Comenta el puente MQTT → lógica de sesiones → Postgres → WebSocket, y el módulo de credenciales del broker. Son las partes no obvias.
- Prioriza que **corra a la primera** sobre la elegancia arquitectónica. Sin abstracciones especulativas.

Entrega el árbol de archivos completo con el contenido de cada uno.