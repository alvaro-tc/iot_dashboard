// Datos en vivo de un cliente para el panel del administrador.
//
// Orden de arranque, para que la unión histórico + tiempo real no tenga huecos ni duplicados:
//   1. Suscribirse al WebSocket y ENCOLAR todo lo que llegue.
//   2. Cargar el histórico por REST (sesiones + 7 series).
//   3. Sustituir el buffer por el histórico y aplicar la cola. Lo que ya venía en el REST se
//      descarta por sample.id; lo que llegó durante la carga se añade.
// Cada reconexión del socket repite 2–3, porque durante el corte se pudieron perder eventos.
//
// Agrupamiento: los eventos se aplican al estado de React como mucho cada 100 ms. Actualizar
// el estado por cada mensaje congela la interfaz con intervalos de envío cortos.
import { SERIES, type SeriesKey } from '@iot/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import { useLive, type LiveMessage } from '../lib/live.tsx';
import type { Run, Sample } from '../lib/types.ts';

type SamplesBySeries = Record<SeriesKey, Sample[]>;

interface Store {
  runs: Map<number, Run>;
  samples: SamplesBySeries;
  ids: Set<number>;
}

export interface LiveSnapshot {
  runs: Run[];
  samples: SamplesBySeries;
  /** ids de las muestras que llegaron en el último lote, para el destello. */
  fresh: Set<number>;
}

const emptySamples = () => Object.fromEntries(SERIES.map((s) => [s.key, []])) as unknown as SamplesBySeries;
const emptyStore = (): Store => ({ runs: new Map(), samples: emptySamples(), ids: new Set() });

const sortRuns = (runs: Run[]) =>
  runs.sort((a, b) =>
    a.status !== b.status ? (a.status === 'active' ? -1 : 1) : b.startedAt.localeCompare(a.startedAt),
  );

// ponytail: el buffer crece sin límite durante la vista (el gráfico sí se limita a 2000 puntos al
// pintar). Con horas de envío a 100 ms convendría recortar las series más antiguas aquí.
function apply(s: Store, msgs: LiveMessage[]): Set<number> {
  const fresh = new Set<number>();
  const added: Partial<SamplesBySeries> = {};
  for (const m of msgs) {
    if (m.type === 'sample') {
      const p = m.payload;
      if (s.ids.has(p.id)) continue;
      s.ids.add(p.id);
      fresh.add(p.id);
      (added[p.seriesKey] ??= []).push(p);
      const r = s.runs.get(p.runId);
      if (r) {
        s.runs.set(r.id, {
          ...r,
          sampleCount: (r.sampleCount ?? 0) + 1,
          lastIteration: p.iteration,
          lastValue: p.value,
          lastErrorAbs: p.errorAbs,
        });
      }
    } else if (m.type === 'run_start') {
      const p = m.payload;
      if (!s.runs.has(p.runId)) {
        s.runs.set(p.runId, {
          id: p.runId,
          userId: p.userId ?? 0,
          userName: '',
          seriesKey: p.seriesKey,
          status: 'active',
          startedAt: p.startedAt,
          endedAt: null,
          source: p.source,
          deviceId: null,
          deviceName: p.deviceName,
          sampleCount: 0,
          lastIteration: 0,
          lastValue: null,
          lastErrorAbs: null,
        });
      }
    } else if (m.type === 'run_end') {
      const p = m.payload;
      const r = s.runs.get(p.runId);
      if (r) {
        s.runs.set(r.id, {
          ...r,
          status: 'finished',
          endedAt: p.endedAt,
          sampleCount: p.sampleCount ?? r.sampleCount,
          lastValue: p.lastValue ?? r.lastValue,
          lastErrorAbs: p.lastErrorAbs ?? r.lastErrorAbs,
        });
      }
    }
  }
  for (const key of Object.keys(added) as SeriesKey[]) s.samples[key] = s.samples[key].concat(added[key]!);
  return fresh;
}

export function useLiveSamples(userId: number) {
  const { subscribe, connectionId, status } = useLive();
  const store = useRef<Store>(emptyStore());
  const queue = useRef<LiveMessage[]>([]);
  const loadingRef = useRef(true);
  const [snapshot, setSnapshot] = useState<LiveSnapshot>({ runs: [], samples: emptySamples(), fresh: new Set() });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const publish = useCallback((fresh: Set<number>) => {
    const s = store.current;
    setSnapshot({ runs: sortRuns([...s.runs.values()]), samples: { ...s.samples }, fresh });
  }, []);

  // 1. Suscripción + agrupamiento cada 100 ms.
  useEffect(() => {
    const unsubscribe = subscribe((m) => {
      if (m.type !== 'hello' && m.payload.userId === userId) queue.current.push(m);
    });
    const timer = setInterval(() => {
      if (loadingRef.current || queue.current.length === 0) return;
      publish(apply(store.current, queue.current.splice(0)));
    }, 100);
    return () => {
      unsubscribe();
      clearInterval(timer);
      queue.current = [];
    };
  }, [userId, subscribe, publish]);

  // 2–3. Histórico, al abrir la vista y en cada reconexión. Si el socket no conecta, se carga igual.
  const canLoad = connectionId > 0 || status === 'offline';
  useEffect(() => {
    if (!canLoad) return;
    let cancelled = false;
    loadingRef.current = true;
    setLoading(true);
    Promise.all([
      api<Run[]>(`/api/admin/users/${userId}/runs`),
      Promise.all(SERIES.map((s) => api<{ samples: Sample[] }>(`/api/admin/users/${userId}/series/${s.key}`))),
    ])
      .then(([runs, series]) => {
        if (cancelled) return;
        const next = emptyStore();
        for (const r of runs) next.runs.set(r.id, r);
        SERIES.forEach((s, i) => {
          next.samples[s.key] = series[i].samples;
          for (const x of series[i].samples) next.ids.add(x.id);
        });
        store.current = next;
        apply(next, queue.current.splice(0));
        publish(new Set());
        setError(null);
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => {
        if (cancelled) return;
        loadingRef.current = false;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, connectionId, canLoad, reloadTick, publish]);

  const reload = useCallback(() => setReloadTick((n) => n + 1), []);
  return { ...snapshot, loading, error, reload };
}
