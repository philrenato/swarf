// node tools/test-svg-tidy.mjs — what an SVG import reads: <use>/<symbol> copies drawn, hidden
// shapes and clip/mask shapes left out, text counted. Runs the loader itself (src/load/svg.js) on
// xmldom, the parts counted after tidy as the import makes them.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
globalThis.DOMParser = class extends DOMParser { constructor() { super({ onError() {} }); } };
globalThis.XMLSerializer = XMLSerializer;
globalThis.self = globalThis;
const { THREE } = await import('../src/ext/three.js');
globalThis.THREE = THREE;
await import('../src/add/array.js');
await import('../src/add/three.js');
const SVG = await import('../src/load/svg.js');

const s = (body, attrs = 'width="100mm" height="100mm" viewBox="0 0 100 100"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${body}</svg>`;
const read = body => { const t = SVG.tidy(s(body)); const p = SVG.parse(t.svg, { flat: true, soup: true }).filter(x => !x.open); return { t, p }; };
const box = p => { const a = [1e9, 1e9, -1e9, -1e9]; for (const q of p.points) { a[0] = Math.min(a[0], q.x); a[1] = Math.min(a[1], q.y); a[2] = Math.max(a[2], q.x); a[3] = Math.max(a[3], q.y); } return a.map(v => +v.toFixed(2)); };
let n = 0;
const ok = (what, fn) => { fn(); n++; console.log('ok  ', what); };

ok('a <use> of a circle in <defs>, twice (href and xlink:href): two circles where they were put', () => {
  const { t, p } = read('<defs><circle id="c" cx="0" cy="0" r="10"/></defs><use xlink:href="#c" x="20" y="20"/><use href="#c" x="60" y="60"/>');
  assert.equal(t.uses, 2); assert.equal(p.length, 2);
  const c = p.map(box).map(b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(c.map(v => v.map(Math.round)), [[20, -20], [60, -60]]);
});
ok('a <symbol> shown by a <use>: its shapes, moved; the symbol itself not drawn', () => {
  const { t, p } = read('<symbol id="s"><rect width="10" height="10"/></symbol><use href="#s" x="5" y="5"/>');
  assert.equal(t.uses, 1); assert.equal(p.length, 1); assert.deepEqual(box(p[0]), [5, -15, 15, -5]);
});
ok('a <use> of a group with a transform on the use', () => {
  const { p } = read('<defs><g id="g"><rect width="10" height="10"/><rect x="20" width="10" height="10"/></g></defs><use href="#g" transform="translate(50 0)"/>');
  assert.equal(p.length, 2); assert.deepEqual(p.map(box).map(b => b[0]).sort((a, b) => a - b), [50, 70]);
});
ok('a <use> of a <use> (nested), and one pointing at itself stops', () => {
  const { t, p } = read('<defs><rect id="r" width="10" height="10"/><use id="u" href="#r" x="10"/></defs><use href="#u" x="10"/><g id="loop"><use href="#loop"/></g>');
  assert.equal(p.length, 1); assert.deepEqual(box(p[0]), [20, -10, 30, 0]);
  assert.ok(t.missing >= 1, 'the loop is left out');
});
ok('a <use> pointing nowhere is counted, not drawn', () => {
  const { t, p } = read('<use href="#nope"/><rect width="10" height="10"/>');
  assert.equal(t.missing, 1); assert.equal(p.length, 1);
});
ok('display:none by style, attribute and class rule; visibility hidden: left out and counted', () => {
  const { t, p } = read('<style>.h{display:none} .k, #v { visibility: hidden }</style><rect width="10" height="10" style="display:none"/><rect y="20" width="10" height="10" display="none"/><g class="h"><rect y="40" width="10" height="10"/><circle cx="5" cy="70" r="3"/></g><rect id="v" x="40" width="5" height="5"/><rect x="20" width="10" height="10"/>');
  assert.equal(p.length, 1); assert.deepEqual(box(p[0]), [20, -10, 30, 0]);
  assert.equal(t.hidden, 5);
});
ok('a clipPath and a mask make no part', () => {
  const { t, p } = read('<clipPath id="cp"><rect width="50" height="50"/></clipPath><mask id="m"><rect width="90" height="90"/></mask><rect x="60" width="10" height="10" clip-path="url(#cp)"/>');
  assert.equal(p.length, 1); assert.equal(t.hidden, 0, 'not counted as hidden: they never were shapes');
});
ok('text is counted (never read); a part around it still comes in', () => {
  const { t, p } = read('<rect width="80" height="40"/><text x="10" y="20" font-size="10">HELLO</text><g><text>A</text></g>');
  assert.equal(t.text, 2); assert.equal(p.length, 1);
});
ok('a <use> with its own width and height shows its symbol at that size, centred', () => {
  const { p } = read('<symbol id="s" viewBox="0 0 10 10"><rect width="10" height="10"/></symbol><use href="#s" x="10" y="10" width="50" height="50"/><use href="#s" x="0" y="70" width="40" height="20"/>');
  const b = p.map(box).sort((a, c) => a[1] - c[1]);
  assert.deepEqual(b[1], [10, -60, 60, -10], '50 x 50 where it was put');
  assert.deepEqual(b[0], [10, -90, 30, -70], 'fits the short side, centred along the long one');
});
ok('rules by tag and class, or by two classes, hide what they name and only that', () => {
  const { t, p } = read('<style>g.off{display:none} .a.b{visibility:hidden}</style><g class="off"><rect width="5" height="5"/></g><rect class="off" x="20" width="5" height="5"/><rect class="a b" x="40" width="5" height="5"/><rect class="a" x="60" width="5" height="5"/>');
  assert.equal(t.hidden, 2); assert.equal(p.length, 2);
  assert.deepEqual(p.map(box).map(b => b[0]).sort((a, c) => a - c), [20, 60]);
});
ok('pictures and clipping masks are counted', () => {
  const { t } = read('<image href="x.png" width="10" height="10"/><defs><clipPath id="c"><rect width="5" height="5"/></clipPath></defs><circle r="10" cx="50" cy="50" clip-path="url(#c)"/>');
  assert.equal(t.images, 1); assert.equal(t.clipped, 1);
});
ok('a drawing with nothing to put right comes back as it was', () => {
  const src = s('<rect width="10" height="10"/>');
  const t = SVG.tidy(src); assert.equal(t.svg, src); assert.equal(t.uses + t.hidden + t.text + t.missing, 0);
});
ok('not an SVG: returned as it was', () => {
  const t = SVG.tidy('hello'); assert.equal(t.svg, 'hello');
});
console.log(`test-svg-tidy: all ${n} passed`);
