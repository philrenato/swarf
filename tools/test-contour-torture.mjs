// node tools/test-contour-torture.mjs [cases] [seed] — (FROM=n starts at case n) the contour's 2D paths (topo3.js paths2d,
// ringPaths) on seeded random parts, with no browser. Each case is a random outline (stars with
// spikes, plates with holes, islands in holes, necks narrower than the bit, parts smaller than the
// bit, parts the size of the bed far off the origin, degenerate and self-touching loops) carrying a
// random relief on a raster like the one topo3 makes, cut with a random bit (flat, ball, V, tiny)
// at a random stepover (tiny to more than the bit) and any angle 0 to 180.
//   rings: every ring of every level cut once, whole; the ease stays between a ring and the next
//          and ends where the next ring starts; outermost first; the uncut surface on the bit's
//          right (climb); bounded time for any stepover, including 0, NaN and under 0
//   paths: no NaN; never under the floor; never into the relief by more than the raster allows
//          (the tool's own profile, checked against the height grid cell by cell); never under a
//          tab's top, point or move; every move inside the clip outline (to within a raster step);
//          the area inside the outline covered to the stepover; the same input gives the same paths
//   plan:  any saved pattern, angle and axis gives one or two passes at sound angles
import assert from 'node:assert/strict';
globalThis.self = globalThis;
const { THREE } = await import('../src/ext/three.js'); globalThis.THREE = THREE;
await import('../src/add/array.js'); await import('../src/add/three.js');
await import('../src/kiri/mode/cam/core/ops.js');   // as the app loads it: the op list first
const { Topo, Probe } = await import('../src/kiri/mode/cam/work/topo3.js');
const { Tool } = await import('../src/kiri/mode/cam/core/tool.js');
const { contourPlan } = await import('../src/kiri/mode/cam/work/op-contour.js');
const { newPolygon } = await import('../src/geo/polygon.js');
const { newPoint } = await import('../src/geo/point.js');
const { polygons: POLY } = await import('../src/geo/polygons.js');

const CASES = +(process.argv[2] || 2400);
const SEED0 = +(process.argv[3] || 149);
const failures = [];
let easeStray = 0, easeOff = 0;
const fail = (what) => { failures.push(what); if (failures.length <= 400) console.log('FAIL', what); };

function rng(seed) {
    let a = seed >>> 0;
    const next = () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (lo, hi) => lo + (hi - lo) * next();
    next.log = (lo, hi) => Math.exp(Math.log(lo) + (Math.log(hi) - Math.log(lo)) * next());
    next.int = (lo, hi) => Math.floor(next.range(lo, hi + 1));
    next.pick = arr => arr[Math.floor(next() * arr.length)];
    return next;
}

const poly = pts => { const p = newPolygon(); for (const [x, y] of pts) p.add(x, y, 0); return p; };
const rect = (x0, y0, x1, y1) => poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
const ngon = (cx, cy, r, n = 48, rot = 0) => poly(Array.from({ length: n }, (_, i) => [cx + r * Math.cos(rot + i / n * 2 * Math.PI), cy + r * Math.sin(rot + i / n * 2 * Math.PI)]));
const holed = (outer, ...holes) => { outer.inner = holes; return outer; };
const at = newPoint(0, 0, 0);
const inside = (polys, x, y) => { at.x = x; at.y = y; return polys.some(p => at.isInPolygon(p)); };
// strictly inside (even-odd over every loop, holes too), with no allowance at the edge
const strictlyIn = (polys, x, y) => {
    let n = false;
    for (const p of POLY.flatten(polys.map(q => q.clone(true)))) {
        const pts = p.points;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const a = pts[i], b = pts[j];
            if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) n = !n;
        }
    }
    return n;
};
const segDist = (ax, ay, bx, by, x, y) => {
    const ux = bx - ax, uy = by - ay, uu = ux * ux + uy * uy;
    const t = uu > 0 ? Math.max(0, Math.min(1, ((x - ax) * ux + (y - ay) * uy) / uu)) : 0;
    return Math.hypot(ax + ux * t - x, ay + uy * t - y);
};
const toLoop = (pts, x, y) => {
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        best = Math.min(best, segDist(ax, ay, bx, by, x, y));
    }
    return best;
};
// distance from (x, y) to the nearest edge of any loop of a set of polygons (outlines and holes)
const toEdge = (polys, x, y) => {
    let best = Infinity;
    for (const p of POLY.flatten(polys.map(q => q.clone(true)))) best = Math.min(best, toLoop(p.points.map(q => [q.x, q.y]), x, y));
    return best;
};

