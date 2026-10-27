// Vendored unchanged from Unreason (unreason3d-web/app/exchange-2d-read.mjs, commit 0bcd8b70, 10-27) for swarf's 2D import/export.
// 2D EXCHANGE, READING — SVG, DXF and PDF/AI into NURBS curves in millimetres
// on the XY plane. No DOM, no three.js.
//
// Every reader returns { curves: [{ name, layer, crv }], skipped: { kind: n },
// note } with crv = { degree, knots, ctrlPts: [[x, y, 0, w]…] }. Arcs and
// circles come in as exact rational quadratics, Béziers as degree-3 pieces
// joined C0, polylines as degree 1.

// ── Curve builders ──
export function polyCrv(pts, closed = false) {
  const P = pts.map(([x, y]) => [x, y, 0, 1]);
  if (closed && P.length > 2) P.push(P[0].slice());
  const n = P.length;
  const knots = [0, 0];
  for (let i = 1; i < n - 1; i++) knots.push(i);
  knots.push(n - 1, n - 1);
  return { degree: 1, knots, ctrlPts: P };
}

// Cubic Bézier pieces [[p0, p1, p2, p3]…] joined end to end as one degree-3 curve.
export function bezierChainCrv(pieces) {
  const P = [[...pieces[0][0], 0, 1]];
  const knots = [0, 0, 0, 0];
  pieces.forEach((C, i) => {
    P.push([...C[1], 0, 1], [...C[2], 0, 1], [...C[3], 0, 1]);
    const k = i + 1;
    if (i < pieces.length - 1) knots.push(k, k, k); else knots.push(k, k, k, k);
  });
  return { degree: 3, knots, ctrlPts: P };
}

// An elliptical arc as rational quadratic spans of at most 90°: center
// (cx, cy), radii rx, ry, x-axis rotation phi, from angle a0 sweeping `sweep`
// (radians, signed).
export function arcCrv(cx, cy, rx, ry, phi, a0, sweep) {
  const nSeg = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const d = sweep / nSeg, w = Math.cos(d / 2);
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const at = (a, scale = 1) => {
    const x = rx * Math.cos(a) * scale, y = ry * Math.sin(a) * scale;
    return [cx + x * cp - y * sp, cy + x * sp + y * cp];
  };
  const P = [[...at(a0), 0, 1]];
  const knots = [0, 0, 0];
  for (let i = 0; i < nSeg; i++) {
    const s = a0 + i * d;
    P.push([...at(s + d / 2, 1 / w), 0, w], [...at(s + d), 0, 1]);
    if (i < nSeg - 1) knots.push(i + 1, i + 1);
  }
  knots.push(nSeg, nSeg, nSeg);
  return { degree: 2, knots, ctrlPts: P };
}

const mat = (a, b, c, d, e, f) => [a, b, c, d, e, f];
const IDENT = mat(1, 0, 0, 1, 0, 0);
// [a b c d e f] maps (x, y) to (a x + c y + e, b x + d y + f), as in SVG and PDF.
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const xf = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
// An affine map is exact on NURBS control points; weights stay.
function xfCrv(m, crv) {
  return { ...crv, ctrlPts: crv.ctrlPts.map(([x, y, z, w]) => [...xf(m, [x, y]), z, w]) };
}

// ── SVG ──
const UNIT_MM = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, q: 0.25, '': 25.4 / 96 };
function lengthMM(v, pxMM) {
  const m = String(v || '').trim().match(/^([-+]?[\d.]+(?:e[-+]?\d+)?)\s*([a-z%]*)$/i);
  if (!m) return null;
  const u = m[2].toLowerCase();
  if (u === '%') return null;
  return parseFloat(m[1]) * (u === '' || u === 'px' ? pxMM : UNIT_MM[u] ?? null);
}

function parseXML(text) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/\s*([^\s>]+)\s*>|<\s*([^\s/>]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    if (!m[2]) continue;
    const attrs = {};
    const ar = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = ar.exec(m[3] || ''))) attrs[a[1]] = (a[3] ?? a[4]).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const node = { tag: m[2].replace(/^svg:/, ''), attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!m[4]) stack.push(node);
  }
  return root;
}

