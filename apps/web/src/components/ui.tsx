import { correctPrefixLength, fmt } from '@iot/shared';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useLive } from '../lib/live.tsx';
import { formatDuration, useNow } from '../lib/time.ts';

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': describedBy })}
      {error ? (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-[13px] text-ink-soft">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="border-l-2 border-deviation bg-surface px-3 py-2 text-[13px] text-deviation">
      {children}
    </p>
  );
}

export function LiveDot({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block size-2 shrink-0 rounded-full bg-signal" aria-hidden />
      {label && <span>{label}</span>}
    </span>
  );
}

const WS_LABEL = {
  open: { text: 'conectado', dot: 'bg-signal' },
  connecting: { text: 'conectando', dot: 'bg-muted' },
  reconnecting: { text: 'reconectando', dot: 'bg-muted' },
  offline: { text: 'sin conexión', dot: 'bg-deviation' },
} as const;

export function WsIndicator() {
  const { status } = useLive();
  const s = WS_LABEL[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-soft" role="status" title="Estado del tiempo real">
      <span className={`inline-block size-2 rounded-full ${s.dot}`} aria-hidden />
      {s.text}
    </span>
  );
}

export function PageHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-grid pb-4">
      <div>
        <h1 className="text-[24px] leading-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-ink-soft">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-4 text-[13px]">
        {right}
        <WsIndicator />
      </div>
    </header>
  );
}

export function SectionTitle({ id, children, right }: { id?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 id={id} className="text-[18px]">
        {children}
      </h2>
      {right}
    </div>
  );
}

/** Valor aproximado con el prefijo ya correcto en tinta y el resto en gris. */
export function Digits({ value, real }: { value: number; real: number }) {
  const text = fmt.value(value);
  const n = correctPrefixLength(value, real);
  return (
    <span className="font-mono tabular-nums">
      <span className="text-ink">{text.slice(0, n)}</span>
      <span className="text-muted">{text.slice(n)}</span>
    </span>
  );
}

/** Duración; si no hay fin, corre en vivo. */
export function Elapsed({ from, to }: { from: string; to?: string | null }) {
  const now = useNow(1000, !to);
  const end = to ? new Date(to).getTime() : now;
  return <span className="font-mono tabular-nums">{formatDuration(end - new Date(from).getTime())}</span>;
}

/** Diálogo nativo: foco atrapado, Esc y fondo inerte sin librerías. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
  xl,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  xl?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title}
      className={`m-auto border border-grid bg-surface p-0 text-ink backdrop:bg-ink/30 ${xl ? 'w-[min(1400px,calc(100vw-32px))]' : wide ? 'w-[min(720px,calc(100vw-32px))]' : 'w-[min(480px,calc(100vw-32px))]'}`}
    >
      {open && (
        <>
          <div className="flex items-center justify-between border-b border-grid px-5 py-3">
            <h2 className="text-[18px]">{title}</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Cerrar">
              ✕
            </button>
          </div>
          <div className={`${xl ? 'max-h-[85vh]' : 'max-h-[75vh]'} overflow-y-auto p-5`}>{children}</div>
        </>
      )}
    </dialog>
  );
}

export function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      className="btn btn-sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        if (ref.current) ref.current.textContent = 'Copiado';
        setTimeout(() => ref.current && (ref.current.textContent = label), 1500);
      }}
    >
      {label}
    </button>
  );
}
