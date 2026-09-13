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
      <div aria-live="polite" className="fixed right-4 bottom-4 z-50 flex max-w-sm flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`panel border-l-2 px-4 py-3 text-[13px] ${t.tone === 'error' ? 'border-l-deviation text-deviation' : 'border-l-ink'}`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
