# boot.py  --  selector de modo del robot
#
# MicroPython ejecuta boot.py y DESPUES main.py, siempre. Eso es justo lo que hace falta aqui:
#
#   reset por software (Ctrl-D en el REPL, o machine.soft_reset())
#       -> este archivo arranca el modo LIDAR y no vuelve nunca (main_beta.main() es un bucle
#          infinito), asi que main.py no llega a ejecutarse.
#
#   encendido, boton EN, watchdog, cualquier otra causa
#       -> este archivo no hace nada y MicroPython sigue con main.py: el firmware CLASICO de
#          siempre, con el mando ESP-NOW, intacto.
#
# Por eso el modo nuevo no necesita tocar ni un archivo del firmware clasico ni escribir en la
# flash: la causa del reset ya lleva la informacion. Quitar y poner la corriente devuelve
# siempre al modo antiguo, que es la via de escape si el modo lidar se queda colgado.
#
# Para entrar en modo lidar:
#     mpremote connect COM5        y pulsar Ctrl-D
# Para volver al clasico:
#     desenchufar y enchufar, o pulsar el boton EN

import machine

if machine.reset_cause() == machine.SOFT_RESET:
    print("[boot] reset por software -> MODO LIDAR (firmware beta)")
    print("[boot] para volver al modo clasico: quitar y poner la corriente")
    try:
        import main_beta
        main_beta.main()
    except Exception as error:
        # Si el modo beta revienta, mejor caer al clasico que quedarse sin robot: no se
        # relanza nada, simplemente se deja que MicroPython siga con main.py.
        print("[boot] el modo lidar fallo:", error)
        print("[boot] siguiendo con el firmware clasico")
else:
    print("[boot] encendido o reset por hardware -> modo clasico (ESP-NOW)")
