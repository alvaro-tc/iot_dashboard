// Página del modo lidar: el plano de la habitación en vivo y el menú de acciones.
//
//   centro       el plano, dibujándose en tiempo real
//   derecha      limpiar, reconocer, re-escanear, puertas, calibrar
//
// Al reconocer se abre además un modal grande: mientras el robot da vueltas no hay nada más
// que mirar, y el plano creciendo a pantalla casi completa es lo que deja ver si está saliendo
// bien (si la cosa no encaja, se nota a simple vista antes de que acabe).
//
// Esta página solo existe para quien tiene el permiso: la ruta no se monta sin él (App.tsx), el
// menú no la enseña (AppLayout) y la API responde 404. Ver lib/lidar.tsx.
import { useEffect, useState } from 'react';
import {
  Blocks,
  Compass,
  Crosshair,
  DoorOpen,
  Octagon,
  Pencil,
  Plus,
  RefreshCw,
  Ruler,
  Scan,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { SENSORES, type Sensor } from '@iot/shared';
import { DialogoCalibracion, DialogoGeometria, DialogoPuertas, DialogoSala } from '../components/DialogosLidar.tsx';
import { MapaSala } from '../components/MapaSala.tsx';
import { BadgeVivo, ErrorConReintento, Esqueleto, Modal, Vacio } from '../components/ui.tsx';
import { useConfirmar } from '../lib/confirmar.tsx';
import { TEXTO_MODO, useLidar } from '../lib/lidar.tsx';
import { useRobots } from '../lib/robots.tsx';
import { useSocket, useUltimaLectura } from '../lib/socket.tsx';
import { useToast } from '../lib/toast.tsx';

/** Las tres distancias de la última lectura, como las quiere el plano. */
function useDistancias(): Record<Sensor, number | null> | null {
  const lectura = useUltimaLectura(4);
  if (!lectura) return null;
  return {
    izquierdo: lectura.distanciaIzquierdaCm,
    central: lectura.distanciaCentralCm,
    derecho: lectura.distanciaDerechaCm,
  };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function Lidar() {
  const { robots, robot } = useRobots();
  const { estadoRobot } = useSocket();
  const lidar = useLidar();
  const distancias = useDistancias();
  const confirmar = useConfirmar();
  const toast = useToast();

  const [nuevaSala, setNuevaSala] = useState(false);
  const [editarSala, setEditarSala] = useState(false);
  const [puertas, setPuertas] = useState(false);
  const [calibrar, setCalibrar] = useState(false);
  const [medidas, setMedidas] = useState(false);
  const [modalMapeo, setModalMapeo] = useState(false);
  /**
   * Dónde dice el cliente que está el robot. Es lo que hace fiable el PRIMER barrido: a ciegas,
   * en una sala rectangular y lisa, hay varias poses que explican las paredes igual de bien y el
   * mapa entero puede salir girado o desplazado medio metro.
   */
  const [inicio, setInicio] = useState<{ x: number; y: number } | null>(null);
  const [marcando, setMarcando] = useState(false);

  const { sala, modo, ocupado, cargando, error } = lidar;
  const mapeado = !!sala?.mapa && sala.mapa.barridos > 0;

  // El modal grande se abre solo al empezar a reconocer y se queda abierto hasta que termina:
  // es el momento en el que hay algo que ver.
  useEffect(() => {
    if (modo === 'reconociendo') setModalMapeo(true);
  }, [modo]);

  const ordenar = async (accion: 'reconocer' | 'limpiar' | 'parar') => {
    try {
      await lidar.ejecutar.mutateAsync({ accion, salaId: sala?.id, inicio });
      if (accion === 'reconocer') setModalMapeo(true);
      setMarcando(false);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  if (cargando) {
    return (
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Esqueleto className="h-[520px]" />
        <Esqueleto className="h-[520px]" />
      </div>
    );
  }

  if (!robots.length) {
    return (
      <div className="tarjeta">
        <Vacio
          titulo="Primero necesitas un robot"
          descripcion="Da de alta un robot en la sección Robots y vuelve aquí para mapear sus habitaciones."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="tarjeta">
        <ErrorConReintento mensaje={error.message} onReintentar={lidar.refrescar} />
      </div>
    );
  }

  const plano = (etiquetas: boolean) =>
    sala ? (
      <MapaSala
        sala={sala}
        rejilla={lidar.rejilla}
        obstaculos={lidar.obstaculos}
        // Mientras se marca el punto de partida, el robot se dibuja ahí: es la confirmación de
        // que el toque ha ido donde se quería.
        pose={marcando && inicio ? { ...inicio, th: lidar.pose?.th ?? 0 } : lidar.pose}
        distancias={distancias}
        geometria={lidar.geometria}
        animacion={modo === 'reconociendo' ? 'barriendo' : modo === 'limpiando' ? 'limpiando' : 'ninguna'}
        etiquetas={etiquetas}
        onPunto={marcando ? (p) => setInicio({ x: Math.round(p.x), y: Math.round(p.y) }) : undefined}
      />
    ) : null;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      {/* ---------------- El plano ---------------- */}
      <section className="tarjeta flex min-h-[520px] flex-col">
        <header className="mb-4 flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="tarjeta-titulo truncate">Mapa de {robot?.nombre}</h1>
            <p className="tarjeta-sub">
              {sala
                ? `${sala.nombre} · ${TEXTO_MODO[modo]}`
                : 'Sin habitaciones: crea una para empezar a mapear.'}
            </p>
          </div>

          {/* Cuál es la habitación activa se elige en la barra de arriba, al lado del robot:
              es la misma elección en todo el dashboard y no tiene por qué vivir dos veces. */}
          <button type="button" className="btn btn-sm" onClick={() => setNuevaSala(true)}>
            <Plus className="size-4" />
            Habitación
          </button>
        </header>

        {sala ? (
          <>
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-[var(--radius-tarjeta)]">
              {plano(true)}
              <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2">
                <BadgeVivo enVivo={!!estadoRobot?.enLinea} texto={estadoRobot?.enLinea ? 'Robot en línea' : 'Desconectado'} />
                {ocupado && (
                  <span className="badge bg-acento/90 text-white backdrop-blur">
                    <Sparkles className="size-3" />
                    {TEXTO_MODO[modo]}
                  </span>
                )}
              </div>
            </div>

            {/* Lo que hay que saber para fiarse del mapa, debajo del plano. */}
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="chip">Cobertura {pct(lidar.cobertura)}</span>
              <span className="chip">
                {lidar.barridos} barrido{lidar.barridos === 1 ? '' : 's'}
              </span>
              <span className="chip">
                <Blocks className="size-3.5" />
                {lidar.obstaculos.length} obstáculo{lidar.obstaculos.length === 1 ? '' : 's'}
              </span>
              {lidar.residuoCm !== null && (
                // El residuo del encaje es la medida honesta de si el mapa cuadra con la
                // habitación: si sube, o la sala no mide lo que dijiste o falta calibrar.
                <span className="chip" title="Cuánto se desvían las medidas de las paredes de la habitación">
                  Ajuste ±{lidar.residuoCm} cm
                </span>
              )}
              {sala.anchoRealCm && (
                <span className="chip" title="Estimado al crearla / medido al mapear">
                  <Ruler className="size-3.5" />
                  {sala.anchoEstimadoCm}×{sala.altoEstimadoCm} → {sala.anchoRealCm}×{sala.altoRealCm} cm
                </span>
              )}
            </div>

            {lidar.aviso && (
              <p role="status" className="mt-3 rounded-2xl bg-tarjeta-tenue p-3 text-[13px]">
                {lidar.aviso}
              </p>
            )}
          </>
        ) : (
          <Vacio
            titulo="Crea tu primera habitación"
            descripcion="Dile su tamaño aproximado (y su forma, si no es un rectángulo). Con eso el robot ya tiene contra qué comparar lo que mide, y el mapa sale mucho mejor."
            accion={
              <button type="button" className="btn btn-acento" onClick={() => setNuevaSala(true)}>
                <Plus className="size-4" />
                Nueva habitación
              </button>
            }
          />
        )}
      </section>

      {/* ---------------- El menú de la derecha ---------------- */}
      <aside aria-label="Acciones del mapa" className="tarjeta flex flex-col gap-3">
        <h2 className="tarjeta-titulo">Acciones</h2>

        {!sala ? (
          <p className="text-[13px] text-tinta-suave">
            Para limpiar hace falta una habitación. Crea una y después reconócela para que el robot sepa por dónde
            se mueve.
          </p>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-acento w-full justify-start"
              disabled={ocupado || !mapeado || !estadoRobot?.enLinea}
              onClick={() => ordenar('limpiar')}
            >
              <Sparkles className="size-4" />
              Limpiar cuarto
            </button>
            {!mapeado && (
              <p className="-mt-1 text-[12px] text-precaucion">
                Esta habitación no está mapeada todavía: reconócela antes de limpiarla, o el robot no sabrá dónde
                están las paredes ni las puertas.
              </p>
            )}

            {/* Marcar dónde está el robot. No es un adorno: es lo que ancla el primer barrido.
                Sin marcarlo se supone el centro, y el backend lo avisa. */}
            <button
              type="button"
              className={`btn w-full justify-start ${marcando ? 'btn-acento' : ''}`}
              aria-pressed={marcando}
              disabled={ocupado}
              onClick={() => setMarcando((v) => !v)}
            >
              <Crosshair className="size-4" />
              {marcando ? 'Toca el plano…' : inicio ? `Robot en (${inicio.x}, ${inicio.y}) cm` : '¿Dónde está el robot?'}
            </button>
            {marcando && (
              <p className="-mt-1 text-[12px] text-tinta-suave">
                Toca en el plano el sitio donde está ahora el robot. No hace falta precisión: con medio metro de
                margen basta, y es lo que evita que el mapa salga girado.
              </p>
            )}
            {inicio && !marcando && (
              <button type="button" className="btn btn-sm btn-fantasma -mt-1 self-start" onClick={() => setInicio(null)}>
                Olvidar el punto
              </button>
            )}

            <button
              type="button"
              className="btn w-full justify-start"
              disabled={ocupado || !estadoRobot?.enLinea}
              onClick={() => ordenar('reconocer')}
            >
              <Scan className="size-4" />
              {mapeado ? 'Reconocer otra vez' : 'Reconocer habitación'}
            </button>

            {mapeado && (
              <button
                type="button"
                className="btn w-full justify-start"
                disabled={ocupado}
                onClick={async () => {
                  if (
                    !(await confirmar({
                      titulo: 'Volver a escanear',
                      mensaje:
                        'Se borra el mapa actual y se empieza de cero. Es lo que quieres si has movido los muebles.',
                      confirmar: 'Borrar y reconocer',
                    }))
                  ) {
                    return;
                  }
                  await lidar.borrarMapa.mutateAsync(sala.id);
                  await ordenar('reconocer');
                }}
              >
                <RefreshCw className="size-4" />
                Re-escanear de cero
              </button>
            )}

            {ocupado && (
              <button type="button" className="btn btn-peligro w-full justify-start" onClick={() => ordenar('parar')}>
                <Octagon className="size-4" />
                Parar
              </button>
            )}

            <hr className="border-borde" />

            <button type="button" className="btn w-full justify-start" onClick={() => setPuertas(true)}>
              <DoorOpen className="size-4" />
              Puertas
              {sala.puertas.length > 0 && <span className="text-tinta-suave">({sala.puertas.length})</span>}
            </button>
            <button type="button" className="btn w-full justify-start" onClick={() => setEditarSala(true)}>
              <Pencil className="size-4" />
              Editar habitación
            </button>
            <button
              type="button"
              className="btn btn-peligro w-full justify-start"
              disabled={ocupado}
              onClick={async () => {
                if (
                  !(await confirmar({
                    titulo: `Eliminar ${sala.nombre}`,
                    mensaje: 'Se borra la habitación y su mapa. No se puede deshacer.',
                    confirmar: 'Eliminar',
                  }))
                ) {
                  return;
                }
                await lidar.borrarSala.mutateAsync(sala.id);
              }}
            >
              <Trash2 className="size-4" />
              Eliminar habitación
            </button>
          </>
        )}

        <hr className="border-borde" />

        <button type="button" className="btn w-full justify-start" disabled={ocupado} onClick={() => setCalibrar(true)}>
          <Compass className="size-4" />
          Calibrar robot
          {!lidar.calibrado && <span className="badge bg-precaucion/15 text-precaucion">pendiente</span>}
        </button>
        <button type="button" className="btn w-full justify-start" onClick={() => setMedidas(true)}>
          <Ruler className="size-4" />
          Medidas del robot
        </button>

        {/* Los obstáculos reconocidos, en texto: es la lista de lo que hay que esquivar. */}
        {lidar.obstaculos.length > 0 && (
          <>
            <hr className="border-borde" />
            <h3 className="text-[13px] font-semibold">Obstáculos detectados</h3>
            <ul className="space-y-1 text-[12px] text-tinta-suave">
              {lidar.obstaculos.slice(0, 8).map((o) => (
                <li key={o.id} className="flex justify-between gap-2">
                  <span className="truncate">
                    {o.forma === 'redondo'
                      ? `Redondo ⌀${Math.round(o.radioCm * 2)} cm`
                      : `${o.forma === 'alargado' ? 'Alargado' : o.forma === 'caja' ? 'Mueble' : 'Obstáculo'} ${Math.round(o.anchoCm)}×${Math.round(o.altoCm)} cm`}
                  </span>
                  <span className="shrink-0">{pct(o.confianza)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>

      {/* ---------------- Modal grande del mapeo ---------------- */}
      {modalMapeo && sala && (
        <Modal etiqueta="Mapeando la habitación" ancho="max-w-5xl" onCerrar={() => setModalMapeo(false)}>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="tarjeta-titulo truncate">Mapeando {sala.nombre}</h2>
              <p className="tarjeta-sub">
                {modo === 'reconociendo'
                  ? 'El robot gira sobre su eje para barrer con los tres sensores, y después se mueve a otro punto para ver lo que tapaban los muebles.'
                  : TEXTO_MODO[modo]}
              </p>
            </div>
            <span className="badge bg-acento/15 text-acento">Cobertura {pct(lidar.cobertura)}</span>
            <span className="badge bg-tarjeta-tenue text-tinta-suave">{lidar.barridos} barridos</span>
          </div>

          <div className="h-[min(62vh,560px)] overflow-hidden rounded-[var(--radius-tarjeta)]">{plano(true)}</div>

          {/* Barra de cobertura: es el progreso de verdad (no un reloj), porque el
              reconocimiento termina cuando la habitación está vista, no a los N segundos. */}
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-tarjeta-tenue">
            <div
              className="h-full rounded-full bg-acento transition-[width] duration-500"
              style={{ width: pct(Math.min(1, lidar.cobertura / 0.82)) }}
            />
          </div>

          {lidar.aviso && (
            <p role="status" className="mt-3 rounded-2xl bg-tarjeta-tenue p-3 text-[13px]">
              {lidar.aviso}
            </p>
          )}

          <div className="mt-5 flex gap-2">
            {ocupado ? (
              <button type="button" className="btn btn-peligro flex-1" onClick={() => ordenar('parar')}>
                <Octagon className="size-4" />
                Parar
              </button>
            ) : (
              <button type="button" className="btn flex-1" onClick={() => ordenar('reconocer')}>
                <Scan className="size-4" />
                Otro barrido
              </button>
            )}
            <button type="button" className="btn btn-acento flex-1" onClick={() => setModalMapeo(false)}>
              {ocupado ? 'Seguir en segundo plano' : 'Listo'}
            </button>
          </div>
        </Modal>
      )}

      {nuevaSala && <DialogoSala onCerrar={() => setNuevaSala(false)} />}
      {editarSala && sala && <DialogoSala sala={sala} onCerrar={() => setEditarSala(false)} />}
      {puertas && sala && <DialogoPuertas sala={sala} onCerrar={() => setPuertas(false)} />}
      {calibrar && <DialogoCalibracion onCerrar={() => setCalibrar(false)} />}
      {medidas && <DialogoGeometria onCerrar={() => setMedidas(false)} />}
    </div>
  );
}
