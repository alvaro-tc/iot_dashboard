import { cn } from "@/lib/utils";

/**
 * Contenedor base de todo el dashboard: borde de 1 px, sin sombra en reposo.
 * El encabezado lleva la etiqueta en mayúsculas a la izquierda y, si se pasa,
 * una acción o menú contextual a la derecha.
 */
export function Tarjeta({
  etiqueta,
  accion,
  children,
  className,
  contenidoClassName,
}: {
  etiqueta?: string;
  accion?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contenidoClassName?: string;
}) {
  return (
    <section className={cn("tarjeta flex flex-col", className)}>
      {(etiqueta || accion) && (
        <header className="mb-4 flex min-h-6 items-center justify-between gap-3">
          {etiqueta ? <h2 className="etiqueta">{etiqueta}</h2> : <span />}
          {accion}
        </header>
      )}
      <div className={cn("min-w-0 flex-1", contenidoClassName)}>{children}</div>
    </section>
  );
}
