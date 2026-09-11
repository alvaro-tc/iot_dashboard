"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

export function ThemeToggle({ compacta = false }: { compacta?: boolean }) {
  const { theme, setTheme } = useTheme();
  const oscuro = theme !== "light";

  return (
    <button
      type="button"
      onClick={() => setTheme(oscuro ? "light" : "dark")}
      aria-label={oscuro ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-alt)] hover:text-[var(--text)]",
        compacta ? "justify-center px-0" : "w-full",
      )}
    >
      {oscuro ? <Moon className="size-4" aria-hidden /> : <Sun className="size-4" aria-hidden />}
      {!compacta && <span>{oscuro ? "Tema oscuro" : "Tema claro"}</span>}
    </button>
  );
}
