// Alta de un robot. La contraseña MQTT se muestra UNA sola vez: el backend solo guarda su
// hash, así que si se cierra el diálogo sin copiarla hay que regenerarla desde /robots.
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { ApiError, api, errorMessage } from '../lib/api.ts';
import { useRobots } from '../lib/robots.tsx';
import { useToast } from '../lib/toast.tsx';
import type { AltaDispositivo } from '../lib/types.ts';
import { Modal } from './ui.tsx';

function Copiable({ etiqueta, valor, multilinea = false }: { etiqueta: string; valor: string; multilinea?: boolean }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      /* sin permiso de portapapeles: el valor está a la vista para copiarlo a mano */
    }
  };
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="etiqueta mb-0">{etiqueta}</span>
        <button type="button" className="btn btn-sm btn-fantasma" onClick={copiar}>
          {copiado ? <Check className="size-4 text-libre" /> : <Copy className="size-4" />}
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <pre
        className={`overflow-x-auto rounded-2xl border border-borde bg-tarjeta-tenue px-3 py-2 text-[13px] ${
          multilinea ? 'whitespace-pre' : 'whitespace-nowrap'
        }`}
      >
        {valor}
      </pre>
    </div>
  );
}

export function DialogoNuevoRobot({ onCerrar }: { onCerrar: () => void }) {
  const { recargar, elegir } = useRobots();
  const toast = useToast();
  const [nombre, setNombre] = useState('');
  const [ubicacion, setUbicacion] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [alta, setAlta] = useState<AltaDispositivo | null>(null);

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setErrores({});
    try {
      const r = await api<AltaDispositivo>('/api/dispositivos', { method: 'POST', body: { nombre, ubicacion } });
      setAlta(r);
      recargar();
      elegir(r.dispositivo.id);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrores(err.fields);
      else toast(errorMessage(err), 'error');
    } finally {
      setEnviando(false);
    }
  };

  const fragmentoConfig = alta
    ? `# firmware/configuracion.py
WIFI_SSID     = "TU_RED"
WIFI_CLAVE    = "TU_CLAVE"

ROBOT_ID      = "${alta.dispositivo.id}"
MQTT_SERVIDOR = "${alta.broker.host}"
MQTT_PUERTO   = ${alta.broker.port}
MQTT_USUARIO  = ROBOT_ID
MQTT_CLAVE    = "${alta.token}"`
    : '';

  return (
    <Modal etiqueta="Agregar robot" ancho="max-w-lg" onCerrar={onCerrar}>
      {!alta ? (
          <form onSubmit={crear} noValidate>
            <h2 className="tarjeta-titulo mb-1">Agregar robot</h2>
            <p className="tarjeta-sub mb-5">Se generan sus credenciales MQTT y se registran en el broker.</p>

            <label className="etiqueta" htmlFor="nombre-robot">
              Nombre
            </label>
            <input
              id="nombre-robot"
              className="campo"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Roomba Sala"
              aria-invalid={!!errores.nombre}
              autoFocus
            />
            {errores.nombre && <p className="error-campo">{errores.nombre}</p>}

            <label className="etiqueta mt-4" htmlFor="ubicacion-robot">
              Ubicación <span className="font-normal">(opcional)</span>
            </label>
            <input
              id="ubicacion-robot"
              className="campo"
              value={ubicacion}
              onChange={(e) => setUbicacion(e.target.value)}
              placeholder="Sala de estar"
              aria-invalid={!!errores.ubicacion}
            />
            {errores.ubicacion && <p className="error-campo">{errores.ubicacion}</p>}

            <div className="mt-6 flex gap-2">
              <button type="button" className="btn flex-1" onClick={onCerrar}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-acento flex-1" disabled={enviando}>
                {enviando ? 'Creando…' : 'Crear robot'}
              </button>
            </div>
          </form>
        ) : (
          <div>
            <h2 className="tarjeta-titulo mb-1">{alta.dispositivo.nombre} creado</h2>
            <p className="tarjeta-sub mb-4">
              Copia la contraseña ahora: no se vuelve a mostrar. Si la pierdes, regenérala desde «Robots».
            </p>
            <div className="space-y-3">
              <Copiable etiqueta="ID del robot (usuario MQTT)" valor={alta.dispositivo.id} />
              <Copiable etiqueta="Contraseña MQTT" valor={alta.token} />
              <Copiable etiqueta="config.py listo para pegar" valor={fragmentoConfig} multilinea />
            </div>
            <button type="button" className="btn btn-acento mt-6 w-full" onClick={onCerrar}>
              Ya la copié
            </button>
          </div>
      )}
    </Modal>
  );
}
