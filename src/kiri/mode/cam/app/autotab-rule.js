/**
 * swarf auto tabs: the rule and the placement. Pure (no imports, no DOM, no THREE), so
 * tools/test-autotabs.mjs runs this exact file in node. cl-autotab.js is the glue that reads
 * the part, the material, the bit and the machine and turns the plan into ordinary tab records.
 *
 * A tab is a short length of the outline the bit does not cut to the bottom: a bridge of board,
 * `height` tall and `width` long, that holds the part until the cut ends.
 *
 * The rule (all lengths mm; T = board thickness = the part's Z size, D = the outline bit's diameter):
 *
 *   height = T x hFrac, at least the floor, at most hMax and never more than half the board
 *            floor = the larger of the material's and the machine's (a router's spoilboard is
 *            not flat to a tenth over a sheet, so a ShopBot tab stays at least 2.5 mm; the MR-1
 *            cuts on a machined plate, 1 mm is still a tab there)
 *   width  = D x wPerD, between wMin and wMax (the bit's round end eats into each end of a tab,
 *            so a tab narrower than about a bit diameter is barely there)
 *   spacing= the material's spacing x sqrt(T / tRef), held to 0.6..1.25 of it: thin sheet flaps
 *            and wants tabs closer, a thick part is stiff and each tab holds more
 *   count  = outline length / spacing, rounded, at least the machine's minimum (4 on the
 *            ShopBot, 3 on the MR-1; 3 on a part under 100 mm, 2 under 40 mm), and at least 4 on
 *            a part with 4 or more straight sides (one a side, so no side is left to lift; 3 at
 *            "fewer"), at most what fits with a gap of two tab footprints between tabs
 *   holes  = a hole that leaves a loose piece when the outline cuts it gets tabs too (half as
 *            many, at least 2, or 1 where two do not fit): anything cut free can catch the bit
 *            and fly (Phil 10-29: "anything that could fly off the machine"). The bit takes its
 *            own width from each side, so a hole narrower than 2 bits + 3 mm leaves only a
 *            sliver and gets none (holeMin, below). On a tight hole a tab is shorter, at most
 *            an eighth of the way round and never under the bit.
 *
 *   material   hFrac  floor  hMax   wPerD  wMin  wMax  spacing  tRef
 *   wood       0.25   2.0    6      2.0    6     25    250      19.05   plywood mdf hardwood osb hardboard
 *   plastic    0.25   1.5    4      2.0    5     20    200      6.35    acrylic polycarbonate hdpe
 *   metal      0.10   1.0    3      1.0    3     8     200      12.7    aluminum brass steel
 *   soft       0.35   3.0    10     3.0    8     30    150      25.4    foam wax
 *
 * Two sliders move it: density (fewer .. more) multiplies the count by 2^(d/2), d = -2..2, so
 * half to twice as many; scale (smaller .. larger) multiplies width and height by 2^(s/3), about
 * 0.63 to 1.59 (the floors and the half-board cap still hold).
 *
 * Every number can also be pinned (o.pin in tabRule, opt in planTabs): a pinned value is used as
 * typed and the sliders leave it alone; an unpinned one stays automatic. A pinned height still
 * stays under the board's thickness (a tab as tall as the board is no cut at all).
 */

export const CLASSES = {
    wood:    { name: 'wood',    hFrac: 0.25, hFloor: 2.0, hMax: 6,  wPerD: 2.0, wMin: 6, wMax: 25, spacing: 250, tRef: 19.05 },
    plastic: { name: 'plastic', hFrac: 0.25, hFloor: 1.5, hMax: 4,  wPerD: 2.0, wMin: 5, wMax: 20, spacing: 200, tRef: 6.35 },
    metal:   { name: 'metal',   hFrac: 0.10, hFloor: 1.0, hMax: 3,  wPerD: 1.0, wMin: 3, wMax: 8,  spacing: 200, tRef: 12.7 },
    soft:    { name: 'soft',    hFrac: 0.35, hFloor: 3.0, hMax: 10, wPerD: 3.0, wMin: 8, wMax: 30, spacing: 150, tRef: 25.4 },
};