function parseTransform(t) {
  let m = IDENT;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let g;
  while ((g = re.exec(t || ''))) {
    const v = g[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let n = IDENT;
    if (g[1] === 'matrix') n = mat(...v);
    else if (g[1] === 'translate') n = mat(1, 0, 0, 1, v[0] || 0, v[1] || 0);
    else if (g[1] === 'scale') n = mat(v[0], 0, 0, v[1] ?? v[0], 0, 0);
    else if (g[1] === 'rotate') {
      const r = (v[0] || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
      n = mat(c, s, -s, c, 0, 0);
      if (v.length >= 3) n = mul(mul(mat(1, 0, 0, 1, v[1], v[2]), n), mat(1, 0, 0, 1, -v[1], -v[2]));
    } else if (g[1] === 'skewX') n = mat(1, 0, Math.tan(v[0] * Math.PI / 180), 1, 0, 0);
    else n = mat(1, Math.tan(v[0] * Math.PI / 180), 0, 1, 0, 0);
    m = mul(m, n);
  }
  return m;
}

// SVG path data to subpaths of segments: { type: 'L', a, b } | { type: 'C', p: [p0..p3] } | { type: 'A', … }.
function parsePathD(d) {
  const toks = String(d || '').match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  const subs = [];
  let i = 0, cmd = null, cur = [0, 0], start = [0, 0], lastC = null, lastQ = null, sub = null;
  const num = () => parseFloat(toks[i++]);
  const flag = () => { const t = toks[i]; if (t === '0' || t === '1') { i++; return +t; } const c = t[0]; toks[i] = t.slice(1); if (!toks[i]) i++; return +c; };
  const begin = (p) => { sub = { segs: [], closed: false }; subs.push(sub); start = p; };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    if (!cmd) break;
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const pt = () => { const x = num(), y = num(); return rel ? [cur[0] + x, cur[1] + y] : [x, y]; };
    if (C === 'M') { const p = pt(); begin(p); cur = p; cmd = rel ? 'l' : 'L'; lastC = lastQ = null; continue; }
    if (C === 'Z') { if (sub) { if (Math.hypot(cur[0] - start[0], cur[1] - start[1]) > 1e-12) sub.segs.push({ type: 'L', a: cur, b: start }); sub.closed = true; } cur = start; sub = null; lastC = lastQ = null; cmd = null; continue; }
    if (!sub) begin(cur);
    if (C === 'L' || C === 'H' || C === 'V') {
      let p;
      if (C === 'L') p = pt();
      else if (C === 'H') { const x = num(); p = [rel ? cur[0] + x : x, cur[1]]; }
      else { const y = num(); p = [cur[0], rel ? cur[1] + y : y]; }
      sub.segs.push({ type: 'L', a: cur, b: p }); cur = p; lastC = lastQ = null;
    } else if (C === 'C' || C === 'S') {
      const c1 = C === 'C' ? pt() : (lastC ? [2 * cur[0] - lastC[0], 2 * cur[1] - lastC[1]] : cur);
      const c2 = pt(), p = pt();
      sub.segs.push({ type: 'C', p: [cur, c1, c2, p] }); lastC = c2; lastQ = null; cur = p;
    } else if (C === 'Q' || C === 'T') {
      const q = C === 'Q' ? pt() : (lastQ ? [2 * cur[0] - lastQ[0], 2 * cur[1] - lastQ[1]] : cur);
      const p = pt();
      sub.segs.push({ type: 'C', p: [cur, [cur[0] + 2 / 3 * (q[0] - cur[0]), cur[1] + 2 / 3 * (q[1] - cur[1])], [p[0] + 2 / 3 * (q[0] - p[0]), p[1] + 2 / 3 * (q[1] - p[1])], p] });
      lastQ = q; lastC = null; cur = p;
    } else if (C === 'A') {
      const rx = Math.abs(num()), ry = Math.abs(num()), phi = num() * Math.PI / 180, large = flag(), sweepF = flag();
      const p = pt();
      sub.segs.push({ type: 'A', a: cur, b: p, rx, ry, phi, large, sweep: sweepF }); cur = p; lastC = lastQ = null;
    } else { i++; }
  }
  return subs.filter((s) => s.segs.length);
}

// SVG arc endpoint form to center form (SVG 1.1 F.6.5–F.6.6).
function arcCenter({ a, b, rx, ry, phi, large, sweep }) {
  if (rx === 0 || ry === 0) return null;
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (a[0] - b[0]) / 2, dy = (a[1] - b[1]) / 2;
  const x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  let co = Math.sqrt(Math.max(0, num / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  if (large === sweep) co = -co;
  const cxp = co * rx * y1 / ry, cyp = -co * ry * x1 / rx;
  const cx = cp * cxp - sp * cyp + (a[0] + b[0]) / 2, cy = sp * cxp + cp * cyp + (a[1] + b[1]) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; else if (sweep && dt < 0) dt += 2 * Math.PI;
  return { cx, cy, rx, ry, phi, t1, dt };
}

// One subpath to one curve: all lines → polyline; otherwise every segment as
// cubics (an arc becomes its own exact curve when it stands alone).
function subpathCrv(sub) {
  if (sub.segs.every((s) => s.type === 'L')) {
    const pts = [sub.segs[0].a, ...sub.segs.map((s) => s.b)];
    if (sub.closed) pts.pop();
    return polyCrv(pts, sub.closed);
  }
  if (sub.segs.length === 1 && sub.segs[0].type === 'A') {
    const c = arcCenter(sub.segs[0]);
    if (c) return arcCrv(c.cx, c.cy, c.rx, c.ry, c.phi, c.t1, c.dt);
  }
  const pieces = [];
  for (const s of sub.segs) {
    if (s.type === 'L') pieces.push([s.a, lerp(s.a, s.b, 1 / 3), lerp(s.a, s.b, 2 / 3), s.b]);
    else if (s.type === 'C') pieces.push(s.p);
    else {
      const c = arcCenter(s);
      if (!c) { pieces.push([s.a, lerp(s.a, s.b, 1 / 3), lerp(s.a, s.b, 2 / 3), s.b]); continue; }
      pieces.push(...ellipseArcCubics(c.cx, c.cy, c.rx, c.ry, c.phi, c.t1, c.dt));
    }
  }
  return bezierChainCrv(pieces);
}
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function ellipseArcCubics(cx, cy, rx, ry, phi, t1, dt) {
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 4)));
  const d = dt / n, k = (4 / 3) * Math.tan(d / 4);
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const P = (t) => { const x = rx * Math.cos(t), y = ry * Math.sin(t); return [cx + x * cp - y * sp, cy + x * sp + y * cp]; };
  const D = (t) => { const x = -rx * Math.sin(t), y = ry * Math.cos(t); return [x * cp - y * sp, x * sp + y * cp]; };
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = t1 + i * d, b = a + d, pa = P(a), pb = P(b), da = D(a), db = D(b);
    out.push([pa, [pa[0] + k * da[0], pa[1] + k * da[1]], [pb[0] - k * db[0], pb[1] - k * db[1]], pb]);
  }
  return out;
}

