// Confirmaciones con modal en lugar de window.confirm(). `const ok = await confirmar({...})`.
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Modal } from '../components/ui.tsx';

interface Peticion {
  titulo: string;
  mensaje?: ReactNode;
  /** Texto del botón que confirma. */
  confirmar?: string;
  /** Pinta el botón en rojo: bajas, borrados, lo irreversible. */
  destructivo?: boolean;
}

type Confirmar = (p: Peticion) => Promise<boolean>;

const Contexto = createContext<Confirmar>(async () => false);
export const useConfirmar = () => useContext(Contexto);

export function ProveedorConfirmar({ children }: { children: ReactNode }) {
  const [pendiente, setPendiente] = useState<(Peticion & { resolver: (v: boolean) => void }) | null>(null);

  const confirmar = useCallback<Confirmar>(
    (p) => new Promise<boolean>((resolver) => setPendiente({ ...p, resolver })),
    [],
  );

  const responder = (v: boolean) => {
    pendiente?.resolver(v);
    setPendiente(null);
  };

  return (
    <Contexto.Provider value={confirmar}>
      {children}
      {pendiente && (
        <Modal etiqueta={pendiente.titulo} ancho="max-w-sm" onCerrar={() => responder(false)}>
          <h2 className="tarjeta-titulo mb-1">{pendiente.titulo}</h2>
          {pendiente.mensaje && <p className="tarjeta-sub mb-5">{pendiente.mensaje}</p>}
          <div className="mt-6 flex gap-2">
            <button type="button" className="btn flex-1" onClick={() => responder(false)}>
              Cancelar
            </button>
            <button
              type="button"
              autoFocus
              className={`btn flex-1 ${pendiente.destructivo ? 'border-evasion bg-evasion text-white hover:bg-evasion/90' : 'btn-acento'}`}
              onClick={() => responder(true)}
            >
              {pendiente.confirmar ?? 'Confirmar'}
            </button>
          </div>
        </Modal>
      )}
    </Contexto.Provider>
  );
}
