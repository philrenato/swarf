#!/usr/bin/env node
// Cut-out torture, no browser: random and hostile inputs to the auto tab rule and placement, the round
// holes reader, and the 3D face triangulation, each case checked against what it promises:
//   tabRule: every size finite and above zero, a tab never as tall as the board, at least the floor
//            when the board allows it, whatever is typed or saved (0, negative, NaN, huge)
//   planTabs: ends in bounded time; every tab finite, on its loop, its reach out of the material (into
//            the hole for a hole's tab, never back into the part it holds); no two tabs on a loop
//            overlap; every outside piece (a part, an island in a hole, a second piece of one part)
//            gets the rule's count or says it could not (small / skipped); every hole wide enough to
//            leave a loose piece gets a tab or says so; the same input gives the same tabs
//   sliceLoops / silhouetteLoops: an extruded outline slices back to its own loops and area; a
//            shaped part's silhouette covers every point of it
//   roundHoles: plates with random through and blind round holes read back each hole, its size and
//            floor; holeFit's three answers agree with the bit
//   triangulate (src/geo/base.js): a flat polygon at any slant becomes triangles covering exactly its
//            area, each wound as the polygon is
// Run: node tools/test-cutout-torture.mjs [cases per family, default 200] [seed]
import { tabRule, planTabs, sliceLoops, silhouetteLoops, area, inside, holeMinFor } from '../src/kiri/mode/cam/app/autotab-rule.js';
import { roundHoles, holeFit } from '../src/kiri/mode/cam/app/round-holes.js';
globalThis.self = globalThis;
const { THREE } = await import('../src/ext/three.js'); globalThis.THREE = THREE;
const { util } = await import('../src/geo/base.js');

const N = +process.argv[2] || 200;
let seed = +process.argv[3] || 149;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + (b - a) * rnd();
const bad = [];
let cases = 0;
const t0 = Date.now();
const fail = (what, info) => { if (bad.length < 60) console.log('FAIL', what, info !== undefined ? JSON.stringify(info).slice(0, 400) : ''); bad.push(what); };
const IN = 25.4;
const MATERIALS = ['plywood', 'mdf', 'hardwood', 'acrylic', 'hdpe', 'aluminum_6061', 'brass', 'foam', 'wax', 'unknown', undefined];
const DEVICES = ['ShopBot.Basic', 'Langmuir.MR-1', 'Langmuir MR-1', 'Other.Mill', '', undefined];

// ---- tabRule on what the page can hand it ------------------------------------------------------
// the panel's settings come through cl-autotab normal(): sliders any number, pins only numbers above
// zero (a typed field, or a saved file's, rounded to 0.001); the board and the bit are the part's box
// and the outline bit's size, numbers that can be 0 for a part with no thickness or a bit with no size
const PIN = () => pick([undefined, 0.001, 0.5, 3, 12, 40, 1e3, 1e6]);
for (let i = 0; i < N * 4; i++) {
    cases++;
    const o = {
        materialId: pick(MATERIALS), metal: rnd() < 0.2,
        bitMm: pick([0, 0.4, 1.59, 3.175, 6.35, 12.7, 25.4, between(0.1, 30)]),
        thicknessMm: pick([0, 0.05, 0.5, 1, 3.175, 6, 12.7, 19.05, 25.4, 50.8, 100, between(0.05, 120)]),
        deviceName: pick(DEVICES),
        density: pick([0, -2, 2, between(-50, 50)]), scale: pick([0, -2, 2, between(-50, 50)]),
        pin: rnd() < 0.4 ? Object.fromEntries(['width', 'height', 'depth'].map(k => [k, PIN()]).filter(e => e[1] !== undefined)) : {},
    };
    const r = tabRule(o);
    const T = r.thickness, typed = k => o.pin && o.pin[k] > 0;
    if (!['width', 'height', 'depth', 'spacing', 'minTabs', 'bit', 'thickness'].every(k => Number.isFinite(r[k]) && r[k] >= 0) || !(r.spacing > 0 && r.minTabs >= 3 && r.bit > 0 && T > 0))
        fail('tabRule: every size finite, spacing and count above zero', { o, r });
    for (const k of ['width', 'depth']) if (!typed(k) && !(r[k] > 0)) fail(`tabRule: an automatic ${k} is above zero`, { o, r });
    // (a board under 0.2 mm: the 0.01 mm rounding can reach its top)
    if (T >= 0.2 && !(r.height < T)) fail('tabRule: a tab is never as tall as the board', { o, h: r.height, T });
    if (!typed('height') && T * 0.5 >= r.heightFloor && r.height < r.heightFloor - 1e-9) fail('tabRule: at least the floor when the board allows', { o, h: r.height, floor: r.heightFloor });
    if (!typed('height') && T >= 0.1 && !(r.height > 0)) fail('tabRule: an automatic height is above zero on a board', { o, h: r.height, T });
    if (typed('height') && o.pin.height >= 0.01 && T >= 0.1 && !(r.height > 0)) fail('tabRule: a typed height above zero stays above zero', { o, h: r.height, T });
}