// pxPerInch: 96 (CSS) unless the file says it came from Illustrator, which
// writes 72 user units per inch.
export function parseSVG(text, { pxPerInch = null } = {}) {
  const doc = parseXML(text);
  const svg = (function find(n) { if (n.tag === 'svg') return n; for (const c of n.children) { const r = find(c); if (r) return r; } return null; })(doc);
  if (!svg) throw new Error('not an SVG file (no <svg> element)');
  const illustrator = /Generator:\s*Adobe Illustrator/i.test(text);
  const ppi = pxPerInch || (illustrator ? 72 : 96);
  const pxMM = 25.4 / ppi;
  const vb = (svg.attrs.viewBox || '').split(/[\s,]+/).filter(Boolean).map(Number);
  const wMM = lengthMM(svg.attrs.width, pxMM), hMM = lengthMM(svg.attrs.height, pxMM);
  // User units to millimetres: the viewBox maps onto width × height (uniform,
  // centred, per the default preserveAspectRatio "xMidYMid meet").
  let root = mat(pxMM, 0, 0, pxMM, 0, 0);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    const W = wMM ?? vb[2] * pxMM, H = hMM ?? vb[3] * pxMM;
    const par = String(svg.attrs.preserveAspectRatio || 'xMidYMid meet');
    let sx = W / vb[2], sy = H / vb[3];
    let tx = 0, ty = 0;
    if (!/^none/.test(par)) {
      const s = /slice/.test(par) ? Math.max(sx, sy) : Math.min(sx, sy);
      const ax = /xMin/.test(par) ? 0 : /xMax/.test(par) ? 1 : 0.5, ay = /YMin/.test(par) ? 0 : /YMax/.test(par) ? 1 : 0.5;
      tx = (W - vb[2] * s) * ax; ty = (H - vb[3] * s) * ay; sx = sy = s;
    }
    root = mat(sx, 0, 0, sy, tx - vb[0] * sx, ty - vb[1] * sy);
  } else if (wMM == null && hMM == null) root = mat(pxMM, 0, 0, pxMM, 0, 0);
  // SVG's y runs down and the model's up: y is negated about the user-space
  // origin, and the viewBox offset is dropped, so a drawing keeps its own
  // coordinates (a file this app wrote comes back where it was).
  root = mat(root[0], 0, 0, root[3], 0, 0);
  const flip = mat(1, 0, 0, -1, 0, 0);
  const defs = new Map();
  (function collect(n) { if (n.attrs.id) defs.set(n.attrs.id, n); for (const c of n.children) collect(c); })(svg);
  const curves = [], skipped = {};
  const skip = (k) => { skipped[k] = (skipped[k] || 0) + 1; };
  const emit = (crv, m, name, layer) => curves.push({ name, layer, crv: xfCrv(mul(flip, m), crv) });
  const num = (v, d = 0) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d; };
  const walk = (n, m, layer, depth) => {
    if (depth > 32) return;
    const M = n.attrs.transform ? mul(m, parseTransform(n.attrs.transform)) : m;
    const name = n.attrs.id || '';
    const t = n.tag;
    if (t === 'defs' || t === 'symbol' || t === 'clipPath' || t === 'mask' || t === 'marker' || t === 'pattern' || t === 'title' || t === 'desc' || t === 'metadata' || t === 'style') return;
    if (t === 'g' || t === 'svg' || t === 'a' || t === 'switch') {
      const L = t === 'g' && (n.attrs['inkscape:groupmode'] === 'layer' || n.attrs.id) ? (n.attrs['inkscape:label'] || n.attrs.id) : layer;
      for (const c of n.children) walk(c, M, L, depth + 1);
      return;
    }
    if (t === 'use') {
      const ref = (n.attrs.href || n.attrs['xlink:href'] || '').replace(/^#/, '');
      const target = defs.get(ref);
      if (!target) { skip('use'); return; }
      const T = mul(M, mat(1, 0, 0, 1, num(n.attrs.x), num(n.attrs.y)));
      if (target.tag === 'symbol') for (const c of target.children) walk(c, T, layer, depth + 1);
      else walk(target, T, layer, depth + 1);
      return;
    }
    if (t === 'path') { for (const sub of parsePathD(n.attrs.d)) emit(subpathCrv(sub), M, name, layer); return; }
    if (t === 'line') { emit(polyCrv([[num(n.attrs.x1), num(n.attrs.y1)], [num(n.attrs.x2), num(n.attrs.y2)]]), M, name, layer); return; }
    if (t === 'polyline' || t === 'polygon') {
      const v = (n.attrs.points || '').split(/[\s,]+/).filter(Boolean).map(Number);
      const pts = [];
      for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]]);
      if (pts.length >= 2) emit(polyCrv(pts, t === 'polygon'), M, name, layer);
      return;
    }
    if (t === 'rect') {
      const x = num(n.attrs.x), y = num(n.attrs.y), w = num(n.attrs.width), h = num(n.attrs.height);
      if (!(w > 0 && h > 0)) return;
      let rx = n.attrs.rx != null ? num(n.attrs.rx) : null, ry = n.attrs.ry != null ? num(n.attrs.ry) : null;
      if (rx == null) rx = ry ?? 0; if (ry == null) ry = rx;
      rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
      if (!(rx > 0 && ry > 0)) { emit(polyCrv([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true), M, name, layer); return; }
      const pieces = [];
      const L = (a, b) => pieces.push([a, lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), b]);
      L([x + rx, y], [x + w - rx, y]); pieces.push(...ellipseArcCubics(x + w - rx, y + ry, rx, ry, 0, -Math.PI / 2, Math.PI / 2));
      L([x + w, y + ry], [x + w, y + h - ry]); pieces.push(...ellipseArcCubics(x + w - rx, y + h - ry, rx, ry, 0, 0, Math.PI / 2));
      L([x + w - rx, y + h], [x + rx, y + h]); pieces.push(...ellipseArcCubics(x + rx, y + h - ry, rx, ry, 0, Math.PI / 2, Math.PI / 2));
      L([x, y + h - ry], [x, y + ry]); pieces.push(...ellipseArcCubics(x + rx, y + ry, rx, ry, 0, Math.PI, Math.PI / 2));
      emit(bezierChainCrv(pieces), M, name, layer);
      return;
    }
    if (t === 'circle' || t === 'ellipse') {
      const cx = num(n.attrs.cx), cy = num(n.attrs.cy);
      const rx = t === 'circle' ? num(n.attrs.r) : num(n.attrs.rx), ry = t === 'circle' ? rx : num(n.attrs.ry);
      if (rx > 0 && ry > 0) emit(arcCrv(cx, cy, rx, ry, 0, 0, 2 * Math.PI), M, name, layer);
      return;
    }
    if (t === 'text' || t === 'image' || t === 'foreignObject') { skip(t); return; }
    for (const c of n.children) walk(c, M, layer, depth + 1);
  };
  for (const c of svg.children) walk(c, root, '', 0);
  return { curves, skipped, note: `${ppi} px per inch${illustrator ? ' (Illustrator)' : ''}` };
}

