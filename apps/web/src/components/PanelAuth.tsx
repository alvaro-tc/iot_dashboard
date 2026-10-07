// Lado izquierdo de las pantallas públicas: panel naranja con el lema y una animación
// SVG del robot visto desde arriba, esquivando un obstáculo.
//
// La animación es SMIL (<animateMotion>, <animateTransform>): no necesita JavaScript y el
// navegador la detiene sola si el usuario pide menos movimiento.
import { Link } from 'react-router-dom';

export function PanelAuth() {
  return (
    <aside className="relative hidden overflow-hidden bg-acento p-10 text-white lg:flex lg:flex-col lg:justify-between">
      <Link to="/login" className="inline-flex items-center gap-3 text-[18px] font-bold">
        <span className="inline-flex size-10 items-center justify-center rounded-2xl bg-white/20">
          {/* Robot de perfil: chasis y dos ruedas */}
          <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
            <circle cx="16" cy="16" r="11" fill="#fff" />
            <circle cx="16" cy="16" r="4" fill="#f97316" />
          </svg>
        </span>
        Roomba
      </Link>

      <div>
        <h1 className="max-w-sm text-[34px] leading-tight font-bold">Tu hogar limpio, monitoreado en tiempo real</h1>
        <p className="mt-3 max-w-sm text-[15px] text-white/80">
          Mira dónde está el robot, qué ve cada sensor y cómo esquiva los muebles, con menos de 300 ms de retardo.
        </p>
      </div>

      {/* Animación: el robot recorre la habitación y gira al llegar al obstáculo */}
      <svg viewBox="0 0 320 200" className="w-full max-w-md" role="img" aria-label="Animación de un robot aspirador esquivando un obstáculo">
        {/* Habitación */}
        <rect x="10" y="10" width="300" height="180" rx="14" fill="rgba(255,255,255,0.10)" />
        {/* Muebles */}
        <rect x="210" y="40" width="64" height="40" rx="8" fill="rgba(255,255,255,0.22)" />
        <rect x="46" y="128" width="78" height="30" rx="8" fill="rgba(255,255,255,0.22)" />
        <circle cx="168" cy="112" r="20" fill="rgba(255,255,255,0.22)" />

        {/* Rastro del recorrido */}
        <path
          id="recorrido"
          d="M 50 60 L 180 60 Q 196 60 196 78 L 196 100 Q 196 118 212 118 L 268 118 Q 284 118 284 136 L 284 160 Q 284 172 268 172 L 60 172 Q 44 172 44 156 L 44 100 Q 44 84 60 84"
          fill="none"
          stroke="rgba(255,255,255,0.45)"
          strokeWidth="2"
          strokeDasharray="5 5"
        />

        {/* El robot */}
        <g>
          <circle r="13" fill="#fff" />
          <circle r="4.5" fill="#f97316" />
          <rect x="-7" y="-15" width="14" height="4" rx="2" fill="#0f172a" />
          <rect x="-7" y="11" width="14" height="4" rx="2" fill="#0f172a" />
          {/* Haz del sensor central, pulsando */}
          <path d="M 13 0 L 34 -8 L 34 8 Z" fill="rgba(255,255,255,0.5)">
            <animate attributeName="opacity" values="0.15;0.6;0.15" dur="1.4s" repeatCount="indefinite" />
          </path>
          <animateMotion dur="11s" repeatCount="indefinite" rotate="auto">
            <mpath href="#recorrido" />
          </animateMotion>
        </g>
      </svg>
    </aside>
  );
}
