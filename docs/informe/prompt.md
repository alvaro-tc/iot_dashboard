# Prompt para NotebookLM — Generación de diapositivas (exposición de 15 minutos)

Genera una presentación de diapositivas a partir del informe fuente "Internet de las Cosas — Primera Evaluación" (aspiradora autónoma con ESP32, UCB, integrantes Álvaro Torrez y Karen Vargas, docente Ing. Pamela Valenzuela). Es para una exposición oral de **15 minutos**. Genera entre **14 y 18 diapositivas**, título corto + 3-6 bullets por diapositiva, tono técnico para un jurado universitario.

Debajo de cada punto de la estructura te doy el **contenido exacto que debe aparecer** (extraído del informe), no solo el tema — úsalo literalmente en los bullets, no lo resumas de más ni inventes datos que no estén aquí.

---

## Tema visual (aplicar a TODAS las diapositivas, de forma consistente)

Usa una identidad visual única, tipo "pizarra/cuaderno de apuntes" minimalista y moderna, con esta dirección de arte concreta:

- **Fondo:** blanco o crema muy claro, con una cuadrícula fina tipo papel milimetrado/cuaderno de ingeniería como textura de fondo (líneas delgadas, bajo contraste, nunca compitiendo con el texto).
- **Acentos gráficos:** formas orgánicas tipo "blob" (manchas redondeadas, asimétricas, de bordes suaves) en las esquinas de las diapositivas, en colores planos y saturados — paleta: azul grisáceo/petróleo, naranja mostaza, lavanda/púrpura suave y verde salvia. Usar 1-2 blobs por diapositiva como marco decorativo, nunca encima del texto.
- **Iconografía:** iconos de línea fina (outline), estilo boceto/doodle, en un solo color por icono (coherente con la paleta de blobs), nunca iconos 3D ni con sombras pesadas ni estilo clipart genérico.
- **Tipografía:** sans-serif moderna, redondeada, alto contraste de peso (títulos en negrita grande, cuerpo en regular), todo alineado a una retícula clara.
- **Paleta de color global:** azul petróleo, naranja mostaza, lavanda y verde salvia como colores de acento sobre fondo claro; usar como colores de texto principal un gris oscuro/negro suave, nunca negro puro.
- Mantener el mismo fondo, la misma paleta y el mismo estilo de iconos/ilustraciones en las 18 diapositivas — es una sola identidad visual, no un collage de estilos distintos.

**Imágenes generadas (diagramas, iconos, ilustraciones de apoyo):** TODAS las imágenes que NotebookLM genere para esta presentación deben ser **minimalistas, modernas y a color**, en el mismo estilo descrito arriba (plano, de líneas limpias, con las formas orgánicas y la paleta de colores del tema) — nunca fotorrealistas, nunca en blanco y negro, nunca con texturas recargadas o detalles innecesarios. Prioriza la claridad conceptual (un ESP32 estilizado, una nube/servidor estilizado, un sensor ultrasónico estilizado, flechas de flujo de datos) sobre el realismo técnico.

---

## 1. Portada
"Aspiradora autónoma IoT con ESP32" · Asignatura: Internet de las Cosas · Integrantes: Álvaro Torrez, Karen Vargas · Docente: Ing. Pamela Valenzuela · Carrera: Ingeniería de Sistemas · UCB La Paz.

## 2. El problema
- Los robots aspiradores comerciales con buena detección de obstáculos (infrarrojos, LIDAR, cámaras) tienen un costo que los vuelve poco accesibles para construir o reparar de forma casera.
- Reto: lograr una aspiradora automática con **detección de obstáculos confiable usando componentes lo más asequibles posible** — sensores ultrasónicos HC-SR04 en lugar de LIDAR comercial, ESP32 en lugar de controladores propietarios — sin que la reducción de costo signifique un robot que choque contra todo.
- Proyección a futuro: incorporar un LIDAR casero construido con componentes económicos, para un mapeo más preciso que el de tres sensores ultrasónicos fijos.

