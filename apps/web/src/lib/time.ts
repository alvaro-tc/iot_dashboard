import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useEffect, useState } from 'react';

// La API entrega UTC (ISO). La conversión a hora local se hace solo aquí, al presentar.

const pad = (n: number) => String(n).padStart(2, '0');

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export const formatTime = (d: string | Date) => format(new Date(d), 'HH:mm:ss');
export const formatHM = (d: string | Date) => format(new Date(d), 'HH:mm');
export const formatDateTime = (d: string | Date) => format(new Date(d), 'dd/MM/yyyy HH:mm');
export const dayKey = (d: string | Date) => format(new Date(d), 'yyyy-MM-dd');

export function formatDayLabel(d: string | Date): string {
  const s = format(new Date(d), "EEEE d 'de' MMMM 'de' yyyy", { locale: es });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Minutos desde la medianoche local. */
export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

/** Fecha local (yyyy-MM-dd de un <input type="date">) a Date a las 00:00 locales. */
export function localDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, enabled]);
  return now;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const fn = () => setReduced(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return reduced;
}
