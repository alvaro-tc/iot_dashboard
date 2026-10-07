import { computeTerm } from '@iot/shared';
import type { ReactNode } from 'react';

const W = 480;
const H = 260;
const N = 48;

// Sumas parciales de Leibniz oscilando hacia π, calculadas con la misma función que el simulador.
const PATH = (() => {
  let acc = 0;
  const pts: string[] = [];
  for (let k = 1; k <= N; k++) {
    acc = computeTerm('pi_leibniz', k, acc).acc;
    const x = 16 + ((k - 1) * (W - 32)) / (N - 1);
    const y = H / 2 - (acc - Math.PI) * ((H / 2 - 16) / 0.86);
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return 'M' + pts.join(' L');
})();

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="grid min-h-screen min-[900px]:grid-cols-[1.1fr_1fr]">
      <section className="ink-paper relative flex flex-col justify-between overflow-hidden p-8 text-white min-[900px]:p-12" aria-hidden>
        <div>
          <p className="font-mono text-[12px] tracking-[0.18em] text-signal uppercase">π · ln 2 · γ · π²/6</p>
          <p className="mt-3 text-[28px] leading-[1.15] font-medium min-[900px]:text-[32px]">
            Primera
            <br />
            Evaluación IoT
          </p>
        </div>
        <div className="my-8">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[480px]">
            <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="#1B9E77" strokeOpacity={0.45} strokeDasharray="4 4" />
            <text x={W - 4} y={H / 2 - 6} textAnchor="end" fill="#1B9E77" fillOpacity={0.8} fontFamily="IBM Plex Mono" fontSize={12}>
              π = 3.1415926536
            </text>
            <path d={PATH} pathLength={1} className="leibniz-draw" fill="none" stroke="#1B9E77" strokeWidth={1.5} />
          </svg>
        </div>
        <p className="max-w-sm text-[13px] leading-relaxed text-white/60">
          Series de aproximación enviadas por ESP32-S3, medidas iteración a iteración.
        </p>
      </section>
      <section className="flex items-center justify-center bg-paper p-6 min-[900px]:p-12">
        <div className="panel w-full max-w-[380px] rounded-[6px] p-7 shadow-[0_1px_2px_rgb(22_50_79/0.06),0_12px_32px_-12px_rgb(22_50_79/0.18)] min-[900px]:p-8">
          <h1 className="text-[24px] leading-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[13px] text-ink-soft">{subtitle}</p>}
          <div className="mt-6">{children}</div>
          <p className="mt-6 border-t border-grid pt-4 text-[13px] text-ink-soft">{footer}</p>
        </div>
      </section>
    </div>
  );
}