## 3. Objetivos
**General:** Prototipar una aspiradora automática con componentes asequibles, sin comprometer la detección de obstáculos.
**Específicos (los 8 del informe):**
- Diseñar el esquema de conexiones en Fritzing, documentando el cableado real del robot.
- Incorporar también el diagrama editable de conexiones en Wokwi.
- Diseñar el esquema de base de datos (tablas, relaciones, reglas de integridad) que respalda la telemetría y el historial de sesiones.
- Implementar WebSockets para telemetría en tiempo real en el dashboard, sin refrescar la página.
- Generar un dashboard con gráficas interactivas para visualizar la telemetría.
- Generar registros de sesiones en las que el robot recorrió la habitación, consultables después.
- Implementar inicio de sesión y autenticación de usuarios.
- Permitir que cada usuario registre y vincule su propio robot a su cuenta.
- Generar una versión beta de reconocimiento de la habitación mediante modelos de machine learning.

## 4. Alcance — qué se logró y qué no
**Dentro del alcance (prototipo real, no simulación):**
- Nodo ESP32 con sensores ultrasónicos y dos motores, construido y funcionando físicamente, publicando telemetría por MQTT.
- Base de datos PostgreSQL, sistema de autenticación propio, dashboard en tiempo real con historial.
- Beta de un sistema "LIDAR" casero como primer paso hacia mapeo del entorno.
- Visualización de datos en tiempo real, usuarios con dos roles (admin / cliente), página desplegada en un VPS.

**Fuera del alcance de esta etapa (documentado explícitamente):**
- Sistema de succión y los cepillos (hardware que no existe).
- Sensores adicionales: sensor de polvo, giroscopio, bumper, sensor de caída.
- Estimación de posición por odometría (el robot no tiene encoders).
- Cualquier estrategia de cobertura de limpieza.

**Precisión importante a comunicar al jurado:** el modo llamado "LIDAR" en el código **no usa un sensor láser** — emplea los tres sensores ultrasónicos del robot durante el giro del chasis. Tampoco se implementaron modelos de **machine learning**: ese punto sigue siendo objetivo planteado, no funcionalidad alcanzada. Sin encoders, la posición y el mapa de la beta son **estimaciones**, no mediciones directas.

## 5. Arquitectura general del sistema
Arquitectura de **tres capas**: nodo IoT → backend → dashboard. Cada lectura se retransmite por WebSocket al instante y solo después se encola para guardarse en PostgreSQL en lotes de un segundo.

Componentes del diagrama (Figura 1): **ESP32** (MicroPython, 3×US, ADC, PWM) → **Mosquitto** (TLS:8883 en el VPS, ACL por robot) → **API Express** (puente MQTT, Socket.IO, REST) → **Dashboard React** (Socket.IO, Chart.js); la API también persiste en **PostgreSQL**. Un **mando ESP-NOW** (firmware clásico) envía órdenes manuales directo al ESP32, sin pasar por Wi-Fi ni backend.

El flujo tiene cuatro tramos:
1. ESP32 → Mosquitto: telemetría por MQTT (puerto 8883), conexión persistente y Last Will para anunciar desconexión.
2. Mosquitto → API: la API está suscrita a Mosquitto y recibe cada mensaje del robot, lo valida y lo guarda en orden.
3. API → Dashboard: cada lectura válida se emite de inmediato por Socket.IO a la sala del robot (`robot:{id}`) y **solo después** entra al buffer para PostgreSQL.
4. API → PostgreSQL: persistencia por lotes, un INSERT por mensaje sería costoso ya que el robot publica varias veces por segundo.

## 6. Protocolos utilizados
Tabla completa a reproducir:

| Protocolo | Tramo | Para qué |
|---|---|---|
| MQTT (puerto 8883) | ESP32 ↔ Mosquitto ↔ API | Lleva la telemetría y el estado de conexión. Si el robot se cae, el broker avisa solo, sin esperar a que nadie pregunte |
| WebSocket (Socket.IO) | API ↔ Dashboard | Envía los datos en vivo al dashboard apenas llegan, ya autenticado desde que se abre la conexión |
| HTTP/REST (JSON) | Dashboard ↔ API | Lo que no es tiempo real: iniciar sesión, ver el historial y descargar el CSV |
| ESP-NOW | Mando ↔ ESP32 (modo clásico) | Órdenes manuales de reacción rápida, sin pasar por Wi-Fi ni por el backend. La versión beta recibe sus órdenes de movimiento por MQTT |

Por qué MQTT y no solo REST para telemetría — cuatro motivos: **latencia** (conexión persistente evita abrir una conexión nueva en cada envío a 2 Hz), **configuración sin sondeo** (el robot se suscribe a `config` y recibe el cambio sin tener que preguntar), **detección de caída gratuita** (el Last Will publica `en_linea: false` sin esperar timeout) y **configuración retenida** (un robot que arranca, o un dashboard que se abre, ven el estado vigente sin pedirlo).

