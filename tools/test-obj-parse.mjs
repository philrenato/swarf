// an OBJ is read for every face it holds: faces of four or more corners at any slant, negative
// indices, tabs between numbers, and faces that point at missing corners (left out and counted)
//   node tools/test-obj-parse.mjs
import assert from 'node:assert/strict';
globalThis.self = globalThis;
const { THREE } = await import('../src/ext/three.js');
globalThis.THREE = THREE;
await import('../src/add/array.js');
const { parse } = await import('../src/load/obj.js');

const area = v => {
  let a = 0;
  for (let i = 0; i + 8 < v.length; i += 9) {
    const ux = v[i + 3] - v[i], uy = v[i + 4] - v[i + 1], uz = v[i + 5] - v[i + 2];
    const wx = v[i + 6] - v[i], wy = v[i + 7] - v[i + 1], wz = v[i + 8] - v[i + 2];
    a += Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
  }
  return a;
};
// the summed normal of a face's triangles, as an OBJ point (x, y, z) reads in swarf (x, -z, y)
const normal = v => {
  const n = [0, 0, 0];
  for (let i = 0; i + 8 < v.length; i += 9) {
    const ux = v[i + 3] - v[i], uy = v[i + 4] - v[i + 1], uz = v[i + 5] - v[i + 2];
    const wx = v[i + 6] - v[i], wy = v[i + 7] - v[i + 1], wz = v[i + 8] - v[i + 2];
    n[0] += uy * wz - uz * wy; n[1] += uz * wx - ux * wz; n[2] += ux * wy - uy * wx;
  }
  return n;
};
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), `${msg}: ${a} not ${b}`);
const all = objs => objs.flatMap(o => Array.from(o));
const finite = v => v.every(Number.isFinite);

// a slanted quad wall, narrower in Z than in X and Y
const wall = parse('v 0 0 0\nv 10 0 -10\nv 10 10 -10\nv 0 10 0\nf 1 2 3 4\n');
assert.equal(wall.length, 1, 'a slanted wall makes a part');
assert.equal(wall[0].length / 9, 2, 'a slanted quad is two triangles');
near(area(wall[0]), 100 * Math.SQRT2, 'the slanted wall keeps its area');

// a hexagon board with quad sides: all six sides
const hex = [];
for (let y of [0, 19]) for (let k = 0; k < 6; k++) {
  const a = -k * Math.PI / 3;
  hex.push(`v ${60 * Math.cos(a)} ${y} ${60 * Math.sin(a)}`);
}
hex.push('f 6 5 4 3 2 1', 'f 7 8 9 10 11 12', 'f 1 2 8 7', 'f 2 3 9 8', 'f 3 4 10 9', 'f 4 5 11 10', 'f 5 6 12 11', 'f 6 1 7 12');
const board = parse(hex.join('\n'));
const top = 6 * Math.sqrt(3) / 4 * 60 * 60;
near(area(board[0]), 2 * top + 6 * 60 * 19, 'the hexagon board keeps every side');

// a box turned about Z and in 3D, written as quads: the same area as the box
const box = (P, sep = ' ') => parse([...P.map(p => ['v', ...p].join(sep)),
  'f 1 3 4 2', 'f 5 6 8 7', 'f 1 2 6 5', 'f 3 7 8 4', 'f 1 5 7 3', 'f 2 4 8 6'].map(l => l.replaceAll(' ', sep)).join('\n'));
const turned = [[0, 0, 0], [58.689863, 58.689863, 0], [-98.994949, 98.994949, 0], [-40.305087, 157.684812, 0],
  [0, 0, 25], [58.689863, 58.689863, 25], [-98.994949, 98.994949, 25], [-40.305087, 157.684812, 25]];
const side = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
const boxArea = P => { const a = side(P[0], P[1]), b = side(P[0], P[2]), c = side(P[0], P[4]); return 2 * (a * b + a * c + b * c); };
near(area(box(turned)[0]), boxArea(turned), 'a box turned about Z');
const tilted = [[0, 0, 0], [5.12384, 79.390501, 32.663352], [-43.819977, 3.558204, -1.774498], [-38.696137, 82.948705, 30.888854],
  [-1.698607, -9.396241, 23.104662], [3.425233, 69.99426, 55.768013], [-45.518583, -5.838037, 21.330164], [-40.394743, 73.552464, 53.993516]];
near(area(box(tilted)[0]), boxArea(tilted), 'a box turned in 3D');
const square = [[0, 0, 0], [135, 0, 0], [0, 191, 0], [135, 191, 0], [0, 0, 8], [135, 0, 8], [0, 191, 8], [135, 191, 8]];
near(area(box(square, '\t')[0]), boxArea(square), 'a box written with tabs');

