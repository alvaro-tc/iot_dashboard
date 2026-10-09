# Prompt — Presentación «Aspiradora automática Roomba»

> Pega este documento completo como instrucción. Está escrito para ejecutarse **dentro de este
> repositorio** (`iot_dashboard`), porque todo el contenido técnico debe salir del código real,
> no inventado.

---

## 0. Encargo

Crea una **presentación HTML estática, autocontenida y visualmente excelente** titulada
**«Aspiradora automática Roomba»**, que defienda un proyecto IoT académico punto por punto
frente a una rúbrica de 6 preguntas (75 puntos).

- Usa la skill **`html-ppt`** para el andamiaje (navegación por teclado, 16:9, modo
  presentador). Si no está disponible, escribe una página HTML propia con las mismas
  capacidades: `←/→/Space` para navegar, `F` pantalla completa, `O` vista de rejilla,
  contador de diapositivas y barra de progreso.
- Idioma: **español**. Tono: técnico, concreto, sin relleno comercial.
- Un solo archivo `presentacion.html` en la raíz del repo + imágenes en `_ppt_assets/`
  (la carpeta ya existe y está vacía). CSS y JS **inline**; nada de CDNs opcionales salvo
  la fuente y, si hace falta, `mermaid` y `highlight.js` desde cdnjs con versión exacta.
- Debe verse bien proyectada (texto mínimo 18 px efectivos) y también leída en un portátil.

**Regla dura: cero datos inventados.** Cada nombre de tabla, columna, endpoint, pin, tópico
MQTT o número que aparezca en una diapositiva tiene que existir en el repositorio. Si algo no
existe, se dice «pendiente» en vez de rellenarlo.

---

## 1. Lee esto antes de escribir una sola diapositiva

Fuentes de verdad, en orden de importancia:

| Qué | Dónde |
|---|---|
| Visión general, arquitectura, justificación de MQTT, odometría y «pendiente de definir» | `README.md` |
| Especificación original completa del proyecto (pines, módulos, protocolo, tarjetas del dashboard) | `prompt.md` (raíz) |
| **Esquema de base de datos real**: tablas, checks, índices, trigger, vistas y función | `apps/api/db/schema.sql` |
| Datos de demo y cómo se generan | `apps/api/db/seed.sql`, `docs/cuentas-de-prueba.md` |
| API REST: rutas, validación, autenticación | `apps/api/src/routes/*.ts`, `apps/api/src/auth.ts` |
| Ingesta y persistencia por lotes | `apps/api/src/routes/ingesta.ts`, `apps/api/src/persistencia.ts`, `apps/api/src/telemetria.ts` |
| Puente MQTT y WebSocket | `apps/api/src/mqtt/bridge.ts`, `apps/api/src/ws.ts`, `packages/shared/src/topics.ts` |
| Firmware MicroPython | `firmware/*.py` (sobre todo `main.py`, `sensores.py`, `movimiento.py`, `odometria.py`, `mqtt_cliente.py`, `config.example.py`) |
| Dashboard React | `apps/web/src/pages/*`, `apps/web/src/components/*`, `apps/web/src/lib/socket.tsx`, `lib/chart.ts` |
| Geometría compartida y su autocomprobante | `packages/shared/src/robot.ts`, `robot.check.ts` |

`docs/` está casi vacío (solo `cuentas-de-prueba.md` y `diseno/` sin contenido): **no te
apoyes en los documentos que el README enlaza pero que todavía no existen** (`docs/circuito.md`,
`docs/diagrama_er.md`, `docs/api.md`, `docs/mqtt.md`). Saca la información del código.

### Discrepancia que debes resolver, no esconder

La rúbrica pide **Supabase** (PostgreSQL gestionado, su API REST y Supabase Auth). La
implementación usa **PostgreSQL propio en un VPS, una API REST Express propia y autenticación
con bcrypt + JWT**. Esto se defiende en la **diapositiva de decisiones de infraestructura**
descrita abajo (§4, Pregunta 2), que es obligatoria. Si al leer el código encuentras que sí
hay Supabase en alguna parte, ajusta esa diapositiva a lo que diga el código.

---

## 2. Diseño visual (esto importa tanto como el contenido)

