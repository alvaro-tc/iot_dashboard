# Cliente MQTT sobre umqtt.simple.
#
# Dos cosas que hacen que esto funcione bien en un robot:
#   - LAST WILL retenido en `estado`: si el robot se queda sin batería a mitad de limpieza,
#     Mosquitto publica {"en_linea": false} por él. El servidor se entera en segundos, sin
#     sondear nada.
#   - check_msg() NO BLOQUEANTE dentro del bucle: los comandos llegan en milisegundos sin
#     que el robot deje de mirar sus sensores.
import json
import time

import config

try:
    from umqtt.simple import MQTTClient
except ImportError:  # pragma: no cover - solo en el ESP32 existe umqtt
    MQTTClient = None

ESPERA_MIN_MS = 1000
ESPERA_MAX_MS = 30_000


def topico(sufijo):
    return "roomba/{}/{}".format(config.ROBOT_ID, sufijo)


class Mqtt:
    def __init__(self, al_recibir):
        """`al_recibir(sufijo, datos)` se llama con cada mensaje ya parseado."""
        self.al_recibir = al_recibir
        self.cliente = None
        self.conectado = False
        self._espera = ESPERA_MIN_MS
        self._proximo_intento = 0

    def _crear(self):
        c = MQTTClient(
            client_id=config.ROBOT_ID,
            server=config.MQTT_HOST,
            port=config.MQTT_PORT,
            user=config.MQTT_USER,
            password=config.MQTT_PASS,
            keepalive=config.MQTT_KEEPALIVE,
            ssl=config.MQTT_TLS,
        )
        c.set_callback(self._callback)
        # Last Will: lo publica el broker si el robot desaparece sin despedirse.
        c.set_last_will(topico("estado"), json.dumps({"en_linea": False}), retain=True, qos=1)
        return c

    def _callback(self, topic, msg):
        t = topic.decode() if isinstance(topic, bytes) else topic
        prefijo = "roomba/{}/".format(config.ROBOT_ID)
        if not t.startswith(prefijo):
            return
        sufijo = t[len(prefijo) :]
        try:
            datos = json.loads(msg)
        except ValueError:
            print("[mqtt] mensaje no es JSON en", t)
            return
        try:
            self.al_recibir(sufijo, datos)
        except Exception as e:  # noqa: BLE001 - un comando raro no puede tumbar el robot
            print("[mqtt] error procesando", sufijo, e)

    def conectar(self):
        """Intenta conectar respetando la espera exponencial. True si quedó conectado."""
        if self.conectado:
            return True
        ahora = time.ticks_ms()
        if self._proximo_intento and time.ticks_diff(ahora, self._proximo_intento) < 0:
            return False

        try:
            self.cliente = self._crear()
            self.cliente.connect()
            self.conectado = True
            self._espera = ESPERA_MIN_MS
            self._proximo_intento = 0

            # Presencia retenida: un dashboard que abra después lo ve al instante.
            self.publicar(
                "estado",
                {"en_linea": True, "firmware": config.VERSION_FIRMWARE},
                qos=1,
                retain=True,
            )
            # La configuración está retenida: al suscribirse llega sola.
            self.cliente.subscribe(topico("cmd"), qos=1)
            self.cliente.subscribe(topico("config"), qos=1)
            print("[mqtt] conectado a", config.MQTT_HOST)
            return True
        except Exception as e:  # noqa: BLE001
            self.conectado = False
            self._espera = min(self._espera * 2, ESPERA_MAX_MS)
            self._proximo_intento = time.ticks_add(ahora, self._espera)
            print("[mqtt] fallo al conectar ({}); reintento en {} ms".format(e, self._espera))
            return False

    def publicar(self, sufijo, datos, qos=0, retain=False):
        if not self.conectado:
            return False
        try:
            self.cliente.publish(topico(sufijo), json.dumps(datos), retain=retain, qos=qos)
            return True
        except Exception as e:  # noqa: BLE001
            print("[mqtt] fallo al publicar:", e)
            self._caido()
            return False

    def comprobar(self):
        """check_msg() no bloqueante: procesa lo que haya llegado y vuelve enseguida."""
        if not self.conectado:
            return
        try:
            self.cliente.check_msg()
        except Exception as e:  # noqa: BLE001
            print("[mqtt] conexión perdida:", e)
            self._caido()

    def _caido(self):
        self.conectado = False
        try:
            self.cliente.disconnect()
        except Exception:  # noqa: BLE001 - ya estaba rota
            pass
        self._proximo_intento = time.ticks_add(time.ticks_ms(), self._espera)

    def desconectar(self):
        if not self.conectado:
            return
        # Despedida explícita: no hace falta esperar al Last Will.
        self.publicar("estado", {"en_linea": False}, qos=1, retain=True)
        try:
            self.cliente.disconnect()
        except Exception:  # noqa: BLE001
            pass
        self.conectado = False
