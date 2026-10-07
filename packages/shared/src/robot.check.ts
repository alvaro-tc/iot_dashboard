// pnpm --filter @iot/shared check
// Comprueba la geometría compartida: si esto falla, el mapa en vivo y el histórico SQL divergen.
import assert from 'node:assert/strict';
import { RADIO_ROBOT_CM, bateriaPct, deltaDeg, estadoDistancia, normalizaDeg, puntoObstaculo } from './robot.ts';

const cerca = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// Robot en el origen mirando al este: el obstáculo del sensor central queda en +x.
{
  const p = puntoObstaculo(0, 0, 0, 0, 10);
  cerca(p.x, RADIO_ROBOT_CM + 10);
  cerca(p.y, 0);
}
// Girado 90°, el mismo haz apunta al norte.
{
  const p = puntoObstaculo(0, 0, 90, 0, 10);
  cerca(p.x, 0);
  cerca(p.y, RADIO_ROBOT_CM + 10);
}
// El ángulo del sensor se suma a la orientación del robot.
{
  const p = puntoObstaculo(0, 0, 45, -45, 3);
  cerca(p.x, RADIO_ROBOT_CM + 3);
  cerca(p.y, 0);
}

assert.equal(normalizaDeg(-90), 270);
assert.equal(normalizaDeg(450), 90);
// Camino más corto: de 350° a 10° son +20°, no -340°.
assert.equal(deltaDeg(350, 10), 20);
assert.equal(deltaDeg(10, 350), -20);
assert.equal(deltaDeg(0, 180), 180);

const cfg = { distanciaEvasionCm: 15, distanciaPrecaucionCm: 30 };
assert.equal(estadoDistancia(null, cfg), 'libre'); // sin objeto en rango
assert.equal(estadoDistancia(10, cfg), 'evasion');
assert.equal(estadoDistancia(15, cfg), 'evasion'); // el límite cuenta como evasión
assert.equal(estadoDistancia(30, cfg), 'precaucion');
assert.equal(estadoDistancia(31, cfg), 'libre');

assert.equal(bateriaPct(8.4), 100);
assert.equal(bateriaPct(6.6), 0);
assert.equal(bateriaPct(9), 100); // se recorta, no extrapola
assert.equal(bateriaPct(0), 0);

console.log('shared: geometría, ángulos, umbrales y batería OK');

// --- Simulación: el robot debe esquivar, no atravesar paredes ni quedarse quieto ---
{
  const { RobotSimulado } = await import('./simulacion.ts');
  const { CONFIG_POR_DEFECTO } = await import('./robot.ts');
  const r = new RobotSimulado({ ...CONFIG_POR_DEFECTO, modo: 'automatico', areaAnchoCm: 400, areaAltoCm: 300 }, { semilla: 7 });
  r.reiniciar();
  for (let i = 0; i < 4000; i++) r.paso(50); // 200 s de funcionamiento
  const t = r.telemetria(Date.now());

  assert.ok(r.distanciaRecorridaCm > 100, `apenas se movió: ${r.distanciaRecorridaCm}`);
  assert.ok(r.evasiones > 0, 'nunca esquivó nada: la máquina de estados no se dispara');
  assert.ok(r.bateriaV < 8.4 && r.bateriaV > 6, `batería fuera de rango: ${r.bateriaV}`);
  assert.equal(t.seq, 1); // telemetria() incrementa seq, reiniciar() lo puso a 0
  assert.ok(t.th >= 0 && t.th < 360, `orientación sin normalizar: ${t.th}`);
  assert.ok(t.d.every((d) => d === null || (d >= 2 && d <= 400)), 'distancia fuera del rango del HC-SR04');
  assert.ok(Math.abs(t.vi) <= 100 && Math.abs(t.vd) <= 100, 'PWM fuera de -100..100');

  // En modo detenido las ruedas quedan a cero.
  r.config.modo = 'detenido';
  r.paso(50);
  const parado = r.telemetria(Date.now());
  assert.equal(parado.vi, 0);
  assert.equal(parado.vd, 0);
  assert.equal(parado.e, 'detenido');

  console.log(`simulación: ${Math.round(r.distanciaRecorridaCm)} cm recorridos, ${r.evasiones} evasiones OK`);
}
