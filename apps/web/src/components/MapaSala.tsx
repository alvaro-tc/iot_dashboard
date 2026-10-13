// El plano de la habitación, dibujado en vivo.
//
// Lo usan tres sitios con el mismo componente: el widget del panel, la página del lidar y el
// modal grande del mapeo. Lo único que cambia entre ellos es el tamaño y si se muestran las
// etiquetas, así que no hay tres dibujos que mantener sincronizados.
//
// CÓMO SE DIBUJA (y por qué así)
//   - La rejilla de ocupación se pinta UNA VEZ por actualización en un lienzo aparte y después
//     se estampa escalada. Son hasta ~10.000 celdas: pintarlas una a una en cada fotograma
//     tiraría los 60 fps, y la rejilla solo cambia una vez por barrido.
//   - Lo que se mueve (el robot, los haces de los sensores, el barrido girando) se redibuja en
//     cada fotograma encima. Es poca cosa y es lo que da la sensación de tiempo real.
//   - El recuadro va oscuro en los dos temas, como el radar y como la animación del login: el
//     mapa es "lo que ve el robot", y eso se lee mejor sobre oscuro.
//
// El marco es el de la sala (cm, y hacia abajo, ver packages/shared/src/lidar.ts), que coincide
// con el del lienzo: no hay que invertir nada, solo escalar.
import { useEffect, useMemo, useRef } from 'react';
import {
  ESCALA_LOGODDS,
  UMBRAL_LIBRE,
  UMBRAL_OCUPADO,
  caja,
  radianes,
  type GeometriaRobot,
  type Obstaculo,
  type Pose,
  type Puerta,
  type Punto,
  type Rejilla,
  type Sala,
  type Sensor,
} from '@iot/shared';
import { useColoresTema } from '../lib/tema.tsx';

export interface Props {
  sala: Pick<Sala, 'vertices' | 'puertas'>;
  rejilla?: Rejilla | null;
  obstaculos?: Obstaculo[];
  /** Dónde está el robot. null = no se sabe (sin barrido todavía). */
  pose?: Pose | null;
  /** Distancias de los tres sensores ahora mismo, para dibujar los haces. */
  distancias?: Record<Sensor, number | null> | null;
  geometria?: GeometriaRobot | null;
  /** `barriendo` enciende la línea de barrido girando. */
  animacion?: 'ninguna' | 'barriendo' | 'limpiando';
  /** Etiquetas de los obstáculos y cotas de la sala: estorban en el widget pequeño. */
  etiquetas?: boolean;
  /** Puerta a medio dibujar, mientras el cliente la coloca. */
  puertaEnCurso?: Puerta | null;
  className?: string;
  /** Clic en el plano, en cm del marco de la sala (lo usa el dibujo de puertas). */
  onPunto?: (p: Punto) => void;
  onMover?: (p: Punto) => void;
}

/** Tonos de los tres sensores, los mismos que el radar: son identidad, no estado. */
const TONO_SENSOR: Record<Sensor, string> = { izquierdo: '#38bdf8', central: '#c084fc', derecho: '#fb923c' };
const SENSORES: Sensor[] = ['izquierdo', 'central', 'derecho'];
/** Semiancho del haz que se dibuja. Es el del HC-SR04, no un adorno. */
const SEMIHAZ_DIBUJO = 11;

/** Cómo se dibuja cada clase de obstáculo. El color dice "esto está ocupado", no el peligro. */
const ETIQUETA_FORMA: Record<Obstaculo['forma'], string> = {
  caja: 'Mueble',
  redondo: 'Redondo',
  alargado: 'Alargado',
  irregular: 'Obstáculo',
};