// ── DXF ──
const INSUNITS_MM = { 1: 25.4, 2: 304.8, 3: 1609344, 4: 1, 5: 10, 6: 1000, 7: 1e6, 8: 25.4e-6, 9: 0.0254, 10: 914.4, 11: 1e-7, 12: 1e-6, 13: 1e-3, 14: 100, 15: 10000, 16: 100000 };

function dxfPairs(text) {
  const lines = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (!Number.isFinite(code)) throw new Error(`DXF: line ${i + 1} is not a group code`);
    pairs.push([code, lines[i + 1].replace(/\s+$/, '')]);
  }
  return pairs;
}

// Entities as { type, codes: [[code, value]…] } grouped from their 0-code start.
function dxfEntities(pairs, from, to) {
  const out = [];
  let cur = null;
  for (let i = from; i < to; i++) {
    const [c, v] = pairs[i];
    if (c === 0) { cur = { type: v, codes: [] }; out.push(cur); } else if (cur) cur.codes.push([c, v]);
  }
  return out;
}
const g = (e, code, d = null) => { const x = e.codes.find((p) => p[0] === code); return x ? x[1] : d; };
const gn = (e, code, d = 0) => { const v = g(e, code, null); const x = v == null ? NaN : parseFloat(v); return Number.isFinite(x) ? x : d; };
const gall = (e, code) => e.codes.filter((p) => p[0] === code).map((p) => parseFloat(p[1]));

// OCS to WCS (the DXF arbitrary-axis algorithm), for entities with an extrusion.
function ocsMatrix(nx, ny, nz) {
  const len = Math.hypot(nx, ny, nz) || 1;
  const N = [nx / len, ny / len, nz / len];
  const Ax = Math.abs(N[0]) < 1 / 64 && Math.abs(N[1]) < 1 / 64 ? [N[2], 0, -N[0]] : [-N[1], N[0], 0];
  const al = Math.hypot(...Ax); const X = Ax.map((v) => v / al);
  const Y = [N[1] * X[2] - N[2] * X[1], N[2] * X[0] - N[0] * X[2], N[0] * X[1] - N[1] * X[0]];
  return { X, Y, N };
}
const ocsApply = (o, [x, y, z = 0]) => [o.X[0] * x + o.Y[0] * y + o.N[0] * z, o.X[1] * x + o.Y[1] * y + o.N[1] * z, o.X[2] * x + o.Y[2] * y + o.N[2] * z];

// A bulge b between two vertices is an arc of included angle 4·atan(b).
function bulgeArc(a, b, bulge) {
  const theta = 4 * Math.atan(bulge);
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const h = r * Math.cos(Math.abs(theta) / 2);
  const dir = [(b[0] - a[0]) / chord, (b[1] - a[1]) / chord];
  const left = [-dir[1], dir[0]];
  const s = (theta > 0) === (Math.abs(theta) < Math.PI) ? 1 : -1;
  const c = [mid[0] + left[0] * h * s, mid[1] + left[1] * h * s];
  const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  return ellipseArcCubics(c[0], c[1], r, r, 0, a0, theta);
}

function polylineVertsCrv(verts, closed) {
  // verts: [{ x, y, bulge }]
  const n = verts.length;
  if (n < 2) return null;
  if (verts.every((v) => !v.bulge)) return polyCrv(verts.map((v) => [v.x, v.y]), closed);
  const pieces = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = verts[i], b = verts[(i + 1) % n];
    const A = [a.x, a.y], B = [b.x, b.y];
    if (Math.abs(a.bulge || 0) < 1e-12) pieces.push([A, lerp(A, B, 1 / 3), lerp(A, B, 2 / 3), B]);
    else pieces.push(...bulgeArc(A, B, a.bulge));
  }
  return bezierChainCrv(pieces);
}