Estilo: **minimalista y moderno, paleta clara únicamente**. Toma el naranja del propio
dashboard para que la presentación y el producto se vean como la misma cosa, pero la
presentación es **clara de principio a fin: no implementes tema oscuro, ni toggle, ni
`prefers-color-scheme`**. Una sola hoja de estilos, un solo tema.

**Paleta (la única)**

```
--acento:        #EA580C   /* naranja; el claro #F97316 solo para rellenos grandes, nunca texto */
--acento-suave:  #FFF1E7   /* fondo de chips y realces */
--fondo:         #FDFCFB   /* casi blanco, con un punto cálido */
--tarjeta:       #FFFFFF
--borde:         #E7E2DD   /* 1 px; es lo que separa, no la sombra */
--tinta:         #16202E   /* texto principal */
--tinta-media:   #475569   /* texto secundario — el tono más claro permitido para texto */
--verde:         #047857   /* libre / en línea */
--ambar:         #B45309   /* precaución */
--rojo:          #DC2626   /* evasión / atascado */
```

**Legibilidad: es el requisito número uno de esta presentación.** Reglas no negociables:
- Todo texto sobre su fondo cumple **contraste ≥ 4.5:1** (≥ 3:1 solo para texto de 32 px o
  más). Compruébalo de verdad, no a ojo; si una combinación no llega, oscurece el texto, no
  aclares la letra.
- **Nada de texto gris claro.** `--tinta-media` es el límite; no uses `#94A3B8` ni similares
  para nada que haya que leer.
- **Nada de texto encima de una imagen o una captura.** Las etiquetas de las capturas van
  fuera, en el margen, unidas con una línea o un número.
- Los colores verde/ámbar/rojo son los **oscuros** de la lista cuando se usan como texto o
  icono; sus versiones claras solo como relleno de fondo con texto `--tinta` encima.
- El naranja sólido lleva **texto blanco** (`#FFFFFF`); el naranja como texto va siempre sobre
  blanco o `--acento-suave`.
- Sin degradados detrás de texto, sin transparencias apiladas, sin sombras de texto.

**Tipografía**: *Inter* desde Google Fonts para todo (400 / 500 / 600 / 700), y
`JetBrains Mono` para código. Jerarquía por **peso y tamaño, no por color**.
Escala: portada ~68 px/700, título de diapositiva ~40 px/600, subtítulo ~24 px/500,
cuerpo ~22 px/400 con `line-height: 1.55`, tabla ~19 px, código ~16 px, pie ~14 px.
Ancho de línea máximo **70 caracteres** (`max-width: 62ch`). Nada de mayúsculas forzadas
salvo en etiquetas de una palabra, y ahí con `letter-spacing: .06em`.

**Lenguaje visual minimalista**: tarjetas blancas de `border-radius: 16px` definidas por
**borde de 1 px**, no por sombra (sombra solo en la portada y los divisores, y muy tenue).
Rejilla de 12 columnas, márgenes generosos (≥ 72 px a los lados), **mucho espacio en blanco**:
si una diapositiva se siente apretada, parte el contenido en dos. Como máximo **un acento de
color por diapositiva** — el resto en tinta y blanco. Reglas finas de 1 px en vez de cajas
anidadas. Nada de iconos decorativos que no aporten información.

**Densidad**: máximo ~6 viñetas por diapositiva, cada una de una línea o dos. El texto largo
va al guion del presentador (`<aside class="notas">`, oculto en pantalla), no a la diapositiva.

**Cromo de cada diapositiva**:
- Barra superior fina con el logo (robot circular en SVG) + título de la sección.
- **Chip de rúbrica** arriba a la derecha: `Pregunta 3 · 15 pts` en naranja sólido.
- Barra de progreso naranja de 3 px al pie y numeración `07 / 38`.
- Transición sutil (150–200 ms, `opacity` + `translateY(8px)`); respeta
  `prefers-reduced-motion`.

