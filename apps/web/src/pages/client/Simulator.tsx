import { SERIES, type SeriesKey } from '@iot/shared';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CLIENT_STATUS_CHANGED } from '../../components/AppLayout.tsx';
import { Elapsed, ErrorNote, Field, LiveDot, PageHeader } from '../../components/ui.tsx';
import { ApiError, api, errorMessage } from '../../lib/api.ts';
import { useLiveEvents } from '../../lib/live.tsx';
import { seriesLabel, texToText } from '../../lib/series-ui.ts';
import type { ClientStatus } from '../../lib/types.ts';

export function Simulator() {
  const [status, setStatus] = useState<ClientStatus | null>(null);
  const [seriesKey, setSeriesKey] = useState<SeriesKey>('pi_leibniz');
  const [intervalMs, setIntervalMs] = useState('250');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<ClientStatus>('/api/client/status')
      .then(setStatus)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  useLiveEvents((m) => m.type !== 'hello' && load());

  async function call(path: string, body?: object) {
    setBusy(true);
    setError('');
    setFields({});
    try {
      await api(path, { method: 'POST', body: body ?? {} });
      load();
    } catch (e) {
      const err = e as ApiError;
      setFields(err.fields ?? {});
      if (!Object.keys(err.fields ?? {}).length) setError(err.message);
      if (err.status === 409) window.dispatchEvent(new Event(CLIENT_STATUS_CHANGED));
    } finally {
      setBusy(false);
    }
  }

  if (status?.hasDevice) {
    return (
      <>
        <PageHeader title="Simulador" />
        <p className="panel max-w-2xl px-5 py-4">
          El envío lo controla ahora tu ESP32. Consulta tus sesiones en{' '}
          <Link to="/envios" className="underline underline-offset-2">Mis envíos</Link>.
        </p>
      </>
    );
  }

  const sim = status?.simulation;
  const run = status?.activeRun;

  return (
    <>
      <PageHeader title="Simulador" subtitle="Envía una serie desde el navegador, por el mismo camino MQTT que un ESP32." />
      <ErrorNote>{error}</ErrorNote>

      {sim && (
        <section className="panel mb-6 flex max-w-2xl flex-wrap items-center gap-x-8 gap-y-3 border-l-2 border-l-signal px-5 py-4">
          <LiveDot label={`Enviando ${seriesLabel(sim.seriesKey)}`} />
          <span className="font-mono text-[13px] text-ink-soft">cada {sim.intervalMs} ms</span>
          {run && (
            <span className="text-[18px]">
              <Elapsed from={run.startedAt} />
            </span>
          )}
          <button type="button" className="btn ml-auto" disabled={busy} onClick={() => call('/api/simulate/stop')}>
            Detener envío
          </button>
        </section>
      )}

      <form
        className="flex max-w-2xl flex-col gap-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          call('/api/simulate/start', { seriesKey, intervalMs: Number(intervalMs) });
        }}
      >
        <fieldset>
          <legend className="label">Serie</legend>
          <div className="panel">
            {SERIES.map((s) => (
              <label key={s.key} className="flex cursor-pointer items-baseline gap-3 border-b border-grid px-4 py-2.5 last:border-b-0 has-checked:bg-paper">
                <input type="radio" name="series" value={s.key} checked={seriesKey === s.key} onChange={() => setSeriesKey(s.key)} />
                <span className="w-12 font-mono">{s.symbol}</span>
                <span className="flex-1">{s.label}</span>
                <span className="hidden font-mono text-[13px] text-ink-soft sm:inline">{texToText(s.formulaTex)}</span>
              </label>
            ))}
          </div>
          {fields.seriesKey && <p className="field-error">{fields.seriesKey}</p>}
        </fieldset>
        <div className="max-w-[200px]">
          <Field label="Intervalo entre muestras (ms)" error={fields.intervalMs}>
            {(p) => <input {...p} type="number" min={50} max={10000} step={50} className="input font-mono" value={intervalMs} onChange={(e) => setIntervalMs(e.target.value)} />}
          </Field>
        </div>
        <div>
          <button className="btn btn-primary" disabled={busy}>
            {sim ? 'Cambiar a esta serie' : 'Iniciar envío'}
          </button>
        </div>
      </form>
    </>
  );
}
