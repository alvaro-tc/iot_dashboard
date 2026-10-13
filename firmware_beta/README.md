# firmware_beta — modo lidar

Modo nuevo del robot: **sonar giratorio** para reconocer la habitación y **limpieza autónoma**,
sin mando ESP-NOW y sin un solo componente nuevo. Los tres HC-SR04 de siempre, girando con el
chasis, hacen de lidar.

## Cómo se entra y se sale

MicroPython ejecuta `boot.py` y después `main.py`, siempre. `boot.py` mira la causa del reset:

| Causa | Qué arranca |
|---|---|
| **Reset por software** (`Ctrl-D` en el REPL, `machine.soft_reset()`) | **modo lidar** (`main_beta.py`, bucle infinito: `main.py` no llega a correr) |
| Encendido, botón EN, watchdog | **modo clásico** (`main.py`, el de ESP-NOW, intacto) |

No se escribe nada en la flash: la causa del reset ya lleva la información. **Quitar y poner la
corriente siempre devuelve al modo antiguo**, que es la vía de escape si el modo lidar se cuelga.

```sh
mpremote connect COM5          # y pulsar Ctrl-D  -> modo lidar
# desenchufar y enchufar       # -> modo clásico
```

## Desplegar

Los archivos de este directorio van **junto a** los del firmware clásico, en la raíz del
sistema de archivos del ESP32: el modo lidar reutiliza `motores.py`, `sensores.py`,
`conexion_wifi.py`, `comunicacion_mqtt.py` y `configuracion.py` para no tener dos verdades
sobre los pines, el divisor de la batería o la calibración del ADC.

```sh
mpremote connect COM5 fs cp ../firmware/*.py :      # clásico (si no está ya)
mpremote connect COM5 fs cp *.py :                  # boot.py, main_beta.py, navegacion.py
mpremote connect COM5 reset                         # arranca en clásico
```

Requiere `umqtt.simple` en el dispositivo, igual que el clásico:
`mpremote connect COM5 mip install umqtt.simple`.

## Qué habla por MQTT

Prefijo de siempre, `roomba/{ROBOT_ID}/...`, así que **la ACL de Mosquitto no cambia**
(ya es `roomba/{id}/#`).

| Tópico | Dirección | Contenido |
|---|---|---|
| `comando` | baja | `{"accion": "...", "pwm": 140, "ms": 8000, "sentido": 1}` |
| `barrido` | sube | `{"barrido":3,"lote":0,"modo":"barrido","muestras":[[dt,izq,cen,der],…],"fin":false}` |
| `lidar` | sube | `{"estado":"barriendo","progreso":0.4,"firmware":"…-beta"}` |
| `telemetria`, `estado` | sube | exactamente igual que el clásico: el resto del panel sigue funcionando |

Acciones: `barrer`, `limpiar`, `girar`, `avanzar`, `calibrar_giro`, `calibrar_avance`, `parar`.

## Por qué el firmware no calcula el mapa

El ESP32 manda **tiempo, no ángulo**. Sin encoders, el ángulo sale de los grados/segundo
medidos en la calibración, y de eso se encarga el backend; igual que del encaje del barrido
contra la sala y de la rejilla de ocupación. Todo eso vive en un solo sitio
(`packages/shared/src/lidar.ts`), se corrige sin reflashear el robot y se prueba en el PC
(`pnpm --filter @iot/shared check`).

El firmware solo obedece y mide. Lo único que decide él es la **evasión de obstáculos** durante
la limpieza (`navegacion.py`): una orden que llegue tarde por la red no puede ser lo que evite
el golpe.

## Seguridad

- Toda maniobra tiene duración máxima (40 s) y se para al acabar.
- Si se cae MQTT a media maniobra, las ruedas se detienen.
- Limpiando, si el servidor no da señales en 10 s el robot se para: durante la limpieza es el
  backend el que sabe dónde está la puerta (el robot no conoce el mapa).
- El avance de calibración se aborta a 25 cm de la pared.

## Probar sin robot

`navegacion.py` corre en el PC (solo es la máquina de estados):

```sh
PYTHONPATH=../firmware python navegacion.py
```

Y el simulador habla este mismo protocolo, así que el mapeo del dashboard se puede probar
entero sin hardware: `pnpm simular`.
