
# radio_espnow.py

import espnow
import json
import time
import configuracion as cfg


class ReceptorESPNow:

    def __init__(self, motores):
        self.motores = motores

        self.radio = espnow.ESPNow()
        self.radio.active(True)

        self.ultimo_mensaje_ms = time.ticks_ms()
        self.mensajes_recibidos = 0
        self.mensajes_invalidos = 0

    def revisar_mensajes(self):
        # Recepción no bloqueante: no esperar al siguiente paquete.
        try:
            mac, mensaje = self.radio.recv(0)
        except TypeError:
            mac, mensaje = self.radio.recv()

        if not mensaje:
            return

        # Aceptar órdenes únicamente del mando configurado.
        if mac != cfg.MAC_MANDO:
            return

        try:
            orden = json.loads(mensaje.decode())

            izquierda = int(orden["izq"])
            derecha = int(orden["der"])

            # El control de motores aplica los límites PWM.
            self.motores.establecer_velocidades(
                izquierda,
                derecha
            )

            self.ultimo_mensaje_ms = time.ticks_ms()
            self.mensajes_recibidos += 1

        except (ValueError, TypeError, KeyError, UnicodeError):
            self.mensajes_invalidos += 1

    def revisar_seguridad(self):
        tiempo_sin_orden = time.ticks_diff(
            time.ticks_ms(),
            self.ultimo_mensaje_ms
        )

        if tiempo_sin_orden > cfg.TIEMPO_PARADA_MS:
            self.motores.detener()

    def obtener_estado(self):
        return {
            "mensajes_recibidos": self.mensajes_recibidos,
            "mensajes_invalidos": self.mensajes_invalidos
        }