## 7. Hardware y componentes
Tabla completa a reproducir (Tabla 2):

| Componente | Función |
|---|---|
| ESP32 | Microcontrolador principal: corre MicroPython y coordina sensores, motores y comunicación |
| 3× HC-SR04 (ultrasónico) | Distancia a obstáculos en los tres frentes del robot (izquierda, centro, derecha) |
| TB6612FNG (puente H) | Controla dirección y velocidad de los dos motorreductores por PWM, con sentido independiente por rueda |
| Divisor resistivo | Adapta los 5V de las líneas ECHO y de la batería a los 3.3V que tolera el ESP32 |
| 2× pilas 18650 | Fuente de energía del robot (6.0–8.4 V) |
| Portapilas | Alojamiento y conexión de las dos pilas 18650 |
| LM2596 | Regulador que reduce el voltaje de la batería al riel de 5V que usan el ESP32, el driver y los sensores |
| 2× motorreductores con ruedas | Tracción diferencial del robot |

Incluir referencia a los dos diagramas del informe: el diagrama de circuito en **Wokwi** (conexiones editable/simulable) y el diagrama de conexiones en **Fritzing** (cableado real con las piezas disponibles).

## 8. Diseño de la base de datos — justificación
- PostgreSQL nativo en el VPS (sin Docker), administrado directamente por la API con el cliente `pg`.
- Se eligió PostgreSQL —y no una solución gestionada tipo Supabase— porque el proyecto corre en un VPS pequeño ya ocupado por Mosquitto, Node.js y Nginx/Caddy, y porque las reglas de integridad del dominio (rangos de PWM y distancia, una sola sesión activa por robot, configuración obligatoria por robot) se expresan de forma natural con restricciones CHECK, índices únicos parciales y triggers del propio motor relacional, sin depender de una capa externa.

## 9. Base de datos — las 8 tablas en detalle
**Esta diapositiva (o dos, si no entra) es la más importante a nivel de detalle: explicar cada tabla y qué guarda, tal como en la Tabla 3 del informe:**

- **usuarios** — Cuentas que entran al dashboard: correo, hash bcrypt de la contraseña, nombre, rol (admin / cliente), si está activa y si puede usar el modo beta de mapeo (campo `lidar_habilitado`). Ejemplo de fila: `{id: 7, correo: "ana@demo.com", contrasena: "$2b$10$…", rol: "cliente", activo: true, lidar_habilitado: true}`.
- **preferencias_usuario** — Relación 1 a 1 con usuarios. Tema e interfaz del panel (qué widgets, dónde y con qué ajustes) como JSONB opaco, para que la misma cuenta vea lo mismo en cualquier dispositivo. Ejemplo: `{usuario_id: 7, datos: {"tema": "oscuro", "panel": {"visibles": ["radar", "bateria"]}}}`.
- **dispositivos** — Un robot físico. Su `id` de texto es a la vez el usuario MQTT (`roomba-sala`, …), con el token protegido mediante hash bcrypt y cifrado recuperable, estado de conexión y versión de firmware. Ejemplo: `{id: "roomba-sala", usuario_id: 7, nombre: "Roomba Sala", token_hash: "$2b$10$…", en_linea: true}`.
- **configuracion_dispositivo** — Relación 1 a 1 con dispositivos. Guarda parámetros de configuración que consume el firmware: PWM de crucero, ángulos y geometría de los sensores, calibración de movimiento y qué habitación está mapeando ahora (`sala_activa_id`). En el modo beta las acciones de movimiento se reciben por MQTT. Ejemplo: `{dispositivo_id: "roomba-sala", velocidad_base: 180, angulos_sensores: {"izquierdo": -45, "central": 0, "derecho": 45}, sala_activa_id: 3}`.
- **salas** — Una habitación usada por el modo beta de mapeo ultrasónico (denominado "LIDAR" en el código): su polígono de paredes, el tamaño de referencia indicado por el usuario y las dimensiones derivadas del mapeo, además de las puertas (huecos que no son salida). Ejemplo: `{id: 3, dispositivo_id: "roomba-sala", nombre: "Sala", forma: "rectangulo", ancho_estimado_cm: 400, alto_estimado_cm: 350}`.
- **mapas** — Relación 1 a 1 con salas: la rejilla de ocupación acumulada a partir de los barridos ultrasónicos, sus obstáculos ya extraídos y cuánta superficie está cubierta. Se guarda aparte de salas porque pesa mucho más que el resto de la fila. Ejemplo: `{sala_id: 3, cols: 80, filas: 70, resolucion_cm: 5, barridos: 214, cobertura: 0.86}`.
- **sesiones** — Un ciclo de funcionamiento del robot: inicio, fin (NULL = activa), total de lecturas y batería al inicio/fin. Agrupa la telemetría de un mismo ciclo de limpieza. Ejemplo: `{id: 152, dispositivo_id: "roomba-sala", iniciada_en: "2026-10-10T08:00Z", finalizada_en: null, bateria_inicio_porcentaje: 96}`.
- **lecturas** — Telemetría cruda: una fila por mensaje publicado por el ESP32 — distancia de cada sensor, PWM con signo de cada rueda, voltaje y porcentaje de batería. Es la tabla que más crece, la materia prima de todas las gráficas del panel. Ejemplo: `{id: 48213, dispositivo_id: "roomba-sala", sesion_id: 152, distancia_central_cm: 18.0, movimiento_izquierda: 180, movimiento_derecha: 180, bateria_porcentaje: 94}`.

