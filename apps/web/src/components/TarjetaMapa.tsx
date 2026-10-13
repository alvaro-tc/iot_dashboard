// Widget del panel: el plano de la habitación activa, en vivo.
//
// Es el mismo dibujo que la página del lidar (MapaSala), sin etiquetas y en pequeño: el panel
// es para echar un ojo, y para lo demás está la página. Solo lo ve quien tiene el permiso; el
// catálogo de widgets ni lo ofrece al resto (ver Panel.tsx).
import { Link } from 'react-router-dom';
import { Radar } from 'lucide-react';
import type { Sensor } from '@iot/shared';
import { TEXTO_MODO, useLidar } from '../lib/lidar.tsx';
import { useUltimaLectura } from '../lib/socket.tsx';
import { MapaSala } from './MapaSala.tsx';
import { Tarjeta } from './ui.tsx';

export function TarjetaMapa() {
  const lidar = useLidar();
  const lectura = useUltimaLectura(4);
  const distancias: Record<Sensor, number | null> | null = lectura
    ? {
        izquierdo: lectura.distanciaIzquierdaCm,
        central: lectura.distanciaCentralCm,
        derecho: lectura.distanciaDerechaCm,
      }
    : null;

  if (!lidar.habilitado) return null;

  return (
    <Tarjeta
      titulo="Mapa de la habitación"
      subtitulo={
        lidar.sala
          ? `${lidar.sala.nombre} · ${TEXTO_MODO[lidar.modo]} · ${Math.round(lidar.cobertura * 100)}%`
          : 'Sin habitaciones'
      }
      className="h-full"
    >
      {lidar.sala ? (
        <div className="h-full min-h-[120px] overflow-hidden rounded-2xl">
          <MapaSala
            sala={lidar.sala}
            rejilla={lidar.rejilla}
            obstaculos={lidar.obstaculos}
            pose={lidar.pose}
            distancias={distancias}
            geometria={lidar.geometria}
            animacion={lidar.modo === 'reconociendo' ? 'barriendo' : 'ninguna'}
            etiquetas={false}
          />
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <p className="text-[13px] text-tinta-suave">Crea una habitación y reconócela para ver su plano aquí.</p>
          <Link to="/mapa" className="btn btn-sm">
            <Radar className="size-4" />
            Ir al mapa
          </Link>
        </div>
      )}
    </Tarjeta>
  );
}