export function parseDXF(text, { fallbackUnitMM = 1 } = {}) {
  if (/^AutoCAD Binary DXF/.test(text)) throw new Error('this DXF is binary; save it as ASCII DXF to open it here');
  const pairs = dxfPairs(text);
  const sections = {};
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 0 && pairs[i][1] === 'SECTION' && pairs[i + 1] && pairs[i + 1][0] === 2) {
      const name = pairs[i + 1][1];
      let j = i + 2;
      while (j < pairs.length && !(pairs[j][0] === 0 && pairs[j][1] === 'ENDSEC')) j++;
      sections[name] = [i + 2, j];
      i = j;
    }
  }
  let insunits = null;
  if (sections.HEADER) {
    for (let i = sections.HEADER[0]; i < sections.HEADER[1]; i++) if (pairs[i][0] === 9 && pairs[i][1] === '$INSUNITS') insunits = parseInt(pairs[i + 1][1], 10);
  }
  const unit = INSUNITS_MM[insunits] || fallbackUnitMM;
  const blocks = new Map();
  if (sections.BLOCKS) {
    let cur = null;
    for (const e of dxfEntities(pairs, ...sections.BLOCKS)) {
      if (e.type === 'BLOCK') { cur = { name: g(e, 2), base: [gn(e, 10), gn(e, 20)], ents: [] }; blocks.set(cur.name, cur); }
      else if (e.type === 'ENDBLK') cur = null;
      else if (cur) cur.ents.push(e);
    }
  }
  const curves = [], skipped = {};
  const skip = (k) => { skipped[k] = (skipped[k] || 0) + 1; };
  const S = mat(unit, 0, 0, unit, 0, 0);
  const emit = (crv, m, layer, name) => { if (crv) curves.push({ name: name || '', layer: layer || '0', crv: xfCrv(mul(S, m), crv) }); };
  const run = (ents, m, depth) => {
    for (let k = 0; k < ents.length; k++) {
      const e = ents[k];
      const layer = g(e, 8, '0');
      const ext = [gn(e, 210, 0), gn(e, 220, 0), gn(e, 230, 1)];
      const flat = Math.abs(ext[2] - 1) < 1e-12 && Math.abs(ext[0]) < 1e-12 && Math.abs(ext[1]) < 1e-12;
      const ocs = flat ? null : ocsMatrix(...ext);
      const W = (p) => (ocs ? ocsApply(ocs, p) : p);
      if (e.type === 'LINE') emit(polyCrv([[gn(e, 10), gn(e, 20)], [gn(e, 11), gn(e, 21)]]), m, layer);
      else if (e.type === 'LWPOLYLINE') {
        const xs = gall(e, 10), ys = gall(e, 20);
        // Bulge (42) belongs to the vertex before it.
        const verts = [];
        let vi = -1;
        for (const [c, v] of e.codes) {
          if (c === 10) { vi++; verts[vi] = { x: parseFloat(v), y: 0, bulge: 0 }; }
          else if (c === 20 && vi >= 0) verts[vi].y = parseFloat(v);
          else if (c === 42 && vi >= 0) verts[vi].bulge = parseFloat(v);
        }
        if (xs.length !== ys.length) { skip('LWPOLYLINE'); continue; }
        let crv = polylineVertsCrv(verts, (gn(e, 70) & 1) === 1);
        if (crv && ocs) crv = { ...crv, ctrlPts: crv.ctrlPts.map(([x, y, , w]) => { const q = W([x, y, gn(e, 38)]); return [q[0], q[1], 0, w]; }) };
        emit(crv, m, layer);
      } else if (e.type === 'POLYLINE') {
        const flags = gn(e, 70);
        const verts = [];
        while (ents[k + 1] && ents[k + 1].type === 'VERTEX') { k++; const v = ents[k]; if (gn(v, 70) & 16) continue; verts.push({ x: gn(v, 10), y: gn(v, 20), bulge: gn(v, 42) }); }
        if (ents[k + 1] && ents[k + 1].type === 'SEQEND') k++;
        if (flags & (16 | 64)) { skip('polygon mesh'); continue; }
        emit(polylineVertsCrv(verts, (flags & 1) === 1), m, layer);
      } else if (e.type === 'CIRCLE' || e.type === 'ARC') {
        const c = W([gn(e, 10), gn(e, 20), gn(e, 30)]), r = gn(e, 40);
        let a0 = 0, sweep = 2 * Math.PI;
        if (e.type === 'ARC') { a0 = gn(e, 50) * Math.PI / 180; let a1 = gn(e, 51) * Math.PI / 180; while (a1 <= a0) a1 += 2 * Math.PI; sweep = a1 - a0; }
        // A flipped extrusion (0,0,-1) mirrors X: angles run the other way.
        if (ocs && ocs.N[2] < 0) emit(arcCrv(c[0], c[1], r, r, 0, Math.PI - a0, -sweep), m, layer);
        else emit(arcCrv(c[0], c[1], r, r, 0, a0, sweep), m, layer);
      } else if (e.type === 'ELLIPSE') {
        const c = [gn(e, 10), gn(e, 20)], maj = [gn(e, 11), gn(e, 21)], ratio = gn(e, 40, 1);
        const t0 = gn(e, 41, 0); let t1 = gn(e, 42, 2 * Math.PI);
        while (t1 <= t0) t1 += 2 * Math.PI;
        const rx = Math.hypot(...maj);
        emit(arcCrv(c[0], c[1], rx, rx * ratio, Math.atan2(maj[1], maj[0]), t0, t1 - t0), m, layer);
      } else if (e.type === 'SPLINE') {
        const degree = gn(e, 71, 3);
        const knots = gall(e, 40), weights = gall(e, 41);
        const xs = gall(e, 10), ys = gall(e, 20);
        if (xs.length >= degree + 1 && knots.length === xs.length + degree + 1) {
          emit({ degree, knots, ctrlPts: xs.map((x, i) => [x, ys[i], 0, weights.length === xs.length ? weights[i] : 1]) }, m, layer);
        } else {
          const fx = gall(e, 11), fy = gall(e, 21);
          if (fx.length >= 2) emit(polyCrv(fx.map((x, i) => [x, fy[i]])), m, layer);
          else skip('SPLINE');
        }
      } else if (e.type === 'INSERT') {
        const b = blocks.get(g(e, 2));
        if (!b || depth > 16) { skip('INSERT'); continue; }
        const sx = gn(e, 41, 1), sy = gn(e, 42, 1), rot = gn(e, 50) * Math.PI / 180;
        const cols = Math.max(1, gn(e, 70, 1)), rows = Math.max(1, gn(e, 71, 1)), dc = gn(e, 44), dr = gn(e, 45);
        const p = W([gn(e, 10), gn(e, 20), gn(e, 30)]);
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const cr = Math.cos(rot), sr = Math.sin(rot);
          const off = [c * dc * cr - r * dr * sr, c * dc * sr + r * dr * cr];
          const T = mul(mul(mat(1, 0, 0, 1, p[0] + off[0], p[1] + off[1]), mat(cr * sx, sr * sx, -sr * sy, cr * sy, 0, 0)), mat(1, 0, 0, 1, -b.base[0], -b.base[1]));
          run(b.ents, mul(m, T), depth + 1);
        }
      } else if (['VERTEX', 'SEQEND', 'ATTRIB', 'ATTDEF'].includes(e.type)) continue;
      else skip(e.type);
    }
  };
  if (sections.ENTITIES) run(dxfEntities(pairs, ...sections.ENTITIES), IDENT, 0);
  return { curves, skipped, note: insunits && INSUNITS_MM[insunits] ? `$INSUNITS ${insunits}` : `no $INSUNITS; read as ${fallbackUnitMM === 1 ? 'mm' : `${fallbackUnitMM} mm per unit`}` };
}