// ---- random parts -----------------------------------------------------------------------------
// an outline in a unit box, then scaled and moved; returns { name, polys }
function randomPart(r) {
    const kind = r.pick(['star', 'spiky', 'plate', 'island', 'neck', 'tiny', 'rotated', 'keyhole', 'twins', 'sliver', 'degenerate', 'ring']);
    const s = kind === 'tiny' ? r.log(0.2, 4) : r.log(3, 2400);
    const ox = r.pick([0, r.range(-1200, 1200), 2400 - s]), oy = r.pick([0, r.range(-600, 1200), 1200 - s]);
    const X = u => ox + u * s, Y = v => oy + v * s;
    const P = pts => poly(pts.map(([u, v]) => [X(u), Y(v)]));
    let polys;
    switch (kind) {
        case 'star': case 'spiky': {
            const n = r.int(3, kind === 'spiky' ? 40 : 14), pts = [];
            for (let i = 0; i < n * 2; i++) {
                const a = i / (n * 2) * 2 * Math.PI, rad = i % 2 ? r.range(kind === 'spiky' ? 0.03 : 0.2, 0.5) : 0.5;
                pts.push([0.5 + rad * Math.cos(a), 0.5 + rad * Math.sin(a)]);
            }
            polys = [P(pts)];
            break;
        }
        case 'plate': {
            const outer = P([[0, 0], [1, 0], [1, r.range(0.2, 1)], [0, r.range(0.2, 1)]]);
            const holes = [];
            const k = r.int(1, 4);
            for (let i = 0; i < k; i++) {
                const cx = (i + 0.5) / k, w = r.range(0.01, 0.4) / k;
                holes.push(r() < 0.5 ? P([[cx - w, 0.08], [cx - w, 0.15], [cx + w, 0.15], [cx + w, 0.08]]) : P(Array.from({ length: 24 }, (_, j) => [cx + w * Math.cos(-j / 24 * 2 * Math.PI), 0.12 + Math.min(w, 0.05) * Math.sin(-j / 24 * 2 * Math.PI)])));
            }
            polys = [holed(outer, ...holes)];
            break;
        }
        case 'island': {
            // a hole with an island in it, and the island has a hole of its own
            const g = r.range(0.02, 0.15);
            polys = [
                holed(P([[0, 0], [1, 0], [1, 1], [0, 1]]), P([[0.15, 0.15], [0.15, 0.85], [0.85, 0.85], [0.85, 0.15]])),
                holed(P([[0.15 + g, 0.15 + g], [0.85 - g, 0.15 + g], [0.85 - g, 0.85 - g], [0.15 + g, 0.85 - g]]), P([[0.4, 0.4], [0.4, 0.6], [0.6, 0.6], [0.6, 0.4]])),
            ];
            break;
        }
        case 'neck': {
            const w = r.log(0.001, 0.2);
            polys = [P([[0, 0], [0.4, 0], [0.4, 0.5 - w / 2], [0.6, 0.5 - w / 2], [0.6, 0], [1, 0], [1, 1], [0.6, 1], [0.6, 0.5 + w / 2], [0.4, 0.5 + w / 2], [0.4, 1], [0, 1]])];
            break;
        }
        case 'tiny': polys = [P([[0, 0], [1, 0], [1, r.range(0.3, 1)], [0, r.range(0.3, 1)]])]; break;
        case 'rotated': {
            const a = r.range(0, Math.PI), c = Math.cos(a), sn = Math.sin(a), h = r.range(0.05, 0.5);
            polys = [P([[-0.5, -h], [0.5, -h], [0.5, h], [-0.5, h]].map(([u, v]) => [0.5 + u * c - v * sn, 0.5 + u * sn + v * c]))];
            break;
        }
        case 'keyhole': {
            // an outline that touches itself: a slot whose two sides meet at one point
            polys = [P([[0, 0], [1, 0], [1, 1], [0.52, 1], [0.5, 0.5], [0.48, 1], [0, 1]])];
            break;
        }
        case 'twins': {
            // two parts side by side, the gap between them tiny
            const gap = r.log(1e-4, 0.05);
            polys = [P([[0, 0], [0.5 - gap / 2, 0], [0.5 - gap / 2, 0.6], [0, 0.6]]), P([[0.5 + gap / 2, 0], [1, 0], [1, 0.6], [0.5 + gap / 2, 0.6]])];
            break;
        }
        case 'sliver': polys = [P([[0, 0], [1, 0], [r.range(0, 1), r.log(0.001, 0.08)]])]; break;
        case 'degenerate': polys = [P([[0, 0], [0.5, 0], [1, 0]]), P([[0.2, 0.3], [0.2, 0.3], [0.2, 0.3]]), P([[0.1, 0.4], [0.9, 0.4], [0.9, 0.9], [0.1, 0.9]])]; break;
        case 'ring': {
            // the hole inside the outline's inner circle, as a shadow's holes always are
            const n = r.int(3, 64);
            polys = [holed(ngon(X(0.5), Y(0.5), s / 2, n, r() * 6), ngon(X(0.5), Y(0.5), s / 2 * Math.cos(Math.PI / n) * r.range(0.1, 0.98), r.int(3, 64), r() * 6))];
            break;
        }
    }
    return { name: `${kind} ${s.toFixed(3)} at ${ox.toFixed(1)},${oy.toFixed(1)}`, polys, size: s };
}

