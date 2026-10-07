# Copia este archivo a config.py en el ESP32 y rellena tus valores.
# config.py NO se sube al repositorio: lleva la contraseña del WiFi y la del broker.

# --- Red ---
WIFI_SSID = "TU_RED"
WIFI_PASS = "TU_CLAVE"

# --- Identidad y broker ---
# El ROBOT_ID es a la vez el id del dispositivo y el usuario MQTT: te lo da el dashboard
# al crear el robot ("Agregar robot"), junto con la contraseña.
ROBOT_ID = "roomba-xxxxxxxx"
MQTT_HOST = "192.168.1.100"
MQTT_PORT = 1883  # 8883 con TLS
MQTT_USER = ROBOT_ID
MQTT_PASS = "pon-aqui-la-contrasena-del-dashboard"
MQTT_TLS = False  # True en producción (listener 8883 de Mosquitto)
MQTT_KEEPALIVE = 30

VERSION_FIRMWARE = "1.2.0"

# Cómo se envía la telemetría:
#   "mqtt"  por el broker (lo normal: baja latencia, comandos instantáneos)
#   "rest"  lotes cada segundo por HTTP contra la API REST (modo alternativo, ver main.py)
MODO_ENVIO = "mqtt"
REST_URL = "http://192.168.1.100:4000/api/ingesta"  # solo si MODO_ENVIO = "rest"
REST_TOKEN = ""

# --- Zona horaria para NTP (segundos de desfase respecto a UTC) ---
# La telemetría viaja siempre en UTC; esto solo afecta a lo que se imprime por consola.
NTP_HOST = "pool.ntp.org"
UTC_OFFSET_S = -4 * 3600  # Bolivia

# ---------------------------------------------------------------------------
# Pines
# ---------------------------------------------------------------------------
# Restricciones del ESP32 que condicionan esta tabla:
#   - ADC2 no funciona con el WiFi activo -> la batería va por ADC1 (GPIO 32-39).
#   - GPIO 34, 35, 36 y 39 son SOLO ENTRADA -> perfectos para los ECHO.
#   - GPIO 0, 2, 5, 12 y 15 intervienen en el arranque -> no se usan.

PIN_TRIG_IZQ = 13
PIN_ECHO_IZQ = 34
PIN_TRIG_CENTRO = 14
PIN_ECHO_CENTRO = 35
PIN_TRIG_DER = 27
PIN_ECHO_DER = 39

PIN_BATERIA = 36  # ADC1, atenuación 11 dB
PIN_LED = 23  # con resistencia de 220 Ω

# --- Driver de motores ---
# Por defecto TB6612FNG. Para un L298N pon DRIVER = "l298n": entonces
# PWMA/PWMB son ENA/ENB, y AIN1/AIN2/BIN1/BIN2 son IN1..IN4. STBY no se usa.
DRIVER = "tb6612"

PIN_PWMA = 25  # motor izquierdo
PIN_AIN1 = 26
PIN_AIN2 = 33
PIN_PWMB = 32  # motor derecho
PIN_BIN1 = 18
PIN_BIN2 = 19
PIN_STBY = 4  # solo TB6612FNG

PWM_FREQ = 1000  # Hz

# Invierte el sentido de una rueda si está cableada al revés.
INVERTIR_IZQ = False
INVERTIR_DER = False

# Corrección por rueda para que avance recto: si se va hacia la derecha, baja FACTOR_IZQ.
FACTOR_IZQ = 1.0
FACTOR_DER = 1.0

# --- Reservados para el futuro (no se usan todavía) ---
# TODO: encoders en las ruedas -> odometría real en vez de dead reckoning.
PIN_ENCODER_IZQ = 16
PIN_ENCODER_DER = 17
# TODO: giroscopio MPU6050 por I2C -> corregir la deriva del ángulo.
PIN_I2C_SDA = 21
PIN_I2C_SCL = 22

# ---------------------------------------------------------------------------
# Calibración
# ---------------------------------------------------------------------------
# Mídelas con calibrar.py. Son los dos números de los que depende TODO el mapa:
# si están mal, la trayectoria dibujada no se parecerá a la real.

# Velocidad lineal de una rueda al 100 % de PWM, en cm/s.
VEL_MAX_CM_S = 22.0
# Distancia entre el centro de las dos ruedas, en cm.
DISTANCIA_RUEDAS_CM = 24.0
# Radio del chasis en cm: el haz del sensor nace en el borde, no en el centro.
RADIO_ROBOT_CM = 17.0

# --- Batería ---
# Divisor resistivo: V_bateria = V_adc * ((R1 + R2) / R2).
# Con R1 = 100 kΩ y R2 = 47 kΩ el factor es 3.13 y un pack de 8.4 V entrega 2.68 V al ADC.
BAT_R1 = 100_000
BAT_R2 = 47_000
# El ADC del ESP32 no es lineal en los extremos: ajusta este factor comparando la lectura
# con un multímetro, con la batería a media carga.
BAT_FACTOR_CORRECCION = 1.0
BAT_MIN_V = 6.6  # 2 celdas vacías
BAT_MAX_V = 8.4  # 2 celdas llenas

# ---------------------------------------------------------------------------
# Comportamiento por defecto
# ---------------------------------------------------------------------------
# Estos valores se sobrescriben con lo que llegue por el tópico `config` retenido;
# solo son el punto de partida mientras no haya conexión.
MODO = "detenido"  # 'automatico' | 'pausado' | 'detenido'
DISTANCIA_EVASION_CM = 15
DISTANCIA_PRECAUCION_CM = 30
VELOCIDAD_BASE_PCT = 60
INTERVALO_TELEMETRIA_MS = 200
ANGULOS_SENSORES = {"izq": -45, "centro": 0, "der": 45}

PASO_CONTROL_MS = 50  # periodo del bucle de control
WDT_TIMEOUT_MS = 8000  # watchdog
MAX_LECTURAS_DIFERIDAS = 100  # buffer sin conexión (1 por segundo)
