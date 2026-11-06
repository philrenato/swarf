/**
 * swarf: the round holes in a part, read from its mesh. Pure (it needs only autotab-rule.js), so the
 * drill step in the worker and the concerns and step lines in the page read the same holes.
 *
 * A hole: a loop inside the part's material, cut just under one of the mesh's flat heights, with its
 * points on a circle. Under solid material from above it is out of the bit's reach and is not one.
 *
 * All lengths mm.
 */
import { sliceLoops, inside, area } from './autotab-rule.js';

const LEVELS_MAX = 16;   // holes open from the higher flats; a part of many flats stops looking there
const seenFlats = new WeakMap(), seenHoles = new WeakMap();

// the same array can be rewritten in place when a part is scaled or turned
function sample(pos) {
    let s = pos.length;
    const step = Math.max(1, Math.floor(pos.length / 64));
    for (let i = 0; i < pos.length; i += step) s = (s * 31 + Math.round(pos[i] * 1e3)) % 2147483647;
    return s;
}

/**
 * The heights of a triangle soup's flat faces, highest first.
 * recess: a flat between the part's top and bottom, that a pocket could clear down to.
 */
export function flatsOf(pos) {
    const sum = sample(pos), was = seenFlats.get(pos);
    if (was && was.sum === sum) return was.out;
    let zmin = Infinity, zmax = -Infinity;
    const heights = new Set();
    for (let t = 0; t + 8 < pos.length; t += 9) {
        const a = pos[t + 2], b = pos[t + 5], c = pos[t + 8];
        zmin = Math.min(zmin, a, b, c); zmax = Math.max(zmax, a, b, c);
        if (Math.abs(a - b) < 1e-5 && Math.abs(b - c) < 1e-5) heights.add(Math.round(a * 1e4) / 1e4);
    }
    const flats = [...heights].sort((a, b) => b - a);
    const out = { flats, zmin, zmax, recess: flats.some(z => z > zmin + 0.01 && z < zmax - 0.01) };
    seenFlats.set(pos, { sum, out });
    return out;
}

// one round loop: its center and across, or null. A polygon of 8 or more points on a circle
function roundOf(loop) {
    if (loop.length < 8) return null;
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < loop.length; i++) {
        const p = loop[i], q = loop[(i + 1) % loop.length], k = p.x * q.y - q.x * p.y;
        a += k; cx += (p.x + q.x) * k; cy += (p.y + q.y) * k;
    }
    if (Math.abs(a) < 1e-9) return null;
    cx /= 3 * a; cy /= 3 * a;
    const rs = loop.map(p => Math.hypot(p.x - cx, p.y - cy));
    const r = rs.reduce((s, v) => s + v, 0) / rs.length;
    if (!(r > 0) || rs.some(v => Math.abs(v - r) > Math.max(0.03 * r, 0.02))) return null;
    // and the points go all the way round it: an 8-sided circle has 90 % of the circle's area
    if (Math.abs(area(loop)) < 0.88 * Math.PI * r * r) return null;
    return { x: cx, y: cy, d: 2 * r };
}

const solidAt = (p, loops) => loops.reduce((n, l) => n + (inside(p, l) ? 1 : 0), 0) % 2 === 1;

// what is straight under a hole's center: the highest surface below its rim, or null when nothing is and
// it goes through. Asked of the mesh itself: the levels above stop at the top sixteen flats, and a floor
// below them read as through (a review of 109: a stepped part's blind hole drilled right out)
function floorUnder(pos, c, z) {
    let best = null;
    for (let i = 0; i + 8 < pos.length; i += 9) {
        const ax = pos[i], ay = pos[i + 1], bx = pos[i + 3], by = pos[i + 4], cx = pos[i + 6], cy = pos[i + 7];
        const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(d) < 1e-12) continue;
        const u = ((by - cy) * (c.x - cx) + (cx - bx) * (c.y - cy)) / d, v = ((cy - ay) * (c.x - cx) + (ax - cx) * (c.y - cy)) / d;
        if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) continue;
        const h = u * pos[i + 2] + v * pos[i + 5] + (1 - u - v) * pos[i + 8];
        if (h < z - 0.02 && (best === null || h > best)) best = h;
    }
    return best === null ? null : Math.round(best * 1e4) / 1e4;
}

/**
 * @param {ArrayLike<number>} pos triangle soup, 9 numbers a triangle
 * @returns {{ holes: Array<{ x: number, y: number, d: number, floor: ?number }>, zmin: number, zmax: number }}
 *          floor: the height of a blind hole's bottom, null when it goes through
 */
export function roundHoles(pos) {
    const sum = sample(pos), was = seenHoles.get(pos);
    if (was && was.sum === sum) return was.out;
    const { flats, zmin, zmax } = flatsOf(pos);
    const levels = flats.filter(z => z > zmin + 0.01).slice(0, LEVELS_MAX).map(z => ({ z, loops: sliceLoops(pos, z - 0.01) }));
    const holes = [];
    levels.forEach((level, li) => {
        for (const loop of level.loops) {
            if (level.loops.reduce((n, l) => n + (l !== loop && inside(loop[0], l) ? 1 : 0), 0) % 2 === 0) continue;
            const c = roundOf(loop);
            if (!c) continue;
            if (levels.slice(0, li).some(up => solidAt(c, up.loops))) continue;
            if (holes.some(h => Math.hypot(h.x - c.x, h.y - c.y) < 0.1 * c.d && Math.abs(h.d - c.d) < Math.max(0.05, 0.05 * c.d))) continue;
            holes.push({ ...c, floor: floorUnder(pos, c, level.z) });
        }
    });
    const out = { holes, zmin, zmax };
    seenHoles.set(pos, { sum, out });
    return out;
}

/**
 * What a bit does with a hole: 'fits' when the hole is the bit's own size, drawn up to 0.4 mm or 6 %
 * under it (a 6 mm hole and a 1/4 in bit), and it comes out the bit's size; 'bigger' and 'smaller' are
 * not drilled. A plunge cannot make a hole wider than its bit, or a narrower one than it.
 */
export function holeFit(d, bit) {
    if (d > bit + 0.1) return 'bigger';
    if (d < bit - Math.max(0.4, 0.06 * bit)) return 'smaller';
    return 'fits';
}
