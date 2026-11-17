// a DXF's closed outlines become parts; open lines and arcs, and outlines with no area, do not,
// and the import is told how many were left out
//   node tools/test-dxf-open.mjs
import assert from 'node:assert/strict';
globalThis.self = globalThis;
const { THREE } = await import('../src/ext/three.js');
globalThis.THREE = THREE;
await import('../src/add/array.js');
await import('../src/add/three.js');
const D = await import('../src/load/dxf.js');

const wrap = ents => ['0', 'SECTION', '2', 'ENTITIES', ...ents, '0', 'ENDSEC', '0', 'EOF'].join('\n');
const line = (a, b, c, d) => ['0', 'LINE', '8', '0', '10', a, '20', b, '30', 0, '11', c, '21', d, '31', 0];
const circle = (x, y, r) => ['0', 'CIRCLE', '8', '0', '10', x, '20', y, '30', 0, '40', r];
const arc = (x, y, r, a0, a1) => ['0', 'ARC', '8', '0', '10', x, '20', y, '30', 0, '40', r, '50', a0, '51', a1];
const lw = (pts, closed) => ['0', 'LWPOLYLINE', '8', '0', '90', pts.length, '70', closed ? 1 : 0, ...pts.flatMap(([x, y]) => ['10', x, '20', y])];
const read = ents => { const opt = { depth: 19.05, soup: true, units: 'mm' }; const out = D.parse(wrap(ents), opt); return { n: out.length, dropped: opt.dropped }; };
const square = [...line(0, 0, 100, 0), ...line(100, 0, 100, 100), ...line(100, 100, 0, 100), ...line(0, 100, 0, 0)];

assert.deepEqual(read(square), { n: 1, dropped: 0 }, 'a square of four lines is one part');
assert.deepEqual(read([...square, ...arc(160, 50, 30, 0, 180)]), { n: 1, dropped: 1 }, 'an open arc beside it makes no part');
assert.deepEqual(read([...line(0, 0, 10, 0), ...line(10, 0, 10, 10)]), { n: 0, dropped: 1 }, 'two lines in an L make no part');
assert.deepEqual(read(line(0, 0, 10, 0)), { n: 0, dropped: 1 }, 'one line makes no part');
assert.deepEqual(read(circle(0, 0, 0)), { n: 0, dropped: 1 }, 'a circle of radius 0 makes no part');
assert.deepEqual(read(circle(0, 0, 10)), { n: 1, dropped: 0 }, 'a circle is a part');
assert.deepEqual(read(lw([[0, 0], [50, 0]], true)), { n: 0, dropped: 1 }, 'a closed polyline of two points makes no part');
assert.deepEqual(read(lw([[0, 0], [50, 0], [100, 0]], true)), { n: 0, dropped: 1 }, 'a closed polyline with no area makes no part');
assert.deepEqual(read(lw([[0, 0], [50, 0], [50, 30], [0, 30]], true)), { n: 1, dropped: 0 }, 'a closed polyline is a part');
// a ring: the inner circle is a hole, not a part of its own
assert.deepEqual(read([...circle(0, 0, 20), ...circle(0, 0, 5)]), { n: 1, dropped: 0 }, 'a ring is one part');
// the flat reading (the drawing kept for draw) keeps the open lines
const flat = D.parse(wrap([...square, ...line(200, 0, 210, 0)]), { flat: true, units: 'mm' });
assert.equal(flat.length, 2, 'the flat reading keeps the open line');
console.log('dxf open ok');
