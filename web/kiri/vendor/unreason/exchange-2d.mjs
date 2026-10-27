// Vendored unchanged from Unreason (unreason3d-web/app/exchange-2d.mjs, commit 0bcd8b70, 10-27) for swarf's 2D import/export.
// 2D EXCHANGE — curves out to SVG, DXF and PDF/AI at true size. No DOM, no three.js.
//
// Input: shapes { name, layer, crv, hint? } where crv is a NURBS curve in model
// space ({ degree, knots, ctrlPts: [[x, y, z, w]…] }, weights not pre-multiplied)
// and the model unit is the millimetre. A view drops one axis: a parallel
// projection is affine, so projecting the control points and keeping the weights
// is exact for every curve, rational ones included.
//
// Sizes: SVG width/height carry "mm" (or "in") over a viewBox in millimetres;
// PDF draws in millimetres under one `cm` of 72/25.4 so the MediaBox is the
// drawing's size in points; DXF says $INSUNITS 4 (millimetres).

export const MM_PER_IN = 25.4;
export const PT_PER_MM = 72 / MM_PER_IN;

export const VIEWS = {
  top: { label: 'Top', axes: [0, 1], drop: 2 },
  front: { label: 'Front', axes: [0, 2], drop: 1 },
  right: { label: 'Right', axes: [1, 2], drop: 0 },
};

export function projectCrv(crv, view = 'top') {
  const v = VIEWS[view] || VIEWS.top;
  return {
    degree: crv.degree,
    knots: crv.knots.slice(),
    ctrlPts: crv.ctrlPts.map((p) => [p[v.axes[0]], p[v.axes[1]], p.length > 3 ? p[3] : 1]),
  };
}

// ── Bézier spans (Boehm insertion in homogeneous space) ──
const homog = (P) => P.map(([x, y, w]) => [x * w, y * w, w]);

function insertKnot(p, U, Pw, u) {
  let k = p;
  while (k < U.length - p - 2 && U[k + 1] <= u) k++;
  const Q = [];
  for (let i = 0; i <= k - p; i++) Q.push(Pw[i]);
  for (let i = k - p + 1; i <= k; i++) {
    const den = U[i + p] - U[i];
    const a = den > 0 ? (u - U[i]) / den : 0;
    Q.push([0, 1, 2].map((c) => (1 - a) * Pw[i - 1][c] + a * Pw[i][c]));
  }
  for (let i = k; i < Pw.length; i++) Q.push(Pw[i]);
  const V = U.slice(0, k + 1).concat([u], U.slice(k + 1));
  return { U: V, Pw: Q };
}

// Returns the curve's Bézier spans over [U[p], U[n+1]], each degree+1
// homogeneous points [xw, yw, w]. Every interior knot is raised to multiplicity
// p, and an unclamped end to p, so consecutive spans share an end point.
export function bezierSpans(crv2) {
  const p = crv2.degree;
  let U = crv2.knots.slice(), Pw = homog(crv2.ctrlPts);
  const lo = U[p], hi = U[U.length - p - 1];
  const mult = (u) => U.filter((x) => x === u).length;
  for (const u of [...new Set(U.filter((x) => x >= lo && x <= hi))]) {
    while (mult(u) < p) ({ U, Pw } = insertKnot(p, U, Pw, u));
  }
  const distinct = [...new Set(U.filter((x) => x >= lo && x <= hi))];
  let start = U.indexOf(lo) + mult(lo) - p - 1;
  const spans = [];
  for (let s = 0; s < distinct.length - 1; s++, start += p) {
    if (start < 0 || start + p >= Pw.length) break;
    spans.push(Pw.slice(start, start + p + 1));
  }
  return spans;
}

const deCasteljau = (H, t) => {
  let a = H.map((x) => x.slice());
  const left = [a[0].slice()], right = [a[a.length - 1].slice()];
  while (a.length > 1) {
    const b = [];
    for (let i = 0; i < a.length - 1; i++) b.push([0, 1, 2].map((c) => (1 - t) * a[i][c] + t * a[i + 1][c]));
    a = b;
    left.push(a[0].slice()); right.unshift(a[a.length - 1].slice());
  }
  return { point: a[0], left, right };
};
const proj = (h) => [h[0] / h[2], h[1] / h[2]];

