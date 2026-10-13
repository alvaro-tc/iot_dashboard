# main_beta.py  --  modo lidar: sonar giratorio y limpieza autonoma
#
# QUE HACE DISTINTO AL FIRMWARE CLASICO
#   - No hay mando ESP-NOW. Las ordenes llegan por MQTT, del dashboard (topico `comando`).
#   - El robot se mueve SOLO: gira sobre su eje para barrer la habitacion, o limpia esquivando
#     obstaculos con su propia maquina de estados (navegacion.py).
#   - Ademas de la telemetria de siempre, sube LOTES DE MUESTRAS del sonar (topico `barrido`):
#     milisegundos desde el inicio de la maniobra y las tres distancias.
#
# POR QUE EL FIRMWARE NO CALCULA NADA
# El ESP32 manda tiempo, no angulo: no hay encoders, asi que el angulo se deduce de los
# grados/segundo medidos en la calibracion, y eso lo hace el backend. Igual con el encaje del
# barrido contra la sala y la rejilla de ocupacion. Asi la cinematica y el mapeo viven en un
# solo sitio (packages/shared/src/lidar.ts), se pueden corregir sin reflashear el robot y se
# prueban en el PC. El firmware solo obedece y mide.
#
# Reutiliza los modulos del firmware clasico (motores, sensores, wifi, mqtt): los pines, el
# divisor de la bateria y la calibracion del ADC son los mismos y no hay dos verdades.

import json
import time

import configuracion as cfg
from motores import ControlMotores
from sensores import LecturaSensores
from conexion_wifi import conectar_wifi
from comunicacion_mqtt import ClienteMQTT
from navegacion import Navegacion

VERSION_FIRMWARE = cfg.VERSION_FIRMWARE + "-beta"

TOPIC_COMANDO = "roomba/{0}/comando".format(cfg.ROBOT_ID).encode()
TOPIC_BARRIDO = "roomba/{0}/barrido".format(cfg.ROBOT_ID).encode()
TOPIC_LIDAR = "roomba/{0}/lidar".format(cfg.ROBOT_ID).encode()

# Cada cuanto se toma una muestra de los tres sensores durante una maniobra. A 60 grados/s,
# 50 ms son 3 grados por muestra: bastante mas fino que el haz del HC-SR04 (unos 22 grados),
# asi que no se pierde nada por muestrear mas despacio y el bucle respira.
INTERVALO_MUESTRA_MS = 50

# Muestras por mensaje MQTT. 20 muestras son ~1 s de barrido y unos 500 bytes de JSON: el
# dashboard ve avanzar el mapa una vez por segundo y el broker no se inunda.
MUESTRAS_POR_LOTE = 20

# Duracion maxima de una maniobra, por si el backend manda una barbaridad o se cae a medias.
MANIOBRA_MAXIMA_MS = 40000

# Si el robot esta limpiando y se pierde el servidor, se para: durante la limpieza es el
# backend el que vigila que no se escape por una puerta (el robot no conoce el mapa).
SIN_SERVIDOR_PARA_MS = 10000

# Distancia a la que se aborta el avance de calibracion para no empotrarse en la pared.
PARED_CALIBRACION_CM = 25


