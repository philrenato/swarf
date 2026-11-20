// node tools/test-contour-paths.mjs — the contour's 2D paths (topo3.js paths2d, ringPaths) on a
// surface given as a function, with no browser:
//   rings: every ring of every level is cut once, whole; the ease from a ring to the one inside lies
//          between the two and ends where the next ring starts; the paths come in cutting order, each
//          run of rings from its outermost in, the uncut surface on the bit's right (climb: clockwise
//          round an outline, counterclockwise round a hole); nothing is NaN; odd outlines (a hole,
//          a neck that splits, a sharp corner, a part smaller than the bit) end, and so does a stepover of 0 (the contour itself refuses one)
//   lines: every point and every move between two points stays inside the clip outline (a join from
//          one line to the next never crosses a hole or a notch), never under the surface or the
//          floor, and rides a tab at its top; lines along a slanted edge join instead of ending
import assert from 'node:assert/strict';
globalThis.self = globalThis;
const { THREE } = await import('../src/ext/three.js'); globalThis.THREE = THREE;
await import('../src/add/array.js'); await import('../src/add/three.js');
await import('../src/kiri/mode/cam/core/ops.js');   // as the app loads it: the op list first
const { Topo } = await import('../src/kiri/mode/cam/work/topo3.js');
const { newPolygon } = await import('../src/geo/polygon.js');
const { newPoint } = await import('../src/geo/point.js');
const { polygons: POLY } = await import('../src/geo/polygons.js');
const ok = what => console.log('ok  ', what);

const poly = pts => { const p = newPolygon(); for (const [x, y] of pts) p.add(x, y, 0); return p; };
const rect = (x0, y0, x1, y1) => poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
const circle = (cx, cy, r, n = 64) => poly(Array.from({ length: n }, (_, i) => [cx + r * Math.cos(i / n * 2 * Math.PI), cy + r * Math.sin(i / n * 2 * Math.PI)]));
const holed = (outer, ...holes) => { outer.inner = holes; return outer; };
const at = newPoint(0, 0, 0);
const inside = (polys, x, y) => { at.x = x; at.y = y; return polys.some(p => at.isInPolygon(p)); };
const toLoop = (pts, x, y) => {
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
        const ux = bx - ax, uy = by - ay, uu = ux * ux + uy * uy;
        const t = uu > 0 ? Math.max(0, Math.min(1, ((x - ax) * ux + (y - ay) * uy) / uu)) : 0;
        best = Math.min(best, Math.hypot(ax + ux * t - x, ay + uy * t - y));
    }
    return best;
};

