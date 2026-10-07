// /eventos — tabla paginada con filtros. En móvil, tarjetas en lugar de tabla.
import { useState } from 'react';
import { Check } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TIPOS_EVENTO, type Sensor, type TipoEvento } from '@iot/shared';
import { api, errorMessage } from '../lib/api.ts';
import { NOMBRE_EVENTO, NOMBRE_SENSOR, cm, fechaHora } from '../lib/formato.ts';
import { useRobots } from '../lib/robots.tsx';
import { useEventosRobot } from '../lib/socket.tsx';
import { useToast } from '../lib/toast.tsx';
import type { EventoFila } from '../lib/types.ts';
import { Badge, Esqueleto, Tarjeta, Vacio } from '../components/ui.tsx';

const TONO: Record<TipoEvento, 'neutro' | 'vivo' | 'alerta' | 'ok'> = {
  obstaculo: 'alerta',
  atascado: 'vivo',
  bateria_baja: 'vivo',
  conexion: 'ok',
  desconexion: 'vivo',
  cambio_modo: 'neutro',
};

interface Respuesta {
  total: number;
  pagina: number;
  porPagina: number;
  items: EventoFila[];
}

export function Eventos() {
  const { robot } = useRobots();
  const qc = useQueryClient();
  const toast = useToast();
  const [tipo, setTipo] = useState<TipoEvento | ''>('');
  const [sensor, setSensor] = useState<Sensor | ''>('');
  const [atendido, setAtendido] = useState<'' | 'true' | 'false'>('');
  const [pagina, setPagina] = useState(1);

  const clave = ['eventos', robot?.id, tipo, sensor, atendido, pagina];
  const { data, isLoading, error } = useQuery<Respuesta>({
    queryKey: clave,
    queryFn: () => {
      const q = new URLSearchParams({ pagina: String(pagina) });
      if (tipo) q.set('tipo', tipo);
      if (sensor) q.set('sensor', sensor);
      if (atendido) q.set('atendido', atendido);
      return api(`/api/dispositivos/${robot!.id}/eventos?${q}`);
    },
    enabled: !!robot,
  });

  // Un evento nuevo en vivo invalida la primera página: la tabla se refresca sola.
  useEventosRobot(() => {
    if (pagina === 1) void qc.invalidateQueries({ queryKey: ['eventos', robot?.id] });
  });

  const atender = useMutation({
    mutationFn: (id: number) => api(`/api/eventos/${id}/atender`, { method: 'PATCH', body: { atendido: true } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['eventos', robot?.id] }),
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const items = data?.items ?? [];
  const paginas = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.porPagina ?? 50)));

  const Filtro = ({ children, ...props }: React.ComponentProps<'select'>) => (
    <select className="campo h-10 w-auto min-w-[150px] cursor-pointer" {...props}>
      {children}
    </select>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Filtro
          aria-label="Filtrar por tipo"
          value={tipo}
          onChange={(e) => {
            setTipo(e.target.value as TipoEvento | '');
            setPagina(1);
          }}
        >
          <option value="">Todos los tipos</option>
          {TIPOS_EVENTO.map((t) => (
            <option key={t} value={t}>
              {NOMBRE_EVENTO[t]}
            </option>
          ))}
        </Filtro>
        <Filtro
          aria-label="Filtrar por sensor"
          value={sensor}
          onChange={(e) => {
            setSensor(e.target.value as Sensor | '');
            setPagina(1);
          }}
        >
          <option value="">Todos los sensores</option>
          <option value="izq">Izquierdo</option>
          <option value="centro">Central</option>
          <option value="der">Derecho</option>
        </Filtro>
        <Filtro
          aria-label="Filtrar por atendido"
          value={atendido}
          onChange={(e) => {
            setAtendido(e.target.value as '' | 'true' | 'false');
            setPagina(1);
          }}
        >
          <option value="">Atendidos y sin atender</option>
          <option value="false">Sin atender</option>
          <option value="true">Atendidos</option>
        </Filtro>
      </div>

      <Tarjeta titulo="Eventos" subtitulo={data ? `${data.total} en total` : undefined}>
        {isLoading ? (
          <Esqueleto className="h-60" />
        ) : error ? (
          <Vacio titulo="No se pudieron cargar los eventos" descripcion={errorMessage(error)} />
        ) : !items.length ? (
          <Vacio titulo="Sin eventos" descripcion="Nada que coincida con estos filtros." />
        ) : (
          <>
            {/* Tabla en pantallas medianas y grandes */}
            <div className="hidden overflow-x-auto md:block">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Mensaje</th>
                    <th>Sensor</th>
                    <th className="num">Distancia</th>
                    <th>Cuándo</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((e) => (
                    <tr key={e.id} className={e.atendido ? 'opacity-55' : ''}>
                      <td>
                        <Badge tono={TONO[e.tipo]}>{NOMBRE_EVENTO[e.tipo]}</Badge>
                      </td>
                      <td>{e.mensaje}</td>
                      <td>{e.sensor ? NOMBRE_SENSOR[e.sensor] : '—'}</td>
                      <td className="num">{cm(e.distanciaCm)}</td>
                      <td className="whitespace-nowrap">{fechaHora(e.creadoEn)}</td>
                      <td>
                        {!e.atendido && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => atender.mutate(e.id)}
                            disabled={atender.isPending}
                          >
                            <Check className="size-3.5" />
                            Atender
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Tarjetas en móvil */}
            <ul className="space-y-2 md:hidden">
              {items.map((e) => (
                <li
                  key={e.id}
                  className={`rounded-2xl border border-borde p-3 ${e.atendido ? 'opacity-55' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <Badge tono={TONO[e.tipo]}>{NOMBRE_EVENTO[e.tipo]}</Badge>
                    <span className="text-[12px] text-tinta-suave">{fechaHora(e.creadoEn)}</span>
                  </div>
                  <p className="mt-2 text-[14px]">{e.mensaje}</p>
                  {!e.atendido && (
                    <button
                      type="button"
                      className="btn btn-sm mt-2 w-full"
                      onClick={() => atender.mutate(e.id)}
                      disabled={atender.isPending}
                    >
                      Marcar como atendido
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {paginas > 1 && (
              <div className="mt-4 flex items-center justify-center gap-3">
                <button type="button" className="btn btn-sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
                  Anterior
                </button>
                <span className="text-[13px] text-tinta-suave">
                  Página {pagina} de {paginas}
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={pagina >= paginas}
                  onClick={() => setPagina((p) => p + 1)}
                >
                  Siguiente
                </button>
              </div>
            )}
          </>
        )}
      </Tarjeta>
    </div>
  );
}
