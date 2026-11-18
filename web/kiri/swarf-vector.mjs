/*
 * swarf vector — 2D files in and out, through Unreason's readers and writers
 * (vendor/unreason, unchanged). Everything is millimetres.
 *
 *   SwarfVector.toSVG(name, bytes) -> { svg, closed, open, note }
 *     an AI, PDF, DXF or SVG file as one SVG of its closed shapes, ready for
 *     cam's SVG import (a thickness turns them into parts). Open lines can't
 *     be given a thickness, so they are counted and left out.
 *   SwarfVector.toSVG(name.dxf, bytes, { units, maxMM }) -> the same, and { box, fileUnits,
 *     units, heights, text, images, other, otherKinds } or { big: [w, h] } past maxMM (see dxfRead)
 *   SwarfVector.write(kind, svg) -> string   ('svg' | 'dxf' | 'ai' | 'pdf')
 *     a drawing (an SVG in mm, as the shape tool and imports keep it) written
 *     as that format, true size.
 *   SwarfVector.curves(svg) -> [{ crv }]   a drawing's curves (mm, y up)
 *   SwarfVector.cubics(crv) -> [[p0,p1,p2,p3]…]   a curve as cubic pieces, to draw it
 *   SwarfVector.svgOf(curves) -> string   closed curves as a filled SVG in mm, ready for cam
 *   SwarfVector.split(svg, boxes) -> [svg]   one drawing into one per part: each curve goes
 *     to the smallest part box [x0,y0,x1,y1] that holds it
 *   SwarfVector.polyCrv(pts, closed)   a polygon as a degree-1 curve
 *   SwarfVector.bezierChainCrv(pieces)   cubic pieces [[p0,p1,p2,p3]…] end to end as one curve
 *   SwarfVector.writeCurves(kind, curves) -> string   curves already placed (DRAW's bedCurves)
 *   SwarfVector.writeParts(kind, parts) -> string
 *     parts: [{ svg, sx, sy, rz, mirror, px, py }] — each part's own drawing,
 *     as cam has scaled, mirrored, turned and placed it on the bed.
 */
import { buildShapes, writeSVG, writeDXF, writeAI, writePDF, projectCrv, crvToCubics, cubicAt } from './vendor/unreason/exchange-2d.mjs';
import { parseSVG, parseDXF, parsePDF, polyCrv, bezierChainCrv } from './vendor/unreason/exchange-2d-read.mjs';

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
}

function text(bytes) { return new TextDecoder('utf-8').decode(bytes); }

async function read(name, bytes) {
  const kind = name.toLowerCase().split('.').pop();
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (kind === 'svg') return parseSVG(text(b));
  if (kind === 'dxf') return parseDXF(text(b));
  return parsePDF(b, { inflate });                 // .ai and .pdf (an .ai is PDF inside; old ones PostScript)
}

// ── DXF ──
// The reader scales by $INSUNITS and reads a file without it as mm. Around it: a file without
// units is read as inches when $MEASUREMENT says imperial (0), or as the units asked for; curves
// that meet end to end are joined into one outline; a closed outline with no area is left out
// with the open lines; the heights it was drawn at are counted (it is pressed flat); and a drawing
// bigger than maxMM is refused before any curve is built.
const INSUNITS_MM = { 1: 25.4, 2: 304.8, 3: 1609344, 4: 1, 5: 10, 6: 1000, 7: 1e6, 8: 25.4e-6, 9: 0.0254, 10: 914.4, 11: 1e-7, 12: 1e-6, 13: 1e-3, 14: 100, 15: 10000, 16: 100000 };
const UNITS_MM = { mm: 1, inch: 25.4 };
const JOIN_MM = 0.01;
const Z_KINDS = new Set(['LINE', 'ARC', 'CIRCLE', 'ELLIPSE', 'LWPOLYLINE', 'POLYLINE', 'VERTEX', 'SPLINE']);

