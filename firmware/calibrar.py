# Calibración de la odometría. Ejecútalo en el ESP32 con el robot en el suelo y espacio
# libre delante:  import calibrar
#
# Mide los dos números de los que depende TODO el mapa:
#   VEL_MAX_CM_S         cm/s de una rueda al 100 % de PWM
#   DISTANCIA_RUEDAS_CM  separación entre las ruedas
#
# Si estos valores están mal, la trayectoria dibujada no se parecerá a la real por mucho que
# el resto del sistema funcione.
import time

import config
from motores import Traccion
from sensores import Sensores

SEGUNDOS_AVANCE = 5
SEGUNDOS_GIRO = 2


def _rampa(traccion, segundos):
    """Mantiene el objetivo aplicando la rampa, igual que el bucle de control."""
    fin = time.ticks_add(time.ticks_ms(), int(segundos * 1000))
    while time.ticks_diff(fin, time.ticks_ms()) > 0:
        traccion.actualizar()
        time.sleep_ms(50)


def avance():
    """
    El robot avanza 5 s al 100 %. Mide con una cinta métrica cuánto recorrió.
    VEL_MAX_CM_S = centímetros_medidos / 5
    """
    traccion = Traccion()
    print("Avanzando {} s al 100 %. Mide la distancia recorrida.".format(SEGUNDOS_AVANCE))
    time.sleep(2)  # tiempo para apartar la mano
    traccion.avanzar(100)
    _rampa(traccion, SEGUNDOS_AVANCE)
    traccion.detener()
    traccion.apagar()
    print("Listo. VEL_MAX_CM_S = distancia_en_cm /", SEGUNDOS_AVANCE)
    print("Valor actual en config.py:", config.VEL_MAX_CM_S)


def giro():
    """
    El robot gira sobre su eje 2 s al 100 %. Mide cuántos grados giró (marca el frente con
    cinta antes de empezar).

    Girando sobre el eje: grados = (2 · VEL_MAX_CM_S · t) / DISTANCIA_RUEDAS_CM · (180/π)
    Despejando:
        DISTANCIA_RUEDAS_CM = (2 · VEL_MAX_CM_S · t · 57.2958) / grados_medidos
    """
    traccion = Traccion()
    print("Girando {} s al 100 %. Mide los grados girados.".format(SEGUNDOS_GIRO))
    time.sleep(2)
    traccion.girar_der(100)
    _rampa(traccion, SEGUNDOS_GIRO)
    traccion.detener()
    traccion.apagar()
    constante = 2 * config.VEL_MAX_CM_S * SEGUNDOS_GIRO * 57.2958
    print("Listo. DISTANCIA_RUEDAS_CM = {:.1f} / grados_medidos".format(constante))
    print("Valor actual en config.py:", config.DISTANCIA_RUEDAS_CM)


def recto():
    """
    Comprueba si avanza recto. Si se desvía a la derecha, baja FACTOR_IZQ (o sube FACTOR_DER)
    en pasos de 0.02 y repite.
    """
    traccion = Traccion()
    print("Avanzando 3 s a la velocidad base. Mira si se desvía.")
    time.sleep(2)
    traccion.avanzar(config.VELOCIDAD_BASE_PCT)
    _rampa(traccion, 3)
    traccion.detener()
    traccion.apagar()
    print("FACTOR_IZQ =", config.FACTOR_IZQ, " FACTOR_DER =", config.FACTOR_DER)
    print("Se desvía a la derecha -> baja FACTOR_IZQ. A la izquierda -> baja FACTOR_DER.")


def bateria():
    """
    Compara la lectura del ADC con un multímetro y ajusta BAT_FACTOR_CORRECCION:
        BAT_FACTOR_CORRECCION = voltaje_real / voltaje_medido_aqui
    Hazlo con la batería a media carga: el ADC del ESP32 es menos lineal en los extremos.
    """
    s = Sensores()
    for _ in range(5):
        v = s.bateria_v()
        print("ADC -> {:.2f} V  ({} %)".format(v, s.bateria_pct(v)))
        time.sleep(1)
    print("BAT_FACTOR_CORRECCION = voltaje_del_multimetro / el_valor_de_arriba")


def sensores_vivo():
    """Imprime las 3 distancias en bucle: para comprobar el cableado y el divisor del ECHO."""
    s = Sensores()
    print("Ctrl-C para salir.")
    while True:
        print("izq={}  centro={}  der={}".format(*s.leer_todas()))
        time.sleep_ms(300)


print("calibrar.py — llama a una de estas:")
print("  calibrar.avance()        velocidad máxima (VEL_MAX_CM_S)")
print("  calibrar.giro()          separación entre ruedas (DISTANCIA_RUEDAS_CM)")
print("  calibrar.recto()         factores de corrección por rueda")
print("  calibrar.bateria()       factor del divisor de la batería")
print("  calibrar.sensores_vivo() comprobar los 3 HC-SR04")
