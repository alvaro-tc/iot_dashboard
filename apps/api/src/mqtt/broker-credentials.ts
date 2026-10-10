// Credenciales de Mosquitto gestionadas por el backend.
//
// Por qué existe: cada ESP32 tiene su propio usuario/contraseña en el broker y una ACL que solo
// le deja hablar bajo roomba/{robotId}/#. Así se puede revocar un robot sin tocar los
// demás, y ninguno puede publicar en nombre de otro cliente. El resto del código solo llama a
// addDevice / removeDevices / syncBroker y no sabe nada de archivos ni señales.
//
// Cómo funciona:
//   1. passwd: una línea `usuario:hash` por cuenta. El hash se calcula aquí con el MISMO formato
//      que produce `mosquitto_passwd -b` en Mosquitto 2 ($7$ = PBKDF2-SHA512, 101 iteraciones,
//      sal de 12 bytes, hash de 64 bytes, ambos en base64). Hacerlo en Node evita depender del
//      binario `mosquitto_passwd` en el PATH.
//      El token en claro nunca se guarda: la base de datos tiene su hash bcrypt y el passwd su
//      hash PBKDF2.
//   2. acl: se regenera entero desde la base de datos en cada cambio (idempotente, sin diffs):
//        user iot-backend            -> readwrite roomba/#      (puente y comandos)
//        user roomba-xxxx            -> readwrite roomba/{robotId}/#
//      Solo entran dispositivos no revocados de usuarios activos. Un usuario en passwd pero
//      ausente de la ACL puede conectar pero no publicar: así se "pausa" un cliente desactivado
//      sin perder el token de su ESP32.
//   3. Recarga: MOSQUITTO_RELOAD_CMD (p. ej. `systemctl reload mosquitto`). Mosquitto relee passwd y acl con SIGHUP sin
//      cortar las conexiones existentes; las nuevas publicaciones ya se validan con la ACL nueva.
//
// Las escrituras se serializan en una cola para que dos vinculaciones simultáneas no se pisen.
import { execFile } from 'node:child_process';
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { PREFIJO, aclPatron } from '@iot/shared';
import { pool } from '../db.ts';
import { env, fromRoot } from '../env.ts';

const run = promisify(execFile);
const passwdPath = fromRoot(env.MOSQUITTO_PASSWD_PATH);
const aclPath = fromRoot(env.MOSQUITTO_ACL_PATH);

function hashPassword(password: string): string {
  const salt = randomBytes(12);
  const hash = pbkdf2Sync(password, salt, 101, 64, 'sha512');
  return `$7$101$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(stored: string, password: string): boolean {
  const [, seven, iter, salt, hash] = stored.split('$');
  if (seven !== '7' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = pbkdf2Sync(password, Buffer.from(salt, 'base64'), Number(iter), expected.length, 'sha512');
  return timingSafeEqual(expected, actual);
}

async function readPasswd(): Promise<Map<string, string>> {
  const text = await fs.readFile(passwdPath, 'utf8').catch(() => '');
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) map.set(line.slice(0, i), line.slice(i + 1));
  }
  return map;
}

async function writePasswd(map: Map<string, string>): Promise<void> {
  await fs.writeFile(passwdPath, [...map].map(([u, h]) => `${u}:${h}\n`).join(''), 'utf8');
}

async function writeAcl(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT d.id FROM dispositivos d JOIN usuarios u ON u.id = d.usuario_id
     WHERE NOT d.revocado AND u.activo ORDER BY d.id`,
  );
  let acl = '# Generado por apps/api (broker-credentials.ts). No editar a mano.\n\n';
  acl += `user ${env.MQTT_ADMIN_USER}\ntopic readwrite ${PREFIJO}/#\n`;
  // Cada robot publica su telemetría y recibe sus propios cmd/config, y nada más.
  for (const d of rows) acl += `\nuser ${d.id}\ntopic readwrite ${aclPatron(d.id)}\n`;
  await fs.writeFile(aclPath, acl, 'utf8');
}

async function reloadBroker(): Promise<void> {
  const [cmd, ...args] = env.MOSQUITTO_RELOAD_CMD.split(' ');
  await run(cmd, args, { timeout: 10_000 });
}

let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

/** Da de alta (o reemplaza) las credenciales de un robot y recarga el broker. */
export function addDevice(dispositivoId: string, token: string): Promise<void> {
  return serialized(async () => {
    const map = await readPasswd();
    map.set(dispositivoId, hashPassword(token));
    await writePasswd(map);
    await writeAcl();
    await reloadBroker();
  });
}

/** Elimina credenciales de robots (revocación o borrado de usuario) y recarga el broker. */
export function removeDevices(dispositivoIds: string[]): Promise<void> {
  return serialized(async () => {
    const map = await readPasswd();
    for (const id of dispositivoIds) map.delete(id);
    await writePasswd(map);
    await writeAcl();
    await reloadBroker();
  });
}

/**
 * Reconciliación completa, al arrancar y cuando cambia el estado de un usuario:
 * asegura el usuario de servicio, quita del passwd las cuentas de dispositivos que ya no existen
 * o están revocados, y regenera la ACL.
 */
export function syncBroker(): Promise<void> {
  return serialized(async () => {
    const map = await readPasswd();
    const current = map.get(env.MQTT_ADMIN_USER);
    if (!current || !verifyPassword(current, env.MQTT_ADMIN_PASS)) {
      map.set(env.MQTT_ADMIN_USER, hashPassword(env.MQTT_ADMIN_PASS));
    }
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM dispositivos WHERE NOT revocado');
    const valid = new Set(rows.map((r) => r.id));
    for (const user of [...map.keys()]) {
      if (user !== env.MQTT_ADMIN_USER && !valid.has(user)) map.delete(user);
    }
    const missing = [...valid].filter((id) => !map.has(id));
    if (missing.length) {
      console.warn(`[broker] sin credenciales en passwd (hay que revocar y volver a vincular): ${missing.join(', ')}`);
    }
    await writePasswd(map);
    await writeAcl();
    await reloadBroker();
  });
}