// ── PDF / AI ──
// `inflate(bytes) → Promise<Uint8Array>` decodes FlateDecode streams; the app
// passes one built on DecompressionStream('deflate').
const latin1 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return s; };

function pdfTokens(s) {
  const toks = [];
  const re = /\s+|%[^\r\n]*|<<|>>|\[|\]|\{|\}|\((?:\\[\s\S]|[^\\)])*\)|<[0-9A-Fa-f\s]*>|\/[^\s/<>[\]{}()%]*|[-+]?(?:\d*\.\d+|\d+\.?)|[A-Za-z'"*]+[0-9A-Za-z*]*|./gy;
  let m;
  while ((m = re.exec(s))) { const t = m[0]; if (/^\s/.test(t) || t[0] === '%') continue; toks.push(t); if (re.lastIndex >= s.length) break; }
  return toks;
}

function readObj(toks, i) {
  const t = toks[i];
  if (t === '<<') {
    const d = {}; i++;
    while (toks[i] !== '>>' && i < toks.length) { const k = toks[i].slice(1); const r = readObj(toks, i + 1); d[k] = r.v; i = r.i; }
    return { v: d, i: i + 1 };
  }
  if (t === '[') { const a = []; i++; while (toks[i] !== ']' && i < toks.length) { const r = readObj(toks, i); a.push(r.v); i = r.i; } return { v: a, i: i + 1 }; }
  if (/^[-+]?[\d.]/.test(t)) {
    if (/^\d+$/.test(t) && /^\d+$/.test(toks[i + 1] || '') && toks[i + 2] === 'R') return { v: { ref: +t }, i: i + 3 };
    return { v: parseFloat(t), i: i + 1 };
  }
  return { v: t, i: i + 1 };
}

