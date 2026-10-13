// Diálogos del modo lidar: crear o editar una habitación (rectangular, en L o dibujada),
// dibujar las puertas, calibrar el robot y ajustar sus medidas.
//
// Van juntos en un archivo porque comparten el editor de planta y los textos, y porque cada
// uno por separado serían cien líneas de las que la mitad es el mismo formulario.
import { useMemo, useRef, useState } from 'react';
import { Compass, DoorOpen, Gauge, Ruler, Trash2, Undo2 } from 'lucide-react';
import {
  SENSORES,
  caja,
  formaL,
  masCercanoEnSegmento,
  paredesDe,
  rectangulo,
  type CalibracionRobot,
  type GeometriaRobot,
  type Puerta,
  type Punto,
  type Sala,
  type Sensor,
} from '@iot/shared';
import { NOMBRE_SENSOR } from '../lib/formato.ts';
import { useLidar, type SalaConMapa } from '../lib/lidar.tsx';
import { useToast } from '../lib/toast.tsx';
import { MapaSala } from './MapaSala.tsx';
import { Modal, Segmentado } from './ui.tsx';

type Forma = 'rectangulo' | 'l' | 'dibujada';

/** Rejilla a la que se pegan los vértices: 10 cm es el detalle que un sonar puede sostener. */
const PASO_CM = 10;
const redondear = (v: number) => Math.round(v / PASO_CM) * PASO_CM;

// ---------------------------------------------------------------------------
// Editor de planta: paredes rectas garantizadas
// ---------------------------------------------------------------------------

/**
 * Dibuja la planta a clics. Cada vértice nuevo se alinea con el anterior en horizontal o en
 * vertical (la que esté más cerca de donde se hizo clic), así que **todas las paredes salen
 * rectas** por construcción: no hay forma de dibujar una pared torcida, que es justo lo que
 * pide el enunciado y lo que el encaje contra las paredes necesita.
 */
