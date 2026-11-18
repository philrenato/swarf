// a DXF's closed outlines become parts; open lines and arcs, and outlines with no area, do not,
// and the import is told how many were left out (read as the import reads it: tools/dxf-harness.mjs)
//   node tools/test-dxf-open.mjs
import assert from 'node:assert/strict';
import { read, line, circle, arc, lw } from './dxf-harness.mjs';

const got = async ents => { const { r, parts } = await read(ents); return { n: parts.length, dropped: r.open }; };
const square = [...line(0, 0, 100, 0), ...line(100, 0, 100, 100), ...line(100, 100, 0, 100), ...line(0, 100, 0, 0)];

assert.deepEqual(await got(square), { n: 1, dropped: 0 }, 'a square of four lines is one part');
assert.deepEqual(await got([...line(0, 0, 100, 0), ...line(0, 100, 100, 100), ...line(100, 100, 100, 0), ...line(0, 0, 0, 100)]), { n: 1, dropped: 0 }, 'four lines drawn in any direction join');
assert.deepEqual(await got([...square, ...arc(160, 50, 30, 0, 180)]), { n: 1, dropped: 1 }, 'an open arc beside it makes no part');
assert.deepEqual(await got([...line(0, 0, 10, 0), ...line(10, 0, 10, 10)]), { n: 0, dropped: 1 }, 'two lines in an L make no part');
assert.deepEqual(await got(line(0, 0, 10, 0)), { n: 0, dropped: 1 }, 'one line makes no part');
assert.deepEqual(await got(circle(0, 0, 0)), { n: 0, dropped: 1 }, 'a circle of radius 0 makes no part');
assert.deepEqual(await got(circle(0, 0, 10)), { n: 1, dropped: 0 }, 'a circle is a part');
assert.deepEqual(await got(lw([[0, 0], [50, 0]], true)), { n: 0, dropped: 1 }, 'a closed polyline of two points makes no part');
assert.deepEqual(await got(lw([[0, 0], [50, 0], [100, 0]], true)), { n: 0, dropped: 1 }, 'a closed polyline with no area makes no part');
assert.deepEqual(await got(lw([[0, 0], [50, 0], [50, 30], [0, 30]], true)), { n: 1, dropped: 0 }, 'a closed polyline is a part');
// a ring: the inner circle is a hole, not a part of its own
const ring = await read([...circle(0, 0, 20), ...circle(0, 0, 5)]);
assert.equal(ring.parts.length, 1, 'a ring is one part');
assert.equal(ring.parts[0].holes, 1, 'the inner circle is its hole');
// an open polyline closed by an open spline (as Rhino writes a board): one part
const spline = ['0', 'SPLINE', '8', '0', '70', 8, '71', 3, '72', 8, '73', 4, ...[0, 0, 0, 0, 1, 1, 1, 1].flatMap(k => ['40', k]),
  ...[[0, 0], [33, 15], [67, 15], [100, 0]].flatMap(([x, y]) => ['10', x, '20', y, '30', 0])];
const board = await read([...lw([[100, 0], [100, -50], [0, -50], [0, 0]], false), ...spline]);
assert.equal(board.parts.length, 1, 'the spline and the polyline join into one part');
assert.ok(Math.abs(board.parts[0].w - 100) < 0.1 && board.parts[0].h > 60 && board.parts[0].h < 62, `100 wide, 50 + the bow deep (${board.parts[0].w} x ${board.parts[0].h})`);
console.log('dxf open ok');
