// Comprueba contra Postgres lo que tsc no puede ver: el upsert condicional por hora, que es
// quien resuelve los conflictos entre dispositivos.
//
// Necesita la base en marcha, así que no va en `pnpm lint`: se corre con `pnpm check:prefs`.
// Crea un usuario de prueba con un correo único y lo borra al terminar (y con él, en cascada,
// sus preferencias); no toca ninguna otra fila.
import assert from 'node:assert/strict';
import { pool } from './db.ts';
import { guardarPreferencia, preferenciasDe } from './preferencias.ts';

const { rows } = await pool.query<{ id: number }>(
  `INSERT INTO usuarios (correo, contrasena, nombre, rol) VALUES ($1,'x','Prueba prefs','cliente') RETURNING id`,
  [`prefs-check-${Date.now()}@test.local`],
);
const uid = rows[0].id;

try {
  // Sin nada guardado.
  assert.deepEqual(await preferenciasDe(uid), {});

  // Primera escritura.
  let r = await guardarPreferencia(uid, 'tema', 'oscuro', 1000);
  assert.deepEqual(r, { guardado: true, entrada: { valor: 'oscuro', ts: 1000 } });
  assert.deepEqual(await preferenciasDe(uid), { tema: { valor: 'oscuro', ts: 1000 } });

  // Más nueva: gana.
  r = await guardarPreferencia(uid, 'tema', 'claro', 2000);
  assert.deepEqual(r, { guardado: true, entrada: { valor: 'claro', ts: 2000 } });

  // Más vieja (dispositivo rancio): se rechaza y devuelve la vigente.
  r = await guardarPreferencia(uid, 'tema', 'oscuro', 1500);
  assert.deepEqual(r, { guardado: false, entrada: { valor: 'claro', ts: 2000 } });

  // Empate: gana el servidor.
  r = await guardarPreferencia(uid, 'tema', 'oscuro', 2000);
  assert.deepEqual(r, { guardado: false, entrada: { valor: 'claro', ts: 2000 } });

  // Otra clave no toca la primera.
  r = await guardarPreferencia(uid, 'panel', '{"visibles":[]}', 3000);
  assert.deepEqual(r, { guardado: true, entrada: { valor: '{"visibles":[]}', ts: 3000 } });
  assert.deepEqual(await preferenciasDe(uid), {
    tema: { valor: 'claro', ts: 2000 },
    panel: { valor: '{"visibles":[]}', ts: 3000 },
  });

  // Entradas inválidas.
  assert.equal(await guardarPreferencia(uid, 'otra', 'x', 1), null);
  assert.equal(await guardarPreferencia(uid, 'tema', 42, 1), null);
  assert.equal(await guardarPreferencia(uid, 'tema', 'x', 'ayer'), null);
  assert.equal(await guardarPreferencia(uid, 'tema', 'x', -1), null);

  // Hora disparatada en el futuro: se recorta, no congela la clave.
  r = await guardarPreferencia(uid, 'tema', 'oscuro', Date.now() + 10 * 365 * 24 * 3600_000);
  assert.equal(r!.guardado, true);
  assert.ok(r!.entrada.ts <= Date.now() + 60_000, `ts recortado, vino ${r!.entrada.ts}`);

  // Forma vieja (valor pelado, sin hora): se lee y cualquier hora la supera.
  await pool.query(`UPDATE preferencias_usuario SET datos = '{"tema":"oscuro"}' WHERE usuario_id = $1`, [uid]);
  assert.deepEqual(await preferenciasDe(uid), { tema: { valor: 'oscuro', ts: 0 } });
  r = await guardarPreferencia(uid, 'tema', 'claro', 1);
  assert.deepEqual(r, { guardado: true, entrada: { valor: 'claro', ts: 1 } });

  console.log('prefs-sql ok');
} finally {
  await pool.query('DELETE FROM usuarios WHERE id = $1', [uid]);
  await pool.end();
}
