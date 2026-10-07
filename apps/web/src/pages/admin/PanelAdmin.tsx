// /admin — visión global de la flota.
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.ts';
import { distancia, hora } from '../../lib/formato.ts';
import { Esqueleto, Tarjeta, Vacio } from '../../components/ui.tsx';

interface ResumenAdmin {
  clientes: number;
  robots: number;
  robotsEnLinea: number;
  sesionesHoy: number;
  sesionesActivas: number;
  alertasPendientes: number;
  sesionesEnCurso: {
    sesionId: number;
    dispositivoId: string;
    nombre: string;
    usuario: string;
    iniciadaEn: string;
    lecturas: number;
    distanciaCm: number;
  }[];
}

function Metrica({ etiqueta, valor, tono = '' }: { etiqueta: string; valor: number; tono?: string }) {
  return (
    <div className="tarjeta">
      <p className="text-[13px] text-tinta-suave">{etiqueta}</p>
      <p className={`mt-1 text-[30px] leading-none font-bold tabular-nums ${tono}`}>{valor}</p>
    </div>
  );
}

export function PanelAdmin() {
  const { data, isLoading } = useQuery<ResumenAdmin>({
    queryKey: ['admin-resumen'],
    queryFn: () => api('/api/admin/resumen'),
    refetchInterval: 15_000,
  });

  if (isLoading || !data) return <Esqueleto className="h-60" />;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metrica etiqueta="Clientes" valor={data.clientes} />
        <Metrica etiqueta="Robots" valor={data.robots} />
        <Metrica etiqueta="En línea" valor={data.robotsEnLinea} tono="text-libre" />
        <Metrica etiqueta="Sesiones hoy" valor={data.sesionesHoy} />
        <Metrica
          etiqueta="Alertas sin atender"
          valor={data.alertasPendientes}
          tono={data.alertasPendientes > 0 ? 'text-evasion' : ''}
        />
      </div>

      <Tarjeta titulo="Sesiones en curso" subtitulo={`${data.sesionesActivas} robots limpiando ahora`}>
        {!data.sesionesEnCurso.length ? (
          <Vacio titulo="Ningún robot en marcha" descripcion="Cuando alguno pase a automático aparecerá aquí." />
        ) : (
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Robot</th>
                  <th>Propietario</th>
                  <th>Desde</th>
                  <th className="num">Lecturas</th>
                  <th className="num">Distancia</th>
                </tr>
              </thead>
              <tbody>
                {data.sesionesEnCurso.map((s) => (
                  <tr key={s.sesionId}>
                    <td className="font-medium">{s.nombre}</td>
                    <td>{s.usuario}</td>
                    <td>{hora(s.iniciadaEn)}</td>
                    <td className="num">{s.lecturas}</td>
                    <td className="num">{distancia(s.distanciaCm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>

      <p className="px-2 text-[13px] text-tinta-suave">
        Gestiona cuentas en{' '}
        <Link to="/admin/usuarios" className="text-acento">
          Usuarios
        </Link>{' '}
        y la flota completa en{' '}
        <Link to="/admin/robots" className="text-acento">
          Robots
        </Link>
        .
      </p>
    </div>
  );
}