**Plantillas de diapositiva que debes definir y reutilizar** (clases CSS, no copiar y pegar
estilos): `portada`, `divisor-seccion` (fondo naranja a sangre, número de pregunta enorme),
`titulo-contenido`, `dos-columnas` (texto | imagen), `codigo-anotado` (código a la izquierda,
3–4 anotaciones numeradas a la derecha que señalan líneas concretas), `tabla-db` (ver §4),
`diagrama-completo`, `metricas` (3–4 cifras grandes), `cierre`.

**Código**: siempre con resaltado de sintaxis, nombre del archivo y rango de líneas reales en
la cabecera del bloque (`apps/api/src/persistencia.ts:41-68`), **máximo ~18 líneas por bloque**
y recortado a lo esencial con `…` donde se omite. Prohibido pegar un archivo entero. El código
debe ser **copiado literalmente del repositorio**, no reescrito.

---

## 3. Imágenes y diagramas (obligatorio: nada de diapositivas que sean solo texto)

Cada punto de la rúbrica necesita al menos una pieza visual. Genera los activos en
`_ppt_assets/` y referencia rutas relativas; si el PNG no se puede generar, usa SVG inline
(que además escala mejor y permite controlar el contraste de cada trazo).

1. **Capturas reales del dashboard — lo más valioso que puedes aportar.**
   Arranca el proyecto (`pnpm install`, `pnpm db:reset`, `pnpm dev`, y en otra terminal
   `pnpm simular`), entra con `alvaro@demo.com / cliente123`, pulsa el botón de encendido y
   captura con las herramientas de Chrome a 1920×1080:
   `login`, `panel` completo, `mapa` en vivo con trayectoria y haces, `radar`, `sesiones` con
   la repetición, `historial` (heatmap y barras), `eventos`, `robots`, y **una sola** del tema oscuro del
   dashboard (como contenido, para enseñar que el producto lo soporta; la diapositiva que la
   contiene sigue siendo clara).
   Guarda cada una como `_ppt_assets/cap-<nombre>.png`.
   Si el entorno no permite arrancar la app, dilo explícitamente en tu resumen final y deja
   marcos `placeholder` rotulados con el nombre del archivo que falta — **no simules una
   captura con HTML**.
2. **Diagrama de arquitectura** (ESP32 → Mosquitto → API → Socket.IO/Postgres → React):
   SVG inline dibujado a mano, con la ruta en vivo en naranja y la de persistencia en gris, y
   las etiquetas de latencia. No reutilices el ASCII del README: conviértelo en un diagrama.
3. **Diagrama ER**: generado desde `schema.sql`, con Mermaid `erDiagram` o SVG propio.
   Cardinalidades correctas, claves marcadas, y las 3 vistas + la función en un bloque aparte.
4. **Diagrama del nodo IoT**: ver §4 Pregunta 1 — queda **en blanco**.
5. **Esquemas conceptuales en SVG**: cinemática diferencial (v, ω, θ), proyección de un
   obstáculo desde la pose (`x_obs = x + (radio + d)·cos(θ + ángulo)`), máquina de estados de
   evasión, y el pipeline «emitir por WebSocket antes de escribir en Postgres».
6. **Mini-ilustraciones SVG** de iconografía propia (sensor ultrasónico, rueda, batería, LED)
   para encabezar secciones. Sin librerías de iconos externas.

---

## 4. Guion diapositiva por diapositiva

Orden y contenido mínimos. Puedes añadir diapositivas, nunca quitar las marcadas
**obligatoria**. Objetivo: **35–45 diapositivas**.

### Apertura (3)

1. **Portada** — «Aspiradora automática Roomba», subtítulo «Nodo IoT con ESP32 + dashboard en
   tiempo real», autor (saca el nombre de `git config user.name`), fecha, y una ilustración
   SVG del robot visto desde arriba con sus tres haces de sensores.
2. **Índice** — las 6 preguntas con su puntaje (10 / 5 / 15 / 15 / 15 / 15 = 75) como tarjetas
   numeradas clicables.
3. **Arquitectura general** — el diagrama del punto 3.2, con el camino en vivo resaltado y el
   objetivo «< 300 ms medición → pixel».

### Pregunta 1 · Diseño del circuito del nodo IoT — 10 pts (5–7 diapositivas)