## 10. Base de datos — reglas de integridad
Las reglas de integridad viven en la propia base, no solo en el código de la API, agrupadas en cuatro familias:

**Validación de rangos (CHECK)** — Tabla 4:
| Regla | Qué garantiza |
|---|---|
| `rol IN ('admin','cliente')` en usuarios; `forma IN ('rectangulo','poligono')` en salas | Solo esos valores son válidos; la base rechaza cualquier otro, no la API |
| `movimiento_izquierda/movimiento_derecha BETWEEN -255 AND 255` en lecturas | El PWM con signo nunca puede salirse de la escala real del driver de motores |
| `distancia_*_cm BETWEEN 0 AND 400` en lecturas | Rango físico del sensor HC-SR04. NULL significa explícitamente "el eco no volvió", no "falta el dato" |
| `bateria_porcentaje BETWEEN 0 AND 100` | Un porcentaje de batería fuera de ese rango no tiene sentido |
| `ancho_estimado_cm/alto_estimado_cm BETWEEN 50 AND 2000` en salas | Una habitación fuera de ese rango es casi con certeza un error de tecleo |

**Índices únicos:**
- `uniq_sesion_activa_por_dispositivo` (parcial, WHERE `finalizada_en IS NULL`): un mismo robot no puede tener dos sesiones abiertas a la vez.
- `uniq_sala_nombre_por_dispositivo` (dispositivo_id, lower(nombre)): dos habitaciones del mismo robot no pueden llamarse igual, sin distinguir mayúsculas.

**Borrado en cascada (ON DELETE):** `ON DELETE CASCADE` recorre toda la jerarquía usuarios → dispositivos → configuración/salas/sesiones → mapas/lecturas: borrar una cuenta no deja filas huérfanas. La excepción es `configuracion_dispositivo.sala_activa_id`, con `ON DELETE SET NULL`: borrar la sala activa no debe bloquear el robot, solo lo deja sin habitación asignada.

**Automatismos (triggers y vistas):** trigger `trg_configuracion_por_defecto` crea automáticamente la fila de configuración al insertar un dispositivo nuevo. Tres vistas (`v_lecturas_por_minuto`, `v_lecturas_por_hora`, `v_resumen_sesion`) agregan la telemetría en el propio motor, para no mandar miles de filas crudas al navegador en cada gráfica.

## 11. Seguridad de la base de datos
- **Autenticación:** todo endpoint de datos exige un JWT válido, que se revalida contra la tabla usuarios en cada petición —no solo contra la firma del token— para que una cuenta desactivada o con rol cambiado pierda el acceso de inmediato.
- **Autorización por propiedad:** se comprueba en cada ruta que el robot pedido pertenece al usuario autenticado, salvo que su rol sea admin. La misma comprobación se aplica al unirse a una sala de Socket.IO, para que la telemetría de un robot no llegue a un navegador que no es su propietario.
- Contraseñas con **bcrypt** (factor de coste 10), nunca en claro. El token del robot se guarda como hash bcrypt para validarlo, y además cifrado con **AES-256-GCM** para que su propietario pueda recuperarlo desde el panel; el broker Mosquitto mantiene su propio hash PBKDF2-SHA512 de la credencial.

