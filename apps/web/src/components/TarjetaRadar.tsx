// "Radar de sensores": la tarjeta que envuelve al lienzo del radar.
//
// Antes esta envoltura la ponía TarjetaMapa (que servía para el mapa y para el radar). Sin
// mapa, el radar es la única vista en vivo de los sensores y vive por su cuenta.
import { CONFIG_POR_DEFECTO } from '@iot/shared';
import { useSocket, useUltimaLectura } from '../lib/socket.tsx';
import { RadarSensores } from './RadarSensores.tsx';
import { Tarjeta } from './ui.tsx';

export function TarjetaRadar() {
  const { config } = useSocket();
  // 5 Hz: el radar es lo único que sí quiere refrescarse con cada lectura.
  const lectura = useUltimaLectura(5);

  return (
    <Tarjeta titulo="Radar de sensores" subtitulo="Lo que ven los tres HC-SR04 ahora">
      <div className="min-h-0 flex-1">
        <RadarSensores config={config ?? CONFIG_POR_DEFECTO} lectura={lectura} />
      </div>
    </Tarjeta>
  );
}