> **Dejar el diseño del circuito EN BLANCO.** El usuario enviará después el diagrama de
> **Wokwi**. Prepara dos diapositivas con un marco vacío rotulado
> «Esquema Wokwi — pendiente de insertar», con la proporción correcta (16:9 y 4:3) y un
> comentario HTML bien visible:
> `<!-- TODO: sustituir por _ppt_assets/wokwi.png cuando llegue el diagrama -->`
> No dibujes un circuito provisional ni lo describas gráficamente.

Las demás diapositivas de esta sección sí se completan con lo que hay en el código:

- **Componentes del nodo**: 3× HC-SR04 (izq −45°, centro 0°, der +45°), batería por ADC con
  divisor resistivo, LED de estado, 2 motorreductores con driver TB6612FNG (variante L298N) y
  rueda loca. Una tarjeta por componente con su icono SVG.
- **Tabla de pines** copiada de `firmware/config.example.py` (verifícala contra el archivo,
  no contra `prompt.md`), con las restricciones del ESP32 anotadas: ADC2 inutilizable con WiFi,
  GPIO 34/35/36/39 solo entrada, pines de arranque a evitar.
- **Acondicionamiento de señal**: por qué el ECHO de 5 V necesita divisor 1 kΩ/2 kΩ hacia
  3.3 V (con el cálculo), el divisor de la batería y la calibración del ADC.
- **Tabla de patrones del LED** (fijo / 1 Hz / 4 Hz / doble / muy rápido) con su significado,
  desde `firmware/led.py`.
- Nota de alimentación: motores separados de la lógica, tierras comunes, PWM a 1 kHz.

### Pregunta 2 · Base de datos y diagrama — 5 pts (9–11 diapositivas · **la sección más detallada**)

Aunque vale solo 5 puntos, el usuario quiere aquí el máximo detalle.

1. **Diagrama ER completo** a página entera.
2. **Una diapositiva por tabla — obligatoria**, en este orden y con esta plantilla fija:

   - `users`
   - `dispositivos`
   - `configuracion_dispositivo`
   - `sesiones`
   - `lecturas`
   - `eventos`

   Plantilla `tabla-db` para cada una:
   - Título: el nombre de la tabla en monoespaciada + una línea de propósito en lenguaje llano
     («un ciclo de funcionamiento: desde que el robot pasa a `automatico` hasta que se detiene»).
   - **Tabla de columnas**: nombre · tipo · restricción · para qué sirve. Marca PK con un chip
     naranja y FK con un chip azul; las columnas anulables, en cursiva con su significado
     (`dist_izq_cm` null = sin objeto dentro del rango).
   - **Caja «Reglas que impone la base»**: los `CHECK`, índices y únicos **reales** y por qué
     existen. No los omitas, son lo mejor que tiene este esquema. Ejemplos a destacar:
     `precaucion_mayor_que_evasion`, `uniq_sesion_activa_por_dispositivo` (índice único
     parcial: un robot no puede tener dos sesiones abiertas),
     `uniq_lectura_secuencia (sesion_id, secuencia)` (el reenvío de un lote diferido no
     duplica), los rangos de `vel_izq_pct`/`vel_der_pct` (−100..100) y las listas cerradas de
     `modo`, `estado_movimiento`, `tipo` y `sensor`.
   - **Un fragmento del `CREATE TABLE` real** (recortado) y, debajo, **una fila de ejemplo**
     tomada del seed o del contrato de telemetría.
   - Mini-diagrama de relaciones en la esquina: esta tabla resaltada dentro del ER.
3. **Trigger `trg_configuracion_por_defecto`**: ningún camino del código puede dejar un robot
   sin configuración. Código + por qué va en la base y no en la aplicación.
4. **Las tres vistas**: `v_lecturas_por_minuto`, `v_lecturas_por_hora`, `v_resumen_sesion`.
   Qué gráfica del dashboard alimenta cada una. Destaca dos cálculos: la latencia
   (`recibido_en − medido_en`) y el **porcentaje de lecturas perdidas deducido de los huecos
   en `secuencia`**, con el ejemplo numérico del comentario del SQL (180 recibidas, secuencia
   máxima 200 → 10 % perdido).
