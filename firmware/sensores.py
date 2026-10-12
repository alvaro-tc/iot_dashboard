
# sensores.py

from machine import Pin, ADC, time_pulse_us
import time
import configuracion as cfg


class LecturaSensores:

    def __init__(self):
        self.sensores = []

        for nombre, pin_trig, pin_echo in cfg.SENSORES:
            trig = Pin(pin_trig, Pin.OUT, value=0)
            echo = Pin(pin_echo, Pin.IN)

            self.sensores.append({
                "nombre": nombre,
                "trig": trig,
                "echo": echo
            })

        self.indice_sensor = 0

        self.distancias = {
            nombre: None
            for nombre, _, _ in cfg.SENSORES
        }

        self.adc = ADC(Pin(cfg.PIN_BATERIA_ADC))

        try:
            self.adc.atten(ADC.ATTN_11DB)
        except AttributeError:
            pass

        try:
            self.adc.width(ADC.WIDTH_12BIT)
        except AttributeError:
            pass

    def medir_distancia(self, trig, echo):
        trig.value(0)
        time.sleep_us(2)

        trig.value(1)
        time.sleep_us(10)
        trig.value(0)

        try:
            duracion = time_pulse_us(
                echo,
                1,
                cfg.TIEMPO_MAXIMO_ECO_US
            )

            if duracion < 0:
                return None

            return round(duracion / 58.0, 1)

        except OSError:
            return None

    def actualizar_un_sensor(self):
        sensor = self.sensores[self.indice_sensor]

        distancia = self.medir_distancia(
            sensor["trig"],
            sensor["echo"]
        )

        self.distancias[sensor["nombre"]] = distancia

        self.indice_sensor += 1

        if self.indice_sensor >= len(self.sensores):
            self.indice_sensor = 0

    def obtener_distancias(self):
        return self.distancias.copy()

    def microvoltios_pin(self):
        # read_uv() aplica la calibracion de Vref grabada en el eFuse del chip y la curva
        # real de la atenuacion. La cuenta a mano que habia antes (lectura * 3.3 / 4095)
        # daba por bueno un Vref de 3.3 V que ningun ESP32 tiene: el real ronda 1.1 V con
        # +-10% de dispersion y a 11 dB la escala completa se queda en ~3.1 V, asi que esa
        # division sola ya se iba hasta un 10%.
        if hasattr(self.adc, "read_uv"):
            return self.adc.read_uv()

        return int(self.adc.read() * 3.3 / 4095 * 1000000)

    def voltaje_pin(self):
        # La ADC del ESP32 tiene decenas de mV de ruido y el PWM de los motores lo empeora:
        # con una sola muestra la telemetria bailaba ~60 mV entre lecturas seguidas.
        total = 0

        for _ in range(cfg.MUESTRAS_BATERIA):
            total += self.microvoltios_pin()

        return total / cfg.MUESTRAS_BATERIA / 1000000.0

    def leer_bateria(self):
        voltaje_bateria = self.voltaje_pin() * cfg.FACTOR_DIVISOR

        minimo = cfg.VOLTAJE_MIN_BATERIA
        maximo = cfg.VOLTAJE_MAX_BATERIA

        porcentaje = int(
            max(0, min(
                100,
                (voltaje_bateria - minimo)
                / (maximo - minimo) * 100
            ))
        )

        return round(voltaje_bateria, 2), porcentaje

    def calibrar_divisor(self, voltaje_real):
        # El factor real depende de las dos resistencias fisicas, de su tolerancia y de la
        # impedancia de entrada de la ADC, asi que no se deduce del esquema: se mide.
        # Con la bateria puesta, el voltimetro en sus bornes y el robot encendido:
        #   mpremote connect COM5 exec "from sensores import LecturaSensores; LecturaSensores().calibrar_divisor(8.35)"
        pin = self.voltaje_pin()
        print("pin:", round(pin, 4), "V  ->  FACTOR_DIVISOR =", round(voltaje_real / pin, 3))


def demo():
    sensores = LecturaSensores()

    pin = sensores.voltaje_pin()
    voltaje, porcentaje = sensores.leer_bateria()

    print("pin:", round(pin, 4), "V   bateria:", voltaje, "V  ", porcentaje, "%")

    # El porcentaje tiene que salir del voltaje medido y no escaparse nunca del rango,
    # que es justo lo que fallaba cuando el voltaje venia mal. Se recalcula del voltaje
    # que devuelve leer_bateria(), no de otra lectura de la ADC: dos lecturas seguidas
    # difieren por el ruido y el assert saltaria sin que nada este roto.
    esperado = int(
        max(0, min(
            100,
            (voltaje - cfg.VOLTAJE_MIN_BATERIA)
            / (cfg.VOLTAJE_MAX_BATERIA - cfg.VOLTAJE_MIN_BATERIA) * 100
        ))
    )

    assert 0 <= porcentaje <= 100
    assert abs(porcentaje - esperado) <= 1, (porcentaje, esperado)

    if voltaje < cfg.VOLTAJE_MIN_BATERIA:
        print("AVISO: por debajo de", cfg.VOLTAJE_MIN_BATERIA, "V -> el dashboard mostrara 0%.")
        print("Si la bateria esta cargada, el FACTOR_DIVISOR no es el de tu divisor:")
        print("llama a calibrar_divisor(<voltaje del voltimetro>).")
    else:
        print("ok")


if __name__ == "__main__":
    demo()
