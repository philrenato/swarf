/*
 * swarf vector — 2D files in and out, through Unreason's readers and writers
 * (vendor/unreason, unchanged). Everything is millimetres.
 *
 *   SwarfVector.toSVG(name, bytes) -> { svg, closed, open, note }
 *     an AI, PDF, DXF or SVG file as one SVG of its closed shapes, ready for
 *     cam's SVG import (a thickness turns them into parts). Open lines can't
 *     be given a thickness, so they are counted and left out.
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
import { buildShapes, writeSVG, writeDXF, writeAI, writePDF, projectCrv, crvToCubics } from './vendor/unreason/exchange-2d.mjs';
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

async function toSVG(name, bytes) {
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
