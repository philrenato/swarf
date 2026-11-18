// what a DXF's import reads: bulges, ellipses, blocks, a flipped extrusion, units, heights, text
// left out, and a drawing too big for any table refused before anything is built
//   node tools/test-dxf-read.mjs
import assert from 'node:assert/strict';
import { read, line, circle, lw } from './dxf-harness.mjs';

const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;
const one = async (ents, opt) => { const g = await read(ents, opt); assert.equal(g.parts.length, 1, `one part (${JSON.stringify(g.parts)})`); return { ...g, p: g.parts[0] }; };

// a 100 x 50 rectangle with 10 mm round corners, drawn as bulges (tan(90°/4))
const b = 0.41421356;
{
  const { p } = await one(lw([[10, 0], [90, 0, b], [100, 10], [100, 40, b], [90, 50], [10, 50, b], [0, 40], [0, 10, b]], true));
  assert.ok(near(p.w, 100) && near(p.h, 50), `rounded rect 100 x 50 (${p.w} x ${p.h})`);
  assert.ok(p.n > 20, `its corners are round, not square (${p.n} points)`);
}
// a circle from two half-circle bulges
{
  const { p } = await one(lw([[0, 0, 1], [20, 0, 1]], true));
  assert.ok(near(p.w, 20) && near(p.h, 20), `two bulges make a 20 mm circle (${p.w} x ${p.h})`);
}
// an ellipse 60 x 30 about (50, 50)
{
  const { p } = await one(['0', 'ELLIPSE', '8', '0', '10', 50, '20', 50, '30', 0, '11', 30, '21', 0, '31', 0, '40', 0.5, '41', 0, '42', 6.283185307]);
  assert.ok(near(p.w, 60, 0.1) && near(p.h, 30, 0.1) && near(p.x0, 20, 0.1), `ellipse 60 x 30 from x 20 (${JSON.stringify(p)})`);
}
// a block of a 20 x 10 rectangle placed twice, once at (100, 0) turned 90°
{
  const blocks = ['0', 'SECTION', '2', 'BLOCKS', '0', 'BLOCK', '8', '0', '2', 'BOX', '10', 0, '20', 0, ...lw([[0, 0], [20, 0], [20, 10], [0, 10]], true), '0', 'ENDBLK', '0', 'ENDSEC'];
  const ents = ['0', 'INSERT', '8', '0', '2', 'BOX', '10', 0, '20', 0, '30', 0, '0', 'INSERT', '8', '0', '2', 'BOX', '10', 100, '20', 0, '30', 0, '50', 90];
  const { V, wrap } = await import('./dxf-harness.mjs');
  const text = wrap(ents).replace('0\nSECTION\n2\nENTITIES', blocks.join('\n') + '\n0\nSECTION\n2\nENTITIES');
  const r = await V.toSVG('blocks.dxf', new TextEncoder().encode(text));
  assert.equal(r.closed, 2, `two placed blocks are two parts (${r.closed})`);
  assert.ok(near(r.box[0], 0) && near(r.box[1], 0), `placed where inserted (${r.box})`);
  assert.ok(near(r.box[2], 100) && near(r.box[3], 20), `the turned one stands 20 tall (${r.box})`);
}
// extrusion 0,0,-1: the drawing is seen from below, so x is mirrored
{
  const { p } = await one(circle(30, 0, 5, ['210', 0, '220', 0, '230', -1]));
  assert.ok(near(p.x0, -35), `a circle at x 30 seen from below sits at x -30 (${p.x0})`);
}
// units: $INSUNITS 1 inches, 4 mm; none with $MEASUREMENT 0 is inches; none at all is mm; the card's pick
{
  const c = circle(0, 0, 1);
  const inch = await one(c, { hdr: ['9', '$INSUNITS', '70', 1] });
  assert.ok(near(inch.p.w, 50.8) && inch.r.fileUnits && inch.r.units === 'inch', `$INSUNITS 1: 2 in across (${inch.p.w})`);
  const mm = await one(c, { hdr: ['9', '$INSUNITS', '70', 4] });
  assert.ok(near(mm.p.w, 2) && mm.r.fileUnits, `$INSUNITS 4: 2 mm across (${mm.p.w})`);
  const meas = await one(c, { hdr: ['9', '$MEASUREMENT', '70', 0] });
  assert.ok(near(meas.p.w, 50.8) && !meas.r.fileUnits && meas.r.units === 'inch', `no $INSUNITS, $MEASUREMENT 0: inches, and asked (${meas.p.w})`);
  const none = await one(c);
  assert.ok(near(none.p.w, 2) && !none.r.fileUnits && none.r.units === 'mm', `no units at all: mm, and asked (${none.p.w})`);
  const picked = await one(c, { units: 'inch' });
  assert.ok(near(picked.p.w, 50.8), `inches picked on the card (${picked.p.w})`);
}
// heights: one elevation says nothing, two are counted
{
  const sq = z => [...line(0, 0, 10, 0, z), ...line(10, 0, 10, 10, z), ...line(10, 10, 0, 10, z), ...line(0, 10, 0, 0, z)];
  assert.equal((await read(sq(-292.1))).r.heights, 1, 'drawn at one height');
  assert.equal((await read([...sq(-292.1), ...lw([[20, 0], [30, 0], [30, 10]], true)])).r.heights, 2, 'a polyline at 0 beside lines at -292.1: two heights');
}
// text is left out and counted
{
  const txt = ['0', 'TEXT', '8', '0', '10', 0, '20', 0, '40', 10, '1', 'HI'];
  const g = await read([...circle(0, 0, 5), ...txt, ...txt, ...txt]);
  assert.equal(g.parts.length, 1, 'the circle is still a part');
  assert.equal(g.r.text, 3, '3 text objects counted');
}
// a 5000 m circle: refused at once, nothing built
{
  const t = Date.now();
  const g = await read(circle(0, 0, 5e6), { maxMM: 5000 });
  assert.ok(g.r.big && near(g.r.big[0], 1e7, 1) && !g.r.svg, `refused as too big (${JSON.stringify(g.r.big)})`);
  assert.ok(Date.now() - t < 1000, 'and quickly');
}
console.log('dxf read ok');