const BY_ID = {
    plywood: 'wood', mdf: 'wood', hardwood: 'wood', osb: 'wood', hardboard: 'wood',
    acrylic: 'plastic', polycarbonate: 'plastic', hdpe: 'plastic',
    aluminum_6061: 'metal', brass: 'metal', mild_steel: 'metal',
    foam: 'soft', wax: 'soft',
};

export const MACHINES = {
    router: { name: 'router', hFloor: 2.5, minTabs: 4 },  // ShopBot: a gantry router on a spoilboard
    mill:   { name: 'mill',   hFloor: 1.0, minTabs: 3 },  // MR-1: a rigid mill on a machined plate
    other:  { name: 'machine', hFloor: 1.5, minTabs: 3 },
};

export const HOLE_MIN = 75;      // the old threshold (before 10-29): a hole this wide or more got tabs
// a hole this wide (its narrower side) or more leaves a loose piece more than 3 mm across
export const holeMinFor = bitMm => Math.round((2 * (bitMm > 0 ? bitMm : 6.35) + 3) * 100) / 100;
const CORNER_DEG = 25;           // a turn sharper than this is a corner a tab keeps away from
const BEND_DEG = 20;             // the most an edge may turn under one tab: a straight-ish run

export function materialClass(id, metal) {
    if (BY_ID[id]) return BY_ID[id];
    if (metal) return 'metal';
    return 'wood';
}

