# Bucle principal del robot.
#
# Arranque: WiFi -> NTP -> MQTT -> llega la configuración retenida.
#
# Bucle de control (cada PASO_CONTROL_MS, 50 ms por defecto):
#   leer sensores -> decidir movimiento -> aplicar PWM -> actualizar odometría
#   -> actualizar LED -> check_msg()
#
# LA EVASIÓN OCURRE AQUÍ Y NO DEPENDE DE LA RED. Si se cae el WiFi, el robot sigue
# esquivando muebles; solo deja de publicar (y guarda hasta 100 lecturas para reenviarlas).
#
# Telemetría: cada INTERVALO_TELEMETRIA_MS (200 ms) se publica un JSON compacto con QoS 0.
# QoS 0 a propósito: una lectura perdida a 5 Hz no importa, y el ack de QoS 1 añadiría
# latencia justo en el camino que queremos rápido.
import gc
import json
import machine
import time

import config
import led as modulo_led
import movimiento as mov
from motores import Traccion
from mqtt_cliente import Mqtt
from odometria import Odometria
from red import Red, epoch_ms
from sensores import Sensores

# Configuración viva: arranca con la de config.py y se sobrescribe con la del servidor.
cfg = {
    "modo": config.MODO,
    "distancia_evasion_cm": config.DISTANCIA_EVASION_CM,
    "distancia_precaucion_cm": config.DISTANCIA_PRECAUCION_CM,
    "velocidad_base_pct": config.VELOCIDAD_BASE_PCT,
    "intervalo_telemetria_ms": config.INTERVALO_TELEMETRIA_MS,
    "angulos_sensores": config.ANGULOS_SENSORES,
}

# El servidor manda la configuración en camelCase (es la misma que usa el dashboard).
CLAVES_SERVIDOR = {
    "modo": "modo",
    "distanciaEvasionCm": "distancia_evasion_cm",
    "distanciaPrecaucionCm": "distancia_precaucion_cm",
    "velocidadBasePct": "velocidad_base_pct",
    "intervaloTelemetriaMs": "intervalo_telemetria_ms",
    "angulosSensores": "angulos_sensores",
}

luz = modulo_led.Led()
red = Red(luz)
sensores = Sensores()
traccion = Traccion()
odometria = Odometria()
maquina = mov.Movimiento(traccion)

seq = 0
diferidas = []  # lecturas guardadas mientras no hay conexión
ultima_diferida = 0
bateria_v = config.BAT_MAX_V


def aplicar_config(datos):
    """Aplica la configuración que llega del servidor por el tópico `config` retenido."""
    cambios = []
    for clave_servidor, clave_local in CLAVES_SERVIDOR.items():
        if clave_servidor in datos:
            cfg[clave_local] = datos[clave_servidor]
            cambios.append(clave_local)
    if cambios:
        print("[config]", ", ".join("{}={}".format(k, cfg[k]) for k in cambios))


def aplicar_comando(datos):
    global seq
    accion = datos.get("accion")
    if accion == "iniciar":
        cfg["modo"] = "automatico"
        # Nueva sesión: el origen del mapa vuelve a (0,0,0°) y el contador de secuencia a 0.
        odometria.reiniciar()
        maquina.reiniciar()
        seq = 0
    elif accion == "pausar":
        cfg["modo"] = "pausado"
    elif accion == "detener":
        cfg["modo"] = "detenido"
    else:
        return
    print("[cmd]", accion)
    mqtt.publicar("cmd/ack", {"id": datos.get("id"), "accion": accion}, qos=1)


def al_recibir(sufijo, datos):
    if sufijo == "config":
        aplicar_config(datos)
    elif sufijo == "cmd":
        aplicar_comando(datos)


mqtt = Mqtt(al_recibir)


def telemetria(distancias, estado):
    """JSON compacto: claves cortas para que el mensaje quepa holgado en un paquete."""
    x, y, th = odometria.pose()
    vi, vd = traccion.velocidades
    return {
        "seq": seq,
        "t": int(epoch_ms()),
        "d": list(distancias),
        "e": estado,
        "x": x,
        "y": y,
        "th": th,
        "vi": vi,
        "vd": vd,
        "bv": bateria_v,
        "rssi": red.rssi(),
    }


def enviar_rest(lote):
    """
    Modo alternativo MODO_ENVIO = "rest": lotes cada segundo directos por HTTP, sin broker.
    Es más lento y no recibe comandos; está para cubrir el caso de que haga falta demostrar
    la inserción por API REST sin MQTT de por medio.
    """
    try:
        import urequests

        cabeceras = {"Content-Type": "application/json"}
        if config.REST_TOKEN:
            cabeceras["Authorization"] = "Bearer " + config.REST_TOKEN
        r = urequests.post(
            config.REST_URL,
            data=json.dumps({"dispositivoId": config.ROBOT_ID, "lecturas": lote}),
            headers=cabeceras,
        )
        r.close()
        return True
    except Exception as e:  # noqa: BLE001
        print("[rest] fallo:", e)
        return False


