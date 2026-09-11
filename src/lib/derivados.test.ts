/** Autocomprobación de los derivados. Ejecutar con: npm run check */
import assert from "node:assert/strict";
import {
  anguloGirado,
  areaBarrida,
  caidaTensionAnomala,
  efectividadLimpieza,
  esZonaSucia,
  estaAtascado,
  metrosRecorridos,
  ruedaTrabada,
  velocidadLineal,
} from "./derivados";

// 98 pulsos por rueda ≈ 1 m; en 4 s ≈ 0.25 m/s.
assert.ok(Math.abs(velocidadLineal(98, 98, 4) - 0.25) < 0.01);
assert.equal(velocidadLineal(50, 50, 0), 0);

// Ambas ruedas iguales => sin giro; la derecha más rápida => giro positivo.
assert.equal(anguloGirado(40, 40), 0);
assert.ok(anguloGirado(30, 50) > 0);

assert.ok(Math.abs(metrosRecorridos(98, 98) - 1) < 0.01);
assert.ok(Math.abs(areaBarrida(10) - 1.8) < 1e-9);

// Atascado solo con motores ON y la ventana completa de pulsos en cero.
assert.equal(estaAtascado(true, [0, 0, 0, 0, 0, 0, 0], 0.5), true);
assert.equal(estaAtascado(false, [0, 0, 0, 0, 0, 0, 0], 0.5), false);
assert.equal(estaAtascado(true, [0, 0, 9, 0, 0, 0, 0], 0.5), false);

assert.equal(ruedaTrabada(0, 20), "IZQUIERDA");
assert.equal(ruedaTrabada(20, 0), "DERECHA");
assert.equal(ruedaTrabada(18, 20), null);

// 0.5 V en 10 s son 3 V/min: muy por encima del umbral de 0.06 V/min.
assert.equal(caidaTensionAnomala(14.0, 13.5, 10, 0.06), true);
assert.equal(caidaTensionAnomala(14.0, 13.999, 10, 0.06), false);

assert.ok(Math.abs(efectividadLimpieza(0.4, 0.1) - 75) < 1e-9);
assert.equal(efectividadLimpieza(0, 0.1), 0);

const base = Array(20).fill(0.2) as number[];
assert.equal(esZonaSucia(0.5, base, 1.5), true);
assert.equal(esZonaSucia(0.25, base, 1.5), false);
assert.equal(esZonaSucia(0.9, [0.2], 1.5), false);

console.info("derivados.ts OK");