5. **`obtener_mapa_sesion(p_sesion_id, p_max_puntos)`**: la fórmula de proyección de
   obstáculos con su esquema SVG, y la razón del muestreo uniforme (`(rn-1) % paso = 0`)
   frente a un `LIMIT`, que recortaría el final del recorrido. Menciona que la misma fórmula
   vive en `packages/shared/src/robot.ts` y que `robot.check.ts` comprueba que SQL y cliente
   coincidan.
6. **«Decisiones de infraestructura: por qué PostgreSQL en un VPS y por qué MQTT»** —
   **diapositiva obligatoria y de argumento**, la más importante de la sección. Una sola
   diapositiva (o dos, si no cabe sin apretar el texto) con dos mitades y un hilo común: **la
   latencia**.

   **Mitad A · PostgreSQL propio en un VPS, no una base gestionada en la nube**
   - El motor es el mismo PostgreSQL y el contrato REST es equivalente al de PostgREST
     (HTTPS + `Authorization: Bearer <JWT>`), así que no se pierde nada del requisito: lo que
     cambia es **dónde vive**.
   - **La base está en el mismo host que Mosquitto y que la API.** La escritura de cada lote
     es un viaje a `localhost`, no una ida y vuelta a un centro de datos remoto: se quita de
     la ruta crítica la latencia de internet, el TLS contra un tercero y su límite de
     conexiones.
   - Permite el **puente MQTT local en `127.0.0.1:1883`** y el control total del broker
     (Dynamic Security, ACL por robot, Last Will), que es justo lo que una base gestionada no
     ofrece.
   - Hace posible la **persistencia por lotes** (`persistencia.ts`): agrupar 200 filas o 1 s
     de telemetría en un solo `INSERT` sería caro y frágil contra un endpoint remoto.
   - Y lo decisivo: **el camino en vivo no espera a la base**. La lectura sale por WebSocket
     *antes* de tocar Postgres. Objetivo medido: **< 300 ms** desde la medición en el ESP32
     hasta que el robot se mueve en el mapa del navegador.
   - Dilo también al revés, con honestidad: se renuncia a RLS gestionado, a backups
     automáticos y a un Auth con correos ya montado; esas piezas hay que operarlas.

   **Mitad B · MQTT para el nodo, no una API REST a secas**
   Los cuatro motivos del README, en orden de peso, cada uno con su contraste frente a REST:
   1. **Latencia.** La conexión MQTT es persistente: no se abre TCP + TLS en cada envío. A
      5 Hz, el coste de establecer una conexión HTTP por lectura superaría al del propio dato.
   2. **Comandos instantáneos.** Con REST el robot tendría que *sondear* cada pocos segundos
      si hay órdenes; suscrito a MQTT, un «detener» llega en milisegundos y sin tráfico
      cuando no pasa nada.
   3. **Detección de desconexión gratis.** El **Last Will** hace que Mosquitto publique
      `{"en_linea": false}` por el robot cuando desaparece; con REST habría que esperar a que
      venza un timeout para *deducir* lo mismo.
   4. **Configuración retenida.** El robot recibe su configuración al suscribirse, sin
      pedirla; el dashboard que se abre ve el estado actual sin esperar.
   - Añade el argumento de contexto: **MQTT es el protocolo estándar de facto en IoT**
     precisamente por esto — mensajes mínimos, publicación/suscripción, QoS, y un consumo de
     batería y de ancho de banda muy por debajo de HTTP en dispositivos restringidos como un
     ESP32.
   - Cierra con que **el requisito REST igualmente se cumple**: `MODO_ENVIO = "rest"` en el
     firmware envía lotes a `POST /api/ingesta`, y toda la lectura del dashboard es REST.

   Visual de la diapositiva: el diagrama de arquitectura reducido, con la ruta en vivo
   (ESP32 → Mosquitto → API → WebSocket) en naranja y la de persistencia a `localhost` en
   gris, y una tabla pequeña **MQTT vs. REST** de 4 filas (latencia · comandos · caída ·
   configuración). Si usas dos diapositivas, repite el chip `Pregunta 2` en las dos.

### Pregunta 3 · Integración vía API REST — 15 pts (6–7 diapositivas)

