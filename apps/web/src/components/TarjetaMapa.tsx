// La pieza central del panel: mapa en vivo o radar, con los controles del robot.
//
// Equivale a la tarjeta "Smart CCTV" de la referencia: recuadro oscuro, badge "En vivo"
// arriba a la izquierda, selector de robot arriba a la derecha y fila de botones
// circulares translúcidos abajo.
import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Eraser,
  Maximize2,
  Pause,
  Play,
  Power,
  Radar as RadarIcono,
  Square,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { CONFIG_POR_DEFECTO, type Lectura } from '@iot/shared';
import { cm, distancia, fraseEstado, grados } from '../lib/formato.ts';
import { useRobots } from '../lib/robots.tsx';
import { useSocket, useTelemetria, useUltimaLectura } from '../lib/socket.tsx';
import { useToast } from '../lib/toast.tsx';
import { MapaVivo, type MapaApi, type Pose } from './MapaVivo.tsx';
import { RadarSensores } from './RadarSensores.tsx';
import { BadgeVivo, BotonMapa, Segmentado } from './ui.tsx';

type Vista = 'mapa' | 'radar';

interface Props {
  /** En /mapa la tarjeta ocupa todo el ancho y el recuadro es más alto. */
  alto?: string;
  /** Recorrido de una sesión pasada: activa el modo repetición. */
  repeticion?: { nombre: string; poses: Pose[] } | null;
  onSalirRepeticion?: () => void;
}

