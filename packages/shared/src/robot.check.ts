// pnpm --filter @iot/shared check
// Comprueba el dominio compartido: umbrales de distancia, batería y la lectura del
// movimiento a partir del PWM de las dos ruedas (lo que antes era una columna).
import assert from 'node:assert/strict';
import {
  DIST_EVASION_CM,
  DIST_MAX_CM,
  DIST_MIN_CM,
  PWM_MAX,
  bateriaPorcentaje,
  estadoDistancia,
  movimiento,
  normalizaDeg,
} from './robot.ts';

assert.equal(normalizaDeg(-90), 270);
assert.equal(normalizaDeg(450), 90);

assert.equal(estadoDistancia(null), 'libre'); // sin objeto en rango
assert.equal(estadoDistancia(10), 'evasion');
assert.equal(estadoDistancia(DIST_EVASION_CM), 'evasion'); // el límite cuenta como evasión
assert.equal(estadoDistancia(30), 'precaucion');
assert.equal(estadoDistancia(31), 'libre');

assert.equal(bateriaPorcentaje(8.4), 100);
assert.equal(bateriaPorcentaje(6.6), 0);
assert.equal(bateriaPorcentaje(9), 100); // se recorta, no extrapola
assert.equal(bateriaPorcentaje(0), 0);

// Movimiento deducido de las ruedas: mismo signo = traslación, signos opuestos = giro.
assert.equal(movimiento(180, 180), 'avanzando');
assert.equal(movimiento(-180, -180), 'retrocediendo');
assert.equal(movimiento(-140, 140), 'girando_izquierda');
assert.equal(movimiento(140, -140), 'girando_derecha');
assert.equal(movimiento(0, 0), 'detenido');
// Ruido de PWM por debajo del umbral no es marcha.
assert.equal(movimiento(5, -3), 'detenido');
// Una rueda quieta y la otra en marcha también es un giro, no un avance.
assert.equal(movimiento(0, 150), 'girando_izquierda');
assert.equal(movimiento(150, 0), 'girando_derecha');

console.log('shared: umbrales, batería y movimiento OK');

// --- Simulación: el robot debe esquivar, no atravesar paredes ni quedarse quieto ---
{
  const { RobotSimulado } = await import('./simulacion.ts');
  const { CONFIG_POR_DEFECTO } = await import('./robot.ts');
  const r = new RobotSimulado({ ...CONFIG_POR_DEFECTO }, { semilla: 7, areaAnchoCm: 400, areaAltoCm: 300 });
  r.reiniciar();
  for (let i = 0; i < 4000; i++) r.paso(50); // 200 s de funcionamiento
  const t = r.telemetria();

  assert.ok(r.distanciaRecorridaCm > 100, `apenas se movió: ${r.distanciaRecorridaCm}`);
  assert.ok(r.evasiones > 0, 'nunca esquivó nada: la máquina de estados no se dispara');
  assert.ok(r.bateriaV < 8.4 && r.bateriaV > 6, `batería fuera de rango: ${r.bateriaV}`);
  const d = [t.distancias_cm.izquierdo, t.distancias_cm.central, t.distancias_cm.derecho];
  assert.ok(
    d.every((x) => x === null || (x >= DIST_MIN_CM && x <= DIST_MAX_CM)),
    'distancia fuera del rango del HC-SR04',
  );
  assert.ok(
    Math.abs(t.motores.izquierda_pwm) <= PWM_MAX && Math.abs(t.motores.derecha_pwm) <= PWM_MAX,
    'PWM fuera de -255..255',
  );

  // Parado, las ruedas quedan a cero.
  r.activo = false;
  r.paso(50);
  const parado = r.telemetria();
  assert.equal(parado.motores.izquierda_pwm, 0);
  assert.equal(parado.motores.derecha_pwm, 0);
  assert.equal(movimiento(parado.motores.izquierda_pwm, parado.motores.derecha_pwm), 'detenido');

  console.log(`simulación: ${Math.round(r.distanciaRecorridaCm)} cm recorridos, ${r.evasiones} evasiones OK`);
}
