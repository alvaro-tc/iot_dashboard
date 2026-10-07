# Diagrama entidad-relación

Base de datos: **PostgreSQL local**. El esquema completo está en
[`apps/api/db/schema.sql`](../apps/api/db/schema.sql) y se aplica con `pnpm db:reset`.

```mermaid
erDiagram
    users ||--o{ dispositivos : "posee"
    dispositivos ||--|| configuracion_dispositivo : "tiene"
    dispositivos ||--o{ sesiones : "ejecuta"
    dispositivos ||--o{ lecturas : "publica"
    dispositivos ||--o{ eventos : "genera"
    sesiones ||--o{ lecturas : "agrupa"
    sesiones ||--o{ eventos : "agrupa"

    users {
        serial      id PK
        text        email UK
        text        password "hash bcrypt"
        text        name
        text        role "admin | client"
        boolean     is_active
        timestamptz created_at
    }

    dispositivos {
        text        id PK "tambien es el usuario MQTT"
        integer     user_id FK
        text        nombre
        text        ubicacion
        text        token_hash "hash bcrypt del token MQTT"
        boolean     is_revoked
        boolean     en_linea
        timestamptz ultimo_contacto
        text        version_firmware
        timestamptz creado_en
    }

    configuracion_dispositivo {
        text        dispositivo_id PK_FK
        text        modo "automatico | pausado | detenido"
        integer     distancia_evasion_cm "5-50"
        integer     distancia_precaucion_cm "> evasion"
        integer     velocidad_base_pct "30-100"
        integer     intervalo_telemetria_ms "100-2000"
        jsonb       angulos_sensores
        integer     area_ancho_cm
        integer     area_alto_cm
        timestamptz actualizado_en
    }

    sesiones {
        bigserial   id PK
        text        dispositivo_id FK
        timestamptz iniciada_en
        timestamptz finalizada_en "null = activa"
        integer     total_lecturas
        integer     total_evasiones
        numeric     distancia_recorrida_cm
        smallint    bateria_inicio_pct
        smallint    bateria_fin_pct
    }

    lecturas {
        bigserial   id PK
        text        dispositivo_id FK
        bigint      sesion_id FK
        integer     secuencia "contador del ESP32"
        numeric     dist_izq_cm "null = sin objeto"
        numeric     dist_centro_cm
        numeric     dist_der_cm
        text        estado_movimiento
        numeric     pos_x_cm
        numeric     pos_y_cm
        numeric     orientacion_deg
        smallint    vel_izq_pct "-100 a 100"
        smallint    vel_der_pct
        numeric     bateria_v
        smallint    bateria_pct
        smallint    rssi_dbm
        timestamptz medido_en "hora NTP del ESP32"
        timestamptz recibido_en "llegada al backend"
        timestamptz creado_en
    }

    eventos {
        bigserial   id PK
        text        dispositivo_id FK
        bigint      sesion_id FK
        text        tipo
        text        sensor "izq | centro | der | null"
        numeric     distancia_cm
        numeric     pos_x_cm
        numeric     pos_y_cm
        text        mensaje
        boolean     atendido
        timestamptz creado_en
    }
```

## Reglas que impone la propia base

No están solo en el código: si el código tuviera un error, la base lo rechaza igual.

| Regla | Cómo se impone |
|---|---|
| Un robot no puede tener dos sesiones abiertas | Índice único parcial `uniq_sesion_activa_por_dispositivo ON sesiones (dispositivo_id) WHERE finalizada_en IS NULL` |
| Una lectura no se duplica dentro de su sesión | Índice único `uniq_lectura_secuencia ON lecturas (sesion_id, secuencia)`. Un lote diferido reenviado tras una reconexión trae lecturas ya guardadas; el `ON CONFLICT DO NOTHING` del backend se apoya en esto |
| La distancia de precaución siempre por fuera de la de evasión | `CHECK (distancia_precaucion_cm > distancia_evasion_cm)`. Si no, el robot nunca frenaría antes de esquivar |
| Ningún robot sin configuración | Trigger `trg_configuracion_por_defecto` al insertar en `dispositivos` |
| Borrar un usuario no deja huérfanos | `ON DELETE CASCADE` en cadena: `users → dispositivos → sesiones → lecturas/eventos` |
| Los PWM caben en el rango físico | `CHECK (vel_izq_pct BETWEEN -100 AND 100)` |

## Índices

| Índice | Para qué |
|---|---|
| `idx_lecturas_dispositivo (dispositivo_id, creado_en DESC)` | «Las últimas N lecturas de este robot», que es la consulta más frecuente del dashboard |
| `uniq_lectura_secuencia (sesion_id, secuencia)` | Deduplicación y recorrido ordenado de una sesión |
| `idx_sesiones_dispositivo (dispositivo_id, iniciada_en DESC)` | Lista de sesiones |
| `idx_eventos_dispositivo (dispositivo_id, creado_en DESC)` | Tabla de eventos paginada |

## Vistas y funciones

| Objeto | Qué devuelve |
|---|---|
| `v_lecturas_por_minuto` | Agregado por minuto: mínimos y medias por sensor, reparto de estados de movimiento y latencia media |
| `v_lecturas_por_hora` | Lo mismo por hora, más el conteo de lecturas «cerca» por sensor |
| `v_resumen_sesion` | Duración, distancia, evasiones, batería consumida y **porcentaje de lecturas perdidas** (calculado por los huecos en `secuencia`) |
| `obtener_mapa_sesion(sesion_id, max_puntos)` | Trayectoria + **obstáculos proyectados**. Muestrea uniformemente hasta `max_puntos` (3000 por defecto) |

### Cómo se proyecta un obstáculo

El robot guarda su pose y una distancia por sensor, no la posición del obstáculo. El punto
se calcula en el momento de dibujar:

```
x_obs = x + (radio_robot + d) · cos(θ + ángulo_sensor)
y_obs = y + (radio_robot + d) · sin(θ + ángulo_sensor)
```

Esa fórmula está **dos veces a propósito**: en SQL (`obtener_mapa_sesion`) para el histórico
y en TypeScript (`puntoObstaculo` en `@iot/shared`) para el mapa en vivo. Hay un
autocomprobante en `packages/shared/src/robot.check.ts` que verifica la versión de
TypeScript; si las dos divergieran, el recorrido en vivo y su repetición no coincidirían.
