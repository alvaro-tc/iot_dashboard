# MAC del robot (ESP32 aspirador)

Leidas del propio ESP32 con `network.WLAN(...).config("mac")` el 2026-10-12.

| Interfaz | MAC | Para que sirve |
|---|---|---|
| **STA** | `00:70:07:17:cd:d4` | La que usa ESP-NOW y el WiFi del robot. **Esta es la que hay que pegar en el mando.** |
| AP | `00:70:07:17:cd:d5` | Solo si el robot levanta su propia red. No se usa. |

`machine.unique_id()` devuelve lo mismo que la STA: `00:70:07:17:cd:d4`.

## Donde se usa

ESP-NOW va de **mando -> robot**, asi que cada lado necesita la MAC del otro:

- En el **mando**: registrar como peer la STA del robot, `00:70:07:17:cd:d4`.
- En **este** robot, `configuracion.py` -> `MAC_MANDO`: la MAC del *mando*, no la de aqui.
  Ahora esta en `None`, que acepta ordenes de cualquier remitente. El mando la muestra
  en su pantalla ESP-NOW; al pegarla, en formato bytes:

  ```python
  MAC_MANDO = b"\xAA\xBB\xCC\xDD\xEE\xFF"
  ```

Chip: ESP32-D0WD-V3 rev v3.1, flash 4 MB, MicroPython v1.29.0 (2026-08-24).

## Canal WiFi (importante para que ESP-NOW no se corte)

ESP-NOW no tiene canal propio: usa el canal en el que esté sintonizado el radio
WiFi de cada chip en ese momento. El robot se conecta como STA al router
("redmi"), así que su canal lo decide el router, no el firmware. Si el mando
se queda en su canal por defecto (normalmente el 1) y el router usa otro, los
paquetes del mando llegan al aire en un canal distinto al que escucha el
robot: se pierden de forma errática, y empeora con más tráfico/interferencia
(coincide con "se corta al moverse": más RF alrededor, más paquetes caen en
el canal equivocado).

Desde este cambio, `conectar_wifi()` imprime el canal real al conectar:

```
IP del robot: 192.168.1.42
Canal WiFi (el mando debe usar el mismo): 6
```

Pasos:

1. Fija el canal del router (en su configuración WiFi) a uno fijo, por
   ejemplo el 6, en vez de dejarlo en automático — si el router cambia de
   canal solo, el mando se desincroniza sin que cambies nada en el código.
2. Lee el canal impreso por el robot al arrancar.
3. En el mando, antes de registrar el peer ESP-NOW, fuerza ese mismo canal:

   ```python
   import network

   wifi = network.WLAN(network.STA_IF)
   wifi.active(True)
   wifi.config(channel=6)  # el mismo numero que imprime el robot
   ```

   Esto no conecta el mando a ningun router (sigue sin AP), solo sintoniza
   su radio en ese canal para que ESP-NOW hable en la misma frecuencia que
   el robot.