// $INSUNITS and $MEASUREMENT, and the Z values of each drawn entity (codes 30, 31 and 38; none is 0)
function dxfScan(text) {
  const lines = text.split(/\r?\n/);
  let section = null, opening = false, insunits = null, measurement = null, kind = null;
  const zs = [];
  let here = [];
  const flush = () => { if (kind && Z_KINDS.has(kind)) zs.push(...(here.length ? here : [0])); here = []; };
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i], 10), v = lines[i + 1].trim();
    if (code === 0) {
      flush();
      opening = v === 'SECTION';
      if (v === 'ENDSEC') section = null;
      kind = section === 'ENTITIES' ? v : null;
      continue;
    }
    if (opening && code === 2) { section = v; opening = false; continue; }
    if (section === 'HEADER' && code === 9) {
      const n = parseInt((lines[i + 3] || '').trim(), 10);
      if (v === '$INSUNITS') insunits = n;
      if (v === '$MEASUREMENT') measurement = n;
    }
    if (kind && (code === 30 || code === 31 || code === 38)) { const z = parseFloat(v); if (Number.isFinite(z)) here.push(z); }
  }
  flush();
  return { insunits, measurement, zs };
}

// distinct heights 0.01 mm apart or more
function countHeights(zs, tol = 0.01) {
  if (!zs.length) return 0;
  const s = zs.slice().sort((a, b) => a - b);
  let n = 1;
  for (let i = 1, at = s[0]; i < s.length; i++) if (s[i] - at > tol) { n++; at = s[i]; }
  return n;
}

const near = (a, b, tol) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
const flipCubic = C => [C[3], C[2], C[1], C[0]];

// open curves whose ends meet (within tol) joined into chains; a chain that comes back to its start is closed
function joinCurves(curves, tol) {
  const out = [], open = [];
  for (const c of curves) {
    const cubics = crvToCubics(projectCrv(c.crv));
    if (!cubics.length) continue;
    const a = cubics[0][0], b = cubics[cubics.length - 1][3];
    if (near(a, b, 1e-9)) { out.push(c); continue; }
    open.push({ c, cubics, line: c.crv.degree === 1, pts: c.crv.degree === 1 ? c.crv.ctrlPts.map(p => [p[0], p[1]]) : null });
  }
  const used = new Array(open.length).fill(false);
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let chain = open[i].cubics.slice(), line = open[i].line, pts = line ? open[i].pts.slice() : null;
    const first = open[i].c;
    let joined = false;
    for (let grew = true; grew;) {
      grew = false;
      const head = chain[0][0], tail = chain[chain.length - 1][3];
      if (near(head, tail, tol)) break;
      for (let j = 0; j < open.length; j++) {
        if (used[j]) continue;
        const o = open[j], s = o.cubics[0][0], e = o.cubics[o.cubics.length - 1][3];
        let add = null, at = null, rev = false;
        if (near(tail, s, tol)) { add = o.cubics; at = 'tail'; }
        else if (near(tail, e, tol)) { add = o.cubics.map(flipCubic).reverse(); at = 'tail'; rev = true; }
        else if (near(head, e, tol)) { add = o.cubics; at = 'head'; }
        else if (near(head, s, tol)) { add = o.cubics.map(flipCubic).reverse(); at = 'head'; rev = true; }
        if (!add) continue;
        used[j] = true; grew = true; joined = true;
        const op = o.line ? (rev ? o.pts.slice().reverse() : o.pts) : null;
        if (at === 'tail') { chain = chain.concat(add); if (line && op) pts = pts.concat(op.slice(1)); }
        else { chain = add.concat(chain); if (line && op) pts = op.slice(0, -1).concat(pts); }
        line = line && o.line;
        break;
      }
    }
    const closed = near(chain[0][0], chain[chain.length - 1][3], tol);
    if (closed) {
      chain[chain.length - 1] = [...chain[chain.length - 1].slice(0, 3), chain[0][0]];
      if (line) pts[pts.length - 1] = pts[0];
    }
    if (!joined && !closed) { out.push(first); continue; }
    out.push({ name: first.name, layer: first.layer, crv: line ? polyCrv(closed ? pts.slice(0, -1) : pts, closed) : bezierChainCrv(chain) });
  }
  return out;
}

