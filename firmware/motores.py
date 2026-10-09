
# motores.py

from machine import Pin, PWM
import configuracion as cfg


class ControlMotores:

    def __init__(self):
        self.ain1 = Pin(cfg.PIN_AIN1, Pin.OUT)
        self.ain2 = Pin(cfg.PIN_AIN2, Pin.OUT)
        self.bin1 = Pin(cfg.PIN_BIN1, Pin.OUT)
        self.bin2 = Pin(cfg.PIN_BIN2, Pin.OUT)

        self.stby = Pin(cfg.PIN_STBY, Pin.OUT)

        self.pwm_izquierdo = PWM(
            Pin(cfg.PIN_PWMA),
            freq=cfg.FRECUENCIA_PWM,
            duty=0
        )

        self.pwm_derecho = PWM(
            Pin(cfg.PIN_PWMB),
            freq=cfg.FRECUENCIA_PWM,
            duty=0
        )

        self.velocidad_izquierda = 0
        self.velocidad_derecha = 0

        self.stby.value(1)
        self.detener()

    def limitar_pwm(self, valor):
        valor = int(valor)
        return max(-cfg.PWM_MAXIMO,
                   min(cfg.PWM_MAXIMO, valor))

    def aplicar_motor(self, velocidad, pin1, pin2, pwm):
        velocidad = self.limitar_pwm(velocidad)

        if velocidad > 0:
            pin1.value(1)
            pin2.value(0)

        elif velocidad < 0:
            pin1.value(0)
            pin2.value(1)

        else:
            pin1.value(0)
            pin2.value(0)

        ciclo = int(
            abs(velocidad) * 65535 / cfg.PWM_MAXIMO
        )

        # API PWM de MicroPython para ESP32 actual.
        pwm.duty_u16(ciclo)

        return velocidad

    def establecer_velocidades(self, izquierda, derecha):
        self.velocidad_izquierda = self.aplicar_motor(
            izquierda,
            self.ain1,
            self.ain2,
            self.pwm_izquierdo
        )

        self.velocidad_derecha = self.aplicar_motor(
            derecha,
            self.bin1,
            self.bin2,
            self.pwm_derecho
        )

    def detener(self):
        self.establecer_velocidades(0, 0)

    def obtener_estado(self):
        return {
            "izquierda_pwm": self.velocidad_izquierda,
            "derecha_pwm": self.velocidad_derecha
        }