- **Mapa de la API**: tabla de endpoints reales agrupados por módulo
  (`/api/auth/*`, `/api/me`, `/api/dispositivos`, `/api/dispositivos/:id/lecturas`,
  `/lecturas/export.csv`, `/sesiones`, `/sesiones/:id/mapa`, `/eventos`,
  `/dispositivos/:id/configuracion`, `/dispositivos/:id/resumen`, `/api/ingesta`,
  `/api/admin/*`, `/salud`). Verifica la lista contra `apps/api/src/routes/`.
- **Inserción**: `POST /api/ingesta` paso a paso — validación, autenticación del dispositivo
  por token, deduplicación por `secuencia`. Código anotado + ejemplo `curl` con cuerpo JSON
  real y la respuesta.
- **Inserción por lotes**: `persistencia.ts` — buffer, descarga cada 1 s o a las 200 filas,
  reintentos con espera exponencial, respaldo en NDJSON y vaciado al apagar. Explica por qué
  **se emite por WebSocket antes de escribir en la base** (esquema SVG del pipeline).
- **Lectura**: `GET /api/dispositivos/:id/lecturas?desde&hasta&agregacion=raw|minuto|hora` y
  `GET /api/sesiones/:id/mapa`. `curl` con la respuesta JSON recortada, y qué vista de la
  base responde a cada `agregacion`.
- **Lectura desde el dashboard**: `apps/web/src/lib/api.ts` — JWT Bearer, manejo de errores,
  TanStack Query si se usa.
- **Diapositiva de métricas**: lecturas/s, tamaño del lote, latencia media medida y
  `GET /salud` como prueba de vida.

### Pregunta 4 · Script MicroPython — 15 pts (6–7 diapositivas)

- **Mapa de módulos del firmware** (diagrama SVG de dependencias): `config` · `red` ·
  `sensores` · `motores` · `odometria` · `movimiento` · `led` · `mqtt_cliente` · `main`.
- **Lectura de los 3 sensores** (`sensores.py`): `machine.time_pulse_us` con timeout, disparo
  **secuencial** con ~25 ms de pausa para que un sensor no oiga el eco del otro, mediana de 3
  medidas, descarte fuera de 2–400 cm → `None`. Código anotado.
- **Bucle de control de `main.py`** (~50 ms): leer → decidir → aplicar PWM → odometría → LED →
  `check_msg()`. Subraya que **la evasión no depende de la red**; watchdog y `gc.collect()`.
- **Máquina de estados de evasión** (`movimiento.py`): diagrama de estados + la tabla de
  decisiones (libre / centro / un lado / los tres / pausado).
- **Odometría** (`odometria.py`): las tres ecuaciones, el esquema SVG, y la diapositiva
  honesta del **error acumulado**: 1° de desvío = 17 cm tras un metro; cómo se calibra
  (`calibrar.py`) y que reiniciar la sesión reinicia el origen.
- **Envío por MQTT** (`mqtt_cliente.py`): TLS, keepalive 30 s, **Last Will** retenido,
  configuración retenida, reconexión exponencial, y el almacenamiento de hasta 100 lecturas
  sin red que se reenvían en `telemetria/lote` con QoS 1. Incluye la tabla de tópicos desde
  `packages/shared/src/topics.ts`.
- **Modo alternativo `MODO_ENVIO = "rest"`**: cómo el mismo firmware envía lotes cada segundo
  a `POST /api/ingesta`, qué pierde al hacerlo (comandos y detección de caída) y cuándo
  conviene. El argumento de fondo de *por qué* MQTT ya está en la diapositiva de decisiones de
  infraestructura (Pregunta 2): aquí solo remítete a ella en una línea, **no lo repitas**.

### Pregunta 5 · Registro y autenticación — 15 pts (4–5 diapositivas)

- **Flujo completo** en un diagrama: registro → bcrypt → `users` → login → JWT → guard HTTP →
  handshake del WebSocket → sala `robot:{id}` con comprobación de propiedad.
- **Código del registro y del login** (`apps/api/src/routes/auth.ts`): hash bcrypt, validación,
  qué se devuelve y qué nunca sale de la base.
