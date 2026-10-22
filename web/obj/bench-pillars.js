#!/usr/bin/env node
/**
 * generates web/obj/bench-pillars.stl -- a deterministic render benchmark model.
 *
 * small triangle count, but slices into many layers each holding many separate
 * islands, which is what actually stresses the preview/slice renderers.
 */
import { writeFileSync } from 'fs';

const tris = [];

function quad(a, b, c, d) {
    tris.push([a, b, c], [a, c, d]);
}

function box(x0, y0, z0, x1, y1, z1) {
    const p = (x, y, z) => [x, y, z];
    // bottom
    quad(p(x0,y0,z0), p(x1,y0,z0), p(x1,y1,z0), p(x0,y1,z0));
    // top
    quad(p(x0,y0,z1), p(x0,y1,z1), p(x1,y1,z1), p(x1,y0,z1));
    // sides
    quad(p(x0,y0,z0), p(x0,y0,z1), p(x1,y0,z1), p(x1,y0,z0));
    quad(p(x1,y0,z0), p(x1,y0,z1), p(x1,y1,z1), p(x1,y1,z0));
    quad(p(x1,y1,z0), p(x1,y1,z1), p(x0,y1,z1), p(x0,y1,z0));
    quad(p(x0,y1,z0), p(x0,y1,z1), p(x0,y0,z1), p(x0,y0,z0));
}

const N = 5, pitch = 12, side = 7, height = 50, base = 2, span = N * pitch;

box(0, 0, 0, span, span, base);
for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
        const x = i * pitch + (pitch - side) / 2;
        const y = j * pitch + (pitch - side) / 2;
        box(x, y, base, x + side, y + side, base + height);
    }
}

const buf = Buffer.alloc(84 + tris.length * 50);
buf.writeUInt32LE(tris.length, 80);
let off = 84;
for (const [a, b, c] of tris) {
    off += 12; // normal left zero -- loaders recompute
    for (const v of [a, b, c]) {
        for (const n of v) {
            buf.writeFloatLE(n, off);
            off += 4;
        }
    }
    off += 2;
}

writeFileSync(new URL('./bench-pillars.stl', import.meta.url), buf);
console.log(`wrote bench-pillars.stl (${tris.length} triangles)`);
