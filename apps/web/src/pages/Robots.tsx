// /robots — gestión de la flota: editar, regenerar credenciales MQTT y dar de baja.
import { useState } from 'react';
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api.ts';
import { haceCuanto, pct } from '../lib/formato.ts';
import { useRobots } from '../lib/robots.tsx';
import { useSocket } from '../lib/socket.tsx';
import { useToast } from '../lib/toast.tsx';
import type { Dispositivo } from '../lib/types.ts';
import { DialogoNuevoRobot } from '../components/DialogoNuevoRobot.tsx';
import { Badge, Esqueleto, Tarjeta, Vacio } from '../components/ui.tsx';

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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={onCerrar}>
      <form
        className="tarjeta w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
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
    </div>
  );
}

function DialogoClave({ robot, onCerrar }: { robot: Dispositivo; onCerrar: () => void }) {
  const toast = useToast();
  const [token, setToken] = useState<string | null>(null);

  const regenerar = useMutation({
    mutationFn: () => api<{ token: string }>(`/api/dispositivos/${robot.id}/regenerar-clave`, { method: 'POST' }),
    onSuccess: (r) => setToken(r.token),
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={onCerrar}>
      <div className="tarjeta w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h2 className="tarjeta-titulo mb-1">Regenerar credenciales</h2>
        {!token ? (
          <>
            <p className="tarjeta-sub mb-5">
              La contraseña actual de <strong className="text-tinta">{robot.nombre}</strong> dejará de funcionar en
              cuanto Mosquitto recargue. Tendrás que actualizar el <code>config.py</code> del ESP32.
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
        ) : (
          <>
            <p className="tarjeta-sub mb-3">Cópiala ahora: no se vuelve a mostrar.</p>
            <pre className="overflow-x-auto rounded-2xl border border-borde bg-tarjeta-tenue px-3 py-2 text-[13px]">
              {token}
            </pre>
            <button
              type="button"
              className="btn mt-3 w-full"
              onClick={() => navigator.clipboard.writeText(token).catch(() => {})}
            >
              Copiar
            </button>
            <button type="button" className="btn btn-acento mt-2 w-full" onClick={onCerrar}>
              Listo
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function Robots() {
  const { robots, cargando, recargar, elegir } = useRobots();
  const { robotId } = useSocket();
  const qc = useQueryClient();
  const toast = useToast();
  const [nuevo, setNuevo] = useState(false);
  const [editando, setEditando] = useState<Dispositivo | null>(null);
  const [regenerando, setRegenerando] = useState<Dispositivo | null>(null);

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
        <button type="button" className="btn btn-acento" onClick={() => setNuevo(true)}>
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
                  <button type="button" className="chip" onClick={() => setRegenerando(r)}>
                    <span className="chip-icono">
                      <KeyRound className="size-3.5" />
                    </span>
                    Credenciales
                  </button>
                  <button
                    type="button"
                    className="chip hover:border-evasion/50 hover:text-evasion"
                    onClick={() => {
                      if (confirm(`¿Dar de baja "${r.nombre}"? Dejará de poder publicar y se borrarán sus credenciales del broker.`)) {
                        borrar.mutate(r.id);
                      }
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
      {regenerando && <DialogoClave robot={regenerando} onCerrar={() => setRegenerando(null)} />}
    </div>
  );
}