// ---- outlines --------------------------------------------------------------------------------
const rect = (x0, y0, w, h) => [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }];
const circle = (cx, cy, r, n = 64) => Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos(i * 2 * Math.PI / n), y: cy + r * Math.sin(i * 2 * Math.PI / n) }));
const rev = l => l.slice().reverse();
const star = (cx, cy, r, n) => Array.from({ length: n }, (_, i) => { const a = i * 2 * Math.PI / n; const rr = r * between(0.3, 1); return { x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) }; });
const spikes = (cx, cy, r, n) => Array.from({ length: 2 * n }, (_, i) => { const a = i * Math.PI / n; const rr = i % 2 ? r : r * 0.15; return { x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) }; });
const comb = (x0, y0, teeth, tw, gap, len) => {
    const pts = [{ x: x0, y: y0 }];
    let x = x0;
    for (let i = 0; i < teeth; i++) { pts.push({ x, y: y0 + 10 }, { x, y: y0 + 10 + len }, { x: x + tw, y: y0 + 10 + len }, { x: x + tw, y: y0 + 10 }); x += tw + gap; }
    pts.push({ x: x - gap, y: y0 }); return pts;
};
// a few points pushed near-coincident and a few collinear points added
const roughen = l => {
    const out = [];
    for (const p of l) { out.push(p); if (rnd() < 0.15) out.push({ x: p.x + between(-1e-6, 1e-6), y: p.y + between(-1e-6, 1e-6) }); }
    return out;
};
const part = () => {
    const k = pick(['rect', 'tiny', 'huge', 'circle', 'star', 'spikes', 'comb', 'slot', 'frame-island', 'plate-holes', 'nested3', 'two-pieces', 'degenerate', 'self-touching', 'L']);
    const ox = between(-1500, 1500), oy = between(-800, 800);
    switch (k) {
        case 'rect': return { k, loops: [rect(ox, oy, between(5, 600), between(5, 400))] };
        case 'tiny': return { k, loops: [circle(ox, oy, between(0.2, 3), 24)] };
        case 'huge': return { k, loops: [rect(ox, oy, 2440, 1220)] };
        case 'circle': return { k, loops: [circle(ox, oy, between(4, 400), pick([8, 24, 96, 360]))] };
        case 'star': return { k, loops: [star(ox, oy, between(10, 300), pick([5, 12, 40, 200]))] };
        case 'spikes': return { k, loops: [spikes(ox, oy, between(20, 200), pick([3, 7, 20]))] };
        case 'comb': return { k, loops: [comb(ox, oy, pick([2, 6, 15]), between(1, 12), between(1, 12), between(5, 80))] };
        case 'slot': return { k, loops: [rect(ox, oy, between(20, 400), between(0.5, 6))] };
        case 'frame-island': { const s = between(60, 400), w = between(5, 40), g = between(4, 30); return { k, loops: [rect(ox, oy, s, s), rev(rect(ox + w, oy + w, s - 2 * w, s - 2 * w)), rect(ox + w + g, oy + w + g, Math.max(1, s - 2 * (w + g)), Math.max(1, s - 2 * (w + g)))] }; }
        case 'plate-holes': {
            const W = between(80, 800), H = between(60, 500), loops = [rect(ox, oy, W, H)];
            for (let i = 0, n = pick([1, 3, 12]); i < n; i++) { const r = between(1, Math.min(W, H) / 6); loops.push(rev(circle(ox + between(r + 2, W - r - 2), oy + between(r + 2, H - r - 2), r, 48))); }
            // drop holes that overlap another
            const keep = [loops[0]];
            for (const h of loops.slice(1)) if (!keep.slice(1).some(o => inside(h[0], o) || inside(o[0], h) || Math.hypot(h[0].x - o[0].x, h[0].y - o[0].y) < 2 * 120)) keep.push(h);
            return { k, loops: keep };
        }
        case 'nested3': { const s = between(150, 500); return { k, loops: [rect(ox, oy, s, s), rev(rect(ox + 10, oy + 10, s - 20, s - 20)), rect(ox + 30, oy + 30, s - 60, s - 60), rev(rect(ox + 50, oy + 50, s - 100, s - 100)), rect(ox + 70, oy + 70, Math.max(2, s - 140), Math.max(2, s - 140))] }; }
        case 'two-pieces': return { k, loops: [rect(ox, oy, between(20, 200), between(20, 200)), circle(ox + 400, oy, between(10, 100))] };
        case 'degenerate': return { k, loops: [[{ x: ox, y: oy }, { x: ox + 50, y: oy }, { x: ox + 100, y: oy }], rect(ox, oy + 50, 100, 60)] };
        case 'self-touching': return { k, loops: [[{ x: ox, y: oy }, { x: ox + 100, y: oy }, { x: ox + 100, y: oy + 100 }, { x: ox + 50, y: oy }, { x: ox, y: oy + 100 }]] };
        case 'L': { const a = between(30, 600), b = between(5, a - 1); return { k, loops: [[{ x: ox, y: oy }, { x: ox + a, y: oy }, { x: ox + a, y: oy + b }, { x: ox + b, y: oy + b }, { x: ox + b, y: oy + a }, { x: ox, y: oy + a }]] }; }
    }
};