export function machineKind(deviceName) {
    const n = String(deviceName || '').toLowerCase();
    if (n.includes('shopbot')) return 'router';
    if (n.includes('mr-1') || n.includes('mr1') || n.includes('langmuir')) return 'mill';
    return 'other';
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * The tab size and spacing for one part.
 * @param {Object} o { materialId, metal, bitMm, thicknessMm, deviceName, density (-2..2), scale (-2..2) }
 */
export function tabRule(o = {}) {
    const cls = CLASSES[materialClass(o.materialId, o.metal)];
    const mach = MACHINES[machineKind(o.deviceName)];
    const D = o.bitMm > 0 ? o.bitMm : 6.35;
    const T = o.thicknessMm > 0 ? o.thicknessMm : cls.tRef;
    const dens = clamp(Math.round((o.density || 0) * 2) / 2, -2, 2);
    const scl = clamp(Math.round((o.scale || 0) * 2) / 2, -2, 2);
    const sm = Math.pow(2, scl / 3);
    const dm = Math.pow(2, dens / 2);
    const floor = Math.max(cls.hFloor, mach.hFloor);
    let height = Math.max(floor, cls.hFrac * T * sm);
    height = Math.min(height, cls.hMax * Math.max(1, sm), T * 0.5);
    let width = clamp(D * cls.wPerD * sm, cls.wMin * Math.min(1, sm), cls.wMax * Math.max(1, sm));
    let depth = Math.max(D, 3);
    const spacing = cls.spacing * clamp(Math.sqrt(T / cls.tRef), 0.6, 1.25) / dm;
    const minTabs = Math.max(3, mach.minTabs - (dens < 0 ? 1 : 0));
    const auto = { width: r2(width), height: r2(height), depth: r2(depth) };
    const pin = o.pin || {};
    const pinned = {};
    let capped = false;
    if (pin.width > 0) { width = pin.width; pinned.width = true; }
    if (pin.depth > 0) { depth = pin.depth; pinned.depth = true; }
    if (pin.height > 0) {
        height = Math.min(pin.height, T * 0.9);
        capped = height < pin.height;
        pinned.height = true;
    }
    return {
        material: cls.name, machine: mach.name,
        bit: D, thickness: T,
        width: r2(width), height: r2(height), depth: r2(depth),
        spacing: Math.round(spacing), minTabs, density: dens, scale: scl, densityMult: dm, scaleMult: sm,
        heightFloor: floor, auto, pinned, capped,
    };
}

const r2 = v => Math.round(v * 100) / 100;

/**
 * Slice a triangle soup (flat xyz array, 9 numbers a triangle) at height z: closed loops of {x,y}.
 * Endpoints are chained through the mesh edge each one lies on, so it needs no tolerance.
 */
export function sliceLoops(pos, z) {
    const key = (i) => `${pos[i]},${pos[i + 1]},${pos[i + 2]}`;
    // nudge off any vertex height so no point lies on the plane
    for (let i = 2; i < pos.length; i += 3) if (Math.abs(pos[i] - z) < 1e-7) { z += 1e-5; i = 2; }
    const adj = new Map();   // edge key -> [segment ids]
    const segs = [];
    for (let t = 0; t + 8 < pos.length; t += 9) {
        const v = [t, t + 3, t + 6];
        const hits = [];
        for (let e = 0; e < 3; e++) {
            const a = v[e], b = v[(e + 1) % 3];
            const za = pos[a + 2], zb = pos[b + 2];
            if ((za < z) === (zb < z)) continue;
            const f = (z - za) / (zb - za);
            const ka = key(a), kb = key(b);
            hits.push({ x: pos[a] + (pos[b] - pos[a]) * f, y: pos[a + 1] + (pos[b + 1] - pos[a + 1]) * f, k: ka < kb ? ka + '|' + kb : kb + '|' + ka });
        }
        if (hits.length !== 2) continue;
        const id = segs.length;
        segs.push(hits);
        for (const h of hits) {
            if (!adj.has(h.k)) adj.set(h.k, []);
            adj.get(h.k).push(id);
        }
    }
    const used = new Uint8Array(segs.length);
    const loops = [];
    for (let s0 = 0; s0 < segs.length; s0++) {
        if (used[s0]) continue;
        used[s0] = 1;
        const loop = [segs[s0][0]];
        let cur = segs[s0][1];
        for (let guard = 0; guard < segs.length; guard++) {
            loop.push(cur);
            const next = (adj.get(cur.k) || []).find(id => !used[id]);
            if (next === undefined) break;
            used[next] = 1;
            const sg = segs[next];
            cur = sg[0].k === cur.k ? sg[1] : sg[0];
        }
        // closed when the last point is the first one again
        if (loop.length > 3 && loop[loop.length - 1].k === loop[0].k) {
            loop.pop();
            loops.push(simplify(loop.map(p => ({ x: p.x, y: p.y }))));
        }
    }
    return loops.filter(l => l.length >= 3);
}

// drop repeated points and points on a straight line
function simplify(pts) {
    let out = [];
    for (const p of pts) {
        const q = out[out.length - 1];
        if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-4) out.push(p);
    }
    if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1e-4) out.pop();
    let changed = true;
    while (changed && out.length > 3) {
        changed = false;
        const keep = [];
        for (let i = 0; i < out.length; i++) {
            const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
            const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
            const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
            if (Math.abs(cross) / (l1 * l2 || 1) < 1e-4 && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) > 0) { changed = true; continue; }
            keep.push(b);
        }
        out = keep;
    }
    return out;
}

export function area(loop) {
    let a = 0;
    for (let i = 0; i < loop.length; i++) {
        const p = loop[i], q = loop[(i + 1) % loop.length];
        a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
}

export function inside(pt, loop) {
    let c = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const a = loop[i], b = loop[j];
        if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < (b.x - a.x) * (pt.y - a.y) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
}

function bbox(loop) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of loop) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    return { w: x1 - x0, h: y1 - y0 };
}

// a loop as arc length: per vertex its position s, per edge its direction, per vertex its turn
function measure(loop) {
    const n = loop.length, s = new Float64Array(n + 1), dir = [], turn = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const p = loop[i], q = loop[(i + 1) % n], l = Math.hypot(q.x - p.x, q.y - p.y);
        s[i + 1] = s[i] + l;
        dir.push({ x: (q.x - p.x) / (l || 1), y: (q.y - p.y) / (l || 1), l });
    }
    for (let i = 0; i < n; i++) {
        const a = dir[(i - 1 + n) % n], b = dir[i];
        turn[i] = Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y)) * 180 / Math.PI;
    }
    return { n, s, L: s[n], dir, turn };
}

