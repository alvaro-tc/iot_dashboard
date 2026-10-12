// Las claves que empuja el socket tienen que ser las mismas que pide el navegador.
//
// Si alguien cambia un useQuery en apps/web (o añade una vista nueva al push) y las claves
// dejan de coincidir, el valor empujado se queda en una entrada de la caché que nadie mira:
// la página seguiría mostrando datos viejos sin un solo error. Esto lo caza.
import assert from 'node:assert/strict';
import { claveDe } from './ws.ts';

// Copiado a mano de los useQuery de apps/web/src.
const DEL_NAVEGADOR: Record<string, unknown[]> = {
  dispositivos: ['dispositivos'],
  'admin-robots': ['admin-robots'],
  'admin-resumen': ['admin-resumen'],
  'admin-users': ['admin-users'],
  sesiones: ['sesiones', 'roomba-1234abcd'],
  resumen: ['resumen', 'roomba-1234abcd'],
};

for (const [vista, esperada] of Object.entries(DEL_NAVEGADOR)) {
  assert.deepEqual(claveDe(vista, 'roomba-1234abcd'), esperada, `clave de ${vista}`);
}

// Una vista de robot sin robot no se puede empujar: la clave quedaría a medias.
assert.deepEqual(claveDe('sesiones', undefined), ['sesiones', undefined]);

console.log('ws: claves de empuje ok');
