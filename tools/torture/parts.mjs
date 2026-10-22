/*
 * Torture-test part library. Every part is exact CSG (manifold-3d), in mm,
 * sitting on z=0 and centered in X/Y. Features follow the ISO 10791-7
 * finished test piece (stepped square / 45° diamond / circle / bore /
 * shallow angled faces) and the usual CAM feature classes: closed pockets
 * with islands, open slots, thin walls, grooves narrower than any tool,
 * through and blind holes, slender pins, freeform surfaces, undercuts.
 *
 * Each part may tag pocket floors: { z, box:[x0,y0,x1,y1] } selects every
 * up-facing triangle at that height inside the box, for the pocket op.
 */
import Module from 'manifold-3d';

const wasm = await Module();
wasm.setup();
const { Manifold, CrossSection } = wasm;

const box = (x, y, z) => Manifold.cube([x, y, z], true).translate([0, 0, z / 2]);
const cyl = (r, h, n = 64) => Manifold.cylinder(h, r, r, n);
const union = list => Manifold.union(list);

// a slab of x*y*h whose top is displaced by f(x,y); refined so the top is smooth
function surface(x, y, h, f, n = 60) {
    return box(x, y, h).refine(n).warp(v => {
        if (v[2] > h - 1e-6) v[2] = h + f(v[0], v[1]);
    });
}

export const PARTS = {
    // Phil's seed: a plain 1 inch cube
    seed_cube: () => ({ m: box(25.4, 25.4, 25.4) }),

    // ISO 10791-7-style stack: square base, 45° diamond, circle, central bore,
    // and a 3° ramp face on one side of the base
    iso_stack: () => {
        const base = box(80, 80, 10);
        const ramp = Manifold.cube([80, 20, 6], true).rotate([3, 0, 0]).translate([0, -50, 3]);
        const diamond = box(50, 50, 6).rotate([0, 0, 45]).translate([0, 0, 10]);
        const circle = cyl(22, 6).translate([0, 0, 16]);
        const bore = cyl(8, 40).translate([0, 0, -5]);
        return { m: union([base, diamond, circle]).subtract(bore).add(ramp.intersect(box(80, 120, 6).translate([0, -20, 0]))) };
    },

    // closed pocket with a round and a square island; floors tagged for pocket
    pocket_islands: () => {
        const blk = box(70, 50, 15);
        const pocket = box(50, 32, 9).translate([0, 0, 6.001]);
        const isl1 = cyl(5, 9).translate([-12, 0, 6]);
        const isl2 = box(8, 8, 9).translate([12, 0, 6]);
        return {
            m: blk.subtract(pocket).add(isl1).add(isl2),
            pockets: [{ z: 6, box: [-25, -16, 25, 16] }],
        };
    },

    // slots open through one side, widths straddling the tool sizes
    open_slots: () => {
        let m = box(60, 40, 12);
        const widths = [3, 6.35, 10, 13];
        let x = -22;
        for (const w of widths) {
            m = m.subtract(box(w, 30, 6).translate([x + w / 2, 6, 6.001]));
            x += w + 6;
        }
        return { m, pockets: [{ z: 6, box: [-30, -20, 30, 25] }] };
    },

    // free-standing thin walls 0.8 / 1.5 / 3 mm, 15 tall
    thin_walls: () => {
        const base = box(60, 40, 4);
        const walls = [0.8, 1.5, 3].map((t, i) => box(t, 30, 15).translate([-15 + i * 15, 0, 4]));
        return { m: union([base, ...walls]) };
    },

    // grooves narrower than the smallest tool: nothing may fall into them
    narrow_grooves: () => {
        let m = box(50, 40, 10);
        [0.5, 1.0, 1.6].forEach((w, i) => { m = m.subtract(box(w, 30, 2).translate([-10 + i * 10, 0, 8.001])); });
        return { m };
    },

    // through and blind holes
    holes: () => {
        let m = box(60, 60, 8);
        const through = [[1.5, -20, -20], [3, 0, -20], [5, 20, -20], [10, 0, 12]];
        const blind = [[3, -20, 20], [6, 20, 20]];
        for (const [r, x, y] of through) m = m.subtract(cyl(r, 20).translate([x, y, -5]));
        for (const [r, x, y] of blind) m = m.subtract(cyl(r, 4).translate([x, y, 4.001]));
        return { m, pockets: [{ z: 4, box: [-30, 10, 30, 30] }] };
    },

    // slender pins on a base
    pins: () => {
        const base = box(50, 50, 5);
        const pins = [[1, -12], [2, 0], [4, 12]].map(([r, x]) => cyl(r, 15).translate([x, 0, 5]));
        return { m: union([base, ...pins]) };
    },

    // hemisphere on a plinth
    dome: () => ({ m: union([box(60, 60, 4), Manifold.sphere(25, 96).intersect(box(60, 60, 30)).translate([0, 0, 4])]) }),

    // egg crate freeform
    egg_crate: () => ({ m: surface(60, 60, 10, (x, y) => 3 * Math.sin(x / 6) * Math.sin(y / 6), 80) }),

    // chamfers and ramps: 45° chamfered block and a 30° wedge
    chamfers: () => {
        const blk = box(40, 40, 15);
        const cut = box(20, 80, 20).rotate([0, 45, 0]).translate([20, 0, 15]);
        const wedge = Manifold.cube([30, 30, 30]).rotate([0, -30, 0]).intersect(box(30, 30, 15).translate([15, 15, 0]))
            .translate([-50, -15, 0]);
        return { m: blk.subtract(cut).add(wedge) };
    },

    // undercut: a mushroom cap over a stem; 3-axis tools must stay above the cap
    mushroom: () => ({ m: union([box(50, 50, 3), cyl(5, 12).translate([0, 0, 3]), cyl(16, 5).translate([0, 0, 15])]) }),

    // a full sphere resting on a small foot (undercut below the equator)
    sphere: () => ({ m: union([cyl(4, 2), Manifold.sphere(15, 96).translate([0, 0, 16])]) }),

    // smaller than the tool
    tiny: () => ({ m: box(3, 3, 3) }),

    // taller than a 1/2" flute
    tall_tower: () => ({ m: union([box(30, 30, 3), box(6, 6, 40).translate([0, 0, 3])]) }),

    // zigzag engraving 2 mm wide, 1 mm deep
    engraving: () => {
        let m = box(70, 30, 6);
        const pts = [[-30, -8], [-15, 8], [0, -8], [15, 8], [30, -8]];
        for (let i = 0; i < pts.length - 1; i++) {
            const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
            const len = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI;
            m = m.subtract(box(len + 2, 2, 1).rotate([0, 0, ang]).translate([(x0 + x1) / 2, (y0 + y1) / 2, 5.001]));
        }
        return { m };
    },

    // a large plate with a grid of holes and a deep pocket
    big_plate: () => {
        let m = box(200, 150, 6);
        for (let x = -80; x <= 80; x += 20) for (let y = -60; y <= 60; y += 30) m = m.subtract(cyl(3, 20).translate([x, y, -5]));
        m = m.subtract(box(60, 40, 4).translate([0, 0, 2.001]));
        return { m, pockets: [{ z: 2, box: [-30, -20, 30, 20] }] };
    },

    // stairs: many shallow steps (stepdown alignment)
    stairs: () => union(Array.from({ length: 8 }, (_, i) => box(60 - i * 6, 40, 2.5).translate([-i * 3, 0, i * 2.5]))),

    // ring: torus lying flat
    torus: () => {
        const ring = CrossSection.circle(5, 48).translate([15, 0]).revolve(96);
        return { m: union([box(50, 50, 2), ring.translate([0, 0, 7])]) };
    },
};

