import { SERIES_KEYS } from '@iot/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CLIENT_STATUS_CHANGED } from '../../components/AppLayout.tsx';
import { CopyButton, Dialog, ErrorNote, Field, LiveDot, PageHeader, SectionTitle } from '../../components/ui.tsx';
import { ApiError, api, errorMessage } from '../../lib/api.ts';
import { useLiveEvents } from '../../lib/live.tsx';
import { formatDateTime } from '../../lib/time.ts';
import { useToast } from '../../lib/toast.tsx';
import type { ClientStatus, Device as DeviceT } from '../../lib/types.ts';

interface LinkResult {
  device: DeviceT;
  token: string;
  userId: number;
  broker: { host: string; port: number };
}

function firmwareSnippet(r: LinkResult) {
  return `// Primera Evaluación IoT: configuración del ESP32
#define DEVICE_ID     "${r.device.id}"
#define DEVICE_TOKEN  "${r.token}"
#define MQTT_HOST     "${r.broker.host}"
#define MQTT_PORT     ${r.broker.port}
// Serie a enviar: ${SERIES_KEYS.join(', ')}
#define MQTT_TOPIC    "telemetry/${r.userId}/pi_leibniz"

// Conexión (PubSubClient): usuario = DEVICE_ID, contraseña = DEVICE_TOKEN
//   mqtt.setServer(MQTT_HOST, MQTT_PORT);
//   mqtt.connect(DEVICE_ID, DEVICE_ID, DEVICE_TOKEN);
// Publicación en la iteración k (double, nunca float):
//   char buf[128];
//   snprintf(buf, sizeof buf, "{\\"iteration\\":%d,\\"value\\":%.10f,\\"deviceId\\":\\"%s\\"}", k, value, DEVICE_ID);
//   mqtt.publish(MQTT_TOPIC, buf);`;
}

function TokenReveal({ result, onDone }: { result: LinkResult; onDone: () => void }) {
  const snippet = firmwareSnippet(result);
  return (
    <section className="panel mb-8 border-l-2 border-l-ink p-5" aria-labelledby="token-title">
      <h2 id="token-title" className="text-[18px]">ESP32 vinculado</h2>
      <p className="mt-1 mb-4 text-deviation">Copia el token ahora. No se volverá a mostrar.</p>
      <dl className="mb-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-[13px]">
        <dt className="text-ink-soft">Identificador</dt>
        <dd className="font-mono">{result.device.id}</dd>
        <dt className="text-ink-soft">Token</dt>
        <dd className="flex flex-wrap items-center gap-3">
          <code className="font-mono text-[15px] break-all">{result.token}</code>
          <CopyButton text={result.token} label="Copiar token" />
        </dd>
      </dl>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[13px] text-ink-soft">Configuración para el firmware</p>
        <CopyButton text={snippet} label="Copiar código" />
      </div>
      <pre className="overflow-x-auto border border-grid bg-paper p-4 font-mono text-[13px] leading-[1.4]">{snippet}</pre>
      <button type="button" className="btn mt-4" onClick={onDone}>
        Ya lo he copiado
      </button>
    </section>
  );
}

export function Device() {
  const toast = useToast();
  const [status, setStatus] = useState<ClientStatus | null>(null);
  const [error, setError] = useState('');
  const [linked, setLinked] = useState<LinkResult | null>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const load = useCallback(() => {
    api<ClientStatus>('/api/client/status')
      .then((s) => (setStatus(s), setError('')))
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  useLiveEvents((m) => m.type !== 'hello' && load());

  async function link(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNameError('');
    setError('');
    try {
      const r = await api<LinkResult>('/api/devices', { method: 'POST', body: { name } });
      setLinked(r);
      setName('');
      load();
      window.dispatchEvent(new Event(CLIENT_STATUS_CHANGED));
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.fields?.name) setNameError(apiErr.fields.name);
      else setError(apiErr.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      await api(`/api/devices/${status!.device!.id}`, { method: 'DELETE' });
      toast('Dispositivo revocado');
      setConfirmRevoke(false);
      setLinked(null);
      load();
      window.dispatchEvent(new Event(CLIENT_STATUS_CHANGED));
    } catch (err) {
      setError(errorMessage(err));
      setConfirmRevoke(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Mi dispositivo" />
      <ErrorNote>{error}</ErrorNote>
      {linked && <TokenReveal result={linked} onDone={() => setLinked(null)} />}

      {status && !status.hasDevice && (
        <section className="panel max-w-2xl p-6">
          <p className="mb-3 text-[18px]">Aún no has vinculado ningún dispositivo. Vincula uno para empezar a recibir datos.</p>
          <ul className="mb-5 list-disc pl-5 text-ink-soft">
            <li>Crearemos un usuario y un token propios para tu ESP32 en el broker MQTT.</li>
            <li>Verás el token una sola vez, junto con el código listo para pegar en el firmware.</li>
            <li>A partir de ese momento el envío lo controla el ESP32 y el simulador web se desactiva.</li>
          </ul>
          <form onSubmit={link} className="flex flex-wrap items-end gap-3" noValidate>
            <div className="w-full max-w-xs">
              <Field label="Nombre del dispositivo" error={nameError}>
                {(p) => <input {...p} className="input" placeholder="Sensor laboratorio" value={name} onChange={(e) => setName(e.target.value)} />}
              </Field>
            </div>
            <button className="btn btn-primary" disabled={busy}>
              Vincular ESP32
            </button>
          </form>
        </section>
      )}

      {status?.device && (
        <section className="max-w-2xl">
          <SectionTitle>{status.device.name}</SectionTitle>
          <dl className="panel grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 p-5 text-[15px]">
            <dt className="text-ink-soft">Estado</dt>
            <dd>{status.deviceOnline ? <LiveDot label="en línea" /> : <span className="text-ink-soft">inactivo</span>}</dd>
            <dt className="text-ink-soft">Identificador</dt>
            <dd className="font-mono">{status.device.id}</dd>
            <dt className="text-ink-soft">Vinculado el</dt>
            <dd className="font-mono">{formatDateTime(status.device.createdAt)}</dd>
            <dt className="text-ink-soft">Última vez visto</dt>
            <dd className="font-mono">{status.device.lastSeenAt ? formatDateTime(status.device.lastSeenAt) : 'nunca'}</dd>
          </dl>
          <button type="button" className="btn btn-danger mt-4" onClick={() => setConfirmRevoke(true)}>
            Revocar
          </button>
        </section>
      )}

      <Dialog open={confirmRevoke} onClose={() => setConfirmRevoke(false)} title="Revocar dispositivo">
        <p className="mb-5">
          {status?.device?.name} dejará de poder enviar datos y se cerrará su sesión activa. Tu historial se conserva. Para
          volver a enviar tendrás que vincular un ESP32 de nuevo.
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn btn-danger" disabled={busy} onClick={revoke}>
            Revocar
          </button>
          <button type="button" className="btn" onClick={() => setConfirmRevoke(false)}>
            Cancelar
          </button>
        </div>
      </Dialog>
    </>
  );
}
