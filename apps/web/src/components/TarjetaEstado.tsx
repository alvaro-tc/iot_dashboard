// "Estado del robot": fondo degradado según lo que esté haciendo, PWM de cada rueda y LED
// virtual. El movimiento no es un campo de la lectura: se deduce del PWM de las dos ruedas.
import { useEffect, useState } from 'react';
import {
  DIST_EVASION_CM,
  PWM_MAX,
  SENSORES_DE,
  movimiento as movimientoDe,
  type Movimiento,
  type Sensor,
} from '@iot/shared';
import { NOMBRE_MOVIMIENTO, pwm } from '../lib/formato.ts';
import { useSocket, useUltimaLectura } from '../lib/socket.tsx';
import { Badge, Tarjeta } from './ui.tsx';

/** Degradado de fondo por estado, con versión desaturada para el tema oscuro. */
const FONDO: Record<Movimiento | 'atascado', string> = {
  avanzando: 'from-libre/25 to-libre/5 dark:from-libre/15 dark:to-transparent',
  girando_izquierda: 'from-precaucion/25 to-precaucion/5 dark:from-precaucion/15 dark:to-transparent',
  girando_derecha: 'from-precaucion/25 to-precaucion/5 dark:from-precaucion/15 dark:to-transparent',
  retrocediendo: 'from-precaucion/30 to-precaucion/5 dark:from-precaucion/20 dark:to-transparent',
  detenido: 'from-tarjeta-tenue to-transparent',
  atascado: 'from-evasion/30 to-evasion/5 dark:from-evasion/20 dark:to-transparent',
};

/**
 * LED virtual: imita el patrón del LED físico del robot.
 *   fijo        en movimiento        1 Hz   detenido
 *   4 Hz        evadiendo            doble  batería baja
 */
function useParpadeo(patron: 'fijo' | 'lento' | 'rapido' | 'doble' | 'apagado'): boolean {
  const [encendido, setEncendido] = useState(true);
  useEffect(() => {
    if (patron === 'fijo') return setEncendido(true);
    if (patron === 'apagado') return setEncendido(false);
    const periodo = patron === 'rapido' ? 125 : patron === 'lento' ? 500 : 2000;
    if (patron === 'doble') {
      // Dos destellos cortos y una pausa larga, en un ciclo de 2 s.
      const id = setInterval(() => {
        const t = Date.now() % periodo;
        setEncendido(t < 120 || (t > 240 && t < 360));
      }, 60);
      return () => clearInterval(id);
    }
    const id = setInterval(() => setEncendido((v) => !v), periodo);
    return () => clearInterval(id);
  }, [patron]);
  return encendido;
}

/**
 * Barra del PWM de una rueda, centrada en cero: de -255 a 255. El signo es el sentido de
 * giro, así que la barra crece a la derecha al avanzar y a la izquierda al retroceder.
 */
function BarraRueda({ etiqueta, valor }: { etiqueta: string; valor: number }) {
  const ancho = (Math.min(PWM_MAX, Math.abs(valor)) / PWM_MAX) * 50; // media anchura por lado
  return (
    <div>
      <div className="mb-1 flex justify-between text-[12px] text-tinta-suave">
        <span>{etiqueta}</span>
        <span className="tabular-nums text-tinta">{pwm(valor)}</span>
      </div>
      <div className="relative h-2 rounded-full bg-tarjeta-tenue">
        <span className="absolute inset-y-0 left-1/2 w-px bg-borde" aria-hidden />
        <span
          className={`absolute inset-y-0 rounded-full ${valor >= 0 ? 'bg-acento' : 'bg-precaucion'}`}
          style={valor >= 0 ? { left: '50%', width: `${ancho}%` } : { right: '50%', width: `${ancho}%` }}
        />
      </div>
    </div>
  );
}

export function TarjetaEstado() {
  const { estado, estadoRobot } = useSocket();
  const lectura = useUltimaLectura(3);

  const distancias = (lectura ? SENSORES_DE(lectura) : []).filter((x) => x.d !== null) as {
    sensor: Sensor;
    d: number;
  }[];
  const masCercano = distancias.length ? distancias.reduce((a, b) => (a.d <= b.d ? a : b)) : null;

  const evadiendo = !!masCercano && masCercano.d <= DIST_EVASION_CM;
  const bateriaBaja = (lectura?.bateriaPorcentaje ?? 100) < 20;
  const movimiento = lectura ? movimientoDe(lectura.movimientoIzquierda, lectura.movimientoDerecha) : 'detenido';
  const atascado = evadiendo && distancias.length === 3 && distancias.every((x) => x.d <= DIST_EVASION_CM);

  const patron = bateriaBaja ? 'doble' : evadiendo ? 'rapido' : movimiento === 'detenido' ? 'lento' : 'fijo';
  const led = useParpadeo(lectura ? patron : 'apagado');

  const conectado = estado === 'conectado' && !!estadoRobot?.enLinea;
  const fondo = FONDO[atascado ? 'atascado' : movimiento];

  return (
    <Tarjeta
      titulo="Estado del robot"
      subtitulo={masCercano ? `Obstáculo más cercano a ${masCercano.d.toFixed(0)} cm` : 'Camino libre'}
      className={`bg-gradient-to-br ${fondo}`}
      accion={
        <span
          className={`size-4 rounded-full transition-opacity duration-100 ${led ? 'bg-acento shadow-[0_0_12px_var(--color-acento)]' : 'bg-borde'}`}
          role="img"
          aria-label={`LED del robot: ${led ? 'encendido' : 'apagado'}`}
        />
      }
    >
      <p className="text-[26px] leading-tight font-bold">
        {atascado ? 'Atascado' : NOMBRE_MOVIMIENTO[movimiento]}
      </p>

      <div className="mt-3">
        <Badge tono={conectado ? 'ok' : 'neutro'}>{conectado ? 'Conectado' : 'Desconectado'}</Badge>
      </div>

      <div className="mt-4 space-y-3">
        <BarraRueda etiqueta="Rueda izquierda" valor={lectura?.movimientoIzquierda ?? 0} />
        <BarraRueda etiqueta="Rueda derecha" valor={lectura?.movimientoDerecha ?? 0} />
      </div>
    </Tarjeta>
  );
}
