
# main.py

import time
import configuracion as cfg

from motores import ControlMotores
from sensores import LecturaSensores
from radio_espnow import ReceptorESPNow
from conexion_wifi import conectar_wifi
from comunicacion_mqtt import ClienteMQTT


def main():
    # 1. Inicializar motores y mantenerlos detenidos.
    motores = ControlMotores()
    motores.detener()

    # 2. Inicializar sensores.
    sensores = LecturaSensores()

    # 3. Conectar Wi-Fi para MQTT.
    # Si falla, ESP-NOW seguirá funcionando.
    try:
        conectar_wifi()
    except Exception as error:
        print("Wi-Fi no disponible:", error)

    # 4. Activar receptor ESP-NOW.
    radio = ReceptorESPNow(motores)

    # 5. Preparar MQTT.
    mqtt = ClienteMQTT()

    try:
        mqtt.conectar()
        print("MQTT conectado")
    except Exception as error:
        mqtt.desconectar()
        print("MQTT no disponible:", error)

    ultima_lectura = time.ticks_ms()
    ultima_publicacion = time.ticks_ms()

    voltaje_bateria = 0.0
    porcentaje_bateria = 0

    while True:
        # PRIORIDAD 1: órdenes inalámbricas y seguridad.
        radio.revisar_mensajes()
        radio.revisar_seguridad()

        ahora = time.ticks_ms()

        # PRIORIDAD 2: actualizar un sensor por iteración.
        # El tiempo de medición puede bloquear temporalmente el bucle.
        if time.ticks_diff(
            ahora, ultima_lectura
        ) >= 15:

            ultima_lectura = ahora

            sensores.actualizar_un_sensor()

            voltaje_bateria, porcentaje_bateria = (
                sensores.leer_bateria()
            )

        # PRIORIDAD 3: telemetría periódica.
        if time.ticks_diff(
            ahora, ultima_publicacion
        ) >= cfg.INTERVALO_MQTT_MS:

            ultima_publicacion = ahora
            datos = {
                "robot_id": cfg.ROBOT_ID,
                "distancias_cm": sensores.obtener_distancias(),
                "bateria_v": voltaje_bateria,
                "bateria_porcentaje": porcentaje_bateria,
                "motores": motores.obtener_estado(),
                "espnow": radio.obtener_estado()
            }

            mqtt.publicar_telemetria(datos)

        mqtt.intentar_reconectar()
        time.sleep_ms(1)


main()