- **Autorización**: `auth.ts` y `ws.ts` — verificación local del JWT, roles
  (`admin` | `client`), y que un usuario solo ve **sus** dispositivos. Menciona
  `routes/admin.ts` y el panel de administración como la cara visible del rol.
- **Credenciales de los dispositivos** (distintas de las de los usuarios): token con hash
  bcrypt en `dispositivos.token_hash`, hash PBKDF2 en Mosquitto, ACL atada a `roomba/{id}/#`,
  y que **la contraseña se muestra una sola vez** al crear el robot.
- **Capturas** de `/login` y `/registro` (indicador de fortaleza, errores en línea, estados de
  carga) + nota de lo pendiente: recuperación por correo, que necesita un servidor SMTP.

### Pregunta 6 · Dashboard React en tiempo real — 15 pts (7–9 diapositivas)

- **Stack y por qué** (React + Vite + Tailwind + Chart.js + Socket.IO), y el diagrama del
  camino en vivo.
- **Captura a página completa del panel** con llamadas numeradas sobre la imagen que señalen
  cada tarjeta y digan de dónde salen sus datos.
- **Mapa en vivo**: captura + el plugin propio de Chart.js (robot con sus dos ruedas y la
  flecha del frente, los 3 haces con color por estado, trayectoria con opacidad decreciente,
  puntos de obstáculo acumulados). Explica la **interpolación con `requestAnimationFrame`** y
  el búfer de ~100 ms que hace que el movimiento se vea fluido y no a saltos.
- **Radar de sensores**: captura + anillos, sectores de ±18° y bandas por umbral.
- **Las gráficas**: series deslizantes de distancias con líneas de umbral, gauge semicircular
  de batería, dona de estados de movimiento, barras de evasiones por sensor, heatmap de
  24 h × 7 d y sparkline de latencia. Una rejilla de capturas recortadas.
- **Tiempo real**: `lib/socket.tsx` — un solo proveedor, JWT en el handshake, salas,
  reconexión, `chart.update('none')`, límite de 10 fps en las líneas y canvas de fondo en
  caché para la trayectoria. Código anotado.
- **Control**: botón de encendido, dial de distancia de evasión, perfiles y el viaje de ida y
  vuelta del comando (dashboard → WS → MQTT → ESP32 → `ack`) con los milisegundos medidos.
- **Responsivo y tema del producto**: capturas a 1440 px, 768 px y 375 px, más la captura
  del tema oscuro del dashboard. Preséntalas como maquetas sobre fondo claro, con las
  etiquetas fuera de la imagen.

### Cierre (3–4)

- **Tabla rúbrica ↔ implementación**: las 6 preguntas, el archivo donde se cumple cada una y
  el puntaje. Es la diapositiva que el evaluador quiere ver; que quepa en una pantalla.
- **Qué puede romperse y cómo se comprueba**: `pnpm lint`, `pnpm build`,
  `robot.check.ts`, `python firmware/movimiento.py`. Qué cubre cada autocomprobante.
- **Pendiente de definir**, con la lista del README (modelo del motorreductor, succión y
  cepillos, sensores adicionales, patrones de cobertura, recuperación por correo). Un
  proyecto que dice lo que no hizo se defiende mejor que uno que lo disimula.
- **Gracias / preguntas** con el QR o la URL del dashboard si existe, y los datos de las
  cuentas de prueba.

---

## 5. Entrega

1. `presentacion.html` en la raíz, abierto en el navegador y revisado **diapositiva por
   diapositiva**: ninguna con texto desbordado, ninguna imagen rota, ninguna línea de código
   cortada, ningún texto por debajo de 4.5:1 de contraste. Comprueba además una diapositiva
   cualquiera **a 1 m de distancia de la pantalla, al 50 % de zoom**: si algo no se lee ahí,
   está mal dimensionado.
2. Todas las imágenes en `_ppt_assets/`, con nombres descriptivos.
3. Un resumen final corto que liste: número de diapositivas, capturas obtenidas, **qué quedó
   como placeholder** (al menos el esquema Wokwi) y cualquier dato de la rúbrica que el código
   no respalde.

No añadas dependencias al repositorio, no modifiques el código de las apps y no toques
`README.md` ni `prompt.md`.
