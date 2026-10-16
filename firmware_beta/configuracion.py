
# configuracion.py

# ---------- Wi-Fi y MQTT ----------
WIFI_SSID = "redmi"
WIFI_CLAVE = "31197311"

MQTT_SERVIDOR = "iot-dashboard.tumype.com"
MQTT_PUERTO = 8883
# El 8883 del VPS es TLS (ver infra/mosquitto/roomba.conf); el 1883 solo escucha en
# localhost para el backend, así que el robot necesita TLS para llegar desde fuera.
MQTT_TLS = True

# Identificador del robot. Es a la vez:
#   - la fila `dispositivos.id` de la base de datos,
#   - el usuario MQTT del robot (su clave es el token que da el dashboard),
#   - el prefijo de sus topicos: roomba/{ROBOT_ID}/...
# La ACL de Mosquitto solo le deja hablar bajo ese prefijo, asi que tiene que coincidir
# exactamente con el id que muestra el dashboard al dar de alta el robot.
ROBOT_ID = "roomba-8h605el4"
MQTT_USUARIO = ROBOT_ID
MQTT_CLAVE = "vG_uv8qzb0A8M4EVJWqZj_snUfqvenxG"
MQTT_CLIENTE_ID = ROBOT_ID

TOPIC_TELEMETRIA = "roomba/{0}/telemetria".format(ROBOT_ID).encode()
TOPIC_ESTADO = "roomba/{0}/estado".format(ROBOT_ID).encode()
TOPIC_CONFIG = "roomba/{0}/config".format(ROBOT_ID).encode()

# Version que el robot anuncia al conectar; el dashboard la muestra en Conectividad.
VERSION_FIRMWARE = "1.2.0"

# MAC STA del ESP32 que enviará las órdenes ESP-NOW.
# El mando la muestra en su pantalla ESP-NOW; pegarla aqui para aceptar ordenes
# SOLO de ese mando. None = aceptar cualquier remitente (para probar sin la MAC).
MAC_MANDO = None

# ---------- TB6612FNG ----------
# Rueda izquierda: PWMA, AIN1, AIN2
PIN_PWMA = 25
PIN_AIN1 = 26
PIN_AIN2 = 27

# Rueda derecha: PWMB, BIN1, BIN2
PIN_PWMB = 13
PIN_BIN1 = 14
PIN_BIN2 = 32

PIN_STBY = 4

# Los dos motores van montados en espejo en el chasis: el mismo sentido electrico hace
# que una rueda empuje hacia adelante y la otra hacia atras. Pon en True la rueda que
# gira al revés, y avanzar sera avanzar. Esto corrige SOLO el cableado: el signo que se
# publica en la telemetria no cambia.
# Para ver cual es: mpremote connect COM5 run motores.py  (mueve una rueda a la vez)
INVERTIR_IZQUIERDA = False
INVERTIR_DERECHA = True

# ---------- HC-SR04 ----------
# Formato: (nombre, TRIG, ECHO)
SENSORES = (
    ("izquierdo", 19, 21),
    ("central", 5, 18),
    ("derecho", 22, 23),
)

# ---------- Batería ----------
PIN_BATERIA_ADC = 34

# Factor del divisor resistivo: voltaje_bateria / voltaje_en_el_pin.
# Con un divisor de R_alta arriba y R_baja a GND, el factor teorico es
# (R_alta + R_baja) / R_baja  ->  100k/10k = 11.0, 100k/22k = 5.55, 1:1 = 2.0.
#
# OJO: el teorico no basta, las resistencias tienen tolerancia. Mide el voltaje real en
# los bornes con un voltimetro y saca el factor exacto con:
#   mpremote connect COM5 exec "from sensores import LecturaSensores; LecturaSensores().calibrar_divisor(8.35)"
#
# El 2.0 de antes era el valor de ejemplo que venia en la plantilla y nunca se cambio:
# con el, la bateria cargada se publicaba como ~1.7 V y el dashboard mostraba 0%.
#
# 4.4 esta calibrado contra el pin el 2026-10-12: media de 1.912 V (seis lecturas,
# 6 mV de deriva) dando la bateria cargada por 8.4 V. Coincide con un divisor
# 100k/30k (teorico 4.33), que es seguramente el que lleva la placa.
# Si el voltimetro dice otra cosa en los bornes, rehaz la cuenta con calibrar_divisor().
FACTOR_DIVISOR = 4.4

# Muestras de la ADC que se promedian por lectura de bateria. La ADC del ESP32 tiene
# decenas de mV de ruido y el PWM de los motores lo empeora.
MUESTRAS_BATERIA = 16

# Bateria de 2 celdas Li-ion en serie. Tienen que coincidir con BATERIA_MIN_V y
# BATERIA_MAX_V de packages/shared/src/robot.ts: el backend usa el porcentaje que manda
# el firmware (apps/api/src/telemetria.ts) y recalcula con los suyos si no llega, asi que
# si no cuadran el mismo voltaje da dos porcentajes distintos.
VOLTAJE_MIN_BATERIA = 6.6
VOLTAJE_MAX_BATERIA = 8.4

# ---------- Control ----------
PWM_MAXIMO = 255
# PWM por debajo del cual el motor zumba pero no arranca. Calibrar: subir hasta que
# la rueda gire sola en el suelo. Cualquier velocidad != 0 se reescala a [MINIMO, MAXIMO].
PWM_MINIMO = 90
FRECUENCIA_PWM = 20000

# Detener las ruedas si se pierde la comunicación.
TIEMPO_PARADA_MS = 250

# Telemetría MQTT cada medio segundo.
INTERVALO_MQTT_MS = 500

# Tiempo máximo esperando el ECHO de un HC-SR04.
TIEMPO_MAXIMO_ECO_US = 12000