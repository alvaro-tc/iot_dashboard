// node src/lib/downsample.check.ts
import assert from 'node:assert/strict';
import { downsample } from './downsample.ts';

const pts = Array.from({ length: 10_000 }, (_, i) => ({ i, v: (i % 2 ? -1 : 1) / (i + 1) }));
const out = downsample(pts, 2000, (p) => p.v);

assert.ok(out.length <= 2000, `demasiados puntos: ${out.length}`);
assert.equal(out.at(-1), pts.at(-1)); // el último punto siempre está
assert.ok(out.some((p) => p.v > 0) && out.some((p) => p.v < 0 && p.i < 5000)); // la oscilación antigua sobrevive
assert.ok(out.every((p, k) => k === 0 || p.i > out[k - 1].i)); // orden conservado
assert.equal(downsample(pts.slice(0, 10), 2000, (p) => p.v).length, 10);

console.log('downsample: ok');