## 12. Integración mediante API REST
- La API corre como cliente suscrito a Mosquitto (puente MQTT, `apps/api/src/mqtt/bridge.ts`) y recibe ahí cada mensaje que publica cualquier robot.
- El robot publica su telemetría en el topic `roomba/{ROBOT_ID}/telemetria`, autenticado con su propio usuario y contraseña en Mosquitto (el mismo token guardado como hash bcrypt).
- El puente MQTT valida cada mensaje con el mismo esquema Zod (`telemetriaSchema`) que usa la ruta `POST /api/ingesta`, así que un robot puede publicar por MQTT o por HTTP y terminar en la misma función `procesarTelemetria`.

Rutas principales (Tabla 6):
| Método y ruta | Función |
|---|---|
| POST /api/auth/signup · /auth/login | Registro e inicio de sesión; devuelven un JWT |
| POST /api/ingesta | Inserción de lotes de lecturas vía REST, autenticada con el token del robot |
| GET /api/dispositivos/:id/lecturas | Lectura cruda o agregada (raw/minuto/hora) por rango de fechas |
| GET /api/dispositivos/:id/lecturas/export.csv | Exportación a CSV del mismo rango |
| GET /api/dispositivos/:id/sesiones | Historial de sesiones de limpieza del robot |
| GET / PATCH /api/dispositivos/:id/configuracion | Lectura y cambio del PWM de crucero y los ángulos de los sensores |
| GET /api/dispositivos/:id/resumen | Estadísticas del día y acumuladas: tiempo en marcha, batería actual, mensajes por segundo |
| GET /api/salud | Estado de PostgreSQL, Mosquitto, tamaño del buffer de persistencia y clientes WebSocket conectados |

**Manejo de errores:** error handler centralizado; errores de validación Zod → 400 con mensaje por campo; errores de negocio → HttpError con el código HTTP correcto (401 sin token o credenciales incorrectas; 403 cuenta desactivada o ruta de admin; 404 recurso inexistente; 409 correo duplicado); cualquier error no previsto cae en un 500 genérico registrado en el log del servidor sin filtrar detalles internos. Un mensaje MQTT mal formado se descarta y se registra en el log, sin tumbar el proceso.

## 13. Firmware en MicroPython (ESP32)
- **Configuración de red:** conecta en modo estación con timeout explícito de 10 segundos; si falla, lanza OSError y el programa principal lo captura sin detenerse. El receptor ESP-NOW del modo clásico sigue operativo aunque no haya Wi-Fi ni MQTT.
- **Lectura de datos (mínimo tres variables):** el firmware clásico actualiza un sensor ultrasónico por iteración (ronda rotativa entre izquierdo, central y derecho cada ≥15 ms) para no bloquear el resto del programa con los hasta 12 ms que puede tardar un HC-SR04 en responder; lee la batería en la misma cadencia. Las tres variables mínimas exigidas que el robot reporta son: distancia de cada uno de los tres sensores (`distancias_cm`), voltaje/porcentaje de batería (`bateria_v`, `bateria_porcentaje`) y el PWM con signo de cada motor (`motores.izquierda_pwm/derecha_pwm`), además del estado del receptor ESP-NOW.
- **Envío de datos:** cada `INTERVALO_MQTT_MS` (500 ms por defecto, 2 Hz) el firmware publica un único JSON por MQTT en `roomba/{ROBOT_ID}/telemetria`.
- **Manejo de errores y reconexión** (`ClienteMQTT`, tres mecanismos): (1) **Last Will** — mensaje retenido `en_linea: false` que Mosquitto publica automáticamente si el robot se desconecta sin avisar; (2) **reconexión con espera fija de 5s**, sin bloquear el bucle principal (sensores y motores siguen funcionando mientras tanto); (3) **degradación explícita** — si Wi-Fi no conecta, el error se captura e imprime pero el programa continúa; prioridad del bucle: 1) órdenes ESP-NOW y seguridad, 2) sensores, 3) telemetría MQTT. Además, un **tiempo de parada de seguridad** (`TIEMPO_PARADA_MS = 250`): si no llega ninguna orden nueva en ese plazo, el robot detiene los motores.
- **Firmware beta — evasión y mapeo ultrasónico:** el modo beta recibe órdenes desde el dashboard por MQTT (no usa el mando ESP-NOW). Durante la limpieza, decide localmente cómo avanzar, girar o retroceder según las distancias de los tres HC-SR04; esta evasión no depende de que una orden de red llegue a tiempo. Para mapear una habitación, el robot gira sobre su chasis y publica por MQTT lotes de muestras con el tiempo transcurrido y las distancias medidas por cada sonar. Como no tiene encoders, el ángulo se estima con la calibración de grados por segundo; el backend encaja los barridos con la geometría de la sala y actualiza una rejilla de ocupación — la posición y el mapa son **estimaciones**, no mediciones de un LIDAR láser ni de encoders.

