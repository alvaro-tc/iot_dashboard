# Circuito del nodo

Nodo IoT: **ESP32 DevKit v1** con MicroPython, 3 sensores ultrasónicos HC-SR04, lectura de
batería por ADC, un LED de estado y dos motorreductores con driver de puente H.

> Los modelos concretos de motorreductor y de driver están **pendientes de definir**. Los
> valores de `firmware/config.example.py` son provisionales y todos los pines son
> configurables.

## Tabla de conexiones

| Función | Pin ESP32 | Notas |
|---|---|---|
| HC-SR04 izquierdo (−45°) TRIG / ECHO | GPIO 13 / GPIO 34 | ECHO por divisor |
| HC-SR04 central (0°) TRIG / ECHO | GPIO 14 / GPIO 35 | ECHO por divisor |
| HC-SR04 derecho (+45°) TRIG / ECHO | GPIO 27 / GPIO 39 | ECHO por divisor |
| Batería (ADC1, atenuación 11 dB) | GPIO 36 | Divisor resistivo |
| LED de estado | GPIO 23 | En serie con 220 Ω |
| TB6612FNG motor izq. PWMA / AIN1 / AIN2 | GPIO 25 / 26 / 33 | |
| TB6612FNG motor der. PWMB / BIN1 / BIN2 | GPIO 32 / 18 / 19 | |
| TB6612FNG STBY | GPIO 4 | A nivel alto para habilitar |
| *Reservado*: encoders | GPIO 16 / 17 | Sin usar todavía |
| *Reservado*: I2C del giroscopio | GPIO 21 SDA / 22 SCL | Sin usar todavía |

## Restricciones del ESP32 que condicionan la tabla

Estas tres reglas son la razón de que los pines sean estos y no otros:

1. **ADC2 no funciona con el WiFi activo.** El driver de radio se apropia de ese bloque. La
   batería tiene que leerse por **ADC1**, es decir GPIO 32–39. Por eso va en el 36.
2. **GPIO 34, 35, 36 y 39 son solo de entrada.** No tienen driver de salida ni resistencias
   internas de pull. Son inservibles para TRIG, pero perfectos para los **ECHO**.
3. **GPIO 0, 2, 5, 12 y 15 intervienen en el arranque.** Un nivel equivocado en uno de ellos
   al encender deja la placa en modo de descarga o impide que arranque. No se usan.

## Divisor del ECHO (obligatorio)

El HC-SR04 se alimenta a 5 V y su pin ECHO entrega **5 V**. Los GPIO del ESP32 son de 3.3 V
y **no son tolerantes a 5 V**: conectarlo directo degrada el pin y acaba por romperlo.

Con R1 = 1 kΩ y R2 = 2 kΩ:

```
V_esp32 = 5 V × R2 / (R1 + R2) = 5 × 2000 / 3000 = 3.33 V
```

```
HC-SR04 ECHO ──[ R1 1kΩ ]──┬── GPIO 34 / 35 / 39 (ESP32)
                           │
                        [ R2 2kΩ ]
                           │
                          GND
```

Hacen falta **tres divisores**, uno por sensor. El TRIG no necesita nada: 3.3 V superan el
umbral de entrada del HC-SR04.

## Divisor de la batería

Pack de 2 celdas Li-ion: 6.6 V vacío, 8.4 V lleno. El ADC con atenuación de 11 dB admite
hasta unos 3.3 V, así que hay que dividir.

Con R1 = 100 kΩ y R2 = 47 kΩ:

```
factor  = (R1 + R2) / R2 = 147 / 47 = 3.13
V_adc   = 8.4 / 3.13 = 2.68 V   ← dentro de rango, con margen
```

```
BAT + ──[ R1 100kΩ ]──┬── GPIO 36 (ADC1)
                      │
                   [ R2 47kΩ ]
                      │
                     GND ── BAT −
```

El ADC del ESP32 **no es lineal en los extremos**, sobre todo por debajo de 0.15 V y por
encima de 3.1 V. `sensores.py` usa `read_uv()`, que ya aplica la calibración de fábrica, y
queda `BAT_FACTOR_CORRECCION` en `config.py` para ajustar comparando con un multímetro.
Hazlo con la batería a media carga, que es donde el ADC es más fiable:
`calibrar.bateria()`.

