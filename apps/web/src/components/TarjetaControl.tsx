// Control del robot: todo lo que cambia algo de verdad (modo, distancia de evasión, ahorro
// de energía) vive aquí, fuera del panel de widgets. El panel es de solo vista; esto es lo
// contrario, el sitio donde se manda.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, Power, Square } from 'lucide-react';
import { CONFIG_POR_DEFECTO } from '@iot/shared';
import { useSocket } from '../lib/socket.tsx';
import { useColoresTema } from '../lib/tema.tsx';
import { useToast } from '../lib/toast.tsx';
import { Interruptor, Tarjeta } from './ui.tsx';

const MIN = 5;
const MAX = 50;
const AHORRO_MS = 1000;
const NORMAL_MS = 200;

/** Perfiles: evasión / precaución, en cm. */
const PERFILES = [
  { nombre: 'Cuidadoso', evasion: 25, precaucion: 45 },
  { nombre: 'Normal', evasion: 15, precaucion: 30 },
  { nombre: 'Ajustado', evasion: 8, precaucion: 18 },
];

/** Dial semicircular arrastrable para fijar la distancia de evasión. */
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
  const anguloDeFraccion = (f: number) => Math.PI + f * Math.PI;
  const punto = (f: number) => {
    const a = anguloDeFraccion(f);
    return { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) };
  };
  const fin = punto(fraccion);

  const desdeEvento = useCallback((ev: PointerEvent | React.PointerEvent) => {
    const caja = ref.current?.getBoundingClientRect();
    if (!caja) return null;
    const x = ((ev.clientX - caja.left) / caja.width) * 180;
    const y = ((ev.clientY - caja.top) / caja.height) * 100;
    let a = Math.atan2(y - CY, x - CX);
    if (a > 0 && a < Math.PI / 2) a = Math.PI;
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
      className={`w-full max-w-[220px] ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
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

export function TarjetaControl() {
  const { robotId, config, estadoRobot, enviarComando, actualizarConfig } = useSocket();
  const toast = useToast();
  const cfg = config ?? CONFIG_POR_DEFECTO;

  const [arrastre, setArrastre] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [enviando, setEnviando] = useState<string | null>(null);
  const valorEvasion = arrastre ?? cfg.distanciaEvasionCm;

  const guardarEvasion = async (evasion: number, precaucion?: number) => {
    setGuardando(true);
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

  const ahorro = (config?.intervaloTelemetriaMs ?? NORMAL_MS) >= AHORRO_MS;
  const cambiarAhorro = async (activo: boolean) => {
    const r = await actualizarConfig({ intervaloTelemetriaMs: activo ? AHORRO_MS : NORMAL_MS });
    if (!r.ok) toast(r.error ?? 'No se pudo cambiar el modo de ahorro.', 'error');
  };

  const comando = async (accion: 'iniciar' | 'pausar' | 'detener') => {
    setEnviando(accion);
    const r = await enviarComando(accion);
    setEnviando(null);
    if (!r.ok) toast(r.error ?? 'No se pudo enviar el comando.', 'error');
    else if (!r.confirmado) toast('Comando enviado, pero el robot no lo confirmó.', 'error');
  };

  const perfilActivo = PERFILES.find(
    (p) => p.evasion === cfg.distanciaEvasionCm && p.precaucion === cfg.distanciaPrecaucionCm,
  );

  return (
    <Tarjeta titulo="Control del robot" subtitulo={estadoRobot?.enLinea ? 'En línea' : 'Fuera de línea'}>
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn flex-1"
            disabled={!robotId || !!enviando}
            aria-busy={enviando === 'iniciar' || enviando === 'pausar'}
            onClick={() => comando(automatico ? 'pausar' : 'iniciar')}
          >
            {automatico ? <Pause className="size-4" /> : <Play className="size-4" />}
            {automatico ? 'Pausar' : 'Iniciar'}
          </button>
          <button
            type="button"
            className="btn flex-1"
            disabled={!robotId || !!enviando}
            aria-busy={enviando === 'detener'}
            onClick={() => comando('detener')}
          >
            <Square className="size-4" />
            Detener
          </button>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[14px] font-medium">
            <Power className="size-4 text-tinta-suave" />
            Modo automático
          </span>
          <Interruptor activo={automatico} onCambiar={cambiarAutomatico} etiqueta="Modo automático" disabled={!robotId} />
        </div>

        <div>
          <p className="mb-2 text-[14px] font-medium">Distancia de evasión</p>
          <div className="relative flex flex-col items-center">
            <Dial valor={valorEvasion} onArrastrar={setArrastre} onSoltar={(v) => guardarEvasion(v)} disabled={!robotId || guardando} />
            <div className="-mt-8 text-center">
              <p className="text-[28px] leading-none font-bold tabular-nums">{valorEvasion}</p>
              <p className="text-[13px] text-tinta-suave">cm · precaución a {cfg.distanciaPrecaucionCm} cm</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {PERFILES.map((p) => (
              <button
                key={p.nombre}
                type="button"
                className={`chip ${perfilActivo?.nombre === p.nombre ? 'chip-activo' : ''}`}
                disabled={!robotId}
                onClick={() => guardarEvasion(p.evasion, p.precaucion)}
              >
                {p.nombre}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-borde pt-4">
          <span className="text-[14px] font-medium">Ahorro de energía</span>
          <Interruptor activo={ahorro} onCambiar={cambiarAhorro} etiqueta="Ahorro de energía" disabled={!robotId} />
        </div>
      </div>
    </Tarjeta>
  );
}