export async function parsePDF(bytes, { inflate } = {}) {
  const s = latin1(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  if (s.startsWith('%!PS-Adobe')) return parseAIPostScript(s);
  if (!s.startsWith('%PDF')) throw new Error('not a PDF-compatible file (Illustrator: save with "Create PDF Compatible File")');
  // Every "n g obj … endobj", read directly; object streams (PDF 1.5) are unpacked after.
  const objs = new Map(), streams = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const id = +m[1];
    const end = s.indexOf('endobj', re.lastIndex);
    if (end < 0) break;
    let body = s.slice(re.lastIndex, end);
    const st = body.search(/\bstream\r?\n/);
    let dict;
    if (st >= 0) {
      const head = body.slice(0, st);
      dict = readObj(pdfTokens(head), 0).v;
      const dataStart = re.lastIndex + st + body.slice(st).match(/^stream\r?\n/)[0].length;
      let len = typeof dict.Length === 'number' ? dict.Length : null;
      let dataEnd = len != null ? dataStart + len : s.indexOf('endstream', dataStart);
      if (len == null || s.slice(dataEnd, dataEnd + 20).indexOf('endstream') < 0) dataEnd = s.indexOf('endstream', dataStart);
      streams.set(id, { dict, raw: bytes.subarray ? bytes.subarray(dataStart, dataEnd) : new Uint8Array(bytes).subarray(dataStart, dataEnd) });
      objs.set(id, dict);
      re.lastIndex = Math.max(end, dataEnd);
    } else {
      dict = readObj(pdfTokens(body), 0).v;
      objs.set(id, dict);
      re.lastIndex = end;
    }
  }
  const decode = async (id) => {
    const st = streams.get(id);
    if (!st) return '';
    const filters = [].concat(st.dict.Filter || []);
    let data = st.raw;
    for (const f of filters) {
      if (f === '/FlateDecode') {
        if (!inflate) throw new Error('PDF: compressed content and no inflater');
        data = await inflate(data);
      } else throw new Error(`PDF: the ${String(f).slice(1)} filter is not read`);
    }
    return latin1(data);
  };
  for (const [id, st] of streams) {
    if (st.dict.Type !== '/ObjStm') continue;
    const text = await decode(id);
    const toks = pdfTokens(text);
    const n = st.dict.N, first = st.dict.First;
    const head = pdfTokens(text.slice(0, first));
    for (let k = 0; k < n; k++) {
      const oid = +head[2 * k], off = +head[2 * k + 1];
      objs.set(oid, readObj(pdfTokens(text.slice(first + off)), 0).v);
    }
    void toks;
  }
  const deref = (v) => (v && typeof v === 'object' && 'ref' in v ? objs.get(v.ref) : v);
  const refId = (v) => (v && typeof v === 'object' && 'ref' in v ? v.ref : null);
  const catalog = [...objs.values()].find((o) => o && o.Type === '/Catalog');
  if (!catalog) throw new Error('PDF: no catalog');
  const pages = [];
  (function collect(node, inherited) {
    node = deref(node);
    if (!node) return;
    const inh = { MediaBox: node.MediaBox || inherited.MediaBox, Resources: node.Resources || inherited.Resources };
    if (node.Type === '/Pages') for (const k of node.Kids || []) collect(k, inh);
    else if (node.Type === '/Page') pages.push({ node, ...inh });
  })(catalog.Pages, {});
  if (!pages.length) throw new Error('PDF: no pages');
  const page = pages[0];
  const box = (page.MediaBox || [0, 0, 612, 792]).map(Number);
  const K = 25.4 / 72;
  const curves = [], skipped = {};
  const skip = (k) => { skipped[k] = (skipped[k] || 0) + 1; };
  const placeholder = /This is an Adobe® Illustrator® File that was\s+saved without PDF Content/i;
  const runContent = async (text, ctm0, resources, depth) => {
    if (placeholder.test(text)) throw new Error('this Illustrator file was saved without PDF content; save it with "Create PDF Compatible File"');
    const toks = pdfTokens(text);
    const stack = [];
    let ctm = ctm0, operands = [], path = [], cur = null, startPt = null, sub = null;
    const P = (x, y) => xf(ctm, [x, y]);
    const flush = (paint) => {
      if (paint) {
        for (const sp of path) {
          if (!sp.segs.length) continue;
          const pieces = sp.segs;
          const allLine = pieces.every((c) => c.line);
          const pts = [pieces[0].p[0], ...pieces.map((c) => c.p[3])];
          const last = pts[pts.length - 1];
          const shut = Math.hypot(last[0] - pts[0][0], last[1] - pts[0][1]) < 1e-9;
          if (sp.closed && !shut) pieces.push({ line: true, p: [last, lerp(last, pts[0], 1 / 3), lerp(last, pts[0], 2 / 3), pts[0]] });
          const crv = allLine ? polyCrv(shut ? pts.slice(0, -1) : pts, sp.closed || shut) : bezierChainCrv(pieces.map((c) => c.p));
          curves.push({ name: '', layer: '0', crv: xfCrv(mat(K, 0, 0, K, -box[0] * K, -box[1] * K), crv) });
        }
      }
      path = []; sub = null; cur = null;
    };
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (/^[-+]?[\d.]/.test(t)) { operands.push(parseFloat(t)); continue; }
      if (t[0] === '/' || t[0] === '(' || t[0] === '<' || t === '[' || t === ']') {
        if (t === '[') { let d = 1; while (d > 0 && ++i < toks.length) { if (toks[i] === '[') d++; else if (toks[i] === ']') d--; } }
        else if (t === '<<') { const r = readObj(toks, i); i = r.i - 1; operands.push(r.v); continue; }
        operands.push(t);
        continue;
      }
      const o = operands; operands = [];
      switch (t) {
        case 'q': stack.push(ctm); break;
        case 'Q': ctm = stack.pop() || ctm0; break;
        case 'cm': ctm = mul(ctm, mat(...o.slice(-6))); break;
        case 'm': { const p = P(o[0], o[1]); sub = { segs: [], closed: false }; path.push(sub); cur = p; startPt = p; break; }
        case 'l': { if (!sub) break; const p = P(o[0], o[1]); sub.segs.push({ line: true, p: [cur, lerp(cur, p, 1 / 3), lerp(cur, p, 2 / 3), p] }); cur = p; break; }
        case 'c': { if (!sub) break; const a = P(o[0], o[1]), b = P(o[2], o[3]), p = P(o[4], o[5]); sub.segs.push({ p: [cur, a, b, p] }); cur = p; break; }
        case 'v': { if (!sub) break; const b = P(o[0], o[1]), p = P(o[2], o[3]); sub.segs.push({ p: [cur, cur, b, p] }); cur = p; break; }
        case 'y': { if (!sub) break; const a = P(o[0], o[1]), p = P(o[2], o[3]); sub.segs.push({ p: [cur, a, p, p] }); cur = p; break; }
        case 'h': if (sub && cur && startPt) { if (Math.hypot(cur[0] - startPt[0], cur[1] - startPt[1]) > 1e-9) sub.segs.push({ line: true, p: [cur, lerp(cur, startPt, 1 / 3), lerp(cur, startPt, 2 / 3), startPt] }); sub.closed = true; cur = startPt; } break;
        case 're': {
          const [x, y, w, h] = o;
          const c = [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)];
          sub = { segs: [], closed: true }; path.push(sub);
          for (let k = 0; k < 4; k++) { const a = c[k], b = c[(k + 1) % 4]; sub.segs.push({ line: true, p: [a, lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), b] }); }
          cur = startPt = c[0];
          break;
        }
        case 'S': case 's': case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*':
          if (t === 's' || t === 'b' || t === 'b*') for (const sp of path) sp.closed = true;
          flush(true); break;
        case 'n': flush(false); break;
        case 'W': case 'W*': break; // a clip: the path still ends in n or a paint
        case 'BT': { while (i < toks.length && toks[i] !== 'ET') i++; skip('text'); operands = []; break; }
        case 'BI': { while (i < toks.length && toks[i] !== 'EI') i++; skip('inline image'); break; }
        case 'Do': {
          const name = String(o[o.length - 1] || '').slice(1);
          const xo = resources && deref(deref(resources).XObject);
          const ref = xo && xo[name];
          const id = refId(ref), x = deref(ref);
          if (x && x.Subtype === '/Form' && depth < 12) {
            const M = x.Matrix ? mat(...x.Matrix) : IDENT;
            await runContent(await decode(id), mul(ctm, M), x.Resources || resources, depth + 1);
          } else if (x && x.Subtype === '/Image') skip('image');
          break;
        }
        default: break;
      }
    }
  };
  const contents = [].concat(page.node.Contents || []);
  let text = '';
  for (const c of contents) {
    const id = refId(c);
    const arr = deref(c);
    if (Array.isArray(arr)) { for (const cc of arr) text += (await decode(refId(cc))) + '\n'; }
    else text += (await decode(id)) + '\n';
  }
  await runContent(text, IDENT, page.Resources, 0);
  const creator = /Adobe Illustrator/.test(s) ? 'Illustrator' : null;
  return { curves, skipped, note: `page ${Math.round((box[2] - box[0]) * K * 10) / 10} × ${Math.round((box[3] - box[1]) * K * 10) / 10} mm${creator ? `, ${creator}` : ''}`, pageMM: [(box[2] - box[0]) * K, (box[3] - box[1]) * K] };
}

