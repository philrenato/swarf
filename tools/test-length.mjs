// swarf-length.js: what a woodshop types reads as the length it meant (Phil 10-29)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const L = createRequire(import.meta.url)('../web/kiri/swarf-length.js');
const near = (a, b) => Math.abs(a - b) < 1e-9;
const cases = [
  ['3/4', 'in', 19.05], ['1 1/2', 'in', 38.1], ['1-1/2"', 'mm', 38.1], ['0.75 in', 'mm', 19.05], ['.75in', 'mm', 19.05],
  ['19.05 mm', 'in', 19.05], ['19.05', 'mm', 19.05], ['2 cm', 'in', 20], ['-1/8', 'in', -3.175], ['1 inch', 'mm', 25.4],
  ['2 inches', 'mm', 50.8], ['12″', 'mm', 304.8], ['0,5', 'mm', 0.5], [' 6 ', 'in', 152.4]
];
for (const [t, u, mm] of cases) assert.ok(near(L.parse(t, u), mm), `${t} (${u}) → ${L.parse(t, u)}, wanted ${mm}`);
for (const t of ['', 'abc', '1/0', '3/', '1..2', '1 2', 'mm']) assert.ok(Number.isNaN(L.parse(t, 'mm')), `${t} is not a length`);
// a field read back is the same length: every 64th of an inch to 4 ft, within 0.0013 mm
for (let n = 1; n <= 64 * 48; n++) { const mm = n * 25.4 / 64; assert.ok(Math.abs(L.parse(L.show(mm, 'in'), 'in') - mm) < 0.0013, `${n}/64`); }
assert.equal(L.show(19.05, 'in'), '0.75'); assert.equal(L.show(19.05, 'mm'), '19.05');
assert.equal(L.say(19.05, 'in'), '3/4 in'); assert.equal(L.say(38.1, 'in'), '1 1/2 in'); assert.equal(L.say(50.8, 'in'), '2 in');
assert.equal(L.say(20, 'in'), '0.7874 in'); assert.equal(L.say(19.05, 'mm'), '19.05 mm');
console.log('length: ok');
