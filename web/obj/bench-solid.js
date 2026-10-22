#!/usr/bin/env node
/** solid block: the common case where infill is fully enclosed by shells */
import { writeFileSync } from 'fs';
const tris = [];
const quad = (a,b,c,d) => { tris.push([a,b,c],[a,c,d]); };
function box(x0,y0,z0,x1,y1,z1){ const p=(x,y,z)=>[x,y,z];
  quad(p(x0,y0,z0),p(x1,y0,z0),p(x1,y1,z0),p(x0,y1,z0));
  quad(p(x0,y0,z1),p(x0,y1,z1),p(x1,y1,z1),p(x1,y0,z1));
  quad(p(x0,y0,z0),p(x0,y0,z1),p(x1,y0,z1),p(x1,y0,z0));
  quad(p(x1,y0,z0),p(x1,y0,z1),p(x1,y1,z1),p(x1,y1,z0));
  quad(p(x1,y1,z0),p(x1,y1,z1),p(x0,y1,z1),p(x0,y1,z0));
  quad(p(x0,y1,z0),p(x0,y1,z1),p(x0,y0,z1),p(x0,y0,z0));
}
box(0,0,0,60,60,52);
const buf=Buffer.alloc(84+tris.length*50); buf.writeUInt32LE(tris.length,80);
let off=84;
for (const [a,b,c] of tris){ off+=12; for (const v of [a,b,c]) for (const n of v){ buf.writeFloatLE(n,off); off+=4; } off+=2; }
writeFileSync(new URL('./bench-solid.stl', import.meta.url), buf);
console.log(`wrote bench-solid.stl (${tris.length} triangles)`);