class ModoLidar:

    def __init__(self):
        self.motores = ControlMotores()
        self.motores.detener()
        self.sensores = LecturaSensores()
        self.navegacion = Navegacion()
        self.mqtt = ClienteMQTT()

        # Maniobra en curso: None = quieto, esperando ordenes.
        self.accion = None
        self.inicio_ms = 0
        self.duracion_ms = 0
        self.barrido = 0
        self.lote = 0
        self.muestras = []
        self.ultima_muestra_ms = 0
        self.ultimo_comando_ms = time.ticks_ms()
        self.voltaje = 0.0
        self.porcentaje = 0

    # ---------------- MQTT ----------------

    def conectar_mqtt(self):
        self.mqtt.conectar()
        # El callback de umqtt.simple es global al cliente, no por topico.
        self.mqtt.cliente.set_callback(self._al_recibir)
        self.mqtt.cliente.subscribe(TOPIC_COMANDO, qos=1)
        self.publicar_estado()

    def _al_recibir(self, topico, mensaje):
        if topico != TOPIC_COMANDO:
            return
        try:
            orden = json.loads(mensaje.decode())
        except (ValueError, UnicodeError):
            print("[beta] comando ilegible")
            return
        self.ultimo_comando_ms = time.ticks_ms()
        self.ejecutar(orden)

    def publicar(self, topico, datos):
        if not self.mqtt.conectado or self.mqtt.cliente is None:
            return
        try:
            self.mqtt.cliente.publish(topico, json.dumps(datos))
        except Exception as error:
            print("[beta] error publicando:", error)
            self.mqtt.desconectar()

    def publicar_estado(self, progreso=None):
        self.publicar(TOPIC_LIDAR, {
            "estado": self.accion or "inactivo",
            "progreso": progreso,
            "firmware": VERSION_FIRMWARE,
            "bateria_porcentaje": self.porcentaje,
        })

    # ---------------- Ordenes ----------------

    def ejecutar(self, orden):
        accion = orden.get("accion")

        if accion == "parar":
            self.terminar_maniobra()
            return

        if accion in ("barrer", "calibrar_giro"):
            # Giro sobre el eje: una rueda adelante y la otra atras.
            pwm = self._pwm(orden, cfg.PWM_MAXIMO // 2)
            sentido = 1 if orden.get("sentido", 1) >= 0 else -1
            self.empezar_maniobra(accion, orden.get("ms", 8000))
            self.motores.establecer_velocidades(pwm * sentido, -pwm * sentido)
            return

        if accion in ("avanzar", "calibrar_avance"):
            pwm = self._pwm(orden, cfg.PWM_MAXIMO)
            self.empezar_maniobra(accion, orden.get("ms", 4000))
            self.motores.establecer_velocidades(pwm, pwm)
            return

        if accion == "girar":
            # Nudge del backend: girar un rato para esquivar una puerta o reorientarse.
            pwm = self._pwm(orden, cfg.PWM_MAXIMO // 2)
            sentido = 1 if orden.get("sentido", 1) >= 0 else -1
            self.empezar_maniobra("girar", orden.get("ms", 600))
            self.motores.establecer_velocidades(pwm * sentido, -pwm * sentido)
            return

        if accion == "limpiar":
            self.empezar_maniobra("limpiar", orden.get("ms", MANIOBRA_MAXIMA_MS))
            self.navegacion.reiniciar(self._pwm(orden, cfg.PWM_MAXIMO))
            return

        print("[beta] accion desconocida:", accion)

    def _pwm(self, orden, maximo):
        pwm = int(orden.get("pwm", 150))
        return max(0, min(maximo, pwm))

    def empezar_maniobra(self, accion, ms):
        self.accion = accion
        self.inicio_ms = time.ticks_ms()
        self.duracion_ms = max(200, min(MANIOBRA_MAXIMA_MS, int(ms)))
        # Barrido nuevo: el backend usa (barrido, lote) para ordenar y detectar lotes perdidos.
        self.barrido += 1
        self.lote = 0
        self.muestras = []
        self.ultima_muestra_ms = self.inicio_ms
        print("[beta]", accion, self.duracion_ms, "ms, barrido", self.barrido)
        self.publicar_estado(0.0)

    def terminar_maniobra(self):
        if self.accion is None:
            return
        self.motores.detener()
        self.enviar_lote(fin=True)
        print("[beta] fin de", self.accion)
        self.accion = None
        self.publicar_estado()

    # ---------------- Muestreo ----------------

    def muestrear(self, ahora):
        # Los tres sensores de una pasada. Cada HC-SR04 bloquea hasta 12 ms, asi que los tres
        # se miden en ~6-36 ms y no comparten instante exacto: el `dt` que se manda es el del
        # principio de la terna. A 60 grados/s el desfase del tercero son ~2 grados, muy por
        # debajo del ancho del haz, asi que no merece complicar el formato.
        dt = time.ticks_diff(ahora, self.inicio_ms)
        for _ in range(len(cfg.SENSORES)):
            self.sensores.actualizar_un_sensor()
        d = self.sensores.obtener_distancias()
        self.muestras.append([dt, d.get("izquierdo"), d.get("central"), d.get("derecho")])
        if len(self.muestras) >= MUESTRAS_POR_LOTE:
            self.enviar_lote()
        return d

    def enviar_lote(self, fin=False):
        if not self.muestras and not fin:
            return
        self.publicar(TOPIC_BARRIDO, {
            "barrido": self.barrido,
            "lote": self.lote,
            "modo": self.accion or "barrido",
            "muestras": self.muestras,
            "fin": fin,
        })
        self.lote += 1
        self.muestras = []

    # ---------------- Bucle ----------------

    def paso(self):
        ahora = time.ticks_ms()

        if self.accion is None:
            # Quieto: un sensor por vuelta, como el firmware clasico, para la telemetria.
            self.sensores.actualizar_un_sensor()
            return

        transcurrido = time.ticks_diff(ahora, self.inicio_ms)
        if transcurrido >= self.duracion_ms:
            self.terminar_maniobra()
            return

        if time.ticks_diff(ahora, self.ultima_muestra_ms) < INTERVALO_MUESTRA_MS:
            return
        self.ultima_muestra_ms = ahora
        distancias = self.muestrear(ahora)

        if self.accion == "limpiar":
            # La evasion la decide el robot: una orden que llegue tarde por la red no puede ser
            # lo que lo salve de chocar.
            izq, der = self.navegacion.decidir(distancias, INTERVALO_MUESTRA_MS)
            self.motores.establecer_velocidades(izq, der)

        elif self.accion == "calibrar_avance":
            # Se aborta antes de la pared: la pendiente ya se ha medido en el tramo recorrido.
            central = distancias.get("central")
            if central is not None and central <= PARED_CALIBRACION_CM:
                print("[beta] pared a", central, "cm: fin del avance de calibracion")
                self.terminar_maniobra()


def main():
    print("[beta] modo lidar", VERSION_FIRMWARE)
    modo = ModoLidar()

    try:
        conectar_wifi()
    except Exception as error:
        # Sin red no hay nada que hacer en este modo (las ordenes vienen del dashboard), pero
        # tampoco se cuelga: se queda reintentando con los motores parados.
        print("[beta] Wi-Fi no disponible:", error)

    try:
        modo.conectar_mqtt()
        print("[beta] MQTT conectado")
    except Exception as error:
        modo.mqtt.desconectar()
        print("[beta] MQTT no disponible:", error)

    ultima_telemetria = time.ticks_ms()
    ultimo_estado = time.ticks_ms()

    while True:
        # 1. Ordenes del dashboard.
        if modo.mqtt.conectado and modo.mqtt.cliente is not None:
            try:
                modo.mqtt.cliente.check_msg()
            except Exception as error:
                print("[beta] MQTT caido:", error)
                modo.mqtt.desconectar()

        # 2. Seguridad: durante la limpieza, el backend es quien sabe donde esta la puerta.
        #    Sin servidor, el robot se para en vez de seguir paseando a ciegas.
        if modo.accion == "limpiar":
            if time.ticks_diff(time.ticks_ms(), modo.ultimo_comando_ms) > SIN_SERVIDOR_PARA_MS:
                print("[beta] sin servidor: parando la limpieza")
                modo.terminar_maniobra()

        # 3. Maniobra y muestreo.
        modo.paso()

        ahora = time.ticks_ms()

        # 4. Bateria y telemetria de siempre: el resto del dashboard sigue funcionando igual.
        if time.ticks_diff(ahora, ultima_telemetria) >= cfg.INTERVALO_MQTT_MS:
            ultima_telemetria = ahora
            modo.voltaje, modo.porcentaje = modo.sensores.leer_bateria()
            modo.publicar(cfg.TOPIC_TELEMETRIA, {
                "robot_id": cfg.ROBOT_ID,
                "distancias_cm": modo.sensores.obtener_distancias(),
                "bateria_v": modo.voltaje,
                "bateria_porcentaje": modo.porcentaje,
                "motores": modo.motores.obtener_estado(),
            })

        # 5. Latido del estado de mapeo, para que el panel sepa que sigue vivo.
        if time.ticks_diff(ahora, ultimo_estado) >= 2000:
            ultimo_estado = ahora
            progreso = None
            if modo.accion is not None and modo.duracion_ms:
                progreso = time.ticks_diff(ahora, modo.inicio_ms) / modo.duracion_ms
            modo.publicar_estado(progreso)

        if not modo.mqtt.conectado:
            # Reconectar deja las ruedas quietas: una maniobra a medias sin supervision, no.
            if modo.accion is not None:
                modo.terminar_maniobra()
            modo.mqtt.intentar_reconectar()
            if modo.mqtt.conectado:
                try:
                    modo.mqtt.cliente.set_callback(modo._al_recibir)
                    modo.mqtt.cliente.subscribe(TOPIC_COMANDO, qos=1)
                    modo.publicar_estado()
                except Exception as error:
                    print("[beta] no se pudo resuscribir:", error)
                    modo.mqtt.desconectar()

        time.sleep_ms(1)
