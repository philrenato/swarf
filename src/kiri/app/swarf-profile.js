/**
 * swarf: a part with a shaped top edge (Phil 10-27: "straight extrusion and a
 * chamfer and a filleted edge to start").
 *
 * The outline (with its holes) rises straight to (thickness − size), then the
 * edge turns in by `size` over the last `size` of height: a 45° chamfer, or a
 * quarter round tangent to the wall and to the top. Every ring is the outline
 * with each point moved along its corner's miter, so rings match point for
 * point, each edge moves parallel to itself, and a ring that would turn an edge
 * inside out (a curve or corner tighter than the size) is refused, not built.
 *
 *   profileSolid(poly, thickness, { kind: 'chamfer' | 'round', size })
 *     -> { vertices: [x,y,z,…] } or { error: 'why' }
 */
import { THREE } from '../../ext/three.js';

const area = P => { let a = 0; for (let i = 0, n = P.length; i < n; i++) { const p = P[i], q = P[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };

// points along the left normal: for a counter-clockwise outline and clockwise holes, into the material
function inset(P, d) {
    const n = P.length, out = [];
    for (let i = 0; i < n; i++) {
        const a = P[(i - 1 + n) % n], p = P[i], b = P[(i + 1) % n];
        let e0x = p[0] - a[0], e0y = p[1] - a[1], e1x = b[0] - p[0], e1y = b[1] - p[1];
        const l0 = Math.hypot(e0x, e0y) || 1, l1 = Math.hypot(e1x, e1y) || 1;
        e0x /= l0; e0y /= l0; e1x /= l1; e1y /= l1;
        const n0 = [-e0y, e0x], n1 = [-e1y, e1x];
        const c = 1 + n0[0] * n1[0] + n0[1] * n1[1];
        // a spike sharper than ~15° is clipped to 8× the size
        const k = c > 1 / 32 ? 1 / c : 32;
        out.push([p[0] + d * (n0[0] + n1[0]) * k, p[1] + d * (n0[1] + n1[1]) * k]);
    }
    return out;
}

function flipped(P, Q) {
    for (let i = 0, n = P.length; i < n; i++) {
        const j = (i + 1) % n;
        const ex = P[j][0] - P[i][0], ey = P[j][1] - P[i][1], fx = Q[j][0] - Q[i][0], fy = Q[j][1] - Q[i][1];
        if (ex * fx + ey * fy < -1e-9) return true;
    }
    return false;
}

function inside(p, P) {
    let c = false;
    for (let i = 0, n = P.length, j = n - 1; i < n; j = i++) {
        const a = P[i], b = P[j];
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
}

// the rings' heights and insets, bottom of the shaped band to the top
function levels(t, { kind, size: s }) {
    if (kind === 'chamfer') return [[t - s, 0], [t, s]];
    const N = Math.max(6, Math.min(24, Math.ceil(s * 2)));
    const L = [];
    for (let k = 0; k <= N; k++) { const a = (k / N) * Math.PI / 2; L.push([t - s + s * Math.sin(a), s - s * Math.cos(a)]); }
    return L;
}

export function profileSolid(poly, t, edge) {
    const s = +edge.size;
    if (!(s > 0)) return { error: 'The edge size must be more than 0 mm.' };
    if (s > t + 1e-9) return { error: `A ${s} mm edge is taller than the ${t} mm part: make it ${t} mm or less.` };
    const ring = pp => pp.points.map(p => [p.x, p.y]);
    let outer = ring(poly);
    if (area(outer) < 0) outer.reverse();
    const holes = (poly.inner || []).map(ring).map(h => (area(h) > 0 ? h.reverse() : h));
    const loops = [outer, ...holes];
    const L = levels(t, edge);
    const rings = L.map(([, d]) => loops.map(P => (d ? inset(P, d) : P)));
    const top = rings[rings.length - 1];
    const tooBig = `A ${s} mm ${edge.kind === 'round' ? 'round' : 'chamfer'} is too big for this shape: its narrowest curve or gap would turn inside out. Try a smaller one.`;
    for (let li = 0; li < loops.length; li++) if (flipped(loops[li], top[li])) return { error: tooBig };
    // the top's holes must stay inside its outline, and apart
    for (let h = 1; h < top.length; h++) {
        if (top[h].some(p => !inside(p, top[0]))) return { error: tooBig };
        for (let g = 1; g < top.length; g++) if (g !== h && top[h].some(p => inside(p, top[g]))) return { error: tooBig };
    }

    const v = [];
    const tri = (a, b, c) => v.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    // a flat face at z, facing up (or down)
    const face = (R, z, up) => {
        const V2 = P => P.map(([x, y]) => new THREE.Vector2(x, y));
        const all = R.flat();
        for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(V2(R[0]), R.slice(1).map(V2))) {
            let a = all[i], b = all[j], c = all[k];
            const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
            if ((nz > 0) !== up) [b, c] = [c, b];
            tri([a[0], a[1], z], [b[0], b[1], z], [c[0], c[1], z]);
        }
    };
    // a band between two rings: travelling along each loop, the solid's outside is on the right
    const band = (A, za, B, zb) => {
        for (let i = 0, n = A.length; i < n; i++) {
            const j = (i + 1) % n;
            const a = [A[i][0], A[i][1], za], b = [A[j][0], A[j][1], za], c = [B[j][0], B[j][1], zb], d = [B[i][0], B[i][1], zb];
            tri(a, b, c); tri(a, c, d);
        }
    };
    face(loops, 0, false);
    face(top, t, true);
    for (let li = 0; li < loops.length; li++) {
        if (L[0][0] > 1e-9) band(loops[li], 0, loops[li], L[0][0]);
        for (let k = 0; k + 1 < L.length; k++) band(rings[k][li], L[k][0], rings[k + 1][li], L[k + 1][0]);
    }
    return { vertices: v };
}