## 14. Sistema de autenticación
- **Registro** (`POST /api/auth/signup`): valida con Zod nombre (2–80 caracteres), correo (normalizado a minúsculas) y contraseña (mínimo 8 caracteres con letra y número), confirmando que coincide con su repetición. Contraseña guardada con bcrypt (factor 10); toda cuenta nueva se crea con rol `cliente`.
- **Login** (`POST /api/auth/login`): compara la contraseña con `bcrypt.compare` y rechaza cuentas desactivadas (`activo = false`) con un 403 explícito.
- **Gestión de sesiones:** JWT firmado (HS256), expiración de 12 horas, enviado en la cabecera `Authorization: Bearer <token>`. A diferencia de un JWT "ciego", el sistema **relee el usuario en PostgreSQL en cada petición** (`WHERE id = $1 AND activo`): si un administrador desactiva una cuenta o le cambia el rol, el acceso se corta en la siguiente petición, sin esperar a que el token expire. La misma verificación protege el handshake de Socket.IO.
- **Seguridad de acceso:** contraseñas y tokens de robot nunca en claro (bcrypt); el rol se valida tanto a nivel de esquema (CHECK) como de aplicación (middleware `requireAdmin`); separación de identidades — el JWT de usuario autentica al dashboard, el token bcrypt del robot autentica al ESP32 (vía MQTT o `Bearer` en `POST /api/ingesta`); un ESP32 nunca inicia sesión como usuario; un usuario admin puede resetear la contraseña de otro usuario desde el panel de administración (cubre la recuperación de cuenta mientras el flujo de correo `/recuperar` no tiene servidor SMTP configurado, limitación declarada abiertamente en el README).

## 15. Dashboard en tiempo real
- Frontend: React + Vite + TailwindCSS, estructurado en páginas (Login, Registro, Panel, Historial, Sesiones, Robots, Perfil, y panel de administración PanelAdmin/Usuarios/RobotsAdmin) y tarjetas reutilizables (TarjetaBateria, TarjetaDistancias, TarjetaBarrasDistancia, RadarSensores, TarjetaActividadMotor, TarjetaConectividad, TarjetaSesiones, TarjetaContador, TarjetaEstado).
- Gráficas con **Chart.js**: tarjetas y gráfica de distancia en vivo de los tres sensores, coloreadas con umbrales `DIST_EVASION_CM = 15 cm` (rojo) y `DIST_PRECAUCION_CM = 30 cm` (ámbar); contadores de actividad (tiempo de uso total y tiempo en marcha de cada motor); gauge de batería; serie de líneas de actividad del motor con el signo indicando el sentido de marcha (adelante/atrás), con zoom y pan.
- **Actualización en tiempo real:** el dashboard se conecta al namespace `/live` de Socket.IO al cargar un robot, envía su JWT en el handshake, se une a la sala `robot:{id}` y recibe de golpe el estado inicial (conexión, configuración y hasta 50 últimas lecturas en memoria). A partir de ahí, cada evento `telemetria` actualiza las gráficas sin recargar la página. Las animaciones de Chart.js están deshabilitadas globalmente porque compiten con actualizaciones a 2 Hz. El reloj del navegador se sincroniza contra el del servidor para medir la latencia real del mensaje.
- **Interactividad:** zoom y desplazamiento en gráficas de series temporales; filtros de rango/agregación en el historial (raw/minuto/hora, fecha desde/hasta) con exportación a CSV; edición de configuración del robot (velocidad de crucero, ángulos de sensor) enviada por WebSocket y retransmitida al robot como mensaje retenido; alta de robots que genera el ROBOT_ID y el token MQTT, entregando al usuario un `config.py` listo para copiar al firmware; modo oscuro y vistas responsivas (probadas en 375px, 768px y 1440px).
- **Manejo de errores:** reconexión nativa de Socket.IO; la tarjeta de conectividad refleja en vivo si el robot está en línea según el Last Will; si el handshake no trae un JWT válido, el middleware de Socket.IO rechaza la conexión antes de unirse a ninguna sala; el cliente HTTP traduce cualquier respuesta 4xx/5xx de la API en un mensaje de error visible al usuario.

