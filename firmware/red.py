# WiFi y hora NTP.
#
# La hora importa más de lo que parece: cada lectura viaja con `t` (epoch ms UTC), y el
# dashboard calcula la latencia extremo a extremo como `ahora - t`. Con el reloj del ESP32
# sin sincronizar, esa latencia sería basura.
import network
import time

import config

INTENTOS_WIFI = 20  # medio segundo cada uno
RESINCRONIZAR_NTP_MS = 3_600_000  # una vez por hora


class Red:
    def __init__(self, led=None):
        self.wlan = network.WLAN(network.STA_IF)
        self.led = led
        self._ultimo_ntp = None

    def conectar(self):
        """Conecta al WiFi. True si quedó conectado."""
        self.wlan.active(True)
        if self.wlan.isconnected():
            return True

        print("[red] conectando a", config.WIFI_SSID)
        self.wlan.connect(config.WIFI_SSID, config.WIFI_PASS)
        for _ in range(INTENTOS_WIFI):
            if self.wlan.isconnected():
                print("[red] IP:", self.wlan.ifconfig()[0])
                return True
            if self.led:
                self.led.actualizar()
            time.sleep_ms(500)
        print("[red] no se pudo conectar")
        return False

    def conectado(self):
        return self.wlan.isconnected()

    def asegurar(self):
        """Reconecta si se cayó. Pensado para llamarse desde el bucle, no bloquea de más."""
        if self.wlan.isconnected():
            return True
        return self.conectar()

    def rssi(self):
        try:
            return self.wlan.status("rssi")
        except (OSError, ValueError):
            return -99  # algunos puertos no exponen rssi

    def sincronizar_hora(self, forzar=False):
        """
        Pone el reloj en hora por NTP. Se repite cada hora porque el RTC del ESP32 deriva
        varios segundos al día.
        """
        ahora = time.ticks_ms()
        if not forzar and self._ultimo_ntp is not None:
            if time.ticks_diff(ahora, self._ultimo_ntp) < RESINCRONIZAR_NTP_MS:
                return True
        try:
            import ntptime

            ntptime.host = config.NTP_HOST
            ntptime.settime()
            self._ultimo_ntp = ahora
            print("[red] hora sincronizada")
            return True
        except Exception as e:  # noqa: BLE001 - cualquier fallo de red deja el reloj como estaba
            print("[red] NTP falló:", e)
            return False

    def hora_sincronizada(self):
        return self._ultimo_ntp is not None


# Época de MicroPython: 2000-01-01. La de Unix: 1970-01-01.
SEGUNDOS_2000 = 946_684_800


def epoch_ms():
    """Milisegundos UTC desde 1970, que es lo que entiende el servidor."""
    return (time.time() + SEGUNDOS_2000) * 1000
