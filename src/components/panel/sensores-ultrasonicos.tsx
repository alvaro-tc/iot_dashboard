"use client";

import { Tarjeta } from "@/components/comunes/tarjeta";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Rango útil del HC-SR04 en este montaje. */
const MIN_CM = 15;
const MAX_CM = 205;
/** Por debajo de esto la lectura es crítica, pase lo que pase con la config. */
const CRITICO_CM = 10;

type Sensor = {
  clave: "izq" | "frontal" | "der";
  etiqueta: string;
  /** Ángulo del abanico en grados; 0 es hacia arriba. */
  angulo: number;
  distancia: number;
  umbral: number;
  detecciones: number;
  colorBase: string;
};

function colorDe(distancia: number, umbral: number, base: string): string {
  if (distancia < CRITICO_CM) return "var(--critical)";
  if (distancia < umbral) return "var(--warn)";
  return base;
}

/** Punto sobre el abanico a una fracción del radio máximo. */
function punto(anguloGrados: number, radio: number): [number, number] {
  const rad = ((anguloGrados - 90) * Math.PI) / 180;
  return [140 + radio * Math.cos(rad), 172 + radio * Math.sin(rad)];
}

const R_MIN = 34;
const R_MAX = 150;

/**
 * Widget de los tres ultrasónicos: el acento visual del panel.
 * Cada barra radial crece con la distancia libre en esa dirección y se tiñe
 * de ámbar al cruzar el umbral de frenado configurado, de rojo bajo 10 cm.
 */
export function SensoresUltrasonicos({
  frontal,
  izquierda,
  derecha,
  umbralFrontal,
  umbralLateral,
  detecciones,
}: {
  frontal: number;
  izquierda: number;
  derecha: number;
  umbralFrontal: number;
  umbralLateral: number;
  detecciones: { izq: number; frontal: number; der: number };
}) {
  const sensores: Sensor[] = [
    {
      clave: "izq",
      etiqueta: "Izquierda",
      angulo: -52,
      distancia: izquierda,
      umbral: umbralLateral,
      detecciones: detecciones.izq,
      colorBase: "var(--sensor-izq)",
    },
    {
      clave: "frontal",
      etiqueta: "Frontal",
      angulo: 0,
      distancia: frontal,
      umbral: umbralFrontal,
      detecciones: detecciones.frontal,
      colorBase: "var(--sensor-frontal)",
    },
    {
      clave: "der",
      etiqueta: "Derecha",
      angulo: 52,
      distancia: derecha,
      umbral: umbralLateral,
      detecciones: detecciones.der,
      colorBase: "var(--sensor-der)",
    },
  ];

  return (
    <Tarjeta etiqueta="Sensores ultrasónicos" className="h-full">
      <svg
        viewBox="0 0 280 190"
        className="w-full"
        role="img"
        aria-label={`Distancias: izquierda ${num(izquierda)} centímetros, frontal ${num(frontal)} centímetros, derecha ${num(derecha)} centímetros`}
      >
        {/* Arcos de referencia cada 50 cm. */}
        {[50, 100, 150, 200].map((cm) => {
          const r = R_MIN + ((cm - MIN_CM) / (MAX_CM - MIN_CM)) * (R_MAX - R_MIN);
          const [x1, y1] = punto(-68, r);
          const [x2, y2] = punto(68, r);
          return (
            <path
              key={cm}
              d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`}
              fill="none"
              stroke="var(--border)"
              strokeWidth={1}
            />
          );
        })}

        {sensores.map((s) => {
          const recortada = Math.max(MIN_CM, Math.min(MAX_CM, s.distancia));
          const rValor =
            R_MIN + ((recortada - MIN_CM) / (MAX_CM - MIN_CM)) * (R_MAX - R_MIN);
          const [xi, yi] = punto(s.angulo, R_MIN - 6);
          const [xf, yf] = punto(s.angulo, R_MAX);
          const [xv, yv] = punto(s.angulo, rValor);
          const [xt, yt] = punto(s.angulo, R_MAX + 18);
          const color = colorDe(s.distancia, s.umbral, s.colorBase);

          return (
            <g key={s.clave}>
              {/* Pista completa, tenue. */}
              <line
                x1={xi}
                y1={yi}
                x2={xf}
                y2={yf}
                stroke="var(--surface-alt)"
                strokeWidth={16}
                strokeLinecap="round"
              />
              {/* Porción ocupada por la lectura actual. */}
              <line
                x1={xi}
                y1={yi}
                x2={xv}
                y2={yv}
                stroke={color}
                strokeWidth={16}
                strokeLinecap="round"
                style={{ transition: "all 150ms ease-out" }}
              />
              <text
                x={xt}
                y={yt}
                textAnchor="middle"
                className="valor"
                fill={color}
                fontSize={13}
              >
                {num(s.distancia, 0)}
              </text>
            </g>
          );
        })}

        {/* El robot, en el vértice del abanico. */}
        <circle cx={140} cy={172} r={9} fill="var(--surface-alt)" stroke="var(--border)" />
      </svg>

      <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-[var(--border)] pt-4">
        {sensores.map((s) => {
          const color = colorDe(s.distancia, s.umbral, s.colorBase);
          return (
            <div key={s.clave} className="min-w-0">
              <dt className="etiqueta truncate text-[11px]">{s.etiqueta}</dt>
              <dd className="valor mt-1" style={{ color }}>
                {num(s.distancia, 1)} <span className="text-[var(--text-muted)]">cm</span>
              </dd>
              <dd className="mt-0.5 text-[11px] text-[var(--text-faint)]">
                {s.detecciones} detecciones
              </dd>
            </div>
          );
        })}
      </dl>

      <p
        className={cn(
          "mt-3 text-[11px] text-[var(--text-faint)]",
          frontal < CRITICO_CM && "text-[var(--critical)]",
        )}
      >
        Umbral de frenado: {num(umbralFrontal, 0)} cm frontal · {num(umbralLateral, 0)} cm lateral
      </p>
    </Tarjeta>
  );
}
