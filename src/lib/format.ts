/** Formateo consistente de números, fechas y unidades en toda la UI. */
import { format, formatDistanceToNowStrict } from "date-fns";
import { es } from "date-fns/locale";

export const fmtHora = (d: Date | string) => format(new Date(d), "HH:mm:ss", { locale: es });
export const fmtHoraCorta = (d: Date | string) => format(new Date(d), "HH:mm", { locale: es });
export const fmtFecha = (d: Date | string) => format(new Date(d), "d MMM yyyy", { locale: es });
export const fmtFechaHora = (d: Date | string) =>
  format(new Date(d), "d MMM yyyy HH:mm:ss", { locale: es });
export const fmtRelativo = (d: Date | string) =>
  formatDistanceToNowStrict(new Date(d), { locale: es, addSuffix: true });

/** Número con decimales fijos y separador local. */
export function num(valor: number | null | undefined, decimales = 1): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return "—";
  return valor.toLocaleString("es", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

/** Notación científica compacta, para errores muy pequeños. */
export function cientifico(valor: number | null | undefined, digitos = 2): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return "—";
  if (valor === 0) return "0";
  if (Math.abs(valor) >= 0.001) return valor.toFixed(digitos + 2);
  return valor.toExponential(digitos).replace("e", "e");
}

/** Duración en segundos → "1 h 12 min" / "45 min" / "38 s". */
export function fmtDuracion(segundos: number | null | undefined): string {
  if (segundos === null || segundos === undefined || !Number.isFinite(segundos)) return "—";
  const s = Math.round(segundos);
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

export const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined ? "—" : `${num(v, d)} %`);