const distToLoop = (p, lp) => {
    let d = Infinity;
    for (let i = 0; i < lp.length; i++) {
        const a = lp[i], b = lp[(i + 1) % lp.length], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
        d = Math.min(d, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t));
    }
    return d;
};
const depthOf = (loops, li) => loops.reduce((c, o, oi) => c + (oi !== li && inside(loops[li][0], o) ? 1 : 0), 0);
const solid = (loops, p) => loops.reduce((c, l) => c + (inside(p, l) ? 1 : 0), 0) % 2 === 1;
const box = l => { const xs = l.map(p => p.x), ys = l.map(p => p.y); return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; };

let loosePieces = 0, looseSaid = 0, holeMissed = 0, slowest = 0;
for (let i = 0; i < N * 3; i++) {
    cases++;
    const P = part();
    let loops = P.loops.map(l => rnd() < 0.3 ? roughen(l) : l);
    if (rnd() < 0.3) loops = loops.map(rev);   // either winding
    const rule = tabRule({ materialId: pick(MATERIALS), bitMm: pick([1.59, 3.175, 6.35, 12.7]), thicknessMm: pick([3.175, 6.35, 12.7, 19.05, 25.4]), deviceName: pick(DEVICES), density: pick([-2, 0, 2]), scale: pick([-2, 0, 2]) });
    const opt = rnd() < 0.25 ? pick([{ count: pick([1, 3, 100]) }, { holeCount: pick([1, 5, 100]) }, { holes: false }, { holeMin: pick([1, 500]) }, { corner: pick([0.1, 50, 1e4]) },
        { avoid: () => true }, { avoid: (x) => x > loops[0][0].x }, { fixed: [loops[0][0], loops[0][1 % loops[0].length]] }, { skip: loops.flatMap(l => l.slice(0, 3)) }]) : {};
    const name = `${P.k} #${i}`;
    const s0 = Date.now();
    let plan;
    try { plan = planTabs(loops, rule, opt); } catch (e) { fail(`${name}: planTabs threw ${e.message}`); continue; }
    const ms = Date.now() - s0; slowest = Math.max(slowest, ms);
    if (ms > 4000) fail(`${name}: planTabs in bounded time`, ms);
    const again = planTabs(loops, rule, opt);
    if (JSON.stringify(again) !== JSON.stringify(plan)) fail(`${name}: the same input gives the same tabs`);
    const W0 = rule.width, D = rule.bit, depth = rule.depth;
    for (const t of plan.tabs) {
        if (![t.x, t.y, t.nx, t.ny, t.at, t.of].every(Number.isFinite)) { fail(`${name}: tab finite`, t); break; }
        if (Math.abs(Math.hypot(t.nx, t.ny) - 1) > 1e-6) { fail(`${name}: tab normal is a unit`, t); break; }
        if (distToLoop(t, loops[t.loop]) > 1e-3) { fail(`${name}: tab on its loop`, t); break; }
        // its reach leaves the material it holds: just past the edge is not that piece's material
        const step = 0.05;
        const out = { x: t.x + t.nx * step, y: t.y + t.ny * step }, back = { x: t.x - t.nx * step, y: t.y - t.ny * step };
        const d = depthOf(loops, t.loop);
        if (P.k !== 'self-touching' && Math.abs(area(loops[t.loop])) > 1 && (solid(loops, out) || !solid(loops, back))) { fail(`${name}: tab ${t.hole ? 'in a hole' : 'outside'} reaches out of the material`, { t, d }); break; }
        if (!!t.hole !== (d % 2 === 1)) { fail(`${name}: hole flag matches nesting`, { t, d }); break; }
    }
    // no two tabs on a loop overlap (the tab's length and the bit's reach either side)
    for (const li of new Set(plan.tabs.map(t => t.loop))) {
        const on = plan.tabs.filter(t => t.loop === li).sort((a, b) => a.at - b.at), L = on[0].of;
        for (let k = 0; k < on.length && on.length > 1; k++) {
            const a = on[k], b = on[(k + 1) % on.length], gap = ((b.at - a.at) % L + L) % L || L;
            const w = Math.max(a.w || W0, b.w || W0);
            if (gap < w - 0.02) { fail(`${name}: tabs on loop ${li} overlap`, { gap, w, L }); break; }
        }
    }
    // every outside piece held, every loose piece in a hole held, or the plan says it could not
    const pinnedCount = opt.count > 0;
    loops.forEach((lp, li) => {
        if (Math.abs(area(lp)) < 1e-6) return;   // a loop with no area holds nothing
        const d = depthOf(loops, li), hole = d % 2 === 1, n = plan.tabs.filter(t => t.loop === li).length;
        const said = plan.small || plan.skipped > 0 || opt.avoid || opt.fixed || opt.skip;
        if (!hole) {
            const b = box(lp), minDim = Math.min(b.w, b.h);
            const promised = pinnedCount ? Math.round(opt.count) : minDim < 40 ? 2 : 3;
            if (n === 0) { loosePieces++; if (said) looseSaid++; else fail(`${name}: outside loop ${li} (${P.k}) gets tabs or the plan says why`, { minDim, plan: { small: plan.small, skipped: plan.skipped } }); }
            else if (n < Math.min(promised, 2) && !said) fail(`${name}: outside loop ${li} gets at least 2 tabs`, { n });
        } else if (opt.holes !== false) {
            const b = box(lp), across = Math.min(b.w, b.h), holeMin = opt.holeMin > 0 ? opt.holeMin : holeMinFor(rule.bit);
            if (across >= holeMin && n === 0 && !said) { holeMissed++; fail(`${name}: hole ${li} (${across.toFixed(1)} across) leaves a loose piece and gets a tab, or says why`); }
            if (across < holeMin && n > 0) fail(`${name}: a hole narrower than holeMin gets no tab (its piece is a sliver)`, { across, holeMin, n });
        }
    });
}