export function TarjetaMapa({ alto = 'h-[300px] sm:h-[380px]', repeticion = null, onSalirRepeticion }: Props) {
  const { robot, robots, mover } = useRobots();
  const { config, estadoRobot, estado, enviarComando, historial, idConexion } = useSocket();
  const toast = useToast();
  const lectura = useUltimaLectura(4);

  const [vista, setVista] = useState<Vista>('mapa');
  const [seguir, setSeguir] = useState(true);
  const [haces, setHaces] = useState(true);
  const [enviando, setEnviando] = useState<string | null>(null);
  const mapa = useRef<MapaApi>(null);

  const cfg = config ?? CONFIG_POR_DEFECTO;
  const enVivo = !repeticion && estado === 'conectado' && !!estadoRobot?.enLinea;

  // Cada lectura nueva entra en la cola de interpolación del mapa.
  useTelemetria((l: Lectura) => {
    if (!repeticion) mapa.current?.empujar(l);
  });

  // Al (re)conectar o cambiar de robot, el mapa se siembra con lo que el servidor guardaba.
  useEffect(() => {
    if (repeticion) return;
    const previas = historial();
    mapa.current?.limpiar();
    for (const l of previas) mapa.current?.empujar(l);
  }, [idConexion, repeticion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Modo repetición: se carga el recorrido entero de la sesión.
  useEffect(() => {
    if (!repeticion) return;
    mapa.current?.cargar(repeticion.poses);
  }, [repeticion]);

  const comando = async (accion: 'iniciar' | 'pausar' | 'detener') => {
    setEnviando(accion);
    const r = await enviarComando(accion);
    setEnviando(null);
    if (!r.ok) toast(r.error ?? 'No se pudo enviar el comando.', 'error');
    else if (!r.confirmado) toast('Comando enviado, pero el robot no lo confirmó.', 'error');
  };

  const capturar = () => {
    const png = mapa.current?.capturaPng();
    if (!png) return;
    const a = document.createElement('a');
    a.href = png;
    a.download = `mapa-${robot?.id ?? 'robot'}-${Date.now()}.png`;
    a.click();
  };

  const banner = fraseEstado(
    lectura?.movimiento ?? null,
    [
      { sensor: 'izq' as const, d: lectura?.distIzqCm ?? null },
      { sensor: 'centro' as const, d: lectura?.distCentroCm ?? null },
      { sensor: 'der' as const, d: lectura?.distDerCm ?? null },
    ],
    cfg.distanciaEvasionCm,
  );

  const enMarcha = cfg.modo === 'automatico';

  return (
    <section className="tarjeta flex flex-col">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="tarjeta-titulo truncate">{vista === 'mapa' ? 'Mapa en vivo' : 'Radar de sensores'}</h2>
          <p className="tarjeta-sub truncate">
            {robot ? `${robot.nombre}${robot.ubicacion ? ` · ${robot.ubicacion}` : ''}` : 'Sin robot seleccionado'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Segmentado
            etiqueta="Vista"
            valor={vista}
            onCambiar={setVista}
            opciones={[
              { valor: 'mapa' as Vista, texto: 'Mapa' },
              { valor: 'radar' as Vista, texto: 'Radar' },
            ]}
          />
          {/* Botón de encendido: alterna automático ↔ detenido */}
          <button
            type="button"
            className={`btn-circulo ${enMarcha ? 'border-acento bg-acento text-white' : ''}`}
            aria-label={enMarcha ? 'Detener el robot' : 'Iniciar el robot'}
            aria-busy={!!enviando}
            disabled={!robot || !!enviando}
            onClick={() => comando(enMarcha ? 'detener' : 'iniciar')}
          >
            <Power className="size-5" />
          </button>
        </div>
      </header>

      {/* ---- Recuadro oscuro ---- */}
      <div className={`relative overflow-hidden rounded-[1.25rem] bg-[#0f172a] ${alto}`}>
        {vista === 'mapa' ? (
          <MapaVivo
            ref={mapa}
            config={cfg}
            seguir={seguir && !repeticion}
            mostrarHaces={haces}
            area={{ ancho: cfg.areaAnchoCm, alto: cfg.areaAltoCm }}
          />
        ) : (
          <RadarSensores config={cfg} lectura={lectura} />
        )}

        {/* Badge de estado, arriba a la izquierda */}
        <div className="pointer-events-none absolute top-3 left-3 flex flex-wrap gap-2">
          {repeticion ? (
            <span className="badge bg-acento/90 text-white">Repetición · {repeticion.nombre}</span>
          ) : (
            <BadgeVivo
              enVivo={enVivo}
              texto={estado !== 'conectado' ? 'Sin servidor' : estadoRobot?.enLinea ? 'En vivo' : 'Robot apagado'}
            />
          )}
        </div>

        {/* Selector de robot, arriba a la derecha */}
        {robots.length > 0 && !repeticion && (
          <div className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-white/10 px-1 py-1 backdrop-blur">
            <button
              type="button"
              aria-label="Robot anterior"
              className="inline-flex size-7 cursor-pointer items-center justify-center rounded-full text-white/80 hover:bg-white/15 disabled:opacity-30"
              disabled={robots.length < 2}
              onClick={() => mover(-1)}
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="max-w-[140px] truncate px-1 text-[13px] font-medium text-white">
              {robot?.nombre ?? '—'}
            </span>
            <button
              type="button"
              aria-label="Robot siguiente"
              className="inline-flex size-7 cursor-pointer items-center justify-center rounded-full text-white/80 hover:bg-white/15 disabled:opacity-30"
              disabled={robots.length < 2}
              onClick={() => mover(1)}
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}

        {/* Controles propios de la vista Mapa, arriba a la derecha bajo el selector */}
        {vista === 'mapa' && (
          <div className="absolute top-14 right-3 flex flex-col gap-1.5">
            <BotonMapa etiqueta="Acercar" onClick={() => mapa.current?.zoom(0.8)}>
              <ZoomIn className="size-4" />
            </BotonMapa>
            <BotonMapa etiqueta="Alejar" onClick={() => mapa.current?.zoom(1.25)}>
              <ZoomOut className="size-4" />
            </BotonMapa>
            <BotonMapa
              etiqueta={seguir ? 'Dejar de seguir al robot' : 'Seguir al robot'}
              acento={seguir}
              onClick={() => setSeguir((s) => !s)}
            >
              <Crosshair className="size-4" />
            </BotonMapa>
            <BotonMapa etiqueta="Ajustar a todo el recorrido" onClick={() => mapa.current?.ajustarATodo()}>
              <Maximize2 className="size-4" />
            </BotonMapa>
            <BotonMapa
              etiqueta={haces ? 'Ocultar haces de los sensores' : 'Mostrar haces de los sensores'}
              acento={haces}
              onClick={() => setHaces((h) => !h)}
            >
              <RadarIcono className="size-4" />
            </BotonMapa>
            <BotonMapa etiqueta="Limpiar el mapa (solo en pantalla)" onClick={() => mapa.current?.limpiar()}>
              <Eraser className="size-4" />
            </BotonMapa>
          </div>
        )}

        {/* Fila inferior de botones circulares */}
        <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-2">
          <BotonMapa
            etiqueta={enMarcha ? 'Pausar' : 'Iniciar'}
            disabled={!robot || !!enviando || !!repeticion}
            onClick={() => comando(enMarcha ? 'pausar' : 'iniciar')}
          >
            {enMarcha ? <Pause className="size-4" /> : <Play className="size-4" />}
          </BotonMapa>
          <BotonMapa
            etiqueta="Detener"
            disabled={!robot || !!enviando || !!repeticion}
            onClick={() => comando('detener')}
          >
            <Square className="size-4" />
          </BotonMapa>
          <BotonMapa etiqueta="Captura PNG" onClick={capturar} disabled={vista !== 'mapa'}>
            <Camera className="size-4" />
          </BotonMapa>
          {repeticion && onSalirRepeticion && (
            <button type="button" className="btn btn-sm btn-acento ml-2" onClick={onSalirRepeticion}>
              Volver a En vivo
            </button>
          )}
        </div>
      </div>

      {/* ---- Banner de estado y pose ---- */}
      <p className="mt-3 text-[14px] font-medium" aria-live="polite">
        {banner}
      </p>
      <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-tinta-suave">
        <span>
          Posición <span className="text-tinta tabular-nums">{cm(lectura?.posXCm)}</span>,{' '}
          <span className="text-tinta tabular-nums">{cm(lectura?.posYCm)}</span>
        </span>
        <span>
          Orientación <span className="text-tinta tabular-nums">{grados(lectura?.orientacionDeg)}</span>
        </span>
        <span>
          Recorrido <span className="text-tinta tabular-nums">{distancia(distanciaDe(historial()))}</span>
        </span>
      </div>

      {/* Leyenda */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-tinta-suave">
        <Leyenda color="var(--color-acento)">Trayectoria</Leyenda>
        <Leyenda color="var(--color-evasion)">Obstáculo / evasión</Leyenda>
        <Leyenda color="var(--color-precaucion)">Precaución</Leyenda>
        <Leyenda color="var(--color-libre)">Libre</Leyenda>
      </div>
    </section>
  );
}

function Leyenda({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2.5 rounded-full" style={{ background: color }} aria-hidden />
      {children}
    </span>
  );
}

/** Distancia recorrida en la ventana que el navegador tiene en memoria. */
function distanciaDe(lecturas: Lectura[]): number {
  let total = 0;
  for (let i = 1; i < lecturas.length; i++) {
    total += Math.hypot(lecturas[i].posXCm - lecturas[i - 1].posXCm, lecturas[i].posYCm - lecturas[i - 1].posYCm);
  }
  return total;
}