// Illustrator's PostScript dialect (AI3–AI8, and what Rhino writes): path
// operators in points from the page origin. m moveto; l L lineto; c C v V y Y
// curveto; a lowercase painter (s f b) closes, uppercase (S F B) leaves open,
// n N discard. Everything else (styles, layers, procsets) is passed over.
export function parseAIPostScript(text) {
  if (!/%%Creator:|%AI\d/.test(text)) throw new Error('a PostScript file, but not an Illustrator one');
  const at = text.indexOf('%%EndSetup');
  const body = (at >= 0 ? text.slice(at) : text).replace(/%[^\n]*/g, ' ');
  const toks = body.match(/\((?:\\.|[^\\)])*\)|\[[^\]]*\]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?|[A-Za-z_*]+/g) || [];
  const K = 25.4 / 72;
  const curves = [], skipped = {};
  let operands = [], sub = null, cur = null, start = null, path = [];
  const P = (x, y) => [x * K, y * K];
  const flush = (paint, close) => {
    if (paint) for (const sp of path) {
      if (!sp.segs.length) continue;
      if (close) sp.closed = true;
      const pts = [sp.segs[0].p[0], ...sp.segs.map((c) => c.p[3])];
      const last = pts[pts.length - 1];
      const shut = Math.hypot(last[0] - pts[0][0], last[1] - pts[0][1]) < 1e-9;
      if (sp.closed && !shut) sp.segs.push({ line: true, p: [last, lerp(last, pts[0], 1 / 3), lerp(last, pts[0], 2 / 3), pts[0]] });
      const all = [sp.segs[0].p[0], ...sp.segs.map((c) => c.p[3])];
      const allLine = sp.segs.every((c) => c.line);
      curves.push({ name: '', layer: '0', crv: allLine ? polyCrv(shut || sp.closed ? all.slice(0, -1) : all, sp.closed || shut) : bezierChainCrv(sp.segs.map((c) => c.p)) });
    }
    path = []; sub = null; cur = null;
  };
  for (const t of toks) {
    if (/^[-+]?[\d.]/.test(t)) { operands.push(parseFloat(t)); continue; }
    if (t[0] === '(' || t[0] === '[') { operands = []; continue; }
    const o = operands; operands = [];
    switch (t) {
      case 'm': { const p = P(o[o.length - 2], o[o.length - 1]); if (sub && cur && !sub.segs.length) path.pop(); sub = { segs: [], closed: false }; path.push(sub); cur = start = p; break; }
      case 'l': case 'L': { if (!sub) break; const p = P(o[o.length - 2], o[o.length - 1]); if (Math.hypot(p[0] - cur[0], p[1] - cur[1]) > 1e-12) sub.segs.push({ line: true, p: [cur, lerp(cur, p, 1 / 3), lerp(cur, p, 2 / 3), p] }); cur = p; break; }
      case 'c': case 'C': { if (!sub) break; const v = o.slice(-6); const a = P(v[0], v[1]), b = P(v[2], v[3]), p = P(v[4], v[5]); sub.segs.push({ p: [cur, a, b, p] }); cur = p; break; }
      case 'v': case 'V': { if (!sub) break; const v = o.slice(-4); const b = P(v[0], v[1]), p = P(v[2], v[3]); sub.segs.push({ p: [cur, cur, b, p] }); cur = p; break; }
      case 'y': case 'Y': { if (!sub) break; const v = o.slice(-4); const a = P(v[0], v[1]), p = P(v[2], v[3]); sub.segs.push({ p: [cur, a, p, p] }); cur = p; break; }
      case 'h': case 'H': if (sub) sub.closed = true; break;
      case 's': case 'f': case 'b': flush(true, true); break;
      case 'S': case 'F': case 'B': flush(true, false); break;
      case 'n': case 'N': flush(false, false); break;
      default: break;
    }
  }
  void start; void skipped;
  const bb = text.match(/%%HiResBoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/) || text.match(/%%BoundingBox:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/);
  const pageMM = bb ? [(+bb[3] - +bb[1]) * K, (+bb[4] - +bb[2]) * K] : null;
  return { curves, skipped: {}, note: `Illustrator PostScript${pageMM ? `, ${Math.round(pageMM[0] * 10) / 10} × ${Math.round(pageMM[1] * 10) / 10} mm` : ''}`, pageMM };
}