// One rational Bézier span to cubics: exact when it is polynomial of degree
// ≤ 3, otherwise Hermite cubics on halves until every sample sits within tol.
export function spanToCubics(H, tol = 1e-3, depth = 0) {
  const p = H.length - 1;
  const rational = H.some((h) => Math.abs(h[2] - H[0][2]) > 1e-12);
  if (!rational && p <= 3) {
    const P = H.map(proj);
    if (p === 1) return [[P[0], lerp(P[0], P[1], 1 / 3), lerp(P[0], P[1], 2 / 3), P[1]]];
    if (p === 2) return [[P[0], lerp(P[0], P[1], 2 / 3), lerp(P[2], P[1], 2 / 3), P[2]]];
    return [P];
  }
  const P0 = proj(H[0]), P1 = proj(H[p]);
  const d0 = scale2(sub2(proj(H[1]), P0), p * H[1][2] / H[0][2]);
  const d1 = scale2(sub2(P1, proj(H[p - 1])), p * H[p - 1][2] / H[p][2]);
  const cubic = [P0, add2(P0, scale2(d0, 1 / 3)), sub2(P1, scale2(d1, 1 / 3)), P1];
  let err = 0;
  for (let i = 1; i < 8; i++) {
    const t = i / 8;
    const c = proj(deCasteljau(H, t).point), q = cubicAt(cubic, t);
    err = Math.max(err, Math.hypot(c[0] - q[0], c[1] - q[1]));
  }
  if (err <= tol || depth >= 14) return [cubic];
  const { left, right } = deCasteljau(H, 0.5);
  return spanToCubics(left, tol, depth + 1).concat(spanToCubics(right, tol, depth + 1));
}

export function crvToCubics(crv2, tol = 1e-3) {
  const out = [];
  for (const H of bezierSpans(crv2)) out.push(...spanToCubics(H, tol));
  return out;
}

function lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
function sub2(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
function add2(a, b) { return [a[0] + b[0], a[1] + b[1]]; }
function scale2(a, s) { return [a[0] * s, a[1] * s]; }
export function cubicAt(C, t) {
  const m = 1 - t;
  return [0, 1].map((k) => m * m * m * C[0][k] + 3 * m * m * t * C[1][k] + 3 * m * t * t * C[2][k] + t * t * t * C[3][k]);
}

// Tight bounds of a cubic: its ends and the roots of its derivative.
function cubicBounds(C, box) {
  const take = (q) => { box[0] = Math.min(box[0], q[0]); box[1] = Math.min(box[1], q[1]); box[2] = Math.max(box[2], q[0]); box[3] = Math.max(box[3], q[1]); };
  take(C[0]); take(C[3]);
  for (let k = 0; k < 2; k++) {
    const a = -C[0][k] + 3 * C[1][k] - 3 * C[2][k] + C[3][k];
    const b = 2 * (C[0][k] - 2 * C[1][k] + C[2][k]);
    const c = C[1][k] - C[0][k];
    const roots = [];
    if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) roots.push(-c / b); }
    else { const disc = b * b - 4 * a * c; if (disc >= 0) { const r = Math.sqrt(disc); roots.push((-b + r) / (2 * a), (-b - r) / (2 * a)); } }
    for (const t of roots) if (t > 0 && t < 1) take(cubicAt(C, t));
  }
}

