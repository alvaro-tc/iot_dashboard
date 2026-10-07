// "Distancia de evasión": equivale a la tarjeta del aire acondicionado de la referencia.
// Dial semicircular interactivo de 5 a 50 cm, con perfiles predefinidos.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Gauge, Ruler, SlidersHorizontal } from 'lucide-react';
import { CONFIG_POR_DEFECTO } from '@iot/shared';
import { useSocket } from '../lib/socket.tsx';
import { useColoresTema } from '../lib/tema.tsx';
import { useToast } from '../lib/toast.tsx';
import { Chip, Interruptor, Tarjeta } from './ui.tsx';

const MIN = 5;
const MAX = 50;

/** Perfiles: evasión / precaución, en cm. */
const PERFILES = [
  { nombre: 'Cuidadoso', evasion: 25, precaucion: 45 },
  { nombre: 'Normal', evasion: 15, precaucion: 30 },
  { nombre: 'Ajustado', evasion: 8, precaucion: 18 },
];

/**
 * Dial semicircular arrastrable. Es SVG y no Chart.js: hace falta interacción con el
 * puntero y teclado, y un arco con un pomo es más directo dibujarlo a mano.
 */
function Dial({
  valor,
  onArrastrar,
  onSoltar,
  disabled,
}: {
  valor: number;
  onArrastrar: (v: number) => void;
  onSoltar: (v: number) => void;
  disabled?: boolean;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const arrastrando = useRef(false);
  const colores = useColoresTema();

  const R = 70;
  const CX = 90;
  const CY = 82;
  const fraccion = (valor - MIN) / (MAX - MIN);
  // Arco de 180°: 180° (izquierda) a 360° (derecha).
  const anguloDeFraccion = (f: number) => Math.PI + f * Math.PI;
  const punto = (f: number) => {
    const a = anguloDeFraccion(f);
    return { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) };
  };
  const fin = punto(fraccion);

  const desdeEvento = useCallback((ev: PointerEvent | React.PointerEvent) => {
    const caja = ref.current?.getBoundingClientRect();
    if (!caja) return null;
    // Coordenadas del SVG (viewBox 180x100) desde las del puntero.
    const x = ((ev.clientX - caja.left) / caja.width) * 180;
    const y = ((ev.clientY - caja.top) / caja.height) * 100;
    let a = Math.atan2(y - CY, x - CX);
    if (a > 0 && a < Math.PI / 2) a = Math.PI; // por debajo del dial: se recorta al mínimo
    const f = Math.max(0, Math.min(1, (a - Math.PI) / Math.PI + (a < 0 ? 1 : 0)));
    return Math.round(MIN + f * (MAX - MIN));
  }, []);

  useEffect(() => {
    if (disabled) return;
    const mover = (ev: PointerEvent) => {
      if (!arrastrando.current) return;
      const v = desdeEvento(ev);
      if (v !== null) onArrastrar(v);
    };
    const soltar = (ev: PointerEvent) => {
      if (!arrastrando.current) return;
      arrastrando.current = false;
      const v = desdeEvento(ev);
      onSoltar(v ?? valor);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    return () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
    };
  }, [desdeEvento, onArrastrar, onSoltar, valor, disabled]);

  const porTeclado = (e: React.KeyboardEvent) => {
    const paso = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!paso) return;
    e.preventDefault();
    const v = Math.max(MIN, Math.min(MAX, valor + paso));
    onArrastrar(v);
    onSoltar(v);
  };

  return (
    <svg
      ref={ref}
      viewBox="0 0 180 100"
      className={`w-full max-w-[240px] ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="Distancia de evasión en centímetros"
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuenow={valor}
      aria-valuetext={`${valor} centímetros`}
      onKeyDown={porTeclado}
      onPointerDown={(e) => {
        if (disabled) return;
        arrastrando.current = true;
        const v = desdeEvento(e);
        if (v !== null) onArrastrar(v);
      }}
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
  const { config, actualizarConfig, robotId } = useSocket();
  const toast = useToast();
  const cfg = config ?? CONFIG_POR_DEFECTO;

  // Valor local mientras se arrastra: el servidor solo se entera al soltar.
  const [arrastre, setArrastre] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);
  const valor = arrastre ?? cfg.distanciaEvasionCm;

  const guardar = async (evasion: number, precaucion?: number) => {
    setGuardando(true);
    // La precaución debe quedar siempre por fuera de la evasión: si el dial la alcanza,
    // se empuja hacia afuera en vez de dejar que el backend rechace el cambio.
    const nuevaPrecaucion = precaucion ?? Math.max(cfg.distanciaPrecaucionCm, evasion + 5);
    const r = await actualizarConfig({ distanciaEvasionCm: evasion, distanciaPrecaucionCm: nuevaPrecaucion });
    setGuardando(false);
    setArrastre(null);
    if (!r.ok) toast(r.error ?? 'No se pudo guardar la configuración.', 'error');
    else toast(`Evasión a ${evasion} cm. El robot ya la recibió.`);
  };

  const automatico = cfg.modo === 'automatico';
  const cambiarAutomatico = async (activo: boolean) => {
    const r = await actualizarConfig({ modo: activo ? 'automatico' : 'pausado' });
    if (!r.ok) toast(r.error ?? 'No se pudo cambiar el modo.', 'error');
  };

  const perfilActivo = PERFILES.find(
    (p) => p.evasion === cfg.distanciaEvasionCm && p.precaucion === cfg.distanciaPrecaucionCm,
  );
  const ang = cfg.angulosSensores;

  return (
    <Tarjeta
      titulo="Distancia de evasión"
      subtitulo={guardando ? 'Enviando al robot…' : `Precaución a ${cfg.distanciaPrecaucionCm} cm`}
      accion={
        <div className="flex items-center gap-2">
          <span className="hidden text-[13px] text-tinta-suave sm:inline">Automático</span>
          <Interruptor
            activo={automatico}
            onCambiar={cambiarAutomatico}
            etiqueta="Modo automático"
            disabled={!robotId}
          />
        </div>
      }
      pie={
        <>
          {PERFILES.map((p) => (
            <Chip
              key={p.nombre}
              icono={<SlidersHorizontal className="size-3.5" />}
              activo={perfilActivo?.nombre === p.nombre}
              onClick={() => guardar(p.evasion, p.precaucion)}
              disabled={!robotId}
            >
              {p.nombre}
            </Chip>
          ))}
          <Chip icono={<Ruler className="size-3.5" />}>
            {ang.izq}° / {ang.centro}° / {ang.der}°
          </Chip>
          <Chip icono={<Gauge className="size-3.5" />}>{cfg.velocidadBasePct} % vel.</Chip>
        </>
      }
    >
      <div className="relative flex flex-col items-center">
        <Dial
          valor={valor}
          onArrastrar={setArrastre}
          onSoltar={(v) => guardar(v)}
          disabled={!robotId || guardando}
        />
        <div className="-mt-10 text-center">
          <p className="text-[34px] leading-none font-bold tabular-nums">{valor}</p>
          <p className="text-[13px] text-tinta-suave">cm</p>
        </div>
      </div>
    </Tarjeta>
  );
}
