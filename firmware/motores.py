# Tracción diferencial con puente H.
#
# Por defecto TB6612FNG; cambiando DRIVER a "l298n" en config.py funciona igual con un L298N
# (ENA/IN1/IN2 y ENB/IN3/IN4), porque la interfaz es la misma: PWM + dos pines de sentido.
# Lo único que cambia es que el L298N no tiene STBY.
import machine
import time

import config

# Rampa: cuánto puede cambiar el PWM de una rueda en cada paso del bucle de control.
# Sin rampa, pasar de 0 a 60 % de golpe hace patinar las ruedas, y la odometría cuenta un
# avance que no ocurrió.
RAMPA_PCT_POR_PASO = 12


def _recorta(v, minimo=-100, maximo=100):
    return max(minimo, min(maximo, v))


class Motor:
    """Una rueda: PWM con signo de -100 a 100."""

    def __init__(self, pin_pwm, pin_in1, pin_in2, invertir=False, factor=1.0):
        self.pwm = machine.PWM(machine.Pin(pin_pwm), freq=config.PWM_FREQ)
        self.in1 = machine.Pin(pin_in1, machine.Pin.OUT)
        self.in2 = machine.Pin(pin_in2, machine.Pin.OUT)
        self.invertir = invertir
        self.factor = factor
        self.velocidad = 0
        self.aplicar(0)

    def aplicar(self, pct):
        """pct de -100 a 100. Negativo = marcha atrás, 0 = parado."""
        pct = _recorta(int(pct))
        self.velocidad = pct
        efectivo = pct * self.factor
        if self.invertir:
            efectivo = -efectivo

        if efectivo > 0:
            self.in1.value(1)
            self.in2.value(0)
        elif efectivo < 0:
            self.in1.value(0)
            self.in2.value(1)
        else:
            # Freno: ambos pines a 1 para que no siga rodando por inercia.
            self.in1.value(1)
            self.in2.value(1)

        self.pwm.duty_u16(int(min(100, abs(efectivo)) / 100 * 65535))


class Traccion:
    def __init__(self):
        self.izq = Motor(
            config.PIN_PWMA, config.PIN_AIN1, config.PIN_AIN2, config.INVERTIR_IZQ, config.FACTOR_IZQ
        )
        self.der = Motor(
            config.PIN_PWMB, config.PIN_BIN1, config.PIN_BIN2, config.INVERTIR_DER, config.FACTOR_DER
        )

        # El TB6612FNG queda en alta impedancia mientras STBY esté a 0.
        self.stby = None
        if config.DRIVER == "tb6612":
            self.stby = machine.Pin(config.PIN_STBY, machine.Pin.OUT)
            self.stby.value(1)

        self._objetivo_izq = 0
        self._objetivo_der = 0

    # --- Órdenes de alto nivel: fijan el objetivo, la rampa hace el resto ---

    def set_ruedas(self, izq, der):
        self._objetivo_izq = _recorta(int(izq))
        self._objetivo_der = _recorta(int(der))

    def avanzar(self, vel):
        self.set_ruedas(vel, vel)

    def retroceder(self, vel):
        self.set_ruedas(-abs(vel), -abs(vel))

    def girar_izq(self, vel):
        """Gira sobre su eje hacia la izquierda: ruedas en sentidos opuestos."""
        self.set_ruedas(-abs(vel), abs(vel))

    def girar_der(self, vel):
        self.set_ruedas(abs(vel), -abs(vel))

    def detener(self):
        self.set_ruedas(0, 0)
        # El freno se aplica ya, sin esperar a la rampa: detener tiene que ser inmediato.
        self.izq.aplicar(0)
        self.der.aplicar(0)

    def actualizar(self):
        """
        Acerca el PWM real al objetivo un escalón de rampa. Hay que llamarlo cada paso del
        bucle de control.
        """
        for motor, objetivo in ((self.izq, self._objetivo_izq), (self.der, self._objetivo_der)):
            delta = objetivo - motor.velocidad
            if delta == 0:
                continue
            paso = max(-RAMPA_PCT_POR_PASO, min(RAMPA_PCT_POR_PASO, delta))
            motor.aplicar(motor.velocidad + paso)

    @property
    def velocidades(self):
        """(izq, der) en PWM con signo: lo que se publica como `vi` y `vd`."""
        return self.izq.velocidad, self.der.velocidad

    def apagar(self):
        self.detener()
        if self.stby:
            self.stby.value(0)
