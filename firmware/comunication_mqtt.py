
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

        # Last Will: si el robot se queda sin bateria o pierde la red de golpe, el broker
        # publica esto por el. Asi el dashboard sabe que esta fuera de linea sin sondear
        # nada, y el backend cierra la sesion abierta.
        cliente.set_last_will(
            cfg.TOPIC_ESTADO,
            json.dumps({"en_linea": False}),
            retain=True,
            qos=1
        )

        cliente.connect()

        self.cliente = cliente
        self.conectado = True

        # Estado retenido: el formato es el que valida el backend ({en_linea, firmware}).
        self.cliente.publish(
            cfg.TOPIC_ESTADO,
            json.dumps({
                "en_linea": True,
                "firmware": cfg.VERSION_FIRMWARE
            }),
            retain=True,
            qos=1
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
                # Desconexion ordenada: el Last Will no se dispara, asi que hay que
                # publicar el estado a mano antes de cortar.
                self.cliente.publish(
                    cfg.TOPIC_ESTADO,
                    json.dumps({"en_linea": False}),
                    retain=True,
                    qos=1
                )
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