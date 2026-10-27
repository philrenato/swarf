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
 *   SwarfVector.writeParts(kind, parts) -> string
 *     parts: [{ svg, sx, sy, rz, mirror, px, py }] — each part's own drawing,
 *     as cam has scaled, mirrored, turned and placed it on the bed.
 */
import { buildShapes, writeSVG, writeDXF, writeAI, writePDF } from './vendor/unreason/exchange-2d.mjs';
import { parseSVG, parseDXF, parsePDF } from './vendor/unreason/exchange-2d-read.mjs';

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

window.SwarfVector = { toSVG, write, writeParts, read };
