// an SVG makes parts only from shapes it can draw: no NaN corners, no throw on a path the reader
// cannot follow, and a huge curve is drawn in a bounded number of points
//   node tools/test-svg-parse.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DOMParser } = require('@xmldom/xmldom');
globalThis.DOMParser = class extends DOMParser {
  constructor() { super({ onError() {} }); }
};
globalThis.self = globalThis;
const { THREE } = await import('../src/ext/three.js');
globalThis.THREE = THREE;
await import('../src/add/array.js');
await import('../src/add/three.js');
const { parse } = await import('../src/load/svg.js');

const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80">${body}</svg>`;
const opt = () => ({ depth: 10, soup: true, resolution: 2, dpi: 0 });
const finite = objs => objs.every(o => Array.from(o.array || o).every(Number.isFinite));

const rect = parse(svg('<rect width="120" height="80"/>'), opt());
assert.equal(rect.length, 1, 'a rectangle makes a part');
assert.ok(finite(rect), 'a rectangle has numbers for corners');

// a rect with no width: nothing, and no NaN
const nowidth = parse(svg('<rect widthC="120" height="80"/>'), opt());
assert.ok(finite(nowidth), 'a rect with no width gives no NaN corners');
assert.ok(finite(parse(svg('<rect widthC="120" height="80"/>'), { flat: true })
  .map(p => p.points.flatMap(q => [q.x, q.y]))), 'nor in its outlines');

// a path that starts with an arc, not a move: no throw, no part
let arc;
assert.doesNotThrow(() => { arc = parse(svg('<path d="A0 0 0 0 010 50 A40 40 0 1 1 90 50 A40 40 0 1 1 10 50 Z"/>'), opt()); },
  'a path that starts with A');
assert.equal(arc.length, 0, 'it makes nothing');
assert.doesNotThrow(() => parse('not a drawing', opt()), 'text that is not an SVG');

// a circle r = 1e6: bounded points, quick
const t0 = Date.now();
const flat = parse(svg('<circle cx="0" cy="0" r="1000000"/>'), { ...opt(), flat: true });
assert.equal(flat.length, 1, 'a huge circle is one outline');
assert.ok(flat[0].points.length <= 4096, `a huge circle is at most 4096 points (${flat[0].points.length})`);
assert.ok(Date.now() - t0 < 2000, 'and quick');
const big = parse(svg('<circle cx="0" cy="0" r="1000000"/>'), opt());
assert.equal(big.length, 1, 'a huge circle makes a part');
assert.ok(finite(big), 'with numbers for corners');

// an ordinary circle still has as many points as before
const small = parse(svg('<circle cx="60" cy="40" r="30"/>'), { ...opt(), flat: true });
assert.ok(small[0].points.length >= 300, `a 30 mm circle keeps its points (${small[0].points.length})`);
// a path drawn without "z" whose ends don't meet is an open line, never closed into a part
const openPath = parse(svg('<path d="M10 10 L50 10 L50 50" fill="none" stroke="#000"/>'), { ...opt(), flat: true });
assert.ok(openPath.length === 1 && openPath[0].open, 'an open path stays an open line');
const openArc = parse(svg('<path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="#000"/>'), { ...opt(), flat: true });
assert.ok(openArc.length === 1 && openArc[0].open, 'an open arc stays an open line');
assert.equal(parse(svg('<path d="M10 10 L50 10 L50 50" fill="none" stroke="#000"/>'), opt()).length, 0, 'an open path makes no part');
const closedZ = parse(svg('<path d="M10 10 L50 10 L50 50 z"/>'), { ...opt(), flat: true });
assert.ok(closedZ.length === 1 && !closedZ[0].open, 'a path closed with z is a closed outline');
const meets = parse(svg('<path d="M10 10 L50 10 L50 50 L10 10"/>'), { ...opt(), flat: true });
assert.ok(meets.length === 1 && !meets[0].open, 'a path whose ends meet is closed without z');
console.log('svg parse ok');
