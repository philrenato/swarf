/*
 * swarf draw geometry — the plain 2D math under DRAW's pencil, holes and regions
 * (no page, no DOM: tools/test-draw-geom.mjs runs it in node).
 *
 *   smoothStroke(pts, closed)          a [1/4, 1/2, 1/4] average along a stroke: pointer
 *     positions arrive on whole pixels, and the fit would spend points on the stair-step
 *   fitStroke(pts, closed, opt)        the stroke points to keep, in order. opt.tol (mm): add,
 *     in every span that strays past it, the stroke point that strays farthest; opt.count:
 *     add the farthest point of all, one at a time, until there are that many
 *   piecesThrough(P, closed)           cubic pieces through points, each point smooth (its two
 *     handles in line), a handle a third of the way to its neighbor; an open end aims at
 *     its neighbor
 *   fitLoop(loop, tol)                 a closed polyline (a region's edge) as cubic pieces: its
 *     corners kept sharp, the runs between them fitted to tol
 *   regions(loops)                     every region a set of closed polylines encloses
 *     (Unreason's planar arrangement), each with a point inside it
 *   merge(arr, faces)                  the filled regions as outlines: [{ outer, holes }]
 *   inside(p, loop)                    even-odd, for a closed polyline
 *
 * Points are [x, y] in mm. The pencil's method follows Unreason's: smooth, then add
 * points by insertion where the fit strays (removal by area rings between a cluster
 * and a gap, so a count cannot be searched for).
 */
import { buildPlanarArrangement, mergeFaces } from './vendor/unreason/arrangement.mjs';
import { pointInUVPolygon, signedArea2D } from './vendor/unreason/trim.mjs';

