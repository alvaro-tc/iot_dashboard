# Odometría: dónde cree el robot que está.
#
# Implementación base: DEAD RECKONING a partir de los comandos de los motores. No se mide lo
# que las ruedas giran de verdad, solo lo que se les pidió, así que el error se ACUMULA: una
# rueda que patina, una alfombra o una calibración un 5 % corta se convierten en metros de
# desvío tras unos minutos. Es lo que hay sin encoders, y está documentado en el README.
#
# La clase es intercambiable a propósito: `actualizar(vel_izq_pct, vel_der_pct, dt)` es la
# única entrada. Con encoders se sustituye por una que reciba pulsos, y con giroscopio por
# una que tome theta del MPU6050; el resto del sistema no cambia.
import math

import config


class Odometria:
    """Integra la cinemática de tracción diferencial."""

    def __init__(self):
        self.reiniciar()

    def reiniciar(self):
        """Nueva sesión: el origen del mapa pasa a ser aquí y ahora."""
        self.x = 0.0
        self.y = 0.0
        self.theta = 0.0  # grados, 0–360
        self.distancia_cm = 0.0

    def actualizar(self, vel_izq_pct, vel_der_pct, dt_s):
        """
        dt_s en segundos (el bucle de control pasa 0.05).

        v = (v_der + v_izq) / 2
        w = (v_der - v_izq) / distancia_entre_ruedas
        theta += w·dt ; x += v·cos(theta)·dt ; y += v·sin(theta)·dt
        """
        v_izq = vel_izq_pct / 100.0 * config.VEL_MAX_CM_S
        v_der = vel_der_pct / 100.0 * config.VEL_MAX_CM_S

        v = (v_der + v_izq) / 2.0
        omega_rad = (v_der - v_izq) / config.DISTANCIA_RUEDAS_CM  # rad/s

        # Se integra con el ángulo del INICIO del paso. Con dt = 50 ms el error por usar el
        # ángulo inicial en vez del medio es despreciable frente a la deriva del método.
        theta_rad = math.radians(self.theta)
        self.x += v * math.cos(theta_rad) * dt_s
        self.y += v * math.sin(theta_rad) * dt_s
        self.theta = (self.theta + math.degrees(omega_rad) * dt_s) % 360.0
        self.distancia_cm += abs(v) * dt_s

    def pose(self):
        """(x, y, theta) redondeada a 1 decimal: lo que viaja en la telemetría."""
        return round(self.x, 1), round(self.y, 1), round(self.theta, 1)


# TODO: OdometriaEncoders(Odometria) — misma interfaz, pero `actualizar` lee los pulsos de
# PIN_ENCODER_IZQ/DER en vez de los PWM. Elimina el error por patinaje.
# TODO: OdometriaGiroscopio(Odometria) — theta sale del MPU6050 (PIN_I2C_SDA/SCL) y solo
# x/y se integran. Elimina la deriva angular, que es la que más estropea el mapa.