// ---- rings ------------------------------------------------------------------------------------
function levelsOf(clip, resolution, step) {
    const levels = [];
    let ring = POLY.expand(clip, -resolution);
    for (let n = 0; ring && ring.length && n < 100000; n++) {
        const level = POLY.flatten(ring.map(r => r.clone(true))).map(p => p.points.map(q => [q.x, q.y])).filter(p => p.length > 2);
        level.region = ring;
        levels.push(level);
        ring = step > 0 ? POLY.expand(ring, -step) : null;
    }
    return levels;
}
function checkRings(name, clip, resolution, step) {
    const errs = [];
    const t0 = performance.now();
    const paths = new Topo().ringPaths(clip, resolution, step);
    const ms = performance.now() - t0;
    if (ms > 20000) errs.push(`took ${ms | 0} ms`);
    const levels = levelsOf(clip, resolution, step), loops = levels.flatMap((l, n) => l.map(pts => ({ pts, n, used: 0 })));
    if (paths.length !== loops.length) errs.push(`${paths.length} paths for ${loops.length} rings`);
    if (!paths.every(p => p.every(q => q.every(Number.isFinite)))) errs.push('NaN');
    let landed = null;
    const near = 1e-6 * Math.max(1, ...clip.map(p => Math.abs(p.bounds.maxx) + Math.abs(p.bounds.maxy)));
    paths.forEach((path, k) => {
        if (errs.length > 4) return;
        const closeAt = path.findIndex((p, i) => i > 2 && Math.hypot(p[0] - path[0][0], p[1] - path[0][1]) < 1e-9);
        if (closeAt < 0) { errs.push(`path ${k} never closes`); landed = null; return; }
        const ring = path.slice(0, closeAt + 1);
        const loop = loops.find(l => !l.used && closeAt >= l.pts.length && ring.every(([x, y]) => toLoop(l.pts, x, y) < near)
            && l.pts.every(([x, y]) => ring.some(q => Math.hypot(q[0] - x, q[1] - y) < near)));
        if (!loop) { errs.push(`path ${k} is not one whole ring not cut before`); landed = null; return; }
        loop.used++;
        // climb: the region still to cut on the right of the longest move round the ring
        let best = 0, m = null;
        for (let i = 1; i <= closeAt; i++) {
            const [x0, y0] = path[i - 1], [x1, y1] = path[i], len = Math.hypot(x1 - x0, y1 - y0);
            if (len > best) { best = len; m = [(x0 + x1) / 2, (y0 + y1) / 2, (y1 - y0) / len, -(x1 - x0) / len]; }
        }
        const e = Math.min(0.02, best / 8, step > 0 ? step / 4 : 0.02, resolution / 2);
        if (m && e > near * 10) {
            const region = levels[loop.n].region;
            // a ring where the outline and a hole have all but met is thinner than e: try closer in
            const climb = [e, e / 8, e / 64].some(f => strictlyIn(region, m[0] + m[2] * f, m[1] + m[3] * f) && !strictlyIn(region, m[0] - m[2] * f, m[1] - m[3] * f));
            if (!climb) errs.push(`path ${k} is not climb`);
        }
        if (landed) {
            if (Math.hypot(path[0][0] - landed.x, path[0][1] - landed.y) > near) errs.push(`path ${k} does not start where ${k - 1}'s ease ends`);
            if (loop.n !== landed.n + 1) errs.push(`path ${k} is not one level in from ${k - 1}`);
        }
        landed = null;
        const tail = path.slice(closeAt + 1);
        if (!tail.length) return;
        // the ease stays within a step and a half of its ring, and inside the outline (a hole too
        // small for the offsetter to keep, under its minimum area, is not in the rings either)
        for (const [x, y] of tail) {
            const stray = toLoop(loop.pts, x, y) - step * 1.6;
            easeStray = Math.max(easeStray, stray);
            if (stray > near) { errs.push(`path ${k}'s ease strays ${stray.toFixed(4)} past a step and a half`); break; }
            if (!inside(clip, x, y) && !strictlyIn(levels[0].region, x, y)) {
                const off = toEdge(clip, x, y);
                easeOff = Math.max(easeOff, off);
                errs.push(`path ${k}'s ease leaves the outline by ${off.toFixed(4)} at ${x.toFixed(3)},${y.toFixed(3)}`);
                break;
            }
        }
        const [ex, ey] = tail[tail.length - 1];
        if (!(levels[loop.n + 1] || []).some(l => toLoop(l, ex, ey) < near)) errs.push(`path ${k}'s ease ends off the next level`);
        landed = { x: ex, y: ey, n: loop.n };
    });
    if (landed) errs.push('the last ring eases somewhere');
    if (!loops.every(l => l.used === 1)) errs.push(`${loops.filter(l => l.used !== 1).length} rings not cut exactly once`);
    if (paths.length && levels[0] && !levels[0].some(l => l.every(([x, y]) => toLoop(paths[0], x, y) < near))) errs.push('the first ring is not an outermost one');
    for (const e of errs) fail(`rings ${name} res ${resolution} step ${step}: ${e}`);
    return { paths, levels: levels.length, ms };
}

