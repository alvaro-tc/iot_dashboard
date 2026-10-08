// "Sesiones de limpieza": equivale al reproductor de música de la referencia.
//
// La "carátula" es una miniatura del recorrido de la sesión, y el botón de reproducir pone
// el mapa en modo repetición: el robot vuelve a recorrer ese camino con los datos leídos
// de Postgres.
import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { distancia, duracion, hora, pct } from '../lib/formato.ts';
import { useRobots } from '../lib/robots.tsx';
import type { PuntoMapa, ResumenSesion } from '../lib/types.ts';
import type { Pose } from './MapaVivo.tsx';
import { Esqueleto, Segmentado, Tarjeta, Vacio } from './ui.tsx';

export interface EstadoRepeticion {
  nombre: string;
  poses: Pose[];
}

/** Miniatura del recorrido: un SVG con la polilínea normalizada a la caja. */
function Miniatura({ puntos }: { puntos: { x: number; y: number }[] }) {
  if (puntos.length < 2) {
    return <div className="size-full rounded-2xl bg-[#0f172a]" aria-hidden />;
  }
  const xs = puntos.map((p) => p.x);
  const ys = puntos.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY, 1);
  // El eje Y del SVG crece hacia abajo; el del mapa, hacia arriba.
  const d = puntos
    .map((p, i) => `${i ? 'L' : 'M'} ${((p.x - minX) / span) * 90 + 5} ${95 - ((p.y - minY) / span) * 90}`)
    .join(' ');
  return (
    <svg viewBox="0 0 100 100" className="size-full rounded-2xl bg-[#0f172a]" aria-hidden>
      <path d={d} fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const VELOCIDADES = [1, 2, 4] as const;

export function TarjetaSesiones({
  repeticion,
  onRepetir,
}: {
  repeticion: EstadoRepeticion | null;
  onRepetir: (r: EstadoRepeticion | null) => void;
}) {
  const { robot } = useRobots();

  const { data: sesiones, isLoading } = useQuery<ResumenSesion[]>({
    queryKey: ['sesiones', robot?.id],
    queryFn: () => api(`/api/dispositivos/${robot!.id}/sesiones`),
    enabled: !!robot,
    refetchInterval: 30_000,
  });

  const lista = (sesiones ?? []).filter((s) => s.lecturas > 0);
  const [indice, setIndice] = useState(0);
  const [reproduciendo, setReproduciendo] = useState(false);
  const [velocidad, setVelocidad] = useState<(typeof VELOCIDADES)[number]>(1);
  const [progreso, setProgreso] = useState(0); // 0..1
  const mapaSesion = useRef<PuntoMapa[]>([]);

  const sesion = lista[indice] ?? null;

  // Miniaturas: el mapa de cada sesión se pide una sola vez y se cachea por sesión.
  const { data: mapa } = useQuery<PuntoMapa[]>({
    queryKey: ['mapa-sesion', sesion?.id],
    queryFn: () => api(`/api/sesiones/${sesion!.id}/mapa?puntos=800`),
    enabled: !!sesion,
    staleTime: 5 * 60_000,
  });
  mapaSesion.current = mapa ?? [];

  // Reproducción: avanza el índice de puntos y va alimentando el mapa.
  useEffect(() => {
    if (!reproduciendo || !mapa?.length || !sesion) return;
    const total = mapa.length;
    // La sesión se reproduce en ~20 s a 1x, no en tiempo real: media hora de limpieza
    // en vivo no la mira nadie.
    const paso = 50;
    const incremento = paso / (20_000 / velocidad);
    const id = setInterval(() => {
      setProgreso((p) => {
        const siguiente = p + incremento;
        if (siguiente >= 1) {
          setReproduciendo(false);
          return 1;
        }
        return siguiente;
      });
    }, paso);
    return () => clearInterval(id);
  }, [reproduciendo, mapa, velocidad, sesion]);

  // Cada cambio de progreso recorta el recorrido y lo manda al mapa.
  useEffect(() => {
    if (!reproduciendo && progreso === 0) return;
    const puntos = mapaSesion.current;
    if (!puntos.length || !sesion) return;
    const hasta = Math.max(2, Math.floor(puntos.length * progreso));
    onRepetir({
      nombre: `Sesión ${hora(sesion.iniciadaEn)}`,
      poses: puntos.slice(0, hasta).map(aPose),
    });
  }, [progreso, reproduciendo]); // eslint-disable-line react-hooks/exhaustive-deps

  const saltar = (delta: number) => {
    if (!lista.length) return;
    setIndice((i) => (i + delta + lista.length) % lista.length);
    setProgreso(0);
    setReproduciendo(false);
    onRepetir(null);
  };

  if (isLoading) {
    return (
      <Tarjeta titulo="Sesiones de limpieza">
        <Esqueleto className="h-[132px]" />
      </Tarjeta>
    );
  }

  if (!sesion) {
    return (
      <Tarjeta titulo="Sesiones de limpieza" subtitulo="Historial de recorridos">
        <Vacio
          titulo="Todavía no hay sesiones"
          descripcion="Pon el robot en modo automático y aquí aparecerá cada ciclo de limpieza."
        />
      </Tarjeta>
    );
  }

  const puntosMiniatura = (mapa ?? []).map((p) => ({ x: p.x, y: p.y }));

  return (
    <Tarjeta
      titulo="Sesiones de limpieza"
      subtitulo={`${indice + 1} de ${lista.length}`}
      className="bg-gradient-to-br from-acento-suave to-transparent"
      accion={
        <Segmentado
          etiqueta="Velocidad de repetición"
          valor={String(velocidad)}
          onCambiar={(v) => setVelocidad(Number(v) as (typeof VELOCIDADES)[number])}
          opciones={VELOCIDADES.map((v) => ({ valor: String(v), texto: `${v}x` }))}
        />
      }
    >
      <div className="flex flex-wrap gap-4">
        <div className="size-[92px] shrink-0 @[20rem]:size-[108px] @[30rem]:size-[132px]">
          <Miniatura puntos={puntosMiniatura} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between">
          <div className="min-w-0">
            <p className="truncate text-[17px] font-semibold">Sesión {hora(sesion.iniciadaEn)}</p>
            <p className="text-[13px] text-tinta-suave">
              {duracion(sesion.duracionS)} · {distancia(sesion.distanciaCm)} · {sesion.evasiones} evasiones
              {sesion.bateriaConsumidaPct !== null && ` · ${pct(sesion.bateriaConsumidaPct)} batería`}
            </p>
          </div>

          <div>
            {/* Barra de progreso de la repetición */}
            <div className="mb-1 flex justify-between text-[12px] text-tinta-suave tabular-nums">
              <span>{duracion(sesion.duracionS * progreso)}</span>
              <span>{duracion(sesion.duracionS)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-borde">
              <div className="h-full rounded-full bg-acento" style={{ width: `${progreso * 100}%` }} />
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                aria-label="Sesión anterior"
                className="btn-fantasma inline-flex size-9 cursor-pointer items-center justify-center rounded-full hover:bg-tarjeta-tenue"
                onClick={() => saltar(-1)}
              >
                <SkipBack className="size-4" />
              </button>
              <button
                type="button"
                aria-label={reproduciendo ? 'Pausar repetición' : 'Reproducir repetición'}
                className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full bg-acento text-white hover:bg-acento-fuerte"
                onClick={() => {
                  if (progreso >= 1) setProgreso(0);
                  setReproduciendo((v) => !v);
                }}
              >
                {reproduciendo ? <Pause className="size-5" /> : <Play className="size-5" />}
              </button>
              <button
                type="button"
                aria-label="Sesión siguiente"
                className="btn-fantasma inline-flex size-9 cursor-pointer items-center justify-center rounded-full hover:bg-tarjeta-tenue"
                onClick={() => saltar(1)}
              >
                <SkipForward className="size-4" />
              </button>
              {repeticion && (
                <button
                  type="button"
                  className="btn btn-sm ml-auto"
                  aria-label="Volver al mapa en vivo"
                  onClick={() => {
                    setReproduciendo(false);
                    setProgreso(0);
                    onRepetir(null);
                  }}
                >
                  En vivo
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Tarjeta>
  );
}

/** Una fila de obtener_mapa_sesion se convierte en la pose que entiende el mapa. */
export function aPose(p: PuntoMapa): Pose {
  const por = (s: 'izq' | 'centro' | 'der') => p.obstaculos.find((o) => o.sensor === s)?.d ?? null;
  return {
    x: Number(p.x),
    y: Number(p.y),
    th: Number(p.theta),
    movimiento: p.estado_movimiento,
    distancias: { izq: por('izq'), centro: por('centro'), der: por('der') },
  };
}
