
# configuracion.py

# ---------- Wi-Fi y MQTT ----------
WIFI_SSID = "NOMBRE_DE_TU_WIFI"
WIFI_CLAVE = "CLAVE_DE_TU_WIFI"

MQTT_SERVIDOR = "192.168.1.100"
MQTT_PUERTO = 1883

# Identificador del robot. Es a la vez:
#   - la fila `dispositivos.id` de la base de datos,
#   - el usuario MQTT del robot (su clave es el token que da el dashboard),
#   - el prefijo de sus topicos: roomba/{ROBOT_ID}/...
# La ACL de Mosquitto solo le deja hablar bajo ese prefijo, asi que tiene que coincidir
# exactamente con el id que muestra el dashboard al dar de alta el robot.
ROBOT_ID = "roomba-sala"
MQTT_USUARIO = ROBOT_ID
MQTT_CLAVE = "SalaDemoToken0123456789abcdefgh"
MQTT_CLIENTE_ID = ROBOT_ID

TOPIC_TELEMETRIA = "roomba/{0}/telemetria".format(ROBOT_ID).encode()
TOPIC_ESTADO = "roomba/{0}/estado".format(ROBOT_ID).encode()
TOPIC_CONFIG = "roomba/{0}/config".format(ROBOT_ID).encode()

# Version que el robot anuncia al conectar; el dashboard la muestra en Conectividad.
VERSION_FIRMWARE = "1.2.0"

# MAC STA del ESP32 que enviará las órdenes ESP-NOW.
MAC_MANDO = b"\xaa\xbb\xcc\xdd\xee\xff"

# ---------- TB6612FNG ----------
# Rueda izquierda: PWMA, AIN1, AIN2
PIN_PWMA = 25
PIN_AIN1 = 26
PIN_AIN2 = 27

# Rueda derecha: PWMB, BIN1, BIN2
PIN_PWMB = 14
PIN_BIN1 = 16
PIN_BIN2 = 17

PIN_STBY = 13

# ---------- HC-SR04 ----------
# Formato: (nombre, TRIG, ECHO)
SENSORES = (
    ("izquierdo", 18, 19),
    ("central", 21, 22),
    ("derecho", 23, 5),
)

# ---------- Batería ----------
PIN_BATERIA_ADC = 34

# Ejemplo de divisor resistivo 1:1.
# Cambiar por el factor real de tu divisor.
FACTOR_DIVISOR = 2.0

# Ejemplo para batería de 2 celdas Li-ion en serie.
# Ajustar al tipo de batería utilizado.
VOLTAJE_MIN_BATERIA = 6.0
VOLTAJE_MAX_BATERIA = 8.4

# ---------- Control ----------
PWM_MAXIMO = 255
FRECUENCIA_PWM = 20000

# Detener las ruedas si se pierde la comunicación.
TIEMPO_PARADA_MS = 250

# Telemetría MQTT cada medio segundo.
INTERVALO_MQTT_MS = 500

# Tiempo máximo esperando el ECHO de un HC-SR04.
TIEMPO_MAXIMO_ECO_US = 12000