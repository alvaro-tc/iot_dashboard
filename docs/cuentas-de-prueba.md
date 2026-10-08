# Cuentas de prueba

Se crean con `pnpm db:reset` (ejecuta `apps/api/db/seed.sql`). Borra y recarga los datos de demo.

## Usuarios

| Email | Contraseña | Rol | Nombre |
|---|---|---|---|
| `admin@demo.com` | `admin123` | admin | Administración |
| `alvaro@demo.com` | `cliente123` | client | Álvaro Quispe |
| `maria@demo.com` | `cliente123` | client | María Condori |

Admin extra, fuera del seed: `pnpm --filter @iot/api db:seed-admin` crea o resetea
`admin@admin.com` / `admin1234` sin tocar el resto de los datos.

## Robots y tokens

El token es el que usa el firmware/simulador para publicar telemetría.

| Dispositivo | Dueño | Token |
|---|---|---|
| `roomba-sala` (Roomba Sala) | alvaro@demo.com | `SalaDemoToken0123456789abcdefgh` |
| `roomba-cocina` (Roomba Cocina) | alvaro@demo.com | `CocinaDemoToken0123456789abcdef` |
| `roomba-maria` (Roomba Pasillo) | maria@demo.com | `MariaDemoToken0123456789abcdefg` |

## MQTT

El usuario de servicio del backend sale de `.env` (`MQTT_ADMIN_USER` / `MQTT_ADMIN_PASS`,
por defecto `iot-backend` / `cambia-esta-clave` en `.env.example`).

> Credenciales de demo: no usar en producción.