def arrancar():
    luz.set(modulo_led.CONECTANDO)
    luz.actualizar()
    if red.conectar():
        red.sincronizar_hora(forzar=True)
        if config.MODO_ENVIO == "mqtt":
            mqtt.conectar()


arrancar()

wdt = machine.WDT(timeout=config.WDT_TIMEOUT_MS)

ultimo_paso = time.ticks_ms()
ultima_telemetria = time.ticks_ms()
ultimo_gc = time.ticks_ms()
ultima_bateria = time.ticks_ms()
ultimo_rest = time.ticks_ms()
lote_rest = []

print("[main] bucle de control en marcha, modo:", cfg["modo"])

while True:
    ahora = time.ticks_ms()
    dt_ms = time.ticks_diff(ahora, ultimo_paso)
    if dt_ms < config.PASO_CONTROL_MS:
        time.sleep_ms(2)
        continue
    ultimo_paso = ahora
    wdt.feed()

    # --- 1. Sensores (uno por paso, rotando: no bloquea el bucle) ---
    distancias = sensores.actualizar()

    # --- 2. Decidir y aplicar movimiento ---
    estado = maquina.paso(distancias, cfg, dt_ms)
    traccion.actualizar()  # rampa de aceleración

    # --- 3. Odometría con el PWM que se está aplicando de verdad ---
    vi, vd = traccion.velocidades
    odometria.actualizar(vi, vd, dt_ms / 1000.0)

    # --- 4. Batería (cada 2 s: leer el ADC 10 veces no es gratis) ---
    if time.ticks_diff(ahora, ultima_bateria) >= 2000:
        ultima_bateria = ahora
        bateria_v = sensores.bateria_v()

    # --- 5. LED ---
    evadiendo = estado in (mov.GIRANDO_IZQ, mov.GIRANDO_DER, mov.RETROCEDIENDO)
    bateria_baja = sensores.bateria_pct(bateria_v) < 20
    if config.MODO_ENVIO == "mqtt" and not mqtt.conectado:
        luz.set(modulo_led.CONECTANDO)
    else:
        luz.set(luz.patron_para(cfg["modo"], evadiendo, bateria_baja))
    luz.actualizar()

    # --- 6. Mensajes entrantes (no bloqueante) ---
    if config.MODO_ENVIO == "mqtt":
        mqtt.comprobar()

    # --- 7. Eventos que detecta el propio robot ---
    if maquina.ultima_evasion and mqtt.conectado:
        sensor, dist = maquina.ultima_evasion
        mqtt.publicar(
            "evento",
            {"tipo": "obstaculo", "sensor": sensor, "distancia_cm": dist, "mensaje": "Evasión local"},
            qos=1,
        )

    # --- 8. Telemetría ---
    if time.ticks_diff(ahora, ultima_telemetria) >= cfg["intervalo_telemetria_ms"]:
        ultima_telemetria = ahora
        seq += 1
        datos = telemetria(distancias, estado)

        if config.MODO_ENVIO == "rest":
            lote_rest.append(datos)
            if time.ticks_diff(ahora, ultimo_rest) >= 1000:
                ultimo_rest = ahora
                if lote_rest and enviar_rest(lote_rest):
                    lote_rest = []
        elif mqtt.conectado:
            mqtt.publicar("telemetria", datos, qos=0)
        else:
            # Sin conexión: se guarda 1 lectura por segundo, hasta 100. Guardarlas todas
            # llenaría la RAM del ESP32 en menos de un minuto.
            if time.ticks_diff(ahora, ultima_diferida) >= 1000:
                ultima_diferida = ahora
                diferidas.append(datos)
                if len(diferidas) > config.MAX_LECTURAS_DIFERIDAS:
                    diferidas.pop(0)

    # --- 9. Reconexión y reenvío de lo diferido ---
    if config.MODO_ENVIO == "mqtt" and not mqtt.conectado:
        if red.asegurar() and mqtt.conectar() and diferidas:
            # QoS 1: estas sí tienen que llegar, ya se perdió su momento en vivo.
            if mqtt.publicar("telemetria/lote", diferidas, qos=1):
                print("[main] reenviadas", len(diferidas), "lecturas diferidas")
                diferidas = []

    # --- 10. Mantenimiento ---
    if time.ticks_diff(ahora, ultimo_gc) >= 10_000:
        ultimo_gc = ahora
        gc.collect()
        red.sincronizar_hora()
