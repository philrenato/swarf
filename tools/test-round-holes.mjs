// a blind hole's floor is read off the mesh, however many flats the part has (review of 109: below the top
// sixteen flats it read as through, and the drill went right out); a through hole has none.
//   node tools/test-round-holes.mjs
import assert from 'node:assert/strict';
import { roundHoles, holeFit } from '../src/kiri/mode/cam/app/round-holes.js';
const quad = (s, a, b, z0, z1) => s.push(a[0], a[1], z0, b[0], b[1], z0, b[0], b[1], z1, a[0], a[1], z0, b[0], b[1], z1, a[0], a[1], z1);
function part({ floor, extra }) {
  const s = [], P = [[0, 0], [100, 0], [100, 100], [0, 100]];
  for (let i = 0; i < 4; i++) quad(s, P[i], P[(i + 1) % 4], 0, 20);
  const C = Array.from({ length: 32 }, (_, i) => [50 + 3 * Math.cos(i / 32 * 2 * Math.PI), 50 + 3 * Math.sin(i / 32 * 2 * Math.PI)]);
  for (let i = 0; i < 32; i++) {
    quad(s, C[(i + 1) % 32], C[i], floor ?? 0, 20);
    if (floor != null) s.push(50, 50, floor, C[i][0], C[i][1], floor, C[(i + 1) % 32][0], C[(i + 1) % 32][1], floor);
  }
  const flat = z => s.push(1, 1, z, 2, 1, z, 1, 2, z);
  flat(20); flat(0);
  for (let k = 0; k < extra; k++) flat(19.5 - k * 0.4);
  return new Float32Array(s);
}
for (const extra of [0, 14, 15, 20, 40]) {
  const h = roundHoles(part({ floor: 10, extra })).holes;
  assert.equal(h.length, 1, `${extra} flats: one hole`);
  assert.equal(h[0].floor, 10, `${extra} flats: the floor is at 10, not through (${h[0].floor})`);
}
assert.equal(roundHoles(part({ extra: 0 })).holes[0].floor, null, 'a hole with nothing under it goes through');
assert.equal(holeFit(6, 6.35), 'fits'); assert.equal(holeFit(8, 6.35), 'bigger'); assert.equal(holeFit(3, 6.35), 'smaller');
console.log('round holes: ok');