// ---- slicing an extrusion, and a shaped part's silhouette -------------------------------------
function extrude(loops, T) {
    const out = [];
    for (const lp of loops) {
        const ccw = area(lp) > 0;
        for (let i = 0; i < lp.length; i++) {
            const a = lp[i], b = lp[(i + 1) % lp.length];
            out.push(a.x, a.y, 0, b.x, b.y, 0, b.x, b.y, T, a.x, a.y, 0, b.x, b.y, T, a.x, a.y, T);
        }
        void ccw;
    }
    return new Float32Array(out);
}
for (let i = 0; i < N; i++) {
    cases++;
    let P = part();
    if (['degenerate', 'self-touching', 'tiny'].includes(P.k)) continue;
    const T = pick([3, 12.7, 19.05]);
    const got = sliceLoops(extrude(P.loops, T), between(0.1, T - 0.1));
    const want = P.loops.reduce((s, l) => s + Math.abs(area(l)), 0), have = got.reduce((s, l) => s + Math.abs(area(l)), 0);
    if (got.length !== P.loops.length || Math.abs(want - have) > 1e-3 * want + 0.05) fail(`slice ${P.k} #${i}: loops come back whole`, { loops: [got.length, P.loops.length], area: [have, want] });
}
// a relief (dome on a plate): its silhouette is the plate; every vertex lies within a cell of a loop or inside it
function relief(w, h, nx, ny, f, x0 = 0, y0 = 0) {
    const T = [], X = i => x0 + i * w / nx, Y = j => y0 + j * h / ny, Z = (i, j) => f(i / nx, j / ny);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const a = [X(i), Y(j), Z(i, j)], b = [X(i + 1), Y(j), Z(i + 1, j)], c = [X(i + 1), Y(j + 1), Z(i + 1, j + 1)], d = [X(i), Y(j + 1), Z(i, j + 1)];
        T.push(...a, ...b, ...c, ...a, ...c, ...d, X(i), Y(j), 0, X(i + 1), Y(j + 1), 0, X(i + 1), Y(j), 0, X(i), Y(j), 0, X(i), Y(j + 1), 0, X(i + 1), Y(j + 1), 0);
    }
    return new Float32Array(T);
}
for (let i = 0; i < N / 4; i++) {
    cases++;
    const w = between(2, 900), h = between(2, 600), x0 = between(-500, 500), y0 = between(-500, 500);
    const pos = relief(w, h, pick([2, 10, 40]), pick([2, 10, 40]), (u, v) => 1 + 5 * Math.sin(u * 3) * Math.sin(v * 3) ** 2, x0, y0);
    const s0 = Date.now();
    const sil = silhouetteLoops(pos);
    const ms = Date.now() - s0;
    if (ms > 5000) fail(`silhouette #${i}: bounded time`, ms);
    const res = Math.max(0.2, Math.sqrt(w * h / 1.5e6));
    if (!sil.length) { fail(`silhouette #${i}: a ${w.toFixed(1)} x ${h.toFixed(1)} part has an outline`); continue; }
    const a = sil.reduce((s, l) => s + area(l), 0);
    if (Math.abs(Math.abs(a) - w * h) > 0.05 * w * h + 8 * res * (w + h)) fail(`silhouette #${i}: area near the part's`, { a, wh: w * h });
    for (let k = 0; k < pos.length; k += 9 * 7) {
        const p = { x: pos[k], y: pos[k + 1] };
        if (!sil.some(l => inside(p, l)) && Math.min(...sil.map(l => distToLoop(p, l))) > 2.5 * res) { fail(`silhouette #${i}: covers every point of the part`, { p, res }); break; }
    }
}

