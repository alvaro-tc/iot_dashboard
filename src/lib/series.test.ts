/**
 * Autocomprobación de las series. Ejecutar con: npm run check
 * Sin framework: si una aserción falla, el proceso termina con error.
 */
import assert from "node:assert/strict";
import { aproximar, atanTaylor, cosTaylor, sinTaylor } from "./series";

const cerca = (a: number, b: number, tol: number, msg: string) =>
  assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);

// Devuelven una suma parcial por término.
assert.equal(sinTaylor(1, 8).length, 8);
assert.equal(cosTaylor(1, 8).length, 8);
assert.equal(atanTaylor(0.5, 8).length, 8);

// Convergen al valor real con suficientes términos.
cerca(sinTaylor(1.3, 12).at(-1)!, Math.sin(1.3), 1e-9, "sin");
cerca(cosTaylor(2.1, 14).at(-1)!, Math.cos(2.1), 1e-9, "cos");
cerca(atanTaylor(0.6, 40).at(-1)!, Math.atan(0.6), 1e-6, "atan");

// La identidad del recíproco mantiene atan usable fuera de |x| <= 1.
cerca(atanTaylor(4, 60).at(-1)!, Math.atan(4), 1e-6, "atan(x>1)");
cerca(atanTaylor(-3, 60).at(-1)!, Math.atan(-3), 1e-6, "atan(x<-1)");

// El error decae al crecer n: esa monotonía es lo que grafica /telemetria.
const pocos = aproximar("sin", 2, 3).errorAbsoluto;
const muchos = aproximar("sin", 2, 10).errorAbsoluto;
assert.ok(muchos < pocos, "el error debe decrecer con n");
assert.ok(aproximar("cos", 1, 12).errorRelativo < 1e-9, "error relativo");

console.info("series.ts OK");
