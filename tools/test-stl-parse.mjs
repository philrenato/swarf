// an STL is read for what it holds: a binary file whose count and size disagree, an empty or short
// file, and ASCII numbers written .5 or nan; and its units are guessed, meters included
//   node tools/test-stl-parse.mjs
import assert from 'node:assert/strict';
import { STL, stlUnits, stlUnitsWhy } from '../src/load/stl.js';

const T = [[0, 0, 0, 10, 0, 0, 0, 10, 0], [0, 0, 0, 0, 10, 0, 0, 0, 10]];
function bin(tris, count, extra = 0, header = '') {
  const buf = new ArrayBuffer(84 + tris.length * 50 + extra), dv = new DataView(buf);
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, count, true);
  tris.forEach((t, k) => t.forEach((v, j) => dv.setFloat32(84 + k * 50 + 12 + j * 4, v, true)));
  return buf;
}
const tris = buf => new STL().parse(buf, 1).length / 9;
const enc = s => new TextEncoder().encode(s).buffer;
const asc = facets => 'solid x\r\n' + facets.map(v => `facet normal 0 0 1\r\n outer loop\r\n  vertex ${v[0]}\r\n  vertex ${v[1]}\r\n  vertex ${v[2]}\r\n endloop\r\nendfacet\r\n`).join('') + 'endsolid x\r\n';

// binary
assert.equal(tris(bin(T, 2)), 2, 'a binary STL');
assert.equal(tris(bin(T, 2, 2)), 2, 'two trailing bytes');
assert.equal(tris(bin(T, 0)), 2, 'a header count of 0 with triangles after it');
assert.equal(tris(bin(T, 5)), 2, 'a header count past the end of the file');
assert.equal(tris(bin(T, 2, 0, 'solid made by a CAD program')), 2, 'a binary header that starts with solid');
assert.equal(tris(bin(T, 2, 7, 'solid made by a CAD program')), 2, 'a solid header and trailing bytes');
assert.deepEqual(Array.from(new STL().parse(bin(T, 9, 3), 1).slice(9, 18)), T[1], 'the triangles read are the ones written');
// nothing in it: no throw, no triangles
assert.equal(tris(new ArrayBuffer(0)), 0, 'an empty file');
assert.equal(tris(new ArrayBuffer(40)), 0, 'a file under 84 bytes');
assert.equal(tris(bin([], 0)), 0, 'a header and no triangles');

// ASCII
assert.equal(tris(enc(asc([['0 0 0', '10 0 0', '0 10 0']]))), 1, 'ASCII');
assert.equal(tris(enc(asc([['0\t0\t0', '10\t0\t0', '0\t10\t0']]))), 1, 'ASCII with tabs');
assert.equal(tris(enc(asc([['0 0 0', '10 0 0', '0 10 0']]).toUpperCase())), 1, 'upper case');
const one = v => Array.from(new STL().parse(enc(asc([v])), 1));
assert.deepEqual(one(['.5 0 0', '10 0 0', '0 10 0']).slice(0, 3), [0.5, 0, 0], 'a number written .5');
assert.deepEqual(one(['-.5 0 0', '10 0 0', '0 10 0']).slice(0, 3), [-0.5, 0, 0], 'a number written -.5');
assert.deepEqual(one(['0 0 5.', '10 0 0', '0 10 0']).slice(0, 3), [0, 0, 5], 'a number written 5.');
assert.deepEqual(one(['1E+01 0 0', '10 0 0', '0 10 0']).slice(0, 3), [10, 0, 0], 'a number written 1E+01');
assert.equal(one(['nan 0 0', '10 0 0', '0 10 0']).length, 0, 'a facet with nan is left out');
// one bad facet never shifts the next one's corners
const two = Array.from(new STL().parse(enc(asc([['nan 0 0', '10 0 0', '0 10 0'], ['1 1 1', '2 2 2', '3 3 3']])), 1));
assert.deepEqual(two, [1, 1, 1, 2, 2, 2, 3, 3, 3], 'the facet after a bad one is whole');

