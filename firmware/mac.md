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
