// Primitivos del sistema de diseño: tarjeta con encabezado, interruptor, chips, badges.
import type { ComponentProps, ReactNode } from 'react';

export function Tarjeta({
  titulo,
  subtitulo,
  accion,
  pie,
  className = '',
  children,
  ...props
}: {
  titulo?: ReactNode;
  subtitulo?: ReactNode;
  /** Botón circular de la esquina superior derecha, como en la referencia. */
  accion?: ReactNode;
  /** Fila de chips del pie de la tarjeta. */
  pie?: ReactNode;
  children?: ReactNode;
} & ComponentProps<'section'>) {
  return (
    <section className={`tarjeta flex flex-col ${className}`} {...props}>
      {(titulo || accion) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {titulo && <h2 className="tarjeta-titulo truncate">{titulo}</h2>}
            {subtitulo && <p className="tarjeta-sub truncate">{subtitulo}</p>}
          </div>
          {accion}
        </header>
      )}
      <div className="min-h-0 flex-1">{children}</div>
      {pie && <div className="mt-4 flex flex-wrap gap-2">{pie}</div>}
    </section>
  );
}

export function Chip({
  icono,
  activo = false,
  children,
  ...props
}: { icono?: ReactNode; activo?: boolean } & ComponentProps<'button'>) {
  return (
    <button type="button" className={`chip ${activo ? 'chip-activo' : ''}`} aria-pressed={activo} {...props}>
      {icono && <span className="chip-icono">{icono}</span>}
      {children}
    </button>
  );
}

/** Interruptor naranja de las tarjetas de la fila inferior. */
export function Interruptor({
  activo,
  onCambiar,
  etiqueta,
  disabled,
}: {
  activo: boolean;
  onCambiar: (v: boolean) => void;
  etiqueta: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      aria-label={etiqueta}
      disabled={disabled}
      onClick={() => onCambiar(!activo)}
      className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
        activo ? 'bg-acento' : 'bg-borde'
      }`}
    >
      <span
        className={`inline-block size-5 rounded-full bg-white shadow transition-transform duration-200 ${
          activo ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export function Badge({ tono = 'neutro', children }: { tono?: 'neutro' | 'vivo' | 'alerta' | 'ok'; children: ReactNode }) {
  const clases = {
    neutro: 'bg-tarjeta-tenue text-tinta-suave',
    vivo: 'bg-evasion/15 text-evasion',
    alerta: 'bg-precaucion/15 text-precaucion',
    ok: 'bg-libre/15 text-libre',
  }[tono];
  return <span className={`badge ${clases}`}>{children}</span>;
}

/** Badge "● En vivo" / "Desconectado" del mapa. */
export function BadgeVivo({ enVivo, texto }: { enVivo: boolean; texto?: string }) {
  return (
    <span
      className={`badge backdrop-blur ${enVivo ? 'bg-evasion/20 text-white' : 'bg-white/10 text-white/70'}`}
    >
      <span className={`size-2 rounded-full ${enVivo ? 'bg-evasion punto-vivo' : 'bg-white/50'}`} />
      {texto ?? (enVivo ? 'En vivo' : 'Desconectado')}
    </span>
  );
}

/** Botón circular translúcido de la fila inferior del mapa, como en la referencia. */
export function BotonMapa({
  etiqueta,
  acento = false,
  children,
  ...props
}: { etiqueta: string; acento?: boolean } & ComponentProps<'button'>) {
  return (
    <button
      type="button"
      aria-label={etiqueta}
      title={etiqueta}
      className={`inline-flex size-11 cursor-pointer items-center justify-center rounded-full backdrop-blur transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
        acento ? 'bg-acento text-white hover:bg-acento-fuerte' : 'bg-white/15 text-white hover:bg-white/25'
      }`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Esqueleto({ className = 'h-24' }: { className?: string }) {
  return <div className={`esqueleto ${className}`} aria-hidden />;
}

export function Vacio({ titulo, descripcion, accion }: { titulo: string; descripcion?: string; accion?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <p className="text-[16px] font-semibold">{titulo}</p>
      {descripcion && <p className="max-w-sm text-[14px] text-tinta-suave">{descripcion}</p>}
      {accion}
    </div>
  );
}

export function ErrorConReintento({ mensaje, onReintentar }: { mensaje: string; onReintentar?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <p className="text-[14px] text-evasion">{mensaje}</p>
      {onReintentar && (
        <button type="button" className="btn btn-sm" onClick={onReintentar}>
          Reintentar
        </button>
      )}
    </div>
  );
}

/** Control segmentado (Mapa / Radar, 1 min / 5 min / 1 h). */
export function Segmentado<T extends string>({
  opciones,
  valor,
  onCambiar,
  etiqueta,
  oscuro = false,
}: {
  opciones: { valor: T; texto: string }[];
  valor: T;
  onCambiar: (v: T) => void;
  etiqueta: string;
  /** Variante para el interior oscuro del mapa. */
  oscuro?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={etiqueta}
      className={`inline-flex rounded-full p-1 ${oscuro ? 'bg-white/10 backdrop-blur' : 'bg-tarjeta-tenue'}`}
    >
      {opciones.map((o) => {
        const activo = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            aria-pressed={activo}
            onClick={() => onCambiar(o.valor)}
            className={`cursor-pointer rounded-full px-3 py-1 text-[13px] font-medium transition-colors duration-150 ${
              activo
                ? 'bg-acento text-white'
                : oscuro
                  ? 'text-white/70 hover:text-white'
                  : 'text-tinta-suave hover:text-tinta'
            }`}
          >
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}
