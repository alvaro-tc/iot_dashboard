
# conexion_wifi.py

import network
import time
import configuracion as cfg


def conectar_wifi():
    wifi = network.WLAN(network.STA_IF)
    wifi.active(True)

    if not wifi.isconnected():
        wifi.connect(
            cfg.WIFI_SSID,
            cfg.WIFI_CLAVE
        )

        inicio = time.ticks_ms()

        while not wifi.isconnected():
            if time.ticks_diff(
                time.ticks_ms(), inicio
            ) > 10000:
                raise OSError("Tiempo agotado al conectar Wi-Fi")

            time.sleep_ms(100)

    # Desactivar el ahorro de energia del radio WiFi: con el modem sleep activo
    # (el modo por defecto), el ESP32 apaga el radio entre balizas y la recepcion
    # de ESP-NOW se vuelve intermitente aunque el WiFi siga conectado.
    wifi.config(pm=wifi.PM_NONE)

    print("IP del robot:", wifi.ifconfig()[0])
    print("Canal WiFi (el mando debe usar el mismo):", wifi.config("channel"))

    return wifi