export function smoothStroke(pts, closed) {
  const n = pts.length;
  if (n < 3) return pts.map(p => [p[0], p[1]]);
  return pts.map((p, i) => {
    if (!closed && (i === 0 || i === n - 1)) return [p[0], p[1]];
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    return [0.25 * a[0] + 0.5 * p[0] + 0.25 * b[0], 0.25 * a[1] + 0.5 * p[1] + 0.25 * b[1]];
  });
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = v => Math.hypot(v[0], v[1]);
// T (optional): each point's direction, from the stroke itself; without it, from its neighbors.
// A handle is chord / (3 cos²(a/2)), a the angle between the point's direction and the chord:
// a third of the chord on a straight run, the exact circle where the two directions turn alike.
export function piecesThrough(P, closed, T) {
  const n = P.length, out = [];
  if (n < 2) return out;
  T = T || P.map((p, i) => {
    let d;
    if (closed) d = sub(P[(i + 1) % n], P[(i - 1 + n) % n]);
    else if (i === 0) d = sub(P[1], P[0]);
    else if (i === n - 1) d = sub(P[n - 1], P[n - 2]);
    else d = sub(P[i + 1], P[i - 1]);
    const l = len(d) || 1;
    return [d[0] / l, d[1] / l];
  });
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const a = P[i], b = P[(i + 1) % n], ch = sub(b, a), c = len(ch);
    if (!(c > 1e-12)) { out.push([a.slice(0, 2), a.slice(0, 2), b.slice(0, 2), b.slice(0, 2)]); continue; }
    const u = [ch[0] / c, ch[1] / c];
    const h = t => { const cs = Math.max(0, Math.min(1, t[0] * u[0] + t[1] * u[1])), half = (1 + cs) / 2; return c / (3 * Math.max(0.5, half)); };
    // two points of an open run: a straight piece
    const ta = !closed && n === 2 ? u : T[i], tb = !closed && n === 2 ? u : T[(i + 1) % n];
    const la = h(ta), lb = h(tb);
    out.push([[a[0], a[1]], [a[0] + ta[0] * la, a[1] + ta[1] * la], [b[0] - tb[0] * lb, b[1] - tb[1] * lb], [b[0], b[1]]]);
  }
  return out;
}
// a stroke's direction at point i, from the points around it (one-sided at an open end)
function tangentAt(S, i, closed, reach = 2) {
  const n = S.length;
  let a, b;
  if (closed) { a = S[(i - reach + n * 4) % n]; b = S[(i + reach) % n]; }
  else { a = S[Math.max(0, i - reach)]; b = S[Math.min(n - 1, i + reach)]; if (i === 0) b = S[Math.min(n - 1, 1)]; if (i === n - 1) a = S[Math.max(0, n - 2)]; }
  const d = sub(b, a), l = len(d) || 1;
  return [d[0] / l, d[1] / l];
}
// the cubic pieces of the fit through the stroke points at idx
export function fitPieces(S, closed, idx) {
  return piecesThrough(idx.map(i => S[i]), closed, idx.map(i => tangentAt(S, i, closed)));
}
const bez = (q, t) => { const u = 1 - t; return [u * u * u * q[0][0] + 3 * u * u * t * q[1][0] + 3 * u * t * t * q[2][0] + t * t * t * q[3][0], u * u * u * q[0][1] + 3 * u * u * t * q[1][1] + 3 * u * t * t * q[2][1] + t * t * t * q[3][1]]; };
function toPolyline(p, s) {
  let best = Infinity;
  for (let i = 0; i + 1 < s.length; i++) {
    const a = s[i], b = s[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]));
  }
  return best;
}
// how far each span strays: [{ worst, at }] per span of the fit through `idx`
function strays(S, closed, idx) {
  const n = S.length, pieces = fitPieces(S, closed, idx), out = [];
  const mid = i => { const a = S[i % n], b = S[(i + 1) % n]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
  for (let k = 0; k < pieces.length; k++) {
    const i0 = idx[k], i1 = closed && k === idx.length - 1 ? idx[0] + n : idx[k + 1];
    const steps = Math.max(16, 8 * (i1 - i0)), s = [];
    for (let j = 0; j <= steps; j++) s.push(bez(pieces[k], j / steps));
    let worst = 0, at = -1;
    for (let i = i0; i < i1; i++) {
      const dP = i > i0 ? toPolyline(S[i % n], s) : 0, dM = toPolyline(mid(i), s);
      if (dP > worst) { worst = dP; at = i; }
      if (dM > worst) { worst = dM; at = i + 1 < i1 ? i + 1 : (i > i0 ? i : -1); }
    }
    out.push({ worst, at: at >= 0 ? at % n : -1 });
  }
  return out;
}
export const MAX_POINTS = 200;
export function fitStroke(S, closed, opt = {}) {
  const n = S.length, min = opt.min ?? (closed ? 5 : 4);
  const want = opt.count ? Math.max(closed ? 3 : 2, Math.min(opt.count, MAX_POINTS, n)) : 0;
  if (n <= (want || min)) return S.map((_, i) => i);
  const kept = new Set(), seeds = Math.min(want || min, min);
  const sN = closed ? seeds : seeds - 1;
  for (let i = 0; i < sN; i++) kept.add(Math.round((i * (closed ? n : n - 1)) / sN));
  if (!closed) kept.add(n - 1);
  for (let guard = 0; guard < MAX_POINTS; guard++) {
    const idx = [...kept].sort((x, y) => x - y);
    if (want && idx.length >= want) return idx;
    const st = strays(S, closed, idx);
    if (want) {
      const w = st.reduce((a, b) => (b.at >= 0 && b.worst > a.worst ? b : a), { worst: -1, at: -1 });
      if (w.at < 0 || kept.has(w.at)) return idx;
      kept.add(w.at);
    } else {
      const add = st.filter(s => s.at >= 0 && s.worst > opt.tol && !kept.has(s.at)).map(s => s.at);
      if (!add.length || kept.size + add.length > MAX_POINTS) return idx;
      for (const i of add) kept.add(i);
    }
  }
  return [...kept].sort((x, y) => x - y);
}
// the worst distance from the stroke to the fit through `idx` (for the card and the tests)
export function fitError(S, closed, idx) { return Math.max(0, ...strays(S, closed, idx).map(s => s.worst)); }

// a closed polyline's corners: where its direction turns more than `deg` across a short reach
function corners(L, deg) {
  const n = L.length, out = [], c = Math.cos(deg * Math.PI / 180);
  for (let i = 0; i < n; i++) {
    const a = L[(i - 1 + n) % n], p = L[i], b = L[(i + 1) % n];
    const u = sub(p, a), v = sub(b, p), lu = len(u), lv = len(v);
    if (!(lu > 1e-9 && lv > 1e-9)) continue;
    if ((u[0] * v[0] + u[1] * v[1]) / (lu * lv) < c) out.push(i);
  }
  return out;
}
export function fitLoop(loop, tol = 0.05) {
  let L = loop.slice();
  if (L.length > 1 && len(sub(L[0], L[L.length - 1])) < 1e-9) L.pop();
  // drop points closer than a hundredth of a mm, and points on a straight line
  L = L.filter((p, i) => i === 0 || len(sub(p, L[i - 1])) > 0.01);
  const C = corners(L, 25);
  if (!C.length) return fitPieces(L, true, fitStroke(L, true, { tol, min: 4 }));
  const out = [], n = L.length;
  for (let k = 0; k < C.length; k++) {
    const i0 = C[k], i1 = k + 1 < C.length ? C[k + 1] : C[0] + n;
    const run = [];
    for (let i = i0; i <= i1; i++) run.push(L[i % n]);
    const idx = run.length <= 2 ? run.map((_, i) => i) : fitStroke(run, false, { tol, min: 2 });
    out.push(...fitPieces(run, false, idx));
  }
  return out;
}

export const inside = (p, loop) => pointInUVPolygon(loop, p[0], p[1]) === 'inside';
// a point inside a region (and outside its holes): a little in from the middle of one of its edges
function pointIn(face) {
  const O = face.outer, n = O.length;
  const ok = q => inside(q, O) && !face.holes.some(h => pointInUVPolygon(h, q[0], q[1]) !== 'outside');
  const order = [...O.keys()].sort((i, j) => len(sub(O[(j + 1) % n], O[j])) - len(sub(O[(i + 1) % n], O[i])));
  for (const eps of [0.02, 0.005, 0.1, 0.001]) for (const i of order.slice(0, 24)) {
    const a = O[i], b = O[(i + 1) % n], d = sub(b, a), l = len(d);
    if (!(l > 1e-9)) continue;
    // the outer loop runs counterclockwise: inside is to the left
    const q = [(a[0] + b[0]) / 2 - d[1] / l * Math.min(eps, l / 4), (a[1] + b[1]) / 2 + d[0] / l * Math.min(eps, l / 4)];
    if (ok(q)) return q;
  }
  return null;
}
export function regions(loops, opt = {}) {
  const arr = buildPlanarArrangement(loops.map(l => (len(sub(l[0], l[l.length - 1])) < 1e-9 ? l : l.concat([l[0]]))), { weldTolerance: opt.weld ?? 1e-3 });
  arr.faces.forEach(f => { f.at = pointIn(f); f.area = Math.abs(signedArea2D(f.outer)) - f.holes.reduce((s, h) => s + Math.abs(signedArea2D(h)), 0); });
  return arr;
}
// the boundary walk of the kept edges also returns, as a region, every unpicked one they
// wholly enclose (a ring's disc): only those whose inside is a picked region are kept
const inFace = (q, f) => inside(q, f.outer) && !f.holes.some(h => pointInUVPolygon(h, q[0], q[1]) !== 'outside');
export function merge(arr, faces) {
  if (!faces.length) return [];
  const picked = faces.map(i => arr.faces[i]);
  return mergeFaces(arr, faces).filter(f => {
    if (!(Math.abs(signedArea2D(f.outer)) > 1e-6)) return false;
    const q = pointIn(f);
    return q && picked.some(p => inFace(q, p));
  });
}

const G = { smoothStroke, fitStroke, fitError, fitPieces, piecesThrough, fitLoop, regions, merge, inside, MAX_POINTS };
if (typeof window !== 'undefined') window.SwarfDrawGeom = G;
export default G;