// ── Shapes: each curve once, in the form every writer reads ──
// A degree-1 curve is a polyline; a full circle facing the view (hint) stays a
// circle; everything else is its cubics and, for DXF, its exact NURBS.
export function buildShapes(input, { view = 'top', tol = 1e-3 } = {}) {
  const shapes = [];
  let skipped = 0;
  for (const s of input) {
    if (!s || !s.crv || !Array.isArray(s.crv.ctrlPts) || s.crv.ctrlPts.length < 2) { skipped++; continue; }
    const crv2 = projectCrv(s.crv, view);
    const pts = crv2.ctrlPts;
    const first = pts[0], last = pts[pts.length - 1];
    const closed = Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-9;
    let shape = { name: s.name || '', layer: s.layer || '0', closed, crv2 };
    const c = s.hint && s.hint.kind === 'circle' ? s.hint : null;
    const v = VIEWS[view] || VIEWS.top;
    if (c && Math.abs(Math.abs(c.normal[v.drop]) - 1) < 1e-9) {
      shape.circle = { cx: c.center[v.axes[0]], cy: c.center[v.axes[1]], r: c.radius };
    } else if (crv2.degree === 1) {
      shape.polyline = pts.map(([x, y]) => [x, y]);
      if (closed) shape.polyline.pop();
    }
    shape.cubics = shape.circle ? circleCubics(shape.circle, tol) : crvToCubics(crv2, tol);
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const C of shape.cubics) cubicBounds(C, box);
    if (!(box[2] - box[0] > 1e-12 || box[3] - box[1] > 1e-12)) { skipped++; continue; } // edge-on to the view
    shape.box = box;
    shapes.push(shape);
  }
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const sh of shapes) { box[0] = Math.min(box[0], sh.box[0]); box[1] = Math.min(box[1], sh.box[1]); box[2] = Math.max(box[2], sh.box[2]); box[3] = Math.max(box[3], sh.box[3]); }
  return { shapes, skipped, box: shapes.length ? box : [0, 0, 0, 0] };
}

// A circle as n equal cubic arcs, k = 4/3·tan(θ/4). The radial error is about
// 4.2e-6·r at 45° and falls as θ⁶, so n doubles from eight until it is within tol.
export function circleCubics({ cx, cy, r }, tol = 1e-3) {
  let n = 8;
  while (r * 4.2e-6 * Math.pow(8 / n, 6) > tol && n < 1024) n *= 2;
  const th = (2 * Math.PI) / n, k = (4 / 3) * Math.tan(th / 4) * r;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = i * th, b = a + th;
    const A = [cx + r * Math.cos(a), cy + r * Math.sin(a)], B = [cx + r * Math.cos(b), cy + r * Math.sin(b)];
    out.push([A, [A[0] - k * Math.sin(a), A[1] + k * Math.cos(a)], [B[0] + k * Math.sin(b), B[1] - k * Math.cos(b)], B]);
  }
  return out;
}

const num = (v) => {
  const s = (Math.abs(v) < 5e-7 ? 0 : v).toFixed(6).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};

// ── SVG ──
export function writeSVG(built, { units = 'mm', margin = 0, stroke = 0.25, title = 'Unreason3D' } = {}) {
  const [x0, y0, x1, y1] = built.box;
  const minX = x0 - margin, maxY = y1 + margin;
  const W = Math.max(1e-6, x1 - x0 + 2 * margin), H = Math.max(1e-6, y1 - y0 + 2 * margin);
  const size = (mm) => (units === 'in' ? `${num(mm / MM_PER_IN)}in` : `${num(mm)}mm`);
  const layers = new Map();
  for (const sh of built.shapes) { if (!layers.has(sh.layer)) layers.set(sh.layer, []); layers.get(sh.layer).push(sh); }
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const Y = (y) => num(-y);
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${size(W)}" height="${size(H)}" viewBox="${num(minX)} ${num(-maxY)} ${num(W)} ${num(H)}">`);
  lines.push(`<title>${esc(title)}</title>`);
  for (const [layer, list] of layers) {
    lines.push(`<g id="${esc(layer)}" fill="none" stroke="#000" stroke-width="${num(stroke)}">`);
    for (const sh of list) {
      const id = sh.name ? ` id="${esc(sh.name)}"` : '';
      if (sh.circle) { lines.push(`<circle${id} cx="${num(sh.circle.cx)}" cy="${Y(sh.circle.cy)}" r="${num(sh.circle.r)}"/>`); continue; }
      let d;
      if (sh.polyline) d = `M${sh.polyline.map(([x, y]) => `${num(x)},${Y(y)}`).join(' L')}${sh.closed ? ' Z' : ''}`;
      else {
        d = `M${num(sh.cubics[0][0][0])},${Y(sh.cubics[0][0][1])}`;
        for (const C of sh.cubics) d += ` C${num(C[1][0])},${Y(C[1][1])} ${num(C[2][0])},${Y(C[2][1])} ${num(C[3][0])},${Y(C[3][1])}`;
        if (sh.closed) d += ' Z';
      }
      lines.push(`<path${id} d="${d}"/>`);
    }
    lines.push('</g>');
  }
  lines.push('</svg>');
  return lines.join('\n') + '\n';
}