// ---- paths on a relief ------------------------------------------------------------------------
const TOOLS = [
    { id: 1, name: '1/4 flat', type: 'endmill', flute_diam: 0.25, flute_len: 1, shaft_diam: 0.25, metric: false, taper_tip: 0 },
    { id: 2, name: '1/8 flat', type: 'endmill', flute_diam: 0.125, flute_len: 0.5, shaft_diam: 0.125, metric: false, taper_tip: 0 },
    { id: 3, name: '0.4 flat', type: 'endmill', flute_diam: 0.4, flute_len: 2, shaft_diam: 0.4, metric: true, taper_tip: 0 },
    { id: 4, name: '1/4 ball', type: 'ballmill', flute_diam: 0.25, flute_len: 1, shaft_diam: 0.25, metric: false, taper_tip: 0 },
    { id: 5, name: '1 mm ball', type: 'ballmill', flute_diam: 1, flute_len: 4, shaft_diam: 1, metric: true, taper_tip: 0 },
    { id: 6, name: '60 V', type: 'tapermill', flute_diam: 12.7, flute_len: 12.7 / 2 / Math.tan(Math.PI / 6), shaft_diam: 12.7, metric: true, taper_tip: 0 },
    { id: 7, name: '90 V', type: 'tapermill', flute_diam: 0.5, flute_len: 0.25, shaft_diam: 0.5, metric: false, taper_tip: 0 },
    { id: 8, name: '1 in flat', type: 'endmill', flute_diam: 1, flute_len: 1, shaft_diam: 1, metric: false, taper_tip: 0 },
];