// the area a closed shape holds, from points along its cubics
function shapeArea(sh) {
  let a = 0, prev = null;
  for (const C of sh.cubics) for (const t of [0, 0.25, 0.5, 0.75]) {
    const p = cubicAt(C, t);
    if (prev) a += prev[0] * p[1] - p[0] * prev[1];
    prev = p;
  }
  const p = sh.cubics[0][0];
  a += prev[0] * p[1] - p[0] * prev[1];
  return Math.abs(a / 2);
}

function dxfRead(name, text, { units = 'auto', maxMM = Infinity } = {}) {
  const scan = dxfScan(text);
  const fileMM = INSUNITS_MM[scan.insunits] || 0;
  const got = parseDXF(text, { fallbackUnitMM: 1 });
  const unitMM = UNITS_MM[units] || fileMM || (scan.measurement === 0 ? 25.4 : 1);
  const k = unitMM / (fileMM || 1);
  let curves = got.curves;
  if (k !== 1) curves = curves.map(c => ({ ...c, crv: { ...c.crv, ctrlPts: c.crv.ctrlPts.map(([x, y, z, w]) => [x * k, y * k, z, w]) } }));
  const skipped = got.skipped || {};
  const count = (...kinds) => kinds.reduce((n, t) => n + (skipped[t] || 0), 0);
  const text_ = count('TEXT', 'MTEXT'), images = count('IMAGE', 'WIPEOUT');
  const quiet = new Set(['TEXT', 'MTEXT', 'IMAGE', 'WIPEOUT', 'VIEWPORT', 'POINT']);
  const others = Object.keys(skipped).filter(t => !quiet.has(t));
  const info = {
    fileUnits: !!fileMM,
    units: unitMM === 25.4 ? 'inch' : unitMM === 1 ? 'mm' : null,
    heights: countHeights(scan.zs.map(z => z * unitMM), 0.01),
    text: text_, images,
    other: others.reduce((n, t) => n + skipped[t], 0), otherKinds: others,
    note: got.note
  };
  // the extent from the control points (a NURBS lies in their hull), before anything is built
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const c of curves) for (const [x, y] of c.crv.ctrlPts) {
    if (x < box[0]) box[0] = x; if (y < box[1]) box[1] = y;
    if (x > box[2]) box[2] = x; if (y > box[3]) box[3] = y;
  }
  if (curves.length && (box[2] - box[0] > maxMM || box[3] - box[1] > maxMM || !box.every(Number.isFinite))) {
    return { ...info, svg: null, closed: 0, open: 0, big: [box[2] - box[0], box[3] - box[1]] };
  }
  const built = buildShapes(joinCurves(curves, JOIN_MM));
  const closed = built.shapes.filter(s => s.closed && shapeArea(s) > 1e-6);
  const open = built.shapes.length - closed.length + built.skipped;
  return { ...info, ...svgOfShapes(built, closed, name), closed: closed.length, open };
}

function svgOfShapes(built, closed, name) {
  if (!closed.length) return { svg: null };
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const s of closed) { box[0] = Math.min(box[0], s.box[0]); box[1] = Math.min(box[1], s.box[1]); box[2] = Math.max(box[2], s.box[2]); box[3] = Math.max(box[3], s.box[3]); }
  // cam's import fills shapes: the writer's stroke-only paths are made solid
  const svg = writeSVG({ ...built, shapes: closed, box }, { units: 'mm', stroke: 0.25, title: name }).replace(/fill="none"/g, 'fill="#000"');
  return { svg, box };
}

