// Cifrado reversible del token MQTT de cada robot.
//
// Por qué: el usuario tiene que poder volver a ver la contraseña de SU robot (está escrita en el
// config.py del ESP32), así que un hash no sirve. Se guarda cifrada con AES-256-GCM y una clave
// derivada del JWT_SECRET: quien lea la base sin el secreto no saca nada, y la API solo descifra
// para el dueño del robot.
//
// El hash bcrypt (token_hash) sigue siendo lo que valida /api/ingesta; esto es solo para mostrarlo.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { env } from './env.ts';

const clave = scryptSync(env.JWT_SECRET, 'token-robot', 32);

export function cifrarToken(token: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', clave, iv);
  const ct = Buffer.concat([c.update(token, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}

/** null si el valor falta, está corrupto o se cifró con otro JWT_SECRET: hay que regenerar. */
export function descifrarToken(guardado: string | null): string | null {
  if (!guardado) return null;
  try {
    const [iv, tag, ct] = guardado.split('.').map((p) => Buffer.from(p, 'base64'));
    const d = createDecipheriv('aes-256-gcm', clave, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
