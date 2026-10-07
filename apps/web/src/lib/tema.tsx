// Tema claro/oscuro. La primera vez respeta prefers-color-scheme; a partir de ahí manda
// la elección guardada en localStorage.
//
// El atributo data-tema ya lo pone un script en index.html antes de pintar (evita el
// parpadeo). Aquí solo se lee y se cambia.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

type Tema = 'claro' | 'oscuro';

interface ValorTema {
  tema: Tema;
  alternar: () => void;
}

const ContextoTema = createContext<ValorTema>({ tema: 'claro', alternar: () => {} });
export const useTema = () => useContext(ContextoTema);

const leerTema = (): Tema => (document.documentElement.dataset.tema === 'oscuro' ? 'oscuro' : 'claro');

export function ProveedorTema({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>(leerTema);

  useEffect(() => {
    document.documentElement.dataset.tema = tema;
    try {
      localStorage.setItem('tema', tema);
    } catch {
      /* navegación privada: el tema simplemente no se recuerda */
    }
  }, [tema]);

  const alternar = useCallback(() => setTema((t) => (t === 'oscuro' ? 'claro' : 'oscuro')), []);

  return <ContextoTema.Provider value={{ tema, alternar }}>{children}</ContextoTema.Provider>;
}

/**
 * Colores del tema vigente, leídos del CSS. Chart.js no entiende variables CSS, así que las
 * gráficas los piden aquí y se redibujan cuando `tema` cambia.
 */
export function useColoresTema() {
  const { tema } = useTema();
  const leer = (nombre: string, respaldo: string) => {
    if (typeof window === 'undefined') return respaldo;
    return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || respaldo;
  };
  return {
    tema,
    acento: leer('--color-acento', '#f97316'),
    tinta: leer('--color-tinta', '#1c1917'),
    tintaSuave: leer('--color-tinta-suave', '#78716c'),
    borde: leer('--color-borde', '#f3e4d8'),
    libre: leer('--color-libre', '#10b981'),
    precaucion: leer('--color-precaucion', '#f59e0b'),
    evasion: leer('--color-evasion', '#ef4444'),
    // El recuadro del mapa y el radar va oscuro en los dos temas, como la cámara de la referencia.
    lienzoMapa: tema === 'oscuro' ? '#060b16' : '#0f172a',
    rejillaMapa: tema === 'oscuro' ? '#1e293b' : '#1e293b',
  };
}