## 16. Problemas de diseño y soluciones (Tabla 7 completa)
| Problema | Solución adoptada |
|---|---|
| El robot no tiene encoders ni GPS: no mide directamente su posición absoluta | La telemetría no guarda una pose estimada como si fuera una medición. La beta calcula una estimación aproximada con la calibración de motores y el encaje de los barridos con la sala; el estado de las ruedas se deduce del PWM reportado |
| Guardar cada lectura inmediatamente en PostgreSQL añadía latencia al camino en vivo | Se invirtió el orden: emitir por WebSocket primero, y solo encolar la escritura en un buffer que se vacía por lotes cada segundo |
| Un mensaje MQTT mal formado (firmware con un bug) podía propagar una excepción y tumbar el proceso de la API | Todo el camino de entrada captura y registra cualquier error sin relanzarlo; el robot que lo causó sigue publicando en el siguiente ciclo sin reiniciar la API |
| Un `estado_movimiento` de texto mantenido a mano por el firmware podía desincronizarse de lo que hacían realmente los motores | Se sustituyó por las dos columnas de PWM con signo, y el estado se deduce siempre con la misma función (`movimiento()` en `@iot/shared`), igual en el backend y en el frontend |
| Comparar bcrypt en cada lote de `POST /api/ingesta` (varias veces por segundo por robot) resultaba costoso para la CPU | Caché en memoria del hash del token por robot, con una expiración de 5 minutos para que una regeneración de credenciales siga surtiendo efecto sin reiniciar la API |

## 17. Resultados obtenidos y aprendizaje logrado
**Resultados:** el sistema cubre de punta a punta los requisitos de evaluación: nodo IoT con tres sensores y dos motores controlados por PWM, base de datos relacional con reglas de integridad resueltas en el propio motor, inserción y lectura por API REST (tanto vía MQTT como vía HTTP directo), script MicroPython con reconexión automática, sistema de autenticación propio (bcrypt + JWT), dashboard en React con telemetría en tiempo real e historial de sesiones. El diseño prioriza una latencia baja en el camino en vivo (emitir por WebSocket antes de tocar la base de datos) y distingue las mediciones del hardware de las estimaciones de movimiento y del mapa. La beta de evasión y mapeo ultrasónico no implementa los modelos de machine learning planteados como objetivo.

**Tres lecciones de ingeniería:**
1. La latencia percibida de un sistema en tiempo real depende del orden en que se hacen las cosas, no solo de la velocidad de cada pieza por separado (emitir antes de persistir).
2. El sistema debe distinguir claramente las mediciones de los sensores de las estimaciones: la beta estima el movimiento sin encoders y corrige los barridos con la geometría de la sala, pero no presenta esa pose como una medición directa.
3. Separar con claridad las identidades de un sistema (JWT de usuario del dashboard, token del robot para MQTT/HTTP) simplifica la seguridad más que intentar unificar todo bajo un único mecanismo de autenticación.

## 18. Cierre
- Repositorio completo (monorepo pnpm): github.com/alvaro-tc/iot_dashboard.
- Despliegue en producción, en vivo: iot-dashboard.tumype.com (cuentas de demostración disponibles).
- Agradecimientos y espacio para preguntas.

---

## Instrucciones de formato para NotebookLM
- Usa un estilo visual técnico/profesional y consistente, sin relleno decorativo innecesario.
- Donde el informe fuente incluya diagramas o capturas relevantes (arquitectura, diagrama entidad-relación, Wokwi/Fritzing, capturas del dashboard), indícalo como sugerencia de imagen a insertar en esa diapositiva específica.
- Reproduce las tablas marcadas arriba como tablas reales en la diapositiva (no las conviertas en un párrafo); son el contenido más denso y técnico, y es intencional que ocupen más espacio que otras diapositivas.
- No agregues datos, cifras o afirmaciones que no estén en el contenido provisto arriba — todo el contenido técnico ya viene dado, no lo reinterpretes ni lo completes con suposiciones.
- Mantén la aclaración de la diapositiva 4 (LIDAR = ultrasónico, no láser; ML no implementado) visible también donde se mencione el modo beta o mapeo, para no sobreprometer frente al jurado.
