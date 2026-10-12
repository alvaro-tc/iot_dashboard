// node --experimental-strip-types src/token-robot.check.ts
import assert from 'node:assert/strict';
import { cifrarToken, descifrarToken } from './token-robot.ts';

const t = 'SalaDemoToken0123456789abcdefgh';
const c = cifrarToken(t);
assert.notEqual(c, t);
assert.equal(descifrarToken(c), t);
assert.notEqual(cifrarToken(t), c, 'IV aleatorio: dos cifrados no coinciden');
assert.equal(descifrarToken(null), null);
assert.equal(descifrarToken('basura'), null);
// Un byte cambiado en el texto cifrado: el tag GCM no cuadra y no se devuelve nada.
const [iv, tag, ct] = c.split('.');
const manipulado = Buffer.from(ct, 'base64');
manipulado[0] ^= 1;
assert.equal(descifrarToken(`${iv}.${tag}.${manipulado.toString('base64')}`), null, 'GCM detecta manipulación');
console.log('token-robot: ok');