for (const k of Object.keys(PARTS)) {
    const f = PARTS[k];
    PARTS[k] = () => { const r = f(); return r instanceof Manifold ? { m: r } : r; };
}

// triangle soup (Float32Array, 9 floats per triangle) + pocket face ids
export function buildPart(name) {
    const { m, pockets = [] } = PARTS[name]();
    if (m.status && m.status() !== 'NoError') throw new Error(`${name}: ${m.status()}`);
    const mesh = m.getMesh();
    const { vertProperties: vp, triVerts: tv, numProp } = mesh;
    const nt = tv.length / 3;
    const verts = new Float32Array(nt * 9);
    let zmin = Infinity;
    for (let i = 0; i < vp.length; i += numProp) zmin = Math.min(zmin, vp[i + 2]);
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
        const v = tv[t * 3 + k] * numProp;
        verts[t * 9 + k * 3] = vp[v];
        verts[t * 9 + k * 3 + 1] = vp[v + 1];
        verts[t * 9 + k * 3 + 2] = vp[v + 2] - zmin;
    }
    const pocketFaces = [];
    for (const p of pockets) {
        for (let t = 0; t < nt; t++) {
            const a = verts.subarray(t * 9, t * 9 + 9);
            const ux = a[3] - a[0], uy = a[4] - a[1], uz = a[5] - a[2];
            const vx = a[6] - a[0], vy = a[7] - a[1], vz = a[8] - a[2];
            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const len = Math.hypot(nx, ny, nz);
            if (!len || nz / len < 0.999) continue;
            const cx = (a[0] + a[3] + a[6]) / 3, cy = (a[1] + a[4] + a[7]) / 3, cz = (a[2] + a[5] + a[8]) / 3;
            const [x0, y0, x1, y1] = p.box;
            if (Math.abs(cz - p.z) < 0.01 && cx > x0 && cx < x1 && cy > y0 && cy < y1) pocketFaces.push(t);
        }
    }
    return { name, verts, pocketFaces, tris: nt };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    for (const name of Object.keys(PARTS)) {
        const p = buildPart(name);
        let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        for (let i = 0; i < p.verts.length; i += 3) for (let k = 0; k < 3; k++) {
            mn[k] = Math.min(mn[k], p.verts[i + k]); mx[k] = Math.max(mx[k], p.verts[i + k]);
        }
        console.log(name.padEnd(15), String(p.tris).padStart(6), 'tris', mx.map((v, k) => (v - mn[k]).toFixed(1)).join(' x '), p.pocketFaces.length ? `pocket faces ${p.pocketFaces.length}` : '');
    }
}
