# Máquina de estados de evasión.
#
# Esto corre EN EL ROBOT y no depende de la red: si se cae el WiFi, el Roomba sigue
# esquivando muebles igual. El servidor solo manda el modo y los umbrales.
#
# Es el espejo de packages/shared/src/simulacion.ts (el simulador y el seed usan esa versión
# en TypeScript). Si se cambia una, hay que cambiar la otra: MicroPython no puede importar TS.
#
# Reglas:
#   camino libre            -> avanzar (más lento bajo la distancia de precaución)
#   obstáculo al centro     -> girar hacia el lado con más espacio
#   obstáculo a un lado     -> girar al contrario
#   obstáculo en los tres   -> retroceder y luego girar
#
# Detalle que importa: el SENTIDO DEL GIRO se elige UNA VEZ y se mantiene hasta despejar.
# Recalculándolo en cada paso, el robot alterna izquierda/derecha y se queda bamboleándose
# contra una esquina sin salir nunca.

AVANZANDO = "avanzando"
GIRANDO_IZQ = "girando_izq"
GIRANDO_DER = "girando_der"
RETROCEDIENDO = "retrocediendo"
DETENIDO = "detenido"

MS_RETROCESO = 700
# Girando más de esto sin despejar = atascado: se retrocede para buscar otra salida.
MS_GIRO_MAXIMO = 3000
MS_RETROCESO_ATASCO = 900

INFINITO = 10_000  # un sensor sin eco es "nada delante", no "pared a 0 cm"


class Movimiento:
    def __init__(self, traccion):
        self.traccion = traccion
        self.estado = DETENIDO
        self.girando = None  # 'izq' | 'der' | None
        self._ms_retroceso = 0
        self._ms_girando = 0
        # Sensor que disparó la última evasión: main.py lo publica como evento.
        self.ultima_evasion = None

    def reiniciar(self):
        self.girando = None
        self._ms_retroceso = 0
        self._ms_girando = 0
        self.estado = DETENIDO

    def paso(self, distancias, cfg, dt_ms):
        """
        distancias: (izq, centro, der) en cm, None = sin objeto en rango.
        cfg: dict con modo, distancia_evasion_cm, distancia_precaucion_cm, velocidad_base_pct.
        """
        self.ultima_evasion = None

        if cfg["modo"] != "automatico":
            self.traccion.detener()
            self.reiniciar()  # deja el estado en DETENIDO y olvida la maniobra en curso
            return self.estado

        # Un retroceso en curso se completa entero: interrumpirlo deja al robot pegado.
        if self._ms_retroceso > 0:
            self._ms_retroceso -= dt_ms
            return self.estado

        evasion = cfg["distancia_evasion_cm"]
        precaucion = cfg["distancia_precaucion_cm"]
        base = cfg["velocidad_base_pct"]
        giro = int(base * 0.8)

        izq = INFINITO if distancias[0] is None else distancias[0]
        centro = INFINITO if distancias[1] is None else distancias[1]
        der = INFINITO if distancias[2] is None else distancias[2]

        bloq_izq = izq <= evasion
        bloq_centro = centro <= evasion
        bloq_der = der <= evasion

        # --- Camino libre ---
        if not (bloq_izq or bloq_centro or bloq_der):
            self.girando = None
            self._ms_girando = 0
            minimo = min(izq, centro, der)
            vel = int(base * 0.5) if minimo <= precaucion else base
            self.traccion.avanzar(vel)
            self.estado = AVANZANDO
            return self.estado

        # --- Atascado: lleva demasiado tiempo girando sin despejar ---
        self._ms_girando += dt_ms
        if self._ms_girando > MS_GIRO_MAXIMO:
            self._ms_girando = 0
            self.girando = None
            self.traccion.retroceder(base)
            self.estado = RETROCEDIENDO
            self._ms_retroceso = MS_RETROCESO_ATASCO
            return self.estado

        # --- Primera decisión de esta evasión ---
        if self.girando is None:
            if bloq_izq and bloq_centro and bloq_der:
                # Encerrado: retrocede primero, y al terminar elegirá sentido con sitio nuevo.
                self.traccion.retroceder(base)
                self.estado = RETROCEDIENDO
                self._ms_retroceso = MS_RETROCESO
                self.ultima_evasion = ("centro", centro)
                return self.estado
            if bloq_centro:
                self.girando = "izq" if izq > der else "der"  # hacia donde hay más espacio
                self.ultima_evasion = ("centro", centro)
            elif bloq_izq:
                self.girando = "der"  # obstáculo a un lado: gira al contrario
                self.ultima_evasion = ("izq", izq)
            else:
                self.girando = "izq"
                self.ultima_evasion = ("der", der)

        # --- Sigue girando en el sentido ya fijado ---
        if self.girando == "izq":
            self.traccion.girar_izq(giro)
            self.estado = GIRANDO_IZQ
        else:
            self.traccion.girar_der(giro)
            self.estado = GIRANDO_DER
        return self.estado


