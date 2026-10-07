# Lectura de los 3 HC-SR04 y de la batería.
#
# Dos decisiones que importan:
#   - Los sensores se disparan SECUENCIALMENTE con una pausa entre ellos. Si se disparan a
#     la vez, el eco de uno entra por el receptor de otro ("crosstalk") y las lecturas salen
#     absurdas: un obstáculo fantasma a 7 cm en el sensor que mira al vacío.
#   - Se toma la MEDIANA de 3 medidas por sensor. Un eco perdido o un rebote raro da un valor
#     disparatado; la mediana lo descarta sin el retardo de promediar muchas muestras.
import machine
import time

import config

# Velocidad del sonido: 343 m/s = 0.0343 cm/µs. Ida y vuelta -> se divide entre 2.
CM_POR_US = 0.0343 / 2
# A 400 cm el eco tarda ~23 ms. Con 30 ms de margen el timeout no corta una lectura válida.
TIMEOUT_US = 30_000
PAUSA_ENTRE_SENSORES_MS = 25

DIST_MIN_CM = 2
DIST_MAX_CM = 400


class Ultrasonico:
    def __init__(self, pin_trig, pin_echo):
        self.trig = machine.Pin(pin_trig, machine.Pin.OUT)
        # Sin pull: el ECHO llega por un divisor resistivo desde 5 V.
        self.echo = machine.Pin(pin_echo, machine.Pin.IN)
        self.trig.value(0)

    def _medir_una(self):
        """Una medición. Devuelve cm, o None si no vuelve eco dentro del timeout."""
        self.trig.value(0)
        time.sleep_us(2)
        self.trig.value(1)
        time.sleep_us(10)  # pulso de disparo de 10 µs, lo que pide el HC-SR04
        self.trig.value(0)
        try:
            us = machine.time_pulse_us(self.echo, 1, TIMEOUT_US)
        except OSError:
            # time_pulse_us lanza OSError si el pulso nunca empieza: nada delante.
            return None
        if us < 0:
            return None
        cm = us * CM_POR_US
        if cm < DIST_MIN_CM or cm > DIST_MAX_CM:
            return None
        return cm

    def medir(self, muestras=3):
        """Mediana de `muestras` medidas. None si ninguna devolvió eco."""
        valores = []
        for _ in range(muestras):
            v = self._medir_una()
            if v is not None:
                valores.append(v)
            time.sleep_ms(5)
        if not valores:
            return None
        valores.sort()
        return round(valores[len(valores) // 2], 1)


class Sensores:
    def __init__(self):
        self.izq = Ultrasonico(config.PIN_TRIG_IZQ, config.PIN_ECHO_IZQ)
        self.centro = Ultrasonico(config.PIN_TRIG_CENTRO, config.PIN_ECHO_CENTRO)
        self.der = Ultrasonico(config.PIN_TRIG_DER, config.PIN_ECHO_DER)
        self._orden = (self.izq, self.centro, self.der)
        self._siguiente = 0
        self._ultimas = [None, None, None]
        self._ultimo_disparo = time.ticks_ms()

        self.adc = machine.ADC(machine.Pin(config.PIN_BATERIA))
        self.adc.atten(machine.ADC.ATTN_11DB)  # rango 0–3.3 V aprox.
        self.divisor = (config.BAT_R1 + config.BAT_R2) / config.BAT_R2

    def leer_todas(self):
        """
        Las tres distancias de golpe. Bloquea ~100 ms: úsalo solo al arrancar o en calibrar.py;
        el bucle de control usa actualizar().
        """
        resultado = []
        for s in self._orden:
            resultado.append(s.medir())
            time.sleep_ms(PAUSA_ENTRE_SENSORES_MS)
        return resultado

    def actualizar(self):
        """
        Dispara UN sensor por llamada, rotando. Con el bucle de control a 50 ms, los tres se
        refrescan cada 150 ms sin que ninguna iteración se bloquee los 100 ms que costaría
        leerlos los tres seguidos.
        """
        ahora = time.ticks_ms()
        if time.ticks_diff(ahora, self._ultimo_disparo) >= PAUSA_ENTRE_SENSORES_MS:
            i = self._siguiente
            self._ultimas[i] = self._orden[i].medir(muestras=1)
            self._siguiente = (i + 1) % 3
            self._ultimo_disparo = ahora
        return tuple(self._ultimas)

    def bateria_v(self):
        """Voltaje del pack, promediando 10 muestras del ADC."""
        total = 0
        for _ in range(10):
            total += self.adc.read_uv()  # µV, ya con la calibración de fábrica aplicada
            time.sleep_us(200)
        v_adc = total / 10 / 1_000_000
        return round(v_adc * self.divisor * config.BAT_FACTOR_CORRECCION, 2)

    def bateria_pct(self, voltios=None):
        v = self.bateria_v() if voltios is None else voltios
        pct = (v - config.BAT_MIN_V) / (config.BAT_MAX_V - config.BAT_MIN_V) * 100
        return max(0, min(100, int(pct)))