// ── PDF (and .ai: Illustrator opens a PDF and keeps its artboard at the
// MediaBox). Every box equals the MediaBox, so no reader picks a different
// crop. Above 14,400 pt (Acrobat's page limit, 5080 mm) the page is too big.
export const PDF_MAX_PT = 14400;
export function writePDF(built, { margin = 0, stroke = 0.25, title = 'Unreason3D', producer = 'Unreason3D' } = {}) {
  const [x0, y0, x1, y1] = built.box;
  const W = Math.max(1e-6, x1 - x0 + 2 * margin), H = Math.max(1e-6, y1 - y0 + 2 * margin);
  const wPt = W * PT_PER_MM, hPt = H * PT_PER_MM;
  if (wPt > PDF_MAX_PT || hPt > PDF_MAX_PT) throw new Error(`the drawing is ${Math.round(W)} × ${Math.round(H)} mm; a PDF page stops at 5080 mm`);
  const k = PT_PER_MM;
  const kk = k.toFixed(12);
  const ops = [`${kk} 0 0 ${kk} ${((margin - x0) * k).toFixed(9)} ${((margin - y0) * k).toFixed(9)} cm`, `${num(stroke)} w`, '1 J 1 j', '0 0 0 RG'];
  for (const sh of built.shapes) {
    if (sh.polyline) {
      ops.push(`${num(sh.polyline[0][0])} ${num(sh.polyline[0][1])} m`);
      for (const q of sh.polyline.slice(1)) ops.push(`${num(q[0])} ${num(q[1])} l`);
    } else {
      ops.push(`${num(sh.cubics[0][0][0])} ${num(sh.cubics[0][0][1])} m`);
      for (const C of sh.cubics) ops.push(`${num(C[1][0])} ${num(C[1][1])} ${num(C[2][0])} ${num(C[2][1])} ${num(C[3][0])} ${num(C[3][1])} c`);
    }
    ops.push(sh.closed ? 's' : 'S');
  }
  const content = ops.join('\n') + '\n';
  const box = `[0 0 ${num(wPt)} ${num(hPt)}]`;
  const ascii = (t) => String(t).replace(/[^\x20-\x7e]/g, '?').replace(/([()\\])/g, '\\$1');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox ${box} /CropBox ${box} /TrimBox ${box} /ArtBox ${box} /BleedBox ${box} /Resources << >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    `<< /Title (${ascii(title)}) /Producer (${ascii(producer)}) >>`,
  ];
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'.replace(/[^\x00-\x7f]/g, 'x');
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