// ---- round holes: plates with random through and blind holes ----------------------------------
const quad = (s, a, b, z0, z1) => s.push(a[0], a[1], z0, b[0], b[1], z0, b[0], b[1], z1, a[0], a[1], z0, b[0], b[1], z1, a[0], a[1], z1);
for (let i = 0; i < N / 2; i++) {
    cases++;
    const s = [], W = between(60, 400), H = between(60, 300), T = pick([6, 12.7, 19.05]);
    const P = [[0, 0], [W, 0], [W, H], [0, H]];
    for (let k = 0; k < 4; k++) quad(s, P[k], P[(k + 1) % 4], 0, T);
    // the top and the bottom as small flats at the corner (a face over a hole would close it)
    s.push(1, 1, T, 2, 1, T, 1, 2, T, 1, 1, 0, 1, 2, 0, 2, 1, 0);
    const holes = [];
    for (let k = 0, n = pick([1, 2, 5]); k < n; k++) {
        const r = between(0.5, 12), cx = between(r + 3, W - r - 3), cy = between(r + 3, H - r - 3), n2 = pick([8, 16, 32, 64]);
        if (holes.some(h => Math.hypot(h.x - cx, h.y - cy) < h.r + r + 3)) continue;
        const floor = rnd() < 0.5 ? null : +between(0.5, T - 0.5).toFixed(2);
        const C = Array.from({ length: n2 }, (_, j) => [cx + r * Math.cos(j / n2 * 2 * Math.PI), cy + r * Math.sin(j / n2 * 2 * Math.PI)]);
        for (let j = 0; j < n2; j++) {
            quad(s, C[(j + 1) % n2], C[j], floor ?? 0, T);
            if (floor != null) s.push(cx, cy, floor, C[j][0], C[j][1], floor, C[(j + 1) % n2][0], C[(j + 1) % n2][1], floor);
        }
        holes.push({ x: cx, y: cy, r, floor, n: n2 });
    }
    let got;
    try { got = roundHoles(new Float32Array(s)).holes; } catch (e) { fail(`holes #${i}: roundHoles threw ${e.message}`); continue; }
    for (const h of holes) {
        const g = got.find(q => Math.hypot(q.x - h.x, q.y - h.y) < 0.2 * h.r + 0.05);
        if (!g) { fail(`holes #${i}: a ${(2 * h.r).toFixed(2)} mm hole (${h.n} sides) is found`, h); continue; }
        // a polygon's across reads between its inscribed and its circumscribed circle
        if (g.d > 2 * h.r + 1e-3 || g.d < 2 * h.r * Math.cos(Math.PI / h.n) - 1e-3) fail(`holes #${i}: its size`, { want: 2 * h.r, got: g.d });
        if ((h.floor === null) !== (g.floor === null) || (h.floor !== null && Math.abs(g.floor - h.floor) > 0.01)) fail(`holes #${i}: through or its floor`, { want: h.floor, got: g.floor });
    }
    if (got.length > holes.length) fail(`holes #${i}: nothing else read as a hole`, { got: got.length, made: holes.length });
}
for (let i = 0; i < N; i++) {
    cases++;
    const bit = between(0.5, 26), d = between(0.1, 30), f = holeFit(d, bit);
    const want = d > bit + 0.1 ? 'bigger' : d < bit - Math.max(0.4, 0.06 * bit) ? 'smaller' : 'fits';
    if (f !== want) fail('holeFit', { d, bit, f });
    if (f === 'fits' && (d > bit + 0.1 || d < bit * 0.94 - 0.4)) fail('holeFit: a hole drilled to the bit is near the bit', { d, bit });
}

