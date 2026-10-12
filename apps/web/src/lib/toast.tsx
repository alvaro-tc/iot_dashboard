import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tone = 'info' | 'error';
type Toast = { id: number; text: string; tone: Tone };
type Push = (text: string, tone?: Tone) => void;

const ToastContext = createContext<Push>(() => {});
export const useToast = () => useContext(ToastContext);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback<Push>((text, tone = 'info') => {
    const id = nextId++;
    setItems((xs) => [...xs, { id, text, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((t) => t.id !== id)), tone === 'error' ? 8000 : 4000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      {/* En móvil, por encima de la barra de navegación inferior (56 px + área segura). */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col gap-2 md:inset-x-auto md:right-4 md:bottom-4 md:max-w-sm"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`rounded-2xl border border-borde bg-tarjeta px-4 py-3 text-[14px] shadow-lg ${
              t.tone === 'error' ? 'border-l-4 border-l-evasion text-evasion' : 'border-l-4 border-l-acento'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
