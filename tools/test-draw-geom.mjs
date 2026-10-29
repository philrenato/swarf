// DRAW's 2D math in node: the pencil's fit, regions (Unreason's planar arrangement) and the
// outlines made from the regions picked.
//   node tools/test-draw-geom.mjs
import assert from 'node:assert/strict';
import G from '../web/kiri/swarf-draw-geom.mjs';
import { signedArea2D } from '../web/kiri/vendor/unreason/trim.mjs';

const circle = (cx, cy, r, n = 96) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(2 * Math.PI * i / n), cy + r * Math.sin(2 * Math.PI * i / n)]);
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const bez = (q, t) => { const u = 1 - t; return [0, 1].map(j => u * u * u * q[0][j] + 3 * u * u * t * q[1][j] + 3 * u * t * t * q[2][j] + t * t * t * q[3][j]); };
const area = loops => loops.reduce((s, f) => s + Math.abs(signedArea2D(f.outer)) - f.holes.reduce((a, h) => a + Math.abs(signedArea2D(h)), 0), 0);
let n = 0;
const ok = (c, what) => { assert.ok(c, what); n++; console.log('ok  ', what); };

// ── the pencil ──
// a wobbly open stroke, quantized to a pixel at 2 px/mm: the fit stays within its tolerance
{
  const raw = [];
  for (let i = 0; i <= 300; i++) { const x = i * 0.5; raw.push([Math.round((x) * 2) / 2, Math.round((20 * Math.sin(x / 15)) * 2) / 2]); }
  const S = G.smoothStroke(raw, false);
  const tol = 0.75;                                    // 1.5 px at 2 px/mm
  const idx = G.fitStroke(S, false, { tol });
  const err = G.fitError(S, false, idx);
  ok(idx[0] === 0 && idx[idx.length - 1] === S.length - 1, 'an open stroke keeps both ends');
  ok(err <= tol + 1e-9 && idx.length >= 4 && idx.length < 30, `a sine stroke fits to ${err.toFixed(3)} mm with ${idx.length} points (tolerance ${tol})`);
  const i6 = G.fitStroke(S, false, { count: 6 });
  ok(i6.length === 6, `asked for 6 points, 6 kept (${i6.length})`);
  const i12 = G.fitStroke(S, false, { count: 12 });
  ok(i12.length === 12 && G.fitError(S, false, i12) < G.fitError(S, false, i6), `12 points fit closer than 6 (${G.fitError(S, false, i12).toFixed(3)} < ${G.fitError(S, false, i6).toFixed(3)})`);
  const P = G.fitPieces(S, false, i6);
  ok(P.length === 5 && P.every((q, k) => k === 0 || Math.hypot(q[0][0] - P[k - 1][3][0], q[0][1] - P[k - 1][3][1]) < 1e-12), '6 points: 5 cubic pieces end to end');
  // every inner point smooth: its two handles in line
  ok(P.slice(1).every((q, k) => { const a = P[k][2], m = q[0], b = q[1]; const u = [m[0] - a[0], m[1] - a[1]], v = [b[0] - m[0], b[1] - m[1]]; return Math.abs(u[0] * v[1] - u[1] * v[0]) < 1e-9 * (Math.hypot(...u) * Math.hypot(...v) + 1); }), 'each point is smooth (handles in line)');
}
// a closed wobbly circle: closed fit, at least 5 points
{
  const S = G.smoothStroke(circle(0, 0, 40, 240).map(([x, y], i) => [x + 0.4 * Math.sin(i), y]), true);
  const idx = G.fitStroke(S, true, { tol: 0.5 });
  ok(idx.length >= 5 && G.fitError(S, true, idx) <= 0.5 + 1e-9, `a closed stroke: ${idx.length} points, within 0.5 mm`);
  const P = G.fitPieces(S, true, idx);
  ok(P.length === idx.length && Math.hypot(P[P.length - 1][3][0] - P[0][0][0], P[P.length - 1][3][1] - P[0][0][1]) < 1e-12, 'closed: as many pieces as points, ending where it began');
}

// ── regions ──
{
  // a circle inside a rectangle: two regions (the ring and the disc)
  const arr = G.regions([rect(0, 0, 100, 60), circle(50, 30, 15)]);
  ok(arr.faces.length === 2 && arr.faces.every(f => f.at), `rectangle with a circle inside: ${arr.faces.length} regions, each with a point inside`);
  const ring = arr.faces.findIndex(f => f.holes.length === 1);
  ok(ring >= 0 && Math.abs(arr.faces[ring].area - (6000 - Math.PI * 225)) < 6000 * 0.005, `the ring is the rectangle less the circle (${arr.faces[ring].area.toFixed(0)} mm²)`);
  const out = G.merge(arr, [ring]);
  ok(out.length === 1 && out[0].holes.length === 1, 'the ring alone: one outline with one hole');
}
{
  // two overlapping rectangles: three regions; filled both ends and not the middle = two parts
  const arr = G.regions([rect(0, 0, 60, 40), rect(40, 0, 100, 40)]);
  ok(arr.faces.length === 3, `two overlapping rectangles: ${arr.faces.length} regions`);
  const mid = arr.faces.findIndex(f => f.at[0] > 40 && f.at[0] < 60);
  const ends = arr.faces.map((_, i) => i).filter(i => i !== mid);
  const two = G.merge(arr, ends);
  ok(two.length === 2 && Math.abs(area(two) - 3200) < 1e-6, `both ends without the middle: 2 outlines, ${area(two)} mm²`);
  const all = G.merge(arr, [0, 1, 2]);
  ok(all.length === 1 && Math.abs(area(all) - 4000) < 1e-6 && all[0].outer.length >= 4, `all three: one outline 100 × 40 (${area(all)} mm²)`);
  // the union's outline fitted back to curves: four straight sides, corners kept
  const P = G.fitLoop(all[0].outer);
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const q of P) for (let k = 0; k <= 8; k++) { const p = bez(q, k / 8); box[0] = Math.min(box[0], p[0]); box[1] = Math.min(box[1], p[1]); box[2] = Math.max(box[2], p[0]); box[3] = Math.max(box[3], p[1]); }
  ok(P.length <= 8 && box.every((v, i) => Math.abs(v - [0, 0, 100, 40][i]) < 1e-6), `fitted back: ${P.length} pieces in the box ${box}`);
}
{
  // a circle over a rectangle's edge, cut from it: the rectangle with a bite out of its side
  const arr = G.regions([rect(0, 0, 100, 60), circle(100, 30, 20)]);
  const R = rect(0, 0, 100, 60), C = circle(100, 30, 20);
  const keep = arr.faces.map((f, i) => [f, i]).filter(([f]) => G.inside(f.at, R) && !G.inside(f.at, C)).map(([, i]) => i);
  const out = G.merge(arr, keep);
  ok(out.length === 1 && out[0].holes.length === 0 && Math.abs(area(out) - (6000 - Math.PI * 400 / 2)) < 6000 * 0.005, `cut: one outline, ${area(out).toFixed(0)} mm² (the rectangle less half the circle)`);
  const P = G.fitLoop(out[0].outer);
  // the bite stays round: a point at its deepest sits 20 mm in from the side
  let deep = Infinity;
  for (const q of P) for (let k = 0; k <= 16; k++) { const p = bez(q, k / 16); if (Math.abs(p[1] - 30) < 2 && p[0] > 50) deep = Math.min(deep, p[0]); }
  ok(Math.abs(deep - 80) < 0.1 && P.length < 20, `the bite fitted back to ${P.length} pieces, its deepest at x ${deep.toFixed(2)} (80)`);
}
console.log(`draw geom: ${n} ok`);