## Motores: TB6612FNG

```
            ┌──────── TB6612FNG ────────┐
GPIO 25 ───→│ PWMA              AO1 ────┼──→ motor izquierdo
GPIO 26 ───→│ AIN1              AO2 ────┼──→
GPIO 33 ───→│ AIN2                      │
GPIO 32 ───→│ PWMB              BO1 ────┼──→ motor derecho
GPIO 18 ───→│ BIN1              BO2 ────┼──→
GPIO 19 ───→│ BIN2                      │
GPIO  4 ───→│ STBY                      │
   3.3 V ──→│ VCC               VM ─────┼──← batería de motores (6–12 V)
    GND ───→│ GND               GND ────┼──→ GND común
            └───────────────────────────┘
```

Tabla de sentido (por motor):

| IN1 | IN2 | PWM | Resultado |
|---|---|---|---|
| 1 | 0 | 0–100 % | Adelante |
| 0 | 1 | 0–100 % | Atrás |
| 1 | 1 | — | Freno |
| 0 | 0 | — | Libre (rueda por inercia) |

`motores.py` usa freno (1/1) al detener: así el robot para donde se le dice y la odometría
no cuenta un deslizamiento que no midió.

## Variante con L298N

Cambia `DRIVER = "l298n"` en `config.py`. La correspondencia es directa:

| TB6612FNG | L298N |
|---|---|
| PWMA | ENA |
| AIN1 / AIN2 | IN1 / IN2 |
| PWMB | ENB |
| BIN1 / BIN2 | IN3 / IN4 |
| STBY | *(no existe)* |

Si usas un L298N, quita los jumpers de ENA y ENB para poder meterles PWM. Ten en cuenta que
el L298N cae ~2 V en sus transistores: con 7.4 V de entrada, a los motores les llegan ~5.4 V.
Por eso el TB6612FNG es preferible.

## Alimentación

```
   Batería motores (6–12 V) ──→ VM del driver
                            └─→ regulador 5 V ──→ VIN del ESP32
                            
   GND de la batería ──┬── GND del driver
                       ├── GND del ESP32
                       └── GND de los HC-SR04
```

Dos reglas que no se pueden saltar:

- **Tierras comunes.** Sin GND compartido entre la lógica y la potencia, las señales no
  tienen referencia y el robot hace cosas aleatorias.
- **Alimentación separada para los motores.** Un motorreductor al arrancar pide un pico de
  corriente que hunde la tensión; si el ESP32 cuelga de la misma línea, se reinicia. Un
  condensador de 470 µF entre VM y GND ayuda a absorber esos picos.

## PWM

A **1 kHz** (`PWM_FREQ`). Por debajo de 20 Hz el movimiento da tirones; muy por encima de
unos pocos kHz, algunos puentes H pierden rendimiento y los motores pequeños chillan. 1 kHz
es el punto habitual para motorreductores de este tamaño.

## Patrones del LED

| Patrón | Significado |
|---|---|
| Encendido fijo | En movimiento (modo automático) |
| Parpadeo lento (1 Hz) | Pausado o detenido |
| Parpadeo rápido (4 Hz) | Evadiendo un obstáculo |
| Doble parpadeo cada 2 s | Batería por debajo del 20 % |
| Parpadeo muy rápido | Conectando a WiFi o MQTT |

La prioridad es: batería baja > evasión > modo. Lo urgente tapa a lo informativo.

El dashboard dibuja un **LED virtual** con estos mismos patrones en la tarjeta «Estado del
robot», para poder comprobar a distancia lo que se ve en el robot.

## Disposición de los sensores

```
            centro (0°)
                │
       izq      │      der
      (−45°)    │    (+45°)
         ╲      │      ╱
          ╲     │     ╱
           ╲    │    ╱
          ┌─────┴─────┐
          │   FRENTE  │
     ████ │           │ ████   ← ruedas con motorreductor
          │  chasis   │
          └─────┬─────┘
             rueda loca
```

Los ángulos se configuran en `ANGULOS_SENSORES` y viajan también en la configuración del
servidor: el mapa los usa para proyectar cada obstáculo desde la pose del robot, así que
tienen que coincidir con el montaje real o los puntos rojos aparecerán girados.