// the relief: a height grid like the raster's (cell ix, iy at minX + ix * res, minY + iy * res; 0 is
// no surface), with bumps, a wall and one-cell spikes over the part's outline
function relief(r, polys, res) {
    const b = polys.reduce((a, p) => { a.minx = Math.min(a.minx, p.bounds.minx); a.miny = Math.min(a.miny, p.bounds.miny); a.maxx = Math.max(a.maxx, p.bounds.maxx); a.maxy = Math.max(a.maxy, p.bounds.maxy); return a; }, { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity });
    const boundsX = b.maxx - b.minx, boundsY = b.maxy - b.miny;
    const stepsX = Math.max(1, Math.ceil(boundsX / res)), stepsY = Math.max(1, Math.ceil(boundsY / res));
    const data = new Float32Array(stepsX * stepsY);
    const H = r.log(0.5, 40), bumps = Array.from({ length: r.int(0, 5) }, () => [r.range(b.minx, b.maxx), r.range(b.miny, b.maxy), r.log(0.5, Math.max(1, boundsX)), r.range(-0.5, 1) * H]);
    const wall = r() < 0.5 ? [r.range(-1, 1), r.range(-1, 1), r.range(b.minx, b.maxx), r.range(b.miny, b.maxy), r.range(0, H)] : null;
    const spikes = r() < 0.4 ? r.int(1, 12) : 0;
    for (let ix = 0; ix < stepsX; ix++) for (let iy = 0; iy < stepsY; iy++) {
        const x = b.minx + ix * res, y = b.miny + iy * res;
        if (!inside(polys, x, y)) continue;
        let z = H * 0.5;
        for (const [cx, cy, w, h] of bumps) z += h * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (w * w));
        if (wall && (x - wall[2]) * wall[0] + (y - wall[3]) * wall[1] > 0) z += wall[4];
        data[ix * stepsY + iy] = Math.max(0.001, z);
    }
    for (let i = 0; i < spikes; i++) {
        const k = r.int(0, data.length - 1);
        if (data[k] > 0) data[k] += r.range(0.5, 3) * H;
    }
    return { data, stepsX, stepsY, boundsX, boundsY, minX: b.minx, minY: b.miny, maxX: b.maxx, maxY: b.maxy, H };
}