// a quad winds as it is written: its triangles face the way the quad does
const up = parse('v 0 0 0\nv 10 0 0\nv 10 0 -10\nv 0 0 -10\nf 1 2 3 4\n')[0];
const n = normal(up);
assert.ok(n[2] > 0 && Math.abs(n[0]) < 1e-9 && Math.abs(n[1]) < 1e-9, 'a quad counter-clockwise from above faces up');
const down = normal(parse('v 0 0 0\nv 10 0 0\nv 10 0 -10\nv 0 0 -10\nf 4 3 2 1\n')[0]);
assert.ok(down[2] < 0, 'the same quad wound the other way faces down');
// an L, not convex, in its own plane
const ell = parse('v 0 0 0\nv 20 0 0\nv 20 0 -10\nv 10 0 -10\nv 10 0 -20\nv 0 0 -20\nf 1 2 3 4 5 6\n')[0];
near(area(ell), 300, 'an L-shaped face');
assert.ok(normal(ell)[2] > 0, 'the L faces up');

// negative indices count back from the last vertex read
const neg = parse('v 0 0 0\nv 10 0 0\nv 10 0 -10\nv 0 0 -10\nf -4 -3 -2 -1\n');
near(area(neg[0]), 100, 'a quad with negative indices');
const negTri = parse('v 0 0 0\nv 10 0 0\nv 0 0 -10\nf -3 -2 -1\n');
near(area(negTri[0]), 50, 'a triangle with negative indices');
const negBox = parse(['v 0 0 0', 'v 171 0 0', 'v 0 111 0', 'v 171 111 0', 'v 0 0 35', 'v 171 0 35', 'v 0 111 35', 'v 171 111 35',
  'vn 0 0 1', 'f -8//1 -6//1 -5//1 -7//1', 'f -4//2 -3//2 -1//2 -2//2', 'f -8//3 -7//3 -3//3 -4//3',
  'f -6//4 -2//4 -1//4 -5//4', 'f -8//5 -4//5 -2//5 -6//5', 'f -7//6 -5//6 -1//6 -3//6'].join('\n'));
near(area(negBox[0]), 2 * (171 * 111 + 171 * 35 + 111 * 35), 'a box with negative indices and normals');

// tabs, and CRLF line ends
const tabs = parse('v\t0\t0\t0\r\nv\t10\t0\t0\r\nv\t0\t0\t-10\r\nf\t1\t2\t3\r\n');
near(area(tabs[0]), 50, 'a triangle written with tabs');
const tri = parse('v 0 0 0\nv 10 0 0\nv 0 0 -10\nf 1/1/1 2/2/1 3/3/1\n');
near(area(tri[0]), 50, 'a triangle with texture and normal indices');

// faces that point at missing corners are left out and counted; the rest are kept
const missing = parse('v 0 0 0\nv 10 0 0\nv 0 0 -10\nf 1 2 3\nf 1 2 9\nf -1 -2 -7\nf 0 1 2\n');
assert.equal(missing.length, 1, 'the good face makes a part');
assert.equal(missing[0].length / 9, 1, 'only the good face');
assert.equal(missing.refused, 3, 'three faces left out');
// a vertex with two numbers is no corner
const short = parse('v 0 0\nv 10 0 0\nv 0 0 -10\nv 10 0 -10\nf 1 2 3\nf 2 4 3\n');
assert.equal(short.refused, 1, 'a face on a two-number vertex is left out');
assert.ok(finite(all(short)), 'no NaN corners');
near(area(short[0]), 50, 'the face that is whole is kept');

// nothing to make a part from: no parts
for (const [text, msg] of [['', 'an empty file'], ['# nothing\n', 'only a comment'], ['v 0 0 0\nv 1 0 0\n', 'corners and no faces'],
  ['v 0 0 0\nf 1 2 3\n', 'a face on missing corners'], ['g a\ng b\n', 'empty groups']]) {
  assert.equal(parse(text).length, 0, msg);
}

// groups: one part each, empty ones dropped, names kept
const groups = parse('v 0 0 0\nv 10 0 0\nv 0 0 -10\ng a\nf 1 2 3\ng empty\ng b\nf 3 2 1\ng\n');
assert.deepEqual(groups.map(g => g.name), ['a', 'b'], 'two groups, the empty ones dropped');
assert.ok(finite(all(groups)), 'every corner is a number');
console.log('obj parse ok');