// opt (DXF only): { units: 'auto' | 'mm' | 'inch', maxMM }
async function toSVG(name, bytes, opt = {}) {
  if (/\.dxf$/i.test(name)) {
    return dxfRead(name, text(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)), opt);
  }
  const got = await read(name, bytes);
  const built = buildShapes(got.curves || []);
  const closed = built.shapes.filter(s => s.closed);
  const open = built.shapes.length - closed.length;
  if (!closed.length) return { svg: null, closed: 0, open, note: got.note };
  const keep = { ...built, shapes: closed };
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const s of closed) { box[0] = Math.min(box[0], s.box[0]); box[1] = Math.min(box[1], s.box[1]); box[2] = Math.max(box[2], s.box[2]); box[3] = Math.max(box[3], s.box[3]); }
  keep.box = box;
  // cam's import fills shapes: the writer's stroke-only paths are made solid
  const svg = writeSVG(keep, { units: 'mm', stroke: 0.25, title: name }).replace(/fill="none"/g, 'fill="#000"');
  return { svg, closed: closed.length, open, note: got.note };
}

function write(kind, svg) {
  const built = buildShapes(parseSVG(svg).curves || []);
  if (kind === 'dxf') return writeDXF(built, { units: 'mm' });
  if (kind === 'ai') return writeAI(built, { title: 'swarf' });
  if (kind === 'pdf') return writePDF(built, { title: 'swarf' });
  return writeSVG(built, { units: 'mm', title: 'swarf' });
}

// Each drawing is centred on its own box (cam centres the part it made), then
// mirrored, scaled, turned about Z and moved to where the part sits. Control
// points are plain coordinates (Unreason's xfCrv maps x,y and keeps w).
function writeCurves(kind, list) {
  const built = buildShapes(list);
  if (kind === 'dxf') return writeDXF(built, { units: 'mm' });
  if (kind === 'ai') return writeAI(built, { title: 'swarf' });
  if (kind === 'pdf') return writePDF(built, { title: 'swarf' });
  return writeSVG(built, { units: 'mm', title: 'swarf' });
}

function writeParts(kind, parts) {
  const all = [];
  for (const p of parts) {
    const curves = parseSVG(p.svg).curves || [];
    const box = buildShapes(curves).box;
    const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
    const c = Math.cos(p.rz || 0), s = Math.sin(p.rz || 0);
    for (const k of curves) {
      all.push({ ...k, crv: { ...k.crv, ctrlPts: k.crv.ctrlPts.map(([x, y, z, w]) => {
        let u = (x - cx) * (p.mirror ? -1 : 1) * (p.sx || 1), v = (y - cy) * (p.sy || 1);
        return [c * u - s * v + (p.px || 0), s * u + c * v + (p.py || 0), z, w];
      }) } });
    }
  }
  const built = buildShapes(all);
  if (kind === 'dxf') return writeDXF(built, { units: 'mm' });
  if (kind === 'ai') return writeAI(built, { title: 'swarf' });
  if (kind === 'pdf') return writePDF(built, { title: 'swarf' });
  return writeSVG(built, { units: 'mm', title: 'swarf' });
}

const curves = svg => (parseSVG(svg).curves || []).map(c => ({ crv: c.crv }));
const cubics = crv => crvToCubics(projectCrv(crv));
const svgOf = list => writeSVG(buildShapes(list), { units: 'mm', stroke: 0.25, title: 'swarf' }).replace(/fill="none"/g, 'fill="#000"');

function split(svg, boxes) {
  const list = curves(svg), out = boxes.map(() => []);
  for (const c of list) {
    const b = buildShapes([c]).box;
    let best = -1, area = Infinity;
    boxes.forEach((B, i) => {
      const inside = b[0] >= B[0] - 0.5 && b[1] >= B[1] - 0.5 && b[2] <= B[2] + 0.5 && b[3] <= B[3] + 0.5;
      const a = (B[2] - B[0]) * (B[3] - B[1]);
      if (inside && a < area) { best = i; area = a; }
    });
    if (best >= 0) out[best].push(c);
  }
  return out.map(l => l.length ? svgOf(l) : null);
}

window.SwarfVector = { toSVG, write, writeParts, writeCurves, read, curves, cubics, svgOf, split, polyCrv, bezierChainCrv };