async function checkPaths(name, r, part) {
    const tdef = r.pick(TOOLS);
    const tool = new Tool({ tools: [tdef], controller: { units: 'mm' } }, tdef.id);
    const R = tool.fluteDiameter() / 2;
    const area = Math.max(1e-6, part.polys.reduce((a, p) => a + Math.abs(p.area()), 0));
    // the raster as the contour would size it, kept small enough to check cell by cell
    let res = Math.max(1 / Math.sqrt(r.int(1500, 30000) / area), R / 12, part.size / 400, 0.01);
    res = +res.toFixed(5);
    const g = relief(r, part.polys, res);
    const stepFrac = r.pick([r.log(0.01, 0.1), r.range(0.1, 0.6), r.range(0.6, 1.5), r.log(1.5, 10)]);
    let toolStep = tool.fluteDiameter() * stepFrac;
    // keep the case small enough to check: the number of passes times points along each
    const span = Math.hypot(g.boundsX, g.boundsY) + 4 * R;
    if (span / toolStep * span / res > 4e5) toolStep = span * span / res / 4e5;
    const insideOnly = r() < 0.3;
    const bottom = r() < 0.2 ? r.range(0, g.H * 0.6) : 0;
    const zMin = bottom + 0.0001;
    const leave = r() < 0.2 ? r.range(0, 1) : 0;
    const density = r() < 0.8 ? 1 : r.int(2, 4);
    const pass = r() < 0.35 ? { kind: 'rings' } : { kind: 'lines', angle: r() < 0.2 ? r.pick([0, 45, 90, 135, 179.999, 0.0001, 180]) : r.range(0, 180) };
    const { profile } = tool.generateProfile(res);
    const probe = new Probe({ profile, data: g.data, stepsX: g.stepsX, stepsY: g.stepsY, boundsX: g.boundsX, boundsY: g.boundsY, minX: g.minX, minY: g.minY, zMin });
    const partOff = insideOnly ? 0 : R + res;
    const clipTo = insideOnly ? part.polys.map(p => p.clone(true)) : POLY.expand(part.polys.map(p => p.clone(true)), R + res * 3);
    if (!clipTo.length) return null;
    // tabs across the outline's edge, each a bit wider than drawn, as topo3 makes clipTab
    const tabs = [];
    if (r() < 0.4) for (let i = r.int(1, 4); i > 0; i--) {
        const tx = r.range(g.minX, g.maxX), w = r.range(0.2, 2) * R + res;
        const t = rect(tx - w, g.minY - 2 * R, tx + w, g.minY + r.range(0.1, 0.5) * (g.maxY - g.minY));
        const ct = POLY.expand([t], R);
        const top = bottom + r.range(0.5, 6);
        ct.forEach(c => { c.z = top; tabs.push(c); });
    }
    const tabHeight = tabs.length ? Math.max(...tabs.map(t => t.z)) : 0;
    const box = new THREE.Box2(new THREE.Vector2(g.minX - partOff, g.minY - partOff), new THREE.Vector2(g.maxX + partOff, g.maxY + partOff));
    const run = async () => {
        const topo = new Topo();
        topo.probe = probe;
        const newslices = [];
        await topo.paths2d({ pass, box: box.clone(), clipTo, clipTab: tabs.length ? tabs : null, tabHeight, resolution: res, density, toolStep, leave, newslices }, () => {});
        return newslices.flatMap(s => s.camLines);
    };
    const t0 = performance.now();
    const lines = await run();
    const ms = performance.now() - t0;
    const label = `paths ${name}: ${tdef.name} res ${res} step ${toolStep.toFixed(4)} ${pass.kind}${pass.angle !== undefined ? ' ' + pass.angle.toFixed(3) : ''}${insideOnly ? ' inside' : ''}${density > 1 ? ' density ' + density : ''}${bottom ? ' bottom' : ''}${tabs.length ? ' tabs' : ''}`;
    const errs = [];
    const say = (e) => { if (errs.length < 3) errs.push(e); };
    if (ms > 30000) say(`took ${ms | 0} ms`);
    // the tool's shape: how far below its tip a surface at distance d stops it (0 for a flat end)
    const ball = tool.isBallMill(), taper = tool.hasTaper(), fl = tool.fluteLength();
    const zoff = d => ball ? Math.sqrt(Math.max(0, R * R - d * d)) - R : taper ? -(d / R) * fl : 0;
    const cell = (ix, iy) => (ix < 0 || iy < 0 || ix >= g.stepsX || iy >= g.stepsY) ? zMin : (g.data[ix * g.stepsY + iy] || zMin);
    // the lowest the tip may sit at (x, y): every cell the tool covers there, allowing the raster's
    // own slack (slack sideways, the profile read at the nearest cell corner)
    const need = (x, y, slack) => {
        const rr = R - slack;
        let z = zMin;
        if (rr <= 0) return z;
        const fx = (x - g.minX) / res, fy = (y - g.minY) / res, rc = Math.ceil(rr / res);
        for (let ix = Math.floor(fx) - rc; ix <= Math.ceil(fx) + rc; ix++) for (let iy = Math.floor(fy) - rc; iy <= Math.ceil(fy) + rc; iy++) {
            const d = Math.hypot(g.minX + ix * res - x, g.minY + iy * res - y);
            if (d > rr) continue;
            z = Math.max(z, cell(ix, iy) + zoff(Math.min(R, d + 0.71 * res)));
        }
        return z;
    };
    const tabAt = (x, y, shrink) => {
        let top = -Infinity;
        for (const t of tabs) {
            if (!inside([t], x, y)) continue;
            if (shrink && toEdge([t], x, y) < shrink) continue;
            top = Math.max(top, t.z);
        }
        return top;
    };
    let worstPoint = 0, worstMove = 0, moves = 0, outside = 0;
    const step = res * density;
    let checks = 0;
    for (const line of lines) {
        const pts = line.points;
        if (pts.length < 2) say('a path of one point');
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (![p.x, p.y, p.z].every(Number.isFinite)) { say('NaN'); continue; }
            if (p.z < zMin + leave - 1e-6) say(`under the floor at ${p.x.toFixed(3)},${p.y.toFixed(3)}: ${p.z} < ${zMin + leave}`);
            if (!inside(clipTo, p.x, p.y)) say(`a point off the clip outline at ${p.x.toFixed(3)},${p.y.toFixed(3)}`);
            const tt = tabAt(p.x, p.y, 0);
            if (tt > -Infinity && p.z < tt + leave - 1e-6) say(`into a tab at ${p.x.toFixed(3)},${p.y.toFixed(3)}: ${p.z} < ${tt}`);
            if (checks++ < 6000) {
                const deep = need(p.x, p.y, res) + leave - p.z;
                worstPoint = Math.max(worstPoint, deep);
            }
            if (!i) continue;
            moves++;
            const q = pts[i - 1], len = Math.hypot(p.x - q.x, p.y - q.y), n = Math.min(400, Math.max(1, Math.ceil(len / (res / 2))));
            for (let j = 1; j < n; j++) {
                const f = j / n, x = q.x + (p.x - q.x) * f, y = q.y + (p.y - q.y) * f, z = q.z + (p.z - q.z) * f;
                if (!inside(clipTo, x, y)) {
                    const off = toEdge(clipTo, x, y);
                    if (off > step + 1e-6) say(`a move leaves the clip outline by ${off.toFixed(4)} at ${x.toFixed(3)},${y.toFixed(3)}`);
                    outside++;
                }
                const tt = tabAt(x, y, step);
                // a straight run keeps points within the merge tolerance of it (topo3 paths2d)
                if (tt > -Infinity && z < tt + leave - Math.min(0.02, res / 4) - 1e-6) say(`a move dips into a tab at ${x.toFixed(3)},${y.toFixed(3)}: ${z.toFixed(4)} < ${tt}`);
                if (checks++ < 12000 && (j % 3 === 1)) {
                    // between samples the raster allows one more sample's slack sideways
                    const deep = need(x, y, res + step) + leave - z;
                    worstMove = Math.max(worstMove, deep);
                }
            }
        }
    }
    // the raster cell is the finest the contour sees; anything deeper than a hundredth of a mm
    // over that is the bit going into the part
    if (worstPoint > 0.01) say(`a point is ${worstPoint.toFixed(4)} into the relief`);
    if (worstMove > 0.01 + Math.min(0.02, res / 4)) say(`a move is ${worstMove.toFixed(4)} into the relief`);
    // coverage: inside the outline, well clear of its edge, no spot is further from a path than
    // the stepover allows
    if (!errs.length && lines.length) {
        const segs = [];
        for (const line of lines) for (let i = 1; i < line.points.length; i++) segs.push(line.points[i - 1], line.points[i]);
        const cellSz = Math.max(toolStep, res) * 2, buckets = new Map();
        const key = (x, y) => `${Math.floor(x / cellSz)},${Math.floor(y / cellSz)}`;
        for (let i = 0; i < segs.length; i += 2) {
            const a = segs[i], b = segs[i + 1];
            const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / cellSz));
            const seen = new Set();
            for (let j = 0; j <= n; j++) {
                const k = key(a.x + (b.x - a.x) * j / n, a.y + (b.y - a.y) * j / n);
                if (seen.has(k)) continue;
                seen.add(k);
                if (!buckets.has(k)) buckets.set(k, []);
                buckets.get(k).push(i);
            }
        }
        const reach = pass.kind === 'rings' ? toolStep + 2 * res : toolStep / 2 + 2 * res;
        const margin = toolStep + R + 4 * res;
        const bx = box.min.x, by = box.min.y, bw = box.max.x - bx, bh = box.max.y - by;
        let gaps = 0, tried = 0;
        for (let k = 0; k < 400 && tried < 120; k++) {
            const x = bx + r() * bw, y = by + r() * bh;
            if (!inside(clipTo, x, y) || toEdge(clipTo, x, y) < margin) continue;
            tried++;
            let best = Infinity;
            const cx = Math.floor(x / cellSz), cy = Math.floor(y / cellSz);
            for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iy = cy - 1; iy <= cy + 1; iy++) {
                for (const i of buckets.get(`${ix},${iy}`) || []) best = Math.min(best, segDist(segs[i].x, segs[i].y, segs[i + 1].x, segs[i + 1].y, x, y));
            }
            if (best > reach + 1e-6) { gaps++; if (gaps === 1) say(`a spot ${best === Infinity ? 'far' : best.toFixed(3)} from any path at ${x.toFixed(3)},${y.toFixed(3)} (stepover ${toolStep.toFixed(3)})`); }
        }
    }
    // the same input makes the same paths
    if (r() < 0.1) {
        const again = await run();
        const sig = ls => ls.map(l => l.points.map(p => `${p.x},${p.y},${p.z}`).join(' ')).join('|');
        if (sig(again) !== sig(lines)) say('not the same paths the second time');
    }
    for (const e of errs) fail(`${label}: ${e}`);
    return { lines: lines.length, moves, ms, worstPoint, worstMove };
}

