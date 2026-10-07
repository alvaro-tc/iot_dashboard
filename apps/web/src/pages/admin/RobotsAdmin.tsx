// /admin/robots — la flota completa, de todos los usuarios.
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.ts';
import { fechaHora, haceCuanto } from '../../lib/formato.ts';
import type { Dispositivo } from '../../lib/types.ts';
import { Badge, Esqueleto, Tarjeta, Vacio } from '../../components/ui.tsx';

export function RobotsAdmin() {
  const { data, isLoading } = useQuery<Dispositivo[]>({
    queryKey: ['admin-robots'],
    queryFn: () => api('/api/admin/robots'),
    refetchInterval: 20_000,
  });

  if (isLoading) return <Esqueleto className="h-80" />;

  return (
    <Tarjeta titulo="Flota completa" subtitulo={`${data?.length ?? 0} robots registrados`}>
      {!data?.length ? (
        <Vacio titulo="Sin robots" descripcion="Ningún usuario ha dado de alta un robot todavía." />
      ) : (
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Robot</th>
                <th>Propietario</th>
                <th>Estado</th>
                <th>Último contacto</th>
                <th>Firmware</th>
                <th className="num">Sesiones</th>
                <th>Alta</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className={r.isRevoked ? 'opacity-55' : ''}>
                  <td>
                    <span className="font-medium">{r.nombre}</span>
                    <span className="block text-[12px] text-tinta-suave">{r.id}</span>
                  </td>
                  <td>
                    {r.usuario}
                    <span className="block text-[12px] text-tinta-suave">{r.usuarioEmail}</span>
                  </td>
                  <td>
                    {r.isRevoked ? (
                      <Badge tono="neutro">De baja</Badge>
                    ) : (
                      <Badge tono={r.enLinea ? 'ok' : 'neutro'}>{r.enLinea ? 'En línea' : 'Fuera de línea'}</Badge>
                    )}
                  </td>
                  <td className="whitespace-nowrap">{haceCuanto(r.ultimoContacto)}</td>
                  <td>{r.versionFirmware ?? '—'}</td>
                  <td className="num">{r.totalSesiones ?? 0}</td>
                  <td className="whitespace-nowrap">{fechaHora(r.creadoEn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Tarjeta>
  );
}