// text is known by what it holds, not by a high byte: a UTF-8 solid name or a BOM is still text
const body = asc([['1.5 2 3', '10 0 0', '0 10 0'], ['0 0 0', '-4 5 6', '7 8 9.25']]);
const want = Array.from(new STL().parse(enc(body), 1));
assert.equal(want.length, 18, 'two facets in plain ASCII');
const named = n => Array.from(new STL().parse(enc(body.replace(/solid x/g, `solid ${n}`)), 1));
assert.deepEqual(named('cafe'), want, 'solid cafe');
assert.deepEqual(named('café'), want, 'a UTF-8 solid name: café');
assert.deepEqual(named('部品'), want, 'a UTF-8 solid name: 部品');
const withBom = s => new Uint8Array([0xEF, 0xBB, 0xBF, ...new Uint8Array(enc(s))]).buffer;
assert.deepEqual(Array.from(new STL().parse(withBom(body), 1)), want, 'a UTF-8 BOM');
assert.deepEqual(Array.from(new STL().parse(withBom(body.replace(/solid x/g, 'solid 部品')), 1)), want, 'a BOM and a UTF-8 name');
// a binary header that starts with solid, even one naming a facet, is binary when its bytes say so
const hdr = 'solid facet normal vertex 1 2 3 x';
assert.deepEqual(Array.from(new STL().parse(bin(T, 2, 0, hdr), 1)), T.flat(), 'a solid header naming a facet, exact size');
assert.deepEqual(Array.from(new STL().parse(bin(T, 0, 3, hdr), 1)), T.flat(), 'the same header, count 0 and trailing bytes');
assert.deepEqual(Array.from(new STL().parse(bin(T, 2, 5, 'solid caf\xE9'), 1)), T.flat(), 'a binary header with a high byte and trailing bytes');
// a file with nothing to read says why
const reason = buf => { const p = new STL(); p.parse(buf, 1); return p.reason || ''; };
assert.match(reason(enc('solid x\nendsolid x\n'.padEnd(200, ' '))), /no whole triangle in this text STL/, 'text with no facet says so');
const u16 = s => { const b = new Uint8Array(2 + s.length * 2); b[0] = 0xFF; b[1] = 0xFE; for (let i = 0; i < s.length; i++) b[2 + i * 2] = s.charCodeAt(i); return b.buffer; };
assert.match(reason(u16(body)), /UTF-16/, 'UTF-16 text with a BOM says so');
assert.match(reason(u16(body).slice(2)), /UTF-16/, 'UTF-16 text with no BOM says so');
assert.match(reason(bin([[NaN, 0, 0, 0, 0, 0, 0, 0, 0]], 1)), /no triangle with real numbers in this binary STL/, 'binary with no real triangle says so');
{ const p = new STL(); p.parse(enc(body), 1); assert.equal(p.reason, undefined, 'a good file has no reason'); }

// units: a ShopBot bed (2438.4 x 1219.2) and the MR-1's (about 300 x 200)
const box = (x, y, z) => new Float32Array([0, 0, 0, x, 0, 0, x, y, z]);
const SB = { bedWidth: 2438.4, bedDepth: 1219.2 }, MR = { bedWidth: 304.8, bedDepth: 203.2 };
assert.equal(stlUnits(box(300, 200, 19), SB), 'mm', 'a 300 mm part in mm');
assert.equal(stlUnits(box(4, 3, 0.75), SB), 'in', 'a 4 x 3 in part in inches');
assert.equal(stlUnits(box(0.3, 0.2, 0.019), SB), 'm', 'a 300 x 200 mm part saved in meters');
assert.equal(stlUnits(box(0.3, 0.2, 0.019), MR), 'm', 'the same part on the MR-1');
assert.equal(stlUnits(box(0.12, 0.08, 0.019), SB), 'm', 'a 120 mm part in meters');
assert.equal(stlUnits(box(3, 2, 0.5), SB, ), 'in', 'numbers over 1 are never meters');
assert.equal(stlUnits(box(6, 4, 1), { ...SB, inch: true }), 'in', 'both fit: inches when the units switch says inches');
assert.equal(stlUnits(box(6, 4, 1), SB), 'mm', 'both fit: mm when it says mm');
assert.equal(stlUnits(new Float32Array(0), SB), 'mm', 'nothing: mm');
// how sure: a guess whenever another reading is on the bed too
const why = (v, o) => { const r = stlUnitsWhy(v, o); return `${r.reading} ${r.guess ? 'guess' : 'sure'} ${r.why}`; };
assert.equal(why(box(300, 200, 19), SB), 'mm sure one', 'a 300 mm part: only mm is on the bed');
assert.equal(why(box(6, 4, 1), SB), 'mm guess both', 'both on the bed: a guess');
assert.equal(why(box(6, 4, 1), { ...SB, inch: true }), 'in guess both', 'both on the bed, inches set: a guess');
assert.equal(why(box(4, 3, 0.75), SB), 'in guess small', 'under 6 mm as mm: inches, a guess');
assert.equal(why(box(5, 5, 2), SB), 'in guess small', 'a 5 mm washer reads as inches: the card says it is a guess');
assert.equal(why(box(120, 80, 20), { ...SB, inch: true }), 'mm sure one', '120 x 80: as inches it is off the bed');
assert.equal(why(box(0.3, 0.2, 0.019), SB), 'm guess both', 'meters, and as inches it would fit too');
assert.equal(why(box(5000, 4000, 10), SB), 'mm guess none', 'on the bed no way: mm, a guess');
console.log('stl parse ok');
