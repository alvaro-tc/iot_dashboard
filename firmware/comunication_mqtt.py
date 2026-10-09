
# comunicacion_mqtt.py

import json
import time
from umqtt.simple import MQTTClient
import configuracion as cfg


class ClienteMQTT:

    def __init__(self):
        self.cliente = None
        self.conectado = False
        self.ultimo_intento_ms = 0

    def conectar(self):
        cliente = MQTTClient(
            client_id=cfg.MQTT_CLIENTE_ID,
            server=cfg.MQTT_SERVIDOR,
            port=cfg.MQTT_PUERTO,
            user=cfg.MQTT_USUARIO or None,
            password=cfg.MQTT_CLAVE or None,
            keepalive=30
        )

        cliente.connect()

        self.cliente = cliente
        self.conectado = True

        self.cliente.publish(
            cfg.TOPIC_ESTADO,
            b'{"conectado":true}'
        )

    def publicar_telemetria(self, datos):
        if not self.conectado or self.cliente is None:
            return

        try:
            mensaje = json.dumps(datos)

            self.cliente.publish(
                cfg.TOPIC_TELEMETRIA,
                mensaje
            )

        except Exception as error:
            print("Error MQTT:", error)
            self.desconectar()

    def desconectar(self):
        try:
            if self.cliente is not None:
                self.cliente.disconnect()
        except Exception:
            pass

        self.cliente = None
        self.conectado = False

    def intentar_reconectar(self):
        ahora = time.ticks_ms()

        if self.conectado:
            return

        if time.ticks_diff(
            ahora, self.ultimo_intento_ms
        ) < 5000:
            return

        self.ultimo_intento_ms = ahora

        try:
            self.conectar()
            print("MQTT conectado")
        except Exception as error:
            self.desconectar()
            print("MQTT no disponible:", error)