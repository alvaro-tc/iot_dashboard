// /robots — gestión de la flota: editar, consultar o regenerar credenciales MQTT y dar de baja.
import { useState } from 'react';
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api.ts';
import { useConfirmar } from '../lib/confirmar.tsx';
import { haceCuanto, pct } from '../lib/formato.ts';
import { useRobots } from '../lib/robots.tsx';
import { useSocket } from '../lib/socket.tsx';
import { useToast } from '../lib/toast.tsx';
import type { Credenciales, Dispositivo } from '../lib/types.ts';
import { Credenciales as CredencialesCopiables, DialogoNuevoRobot } from '../components/DialogoNuevoRobot.tsx';
import { Badge, Esqueleto, Modal, Tarjeta, Vacio } from '../components/ui.tsx';

function DialogoEditar({ robot, onCerrar }: { robot: Dispositivo; onCerrar: () => void }) {
  const { recargar } = useRobots();
  const toast = useToast();
  const [nombre, setNombre] = useState(robot.nombre);
  const [ubicacion, setUbicacion] = useState(robot.ubicacion);

  const guardar = useMutation({
    mutationFn: () => api(`/api/dispositivos/${robot.id}`, { method: 'PATCH', body: { nombre, ubicacion } }),
    onSuccess: () => {
      recargar();
      toast('Robot actualizado.');
      onCerrar();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <Modal etiqueta="Editar robot" ancho="max-w-sm" onCerrar={onCerrar}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          guardar.mutate();
        }}
      >
        <h2 className="tarjeta-titulo mb-4">Editar robot</h2>
        <label className="etiqueta" htmlFor="editar-nombre">
          Nombre
        </label>
        <input id="editar-nombre" className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
        <label className="etiqueta mt-4" htmlFor="editar-ubicacion">
          Ubicación
        </label>
        <input id="editar-ubicacion" className="campo" value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} />
        <div className="mt-6 flex gap-2">
          <button type="button" className="btn flex-1" onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-acento flex-1" disabled={guardar.isPending}>
            Guardar
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Credenciales MQTT del robot: se consultan cuando hace falta y solo se regeneran a petición. */
function DialogoClave({ robot, onCerrar }: { robot: Dispositivo; onCerrar: () => void }) {
  const toast = useToast();
  const confirmar = useConfirmar();
  const [nuevoToken, setNuevoToken] = useState<string | null>(null);

  const creds = useQuery({
    queryKey: ['credenciales', robot.id],
    queryFn: () => api<Credenciales>(`/api/dispositivos/${robot.id}/credenciales`),
    staleTime: 0,
    gcTime: 0,
  });

  const regenerar = useMutation({
    mutationFn: () => api<Credenciales>(`/api/dispositivos/${robot.id}/regenerar-clave`, { method: 'POST' }),
    onSuccess: (r) => {
      setNuevoToken(r.token);
      toast('Contraseña regenerada. Actualiza el configuracion.py del ESP32.');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const token = nuevoToken ?? creds.data?.token ?? null;
  const broker = creds.data?.broker;

  const pedirRegenerar = async () => {
    const ok = await confirmar({
      titulo: `¿Regenerar la contraseña de «${robot.nombre}»?`,
      mensaje:
        'La contraseña actual dejará de funcionar en cuanto Mosquitto recargue y tendrás que actualizar el configuracion.py del ESP32.',
      confirmar: 'Regenerar',
      destructivo: true,
    });
    if (ok) regenerar.mutate();
  };

  return (
    <Modal etiqueta="Credenciales del robot" ancho="max-w-lg" onCerrar={onCerrar}>
      <h2 className="tarjeta-titulo mb-1">Credenciales de {robot.nombre}</h2>
      {creds.isPending ? (
        <Esqueleto className="mt-4 h-48" />
      ) : creds.isError ? (
        <p className="tarjeta-sub mt-3">{errorMessage(creds.error)}</p>
      ) : token && broker ? (
        <>
          <p className="tarjeta-sub mb-4">Las mismas que tiene el robot ahora mismo. Puedes consultarlas cuando quieras.</p>
          <CredencialesCopiables id={robot.id} token={token} broker={broker} />
          <div className="mt-6 flex gap-2">
            <button type="button" className="btn flex-1" onClick={pedirRegenerar} disabled={regenerar.isPending}>
              {regenerar.isPending ? 'Generando…' : 'Regenerar contraseña'}
            </button>
            <button type="button" className="btn btn-acento flex-1" onClick={onCerrar}>
              Listo
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="tarjeta-sub mb-5">
            Este robot se dio de alta antes de que se guardaran las credenciales recuperables, así que su contraseña no
            se puede mostrar. Regenérala para verla (habrá que actualizar el <code>configuracion.py</code> del ESP32).
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn flex-1" onClick={onCerrar}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-acento flex-1"
              onClick={() => regenerar.mutate()}
              disabled={regenerar.isPending}
            >
              {regenerar.isPending ? 'Generando…' : 'Regenerar'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function Robots() {
  const { robots, cargando, recargar, elegir } = useRobots();
  const { robotId } = useSocket();
  const qc = useQueryClient();
  const toast = useToast();
  const confirmar = useConfirmar();
  const [nuevo, setNuevo] = useState(false);
  const [editando, setEditando] = useState<Dispositivo | null>(null);
  const [viendoClave, setViendoClave] = useState<Dispositivo | null>(null);

  const borrar = useMutation({
    mutationFn: (id: string) => api(`/api/dispositivos/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['dispositivos'] });
      toast('Robot dado de baja.');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (cargando) return <Esqueleto className="h-80" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" className="btn btn-acento w-full xs:w-auto" onClick={() => setNuevo(true)}>
          <Plus className="size-4" />
          Agregar robot
        </button>
      </div>

      {!robots.length ? (
        <Tarjeta titulo="Robots">
          <Vacio titulo="Sin robots" descripcion="Da de alta el primero para empezar a recibir telemetría." />
        </Tarjeta>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {robots.map((r) => (
            <Tarjeta
              key={r.id}
              titulo={r.nombre}
              subtitulo={r.ubicacion || 'Sin ubicación'}
              className={r.id === robotId ? 'ring-2 ring-acento/40' : ''}
              accion={<Badge tono={r.enLinea ? 'ok' : 'neutro'}>{r.enLinea ? 'En línea' : 'Fuera de línea'}</Badge>}
              pie={
                <>
                  <button type="button" className="chip" onClick={() => setEditando(r)}>
                    <span className="chip-icono">
                      <Pencil className="size-3.5" />
                    </span>
                    Editar
                  </button>
                  <button type="button" className="chip" onClick={() => setViendoClave(r)}>
                    <span className="chip-icono">
                      <KeyRound className="size-3.5" />
                    </span>
                    Credenciales
                  </button>
                  <button
                    type="button"
                    className="chip hover:border-evasion/50 hover:text-evasion"
                    onClick={async () => {
                      const ok = await confirmar({
                        titulo: `¿Dar de baja «${r.nombre}»?`,
                        mensaje:
                          'Dejará de poder publicar y se borrarán sus credenciales del broker. No se puede deshacer.',
                        confirmar: 'Dar de baja',
                        destructivo: true,
                      });
                      if (ok) borrar.mutate(r.id);
                    }}
                  >
                    <span className="chip-icono">
                      <Trash2 className="size-3.5" />
                    </span>
                    Dar de baja
                  </button>
                </>
              }
            >
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
                <div className="col-span-2">
                  <dt className="text-tinta-suave">Identificador MQTT</dt>
                  <dd className="truncate font-mono text-[12px]">{r.id}</dd>
                </div>
                <div>
                  <dt className="text-tinta-suave">Último contacto</dt>
                  <dd className="font-medium">{haceCuanto(r.ultimoContacto)}</dd>
                </div>
                <div>
                  <dt className="text-tinta-suave">Batería</dt>
                  <dd className="font-medium tabular-nums">{pct(r.bateriaPct)}</dd>
                </div>
                <div>
                  <dt className="text-tinta-suave">Firmware</dt>
                  <dd className="font-medium">{r.versionFirmware ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-tinta-suave">Sesiones</dt>
                  <dd className="font-medium tabular-nums">{r.totalSesiones ?? 0}</dd>
                </div>
              </dl>
              {r.id !== robotId && (
                <button type="button" className="btn btn-sm mt-4 w-full" onClick={() => elegir(r.id)}>
                  Ver en el panel
                </button>
              )}
            </Tarjeta>
          ))}
        </div>
      )}

      {nuevo && (
        <DialogoNuevoRobot
          onCerrar={() => {
            setNuevo(false);
            recargar();
          }}
        />
      )}
      {editando && <DialogoEditar robot={editando} onCerrar={() => setEditando(null)} />}
      {viendoClave && <DialogoClave robot={viendoClave} onCerrar={() => setViendoClave(null)} />}
    </div>
  );
}