def demo():
    """
    Autocomprobación sin hardware: `python movimiento.py` en el PC.
    Si esto falla, el robot se bambolea o atraviesa muebles.
    """

    class TraccionFalsa:
        def __init__(self):
            self.izq = 0
            self.der = 0

        def set_ruedas(self, i, d):
            self.izq, self.der = i, d

        def avanzar(self, v):
            self.set_ruedas(v, v)

        def retroceder(self, v):
            self.set_ruedas(-abs(v), -abs(v))

        def girar_izq(self, v):
            self.set_ruedas(-abs(v), abs(v))

        def girar_der(self, v):
            self.set_ruedas(abs(v), -abs(v))

        def detener(self):
            self.set_ruedas(0, 0)

    cfg = {
        "modo": "automatico",
        "distancia_evasion_cm": 15,
        "distancia_precaucion_cm": 30,
        "velocidad_base_pct": 60,
    }
    t = TraccionFalsa()
    m = Movimiento(t)

    # Camino libre -> avanza a velocidad base.
    assert m.paso((None, None, None), cfg, 50) == AVANZANDO
    assert t.izq == 60 and t.der == 60, (t.izq, t.der)

    # Algo bajo la distancia de precaución -> avanza, pero más lento.
    assert m.paso((None, 25, None), cfg, 50) == AVANZANDO
    assert t.izq == 30, t.izq

    # Obstáculo al centro con más sitio a la izquierda -> gira a la izquierda.
    assert m.paso((80, 10, 20), cfg, 50) == GIRANDO_IZQ
    assert t.izq < 0 and t.der > 0
    assert m.ultima_evasion[0] == "centro"

    # El sentido se mantiene aunque ahora parezca mejor el otro lado.
    assert m.paso((10, 12, 90), cfg, 50) == GIRANDO_IZQ

    # Al despejar, vuelve a avanzar y se olvida del sentido.
    assert m.paso((None, None, None), cfg, 50) == AVANZANDO
    assert m.girando is None

    # Obstáculo solo a la izquierda -> gira a la derecha.
    assert m.paso((8, None, None), cfg, 50) == GIRANDO_DER
    assert m.ultima_evasion[0] == "izq"
    m.paso((None, None, None), cfg, 50)

    # Los tres bloqueados -> retrocede, y el retroceso no se interrumpe.
    assert m.paso((5, 5, 5), cfg, 50) == RETROCEDIENDO
    assert t.izq < 0 and t.der < 0
    assert m.paso((None, None, None), cfg, 50) == RETROCEDIENDO  # sigue retrocediendo

    # Girando sin despejar durante más de 3 s -> se da por atascado y retrocede.
    m2 = Movimiento(TraccionFalsa())
    estados = [m2.paso((10, 10, 90), cfg, 50) for _ in range(80)]
    assert RETROCEDIENDO in estados, "nunca detectó el atasco: giraría para siempre"

    # Modo pausado -> ruedas a cero.
    cfg["modo"] = "pausado"
    assert m.paso((None, None, None), cfg, 50) == DETENIDO
    assert t.izq == 0 and t.der == 0

    print("movimiento: evasión, bloqueo de sentido, atasco y pausa OK")


if __name__ == "__main__":
    demo()