// ---- rings ----------------------------------------------------------------------------------
// the levels as ringPaths makes them, to compare against
function levelsOf(clip, resolution, step) {
    const levels = [];
    let ring = POLY.expand(clip, -resolution);
    for (let n = 0; ring && ring.length && n < 10000; n++) {
        const level = POLY.flatten(ring.map(r => r.clone(true))).map(p => p.points.map(q => [q.x, q.y])).filter(p => p.length > 2);
        level.region = ring;
        levels.push(level);
        ring = POLY.expand(ring, -step);
    }
    return levels;
}
function ringCase(name, clip, resolution, step, { eases = true } = {}) {
    const topo = new Topo();
    const paths = topo.ringPaths(clip, resolution, step);
    const levels = levelsOf(clip, resolution, step), loops = levels.flatMap((l, n) => l.map(pts => ({ pts, n, used: 0 })));
    assert.equal(paths.length, loops.length, `${name}: one path for each ring (${paths.length} paths, ${loops.length} rings)`);
    assert.ok(paths.every(p => p.every(q => q.every(Number.isFinite))), `${name}: no NaN`);
    let eased = 0, runs = 0, landed = null;
    paths.forEach((path, k) => {
        // the ring itself: closed, every point on one ring, all the way round before any ease
        const closeAt = path.findIndex((p, i) => i > 2 && Math.hypot(p[0] - path[0][0], p[1] - path[0][1]) < 1e-9);
        const loop = loops.find(l => !l.used && closeAt >= l.pts.length && path.slice(0, closeAt + 1).every(([x, y]) => toLoop(l.pts, x, y) < 1e-6)
            && l.pts.every(([x, y]) => path.slice(0, closeAt + 1).some(q => Math.hypot(q[0] - x, q[1] - y) < 1e-6)));
        assert.ok(loop, `${name}: path ${k} is one whole ring, not cut before (closes at ${closeAt})`);
        loop.used++;
        // climb: the surface still to cut (inside this level's rings) is on the right of the way it runs
        {
            let best = 0, m = null;
            for (let i = 1; i <= closeAt; i++) {
                const [x0, y0] = path[i - 1], [x1, y1] = path[i], len = Math.hypot(x1 - x0, y1 - y0);
                if (len > best) { best = len; m = [(x0 + x1) / 2, (y0 + y1) / 2, (y1 - y0) / len, -(x1 - x0) / len]; }
            }
            const region = levels[loop.n].region, e = 0.02;
            assert.ok(inside(region, m[0] + m[2] * e, m[1] + m[3] * e) && !inside(region, m[0] - m[2] * e, m[1] - m[3] * e), `${name}: path ${k} runs with the uncut surface on its right (climb)`);
        }
        // cutting order: a ring starts where the ring before eased to, one level in; a ring nothing
        // eased to starts a run of its own
        if (landed) {
            assert.ok(Math.hypot(path[0][0] - landed.x, path[0][1] - landed.y) < 1e-6, `${name}: path ${k} starts where path ${k - 1}'s ease ends`);
            assert.equal(loop.n, landed.n + 1, `${name}: path ${k} is one level in from path ${k - 1}`);
        } else runs++;
        landed = null;
        const tail = path.slice(closeAt + 1);
        if (!tail.length) return;
        eased++;
        // the ease: never further than a step and a half from its ring, inside the outline, ending on
        // a ring of the next level
        for (const [x, y] of tail) {
            assert.ok(toLoop(loop.pts, x, y) <= step * 1.6 + 1e-6, `${name}: path ${k}'s ease stays within a step and a half of its ring (${toLoop(loop.pts, x, y).toFixed(3)})`);
            assert.ok(inside(clip, x, y), `${name}: path ${k}'s ease stays inside the outline`);
        }
        const [ex, ey] = tail[tail.length - 1];
        assert.ok((levels[loop.n + 1] || []).some(l => toLoop(l, ex, ey) < 1e-6), `${name}: path ${k}'s ease ends on a ring of the next level`);
        landed = { x: ex, y: ey, n: loop.n };
    });
    assert.ok(!landed, `${name}: the last ring eases nowhere`);
    assert.ok(loops.every(l => l.used === 1), `${name}: every ring cut once`);
    if (paths.length) assert.equal(loops.find(l => l.pts.every(([x, y]) => toLoop(paths[0], x, y) < 1e-6)).n, 0, `${name}: the first ring cut is an outermost one`);
    if (eases && levels.length > 2) assert.ok(eased >= Math.floor(levels.length / 2), `${name}: most rings ease into the next (${eased} of ${loops.length})`);
    ok(`${name}: ${loops.length} rings on ${levels.length} levels, ${eased} eased, ${runs} run${runs === 1 ? '' : 's'}`);
    return paths;
}
ringCase('rectangle', [rect(0, 0, 100, 60)], 0.2, 2);
ringCase('rectangle wound the other way', [poly([[0, 0], [0, 60], [100, 60], [100, 0]])], 0.2, 2);
ringCase('circle', [circle(0, 0, 40)], 0.2, 2.2);
ringCase('ring (a hole)', [holed(circle(0, 0, 40), circle(0, 0, 20))], 0.2, 2.2);
ringCase('plate with two holes', [holed(rect(0, 0, 120, 80), circle(30, 40, 8), rect(70, 20, 100, 60))], 0.2, 2.2);
ringCase('sharp triangle', [poly([[0, 0], [100, 0], [50, 12]])], 0.2, 1, { eases: false });
ringCase('two lobes on a neck', [poly([[0, 0], [40, 0], [40, 17], [60, 17], [60, 0], [100, 0], [100, 40], [60, 40], [60, 23], [40, 23], [40, 40], [0, 40]])], 0.2, 2.2);
ringCase('two parts', [rect(0, 0, 40, 30), rect(50, 0, 90, 30)], 0.2, 2.2);
ringCase('a part one ring wide', [rect(0, 0, 3, 3)], 0.2, 2.2, { eases: false });
ringCase('a part smaller than a ring', [rect(0, 0, 0.3, 0.3)], 0.2, 2.2, { eases: false });
ringCase('a long thin part', [rect(0, 0, 200, 1.5)], 0.2, 1, { eases: false });
ringCase('a fine stepover', [rect(0, 0, 20, 12)], 0.1, 0.05);
{
    // a stepover of 0 (a file saved with one) ends, with the outline's own ring at least
    const t0 = Date.now();
    for (const step of [0, NaN, -1]) {
        const paths = new Topo().ringPaths([rect(0, 0, 20, 12)], 0.2, step);
        assert.ok(paths.length >= 1 && paths.length < 1000 && paths.every(p => p.every(q => q.every(Number.isFinite))), `a stepover of ${step} still ends (${paths.length} rings)`);
    }
    assert.ok(Date.now() - t0 < 5000, 'and soon');
    ok('a stepover of 0, NaN or under 0 ends');
}

