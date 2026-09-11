"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  CalendarClock,
  ChevronLeft,
  History,
  LayoutDashboard,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "./theme-toggle";

const RUTAS = [
  { href: "/", etiqueta: "Panel", icono: LayoutDashboard },
  { href: "/telemetria", etiqueta: "Telemetría", icono: Activity },
  { href: "/sesiones", etiqueta: "Sesiones", icono: History },
  { href: "/horarios", etiqueta: "Horarios", icono: CalendarClock },
  { href: "/ajustes", etiqueta: "Ajustes", icono: Settings2 },
] as const;

const CLAVE = "sidebar-colapsada";

export function Sidebar() {
  const pathname = usePathname();
  const [colapsada, setColapsada] = useState(false);
  const [montada, setMontada] = useState(false);

  // El estado colapsado persiste entre visitas.
  useEffect(() => {
    setColapsada(localStorage.getItem(CLAVE) === "1");
    setMontada(true);
  }, []);

  const alternar = () => {
    setColapsada((c) => {
      localStorage.setItem(CLAVE, c ? "0" : "1");
      return !c;
    });
  };

  return (
    <aside
      className={cn(
        "sticky top-0 flex h-dvh shrink-0 flex-col border-r bg-[var(--surface)] transition-[width] duration-150 ease-out",
        colapsada ? "w-16" : "w-60",
      )}
      aria-label="Navegación principal"
    >
      <div
        className={cn(
          "flex h-14 items-center border-b px-4",
          colapsada ? "justify-center" : "justify-between",
        )}
      >
        {!colapsada && (
          <span className="etiqueta text-[var(--text)]">Roomba IoT</span>
        )}
        <button
          type="button"
          onClick={alternar}
          aria-label={colapsada ? "Expandir menú" : "Colapsar menú"}
          aria-expanded={!colapsada}
          className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-alt)] hover:text-[var(--text)]"
        >
          <ChevronLeft
            className={cn("size-4 transition-transform duration-150", colapsada && "rotate-180")}
            aria-hidden
          />
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-2" aria-label="Secciones">
        {RUTAS.map(({ href, etiqueta, icono: Icono }) => {
          const activa = href === "/" ? pathname === "/" : pathname.startsWith(href);
          const enlace = (
            <Link
              key={href}
              href={href}
              aria-current={activa ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150",
                colapsada && "justify-center px-0",
                activa
                  ? "bg-[var(--surface-alt)] text-[var(--text)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--surface-alt)] hover:text-[var(--text)]",
              )}
            >
              <Icono className="size-4 shrink-0" aria-hidden />
              {!colapsada && <span>{etiqueta}</span>}
            </Link>
          );
          return colapsada ? (
            <Tooltip key={href}>
              <TooltipTrigger render={enlace} />
              <TooltipContent side="right">{etiqueta}</TooltipContent>
            </Tooltip>
          ) : (
            enlace
          );
        })}
      </nav>

      <div className={cn("border-t p-2", colapsada && "flex justify-center")}>
        {montada && <ThemeToggle compacta={colapsada} />}
      </div>
    </aside>
  );
}
