import { CONFIG_POR_DEFECTO } from './src/robot.ts';
import { DISTANCIA_RUEDAS_SIM, RobotSimulado, VEL_MAX_CM_S_SIM } from './src/simulacion.ts';
import { difAngular, periodoDeGiro, type MuestraBarrido } from './src/lidar.ts';

const pwm = 140;
const teorico = ((2 * (pwm / 255) * VEL_MAX_CM_S_SIM) / DISTANCIA_RUEDAS_SIM) * (180 / Math.PI);
console.log(`giro teorico del simulador a PWM ${pwm}: ${teorico.toFixed(2)} °/s  (periodo ${(360 / teorico).toFixed(2)} s)`);

for (const [ms, jitter] of [[12600, false], [12600, true], [25000, true], [40000, true]] as [number, boolean][]) {
  const sim = new RobotSimulado({ ...CONFIG_POR_DEFECTO }, { semilla: 97 });
  sim.mando = { izq: pwm, der: -pwm };
  const th0 = sim.pose().th;
  const muestras: MuestraBarrido[] = [];
  let ultima = -999;
  let vueltasReales = 0;
  let anterior = th0;
  for (let t = 0; t <= ms; t += 50) {
    sim.paso(50);
    const th = sim.pose().th;
    vueltasReales += difAngular(th, anterior);
    anterior = th;
    // Jitter como el del simulador real: unas muestras salen a 50 ms y otras a 100.
    const paso = jitter && Math.random() < 0.35 ? 100 : 50;
    if (t - ultima < paso) continue;
    ultima = t;
    const d = sim.distancias();
    muestras.push({ dt: t, izquierdo: d.izquierdo, central: d.central, derecho: d.derecho });
  }
  const real = Math.abs(vueltasReales) / (ms / 1000);
  const r = periodoDeGiro(muestras);
  const err = r ? ((r.gradosPorSegundo - real) / real) * 100 : NaN;
  console.log(
    `  ${(ms / 1000).toFixed(0)}s ${jitter ? 'con jitter ' : 'sin jitter'} (${(Math.abs(vueltasReales) / 360).toFixed(2)} vueltas reales, ${muestras.length} muestras): ` +
      (r ? `medido ${r.gradosPorSegundo} °/s vs real ${real.toFixed(2)} -> ${err >= 0 ? '+' : ''}${err.toFixed(1)}%  conf ${r.confianza}` : 'NULL'),
  );
}