export function MapaSala({
  sala,
  rejilla = null,
  obstaculos = [],
  pose = null,
  distancias = null,
  geometria = null,
  animacion = 'ninguna',
  etiquetas = true,
  puertaEnCurso = null,
  className = '',
  onPunto,
  onMover,
}: Props) {
  const lienzoRef = useRef<HTMLCanvasElement>(null);
  const colores = useColoresTema();

  // Lo que cambia en cada fotograma se lee de refs: el bucle de animación se monta una sola vez
  // y no puede cerrar sobre props viejas.
  const datos = useRef({ sala, rejilla, obstaculos, pose, distancias, geometria, animacion, etiquetas, puertaEnCurso, colores });
  datos.current = { sala, rejilla, obstaculos, pose, distancias, geometria, animacion, etiquetas, puertaEnCurso, colores };

  const cajaSala = useMemo(() => caja(sala.vertices), [sala.vertices]);

  /**
   * La rejilla, ya pintada. Se rehace solo cuando cambia (una vez por barrido), no por
   * fotograma: es la diferencia entre 60 fps y 4.
   */
  const capaRejilla = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!rejilla) {
      capaRejilla.current = null;
      return;
    }
    const off = document.createElement('canvas');
    off.width = rejilla.cols;
    off.height = rejilla.filas;
    const ctx = off.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(rejilla.cols, rejilla.filas);

    for (let i = 0; i < rejilla.datos.length; i++) {
      const l = rejilla.datos[i] / ESCALA_LOGODDS;
      const p = i * 4;
      if (l >= UMBRAL_OCUPADO) {
        // Ocupado: del ámbar al rojo según la confianza. Es lo que tiene que saltar a la vista.
        const t = Math.min(1, (l - UMBRAL_OCUPADO) / 6);
        img.data[p] = 255;
        img.data[p + 1] = Math.round(190 - 120 * t);
        img.data[p + 2] = Math.round(90 - 60 * t);
        img.data[p + 3] = Math.round(140 + 115 * t);
      } else if (l <= UMBRAL_LIBRE) {
        // Libre: verde agua apagado, para que se lea como "sitio por donde pasar" sin competir.
        const t = Math.min(1, (UMBRAL_LIBRE - l) / 6);
        img.data[p] = 16;
        img.data[p + 1] = Math.round(120 + 65 * t);
        img.data[p + 2] = Math.round(110 + 40 * t);
        img.data[p + 3] = Math.round(40 + 70 * t);
      } else {
        // Sin opinión: transparente. El hueco en el plano ES la información (falta explorar).
        img.data[p + 3] = 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    capaRejilla.current = off;
  }, [rejilla]);

  useEffect(() => {
    const lienzo = lienzoRef.current;
    if (!lienzo) return;
    const ctx = lienzo.getContext('2d');
    if (!ctx) return;

    let animando = true;
    let cuadro = 0;

    const dibujar = () => {
      if (!animando) return;
      cuadro++;
      const d = datos.current;
      const c = d.colores;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const ancho = lienzo.clientWidth;
      const alto = lienzo.clientHeight;
      if (lienzo.width !== Math.round(ancho * dpr) || lienzo.height !== Math.round(alto * dpr)) {
        lienzo.width = Math.round(ancho * dpr);
        lienzo.height = Math.round(alto * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, ancho, alto);

      // --- Transformación cm -> px, con la sala centrada y sin deformar ---
      const margen = d.etiquetas ? 28 : 12;
      const cs = caja(d.sala.vertices);
      const escala = Math.min((ancho - margen * 2) / Math.max(1, cs.ancho), (alto - margen * 2) / Math.max(1, cs.alto));
      const ox = (ancho - cs.ancho * escala) / 2;
      const oy = (alto - cs.alto * escala) / 2;
      const X = (x: number) => ox + x * escala;
      const Y = (y: number) => oy + y * escala;

      // --- Fondo del recuadro ---
      const fondo = ctx.createLinearGradient(0, 0, 0, alto);
      fondo.addColorStop(0, c.tema === 'oscuro' ? '#070d1a' : '#111c33');
      fondo.addColorStop(1, c.lienzoMapa);
      ctx.fillStyle = fondo;
      ctx.fillRect(0, 0, ancho, alto);

      // --- Retícula de medio metro, muy tenue: da escala sin ensuciar ---
      ctx.strokeStyle = 'rgba(148,163,184,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= cs.ancho; x += 50) {
        ctx.moveTo(X(x), Y(0));
        ctx.lineTo(X(x), Y(cs.alto));
      }
      for (let y = 0; y <= cs.alto; y += 50) {
        ctx.moveTo(X(0), Y(y));
        ctx.lineTo(X(cs.ancho), Y(y));
      }
      ctx.stroke();

      // --- El suelo de la habitación: el polígono, recortado para todo lo de dentro ---
      const camino = new Path2D();
      d.sala.vertices.forEach((v, i) => (i ? camino.lineTo(X(v.x), Y(v.y)) : camino.moveTo(X(v.x), Y(v.y))));
      camino.closePath();

      ctx.save();
      ctx.clip(camino);
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.fillRect(0, 0, ancho, alto);

      // --- La rejilla de ocupación, estampada escalada ---
      const capa = capaRejilla.current;
      if (capa && d.rejilla) {
        ctx.imageSmoothingEnabled = true;
        ctx.globalAlpha = 0.95;
        ctx.drawImage(capa, X(0), Y(0), d.rejilla.cols * d.rejilla.res * escala, d.rejilla.filas * d.rejilla.res * escala);
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      // --- Las paredes: trazo luminoso por fuera y línea fina por dentro ---
      ctx.save();
      ctx.shadowColor = 'rgba(56,189,248,0.55)';
      ctx.shadowBlur = 12;
      ctx.strokeStyle = 'rgba(186,230,253,0.95)';
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.stroke(camino);
      ctx.restore();

      // --- Puertas: el hueco que NO es salida ---
      const puertas = [...d.sala.puertas, ...(d.puertaEnCurso ? [d.puertaEnCurso] : [])];
      for (const p of puertas) {
        const enCurso = p === d.puertaEnCurso;
        ctx.save();
        // Se tapa la pared por debajo y se marca el hueco: así se ve que ahí hay paso.
        ctx.strokeStyle = c.lienzoMapa;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(X(p.x1), Y(p.y1));
        ctx.lineTo(X(p.x2), Y(p.y2));
        ctx.stroke();

        ctx.strokeStyle = enCurso ? 'rgba(249,115,22,0.75)' : c.acento;
        ctx.lineWidth = 3;
        ctx.setLineDash(enCurso ? [6, 5] : [10, 6]);
        ctx.shadowColor = 'rgba(249,115,22,0.6)';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(X(p.x1), Y(p.y1));
        ctx.lineTo(X(p.x2), Y(p.y2));
        ctx.stroke();
        ctx.restore();

        if (d.etiquetas && !enCurso) {
          ctx.fillStyle = c.acento;
          ctx.font = '600 10px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText(p.nombre || 'Puerta', X((p.x1 + p.x2) / 2), Y((p.y1 + p.y2) / 2) - 8);
        }
      }

      // --- Obstáculos: la forma reconocida, encima de sus celdas ---
      for (const o of d.obstaculos) {
        ctx.save();
        ctx.translate(X(o.cx), Y(o.cy));
        ctx.strokeStyle = 'rgba(253,186,116,0.95)';
        ctx.fillStyle = 'rgba(249,115,22,0.16)';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(249,115,22,0.5)';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        if (o.forma === 'redondo') {
          ctx.arc(0, 0, Math.max(3, o.radioCm * escala), 0, Math.PI * 2);
        } else {
          ctx.rotate(radianes(o.anguloDeg));
          const w = Math.max(5, o.anchoCm * escala);
          const h = Math.max(5, o.altoCm * escala);
          // Esquinas redondeadas: un mueble medido por sonar no tiene aristas exactas, y
          // dibujarlas afiladas da una precisión que el sensor no tiene.
          const r = Math.min(6, w / 4, h / 4);
          ctx.roundRect(-w / 2, -h / 2, w, h, r);
        }
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        if (d.etiquetas) {
          const texto =
            o.forma === 'redondo'
              ? `${ETIQUETA_FORMA[o.forma]} ⌀${Math.round(o.radioCm * 2)}`
              : `${ETIQUETA_FORMA[o.forma]} ${Math.round(o.anchoCm)}×${Math.round(o.altoCm)}`;
          ctx.font = '600 10px system-ui';
          ctx.textAlign = 'center';
          const py = Y(o.cy) - (o.forma === 'redondo' ? o.radioCm * escala : (o.altoCm * escala) / 2) - 6;
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(2,6,23,0.85)';
          ctx.strokeText(texto, X(o.cx), py);
          ctx.fillStyle = '#fed7aa';
          ctx.fillText(texto, X(o.cx), py);
        }
      }

      // --- El robot y lo que está viendo ---
      if (d.pose) {
        const px = X(d.pose.x);
        const py = Y(d.pose.y);
        const radio = Math.max(7, (d.geometria?.radioChasisCm ?? 17) * escala);

        // Haces de los tres sensores, con la distancia medida ahora mismo.
        if (d.distancias && d.geometria) {
          for (const sensor of SENSORES) {
            const medida = d.distancias[sensor];
            const mont = d.geometria.sensores[sensor];
            const a = radianes(d.pose.th);
            const sx = X(d.pose.x + mont.x * Math.cos(a) - mont.y * Math.sin(a));
            const sy = Y(d.pose.y + mont.x * Math.sin(a) + mont.y * Math.cos(a));
            const dir = radianes(d.pose.th + mont.anguloDeg);
            // Sin eco, el haz se dibuja largo y desvanecido: "no veo nada ahí".
            const largo = (medida ?? 110) * escala;
            const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(1, largo));
            grad.addColorStop(0, `${TONO_SENSOR[sensor]}${medida === null ? '22' : '55'}`);
            grad.addColorStop(1, `${TONO_SENSOR[sensor]}00`);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.arc(sx, sy, largo, dir - radianes(SEMIHAZ_DIBUJO), dir + radianes(SEMIHAZ_DIBUJO));
            ctx.closePath();
            ctx.fill();

            if (medida !== null) {
              // El punto del impacto, latiendo: es la lectura de verdad.
              const pulso = 0.6 + 0.4 * Math.sin(cuadro / 9);
              const ix = sx + Math.cos(dir) * largo;
              const iy = sy + Math.sin(dir) * largo;
              ctx.fillStyle = TONO_SENSOR[sensor];
              ctx.globalAlpha = pulso;
              ctx.beginPath();
              ctx.arc(ix, iy, 3.5, 0, Math.PI * 2);
              ctx.fill();
              ctx.globalAlpha = 1;
            }
          }
        }

        // Línea de barrido girando: solo mientras barre, y gira de verdad (no es un adorno
        // suelto: indica que el robot está dando vueltas sobre su eje).
        if (d.animacion === 'barriendo') {
          const a = radianes(cuadro * 3);
          const largoBarrido = Math.max(cs.ancho, cs.alto) * escala;
          const grad = ctx.createLinearGradient(px, py, px + Math.cos(a) * largoBarrido, py + Math.sin(a) * largoBarrido);
          grad.addColorStop(0, 'rgba(56,189,248,0.55)');
          grad.addColorStop(1, 'rgba(56,189,248,0)');
          ctx.strokeStyle = grad;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + Math.cos(a) * largoBarrido, py + Math.sin(a) * largoBarrido);
          ctx.stroke();
        }

        // El chasis, igual que el robot de la animación del login: disco blanco, centro naranja
        // y las dos ruedas. Gira con la orientación, que es lo que hace legible "a dónde mira".
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(radianes(d.pose.th));
        ctx.shadowColor = 'rgba(249,115,22,0.55)';
        ctx.shadowBlur = 14;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, radio, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = c.acento;
        ctx.beginPath();
        ctx.arc(0, 0, radio * 0.34, 0, Math.PI * 2);
        ctx.fill();
        // Ruedas (a los lados, perpendiculares al avance) y morro.
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(-radio * 0.3, -radio * 1.08, radio * 0.6, radio * 0.26);
        ctx.fillRect(-radio * 0.3, radio * 0.82, radio * 0.6, radio * 0.26);
        ctx.beginPath();
        ctx.moveTo(radio * 0.95, 0);
        ctx.lineTo(radio * 0.2, -radio * 0.42);
        ctx.lineTo(radio * 0.2, radio * 0.42);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // --- Cotas de la sala ---
      if (d.etiquetas) {
        ctx.fillStyle = 'rgba(226,232,240,0.75)';
        ctx.font = '600 11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(cs.ancho)} cm`, X(cs.ancho / 2), Y(0) - 10);
        ctx.save();
        ctx.translate(X(0) - 12, Y(cs.alto / 2));
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(`${Math.round(cs.alto)} cm`, 0, 0);
        ctx.restore();
      }

      requestAnimationFrame(dibujar);
    };

    requestAnimationFrame(dibujar);
    return () => {
      animando = false;
    };
  }, []);

  /** Clic y arrastre, en cm del marco de la sala: es como se dibuja una puerta. */
  const aCm = (e: React.PointerEvent<HTMLCanvasElement>): Punto | null => {
    const lienzo = lienzoRef.current;
    if (!lienzo) return null;
    const r = lienzo.getBoundingClientRect();
    const margen = etiquetas ? 28 : 12;
    const escala = Math.min(
      (r.width - margen * 2) / Math.max(1, cajaSala.ancho),
      (r.height - margen * 2) / Math.max(1, cajaSala.alto),
    );
    if (escala <= 0) return null;
    const ox = (r.width - cajaSala.ancho * escala) / 2;
    const oy = (r.height - cajaSala.alto * escala) / 2;
    return { x: (e.clientX - r.left - ox) / escala, y: (e.clientY - r.top - oy) / escala };
  };

  const resumen = `Plano de la habitación. ${obstaculos.length} obstáculo(s) detectado(s)${
    sala.puertas.length ? `, ${sala.puertas.length} puerta(s)` : ''
  }.`;

  return (
    <canvas
      ref={lienzoRef}
      className={`size-full ${onPunto ? 'cursor-crosshair' : ''} ${className}`}
      role="img"
      aria-label={resumen}
      onPointerDown={onPunto ? (e) => { const p = aCm(e); if (p) onPunto(p); } : undefined}
      onPointerMove={onMover ? (e) => { const p = aCm(e); if (p) onMover(p); } : undefined}
    />
  );
}
