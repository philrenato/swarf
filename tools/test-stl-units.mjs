// an STL's units are read from its size alone (where its numbers sit never counts), and the
// card's sentence names each reading as it is
//   node tools/test-stl-units.mjs
import assert from 'node:assert/strict';
import { STL, stlUnitsWhy, stlUnitsSay } from '../src/load/stl.js';

const SB = { bedWidth: 2438.4, bedDepth: 1219.2 }, MR = { bedWidth: 304.8, bedDepth: 203.2 };
// a box's two corners, moved by d
const box = (x, y, z, d = 0) => new Float32Array([d, d, d, x + d, d, d, x + d, y + d, z + d]);
const read = (v, o) => { const r = stlUnitsWhy(v, o); return `${r.reading} ${r.why}`; };

// the same part, moved: the same reading
for (const [x, y, z] of [[0.1, 0.1, 0.02], [0.3, 0.2, 0.019], [4, 3, 0.75], [6, 4, 1], [120, 80, 20], [5000, 4000, 10], [3, 3, 1]]) {
  for (const bed of [SB, MR, {}]) {
    const at0 = stlUnitsWhy(box(x, y, z), bed);
    for (const d of [2, -2, 150, 1e4]) {
      const moved = stlUnitsWhy(box(x, y, z, d), bed);
      assert.equal(moved.reading, at0.reading, `${x}x${y}x${z} moved ${d}: same reading`);
      assert.equal(moved.why, at0.why, `${x}x${y}x${z} moved ${d}: same why`);
      assert.equal(stlUnitsSay(moved), stlUnitsSay(at0), `${x}x${y}x${z} moved ${d}: same sentence`);
    }
  }
}
// the review's case: 0.1 x 0.1 x 0.02 at the origin and moved by 2 are both 100 mm in meters
assert.equal(read(box(0.1, 0.1, 0.02), MR), 'm small', 'at the origin: meters');
assert.equal(read(box(0.1, 0.1, 0.02, 2), MR), 'm small', 'moved by 2: meters too');
// and through the parser, from text
const asc = v => `solid m\nfacet normal 0 0 1\n outer loop\n${[0, 3, 6].map(i => `  vertex ${v[i]} ${v[i + 1]} ${v[i + 2]}\n`).join('')} endloop\nendfacet\nendsolid m\n`;
const parsed = v => new STL().parse(new TextEncoder().encode(asc(v)).buffer, 1);
assert.equal(stlUnitsWhy(parsed(box(0.1, 0.1, 0.02, 2)), MR).reading, 'm', 'a moved text STL in meters reads as meters');

// sentences name the actual readings, never a fitting footprint as not fitting
const say = (v, o) => stlUnitsSay(stlUnitsWhy(v, o));
assert.equal(say(box(0.1, 0.1, 0.02, 2), MR),
  'it came in as meters. a guess: as meters it fits the bed; as millimeters and inches it is under 6 mm long. check the size.',
  'meters: the others are said under 6 mm');
assert.equal(say(box(0.3, 0.2, 0.019), SB),
  'it came in as meters. a guess: as inches and meters it fits the bed; as millimeters it is under 6 mm long. check the size.',
  'meters with inches fitting too: no units switch named');
assert.doesNotMatch(say(box(0.3, 0.2, 0.019), SB), /units switch/, 'the units switch did not choose meters');
assert.equal(say(box(6, 4, 1), SB),
  'it came in as millimeters. a guess: as millimeters and inches it fits the bed; the units switch chose. check the size.',
  'both fit: the units switch chose');
assert.equal(say(box(120, 80, 20), MR), 'it came in as millimeters, the only reading that fits the bed.', 'only mm fits');
assert.equal(say(box(5000, 4000, 10), SB),
  'it came in as millimeters. a guess: as millimeters and inches it is too big for the bed. check the size.',
  'off the bed every way: said so');
// a legitimate small part: under 6 mm as mm, inches is the guess, mm is offered as on the bed
assert.equal(read(box(4, 3, 1), SB), 'in small', 'a 4 mm part: inches, a guess');
assert.equal(say(box(4, 3, 1), SB),
  'it came in as inches. a guess: as inches it fits the bed; as millimeters it is under 6 mm long. check the size.',
  'a 4 mm part: the card says mm is under 6 mm, not off the bed');
// tiny every way: mm, and no reading is said to be off the bed
assert.equal(read(box(0.001, 0.001, 0.001), SB), 'mm none', 'tiny: mm');
assert.doesNotMatch(say(box(0.001, 0.001, 0.001), SB), /too big/, 'tiny: nothing called too big');
// a fitting footprint is never said not to fit
for (const v of [box(0.1, 0.1, 0.02), box(4, 3, 1), box(6, 4, 1), box(0.3, 0.2, 0.019), box(250, 150, 10)]) {
  for (const bed of [SB, MR]) {
    const r = stlUnitsWhy(v, bed), s = stlUnitsSay(r);
    for (const [u, st] of Object.entries(r.readings)) {
      const name = { mm: 'millimeters', in: 'inches', m: 'meters' }[u];
      const tooBig = new RegExp(`as [a-z, ]*\\b${name}\\b[a-z, ]* it is too big`);
      if (st !== 'off') assert.doesNotMatch(s, tooBig, `${name} on the bed is not called too big (${s})`);
    }
  }
}
console.log('stl units ok');
