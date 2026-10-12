// Comprobación de `decidir`: que aplicar lo que llega no lo rebote, y que un dispositivo con
// una copia vieja no pise la edición más reciente.
import assert from 'node:assert/strict';
import { decidir, type Entrada } from './prefs.ts';

const e = (valor: string, ts: number): Entrada => ({ valor, ts });
const AHORA = 1_000_000;

// Sin preferencias de la cuenta todavía: no se toca nada.
assert.deepEqual(decidir(undefined, 'claro', e('claro', 0), false, AHORA), {});

// Cuenta sin esta clave guardada: se sube lo que tenga este navegador.
assert.deepEqual(decidir(undefined, 'claro', e('claro', 500), true, AHORA), {
  publicar: e('claro', 500),
  sincronizado: e('claro', 500),
});

// Llega del servidor (al conectar o desde otro dispositivo) y aquí no se ha tocado: se aplica.
assert.deepEqual(decidir(e('oscuro', 900), 'claro', e('claro', 500), true, AHORA), {
  aplicar: 'oscuro',
  sincronizado: e('oscuro', 900),
});

// Y una vez aplicado NO se vuelve a publicar: aquí estaría el ping-pong entre dispositivos.
assert.deepEqual(decidir(e('oscuro', 900), 'oscuro', e('oscuro', 900), true, AHORA), {});

// Cambio hecho en este dispositivo: es de ahora mismo, así que gana y se publica con esa hora.
assert.deepEqual(decidir(e('oscuro', 900), 'claro', e('oscuro', 900), true, AHORA), {
  publicar: e('claro', AHORA),
  sincronizado: e('claro', AHORA),
});

// El dispositivo rancio: se conecta con una copia de ayer y el servidor tiene algo más nuevo.
// Gana el servidor, no el orden de llegada.
assert.deepEqual(decidir(e('oscuro', 900), 'claro', e('claro', 100), true, AHORA), {
  aplicar: 'oscuro',
  sincronizado: e('oscuro', 900),
});

// Al revés: este dispositivo editó sin conexión y lo del servidor es anterior. Se reafirma.
assert.deepEqual(decidir(e('oscuro', 100), 'claro', e('claro', 900), true, AHORA), {
  publicar: e('claro', 900),
  sincronizado: e('claro', 900),
});

// Hora desconocida (preferencia de antes de que se guardaran horas) contra una con hora: pierde.
assert.deepEqual(decidir(e('oscuro', 1), 'claro', e('claro', 0), true, AHORA), {
  aplicar: 'oscuro',
  sincronizado: e('oscuro', 1),
});

// Empate de hora con valores distintos: gana el servidor. Lo importante es que los dos
// dispositivos elijan lo mismo, no cuál de los dos.
assert.deepEqual(decidir(e('oscuro', 900), 'claro', e('claro', 900), true, AHORA), {
  aplicar: 'oscuro',
  sincronizado: e('oscuro', 900),
});

// Mismo valor con hora más nueva: nada que aplicar, pero se adopta la hora para no volver a
// compararse contra la vieja en el siguiente conflicto.
assert.deepEqual(decidir(e('claro', 900), 'claro', e('claro', 100), true, AHORA), {
  sincronizado: e('claro', 900),
});
assert.deepEqual(decidir(e('claro', 100), 'claro', e('claro', 900), true, AHORA), {});

// Convergencia: dos dispositivos que editan a la vez acaban en el mismo valor. B edita más
// tarde, así que su valor gana en los dos.
{
  const tsA = 1000;
  const tsB = 1001;
  // En A llega lo de B: más reciente, lo aplica.
  const enA = decidir(e('b', tsB), 'a', e('a', tsA), true, AHORA);
  assert.deepEqual(enA, { aplicar: 'b', sincronizado: e('b', tsB) });
  // En B llega lo de A (iba por el camino): más viejo, B reafirma lo suyo.
  const enB = decidir(e('a', tsA), 'b', e('b', tsB), true, AHORA);
  assert.deepEqual(enB, { publicar: e('b', tsB), sincronizado: e('b', tsB) });
  // Y ahí se queda: ninguno vuelve a cambiar de opinión.
  assert.deepEqual(decidir(e('b', tsB), 'b', e('b', tsB), true, AHORA), {});
}

console.log('prefs.check.ts ok');
