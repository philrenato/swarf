// a DXF read as the import reads it: SwarfVector.toSVG (web/kiri/swarf-vector.mjs) into the SVG of
// its closed shapes, then cam's SVG reader (src/load/svg.js) makes the parts
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
globalThis.DOMParser = class extends DOMParser { constructor() { super({ onError() {} }); } };
globalThis.XMLSerializer = XMLSerializer;
globalThis.self = globalThis;
globalThis.window = globalThis;
const { THREE } = await import('../src/ext/three.js');
globalThis.THREE = THREE;
await import('../src/add/array.js');
await import('../src/add/three.js');
const SVG = await import('../src/load/svg.js');
await import('../web/kiri/swarf-vector.mjs');
export const V = globalThis.SwarfVector;

export const wrap = (ents, hdr = []) => [...(hdr.length ? ['0', 'SECTION', '2', 'HEADER', ...hdr, '0', 'ENDSEC'] : []),
    '0', 'SECTION', '2', 'ENTITIES', ...ents, '0', 'ENDSEC', '0', 'EOF'].join('\n');
export const line = (a, b, c, d, z = 0) => ['0', 'LINE', '8', '0', '10', a, '20', b, '30', z, '11', c, '21', d, '31', z];
export const circle = (x, y, r, more = []) => ['0', 'CIRCLE', '8', '0', '10', x, '20', y, '30', 0, '40', r, ...more];
export const arc = (x, y, r, a0, a1) => ['0', 'ARC', '8', '0', '10', x, '20', y, '30', 0, '40', r, '50', a0, '51', a1];
// points [x, y, bulge?]
export const lw = (pts, closed) => ['0', 'LWPOLYLINE', '8', '0', '90', pts.length, '70', closed ? 1 : 0,
    ...pts.flatMap(([x, y, b]) => ['10', x, '20', y, ...(b ? ['42', b] : [])])];

// { r: toSVG's answer, parts: [{ w, h, x0, y0, n }] } for the parts cam makes (holes kept)
export async function read(ents, { hdr = [], units, maxMM } = {}) {
    const r = await V.toSVG('t.dxf', new TextEncoder().encode(wrap(ents, hdr)), { units, maxMM });
    const parts = r.svg ? SVG.parse(r.svg, { flat: true, soup: true }).map(p => {
        const b = [Infinity, Infinity, -Infinity, -Infinity];
        for (const q of p.points) { b[0] = Math.min(b[0], q.x); b[1] = Math.min(b[1], q.y); b[2] = Math.max(b[2], q.x); b[3] = Math.max(b[3], q.y); }
        return { w: +(b[2] - b[0]).toFixed(2), h: +(b[3] - b[1]).toFixed(2), x0: +b[0].toFixed(2), y0: +b[1].toFixed(2), n: p.points.length, holes: (p.inner || []).length };
    }) : [];
    return { r, parts };
}