function pointAt(loop, m, at) {
    const L = m.L;
    at = ((at % L) + L) % L;
    let lo = 0, hi = m.n - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (m.s[mid] <= at) lo = mid; else hi = mid - 1; }
    const d = m.dir[lo], p = loop[lo], t = at - m.s[lo];
    return { x: p.x + d.x * t, y: p.y + d.y * t, e: lo, at };
}

const cdist = (a, b, L) => { const d = Math.abs(a - b) % L; return Math.min(d, L - d); };

/**
 * Where the tabs go on every loop of one part.
 * @param {Array} loops closed loops of {x,y} (from sliceLoops)
 * @param {Object} rule from tabRule
 * @param {Object} opt pins: { count, holeCount, holes (false = none), holeMin, corner }
 * @returns {{ tabs: Array<{x,y,nx,ny,hole,loop}>, outer: number, holes: number, skipped: number, small: boolean, per: Array }}
 */
export function planTabs(loops, rule, opt = {}) {
    const holeMin = opt.holeMin > 0 ? opt.holeMin : holeMinFor(rule.bit);
    const holesOn = opt.holes !== false;
    const W0 = rule.width, D = rule.bit;
    // per loop below: W the tab's length there, foot a tab and the bit's reach on each side,
    // clear how far a tab's middle stays from a corner (half a tab and the bit, unless pinned)
    const tabs = [];
    let outer = 0, holes = 0, skipped = 0, small = false;
    const per = [];   // per loop that got tabs: { hole, count, length }
    loops.forEach((loop, li) => {
        // nesting: inside an even number of other loops = the outside of material, odd = a hole
        const depth = loops.reduce((c, other, oi) => c + (oi !== li && inside(loop[0], other) ? 1 : 0), 0);
        const hole = depth % 2 === 1;
        const box = bbox(loop), m = measure(loop), L = m.L;
        if (!(L > 0)) return;
        // a tight hole takes a shorter tab: at most an eighth of the way round, never under the bit
        const W = hole ? Math.max(Math.min(W0, L / 8), Math.min(W0, D)) : W0;
        const foot = W + 2 * D;
        const clear = opt.corner > 0 ? opt.corner : W / 2 + D;
        const minDim = Math.min(box.w, box.h);
        // corners: arc positions of sharp turns
        const corners = [];
        for (let i = 0; i < m.n; i++) if (m.turn[i] > CORNER_DEG) corners.push(m.s[i]);
        let want, min;
        if (hole) {
            if (!holesOn || minDim < holeMin) return;
            want = Math.round(L / (rule.spacing * 2));
            min = 2;
            if (opt.holeCount > 0) want = min = Math.round(opt.holeCount);
        } else if (opt.count > 0) {
            want = min = Math.round(opt.count);
        } else {
            want = Math.round(L / rule.spacing);
            min = minDim < 40 ? 2 : minDim < 100 ? Math.min(3, rule.minTabs) : rule.minTabs;
            // straight sides: one tab a side, so a rectangle gets 4 on either machine
            if (corners.length >= 4 && minDim >= 40) min = Math.max(min, rule.density < 0 ? 3 : 4);
        }
        const fit = Math.floor(L / (3 * foot));
        let n = Math.max(min, want);
        if (n > fit) { n = Math.max(fit, hole ? 1 : 2); small = small || fit < min; }
        // which way is away from the material: out of an outside, into a hole
        const ccw = area(loop) > 0;
        const away = (hole ? -1 : 1) * (ccw ? 1 : -1);
        const cornerDist = at => corners.reduce((d, c) => Math.min(d, cdist(at, c, L)), Infinity);
        const bendUnder = at => {
            let b = 0;
            for (let i = 0; i < m.n; i++) if (cdist(at, m.s[i], L) <= W / 2 + D / 2) b += m.turn[i];
            return b;
        };
        // candidates every step: clear of corners by half a tab and a bit, and straight-ish
        const step = Math.max(L / 1500, 0.25);
        const ok = [];
        for (let at = 0; at < L; at += step) {
            if (cornerDist(at) >= clear && bendUnder(at) <= BEND_DEG) ok.push(at);
        }
        if (!ok.length) {
            // nothing straight enough: allow closer to corners before giving up
            for (let at = 0; at < L; at += step) if (cornerDist(at) >= Math.min(clear, W / 2) && bendUnder(at) <= BEND_DEG * 2) ok.push(at);
        }
        if (!ok.length && hole) {
            // a small round hole has no straight run: a tab anywhere on it still holds the piece
            for (let at = 0; at < L; at += step) if (cornerDist(at) >= Math.min(clear, W / 2)) ok.push(at);
        }
        if (!ok.length) { skipped += n; return; }
        const gap = Math.max(foot, L / n * 0.5);
        const snap = (ideal, taken) => {
            let best = null, bd = Infinity;
            for (const at of ok) {
                const d = cdist(at, ideal, L);
                if (d < bd && taken.every(t => cdist(t, at, L) >= gap)) { bd = d; best = at; }
            }
            return best;
        };
        // try phases, keep the most even set; between equally even ones, the one whose tabs
        // stand furthest from the corners (a rectangle's 4 land at its sides' middles)
        let pick = null, pcost = Infinity;
        const PH = 48, R = L / n / 2;
        for (let k = 0; k < PH; k++) {
            const phase = (L / n) * k / PH;
            const taken = [];
            let cost = 0;
            for (let i = 0; i < n; i++) {
                const ideal = phase + i * L / n;
                const at = snap(ideal, taken);
                if (at === null) { cost += (L / n) * (L / n); continue; }
                cost += cdist(at, ideal, L) ** 2 + 0.5 * Math.max(0, R - cornerDist(at)) ** 2;
                taken.push(at);
            }
            cost += (n - taken.length) * L * L;
            if (cost < pcost - 1e-9) { pcost = cost; pick = taken; }
        }
        // a run between two corners that holds one tab: put it at the run's middle when that is near
        if (corners.length >= 2) {
            const cs = corners.slice().sort((a, b) => a - b);
            pick = pick.map(at => {
                let a = cs[cs.length - 1] - L, b = cs[0];
                for (let i = 0; i < cs.length; i++) {
                    const c0 = cs[i], c1 = i + 1 < cs.length ? cs[i + 1] : cs[0] + L;
                    const x = at < c0 ? at + L : at;
                    if (x >= c0 && x <= c1) { a = c0; b = c1; break; }
                }
                const mid = (a + b) / 2;
                const alone = pick.filter(t => { const x = t < a ? t + L : t; return x >= a && x <= b; }).length === 1;
                const midN = ((mid % L) + L) % L;
                if (alone && cdist(midN, at, L) <= 0.15 * L / n && cornerDist(midN) >= clear && bendUnder(midN) <= BEND_DEG) return midN;
                return at;
            });
        }
        skipped += n - pick.length;
        for (const at of pick.sort((a, b) => a - b)) {
            const p = pointAt(loop, m, at);
            const d = m.dir[p.e];
            tabs.push({ x: p.x, y: p.y, nx: d.y * away, ny: -d.x * away, hole, loop: li, at: r2(at), of: r2(L), ...(W !== W0 ? { w: r2(W) } : {}) });
        }
        if (hole) holes++; else outer++;
        per.push({ hole, count: pick.length, length: r2(L) });
    });
    return { tabs, outer, holes, skipped, small, per };
}

/**
 * The tab record the existing tab system stores (widget annotation `tab`), built the way
 * cl-tab.js builds a clicked one: centered half a depth out from the edge, turned to the edge.
 * rot is a quaternion about Z as [x, y, z, w]. `auto: true` marks it as placed by auto tabs.
 */
export function tabRecord(t, rule, z, id) {
    const a = Math.atan2(t.ny, t.nx);
    return {
        pos: { x: t.x + t.nx * rule.depth / 2, y: t.y + t.ny * rule.depth / 2, z },
        dim: { x: rule.depth, y: t.w || rule.width, z: rule.height },
        rot: [0, 0, Math.sin(a / 2), Math.cos(a / 2)],
        id,
        auto: true,
    };
}
