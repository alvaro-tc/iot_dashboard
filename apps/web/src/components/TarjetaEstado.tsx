// "Estado del robot": equivale a la tarjeta de Temperatura de la referencia.
// Fondo degradado según el estado, velocidad de cada rueda y LED virtual.
import { useEffect, useState } from 'react';
import { CONFIG_POR_DEFECTO, type Movimiento } from '@iot/shared';
import { NOMBRE_MOVIMIENTO } from '../lib/formato.ts';
import { useSocket, useUltimaLectura } from '../lib/socket.tsx';
import { Badge, Tarjeta } from './ui.tsx';

/** Degradado de fondo por estado, con versión desaturada para el tema oscuro. */
const FONDO: Record<Movimiento | 'atascado', string> = {
  avanzando: 'from-libre/25 to-libre/5 dark:from-libre/15 dark:to-transparent',
  girando_izq: 'from-precaucion/25 to-precaucion/5 dark:from-precaucion/15 dark:to-transparent',
  girando_der: 'from-precaucion/25 to-precaucion/5 dark:from-precaucion/15 dark:to-transparent',
  retrocediendo: 'from-precaucion/30 to-precaucion/5 dark:from-precaucion/20 dark:to-transparent',
  detenido: 'from-tarjeta-tenue to-transparent',
  atascado: 'from-evasion/30 to-evasion/5 dark:from-evasion/20 dark:to-transparent',
};

/**
 * LED virtual: imita el patrón del LED físico descrito en firmware/led.py.
 *   fijo        en movimiento        1 Hz   pausado o detenido
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

/** Barra de velocidad de una rueda, centrada en cero: -100 % a 100 %. */
function BarraRueda({ etiqueta, pct }: { etiqueta: string; pct: number }) {
  const ancho = Math.min(50, Math.abs(pct) / 2); // % del contenedor, media anchura por lado
  return (
    <div>
      <div className="mb-1 flex justify-between text-[12px] text-tinta-suave">
        <span>{etiqueta}</span>
        <span className="tabular-nums text-tinta">{pct} %</span>
      </div>
      <div className="relative h-2 rounded-full bg-tarjeta-tenue">
        <span className="absolute inset-y-0 left-1/2 w-px bg-borde" aria-hidden />
        <span
          className={`absolute inset-y-0 rounded-full ${pct >= 0 ? 'bg-acento' : 'bg-precaucion'}`}
          style={pct >= 0 ? { left: '50%', width: `${ancho}%` } : { right: '50%', width: `${ancho}%` }}
        />
      </div>
    </div>
  );
}

export function TarjetaEstado() {
  const { config, estado, estadoRobot } = useSocket();
  const lectura = useUltimaLectura(3);
  const cfg = config ?? CONFIG_POR_DEFECTO;

  const distancias = [
    { sensor: 'izq' as const, d: lectura?.distIzqCm ?? null },
    { sensor: 'centro' as const, d: lectura?.distCentroCm ?? null },
    { sensor: 'der' as const, d: lectura?.distDerCm ?? null },
  ].filter((x) => x.d !== null) as { sensor: 'izq' | 'centro' | 'der'; d: number }[];
  const masCercano = distancias.length ? distancias.reduce((a, b) => (a.d <= b.d ? a : b)) : null;

  const evadiendo = !!masCercano && masCercano.d <= cfg.distanciaEvasionCm;
  const bateriaBaja = (lectura?.bateriaPct ?? 100) < 20;
  const movimiento = lectura?.movimiento ?? 'detenido';
  const atascado = evadiendo && distancias.length === 3 && distancias.every((x) => x.d <= cfg.distanciaEvasionCm);

  const patron = bateriaBaja
    ? 'doble'
    : evadiendo
      ? 'rapido'
      : cfg.modo === 'automatico'
        ? 'fijo'
        : 'lento';
  const led = useParpadeo(lectura ? patron : 'apagado');

  const conectado = estado === 'conectado' && !!estadoRobot?.enLinea;
  const fondo = FONDO[atascado ? 'atascado' : movimiento];

  return (
    <Tarjeta
      titulo="Estado del robot"
      subtitulo={`Modo ${cfg.modo}`}
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
        <BarraRueda etiqueta="Rueda izquierda" pct={lectura?.velIzqPct ?? 0} />
        <BarraRueda etiqueta="Rueda derecha" pct={lectura?.velDerPct ?? 0} />
      </div>
    </Tarjeta>
  );
}