function EditorPlanta({
  vertices,
  onCambiar,
  anchoCm,
  altoCm,
}: {
  vertices: Punto[];
  onCambiar: (v: Punto[]) => void;
  anchoCm: number;
  altoCm: number;
}) {
  const lienzoRef = useRef<HTMLCanvasElement | null>(null);
  const [raton, setRaton] = useState<Punto | null>(null);

  /** Punto siguiente ya alineado con el último: en cruz, nunca en diagonal. */
  const alinear = (p: Punto): Punto => {
    const ultimo = vertices[vertices.length - 1];
    if (!ultimo) return { x: redondear(p.x), y: redondear(p.y) };
    const dx = Math.abs(p.x - ultimo.x);
    const dy = Math.abs(p.y - ultimo.y);
    return dx >= dy ? { x: redondear(p.x), y: ultimo.y } : { x: ultimo.x, y: redondear(p.y) };
  };

  const aCm = (e: React.PointerEvent): Punto | null => {
    const l = lienzoRef.current;
    if (!l) return null;
    const r = l.getBoundingClientRect();
    const escala = Math.min((r.width - 24) / anchoCm, (r.height - 24) / altoCm);
    return {
      x: Math.max(0, Math.min(anchoCm, (e.clientX - r.left - (r.width - anchoCm * escala) / 2) / escala)),
      y: Math.max(0, Math.min(altoCm, (e.clientY - r.top - (r.height - altoCm * escala) / 2) / escala)),
    };
  };

  // Dibujo directo: es un editor, no necesita animación.
  const pintar = (l: HTMLCanvasElement | null) => {
    if (!l) return;
    const ctx = l.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    l.width = l.clientWidth * dpr;
    l.height = l.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = l.clientWidth;
    const h = l.clientHeight;
    const escala = Math.min((w - 24) / anchoCm, (h - 24) / altoCm);
    const ox = (w - anchoCm * escala) / 2;
    const oy = (h - altoCm * escala) / 2;
    const X = (x: number) => ox + x * escala;
    const Y = (y: number) => oy + y * escala;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);
    // Retícula de 50 cm.
    ctx.strokeStyle = 'rgba(148,163,184,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= anchoCm; x += 50) {
      ctx.moveTo(X(x), Y(0));
      ctx.lineTo(X(x), Y(altoCm));
    }
    for (let y = 0; y <= altoCm; y += 50) {
      ctx.moveTo(X(0), Y(y));
      ctx.lineTo(X(anchoCm), Y(y));
    }
    ctx.stroke();

    if (vertices.length) {
      ctx.beginPath();
      vertices.forEach((v, i) => (i ? ctx.lineTo(X(v.x), Y(v.y)) : ctx.moveTo(X(v.x), Y(v.y))));
      // Lo que se está a punto de añadir, en trazo discontinuo.
      if (raton) {
        const a = alinear(raton);
        ctx.lineTo(X(a.x), Y(a.y));
      }
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      if (vertices.length >= 3) {
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = 'rgba(125,211,252,0.45)';
        ctx.beginPath();
        ctx.moveTo(X(vertices[vertices.length - 1].x), Y(vertices[vertices.length - 1].y));
        ctx.lineTo(X(vertices[0].x), Y(vertices[0].y));
        ctx.stroke();
        ctx.setLineDash([]);
      }

      for (const [i, v] of vertices.entries()) {
        ctx.fillStyle = i === 0 ? '#f97316' : '#ffffff';
        ctx.beginPath();
        ctx.arc(X(v.x), Y(v.y), 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  return (
    <div>
      <canvas
        ref={(n) => {
          lienzoRef.current = n;
          pintar(n);
        }}
        className="h-[260px] w-full cursor-crosshair rounded-2xl"
        onPointerMove={(e) => {
          setRaton(aCm(e));
          pintar(lienzoRef.current);
        }}
        onPointerLeave={() => {
          setRaton(null);
          pintar(lienzoRef.current);
        }}
        onPointerDown={(e) => {
          const p = aCm(e);
          if (p) onCambiar([...vertices, alinear(p)]);
        }}
      />
      <div className="mt-2 flex items-center gap-2">
        <p className="flex-1 text-[12px] text-tinta-suave">
          {vertices.length === 0
            ? 'Toca una esquina para empezar. Cada pared sale recta sola.'
            : `${vertices.length} esquina(s). La última pared se cierra con la primera.`}
        </p>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!vertices.length}
          onClick={() => onCambiar(vertices.slice(0, -1))}
        >
          <Undo2 className="size-4" />
          Deshacer
        </button>
        <button type="button" className="btn btn-sm" disabled={!vertices.length} onClick={() => onCambiar([])}>
          <Trash2 className="size-4" />
          Vaciar
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Crear o editar una habitación
// ---------------------------------------------------------------------------

export function DialogoSala({ sala, onCerrar }: { sala?: SalaConMapa | null; onCerrar: () => void }) {
  const { crearSala, editarSala } = useLidar();
  const toast = useToast();
  const [nombre, setNombre] = useState(sala?.nombre ?? '');
  const [forma, setForma] = useState<Forma>(
    sala ? (sala.forma === 'poligono' ? 'dibujada' : 'rectangulo') : 'rectangulo',
  );
  const [ancho, setAncho] = useState(sala?.anchoEstimadoCm ?? 400);
  const [alto, setAlto] = useState(sala?.altoEstimadoCm ?? 300);
  const [recorteAncho, setRecorteAncho] = useState(150);
  const [recorteAlto, setRecorteAlto] = useState(120);
  const [dibujados, setDibujados] = useState<Punto[]>(sala?.forma === 'poligono' ? sala.vertices : []);
  const [error, setError] = useState<string | null>(null);

  const vertices = useMemo(() => {
    if (forma === 'rectangulo') return rectangulo(ancho, alto);
    if (forma === 'l') return formaL(ancho, alto, recorteAncho, recorteAlto);
    return dibujados;
  }, [forma, ancho, alto, recorteAncho, recorteAlto, dibujados]);

  const valido = vertices.length >= 3 && nombre.trim().length >= 2;
  const medidas = vertices.length >= 3 ? caja(vertices) : null;

  const guardar = async () => {
    setError(null);
    try {
      const datos = {
        nombre: nombre.trim(),
        // Para el backend solo hay dos formas: un rectángulo (4 vértices) o un polígono. La L y
        // la dibujada son polígonos; la distinción solo sirve para saber qué editor ofrecer.
        forma: (forma === 'rectangulo' ? 'rectangulo' : 'poligono') as Sala['forma'],
        vertices,
        // Lo estimado es la caja de lo que ha dibujado: es lo que semilla el encaje.
        anchoEstimadoCm: Math.round(medidas!.ancho),
        altoEstimadoCm: Math.round(medidas!.alto),
      };
      if (sala) await editarSala.mutateAsync({ id: sala.id, ...datos });
      else await crearSala.mutateAsync(datos);
      toast(sala ? 'Habitación actualizada.' : 'Habitación creada. Ya puedes reconocerla.');
      onCerrar();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal etiqueta={sala ? 'Editar habitación' : 'Nueva habitación'} ancho="max-w-2xl" onCerrar={onCerrar}>
      <h2 className="tarjeta-titulo mb-1">{sala ? 'Editar habitación' : 'Nueva habitación'}</h2>
      <p className="tarjeta-sub mb-5">
        Dale un tamaño aproximado: con eso el robot ya sabe contra qué comparar lo que mide, y el mapa sale mucho
        más fino. No hace falta que sea exacto —al reconocerla se guarda también el tamaño medido.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-4">
          <div>
            <label className="etiqueta" htmlFor="sala-nombre">
              Nombre
            </label>
            <input
              id="sala-nombre"
              className="campo"
              value={nombre}
              placeholder="Salón"
              maxLength={40}
              onChange={(e) => setNombre(e.target.value)}
            />
          </div>

          <div>
            <span className="etiqueta">Forma</span>
            <Segmentado
              etiqueta="Forma de la habitación"
              valor={forma}
              onCambiar={(v) => setForma(v as Forma)}
              opciones={[
                { valor: 'rectangulo', texto: 'Rectangular' },
                { valor: 'l', texto: 'En L' },
                { valor: 'dibujada', texto: 'Dibujarla' },
              ]}
            />
            <p className="mt-1.5 text-[12px] text-tinta-suave">
              {forma === 'rectangulo'
                ? 'Cuatro paredes. Lo más común y lo que mejor encaja.'
                : forma === 'l'
                  ? 'Un rectángulo con una esquina recortada.'
                  : 'Tócala esquina a esquina. Las paredes salen rectas solas.'}
            </p>
          </div>

          {forma !== 'dibujada' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="etiqueta" htmlFor="sala-ancho">
                  Ancho (cm)
                </label>
                <input
                  id="sala-ancho"
                  type="number"
                  className="campo"
                  min={50}
                  max={2000}
                  step={10}
                  value={ancho}
                  onChange={(e) => setAncho(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="etiqueta" htmlFor="sala-alto">
                  Largo (cm)
                </label>
                <input
                  id="sala-alto"
                  type="number"
                  className="campo"
                  min={50}
                  max={2000}
                  step={10}
                  value={alto}
                  onChange={(e) => setAlto(Number(e.target.value))}
                />
              </div>
            </div>
          )}

          {forma === 'l' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="etiqueta" htmlFor="sala-rec-ancho">
                  Recorte ancho (cm)
                </label>
                <input
                  id="sala-rec-ancho"
                  type="number"
                  className="campo"
                  min={10}
                  step={10}
                  value={recorteAncho}
                  onChange={(e) => setRecorteAncho(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="etiqueta" htmlFor="sala-rec-alto">
                  Recorte largo (cm)
                </label>
                <input
                  id="sala-rec-alto"
                  type="number"
                  className="campo"
                  min={10}
                  step={10}
                  value={recorteAlto}
                  onChange={(e) => setRecorteAlto(Number(e.target.value))}
                />
              </div>
            </div>
          )}

          {sala?.mapa && forma !== 'rectangulo' && (
            <p className="text-[12px] text-precaucion">
              Si cambias la forma se borra el mapa: sus celdas ya no corresponderían con la habitación. Habrá que
              volver a reconocerla.
            </p>
          )}
          {medidas && (
            <p className="text-[12px] text-tinta-suave">
              Caja: {Math.round(medidas.ancho)} × {Math.round(medidas.alto)} cm
              {sala?.anchoRealCm ? ` · medido antes: ${sala.anchoRealCm} × ${sala.altoRealCm} cm` : ''}
            </p>
          )}
        </div>

        <div>
          <span className="etiqueta">Vista previa</span>
          {forma === 'dibujada' ? (
            <EditorPlanta vertices={dibujados} onCambiar={setDibujados} anchoCm={ancho} altoCm={alto} />
          ) : (
            <div className="h-[260px] overflow-hidden rounded-2xl">
              <MapaSala sala={{ vertices, puertas: [] }} etiquetas />
            </div>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-[13px] text-evasion">
          {error}
        </p>
      )}
      <div className="mt-6 flex gap-2">
        <button type="button" className="btn flex-1" onClick={onCerrar}>
          Cancelar
        </button>
        <button type="button" className="btn btn-acento flex-1" disabled={!valido} onClick={guardar}>
          {sala ? 'Guardar' : 'Crear habitación'}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Puertas
// ---------------------------------------------------------------------------

/**
 * Dibujar las puertas: dos toques sobre una pared y ese tramo pasa a ser puerta.
 *
 * Los dos extremos se pegan a la pared más cercana, porque una puerta que flote en medio del
 * cuarto no significa nada: lo que hace es tapar un hueco del borde para que el robot no se
 * escape por él (el backend la trata como pared y, si lo ve acercarse, lo desvía).
 */
export function DialogoPuertas({ sala, onCerrar }: { sala: SalaConMapa; onCerrar: () => void }) {
  const { guardarPuertas, rejilla, obstaculos } = useLidar();
  const toast = useToast();
  const [puertas, setPuertas] = useState<Puerta[]>(sala.puertas);
  const [inicio, setInicio] = useState<Punto | null>(null);
  const [raton, setRaton] = useState<Punto | null>(null);
  const paredes = useMemo(() => paredesDe({ vertices: sala.vertices, puertas: [] }), [sala.vertices]);

  /** Lleva el punto a la pared más cercana: una puerta vive en el borde. */
  const aLaPared = (p: Punto): Punto => {
    let mejor = { x: p.x, y: p.y, d: Infinity };
    for (const s of paredes) {
      const c = masCercanoEnSegmento(p.x, p.y, s);
      if (c.d < mejor.d) mejor = c;
    }
    return { x: Math.round(mejor.x), y: Math.round(mejor.y) };
  };

  const enCurso: Puerta | null =
    inicio && raton ? { x1: inicio.x, y1: inicio.y, ...puntoFin(aLaPared(raton)) } : null;

  function puntoFin(p: Punto) {
    return { x2: p.x, y2: p.y };
  }

  const tocar = (p: Punto) => {
    const pegado = aLaPared(p);
    if (!inicio) {
      setInicio(pegado);
      return;
    }
    const largo = Math.hypot(pegado.x - inicio.x, pegado.y - inicio.y);
    setInicio(null);
    if (largo < 20) {
      toast('Esa puerta es demasiado estrecha (mínimo 20 cm).', 'error');
      return;
    }
    setPuertas([...puertas, { x1: inicio.x, y1: inicio.y, x2: pegado.x, y2: pegado.y }]);
  };

  const guardar = async () => {
    try {
      await guardarPuertas.mutateAsync({ id: sala.id, puertas });
      toast('Puertas guardadas. El robot ya no se escapará por ahí.');
      onCerrar();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Modal etiqueta="Puertas de la habitación" ancho="max-w-3xl" onCerrar={onCerrar}>
      <h2 className="tarjeta-titulo mb-1">Puertas de {sala.nombre}</h2>
      <p className="tarjeta-sub mb-4">
        Toca los dos extremos del hueco sobre la pared. El robot verá ahí sitio libre y se iría; marcándolo como
        puerta, se queda dentro del cuarto.
      </p>

      <div className="h-[380px] overflow-hidden rounded-[var(--radius-tarjeta)]">
        <MapaSala
          sala={{ vertices: sala.vertices, puertas }}
          rejilla={rejilla}
          obstaculos={obstaculos}
          puertaEnCurso={enCurso}
          onPunto={tocar}
          onMover={setRaton}
          etiquetas
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <DoorOpen className="size-4 text-acento" />
        {puertas.length === 0 && <p className="text-[13px] text-tinta-suave">Ninguna puerta marcada.</p>}
        {puertas.map((p, i) => (
          <span key={i} className="chip">
            {Math.round(Math.hypot(p.x2 - p.x1, p.y2 - p.y1))} cm
            <button
              type="button"
              aria-label={`Quitar puerta ${i + 1}`}
              className="cursor-pointer text-evasion"
              onClick={() => setPuertas(puertas.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </span>
        ))}
        {inicio && <span className="text-[13px] text-acento">Toca el otro extremo…</span>}
      </div>

      <div className="mt-6 flex gap-2">
        <button type="button" className="btn flex-1" onClick={onCerrar}>
          Cancelar
        </button>
        <button type="button" className="btn btn-acento flex-1" onClick={guardar}>
          Guardar puertas
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Calibración
// ---------------------------------------------------------------------------

/**
 * Calibrar: medir cuánto gira y cuánto avanza el robot de verdad.
 *
 * Hace falta porque no hay encoders: el mapa se construye convirtiendo TIEMPO en ángulo, así
 * que si los grados por segundo están mal, el barrido sale estirado o comprimido y no encaja
 * con ninguna habitación. Y las dos medidas se toman con los propios sensores:
 *   - giro: girando en el sitio, el perfil del sonar se repite una vez por vuelta; de ahí sale
 *     el periodo (autocorrelación) y con él los grados por segundo.
 *   - avance: de frente a una pared, la distancia cae a una velocidad que es la del robot.
 */
export function DialogoCalibracion({ onCerrar }: { onCerrar: () => void }) {
  const { calibracion, calibrado, guardarCalibracion, ejecutar, modo, aviso } = useLidar();
  const toast = useToast();
  const [pwmGiro, setPwmGiro] = useState(calibracion.pwmGiro);
  const [pwmAvance, setPwmAvance] = useState(calibracion.pwmAvance);

  const midiendo = modo === 'calibrando_giro' || modo === 'calibrando_avance';

  const lanzar = async (accion: 'calibrar_giro' | 'calibrar_avance') => {
    try {
      // Los PWM se guardan antes: son el "a qué velocidad" de la medida que se va a tomar.
      await guardarCalibracion.mutateAsync({ ...calibracion, pwmGiro, pwmAvance });
      await ejecutar.mutateAsync({ accion });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Modal etiqueta="Calibrar el robot" ancho="max-w-lg" onCerrar={onCerrar}>
      <h2 className="tarjeta-titulo mb-1">Calibrar el robot</h2>
      <p className="tarjeta-sub mb-5">
        El robot no tiene encoders en las ruedas, así que no sabe cuánto ha girado: lo deduce del tiempo. Estas dos
        medidas son las que convierten tiempo en centímetros y en grados. Se miden con los mismos sensores de
        siempre, no hace falta nada más.
      </p>

      <div className="space-y-5">
        <section className="rounded-2xl border border-borde p-4">
          <h3 className="mb-1 flex items-center gap-2 text-[14px] font-semibold">
            <Compass className="size-4 text-acento" />
            Giro
          </h3>
          <p className="mb-3 text-[13px] text-tinta-suave">
            El robot dará unas vueltas sobre su eje en el sitio. Al girar, lo que ve se repite una vez por vuelta, y
            de ahí sale cuántos grados por segundo gira. Déjalo en una zona con muebles y paredes a la vista, no
            pegado a una esquina.
          </p>
          <div className="mb-3 flex items-end gap-3">
            <div className="flex-1">
              <label className="etiqueta" htmlFor="cal-pwm-giro">
                PWM de giro
              </label>
              <input
                id="cal-pwm-giro"
                type="number"
                className="campo"
                min={40}
                max={255}
                value={pwmGiro}
                onChange={(e) => setPwmGiro(Number(e.target.value))}
              />
            </div>
            <button
              type="button"
              className="btn btn-acento"
              disabled={midiendo}
              onClick={() => lanzar('calibrar_giro')}
            >
              {modo === 'calibrando_giro' ? 'Midiendo…' : 'Medir giro'}
            </button>
          </div>
          <p className="text-[13px]">
            Ahora: <strong>{calibracion.gradosPorSegundo} °/s</strong> a PWM {calibracion.pwmGiro}
          </p>
        </section>

        <section className="rounded-2xl border border-borde p-4">
          <h3 className="mb-1 flex items-center gap-2 text-[14px] font-semibold">
            <Gauge className="size-4 text-acento" />
            Avance
          </h3>
          <p className="mb-3 text-[13px] text-tinta-suave">
            Pon el robot mirando de frente a una pared lisa, a un par de metros. Avanzará hacia ella y la velocidad
            con que cae la distancia es su velocidad real. Se para solo a 25 cm de la pared.
          </p>
          <div className="mb-3 flex items-end gap-3">
            <div className="flex-1">
              <label className="etiqueta" htmlFor="cal-pwm-avance">
                PWM de avance
              </label>
              <input
                id="cal-pwm-avance"
                type="number"
                className="campo"
                min={40}
                max={255}
                value={pwmAvance}
                onChange={(e) => setPwmAvance(Number(e.target.value))}
              />
            </div>
            <button
              type="button"
              className="btn btn-acento"
              disabled={midiendo}
              onClick={() => lanzar('calibrar_avance')}
            >
              {modo === 'calibrando_avance' ? 'Midiendo…' : 'Medir avance'}
            </button>
          </div>
          <p className="text-[13px]">
            Ahora: <strong>{calibracion.cmPorSegundo} cm/s</strong> a PWM {calibracion.pwmAvance}
          </p>
        </section>

        {aviso && (
          <p role="status" className="rounded-2xl bg-tarjeta-tenue p-3 text-[13px]">
            {aviso}
          </p>
        )}
        {!calibrado && (
          <p className="text-[13px] text-precaucion">
            Sin calibrar, el mapa saldrá torcido: los valores de fábrica son una estimación, no una medida de tu
            robot.
          </p>
        )}
      </div>

      <button type="button" className="btn btn-acento mt-6 w-full" onClick={onCerrar}>
        Listo
      </button>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Medidas del robot
// ---------------------------------------------------------------------------

/**
 * Medidas del chasis y de dónde está cada sensor. Importan de verdad: el haz no nace en el
 * centro del robot, así que sin el desplazamiento del sensor cada punto medido se coloca unos
 * centímetros desviado, y eso en el mapa son obstáculos fantasma pegados a los de verdad.
 */
export function DialogoGeometria({ onCerrar }: { onCerrar: () => void }) {
  const { geometria, guardarGeometria } = useLidar();
  const toast = useToast();
  const [g, setG] = useState<GeometriaRobot>(geometria);

  const cambiarSensor = (s: Sensor, campo: 'x' | 'y' | 'anguloDeg', valor: number) =>
    setG({ ...g, sensores: { ...g.sensores, [s]: { ...g.sensores[s], [campo]: valor } } });

  const guardar = async () => {
    try {
      await guardarGeometria.mutateAsync(g);
      toast('Medidas guardadas.');
      onCerrar();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Modal etiqueta="Medidas del robot" ancho="max-w-xl" onCerrar={onCerrar}>
      <h2 className="tarjeta-titulo mb-1">Medidas del robot</h2>
      <p className="tarjeta-sub mb-5">
        Con una cinta métrica sobre el robot. <strong>x</strong> es hacia delante y <strong>y</strong> hacia la
        derecha, en centímetros desde el centro del eje de las ruedas. El ángulo es hacia dónde apunta cada sensor,
        negativo a la izquierda.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="etiqueta" htmlFor="geo-radio">
            Radio del chasis (cm)
          </label>
          <input
            id="geo-radio"
            type="number"
            className="campo"
            min={3}
            max={100}
            step={0.5}
            value={g.radioChasisCm}
            onChange={(e) => setG({ ...g, radioChasisCm: Number(e.target.value) })}
          />
        </div>
        <div>
          <label className="etiqueta" htmlFor="geo-ruedas">
            Separación de ruedas (cm)
          </label>
          <input
            id="geo-ruedas"
            type="number"
            className="campo"
            min={3}
            max={100}
            step={0.5}
            value={g.separacionRuedasCm}
            onChange={(e) => setG({ ...g, separacionRuedasCm: Number(e.target.value) })}
          />
        </div>
      </div>

      <table className="mt-5 w-full text-[13px]">
        <thead>
          <tr className="text-left text-tinta-suave">
            <th className="pb-2 font-medium">Sensor</th>
            <th className="pb-2 font-medium">x (cm)</th>
            <th className="pb-2 font-medium">y (cm)</th>
            <th className="pb-2 font-medium">Ángulo (°)</th>
          </tr>
        </thead>
        <tbody>
          {SENSORES.map((s) => (
            <tr key={s}>
              <td className="py-1 pr-2">{NOMBRE_SENSOR[s]}</td>
              {(['x', 'y', 'anguloDeg'] as const).map((campo) => (
                <td key={campo} className="py-1 pr-2">
                  <input
                    type="number"
                    aria-label={`${NOMBRE_SENSOR[s]} ${campo}`}
                    className="campo h-9 px-2 text-[13px]"
                    step={campo === 'anguloDeg' ? 1 : 0.5}
                    value={g.sensores[s][campo]}
                    onChange={(e) => cambiarSensor(s, campo, Number(e.target.value))}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-3 flex items-start gap-2 text-[12px] text-tinta-suave">
        <Ruler className="mt-0.5 size-4 shrink-0" />
        La separación de ruedas solo se usa como respaldo: en cuanto el robot está calibrado, el giro sale de los
        grados por segundo medidos, que ya incluyen el patinaje de las ruedas.
      </p>

      <div className="mt-6 flex gap-2">
        <button type="button" className="btn flex-1" onClick={onCerrar}>
          Cancelar
        </button>
        <button type="button" className="btn btn-acento flex-1" onClick={guardar}>
          Guardar medidas
        </button>
      </div>
    </Modal>
  );
}
