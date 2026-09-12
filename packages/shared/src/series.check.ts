// Autocomprobación: `pnpm --filter @iot/shared check`
import assert from 'node:assert/strict';
import { SERIES, computeTerm, initialAcc } from './series.ts';
import { correctPrefixLength } from './precision.ts';
import { parseTelemetryTopic } from './topics.ts';

function run(key: (typeof SERIES)[number]['key'], n: number): number {
  let acc = initialAcc(key);
  let value = 0;
  for (let k = 1; k <= n; k++) ({ acc, value } = computeTerm(key, k, acc));
  return value;
}

// Leibniz: 3.4666… en k=3, error ~1/(2n)
assert.equal(run('pi_leibniz', 1), 4);
assert.ok(Math.abs(run('pi_leibniz', 3) - 3.4666666667) < 1e-9);
assert.ok(Math.abs(run('pi_leibniz', 2000) - Math.PI) < 1e-3);
assert.ok(Math.abs(run('wallis_pi', 1) - 8 / 3) < 1e-12);

for (const s of SERIES) {
  const err = Math.abs(run(s.key, 20000) - s.realValue);
  assert.ok(err < 1e-3, `${s.key} no converge: ${err}`);
}

assert.equal(correctPrefixLength(3.14, Math.PI), 4); // "3.14"
assert.equal(correctPrefixLength(3.2, Math.PI), 1); // "3" (sin el punto)
assert.deepEqual(parseTelemetryTopic('telemetry/5/pi_leibniz'), { userId: 5, seriesKey: 'pi_leibniz' });
assert.equal(parseTelemetryTopic('telemetry/x/pi'), null);

console.log('shared: ok');