// ---- triangulate: a flat polygon at any slant -----------------------------------------------
for (let i = 0; i < N; i++) {
    cases++;
    const n = pick([3, 4, 7, 30]);
    const flat = pick([() => star(0, 0, between(1, 100), n), () => rect(0, 0, between(0.01, 100), between(0.01, 100)), () => comb(0, 0, 3, 2, 2, 10)])();
    const a2 = area(flat);
    // tilt: a random rotation
    const ax = between(0, Math.PI * 2), ay = between(0, Math.PI * 2), cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay);
    const pts = flat.map(p => { const y = p.y * cx, z = p.y * sx; return [p.x * cy + z * sy, y, -p.x * sy + z * cy]; });
    const arr = pts.flat();
    let tri;
    try { tri = util.triangulate(arr, undefined, 3, true); } catch (e) { fail(`triangulate #${i} threw ${e.message}`); continue; }
    if (!tri.every(Number.isInteger) || tri.length % 3) { fail(`triangulate #${i}: whole triangles`, tri.length); continue; }
    let sum = 0, normal = [0, 0, 0];
    for (let k = 0; k < pts.length; k++) { const a = pts[k], b = pts[(k + 1) % pts.length]; normal[0] += (a[1] - b[1]) * (a[2] + b[2]); normal[1] += (a[2] - b[2]) * (a[0] + b[0]); normal[2] += (a[0] - b[0]) * (a[1] + b[1]); }
    for (let k = 0; k < tri.length; k += 3) {
        const [A, B, C] = [pts[tri[k]], pts[tri[k + 1]], pts[tri[k + 2]]];
        const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
        const c = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const dot = c[0] * normal[0] + c[1] * normal[1] + c[2] * normal[2];
        if (dot < -1e-9) { fail(`triangulate #${i}: each triangle winds as the polygon`); break; }
        sum += Math.hypot(...c) / 2;
    }
    if (Math.abs(sum - Math.abs(a2)) > 1e-4 * Math.abs(a2) + 1e-6) fail(`triangulate #${i}: covers the polygon's area exactly`, { sum, a: Math.abs(a2), n });
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`cases ${cases} in ${secs} s; slowest plan ${slowest} ms; outside pieces left with no tab: ${loosePieces} (all said: ${loosePieces === looseSaid})`);
console.log(bad.length ? `cut-out torture: ${bad.length} FAIL` : 'cut-out torture: ok');
process.exit(bad.length ? 1 : 0);
