
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

    def leer_bateria(self):
        # Compatible con firmwares que exponen read_u16()
        # o solamente read() para el ADC.
        if hasattr(self.adc, "read_u16"):
            lectura = self.adc.read_u16()
            max_adc = 65535
        else:
            lectura = self.adc.read()
            max_adc = 4095

        voltaje_pin = lectura * 3.3 / max_adc

        voltaje_bateria = (
            voltaje_pin * cfg.FACTOR_DIVISOR
        )

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