// ── DXF (R2000, AC1015): the first version carrying LWPOLYLINE, weighted
// SPLINE and $INSUNITS. Handles are hex and unique; owners point at
// *Model_Space's block record. Illustrator refuses an R2000 file without the
// layout objects each block record names (340), the plot-style placeholder
// each layer names (390), a full *Active viewport and a Standard dimstyle. ──
export function writeDXF(built, { units = 'mm' } = {}) {
  const out = [];
  const put = (code, value) => { out.push(String(code), String(value)); };
  const tags = (list) => { for (let i = 0; i < list.length; i += 2) put(list[i], list[i + 1]); };
  let handle = 0x20;
  const H = () => (handle++).toString(16).toUpperCase();
  const insunits = units === 'in' ? 1 : 4;
  const k = units === 'in' ? 1 / MM_PER_IN : 1;
  // Ten decimals: an inch file keeps the millimetre's sixth decimal.
  const n = (v) => { const t = (Math.abs(v * k) < 5e-11 ? 0 : v * k).toFixed(10).replace(/\.?0+$/, ''); return t === '-0' ? '0' : t; };
  const [x0, y0, x1, y1] = built.box;
  const layerName = (l) => String(l).replace(/[<>/\\":;?*|=`]/g, '_').slice(0, 255) || '0';
  const layers = [...new Set(built.shapes.map((s) => layerName(s.layer || '0')))].filter((l) => l !== '0');
  const h = {};
  for (const key of ['tVport', 'tLtype', 'tLayer', 'tStyle', 'tView', 'tUcs', 'tAppid', 'tDim', 'tBr', 'ms', 'ps', 'layoutM', 'layoutP', 'root', 'dGroup', 'dLayout', 'dMline', 'dPlot', 'placeholder', 'mline']) h[key] = H();
  // HEADER
  put(0, 'SECTION'); put(2, 'HEADER');
  put(9, '$ACADVER'); put(1, 'AC1015');
  put(9, '$ACADMAINTVER'); put(70, 6);
  put(9, '$DWGCODEPAGE'); put(3, 'ANSI_1252');
  put(9, '$INSBASE'); put(10, 0); put(20, 0); put(30, 0);
  put(9, '$EXTMIN'); put(10, n(x0)); put(20, n(y0)); put(30, 0);
  put(9, '$EXTMAX'); put(10, n(x1)); put(20, n(y1)); put(30, 0);
  put(9, '$LIMMIN'); put(10, n(x0)); put(20, n(y0));
  put(9, '$LIMMAX'); put(10, n(x1)); put(20, n(y1));
  put(9, '$HANDSEED'); put(5, 'FFFFF');
  put(9, '$MEASUREMENT'); put(70, units === 'in' ? 0 : 1);
  put(9, '$INSUNITS'); put(70, insunits);
  put(0, 'ENDSEC');
  put(0, 'SECTION'); put(2, 'CLASSES'); put(0, 'ENDSEC');
  // TABLES
  put(0, 'SECTION'); put(2, 'TABLES');
  const table = (name, th, entries, extra) => {
    put(0, 'TABLE'); put(2, name); put(5, th); put(330, 0); put(100, 'AcDbSymbolTable'); put(70, entries.length);
    if (extra) tags(extra);
    for (const e of entries) e(th);
    put(0, 'ENDTAB');
  };
  const record = (type, o, sub, name) => { put(0, type); put(type === 'DIMSTYLE' ? 105 : 5, H()); put(330, o); put(100, 'AcDbSymbolTableRecord'); put(100, sub); put(2, name); };
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  table('VPORT', h.tVport, [(o) => {
    record('VPORT', o, 'AcDbViewportTableRecord', '*Active');
    tags([70, 0, 10, 0, 20, 0, 11, 1, 21, 1, 12, n(cx), 22, n(cy), 13, 0, 23, 0, 14, 0.5, 24, 0.5, 15, 0.5, 25, 0.5, 16, 0, 26, 0, 36, 1, 17, 0, 27, 0, 37, 0,
      40, n(Math.max(1, y1 - y0) * 1.1), 41, 1.34, 42, 50, 43, 0, 44, 0, 50, 0, 51, 0, 71, 0, 72, 1000, 73, 1, 74, 3, 75, 0, 76, 0, 77, 0, 78, 0, 281, 0, 65, 0, 146, 0]);
  }]);
  const ltype = (name, desc) => (o) => { record('LTYPE', o, 'AcDbLinetypeTableRecord', name); tags([70, 0, 3, desc, 72, 65, 73, 0, 40, 0]); };
  table('LTYPE', h.tLtype, [ltype('ByBlock', ''), ltype('ByLayer', ''), ltype('Continuous', 'Solid line')]);
  const layer = (name) => (o) => { record('LAYER', o, 'AcDbLayerTableRecord', name); tags([70, 0, 62, 7, 6, 'Continuous', 370, -3, 390, h.placeholder]); };
  table('LAYER', h.tLayer, ['0', ...layers].map(layer));
  table('STYLE', h.tStyle, [(o) => { record('STYLE', o, 'AcDbTextStyleTableRecord', 'Standard'); tags([70, 0, 40, 0, 41, 1, 50, 0, 71, 0, 42, 2.5, 3, 'txt', 4, '']); }]);
  table('VIEW', h.tView, []);
  table('UCS', h.tUcs, []);
  table('APPID', h.tAppid, [(o) => { record('APPID', o, 'AcDbRegAppTableRecord', 'ACAD'); put(70, 0); }]);
  table('DIMSTYLE', h.tDim, [(o) => {
    record('DIMSTYLE', o, 'AcDbDimStyleTableRecord', 'Standard');
    tags([70, 0, 3, '', 4, '', 40, 1, 41, 2.5, 42, 0.625, 43, 3.75, 44, 1.25, 45, 0, 46, 0, 47, 0, 48, 0, 140, 2.5, 141, 2.5, 142, 0, 143, 0.03937007874, 144, 1, 145, 0, 146, 1, 147, 0.625, 148, 0,
      71, 0, 72, 0, 73, 0, 74, 0, 75, 0, 76, 0, 77, 1, 78, 8, 79, 3, 170, 0, 171, 3, 172, 1, 173, 0, 174, 0, 175, 0, 176, 0, 177, 0, 178, 0, 179, 2,
      271, 2, 272, 2, 273, 2, 274, 3, 275, 0, 276, 0, 277, 2, 278, 44, 279, 0, 280, 0, 281, 0, 282, 0, 283, 0, 284, 8, 285, 0, 286, 0, 288, 0, 289, 3, 371, -2, 372, -2]);
  }], [100, 'AcDbDimStyleTable']);
  const blockRecord = (name, self, layout) => (o) => { put(0, 'BLOCK_RECORD'); put(5, self); put(330, o); put(100, 'AcDbSymbolTableRecord'); put(100, 'AcDbBlockTableRecord'); put(2, name); put(340, layout); };
  table('BLOCK_RECORD', h.tBr, [blockRecord('*Model_Space', h.ms, h.layoutM), blockRecord('*Paper_Space', h.ps, h.layoutP)]);
  put(0, 'ENDSEC');
  // BLOCKS
  put(0, 'SECTION'); put(2, 'BLOCKS');
  for (const [name, rec] of [['*Model_Space', h.ms], ['*Paper_Space', h.ps]]) {
    put(0, 'BLOCK'); put(5, H()); put(330, rec); put(100, 'AcDbEntity'); put(8, '0'); put(100, 'AcDbBlockBegin'); put(2, name); put(70, 0); put(10, 0); put(20, 0); put(30, 0); put(3, name); put(1, '');
    put(0, 'ENDBLK'); put(5, H()); put(330, rec); put(100, 'AcDbEntity'); put(8, '0'); put(100, 'AcDbBlockEnd');
  }
  put(0, 'ENDSEC');
  // ENTITIES
  put(0, 'SECTION'); put(2, 'ENTITIES');
  const head = (type, sh, sub) => { put(0, type); put(5, H()); put(330, h.ms); put(100, 'AcDbEntity'); put(8, layerName(sh.layer || '0')); put(100, sub); };
  for (const sh of built.shapes) {
    if (sh.circle) {
      head('CIRCLE', sh, 'AcDbCircle'); put(10, n(sh.circle.cx)); put(20, n(sh.circle.cy)); put(30, 0); put(40, n(sh.circle.r));
    } else if (sh.polyline && sh.polyline.length === 2 && !sh.closed) {
      head('LINE', sh, 'AcDbLine'); const [a, b] = sh.polyline;
      put(10, n(a[0])); put(20, n(a[1])); put(30, 0); put(11, n(b[0])); put(21, n(b[1])); put(31, 0);
    } else if (sh.polyline) {
      head('LWPOLYLINE', sh, 'AcDbPolyline'); put(90, sh.polyline.length); put(70, sh.closed ? 1 : 0); put(43, 0);
      for (const [x, y] of sh.polyline) { put(10, n(x)); put(20, n(y)); }
    } else {
      const c = sh.crv2;
      const rational = c.ctrlPts.some((q) => Math.abs(q[2] - c.ctrlPts[0][2]) > 1e-12);
      head('SPLINE', sh, 'AcDbSpline');
      put(210, 0); put(220, 0); put(230, 1);
      put(70, 8 | (rational ? 4 : 0) | (sh.closed ? 1 : 0)); put(71, c.degree); put(72, c.knots.length); put(73, c.ctrlPts.length); put(74, 0);
      put(42, '0.0000001'); put(43, '0.0000001');
      // Knots and weights at full precision: a weight rounded to six places
      // moves a circle's radius by about 1e-6 of itself.
      for (const u of c.knots) put(40, String(u));
      if (rational) for (const q of c.ctrlPts) put(41, String(q[2]));
      for (const q of c.ctrlPts) { put(10, n(q[0])); put(20, n(q[1])); put(30, 0); }
    }
  }
  put(0, 'ENDSEC');
  // OBJECTS
  put(0, 'SECTION'); put(2, 'OBJECTS');
  const dict = (self, owner, entries) => { put(0, 'DICTIONARY'); put(5, self); put(330, owner); put(100, 'AcDbDictionary'); put(281, 1); for (const [name, ref] of entries) { put(3, name); put(350, ref); } };
  dict(h.root, 0, [['ACAD_GROUP', h.dGroup], ['ACAD_LAYOUT', h.dLayout], ['ACAD_MLINESTYLE', h.dMline], ['ACAD_PLOTSTYLENAME', h.dPlot]]);
  dict(h.dGroup, h.root, []);
  dict(h.dLayout, h.root, [['Model', h.layoutM], ['Layout1', h.layoutP]]);
  dict(h.dMline, h.root, [['Standard', h.mline]]);
  tags([0, 'ACDBDICTIONARYWDFLT', 5, h.dPlot, 330, h.root, 100, 'AcDbDictionary', 281, 1, 3, 'Normal', 350, h.placeholder, 100, 'AcDbDictionaryWithDefault', 340, h.placeholder]);
  tags([0, 'ACDBPLACEHOLDER', 5, h.placeholder, 330, h.dPlot]);
  for (const [self, name, owner, flags, tab] of [[h.layoutM, 'Model', h.ms, 1024, 0], [h.layoutP, 'Layout1', h.ps, 0, 1]]) {
    tags([0, 'LAYOUT', 5, self, 330, h.dLayout, 100, 'AcDbPlotSettings', 1, '', 4, 'A3', 6, '', 40, 7.5, 41, 20, 42, 7.5, 43, 20, 44, 420, 45, 297, 46, 0, 47, 0, 48, 0, 49, 0,
      140, 0, 141, 0, 142, 1, 143, 1, 70, flags, 72, 1, 73, 0, 74, 5, 7, '', 75, 16, 76, 0, 77, 2, 78, 300, 147, 1, 148, 0, 149, 0,
      100, 'AcDbLayout', 1, name, 70, 1, 71, tab, 10, 0, 20, 0, 11, 420, 21, 297, 12, 0, 22, 0, 32, 0, 14, 1e20, 24, 1e20, 34, 1e20, 15, -1e20, 25, -1e20, 35, -1e20,
      146, 0, 13, 0, 23, 0, 33, 0, 16, 1, 26, 0, 36, 0, 17, 0, 27, 1, 37, 0, 76, 1, 330, owner]);
  }
  tags([0, 'MLINESTYLE', 5, h.mline, 330, h.dMline, 100, 'AcDbMlineStyle', 2, 'Standard', 70, 0, 3, '', 62, 256, 51, 90, 52, 90, 71, 2, 49, 0.5, 62, 256, 6, 'BYLAYER', 49, -0.5, 62, 256, 6, 'BYLAYER']);
  put(0, 'ENDSEC');
  put(0, 'EOF');
  // $HANDSEED must exceed every handle used.
  out[out.indexOf('$HANDSEED') + 2] = (handle + 1).toString(16).toUpperCase();
  return out.join('\r\n') + '\r\n';
}

// ── AI (Illustrator 3 PostScript, the dialect Rhino writes and reads) ──
// Coordinates are points measured from the drawing's corner, and the
// bounding box and art size are the drawing's true size in points, so Rhino
// and Illustrator both open it at 1 : 1. A closed path ends in `s`, an open
// one in `S`. Illustrator takes a file as its own only when it names the
// Illustrator procsets; without them it reads it as foreign PostScript and fails.
const PROCSETS = ['Adobe_packedarray 2.0 0', 'Adobe_cmykcolor 1.1 0', 'Adobe_cshow 1.1 0', 'Adobe_customcolor 1.0 0', 'Adobe_typography_AI3 1.0 0', 'Adobe_IllustratorA_AI3 1.0 0'];
export function writeAI(built, { margin = 0, stroke = 0.25, title = 'Unreason3D' } = {}) {
  const [x0, y0, x1, y1] = built.box;
  const W = Math.max(1e-6, x1 - x0 + 2 * margin), H = Math.max(1e-6, y1 - y0 + 2 * margin);
  const k = PT_PER_MM;
  const X = (x) => ((x - x0 + margin) * k).toFixed(6).replace(/\.?0+$/, '') || '0';
  const Y = (y) => ((y - y0 + margin) * k).toFixed(6).replace(/\.?0+$/, '') || '0';
  const wPt = W * k, hPt = H * k;
  const ascii = (t) => String(t).replace(/[^\x20-\x7e]/g, '?').replace(/([()\\])/g, '\\$1');
  const out = [
    '%!PS-Adobe-3.0',
    '%%Creator: Unreason3D',
    `%%Title: (${ascii(title)})`,
    `%%BoundingBox: 0 0 ${Math.ceil(wPt)} ${Math.ceil(hPt)}`,
    `%%HiResBoundingBox: 0 0 ${wPt.toFixed(6)} ${hPt.toFixed(6)}`,
    `%AI5_ArtSize: ${wPt.toFixed(6)} ${hPt.toFixed(6)}`,
    '%AI3_ColorUsage: Black&White',
    `%AI3_TemplateBox: ${(wPt / 2).toFixed(3)} ${(hPt / 2).toFixed(3)} ${(wPt / 2).toFixed(3)} ${(hPt / 2).toFixed(3)}`,
    `%AI3_TileBox: 0 0 ${wPt.toFixed(6)} ${hPt.toFixed(6)}`,
    '%AI3_DocumentPreview: None',
    `%%DocumentNeededResources: procset ${PROCSETS[0]}`,
    ...PROCSETS.slice(1).map((r) => `%%+ procset ${r}`),
    '%%EndComments',
    '%%BeginProlog',
    ...PROCSETS.map((r) => `%%IncludeResource: procset ${r}`),
    'Adobe_packedarray /initialize get exec',
    '%%EndProlog',
    '%%BeginSetup',
    ...PROCSETS.slice(1).map((r) => `${r.split(' ')[0]} /initialize get exec`),
    '%%EndSetup',
  ];
  const layers = new Map();
  for (const sh of built.shapes) { if (!layers.has(sh.layer)) layers.set(sh.layer, []); layers.get(sh.layer).push(sh); }
  for (const [layer, list] of layers) {
    out.push('%AI5_BeginLayer', '1 1 1 1 0 0 -1 0 0 0 Lb', `(${ascii(layer || 'Default')}) Ln`, '0 A', '0 R', '0 G', `0 i 1 J 1 j ${(stroke * k).toFixed(4)} w 4 M []0 d`, '0 D');
    for (const sh of list) {
      if (sh.polyline) {
        out.push(`${X(sh.polyline[0][0])} ${Y(sh.polyline[0][1])} m`);
        for (const q of sh.polyline.slice(1)) out.push(`${X(q[0])} ${Y(q[1])} L`);
        if (sh.closed) out.push(`${X(sh.polyline[0][0])} ${Y(sh.polyline[0][1])} L`);
      } else {
        out.push(`${X(sh.cubics[0][0][0])} ${Y(sh.cubics[0][0][1])} m`);
        for (const C of sh.cubics) out.push(`${X(C[1][0])} ${Y(C[1][1])} ${X(C[2][0])} ${Y(C[2][1])} ${X(C[3][0])} ${Y(C[3][1])} C`);
      }
      out.push(sh.closed ? 's' : 'S');
    }
    out.push('LB', '%AI5_EndLayer--');
  }
  out.push('%%PageTrailer', 'gsave annotatepage grestore showpage', '%%Trailer', ...PROCSETS.slice().reverse().map((r) => `${r.split(' ')[0]} /terminate get exec`), '%%EOF');
  return out.join('\n') + '\n';
}
