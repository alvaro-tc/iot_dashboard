# navegacion.py  --  evasion de obstaculos para la limpieza del modo lidar
#
# El firmware clasico NO decide nada: obedece al mando ESP-NOW. Aqui el robot va solo, asi que
# la maquina de estados de evasion tiene que vivir en el robot y no en el servidor: una orden
# que llega tarde por la red no puede ser lo que evite el golpe.
#
# Es la MISMA maquina que `decidir()` en packages/shared/src/simulacion.ts. Si se cambia una
# hay que cambiar la otra: es la duplicacion deliberada del proyecto (MicroPython no importa
# TypeScript), y es la que permite probar el comportamiento en el PC antes de subirlo.
#
#   camino libre          -> avanzar (mas despacio bajo precaucion)
#   central bloqueado     -> girar hacia el lado con mas espacio
#   un lado bloqueado     -> girar al contrario
#   los tres bloqueados   -> retroceder y despues girar

import configuracion as cfg

# Los mismos umbrales que packages/shared/src/robot.ts (DIST_EVASION_CM, DIST_PRECAUCION_CM).
DIST_EVASION_CM = 15
DIST_PRECAUCION_CM = 30

# Lo que dura un retroceso cuando no hay salida por delante.
RETROCESO_MS = 900

# Si lleva mas de esto girando sin despejar, esta en una esquina: toca retroceder.
GIRO_ATASCADO_MS = 3500

# Muy lejos: un eco que no vuelve no es un obstaculo, es sitio libre.
LEJOS = 10000


class Navegacion:

    def __init__(self):
        self.reiniciar(cfg.PWM_MAXIMO * 7 // 10)

    def reiniciar(self, velocidad_base):
        self.base = max(60, min(cfg.PWM_MAXIMO, int(velocidad_base)))
        self.maniobra_ms = 0
        self.girando = None
        self.ms_girando = 0

    def decidir(self, distancias, dt_ms):
        # El retroceso se completa entero: interrumpirlo deja al robot pegado al obstaculo.
        if self.maniobra_ms > 0:
            self.maniobra_ms -= dt_ms
            return (-self.base, -self.base)

        izq = distancias.get("izquierdo")
        centro = distancias.get("central")
        der = distancias.get("derecho")
        izq = LEJOS if izq is None else izq
        centro = LEJOS if centro is None else centro
        der = LEJOS if der is None else der

        giro = self.base * 8 // 10

        # Camino libre: se cancela el giro en curso y se avanza.
        if izq > DIST_EVASION_CM and centro > DIST_EVASION_CM and der > DIST_EVASION_CM:
            self.girando = None
            self.ms_girando = 0
            cerca = min(izq, centro, der) <= DIST_PRECAUCION_CM
            velocidad = self.base // 2 if cerca else self.base
            return (velocidad, velocidad)

        # Los tres bloqueados: no hay por donde salir hacia adelante.
        if izq <= DIST_EVASION_CM and centro <= DIST_EVASION_CM and der <= DIST_EVASION_CM:
            self.maniobra_ms = RETROCESO_MS
            self.girando = None
            self.ms_girando = 0
            return (-self.base, -self.base)

        # Girando demasiado tiempo sin despejar: esquina. Retroceder y volver a empezar.
        if self.girando is not None:
            self.ms_girando += dt_ms
            if self.ms_girando > GIRO_ATASCADO_MS:
                self.maniobra_ms = RETROCESO_MS
                self.girando = None
                self.ms_girando = 0
                return (-self.base, -self.base)
        else:
            # El sentido se fija al empezar el giro y NO se reevalua en cada muestra: si no, el
            # robot oscila entre los dos lados delante de una pata de mesa y no sale nunca.
            if centro <= DIST_EVASION_CM:
                self.girando = "izquierda" if izq > der else "derecha"
            elif izq <= DIST_EVASION_CM:
                self.girando = "derecha"
            else:
                self.girando = "izquierda"
            self.ms_girando = 0

        if self.girando == "izquierda":
            return (-giro, giro)
        return (giro, -giro)


def demo():
    # Sin hardware: solo la maquina de estados. Vale en el PC con python3.
    nav = Navegacion()
    nav.reiniciar(180)

    # Libre: avanza a tope y las dos ruedas igual (va recto).
    izq, der = nav.decidir({"izquierdo": 90, "central": 120, "derecho": 80}, 50)
    assert izq == der == 180, (izq, der)

    # Precaucion: mismo sentido pero mas despacio.
    izq, der = nav.decidir({"izquierdo": 90, "central": 25, "derecho": 80}, 50)
    assert izq == der == 90, (izq, der)

    # Central bloqueado con mas sitio a la izquierda: gira a la izquierda (ruedas opuestas).
    izq, der = nav.decidir({"izquierdo": 90, "central": 10, "derecho": 20}, 50)
    assert izq < 0 < der, (izq, der)

    # Y mantiene el sentido mientras siga bloqueado, aunque las lecturas bailen.
    izq2, der2 = nav.decidir({"izquierdo": 18, "central": 9, "derecho": 95}, 50)
    assert (izq2 < 0) == (izq < 0), "el sentido del giro no debe cambiar a media maniobra"

    # Los tres pegados: retrocede, y el retroceso se completa.
    nav.reiniciar(180)
    izq, der = nav.decidir({"izquierdo": 8, "central": 7, "derecho": 9}, 50)
    assert izq == der == -180, (izq, der)
    izq, der = nav.decidir({"izquierdo": 200, "central": 200, "derecho": 200}, 50)
    assert izq == der == -180, "el retroceso no se interrumpe aunque se despeje"

    # Sin eco no es obstaculo: es sitio libre.
    nav.reiniciar(180)
    izq, der = nav.decidir({"izquierdo": None, "central": None, "derecho": None}, 50)
    assert izq == der == 180, (izq, der)

    print("ok: la maquina de evasion se comporta")


if __name__ == "__main__":
    demo()