// ---- lines ----------------------------------------------------------------------------------
// a surface z = f(x, y) over a box, sampled as the raster would be; floor is the lowest the bit goes
function lineCase(name, { clip, tabs = [], f, floor = 0, w = 100, h = 60, resolution = 0.25, step = 2, pass, tabHeight = 3 }) {
    const topo = new Topo();
    const stepsX = Math.ceil(w / resolution), stepsY = Math.ceil(h / resolution);
    topo.probe = {
        toolAtZ: (ix, iy) => (ix < 0 || iy < 0 || ix >= stepsX || iy >= stepsY) ? floor : Math.max(floor, f(ix * resolution, iy * resolution)),
        params: { stepsX, stepsY, boundsX: w, boundsY: h, minX: 0, minY: 0 },
    };
    const clipTab = tabs.map(([x0, y0, x1, y1, z]) => { const t = rect(x0, y0, x1, y1); t.z = z; return t; });
    const newslices = [];
    const box = new THREE.Box2(new THREE.Vector2(-4, -4), new THREE.Vector2(w + 4, h + 4));
    return topo.paths2d({ pass, box, clipTo: clip, clipTab: clipTab.length ? clipTab : null, tabHeight, resolution, density: 1, toolStep: step, leave: 0, newslices }, () => {}).then(() => {
        const lines = newslices.flatMap(s => s.camLines);
        assert.ok(lines.length > 0, `${name}: there are paths`);
        let moves = 0;
        for (const line of lines) {
            const pts = line.points;
            assert.ok(pts.length > 1, `${name}: no path of one point`);
            for (let i = 0; i < pts.length; i++) {
                const p = pts[i];
                assert.ok([p.x, p.y, p.z].every(Number.isFinite), `${name}: no NaN`);
                assert.ok(p.z >= floor - 1e-9, `${name}: never under the floor (${p.z})`);
                assert.ok(p.z >= f(p.x, p.y) - 1e-6 || !(p.x >= 0 && p.y >= 0 && p.x <= w && p.y <= h), `${name}: never under the surface at ${p.x.toFixed(2)}, ${p.y.toFixed(2)} (${p.z} < ${f(p.x, p.y)})`);
                for (const t of clipTab) if (inside([t], p.x, p.y)) assert.ok(p.z >= t.z - 1e-9, `${name}: rides the tab at its top (${p.z} < ${t.z})`);
                if (!i) continue;
                // the move from the point before: inside the outline, and over every tab, all the way
                const q = pts[i - 1], len = Math.hypot(p.x - q.x, p.y - q.y), n = Math.max(1, Math.ceil(len / (resolution / 2)));
                moves++;
                for (let j = 0; j <= n; j++) {
                    const x = q.x + (p.x - q.x) * j / n, y = q.y + (p.y - q.y) * j / n, z = q.z + (p.z - q.z) * j / n;
                    assert.ok(inside(clip, x, y), `${name}: a move leaves the outline at ${x.toFixed(2)}, ${y.toFixed(2)}`);
                    for (const t of clipTab) if (inside([rect(t.points[0].x + resolution, t.points[0].y + resolution, t.points[2].x - resolution, t.points[2].y - resolution)], x, y))
                        assert.ok(z >= t.z - 1e-6, `${name}: a move dips into a tab at ${x.toFixed(2)}, ${y.toFixed(2)} (${z.toFixed(3)} < ${t.z})`);
                }
            }
        }
        return { lines, moves };
    });
}
const flat = () => 10;
const wavy = (x, y) => 8 + 4 * Math.sin(x / 7) * Math.cos(y / 9);
{
    // a diamond: every line ends on a slanted edge, so the lines join into a few long paths
    const diamond = [poly([[50, 0], [100, 30], [50, 60], [0, 30]])];
    const sq = await lineCase('diamond, lines at 0', { clip: diamond, f: wavy, pass: { kind: 'lines', angle: 0.001 } });
    assert.ok(sq.lines.length <= 4, `diamond: lines along a slanted edge join (${sq.lines.length} paths)`);
    ok(`diamond: ${sq.lines.length} path${sq.lines.length === 1 ? '' : 's'}, ${sq.moves} moves, all inside, on the surface`);
    for (const angle of [30, 45, 120, 179]) {
        const r = await lineCase(`diamond, lines at ${angle}`, { clip: diamond, f: wavy, pass: { kind: 'lines', angle } });
        ok(`diamond at ${angle}: ${r.lines.length} paths`);
    }
}
{
    // a plate with a hole and a notch: a join never crosses either
    const plate = [holed(poly([[0, 0], [100, 0], [100, 25], [92, 25], [92, 35], [100, 35], [100, 60], [0, 60]]), rect(30, 20, 60, 40))];
    for (const angle of [10, 45, 80, 135]) {
        const r = await lineCase(`holed plate at ${angle}`, { clip: plate, f: flat, pass: { kind: 'lines', angle } });
        ok(`plate with a hole and a notch at ${angle}: ${r.lines.length} paths, every move inside`);
    }
    const r = await lineCase('holed plate rings', { clip: plate, f: wavy, pass: { kind: 'rings' } });
    ok(`plate with a hole and a notch, rings: ${r.lines.length} paths, every move inside`);
}
{
    // tabs at the edge of a part cut to its floor all round: lines and their joins ride over them
    const part = (x, y) => (x > 10 && x < 90 && y > 10 && y < 50) ? 12 : 0;
    const clip = [rect(4, 4, 96, 56)];
    const tabs = [[0, 26, 14, 34, 3], [86, 26, 100, 34, 3], [46, 0, 54, 14, 3], [46, 46, 54, 60, 3]];
    for (const pass of [{ kind: 'lines', angle: 45 }, { kind: 'lines', angle: 100 }, { kind: 'rings' }]) {
        const r = await lineCase(`tabs, ${pass.kind} ${pass.angle ?? ''}`, { clip, tabs, f: part, pass });
        ok(`tabs, ${pass.kind}${pass.angle ? ' at ' + pass.angle : ''}: ${r.lines.length} paths, no point or move under a tab's top`);
    }
}
console.log('test-contour-paths: all passed');
process.exit(0);   // the geometry module's wasm loads on its own after; nothing here needs it
