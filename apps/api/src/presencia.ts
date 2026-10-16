// Presencia de los robots.
//
// Dos fuentes, de la más rápida a la más segura:
//   1. Vigía de señal: el robot publica cada 500 ms, así que unos segundos sin un solo mensaje
//      ya significan que no está. Lo marca fuera de línea al instante y vuelve a en línea con el
//      siguiente mensaje.
//   2. Last Will: el robot publica `estado` retenido con {en_linea:true} al conectar y deja un
//      Last Will con {en_linea:false}. Mosquitto lo publica al vencer el keepalive (~15 s), o
//      el propio robot al desconectarse ordenadamente.
//
// La presencia NO cierra la sesión: un corte de Wi-Fi de unos segundos no debe partirla en dos.
// Las sesiones las cierra solo el barrido de inactivas (SESION_INACTIVA_MS, ver sesiones.ts).
import { pool } from './db.ts';
import { env } from './env.ts';
import { emitirCambio, emitirEstado } from './ws.ts';

const CLAVES_PRESENCIA = ['dispositivos', 'admin-robots', 'admin-resumen', 'sesiones', 'resumen'];

/** Último mensaje de cada robot y lo último que se dijo de él, para escribir solo los cambios. */
const vigilados = new Map<string, { ultimo: number; enLinea: boolean }>();

/** Escrituras de presencia en fila por robot: en paralelo, un "fuera" y un "en línea" casi
 *  simultáneos (el robot vuelve justo cuando salta el vigía) podían llegar a Postgres al revés. */
const escrituras = new Map<string, Promise<void>>();

export function marcarPresencia(dispositivoId: string, enLinea: boolean, firmware: string | null): Promise<void> {
  // También el `estado` retenido que llega al arrancar el backend: así un robot que ya estaba
  // muerto entra en la vigilancia y se marca fuera de línea aunque nunca vuelva a publicar.
  vigilados.set(dispositivoId, { ultimo: Date.now(), enLinea });

  const escritura = (escrituras.get(dispositivoId) ?? Promise.resolve()).then(() =>
    escribir(dispositivoId, enLinea, firmware),
  );
  const cola = escritura.catch(() => {});
  escrituras.set(dispositivoId, cola);
  void cola.finally(() => escrituras.get(dispositivoId) === cola && escrituras.delete(dispositivoId));
  return escritura;
}

async function escribir(dispositivoId: string, enLinea: boolean, firmware: string | null): Promise<void> {
  const { rows } = await pool.query<{ usuario_id: number; version_firmware: string | null }>(
    `UPDATE dispositivos
     SET en_linea = $2, ultimo_contacto = now(), version_firmware = coalesce($3, version_firmware)
     WHERE id = $1
     RETURNING usuario_id, version_firmware`,
    [dispositivoId, enLinea, firmware],
  );
  if (!rows[0]) return; // id desconocido: alguien publicando con credenciales de un robot borrado

  // La versión sale de la base: el Last Will y el vigía no la traen, y mandar null dejaba el
  // panel con "Firmware —" hasta recargar.
  emitirEstado(dispositivoId, { enLinea, versionFirmware: rows[0].version_firmware, ultimoContacto: Date.now() });
  // El badge "en línea" de las listas sale de /api/dispositivos, no de la sala del robot:
  // sin esto solo se enteraba el panel del robot que estuvieras mirando.
  emitirCambio(CLAVES_PRESENCIA, rows[0].usuario_id);
}

const avisar = (dispositivoId: string, enLinea: boolean) =>
  marcarPresencia(dispositivoId, enLinea, null).catch((e) =>
    console.error(`[presencia] ${dispositivoId}:`, (e as Error).message),
  );

/** Cualquier mensaje en vivo del robot es prueba de que sigue ahí. */
export function latido(dispositivoId: string): void {
  const v = vigilados.get(dispositivoId);
  if (v?.enLinea) {
    v.ultimo = Date.now();
    return;
  }
  void avisar(dispositivoId, true);
}

/** Robots que acaban de pasar el umbral sin señal. Quedan marcados para no avisar dos veces. */
export function sinSenal(ahora = Date.now(), umbralMs = env.PRESENCIA_SIN_SENAL_MS): string[] {
  const caidos: string[] = [];
  for (const [id, v] of vigilados) {
    if (v.enLinea && ahora - v.ultimo > umbralMs) {
      v.enLinea = false;
      caidos.push(id);
    }
  }
  return caidos;
}

export function arrancarVigia(): void {
  setInterval(() => {
    for (const id of sinSenal()) void avisar(id, false);
  }, 1_000).unref();
}
