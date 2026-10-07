# LED de estado. Todos los patrones son NO BLOQUEANTES: se calculan comparando ticks_ms,
# nunca con sleep. Un sleep aquí frenaría el bucle de control y el robot tardaría más en
# reaccionar a un obstáculo.
#
#   fijo            en movimiento (modo automático)
#   1 Hz            pausado o detenido
#   4 Hz            evadiendo un obstáculo
#   doble cada 2 s  batería baja
#   muy rápido      conectando a WiFi o MQTT
import machine
import time

import config

FIJO = "fijo"
LENTO = "lento"
RAPIDO = "rapido"
DOBLE = "doble"
CONECTANDO = "conectando"
APAGADO = "apagado"

# Periodo completo de cada patrón, en ms.
_PERIODO = {LENTO: 1000, RAPIDO: 250, DOBLE: 2000, CONECTANDO: 120}


class Led:
    def __init__(self):
        self.pin = machine.Pin(config.PIN_LED, machine.Pin.OUT)
        self.patron = APAGADO
        self._encendido = False
        self.pin.value(0)

    def set(self, patron):
        self.patron = patron

    def actualizar(self):
        """Llamar en cada paso del bucle de control."""
        if self.patron == APAGADO:
            encendido = False
        elif self.patron == FIJO:
            encendido = True
        elif self.patron == DOBLE:
            # Dos destellos cortos al principio del ciclo y después oscuridad.
            t = time.ticks_ms() % _PERIODO[DOBLE]
            encendido = t < 120 or (240 < t < 360)
        else:
            periodo = _PERIODO[self.patron]
            encendido = (time.ticks_ms() % periodo) < periodo // 2

        if encendido != self._encendido:
            self._encendido = encendido
            self.pin.value(1 if encendido else 0)

    def patron_para(self, modo, evadiendo, bateria_baja):
        """Prioridad: batería baja > evasión > modo. Lo urgente manda sobre lo informativo."""
        if bateria_baja:
            return DOBLE
        if evadiendo:
            return RAPIDO
        if modo == "automatico":
            return FIJO
        return LENTO