// ---- run --------------------------------------------------------------------------------------
const T0 = performance.now();
let ringsRun = 0, pathsRun = 0, ringLevels = 0, maxRingMs = 0, maxPathMs = 0, worstPoint = 0, worstMove = 0;
for (let c = +(process.env.FROM || 0); c < CASES; c++) {
    const seed = SEED0 * 100003 + c;
    const r = rng(seed);
    const part = randomPart(r);
    const name = `#${c} seed ${seed} ${part.name}`;
    try {
        // rings on the outline: a resolution and stepover from tiny to more than the bit
        const res = +Math.max(part.size / 2000, r.log(0.01, 2)).toFixed(5);
        let step = r.pick([r.log(0.01, 1), r.log(1, 30), r.log(0.001, 0.01)]);
        if (part.size / step > 400) step = part.size / 400;
        const rs = checkRings(name, part.polys, res, step);
        ringsRun++; ringLevels += rs.levels; maxRingMs = Math.max(maxRingMs, rs.ms);
        if (c % 3 === 0) {
            const ps = await checkPaths(name, r, part);
            if (ps) { pathsRun++; maxPathMs = Math.max(maxPathMs, ps.ms); worstPoint = Math.max(worstPoint, ps.worstPoint); worstMove = Math.max(worstMove, ps.worstMove); }
        }
    } catch (e) {
        fail(`${name}: threw ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' / ') : e}`);
    }
    if (c && c % 300 === 0) console.log(`  ${c} cases, ${failures.length} failures, ${((performance.now() - T0) / 1000).toFixed(1)} s`);
}
// the pattern from any saved values: one or two passes, each along X or Y (Kiri's walk) or at an
// angle in (0, 180) that is not 90; cross runs two at right angles; rings take no angle
{
    const r = rng(SEED0);
    const odd = [0, -0, 90, 180, 360, -90, 45.0000001, 1e300, -1e300, NaN, Infinity, -Infinity, '', null, undefined, '30', ' 60 ', 'x', true, false, [], {}, 89.9999999, 1e-9];
    let n = 0;
    for (let i = 0; i < 4000; i++) {
        const op = {
            pattern: r.pick(['lines', 'cross', 'perimeter', undefined, '', 'Lines', 'nonsense', null]),
            lineAngle: r() < 0.5 ? r.pick(odd) : r.range(-720, 720),
            axis: r.pick(['X', 'Y', 'x', 'y', undefined, 'Z', '']),
        };
        let plan;
        try { plan = contourPlan(op); } catch (e) { fail(`contourPlan ${JSON.stringify(op)}: threw ${e}`); continue; }
        n++;
        const okPass = q => q && (q.kind === 'rings' || (q.kind === 'topo' && (q.axis === 'X' || q.axis === 'Y')) || (q.kind === 'lines' && Number.isFinite(q.angle) && q.angle > 0 && q.angle < 180 && Math.abs(q.angle - 90) > 1e-7));
        const want = op.pattern === 'cross' ? 2 : 1;
        if (!(Array.isArray(plan) && plan.length === want && plan.every(okPass))) fail(`contourPlan ${JSON.stringify(op)} gave ${JSON.stringify(plan)}`);
        else if (want === 2) {
            const ang = q => q.kind === 'topo' ? (q.axis === 'X' ? 0 : 90) : q.angle;
            const d = Math.abs(ang(plan[0]) - ang(plan[1]));
            if (Math.abs(d - 90) > 1e-6) fail(`contourPlan cross ${JSON.stringify(op)}: passes ${d} apart`);
        }
        if (op.pattern === 'perimeter' && plan[0].kind !== 'rings') fail('contourPlan: perimeter is not rings');
    }
    console.log(`  contourPlan: ${n} saved patterns`);
}
// a stepover of 0, NaN, under 0 or tinier than the raster still ends
{
    const t0 = performance.now();
    for (const step of [0, NaN, -1, -Infinity, 1e-300]) {
        const paths = new Topo().ringPaths([rect(0, 0, 20, 12)], 0.2, step);
        if (!(paths.length >= 1 && paths.every(p => p.every(q => q.every(Number.isFinite))))) fail(`rings: a stepover of ${step} gives ${paths.length} paths`);
    }
    if (performance.now() - t0 > 5000) fail('rings: an odd stepover takes over 5 s');
    ringsRun += 5;
}
const secs = (performance.now() - T0) / 1000;
console.log(`test-contour-torture: ${ringsRun} ring cases (${ringLevels} levels, slowest ${maxRingMs | 0} ms), ${pathsRun} path cases (slowest ${maxPathMs | 0} ms; deepest point ${worstPoint.toFixed(4)}, move ${worstMove.toFixed(4)} past the raster's slack; ease past a step and a half ${easeStray.toFixed(4)}, off the outline ${easeOff.toFixed(4)}), ${secs.toFixed(1)} s`);
if (failures.length) {
    console.log(`test-contour-torture: ${failures.length} FAILED`);
    process.exit(1);
}
console.log('test-contour-torture: all passed');
process.exit(0);   // the geometry module's wasm loads on its own after; nothing here needs it
