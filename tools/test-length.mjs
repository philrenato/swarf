// swarf-length.js: what a woodshop types reads as the length it meant (Phil 10-29)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const L = createRequire(import.meta.url)('../web/kiri/swarf-length.js');
const near = (a, b) => Math.abs(a - b) < 1e-9;
const cases = [
  ['3/4', 'in', 19.05], ['3/4', 'mm', 19.05], ['1 1/2', 'mm', 38.1], ['12', 'mm', 12], ['1 1/2', 'in', 38.1], ['1-1/2"', 'mm', 38.1], ['0.75 in', 'mm', 19.05], ['.75in', 'mm', 19.05],
  ['19.05 mm', 'in', 19.05], ['19.05', 'mm', 19.05], ['2 cm', 'in', 20], ['-1/8', 'in', -3.175], ['1 inch', 'mm', 25.4],
  ['2 inches', 'mm', 50.8], ['12″', 'mm', 304.8], ['0,5', 'mm', 0.5], [' 6 ', 'in', 152.4]
];
for (const [t, u, mm] of cases) assert.ok(near(L.parse(t, u), mm), `${t} (${u}) → ${L.parse(t, u)}, wanted ${mm}`);
for (const t of ['', 'abc', '1/0', '3/', '1..2', '1 2', 'mm']) assert.ok(Number.isNaN(L.parse(t, 'mm')), `${t} is not a length`);
// a field read back is the same length: every 64th of an inch to 4 ft, within 0.0013 mm
for (let n = 1; n <= 64 * 48; n++) { const mm = n * 25.4 / 64; assert.ok(Math.abs(L.parse(L.show(mm, 'in'), 'in') - mm) < 0.0013, `${n}/64`); }
assert.equal(L.show(19.05, 'in'), '0.75'); assert.equal(L.show(19.05, 'mm'), '19.05');
// the scene's precision (Phil 11-01): no float noise, mm to 2 places (3 under 1 mm or for an inch size),
// inches to 3 (4 for a 64th)
assert.equal(L.show(12.700000001, 'mm'), '12.7'); assert.equal(L.show(0.1 + 0.2, 'mm'), '0.3'); assert.equal(L.show(12.345, 'mm'), '12.35');
assert.equal(L.show(3.175, 'mm'), '3.175'); assert.equal(L.show(0.254, 'mm'), '0.254'); assert.equal(L.show(2438.4, 'mm'), '2438.4');
assert.equal(L.show(20, 'in'), '0.787'); assert.equal(L.show(25.4 / 64, 'in'), '0.0156'); assert.equal(L.show(2438.4, 'in'), '96');
assert.equal(L.show(0.1 * 3 * 25.4, 'in'), '0.3');
assert.equal(L.say(19.05, 'in'), '3/4 in'); assert.equal(L.say(38.1, 'in'), '1 1/2 in'); assert.equal(L.say(50.8, 'in'), '2 in');
assert.equal(L.say(20, 'in'), '0.7874 in'); assert.equal(L.say(19.05, 'mm'), '19.05 mm');
// a design field (TEX, tabs; review 10-30 B8): a 32nd as a fraction, else three decimals; read back within 0.013 mm
assert.equal(L.field(19.05, 'in'), '3/4'); assert.equal(L.field(4.76, 'in'), '3/16'); assert.equal(L.field(38.1, 'in'), '1 1/2');
assert.equal(L.field(2, 'in'), '0.079'); assert.equal(L.field(30, 'in'), '1.181'); assert.equal(L.field(2.2, 'mm'), '2.2');
for (let k = 1; k <= 4000; k++) { const mm = k * 0.137; assert.ok(Math.abs(L.parse(L.field(mm, 'in'), 'in') - mm) < 0.0131, `${mm} mm → ${L.field(mm, 'in')}`); }
// a length in a sentence (r086 check S3): the nearest 16th in inches, mm as before
assert.equal(L.prose(71, 'in'), '2 13/16 in'); assert.equal(L.prose(65.5, 'in'), '2 9/16 in'); assert.equal(L.prose(4.76, 'in'), '3/16 in');
assert.equal(L.prose(20, 'in'), '13/16 in'); assert.equal(L.prose(25, 'in'), '1 in'); assert.equal(L.prose(0.5, 'in'), '1/32 in'); assert.equal(L.prose(0.8, 'in'), '1/32 in'); assert.equal(L.prose(0.3, 'in'), '0.012 in'); assert.equal(L.prose(0.1, 'in'), '0.004 in'); assert.equal(L.prose(1.5, 'in'), '1/16 in');
assert.equal(L.prose(-3.2, 'in'), '-1/8 in'); assert.equal(L.prose(0, 'in'), '0 in'); assert.equal(L.prose(NaN, 'in'), '');
assert.equal(L.prose(71, 'mm'), '71 mm'); assert.equal(L.prose(4.76, 'mm'), '4.8 mm'); assert.equal(L.prose(4.76, 'mm', 2), '4.76 mm');
for (let k = 1; k <= 4000; k++) { const mm = k * 0.137, t = L.prose(mm, 'in'); assert.ok(/^(\d+ )?(\d+\/(2|4|8|16|32) )?in$|^0\.\d+ in$/.test(t), `${mm} → ${t}`); if (/\/32/.test(t)) assert.ok(mm < 3.2, `${mm} → ${t}: 32nds only under 1/8`); if (mm >= 0.8) assert.ok(Math.abs(L.parse(t, 'in') - mm) <= 25.4 / 32 + 1e-9, `${mm} → ${t} within a 32nd`); }
// a bare fraction in mm is read as inches, and says so (review 11-13 #5); nothing to say otherwise
assert.equal(L.note('3/4', 'mm'), '3/4 is read as inches: 19.05 mm. For 3/4 of a millimeter type 0.75 or 3/4 mm.');
assert.ok(/38\.1 mm/.test(L.note('1 1/2', 'mm'))); assert.ok(/38\.1 mm/.test(L.note('1-1/2', 'mm')));
for (const t of ['3/4 mm', '3/4 in', '0.75', '19', '', 'abc', '3/0']) assert.equal(L.note(t, 'mm'), '', t);
assert.equal(L.note('3/4', 'in'), '');
console.log('length: ok');
