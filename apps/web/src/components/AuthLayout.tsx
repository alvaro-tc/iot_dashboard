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

export function AuthLayout({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="grid min-h-screen min-[900px]:grid-cols-2">
      <section className="ink-paper flex flex-col justify-between p-8 text-white min-[900px]:p-12" aria-hidden>
        <p className="text-[24px] leading-tight font-medium">
          Primera
          <br />
          Evaluación IoT
        </p>
        <div className="my-8">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[480px]">
            <line x1={0} x2={W} y1={H / 2} y2={H / 2} stroke="#1B9E77" strokeOpacity={0.45} strokeDasharray="4 4" />
            <text x={W - 4} y={H / 2 - 6} textAnchor="end" fill="#1B9E77" fillOpacity={0.8} fontFamily="IBM Plex Mono" fontSize={12}>
              π = 3.1415926536
            </text>
            <path d={PATH} pathLength={1} className="leibniz-draw" fill="none" stroke="#1B9E77" strokeWidth={1.5} />
          </svg>
        </div>
        <p className="max-w-sm text-[13px] text-white/60">
          Series de aproximación enviadas por ESP32-S3, medidas iteración a iteración.
        </p>
      </section>
      <section className="flex items-center bg-surface p-8 min-[900px]:p-12">
        <div className="w-full max-w-[360px]">
          <h1 className="mb-6 text-[24px]">{title}</h1>
          {children}
          <p className="mt-6 text-[13px] text-ink-soft">{footer}</p>
        </div>
      </section>
    </div>
  );
}
