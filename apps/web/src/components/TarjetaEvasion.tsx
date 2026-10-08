// "Distancia de evasión": equivale a la tarjeta del aire acondicionado de la referencia.
// Dial semicircular de 5 a 50 cm. Es de solo vista: el valor se cambia desde el control del
// robot (/mapa); aquí solo se muestra dónde está ahora.
import { CONFIG_POR_DEFECTO } from '@iot/shared';
import { Gauge, Ruler } from 'lucide-react';
import { useSocket } from '../lib/socket.tsx';
import { useColoresTema } from '../lib/tema.tsx';
import { Chip, Tarjeta } from './ui.tsx';

const MIN = 5;
const MAX = 50;

/** Arco semicircular estático con un pomo en el valor actual. */
function Dial({ valor }: { valor: number }) {
  const colores = useColoresTema();
  const R = 70;
  const CX = 90;
  const CY = 82;
  const fraccion = (valor - MIN) / (MAX - MIN);
  // Arco de 180°: 180° (izquierda) a 360° (derecha).
  const a = Math.PI + fraccion * Math.PI;
  const fin = { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) };

  return (
    <svg
      viewBox="0 0 180 100"
      className="w-full max-w-[240px]"
      role="img"
      aria-label={`Distancia de evasión: ${valor} centímetros`}
    >
      <path
        d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
        fill="none"
        stroke={colores.borde}
        strokeWidth="10"
        strokeLinecap="round"
      />
      <path
        d={`M ${CX - R} ${CY} A ${R} ${R} 0 ${fraccion > 0.5 ? 1 : 0} 1 ${fin.x} ${fin.y}`}
        fill="none"
        stroke={colores.acento}
        strokeWidth="10"
        strokeLinecap="round"
      />
      <circle cx={fin.x} cy={fin.y} r="7" fill={colores.acento} stroke="#fff" strokeWidth="2.5" />
      <text x={CX - R} y={CY + 18} textAnchor="middle" fontSize="9" fill={colores.tintaSuave}>
        {MIN} cm
      </text>
      <text x={CX + R} y={CY + 18} textAnchor="middle" fontSize="9" fill={colores.tintaSuave}>
        {MAX} cm
      </text>
    </svg>
  );
}

export function TarjetaEvasion() {
  const { config } = useSocket();
  const cfg = config ?? CONFIG_POR_DEFECTO;
  const ang = cfg.angulosSensores;

  return (
    <Tarjeta
      titulo="Distancia de evasión"
      subtitulo={`Precaución a ${cfg.distanciaPrecaucionCm} cm`}
      pie={
        <>
          <Chip icono={<Ruler className="size-3.5" />}>
            {ang.izq}° / {ang.centro}° / {ang.der}°
          </Chip>
          <Chip icono={<Gauge className="size-3.5" />}>{cfg.velocidadBasePct} % vel.</Chip>
        </>
      }
    >
      <div className="relative flex flex-col items-center">
        <Dial valor={cfg.distanciaEvasionCm} />
        <div className="-mt-10 text-center">
          <p className="text-[34px] leading-none font-bold tabular-nums">{cfg.distanciaEvasionCm}</p>
          <p className="text-[13px] text-tinta-suave">cm</p>
        </div>
      </div>
    </Tarjeta>
  );
}
