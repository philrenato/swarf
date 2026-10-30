// swarf-tex-core.mjs — parametric surface textures, app-neutral. Pure ES module: no DOM, no THREE,
// no swarf or Kiri imports, so another app can vendor this one file (as swarf vendors Unreason's
// arrangement.mjs). swarf's TEX mode (swarf-tex.js) draws marks with it, and cam's texture step
// (src/kiri/mode/cam/work/op-texture.js) turns a mark into moves with it.
//
// THE IDEA. A texture is a height function h(x, y) >= 0 — the depth in mm BELOW the board's top that
// the design asks for — inside a region mask with a soft edge. It is never a mesh. Toolpaths come
// straight from h and the cutter's shape (drop cutter), and you see the result by simulating
// material removal on a heightmap of the board's top.
//
// Units: mm. Part coordinates: x right, y away from you, z = 0 at the board's top, negative into it.
//
// A MARK (the bottom of this file) is what an app keeps on a part: a region (painted, or a shape)
// and a fill. Step 1 fills with a texture; the fill's kind leaves room for 'pierce' (cuts through:
// bendy-ply kerfs, lattices) later, from the same region.
//
// Borrowed from Pgon (a sculpting app, ported to 2D):
//   hash3, the smootherstep fade, the octave sum   <- Pgon noise (hash3, fbm)
//   worley cells, per-cell plateau height           <- Pgon noise (worley3, plaques)
//   weave drafts + yarn that crosses over smoothly  <- Pgon noise (WEAVE_DRAFTS, weave2)

const TAU = Math.PI * 2;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smoothstep = (t) => t * t * (3 - 2 * t);
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------------------------
// Noise primitives (from Pgon)

// Pgon's integer hash: deterministic across machines, so a seed means the same board everywhere.
export function hash3(ix, iy, iz, seed) {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 1274126177) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const GX = new Float64Array(256), GY = new Float64Array(256);
for (let i = 0; i < 256; i++) { GX[i] = Math.cos(i / 256 * TAU); GY[i] = Math.sin(i / 256 * TAU); }

// 2D gradient (Perlin) noise, about -1..1, with Pgon's smootherstep so no lattice creases show.
export function perlin2(x, y, seed = 1) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const g = (cx, cy, dx, dy) => { const k = (hash3(cx, cy, 0, seed) * 255.999) | 0; return GX[k] * dx + GY[k] * dy; };
  const u = fade(fx), v = fade(fy);
  const a = lerp(g(ix, iy, fx, fy), g(ix + 1, iy, fx - 1, fy), u);
  const b = lerp(g(ix, iy + 1, fx, fy - 1), g(ix + 1, iy + 1, fx - 1, fy - 1), u);
  return lerp(a, b, v) * 1.41421356;
}

// Fractal sum, Pgon's fbm shape: roughness = how much amplitude each octave keeps.
export function fbm2(x, y, { octaves = 4, roughness = 0.5, lacunarity = 2, seed = 1 } = {}) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += perlin2(x * freq + o * 17.31, y * freq - o * 9.13, seed + o * 131) * amp;
    norm += amp; amp *= roughness; freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

// 2D Worley (Pgon's worley3 walk, flattened) that also returns the exact distance to the nearest
// cell WALL (the Voronoi bisector), which is what a mortar joint of constant width needs.
const WPX = new Float64Array(9), WPY = new Float64Array(9), WCX = new Int32Array(9), WCY = new Int32Array(9);
const WR = { f1: 0, f2: 0, edge: 0, id: 0, cx: 0, cy: 0 };
export function worley2(x, y, seed = 1, jitter = 1) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let k = 0, best = 0, f1 = Infinity;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++, k++) {
    const cx = ix + dx, cy = iy + dy;
    WCX[k] = cx; WCY[k] = cy;
    WPX[k] = cx + 0.5 + (hash3(cx, cy, 0, seed) - 0.5) * jitter;
    WPY[k] = cy + 0.5 + (hash3(cx, cy, 1, seed + 8191) - 0.5) * jitter;
    const d = Math.hypot(WPX[k] - x, WPY[k] - y);
    if (d < f1) { f1 = d; best = k; }
  }
  let edge = Infinity, f2 = Infinity;
  const bx = WPX[best], by = WPY[best];
  for (let q = 0; q < 9; q++) {
    if (q === best) continue;
    const ex = WPX[q] - bx, ey = WPY[q] - by, len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    const e = -((x - (bx + WPX[q]) / 2) * ex + (y - (by + WPY[q]) / 2) * ey) / len;
    if (e < edge) edge = e;
    const d = Math.hypot(WPX[q] - x, WPY[q] - y);
    if (d < f2) f2 = d;
  }
  WR.f1 = f1; WR.f2 = f2; WR.edge = Math.max(0, edge);
  WR.id = hash3(WCX[best], WCY[best], 2, seed + 32749); WR.cx = bx; WR.cy = by;
  return WR;
}

// ---------------------------------------------------------------------------------------------
// Profiles: the cross-section of a dot or a groove, from its center (r = 0) to its rim (r = hw).

// 'ball' is a spherical / cylindrical CAP through the rim — exactly what a ball nose of radius <= the
// cap's radius can cut. Deeper than the half-width it becomes a round-bottomed hole with straight
// walls (a ball plunged past its equator), never an undercut nothing could machine.
export function cap(r, hw, dp, profile = 'ball') {
  if (!(r < hw) || !(dp > 0)) return 0;
  if (profile === 'cone' || profile === 'v') return dp * (1 - r / hw);
  if (profile === 'flat') return dp;
  if (dp >= hw) return dp - hw + Math.sqrt(hw * hw - r * r);
  const R = (hw * hw + dp * dp) / (2 * dp);
  return Math.max(0, Math.sqrt(R * R - r * r) - (R - dp));
}

// ---------------------------------------------------------------------------------------------
// Composition

// Step-and-repeat: motif(du, dv, i, j) -> depth, centered on each lattice cell. Neighbors are
// searched `reach` cells out and the deepest wins, so a motif may spill past its own cell.
export function stepRepeat(motif, { px, py, stagger = 0, reach = 1 }) {
  return (u, v) => {
    const j0 = Math.round(v / py);
    let best = 0;
    for (let j = j0 - reach; j <= j0 + reach; j++) {
      const off = (j & 1) ? stagger * px : 0;
      const i0 = Math.round((u - off) / px);
      for (let i = i0 - reach; i <= i0 + reach; i++) {
        const d = motif(u - (i * px + off), v - j * py, i, j);
        if (d > best) best = d;
      }
    }
    return best;
  };
}

function latticeCenters(px, py, stagger, b) {
  const out = [];
  const j0 = Math.floor(b.v0 / py) - 1, j1 = Math.ceil(b.v1 / py) + 1;
  for (let j = j0; j <= j1; j++) {
    const off = (j & 1) ? stagger * px : 0;
    const i0 = Math.floor((b.u0 - off) / px) - 1, i1 = Math.ceil((b.u1 - off) / px) + 1;
    for (let i = i0; i <= i1; i++) out.push([i * px + off, j * py, i, j]);
  }
  return out;
}

// Blend two height functions: max (union of cuts), add, mix, min (intersection).
export function blend(a, b, mode = 'max', t = 1) {
  if (mode === 'add') return (x, y) => a(x, y) + t * b(x, y);
  if (mode === 'mix') return (x, y) => lerp(a(x, y), b(x, y), t);
  if (mode === 'min') return (x, y) => Math.min(a(x, y), b(x, y));
  return (x, y) => Math.max(a(x, y), t * b(x, y));
}

// Lines of direction `angle` spaced `pitch` apart, clipped to a local box. Returns 2-point polylines.
function linesInBox(angle, pitch, b, phase = 0) {
  const dx = Math.cos(angle), dy = Math.sin(angle), nx = -dy, ny = dx;
  const cs = [[b.u0, b.v0], [b.u1, b.v0], [b.u0, b.v1], [b.u1, b.v1]];
  let n0 = Infinity, n1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (const [u, v] of cs) {
    const n = u * nx + v * ny, t = u * dx + v * dy;
    n0 = Math.min(n0, n); n1 = Math.max(n1, n); t0 = Math.min(t0, t); t1 = Math.max(t1, t);
  }
  const out = [];
  for (let k = Math.floor((n0 - phase) / pitch); k <= Math.ceil((n1 - phase) / pitch); k++) {
    const n = k * pitch + phase;
    out.push([[n * nx + t0 * dx, n * ny + t0 * dy], [n * nx + t1 * dx, n * ny + t1 * dy]]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Morse

export const MORSE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
  K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...',
  8: '---..', 9: '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--', '/': '-..-.',
  '-': '-....-', '@': '.--.-.', '&': '.-...', ':': '---...', "'": '.----.', '=': '-...-', '+': '.-.-.',
};

// "SOS" -> "... --- ...". Letters are separated by a space, words by " / ".
export function morseEncode(text) {
  return String(text).toUpperCase().split(/\s+/)
    .map((w) => [...w].map((c) => MORSE[c]).filter(Boolean).join(' '))
    .filter(Boolean).join(' / ');
}

// Lay a code string (".", "-", " " = letter gap, "/" = word gap) out along a line. ITU timing:
// dot 1 unit, dash 3, 1 between symbols, 3 between letters, 7 between words. Each element is a
// CORE segment [a, b] the groove's round end caps extend past by half the width.
function codeElements(code, unit, width, dashLen = 3 * unit, gap = unit, endGap = 6 * gap) {
  const els = [];
  let s = 0;
  const hw = width / 2;
  for (const ch of code) {
    if (ch === '.') { const c = s + Math.max(hw, unit / 2); els.push({ a: c, b: c }); s += Math.max(width, unit) + gap; }
    else if (ch === '-') { els.push({ a: s + hw, b: s + Math.max(dashLen, width) - hw }); s += Math.max(dashLen, width) + gap; }
    else if (ch === ' ') s += 2 * gap;
    else if (ch === '/') s += 6 * gap;
  }
  s += endGap;   // the message's own end gap before it repeats (a word gap for Morse)
  return { els, period: Math.max(s, unit) };
}

// A row field of periodic elements: rows `rowPitch` apart, each row's start shifted by `rowShift`.
function rowField(els, period, rowPitch, rowShift, hw, dp, profile) {
  const A = els.map((e) => e.a), n = els.length;
  const h = (u, v) => {
    if (!n) return 0;
    const j0 = Math.round(v / rowPitch);
    let best = 0;
    for (let j = j0 - 1; j <= j0 + 1; j++) {
      const dv = v - j * rowPitch;
      if (Math.abs(dv) >= hw) continue;
      const s = u - j * rowShift;
      const loc = s - Math.floor(s / period) * period;
      let lo = 0, hi = n;                       // first index with a > loc
      while (lo < hi) { const m = (lo + hi) >> 1; if (A[m] <= loc) lo = m + 1; else hi = m; }
      const k = lo - 1;
      const c1 = k >= 0 ? els[k] : { a: els[n - 1].a - period, b: els[n - 1].b - period };
      const c2 = lo < n ? els[lo] : { a: els[0].a + period, b: els[0].b + period };
      for (const e of [c1, c2]) {
        const along = loc < e.a ? e.a - loc : loc > e.b ? loc - e.b : 0;
        const d = cap(Math.hypot(along, dv), hw, dp, profile);
        if (d > best) best = d;
      }
    }
    return best;
  };
  const strokes = (b) => {
    const out = [];
    for (let j = Math.floor(b.v0 / rowPitch) - 1; j <= Math.ceil(b.v1 / rowPitch) + 1; j++) {
      const v = j * rowPitch;
      if (v < b.v0 - hw || v > b.v1 + hw) continue;
      const base0 = j * rowShift;
      for (let m = Math.floor((b.u0 - base0) / period) - 1; m <= Math.ceil((b.u1 - base0) / period); m++) {
        const base = base0 + m * period;
        for (const e of els) {
          if (base + e.b < b.u0 - hw || base + e.a > b.u1 + hw) continue;
          out.push(e.a === e.b ? [[base + e.a, v]] : [[base + e.a, v], [base + e.b, v]]);
        }
      }
    }
    return out;
  };
  return { h, strokes };
}

// Generic stroke field over finite polylines, bucketed. Used for Morse along a path.
export function strokeField(polys, hw, dp, profile = 'ball') {
  const segs = [];
  for (const p of polys) {
    if (p.length === 1) segs.push([p[0][0], p[0][1], p[0][0], p[0][1]]);
    for (let i = 1; i < p.length; i++) segs.push([p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]]);
  }
  const cell = Math.max(hw * 2, 2);
  const buckets = new Map();
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  segs.forEach((s, idx) => {
    const i0 = Math.floor((Math.min(s[0], s[2]) - hw) / cell), i1 = Math.floor((Math.max(s[0], s[2]) + hw) / cell);
    const j0 = Math.floor((Math.min(s[1], s[3]) - hw) / cell), j1 = Math.floor((Math.max(s[1], s[3]) + hw) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(idx);
    }
  });
  return (u, v) => {
    const list = buckets.get(key(Math.floor(u / cell), Math.floor(v / cell)));
    if (!list) return 0;
    let best = 0;
    for (const idx of list) {
      const d = cap(segDist(u, v, segs[idx]), hw, dp, profile);
      if (d > best) best = d;
    }
    return best;
  };
}

function segDist(x, y, s) {
  const ax = s[0], ay = s[1], ex = s[2] - ax, ey = s[3] - ay;
  const L = ex * ex + ey * ey;
  const t = L > 0 ? clamp01(((x - ax) * ex + (y - ay) * ey) / L) : 0;
  return Math.hypot(x - ax - t * ex, y - ay - t * ey);
}

// Lay code elements along a polyline by arc length, repeating to the end.
function elementsAlongPath(path, els, period) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  const total = cum[cum.length - 1];
  const at = (s) => {
    let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
    return [lerp(path[i - 1][0], path[i][0], t), lerp(path[i - 1][1], path[i][1], t)];
  };
  const out = [];
  for (let base = 0; base < total; base += period) {
    for (const e of els) {
      const a = base + e.a, b = base + e.b;
      if (b > total) break;
      if (a === b) { out.push([at(a)]); continue; }
      const pts = [at(a)];
      for (let i = 1; i < cum.length - 1; i++) if (cum[i] > a && cum[i] < b) pts.push(path[i]);
      pts.push(at(b));
      out.push(pts);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Weave (Pgon WEAVE_DRAFTS + weave2)

export const WEAVE_DRAFTS = {
  plain: [[1, 0], [0, 1]],
  twill: [[1, 0, 0, 1], [1, 1, 0, 0], [0, 1, 1, 0], [0, 0, 1, 1]],
  basket: [[1, 1, 0, 0], [1, 1, 0, 0], [0, 0, 1, 1], [0, 0, 1, 1]],
  satin: [[1, 0, 0, 0, 0], [0, 0, 1, 0, 0], [0, 0, 0, 0, 1], [0, 1, 0, 0, 0], [0, 0, 0, 1, 0]],
};
function weaveOverAt(kind, i, j) {
  if (kind === 'herring') {
    const band = Math.floor(i / 4);
    const d = (band % 2 === 0) ? (i - j) : (i + j);
    return ((((d % 4) + 4) % 4) < 2) ? 1 : 0;
  }
  const D = WEAVE_DRAFTS[kind] || WEAVE_DRAFTS.plain, n = D.length;
  return D[((i % n) + n) % n][((j % n) + n) % n] ? 1 : 0;
}
// 0..1, 1 = top of the over-thread. The yarn rises and dips ALONG its own length between cell
// centers (Pgon's fix for the crease a flip-at-the-boundary would leave).
function weave01(u, v, kind) {
  const i = Math.floor(u), j = Math.floor(v);
  const prof = (f) => { const t = 2 * f - 1; const s = 1 - t * t; return s > 0 ? Math.sqrt(s) : 0; };
  const warp = prof(u - i), weft = prof(v - j);
  const LO = 0.42;
  const jm = Math.floor(v - 0.5), tv = (v - 0.5) - jm;
  const wa = weaveOverAt(kind, i, jm), wb = weaveOverAt(kind, i, jm + 1);
  const warpLift = wa + (wb - wa) * smoothstep(tv);
  const im = Math.floor(u - 0.5), tu = (u - 0.5) - im;
  const fa = 1 - weaveOverAt(kind, im, j), fb = 1 - weaveOverAt(kind, im + 1, j);
  const weftLift = fa + (fb - fa) * smoothstep(tu);
  return Math.max(warp * (LO + (1 - LO) * warpLift), weft * (LO + (1 - LO) * weftLift));
}

// ---------------------------------------------------------------------------------------------
// Motifs for step-and-repeat: polylines in a unit box (about -0.5..0.5).

function ringPts(n, r, f = () => 1) { const p = []; for (let i = 0; i < n; i++) { const a = i / n * TAU + Math.PI / 2; const k = r * f(i); p.push([Math.cos(a) * k, Math.sin(a) * k]); } return p; }
export const MOTIFS = {
  x: { closed: false, polys: [[[-0.42, -0.42], [0.42, 0.42]], [[-0.42, 0.42], [0.42, -0.42]]] },
  plus: { closed: false, polys: [[[-0.45, 0], [0.45, 0]], [[0, -0.45], [0, 0.45]]] },
  star: { closed: true, polys: [ringPts(10, 0.5, (i) => (i % 2 ? 0.42 : 1))] },
  ring: { closed: true, polys: [ringPts(40, 0.42)] },
  hex: { closed: true, polys: [ringPts(6, 0.48)] },
  diamond: { closed: true, polys: [[[0, 0.5], [0.34, 0], [0, -0.5], [-0.34, 0]]] },
  heart: { closed: true, polys: [(() => { const p = []; for (let i = 0; i < 48; i++) { const t = i / 48 * TAU; p.push([16 * Math.sin(t) ** 3 / 34, (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 34 + 0.08]); } return p; })()] },
  chevron: { closed: false, polys: [[[-0.48, -0.22], [0, 0.24], [0.48, -0.22]]] },
};
function motifSegs(m) {
  const segs = [];
  for (const p of m.polys) {
    const n = p.length, end = m.closed ? n : n - 1;
    for (let i = 0; i < end; i++) { const a = p[i], b = p[(i + 1) % n]; segs.push([a[0], a[1], b[0], b[1]]); }
  }
  return segs;
}
function insidePoly(x, y, p) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  }
  return c;
}

// ---------------------------------------------------------------------------------------------
// The pattern library. Each build(p) returns, in the pattern's own LOCAL mm frame:
//   h(u, v) >= 0 (depth below the top), depth (the most it asks for), feature (the narrowest
//   concave detail, mm — what the cutter must fit into), kind ('dots' | 'strokes' | 'surface'),
//   and optionally dots(box) -> [[u, v, depth]] and strokes(box) -> polylines with strokeWidth.

const P = (k, label, min, max, step, def, unit = 'mm') => ({ k, label, type: 'range', min, max, step, def, unit });
const S = (k, label, options, def) => ({ k, label, type: 'select', options, def });
const T = (k, label, def) => ({ k, label, type: 'text', def });
const PROFILES = ['ball', 'cone', 'flat'];

export const PATTERNS = {
  dots: {
    label: 'polka dots', blurb: 'Dimples on a grid or hex lattice.',
    params: [P('pitch', 'Spacing', 3, 40, 0.5, 10), P('diameter', 'Dot size', 1, 30, 0.5, 6.5), P('depth', 'Depth', 0.2, 6, 0.1, 1.6),
      S('layout', 'Layout', ['hex', 'grid'], 'hex'), S('profile', 'Profile', PROFILES, 'ball')],
    build(p) {
      const hex = p.layout === 'hex', px = p.pitch, py = hex ? p.pitch * Math.sqrt(3) / 2 : p.pitch;
      const hw = p.diameter / 2, st = hex ? 0.5 : 0;
      return {
        h: stepRepeat((du, dv) => cap(Math.hypot(du, dv), hw, p.depth, p.profile), { px, py, stagger: st, reach: Math.max(1, Math.ceil(hw / Math.min(px, py))) }),
        depth: p.depth, feature: p.diameter, featureLabel: `${fmt(p.diameter)} mm dots`, kind: 'dots',
        dots: (b) => latticeCenters(px, py, st, b).map(([u, v]) => [u, v, p.depth]),
        dotDiameter: p.diameter,
      };
    },
  },
  dashdot: {
    label: 'dashes & dots', blurb: 'Rows of a repeating dash-dot sequence.',
    params: [T('sequence', 'Sequence', '-.'), P('dash', 'Dash length', 3, 40, 0.5, 12), P('width', 'Width', 1, 12, 0.25, 4),
      P('gap', 'Gap', 1, 20, 0.25, 4), P('rows', 'Row spacing', 3, 40, 0.5, 9), P('shift', 'Row shift', 0, 40, 0.5, 8),
      P('depth', 'Depth', 0.2, 5, 0.1, 1.4), S('profile', 'Profile', PROFILES, 'ball')],
    build(p) {
      const code = String(p.sequence || '-.').replace(/[^.\- /]/g, '') || '-.';
      const { els, period } = codeElements(code, p.width, p.width, p.dash, p.gap, 0);
      const f = rowField(els, period, p.rows, p.shift, p.width / 2, p.depth, p.profile);
      return { h: f.h, depth: p.depth, feature: p.width, featureLabel: `${fmt(p.width)} mm grooves`, kind: 'strokes', strokes: f.strokes, strokeWidth: p.width };
    },
  },
  morse: {
    label: 'morse', blurb: 'Your words as dots and dashes.',
    params: [T('text', 'Message', 'SWARF'), P('unit', 'Unit', 1, 12, 0.25, 3.2), P('width', 'Width', 0.8, 10, 0.1, 3.2),
      P('rows', 'Row spacing', 3, 40, 0.5, 8), P('shift', 'Row shift', 0, 60, 0.5, 13),
      P('depth', 'Depth', 0.2, 5, 0.1, 1.2), S('profile', 'Profile', PROFILES, 'ball')],
    build(p) {
      const code = morseEncode(p.text || 'SOS');
      const { els, period } = codeElements(code.replace(/ \/ /g, '/'), p.unit, p.width);
      const hw = p.width / 2;
      if (Array.isArray(p.path) && p.path.length > 1) {
        const polys = elementsAlongPath(p.path, els, period);
        return { h: strokeField(polys, hw, p.depth, p.profile), depth: p.depth, feature: p.width, featureLabel: `${fmt(p.width)} mm Morse marks`, kind: 'strokes', strokes: () => polys, strokeWidth: p.width, code };
      }
      const f = rowField(els, period, p.rows, p.shift, hw, p.depth, p.profile);
      return { h: f.h, depth: p.depth, feature: p.width, featureLabel: `${fmt(p.width)} mm Morse marks`, kind: 'strokes', strokes: f.strokes, strokeWidth: p.width, code };
    },
  },
  ribs: {
    label: 'flutes', blurb: 'Parallel grooves, straight or wavy.',
    params: [P('pitch', 'Spacing', 2, 40, 0.5, 8), P('width', 'Groove width', 1, 30, 0.25, 6.35), P('depth', 'Depth', 0.2, 6, 0.1, 2),
      P('wiggle', 'Wiggle', 0, 15, 0.5, 0), P('wavelength', 'Wiggle length', 10, 200, 1, 60), S('profile', 'Profile', PROFILES, 'ball')],
    build(p) {
      const hw = Math.min(p.width, p.pitch) / 2, A = p.wiggle, k = TAU / p.wavelength;
      const off = (v) => A * Math.sin(k * v);
      return {
        h: (u, v) => { const uu = u + off(v); const d = Math.abs(uu - Math.round(uu / p.pitch) * p.pitch); return cap(d * Math.sqrt(1 / (1 + (A * k * Math.cos(k * v)) ** 2)), hw, p.depth, p.profile); },
        depth: p.depth, feature: hw * 2, featureLabel: `${fmt(hw * 2)} mm grooves`, kind: 'strokes', strokeWidth: hw * 2,
        strokes: (b) => {
          const out = [];
          for (let i = Math.floor((b.u0 - A) / p.pitch) - 1; i <= Math.ceil((b.u1 + A) / p.pitch) + 1; i++) {
            if (A === 0) { out.push([[i * p.pitch, b.v0 - 1], [i * p.pitch, b.v1 + 1]]); continue; }
            const pts = [];
            for (let v = b.v0 - 1; v < b.v1 + 1; v += 1) pts.push([i * p.pitch - off(v), v]);
            pts.push([i * p.pitch - off(b.v1 + 1), b.v1 + 1]);
            out.push(pts);
          }
          return out;
        },
      };
    },
  },
  knurl: {
    label: 'knurl', blurb: 'Crossed V grooves leave a field of pyramids.',
    params: [P('pitch', 'Spacing', 2, 30, 0.5, 6), P('depth', 'Depth', 0.2, 8, 0.1, 3), P('cross', 'Crossing angle', 20, 90, 1, 90, '°'),
      P('land', 'Flat tops', 0, 0.8, 0.05, 0, '')],
    build(p) {
      const a1 = p.cross / 2 * Math.PI / 180, a2 = -a1;
      const n1 = [-Math.sin(a1), Math.cos(a1)], n2 = [-Math.sin(a2), Math.cos(a2)];
      const g = (f) => 1 - 2 * Math.abs(f - Math.round(f));
      const land = clamp01(p.land);
      const w = p.pitch * (1 - land);
      return {
        h: (u, v) => p.depth * clamp01((Math.max(g((u * n1[0] + v * n1[1]) / p.pitch), g((u * n2[0] + v * n2[1]) / p.pitch)) - land) / (1 - land + 1e-9)),
        depth: p.depth, feature: 0, featureLabel: `${fmt(2 * Math.atan(w / 2 / p.depth) * 180 / Math.PI, 0)}° V grooves`, kind: 'strokes', strokeWidth: w,
        grooveAngle: 2 * Math.atan(w / 2 / p.depth) * 180 / Math.PI,
        strokes: (b) => [...linesInBox(a1, p.pitch, b), ...linesInBox(a2, p.pitch, b)],
      };
    },
  },
  noise: {
    label: 'noise', blurb: 'Fractal lumps: hammered, cast, cratered.',
    params: [P('scale', 'Lump size', 4, 120, 1, 28), P('octaves', 'Detail', 1, 6, 1, 3, ''), P('roughness', 'Roughness', 0.2, 0.8, 0.05, 0.5, ''),
      P('depth', 'Depth', 0.2, 6, 0.1, 2), S('style', 'Style', ['smooth', 'billow', 'ridged'], 'smooth'), P('seed', 'Seed', 1, 99, 1, 7, '')],
    build(p) {
      const o = { octaves: p.octaves | 0, roughness: p.roughness, seed: p.seed | 0 };
      const gain = 1.25 + 0.25 * (o.octaves - 1);
      // a soft limit (tanh), never a hard clamp: a clamp leaves flat uncut islands that read as a fault
      const t = (n) => p.style === 'ridged' ? 1 - Math.tanh(1.9 * Math.abs(n)) : p.style === 'billow' ? Math.tanh(2 * Math.abs(n)) : 0.5 + 0.5 * Math.tanh(gain * n);
      const finest = p.scale / Math.pow(2, o.octaves - 1);
      return { h: (u, v) => p.depth * (1 - t(fbm2(u / p.scale, v / p.scale, o))), depth: p.depth, feature: finest * 0.5, featureLabel: `~${fmt(finest * 0.5)} mm finest lumps`, kind: 'surface' };
    },
  },
  waves: {
    label: 'ocean waves', blurb: 'A sum of wave trains with sharp crests.',
    params: [P('wavelength', 'Wavelength', 6, 120, 1, 30), P('count', 'Waves', 1, 10, 1, 6, ''), P('spread', 'Spread', 0, 90, 1, 40, '°'),
      P('chop', 'Sharp crests', 1, 4, 0.1, 2.2, ''), P('warp', 'Wander', 0, 1, 0.05, 0.35, ''), P('depth', 'Depth', 0.2, 6, 0.1, 2.2), P('seed', 'Seed', 1, 99, 1, 3, '')],
    build(p) {
      const seed = p.seed | 0, N = Math.max(1, p.count | 0), sp = p.spread * Math.PI / 180;
      const W = [];
      let suma = 0, lmin = Infinity;
      for (let i = 0; i < N; i++) {
        const lam = p.wavelength * (i === 0 ? 1 : 0.45 + 0.8 * hash3(i, 2, 0, seed));
        const ang = i === 0 ? 0 : (hash3(i, 1, 0, seed) - 0.5) * 2 * sp;
        const a = lam / p.wavelength;
        W.push({ kx: Math.cos(ang) * TAU / lam, ky: Math.sin(ang) * TAU / lam, ph: hash3(i, 3, 0, seed) * TAU, a });
        suma += a; lmin = Math.min(lmin, lam);
      }
      // the single wave's mean and spread under the crest power, measured, so the sum fills the depth
      let m = 0, m2 = 0; const K = 256;
      for (let k = 0; k < K; k++) { const w = Math.pow(0.5 + 0.5 * Math.sin(k / K * TAU), p.chop); m += w; m2 += w * w; }
      m /= K; const sd = Math.sqrt(m2 / K - m * m) * Math.sqrt(W.reduce((s, w) => s + w.a * w.a, 0)) / suma;
      const wl = p.wavelength * 2.5, wa = p.warp * p.wavelength * 0.6;
      return {
        h: (u, v) => {
          const wu = u + wa * perlin2(u / wl, v / wl, seed + 5), wv = v + wa * perlin2(u / wl + 3.7, v / wl - 1.3, seed + 9);
          let s = 0;
          for (const w of W) s += w.a * Math.pow(0.5 + 0.5 * Math.sin(w.kx * wu + w.ky * wv + w.ph), p.chop);
          return p.depth * (0.5 - 0.5 * Math.tanh((s / suma - m) / (1.6 * sd + 1e-9)));
        },
        depth: p.depth, feature: lmin / 2, featureLabel: `${fmt(lmin / 2)} mm troughs`, kind: 'surface',
      };
    },
  },
  stone: {
    label: 'stone wall', blurb: 'Voronoi stones in mortar, each at its own height.',
    params: [P('size', 'Stone size', 6, 80, 1, 26), P('mortar', 'Mortar width', 0.8, 10, 0.1, 3.2), P('depth', 'Mortar depth', 0.3, 6, 0.1, 2.4),
      P('jitter', 'Stone heights', 0, 3, 0.05, 0.6), P('crown', 'Rounded edges', 0, 3, 0.05, 0.8), P('regular', 'Evenness', 0, 1, 0.05, 0.15, ''),
      P('rough', 'Stone texture', 0, 1, 0.05, 0.25), P('seed', 'Seed', 1, 99, 1, 11, '')],
    build(p) {
      const S = p.size, hm = p.mortar / 2, seed = p.seed | 0, jit = 1 - 0.95 * clamp01(p.regular);
      const roll = Math.max(0.5, S * 0.18);
      return {
        h: (u, v) => {
          const w = worley2(u / S, v / S, seed, jit);
          const e = w.edge * S;
          const t = clamp01((e - hm) / roll);
          let surf = p.jitter * w.id + p.crown * (1 - Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t))));
          if (p.rough > 0) surf += p.rough * (0.5 + 0.5 * fbm2(u / (S * 0.3), v / (S * 0.3), { octaves: 3, seed: seed + 77 }));
          return Math.min(p.depth, Math.max(surf, cap(e, hm, p.depth, 'ball')));
        },
        depth: p.depth, feature: p.mortar, featureLabel: `${fmt(p.mortar)} mm mortar joints`, kind: 'surface',
      };
    },
  },
  weave: {
    label: 'basket weave', blurb: 'Over-under strands, like woven cane.',
    params: [P('thread', 'Strand width', 3, 40, 0.5, 9), P('depth', 'Depth', 0.2, 5, 0.1, 1.8), S('draft', 'Weave', ['basket', 'plain', 'twill', 'satin', 'herring'], 'basket')],
    build(p) {
      return { h: (u, v) => p.depth * (1 - weave01(u / p.thread, v / p.thread, p.draft)), depth: p.depth, feature: p.thread * 0.5, featureLabel: `${fmt(p.thread)} mm strands`, kind: 'surface' };
    },
  },
  motif: {
    label: 'step & repeat', blurb: 'Any motif, stepped across the region.',
    params: [S('shape', 'Motif', Object.keys(MOTIFS), 'x'), P('size', 'Size', 4, 80, 0.5, 14), P('px', 'Step X', 4, 100, 0.5, 18), P('py', 'Step Y', 4, 100, 0.5, 18),
      S('stagger', 'Stagger', ['yes', 'no'], 'yes'), S('flip', 'Flip alternate rows', ['no', 'yes'], 'no'), P('width', 'Line width', 0.6, 10, 0.1, 2.4),
      P('depth', 'Depth', 0.2, 5, 0.1, 1.2), S('fill', 'Fill', ['outline', 'pocket'], 'outline'), S('profile', 'Profile', PROFILES, 'cone')],
    build(p) {
      const m = MOTIFS[p.shape] || MOTIFS.x, segs = motifSegs(m), sz = p.size, hw = p.width / 2;
      const pocket = p.fill === 'pocket' && m.closed;
      const stagger = p.stagger === 'yes' ? 0.5 : 0, flip = p.flip === 'yes';
      const reachR = sz * 0.55 + hw;
      const motif = (du, dv, i, j) => {
        if (Math.abs(du) > reachR || Math.abs(dv) > reachR) return 0;
        let x = du / sz, y = dv / sz;
        if (flip && (j & 1)) y = -y;
        let d = Infinity;
        for (const s of segs) { const q = segDist(x, y, s); if (q < d) d = q; }
        d *= sz;
        if (pocket && insidePoly(x, y, m.polys[0])) {
          const t = clamp01(d / hw);
          return p.depth * (p.profile === 'flat' ? 1 : p.profile === 'cone' ? Math.max(t, 0) : Math.sqrt(1 - (1 - t) * (1 - t)));
        }
        return pocket ? 0 : cap(d, hw, p.depth, p.profile);
      };
      return {
        h: stepRepeat(motif, { px: p.px, py: p.py, stagger, reach: Math.max(1, Math.ceil(reachR / Math.min(p.px, p.py))) }),
        depth: p.depth, feature: p.width, featureLabel: `${fmt(p.width)} mm lines`, kind: 'strokes', strokeWidth: p.width,
        strokes: (b) => {
          const out = [];
          for (const [cu, cv, , j] of latticeCenters(p.px, p.py, stagger, b)) {
            for (const poly of m.polys) {
              const pts = poly.map(([x, y]) => [cu + x * sz, cv + (flip && (j & 1) ? -y : y) * sz]);
              if (m.closed) pts.push(pts[0]);
              out.push(pts);
            }
          }
          return out;
        },
      };
    },
  },
};

// The one or two numbers that size each pattern: what a card shows first. The rest (and every
// seed, which a card can offer as a shuffle) are the pattern's finer points.
export const BASIC = {
  dots: ['pitch', 'diameter'], dashdot: ['sequence', 'width'], morse: ['text'], ribs: ['pitch', 'width'], knurl: ['pitch'],
  noise: ['scale'], waves: ['wavelength'], stone: ['size', 'mortar'], weave: ['thread'], motif: ['shape', 'size'],
};
// one word each, for a swatch's caption
const SHORT = { dots: 'dots', dashdot: 'dashes', morse: 'morse', ribs: 'flutes', knurl: 'knurl', noise: 'noise', waves: 'waves', stone: 'stone', weave: 'weave', motif: 'repeat' };
for (const id in PATTERNS) PATTERNS[id].short = SHORT[id] || PATTERNS[id].label;
for (const [id, ks] of Object.entries(BASIC)) for (const q of PATTERNS[id].params) {
  if (ks.includes(q.k)) q.basic = true;
  if (q.k === 'seed') q.shuffle = true;
}

export function defaults(id) {
  const o = {};
  for (const q of PATTERNS[id].params) o[q.k] = q.def;
  return o;
}

function fmt(v, d = 1) { return Number(v).toFixed(d).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1'); }

// ---------------------------------------------------------------------------------------------
// Region masks. Each gives sd(x, y): signed distance in mm, POSITIVE inside, and a bbox.

export function rectMask(x0, y0, x1, y1) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  return {
    bbox: { x0: ax, y0: ay, x1: bx, y1: by },
    sd(x, y) {
      const dx = Math.max(ax - x, x - bx), dy = Math.max(ay - y, y - by);
      if (dx <= 0 && dy <= 0) return -Math.max(dx, dy);
      return -Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
    },
  };
}
export function ellipseMask(cx, cy, rx, ry) {
  rx = Math.abs(rx); ry = Math.abs(ry);
  return {
    bbox: { x0: cx - rx, y0: cy - ry, x1: cx + rx, y1: cy + ry },
    sd(x, y) {
      const dx = x - cx, dy = y - cy, k = Math.hypot(dx / rx, dy / ry);
      if (k < 1e-9) return Math.min(rx, ry);
      const g = Math.hypot(dx / (rx * rx), dy / (ry * ry)) / k;
      return (1 - k) / g;
    },
  };
}
export function polygonMask(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const segs = pts.map((p, i) => [p[0], p[1], pts[(i + 1) % pts.length][0], pts[(i + 1) % pts.length][1]]);
  return {
    bbox: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
    sd(x, y) { let d = Infinity; for (const s of segs) d = Math.min(d, segDist(x, y, s)); return insidePoly(x, y, pts) ? d : -d; },
  };
}
// A painted mask: a 0/1 grid (nx * ny, cell `res` mm, origin x0, y0). A two-pass chamfer distance
// transform turns it into a signed distance, so a soft edge works on paint exactly as on a shape.
export function paintMask({ nx, ny, res, x0 = 0, y0 = 0, data }) {
  const N = nx * ny, inD = new Float32Array(N), outD = new Float32Array(N);
  const BIG = 1e9, a = 1, b = Math.SQRT2;
  for (let i = 0; i < N; i++) { inD[i] = data[i] ? BIG : 0; outD[i] = data[i] ? 0 : BIG; }
  for (const D of [inD, outD]) {
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; let v = D[k]; if (v === 0) continue;
      if (i > 0) v = Math.min(v, D[k - 1] + a);
      if (j > 0) { v = Math.min(v, D[k - nx] + a); if (i > 0) v = Math.min(v, D[k - nx - 1] + b); if (i < nx - 1) v = Math.min(v, D[k - nx + 1] + b); }
      D[k] = v;
    }
    for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i; let v = D[k]; if (v === 0) continue;
      if (i < nx - 1) v = Math.min(v, D[k + 1] + a);
      if (j < ny - 1) { v = Math.min(v, D[k + nx] + a); if (i < nx - 1) v = Math.min(v, D[k + nx + 1] + b); if (i > 0) v = Math.min(v, D[k + nx - 1] + b); }
      D[k] = v;
    }
  }
  const sdg = new Float32Array(N);
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    sdg[k] = data[k] ? (inD[k] - 0.5) * res : -(outD[k] - 0.5) * res;
    if (data[k]) { const x = x0 + (i + 0.5) * res, y = y0 + (j + 0.5) * res; bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
  }
  const empty = !(bx1 >= bx0);
  return {
    empty,
    bbox: empty ? { x0: 0, y0: 0, x1: 0, y1: 0 } : { x0: bx0 - res, y0: by0 - res, x1: bx1 + res, y1: by1 + res },
    sd(x, y) {
      const fx = (x - x0) / res - 0.5, fy = (y - y0) / res - 0.5;
      if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return -res;
      const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(ny - 2, Math.floor(fy)), tx = fx - i, ty = fy - j, k = j * nx + i;
      return lerp(lerp(sdg[k], sdg[k + 1], tx), lerp(sdg[k + nx], sdg[k + nx + 1], tx), ty);
    },
  };
}
export function unionMask(masks) {
  return {
    bbox: { x0: Math.min(...masks.map((m) => m.bbox.x0)), y0: Math.min(...masks.map((m) => m.bbox.y0)), x1: Math.max(...masks.map((m) => m.bbox.x1)), y1: Math.max(...masks.map((m) => m.bbox.y1)) },
    sd(x, y) { let d = -Infinity; for (const m of masks) d = Math.max(d, m.sd(x, y)); return d; },
  };
}
export function makeMask(spec) {
  if (!spec) return null;
  if (spec.sd) return spec;
  switch (spec.type) {
    case 'rect': return rectMask(spec.x0, spec.y0, spec.x1, spec.y1);
    case 'ellipse': return ellipseMask(spec.cx, spec.cy, spec.rx, spec.ry);
    case 'polygon': return polygonMask(spec.pts);
    case 'paint': return paintMask(spec);
    case 'union': return unionMask(spec.masks.map(makeMask));
  }
  throw new Error('unknown mask ' + spec.type);
}
// 0..1 inside the region; the soft edge ramps from the boundary inward over `soft` mm.
export function maskWeight(mask, soft = 0) {
  if (!mask) return () => 1;
  if (soft <= 0) return (x, y) => (mask.sd(x, y) >= 0 ? 1 : 0);
  return (x, y) => { const d = mask.sd(x, y); return d <= 0 ? 0 : d >= soft ? 1 : smoothstep(d / soft); };
}

// ---------------------------------------------------------------------------------------------
// texture(spec): pattern + params + transform + region + soft edge (+ an overlay layer) -> one h.
//
//   spec = { pattern, params, transform: { angle (deg), scale, ox, oy }, mask, soft,
//            overlay: { pattern, params, mode: 'add'|'max', amount } }

export function texture(spec) {
  const pat = PATTERNS[spec.pattern];
  if (!pat) throw new Error('unknown pattern ' + spec.pattern);
  const params = { ...defaults(spec.pattern), ...(spec.params || {}) };
  const base = pat.build(params);
  const tr = spec.transform || {};
  const ang = (tr.angle || 0) * Math.PI / 180, c = Math.cos(ang), s = Math.sin(ang), sc = tr.scale || 1;
  const ox = tr.ox || 0, oy = tr.oy || 0;
  const toU = (x, y) => (c * (x - ox) + s * (y - oy)) / sc;
  const toV = (x, y) => (-s * (x - ox) + c * (y - oy)) / sc;
  const toX = (u, v) => ox + (c * u - s * v) * sc;
  const toY = (u, v) => oy + (s * u + c * v) * sc;
  let hb = (x, y) => base.h(toU(x, y), toV(x, y));
  let depth = base.depth, feature = base.feature * sc;
  if (spec.overlay && spec.overlay.amount > 0) {
    const op = { ...defaults(spec.overlay.pattern), ...(spec.overlay.params || {}) };
    const ob = PATTERNS[spec.overlay.pattern].build(op);
    const oh = (x, y) => ob.h(toU(x, y), toV(x, y)) / ob.depth;
    hb = blend(hb, oh, spec.overlay.mode || 'add', spec.overlay.amount);
    depth += spec.overlay.amount;
  }
  const mask = makeMask(spec.mask);
  const w = maskWeight(mask, spec.soft || 0);
  const h = (x, y) => { const m = w(x, y); return m > 0 ? hb(x, y) * m : 0; };
  const bbox = mask ? mask.bbox : (spec.board ? { x0: 0, y0: 0, x1: spec.board.w, y1: spec.board.h } : { x0: -50, y0: -50, x1: 50, y1: 50 });
  const localBox = (pad = 0) => {
    const cs = [[bbox.x0, bbox.y0], [bbox.x1, bbox.y0], [bbox.x0, bbox.y1], [bbox.x1, bbox.y1]];
    const us = cs.map(([x, y]) => toU(x, y)), vs = cs.map(([x, y]) => toV(x, y));
    return { u0: Math.min(...us) - pad, u1: Math.max(...us) + pad, v0: Math.min(...vs) - pad, v1: Math.max(...vs) + pad };
  };
  return {
    pattern: spec.pattern, label: pat.label, params, h, w, mask, bbox, depth, feature, kind: base.kind,
    featureLabel: base.featureLabel, base, scale: sc, code: base.code,
    strokeWidth: base.strokeWidth ? base.strokeWidth * sc : 0,
    dotDiameter: base.dotDiameter ? base.dotDiameter * sc : 0,
    grooveAngle: base.grooveAngle,
    // Dot centers inside the region, depth scaled by the soft edge.
    dots() {
      if (!base.dots) return [];
      const out = [];
      for (const [u, v, d] of base.dots(localBox(base.feature))) {
        const x = toX(u, v), y = toY(u, v);
        if (x < bbox.x0 || x > bbox.x1 || y < bbox.y0 || y > bbox.y1) continue;
        const m = w(x, y);
        if (m >= 0.5) out.push({ x, y, depth: d * m });
      }
      return out;
    },
    // Centerlines clipped to the region by sampling: [{ pts: [{ x, y, m }], width, depth }].
    strokes(step = 0.5) {
      if (!base.strokes) return [];
      const out = [];
      for (const poly of base.strokes(localBox(base.strokeWidth || 0))) {
        const W = poly.map(([u, v]) => [toX(u, v), toY(u, v)]);
        if (W.length === 1) { const m = w(W[0][0], W[0][1]); if (m > 0.05) out.push({ pts: [{ x: W[0][0], y: W[0][1], m }] }); continue; }
        let run = [];
        const flush = () => { if (run.length) out.push({ pts: run }); run = []; };
        for (let i = 1; i < W.length; i++) {
          const [ax, ay] = W[i - 1], [bx, by] = W[i], L = Math.hypot(bx - ax, by - ay);
          const n = Math.max(1, Math.ceil(L / step));
          for (let k = (i === 1 ? 0 : 1); k <= n; k++) {
            const x = lerp(ax, bx, k / n), y = lerp(ay, by, k / n), m = w(x, y);
            if (m > 0.05) run.push({ x, y, m }); else flush();
          }
        }
        flush();
      }
      for (const s of out) { s.width = base.strokeWidth * sc; s.depth = base.depth; s.pts = decimateXY(s.pts, 0.01); }
      return out;
    },
  };
}

// Drop collinear points (xy and m) from a sampled polyline.
function decimateXY(pts, tol) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const ex = c.x - a.x, ey = c.y - a.y, L = Math.hypot(ex, ey) || 1;
    const off = Math.abs((b.x - a.x) * ey - (b.y - a.y) * ex) / L;
    const t = clamp01(((b.x - a.x) * ex + (b.y - a.y) * ey) / (L * L));
    if (off > tol || Math.abs(b.m - lerp(a.m, c.m, t)) > 0.02) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Tools. prof(rho) = height of the cutter's surface above its tip at radius rho (Infinity off it).

export const TOOLS = {
  ball18: { id: 'ball18', name: '1/8 in ball', type: 'ball', diameter: 3.175 },
  ball14: { id: 'ball14', name: '1/4 in ball', type: 'ball', diameter: 6.35 },
  v60: { id: 'v60', name: '60° V-bit', type: 'v', angle: 60, diameter: 12.7 },
  v90: { id: 'v90', name: '90° V-bit', type: 'v', angle: 90, diameter: 12.7 },
  flat14: { id: 'flat14', name: '1/4 in flat', type: 'flat', diameter: 6.35 },
  flat18: { id: 'flat18', name: '1/8 in flat', type: 'flat', diameter: 3.175 },
};

export function makeTool(t) {
  if (typeof t === 'string') t = TOOLS[t];
  const R = t.diameter / 2, ta = t.type === 'v' ? Math.tan(t.angle * Math.PI / 360) : 0;
  const prof = t.type === 'ball' ? (r) => (r > R ? Infinity : R - Math.sqrt(Math.max(0, R * R - r * r)))
    : t.type === 'v' ? (r) => (r > R ? Infinity : r / ta)
      : (r) => (r > R ? Infinity : 0);
  // How wide a cut is at depth d: the narrowest dent or groove this tool can make that deep.
  const widthAt = (d) => t.type === 'ball' ? (d >= R ? 2 * R : 2 * Math.sqrt(Math.max(0, 2 * R * d - d * d)))
    : t.type === 'v' ? Math.min(2 * R, 2 * d * ta) : 2 * R;
  return { ...t, R, tanHalf: ta, prof, widthAt };
}

// The cutter's footprint as sample offsets (a square lattice plus its exact rim), sorted by prof so
// a drop can stop early: once the best height so far beats -prof, nothing further can raise it.
export function toolOffsets(tool, res, maxDepth = Infinity) {
  const R = tool.R, n = Math.ceil(R / res), pts = [];
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    const dx = i * res, dy = j * res, r = Math.hypot(dx, dy);
    if (r > R + 1e-9) continue;
    const p = tool.prof(Math.min(r, R));
    if (p <= maxDepth + 1e-9) pts.push([dx, dy, p]);
  }
  if (tool.prof(R) <= maxDepth + 1e-9) {
    const m = Math.max(8, Math.ceil(TAU * R / res));
    for (let k = 0; k < m; k++) { const a = k / m * TAU; pts.push([R * Math.cos(a), R * Math.sin(a), tool.prof(R)]); }
  }
  pts.sort((a, b) => a[2] - b[2]);
  return { n: pts.length, dx: Float64Array.from(pts, (p) => p[0]), dy: Float64Array.from(pts, (p) => p[1]), p: Float64Array.from(pts, (p) => p[2]) };
}

// Classic drop cutter: the lowest tip z at (x, y) where no point of the cutter dips below the target
// surface z = -h. Exact against `hFn` at the footprint samples.
export function dropCutter(hFn, tool, x, y, { res = 0.25, maxDepth = Infinity, offsets } = {}) {
  const o = offsets || toolOffsets(tool, res, maxDepth);
  let best = -Infinity;
  for (let k = 0; k < o.n; k++) {
    if (best >= -o.p[k]) break;
    const z = -hFn(x + o.dx[k], y + o.dy[k]) - o.p[k];
    if (z > best) best = z;
  }
  return Math.max(best, -maxDepth);
}

// h sampled on a grid, bilinear between nodes, 0 (the top) outside.
export function heightGrid(hFn, x0, y0, nx, ny, res) {
  const data = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) data[j * nx + i] = hFn(x0 + i * res, y0 + j * res);
  const sample = (x, y) => {
    const fx = (x - x0) / res, fy = (y - y0) / res;
    if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return 0;
    const i = Math.min(nx - 2, fx | 0), j = Math.min(ny - 2, fy | 0), tx = fx - i, ty = fy - j, k = j * nx + i;
    return (data[k] * (1 - tx) + data[k + 1] * tx) * (1 - ty) + (data[k + nx] * (1 - tx) + data[k + nx + 1] * tx) * ty;
  };
  return { data, nx, ny, res, x0, y0, sample };
}

// Stepover for a target scallop height. Ball: the chord where two passes' circles meet h above
// the bottom, 2*sqrt(2*r*h - h^2) — which is the familiar 2*sqrt(2*r*h) for small h. V-bit: two
// V's whose walls cross h up, 2*h*tan(half angle). Flat end mill: no scallop on a flat floor, so 40%.
export function stepoverForScallop(tool, scallop) {
  tool = tool.prof ? tool : makeTool(tool);
  if (tool.type === 'ball') return 2 * Math.sqrt(Math.max(0, 2 * tool.R * scallop - scallop * scallop));
  if (tool.type === 'v') return Math.max(0.05, 2 * scallop * tool.tanHalf);
  return 0.4 * tool.diameter;
}

// ---------------------------------------------------------------------------------------------
// Toolpaths. All return moves [{ x, y, z, rapid }] in part coordinates.

function pathContext(tex, tool, o) {
  tool = tool.prof ? tool : makeTool(tool);
  const res = o.res || 0.25, maxDepth = o.maxDepth ?? Infinity;
  const b = tex.bbox, pad = tool.R + 2 * res;
  const x0 = b.x0 - pad, y0 = b.y0 - pad;
  const nx = Math.ceil((b.x1 - b.x0 + 2 * pad) / res) + 1, ny = Math.ceil((b.y1 - b.y0 + 2 * pad) / res) + 1;
  const H = heightGrid(tex.h, x0, y0, nx, ny, res);
  const offs = toolOffsets(tool, res, Number.isFinite(maxDepth) ? maxDepth : tex.depth + 0.01);
  const drop = (x, y) => dropCutter(H.sample, tool, x, y, { offsets: offs, maxDepth });
  return { tool, res, maxDepth, H, offs, drop, b };
}

function emitter(o) {
  const moves = [], safeZ = o.safeZ ?? 5, clearZ = o.clearZ ?? 1;
  let cur = null;
  const push = (x, y, z, rapid) => { moves.push({ x, y, z, rapid }); cur = { x, y, z }; };
  return {
    moves,
    // retract, rapid over, rapid down near the top, feed down to z (a plunge)
    travelTo(x, y, z) {
      if (!cur) push(x, y, safeZ, true);
      else { if (cur.z < safeZ) push(cur.x, cur.y, safeZ, true); push(x, y, safeZ, true); }
      push(x, y, Math.max(clearZ, z), true);
      if (z < clearZ) push(x, y, z, false);
    },
    feed(x, y, z) { push(x, y, z, false); },
    retract() { if (cur && cur.z < safeZ) push(cur.x, cur.y, safeZ, true); },
    get cur() { return cur; },
  };
}

// Keep the ends and every point a straight line would miss by more than tol in z.
function decimateRun(run, tol = 0.004) {
  if (run.length <= 2) return run;
  const out = [run[0]];
  let a = 0;
  for (let e = 2; e < run.length; e++) {
    let ok = e - a <= 400;
    for (let k = a + 1; ok && k < e; k++) {
      const t = (k - a) / (e - a);
      if (Math.abs(run[k][2] - lerp(run[a][2], run[e][2], t)) > tol) ok = false;
    }
    if (!ok) { out.push(run[e - 1]); a = e - 1; }
  }
  out.push(run[run.length - 1]);
  return out;
}

// Parallel raster from the drop cutter. Rows run along `angle`, `stepover` apart (or derived from
// the scallop height), serpentine, only where the cutter actually goes below the top; short hops
// between rows feed along a dropped line instead of retracting. Deep textures go in step-down layers.
export function rasterPath(tex, toolIn, o = {}) {
  const ctx = pathContext(tex, toolIn, o);
  const { tool, res, drop, b } = ctx;
  const stepover = o.stepover || stepoverForScallop(tool, o.scallop ?? 0.05);
  const E = emitter(o);
  const deepest = Math.min(tex.depth, ctx.maxDepth);
  const sd = o.stepDown > 0 ? o.stepDown : Infinity;
  const floors = [];
  for (let f = -sd; f > -deepest; f -= sd) floors.push(f);
  floors.push(-Infinity);
  const angles = [o.angle || 0];
  if (o.crossHatch) angles.push((o.angle || 0) + 90);
  const eps = 0.02;
  for (const angDeg of angles) {
    const a = angDeg * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
    const cs = [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]];
    const T = cs.map(([x, y]) => x * dx + y * dy), N = cs.map(([x, y]) => x * nx + y * ny);
    const t0 = Math.min(...T), t1 = Math.max(...T), n0 = Math.min(...N), n1 = Math.max(...N);
    const rowsN = Math.max(1, Math.round((n1 - n0) / stepover) + 1);
    const nStep = rowsN > 1 ? (n1 - n0) / (rowsN - 1) : 0;
    const ptsN = Math.max(2, Math.ceil((t1 - t0) / res) + 1);
    // drop every row once; layers reuse the same Z
    const rows = [];
    for (let r = 0; r < rowsN; r++) {
      const n = n0 + r * nStep, Z = new Float32Array(ptsN);
      let any = false;
      for (let k = 0; k < ptsN; k++) {
        const t = t0 + (t1 - t0) * k / (ptsN - 1);
        Z[k] = drop(n * nx + t * dx, n * ny + t * dy);
        if (Z[k] < -eps) any = true;
      }
      rows.push(any ? { n, Z } : null);
    }
    let prevFloor = 0;
    for (const floor of floors) {
      let flip = false;
      for (const row of rows) {
        if (!row) continue;
        const { n, Z } = row;
        // runs where this layer has material to take: the drop is below the last layer's floor
        const active = (k) => Z[k] < prevFloor - eps;
        const runs = [];
        let k = 0;
        while (k < ptsN) {
          if (!active(k)) { k++; continue; }
          const s = Math.max(0, k - 1);
          while (k < ptsN && active(k)) k++;
          runs.push([s, Math.min(ptsN - 1, k)]);
        }
        if (!runs.length) continue;
        if (flip) { runs.reverse(); for (const r of runs) r.reverse(); }
        flip = !flip;
        for (const [s, e] of runs) {
          const st = s <= e ? 1 : -1, run = [];
          for (let q = s; ; q += st) {
            const t = t0 + (t1 - t0) * q / (ptsN - 1);
            run.push([n * nx + t * dx, n * ny + t * dy, Math.max(Z[q], floor)]);
            if (q === e) break;
          }
          const pts = decimateRun(run);
          const [sx, sy, sz] = pts[0];
          const cur = E.cur;
          const hop = cur ? Math.hypot(cur.x - sx, cur.y - sy) : Infinity;
          if (cur && cur.z <= 0 && hop <= 2.5 * stepover + res) {
            // feed across along a dropped line: never below the target, never below this layer
            const m = Math.max(1, Math.ceil(hop / res));
            for (let i = 1; i < m; i++) {
              const x = lerp(cur.x, sx, i / m), y = lerp(cur.y, sy, i / m);
              E.feed(x, y, Math.min(0, Math.max(drop(x, y), floor)));
            }
            E.feed(sx, sy, sz);
          } else E.travelTo(sx, sy, sz);
          for (let i = 1; i < pts.length; i++) E.feed(pts[i][0], pts[i][1], pts[i][2]);
        }
      }
      prevFloor = floor;
    }
  }
  E.retract();
  return { moves: E.moves, stepover, tool, strategy: o.crossHatch ? 'raster + cross-hatch' : 'raster' };
}

// One plunge per dot, straight down to the dot's depth (in step-down stages if asked), serpentine
// by row. Much faster than rastering — and the cutter's own shape becomes the dot's shape.
export function plungeDots(tex, toolIn, o = {}) {
  const tool = toolIn.prof ? toolIn : makeTool(toolIn);
  const E = emitter(o), maxDepth = o.maxDepth ?? Infinity, sd = o.stepDown > 0 ? o.stepDown : Infinity;
  const dots = tex.dots();
  const rowTol = Math.max(0.5, (tex.feature || 1) * 0.5);
  dots.sort((a, b) => Math.round(a.y / rowTol) - Math.round(b.y / rowTol) || a.x - b.x);
  // serpentine: flip every other row
  const rows = [];
  for (const d of dots) { const r = Math.round(d.y / rowTol); if (!rows.length || rows[rows.length - 1].r !== r) rows.push({ r, list: [] }); rows[rows.length - 1].list.push(d); }
  const ordered = rows.flatMap((r, i) => (i % 2 ? r.list.slice().reverse() : r.list));
  for (const d of ordered) {
    const zb = -Math.min(d.depth, maxDepth);
    E.travelTo(d.x, d.y, o.clearZ ?? 1);
    for (let z = -sd; z > zb; z -= sd) E.feed(d.x, d.y, z);
    E.feed(d.x, d.y, zb);
    E.retract();
  }
  return { moves: E.moves, tool, strategy: 'plunge each dot', dots: ordered.length };
}

// Centerline engraving for strokes (dashes, Morse, flutes, knurl, motif outlines). A V-bit cuts as
// deep as it must to be the groove's width at the top; a ball or flat follows at the design depth.
// The soft edge tapers the depth, which with a V-bit also tapers the width.
export function centerlinePath(tex, toolIn, o = {}) {
  const tool = toolIn.prof ? toolIn : makeTool(toolIn);
  const E = emitter(o), maxDepth = o.maxDepth ?? Infinity, sd = o.stepDown > 0 ? o.stepDown : Infinity;
  const strokes = tex.strokes();
  const zFor = (s, m) => {
    const d = tool.type === 'v' ? (s.width / 2) / tool.tanHalf : s.depth;
    return -Math.min(d, maxDepth) * m;
  };
  // nearest-neighbor order from the front-left
  const left = strokes.slice(), ordered = [];
  let cx = tex.bbox.x0, cy = tex.bbox.y0;
  while (left.length) {
    let bi = 0, bd = Infinity, rev = false;
    for (let i = 0; i < left.length; i++) {
      const p = left[i].pts, a = p[0], z = p[p.length - 1];
      const da = Math.hypot(a.x - cx, a.y - cy), dz = Math.hypot(z.x - cx, z.y - cy);
      if (da < bd) { bd = da; bi = i; rev = false; }
      if (dz < bd) { bd = dz; bi = i; rev = true; }
    }
    const s = left.splice(bi, 1)[0];
    if (rev) s.pts.reverse();
    ordered.push(s);
    const e = s.pts[s.pts.length - 1]; cx = e.x; cy = e.y;
  }
  for (const s of ordered) {
    const zs = s.pts.map((p) => zFor(s, p.m));
    const zmin = Math.min(...zs);
    // pass at successive floors for deep grooves; the last pass is the true depth
    const floors = [];
    for (let f = -sd; f > zmin; f -= sd) floors.push(f);
    floors.push(-Infinity);
    for (let li = 0; li < floors.length; li++) {
      const f = floors[li];
      const fwd = li % 2 === 0, pts = fwd ? s.pts : s.pts.slice().reverse(), zz = fwd ? zs : zs.slice().reverse();
      if (li === 0) E.travelTo(pts[0].x, pts[0].y, Math.max(zz[0], f));
      else E.feed(pts[0].x, pts[0].y, Math.max(zz[0], f));
      for (let i = 1; i < pts.length; i++) E.feed(pts[i].x, pts[i].y, Math.max(zz[i], f));
    }
    E.retract();
  }
  return { moves: E.moves, tool, strategy: tool.type === 'v' ? 'V-carve centerline' : 'engrave centerline', strokes: ordered.length };
}

// One entry point: strategy 'raster' | 'crosshatch' | 'plunge' | 'centerline'.
export function toolpath(tex, tool, o = {}) {
  const st = o.strategy || 'raster';
  if (st === 'plunge') return plungeDots(tex, tool, o);
  if (st === 'centerline') return centerlinePath(tex, tool, o);
  return rasterPath(tex, tool, { ...o, crossHatch: st === 'crosshatch' || o.crossHatch });
}

// ---------------------------------------------------------------------------------------------
// Time. Feeds in mm/s. Router-table rapids. Every feed vertex pays a small corner cost, because a
// router on thousands of tiny segments never reaches its programmed feed (a guess, flagged).
export function estimateTime(moves, { feed = 38, plunge = 12.7, rapidXY = 50, rapidZ = 25, corner = 0.012 } = {}) {
  let sec = 0, cut = 0, rapid = 0, plunges = 0;
  for (let i = 1; i < moves.length; i++) {
    const a = moves[i - 1], b = moves[i];
    const dxy = Math.hypot(b.x - a.x, b.y - a.y), dz = b.z - a.z;
    if (b.rapid) { sec += Math.max(dxy / rapidXY, Math.abs(dz) / rapidZ); rapid += Math.hypot(dxy, dz); continue; }
    const L = Math.hypot(dxy, dz);
    cut += L;
    if (dxy < 1e-6 && dz < -0.05) plunges++;
    sec += Math.max(dxy / feed, dz < 0 ? -dz / plunge : 0, L / Math.max(feed, plunge)) + corner;
  }
  return { seconds: sec, cutMm: cut, rapidMm: rapid, plunges, moves: moves.length };
}

export function formatTime(s) {
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  if (m < 10) return `${m} min ${r ? r + ' s' : ''}`.trim();
  if (m < 60) return `${m + (r >= 30 ? 1 : 0)} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

// ---------------------------------------------------------------------------------------------
// Plain-language checks: can this tool make this pattern?

export function analyze(tex, toolIn, o = {}) {
  const tool = toolIn.prof ? toolIn : makeTool(toolIn);
  const maxDepth = o.maxDepth ?? Infinity;
  const d = Math.min(tex.depth, maxDepth);
  const wAt = tool.widthAt(d);
  const warnings = [], notes = [];
  // lengths said the app's way (o.len: v mm -> '1/8 in'); millimeters by default
  const L1 = o.len || ((v) => `${fmt(v, 1)} mm`), L2 = o.len || ((v) => `${fmt(v, 2)} mm`);
  const finest = tool.type === 'v' ? Math.max(0.2, wAt) : wAt;
  // the pattern's own words ("6.5 mm dots") at its placed size, in the app's units
  const featureLabel = String(tex.featureLabel || '').replace(/([\d.]+) mm/, (m, v) => L1(+v * (tex.scale || 1)));
  notes.push(`${tool.name}: ${tool.type === 'v' ? `${L1(wAt)} wide at ${L1(d)} deep, finer when shallower` : `the narrowest cut it makes ${L1(d)} deep is ${L1(wAt)}`}.`);
  if (tex.depth > maxDepth + 1e-6) warnings.push(`The pattern goes ${L1(tex.depth)} deep; max depth is ${L1(maxDepth)}, so the deepest parts come out flat at ${L1(maxDepth)}.`);
  if (tex.kind === 'dots' && tex.dotDiameter) {
    const D = tex.dotDiameter, dp = Math.min(tex.params.depth, maxDepth);
    if (tool.widthAt(dp) > D * 1.03) {
      const dent = tool.widthAt(dp);
      const pr = tool.type === 'ball' ? 'ball' : tool.type === 'v' ? 'cone' : 'flat';
      // how deep a no-gouge raster gets at a dot's center
      const mx = (tex.bbox.x0 + tex.bbox.x1) / 2, my = (tex.bbox.y0 + tex.bbox.y1) / 2;
      const c = tex.dots().reduce((b, q) => (!b || Math.hypot(q.x - mx, q.y - my) < Math.hypot(b.x - mx, b.y - my) ? q : b), null);
      const reach = c ? -dropCutter(tex.h, tool, c.x, c.y, { res: Math.min(0.1, D / 20) }) : 0;
      warnings.push(`A ${tool.name} can't make ${L1(D)} dots ${L1(dp)} deep${tool.type === 'flat' ? ` — it is ${L2(tool.diameter)} across` : ''}. Plunged, it would make ${L1(dent)} dents; rastered without gouging it only gets ${L2(reach)} deep at each dot's center.`);
      if (pr !== tex.params.profile && tool.type !== 'ball') notes.push(`Plunged dots take the cutter's shape: ${pr}-bottomed, not ${tex.params.profile}.`);
    } else if (o.strategy === 'plunge' && tool.type === 'ball' && tex.params.profile === 'ball') {
      notes.push(`Plunged dots will be ${L1(tool.widthAt(dp))} across with the ball's own ${L2(tool.R)} radius.`);
    }
  } else if (tex.kind === 'strokes' && tex.pattern === 'knurl') {
    const ga = tex.grooveAngle;
    if (tool.type === 'v' && Math.abs(tool.angle - ga) > 3) warnings.push(`These grooves are ${fmt(ga, 0)}° V's; a ${tool.name} ${tool.angle > ga ? 'is too blunt to reach the bottom of them' : 'will cut them narrower than drawn'}. ${fmt(ga, 0)}° matches; or change Spacing/Depth.`);
    if (tool.type !== 'v') warnings.push(`Knurl grooves come to a sharp V at the bottom; a ${tool.name} can't reach it and rounds every valley. A V-bit at ${fmt(ga, 0)}° cuts it exactly in two passes (Centerline).`);
  } else if (tex.kind === 'strokes' && tex.strokeWidth && tex.params.fill !== 'pocket') {
    const W = tex.strokeWidth, dp = Math.min(tex.params.depth, maxDepth);
    if (tool.type !== 'v' && tool.widthAt(dp) > W * 1.03) warnings.push(`A ${tool.name} can't cut ${L1(W)} grooves ${L1(dp)} deep; the narrowest groove it can cut that deep is ${L1(tool.widthAt(dp))}. Raster will leave them shallower; centerline will cut them wider.`);
    if (tool.type === 'v' && o.strategy === 'centerline') {
      const need = (W / 2) / tool.tanHalf;
      notes.push(`V-carve: to be ${L1(W)} wide the ${tool.name} cuts ${L2(Math.min(need, maxDepth))} deep (design says ${L1(dp)}) with a V bottom.`);
      if (need > maxDepth) warnings.push(`To be ${L1(W)} wide the ${tool.name} would need ${L2(need)} of depth; max depth stops it at ${L1(maxDepth)}, so grooves come out ${L1(2 * maxDepth * tool.tanHalf)} wide.`);
    }
  } else if (tex.kind === 'surface') {
    const F = tex.feature;
    if (tool.type === 'flat') warnings.push(`A flat end mill leaves stair-steps and flat-bottomed valleys on a curved texture; a ball nose follows the slopes.`);
    if (tool.type !== 'v' && tool.widthAt(Math.min(d, tool.R)) > F * 1.6) notes.push(`The finest detail here is about ${L1(F)} (${featureLabel}); a ${tool.name} rounds over anything narrower than ~${L1(tool.widthAt(Math.min(d, tool.R)))}, so the finest detail softens.`);
  }
  return { finest, widthAtDepth: wAt, warnings, notes, tool };
}

// ---------------------------------------------------------------------------------------------
// Material-removal simulation on a heightmap of the board's top (z = 0 untouched, negative = cut).
// Each feed move is swept by stamping the cutter at steps no longer than half a cell.

export function createSim({ x0 = 0, y0 = 0, nx, ny, res }, toolIn) {
  const tool = toolIn.prof ? toolIn : makeTool(toolIn);
  const Z = new Float32Array(nx * ny);
  const n = Math.ceil(tool.R / res) + 1;
  const offs = [];
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) { const r = Math.hypot(i, j) * res; if (r <= tool.R + res) offs.push([i, j, Math.max(0, r - res * 0.7072)]); }
  offs.sort((a, b) => a[2] - b[2]);
  const oi = Int32Array.from(offs, (o) => o[0]), oj = Int32Array.from(offs, (o) => o[1]);
  const lowProf = Float64Array.from(offs, (o) => tool.prof(Math.min(o[2], tool.R)));
  let rapidCuts = 0;
  const stamp = (x, y, z) => {
    const ci = Math.round((x - x0) / res), cj = Math.round((y - y0) / res);
    for (let k = 0; k < oi.length; k++) {
      if (z + lowProf[k] >= 0) break;            // nothing this far out can reach below the top
      const i = ci + oi[k], j = cj + oj[k];
      if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      const rr = Math.hypot(x0 + i * res - x, y0 + j * res - y);
      if (rr > tool.R) continue;
      const zc = z + tool.prof(rr), q = j * nx + i;
      if (zc < Z[q]) Z[q] = zc;
    }
  };
  let last = null;
  return {
    Z, tool,
    run(moves, from = 0, to = moves.length) {
      for (let m = from; m < to; m++) {
        const b = moves[m];
        if (last && !b.rapid) {
          const L = Math.hypot(b.x - last.x, b.y - last.y, b.z - last.z), st = Math.max(1, Math.ceil(L / (res * 0.5)));
          for (let s = 1; s <= st; s++) { const t = s / st; stamp(lerp(last.x, b.x, t), lerp(last.y, b.y, t), lerp(last.z, b.z, t)); }
        } else if (b.rapid && b.z < 0) rapidCuts++;
        last = b;
      }
      return to;
    },
    get rapidCuts() { return rapidCuts; },
  };
}

export function simulate(moves, grid, tool) { const s = createSim(grid, tool); s.run(moves); return s.Z; }

// How close the cut came to the design, over the textured area.
export function compare(Z, grid, tex, tol = 0.1) {
  const { x0 = 0, y0 = 0, nx, ny, res } = grid;
  let n = 0, within = 0, left = 0, maxLeft = 0, over = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * res, y = y0 + j * res;
    if (x < tex.bbox.x0 || x > tex.bbox.x1 || y < tex.bbox.y0 || y > tex.bbox.y1) continue;
    if (tex.w(x, y) <= 0) continue;
    const ideal = -tex.h(x, y), z = Z[j * nx + i], e = z - ideal;
    n++;
    if (Math.abs(e) <= tol) within++;
    if (e > 0) { left += e; if (e > maxLeft) maxLeft = e; }
    if (e < -tol) over++;
  }
  return { cells: n, within: n ? within / n : 1, meanLeft: n ? left / n : 0, maxLeft, overcut: n ? over / n : 0 };
}

// ---------------------------------------------------------------------------------------------
// Marks: what an app keeps on a part. All in the part's own frame, mm.
//
//   mark = {
//     id,                 a step key: copies of a part share their marks' ids
//     region: { type: 'paint', x0, y0, res, nx, ny, runs }   painted cells, run-length coded
//           | { type: 'rect' | 'ellipse' | 'polygon' | 'union', ... }  (makeMask's shapes)
//     xf: [a, b, c, d, e, f]   the mark's frame to the part's: x' = a x + b y + e, y' = c x + d y + f
//                              (the part's turns, scales and mirrors after it was marked)
//     fill: { fill: 'texture', pattern, params, scale, angle, origin: [x, y], fade, depth, tool,
//             path: 'auto' | 'raster' | 'crosshatch' | 'plunge' | 'centerline', grit }
//           | { fill: 'pierce', ... }   (later: through cuts from the same region)
//   }
//
// The region and the pattern both live in the mark's frame, so a mark scales, turns and mirrors
// with its part as a picture would; its depth stays the depth.

export const FILLS = { texture: 'texture', pierce: 'pierce' };
export const PATHS = ['auto', 'raster', 'crosshatch', 'plunge', 'centerline'];
export const IDENTITY = [1, 0, 0, 1, 0, 0];

// run-length coding of a 0/1 grid: run lengths, alternating, starting with a run of 0s
export function encodeRuns(data) {
  const out = [];
  let v = 0, n = 0;
  for (let i = 0; i < data.length; i++) {
    const d = data[i] ? 1 : 0;
    if (d === v) n++;
    else { out.push(n); v = d; n = 1; }
  }
  out.push(n);
  return out;
}
export function decodeRuns(runs, size) {
  const data = new Uint8Array(size);
  let at = 0, v = 0;
  for (const n of runs || []) { if (v) data.fill(1, at, Math.min(size, at + n)); at += n; v ^= 1; }
  return data;
}

// a paint grid over a box (mm), at about `res` mm a cell, kept under `cap` cells
export function newGrid(x0, y0, x1, y1, res = 0.5, cap = 4e6) {
  const w = Math.max(res, x1 - x0), h = Math.max(res, y1 - y0);
  res = Math.max(res, Math.sqrt(w * h / cap));
  const nx = Math.ceil(w / res), ny = Math.ceil(h / res);
  return { type: 'paint', x0, y0, res, nx, ny, data: new Uint8Array(nx * ny) };
}
// set every cell whose center passes test(x, y) to val; only within the box [x0, y0, x1, y1]
export function paintWhere(g, test, val, box) {
  const i0 = box ? Math.max(0, Math.floor((box[0] - g.x0) / g.res)) : 0, i1 = box ? Math.min(g.nx - 1, Math.ceil((box[2] - g.x0) / g.res)) : g.nx - 1;
  const j0 = box ? Math.max(0, Math.floor((box[1] - g.y0) / g.res)) : 0, j1 = box ? Math.min(g.ny - 1, Math.ceil((box[3] - g.y0) / g.res)) : g.ny - 1;
  let n = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (!test(g.x0 + (i + 0.5) * g.res, g.y0 + (j + 0.5) * g.res)) continue;
    const k = j * g.nx + i;
    if (g.data[k] !== val) { g.data[k] = val; n++; }
  }
  return n;
}
// the brush: a disc of radius r (mm) at x, y; a stroke from (ax, ay) to (bx, by) is a capsule
export function stampDisc(g, x, y, r, val = 1) {
  return paintWhere(g, (px, py) => (px - x) ** 2 + (py - y) ** 2 <= r * r, val, [x - r, y - r, x + r, y + r]);
}
export function stampStroke(g, ax, ay, bx, by, r, val = 1) {
  const s = [ax, ay, bx, by];
  return paintWhere(g, (px, py) => segDist(px, py, s) <= r, val, [Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r]);
}
export function gridCount(g) { let n = 0; for (let i = 0; i < g.data.length; i++) n += g.data[i]; return n; }

// a region as stored (runs) -> a grid with its data, or the shape itself
export function regionSpec(region) {
  if (!region) return null;
  if (region.type === 'paint' && !region.data) return { ...region, data: decodeRuns(region.runs, region.nx * region.ny) };
  return region;
}
export function storeRegion(region) {
  if (region.type !== 'paint') return region;
  const { data, ...rest } = region;
  return { ...rest, runs: encodeRuns(data) };
}

// affine helpers: xf = [a, b, c, d, e, f]
export const xfApply = (A, x, y) => [A[0] * x + A[1] * y + A[4], A[2] * x + A[3] * y + A[5]];
export function xfInvert(A) {
  const det = A[0] * A[3] - A[1] * A[2];
  if (!(Math.abs(det) > 1e-12)) return IDENTITY.slice();
  const a = A[3] / det, b = -A[1] / det, c = -A[2] / det, d = A[0] / det;
  return [a, b, c, d, -(a * A[4] + b * A[5]), -(c * A[4] + d * A[5])];
}
// B after A: x -> B(A(x))
export const xfThen = (A, B) => [B[0] * A[0] + B[1] * A[2], B[0] * A[1] + B[1] * A[3], B[2] * A[0] + B[3] * A[2], B[2] * A[1] + B[3] * A[3],
  B[0] * A[4] + B[1] * A[5] + B[4], B[2] * A[4] + B[3] * A[5] + B[5]];
export const xfScale = (A) => Math.sqrt(Math.abs(A[0] * A[3] - A[1] * A[2])) || 1;
const isIdentity = (A) => !A || A.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-12);

// A texture (as texture() returns it) seen through xf: the same surface, placed. Lengths across it
// scale by the xf's mean scale; depth does not.
export function placeTexture(tex, A) {
  if (isIdentity(A)) return tex;
  const I = xfInvert(A), s = xfScale(A);
  const b = tex.bbox, cs = [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].map(([x, y]) => xfApply(A, x, y));
  const bbox = { x0: Math.min(...cs.map((p) => p[0])), y0: Math.min(...cs.map((p) => p[1])), x1: Math.max(...cs.map((p) => p[0])), y1: Math.max(...cs.map((p) => p[1])) };
  const back = (x, y) => xfApply(I, x, y);
  const mask = tex.mask && { bbox, sd: (x, y) => { const [u, v] = back(x, y); return tex.mask.sd(u, v) * s; } };
  return {
    ...tex, bbox, mask, scale: tex.scale * s,
    h: (x, y) => { const [u, v] = back(x, y); return tex.h(u, v); },
    w: (x, y) => { const [u, v] = back(x, y); return tex.w(u, v); },
    feature: tex.feature * s,
    strokeWidth: tex.strokeWidth * s,
    dotDiameter: tex.dotDiameter * s,
    dots() { return tex.dots().map((d) => { const [x, y] = xfApply(A, d.x, d.y); return { ...d, x, y }; }); },
    strokes(step = 0.5) {
      return tex.strokes(step / s).map((st) => ({ ...st, width: st.width * s, pts: st.pts.map((p) => { const [x, y] = xfApply(A, p.x, p.y); return { ...p, x, y }; }) }));
    },
  };
}

// a new texture fill, its pattern's own numbers (depth from the pattern's default)
export function newFill(pattern = 'waves', over = {}) {
  const params = defaults(pattern);
  return { fill: 'texture', pattern, params, scale: 1, angle: 0, origin: [0, 0], fade: 3, depth: params.depth, tool: 'ball14', path: 'auto', grit: 0, ...over };
}

// The mark's texture in the part's frame (null for an empty region or a fill that is not a texture)
export function markTexture(mark) {
  const f = mark && mark.fill;
  if (!f || f.fill !== 'texture' || !PATTERNS[f.pattern]) return null;
  const region = regionSpec(mark.region);
  if (!region) return null;
  if (region.type === 'paint' && !region.data.some((v) => v)) return null;
  const A = mark.xf || IDENTITY, s = xfScale(A);
  const tex = texture({
    pattern: f.pattern,
    params: { ...(f.params || {}), depth: f.depth },
    transform: { angle: f.angle || 0, scale: f.scale || 1, ox: (f.origin || [0, 0])[0], oy: (f.origin || [0, 0])[1] },
    mask: region,
    soft: Math.max(0, f.fade || 0) / s,
    overlay: f.grit > 0 ? { pattern: 'noise', params: { scale: 7, octaves: 2, depth: 1, seed: 5 }, amount: f.grit, mode: 'add' } : null,
  });
  return placeTexture(tex, A);
}

// which path a texture takes with a tool: the one asked for when it fits the pattern, else the
// best for it: one plunge per dot when the bit can make the dots, the groove's center with a V
export function pathFor(tex, toolIn, style = 'auto') {
  const tool = toolIn.prof ? toolIn : makeTool(toolIn);
  const ok = { raster: true, crosshatch: true, plunge: tex.kind === 'dots', centerline: tex.kind === 'strokes' };
  if (style !== 'auto' && ok[style]) return style;
  if (tex.kind === 'dots' && tool.type !== 'flat' && tool.widthAt(tex.params.depth) <= tex.dotDiameter * 1.03) return 'plunge';
  if (tex.kind === 'strokes' && tool.type === 'v') return 'centerline';
  return 'raster';
}

// the mark's moves, part frame, z from the top (0) down; maxDepth caps them (the board's thickness)
export function markToolpath(mark, o = {}) {
  if (mark && mark.fill && mark.fill.fill === 'pierce') return pierceToolpath(mark, { ...o, thickness: o.thickness || o.maxDepth });
  const tex = markTexture(mark);
  if (!tex) return { moves: [], tex: null };
  const tool = fillTool(mark.fill);
  const strategy = pathFor(tex, tool, mark.fill.path);
  const b = tex.bbox, area = Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0));
  // a finer grid for small marks; a big one stays under a few million samples
  const res = o.res || Math.max(0.2, Math.min(0.6, Math.sqrt(area / 1.5e6)));
  const scallop = tool.type === 'v' ? 0.15 : 0.05;
  // never below the mark's own depth (a V following a groove's center would go as deep as the
  // groove is wide), nor the board's
  const maxDepth = Math.min(tex.depth, o.maxDepth > 0 ? o.maxDepth : Infinity);
  const path = toolpath(tex, tool, { strategy, res, scallop, maxDepth, stepDown: o.stepDown, angle: o.angle || 0, safeZ: o.safeZ, clearZ: o.clearZ });
  return { ...path, tex, tool, strategy, res };
}

// Moves as runs of cutting: each run starts where the bit came down to (above the board) and
// feeds on until it next lifts. An app routes the travel between runs its own way.
export function feedRuns(moves) {
  const runs = [];
  let run = null, prev = null;
  for (const m of moves) {
    if (m.rapid) { run = null; prev = m; continue; }
    if (!run) { run = []; runs.push(run); if (prev) run.push([prev.x, prev.y, prev.z]); }
    run.push([m.x, m.y, m.z]);
    prev = m;
  }
  // a run that only climbs back out cuts nothing
  return runs.filter((r) => r.some((p) => p[2] < 0));
}

// What to say about a mark: the tool's checks, and the board's
//   o = { thickness (mm), len (v mm -> text), outside (0..1 of the mark off the part) }
export function markChecks(mark, o = {}) {
  if (mark && mark.fill && mark.fill.fill === 'pierce') return pierceChecks(mark, o);
  const tex = markTexture(mark);
  if (!tex) return { warnings: [], notes: [], tex: null };
  const tool = fillTool(mark.fill);
  const L = o.len || ((v) => `${fmt(v, 1)} mm`);
  const strategy = pathFor(tex, tool, mark.fill.path);
  const maxDepth = Math.min(tex.depth, o.thickness > 0 ? o.thickness : Infinity);
  const a = analyze(tex, tool, { maxDepth, strategy, len: o.len });
  // the max-depth line says it in the pattern's words; the board's own comes first
  const warnings = a.warnings.filter((w) => !/^The pattern goes/.test(w));
  if (o.thickness > 0 && tex.depth >= o.thickness - 1e-6) warnings.unshift(`The texture goes ${L(tex.depth)} deep and the board is ${L(o.thickness)} thick: it would cut through. It stops at the board's bottom.`);
  if (o.outside > 0.02) warnings.push(`${Math.round(o.outside * 100)}% of the mark is off the part: that much of the texture cuts air, or the board around the part.`);
  return { warnings, notes: a.notes, tex, tool, strategy };
}

// ---------------------------------------------------------------------------------------------
// Pierce: cuts that go through (or nearly through) the board from a mark, so the part bends or
// lets light and air through. Ported from the bendy-ply generator (prototypes/bendply/bendgen.mjs),
// router first. Every number here is a RULE OF THUMB until test strips are cut and measured.
//
//   fill = { fill: 'pierce', pattern: 'kerf' | 'holes', params, angle, origin, fade, tool, bit }
//
// kerf: straight cuts along the bend line (the mark's turn sets it), a bit wide, leaving `skin`
//   under them (0 = right through). The pitch is where neighbouring kerfs just close when the
//   part bends to the radius asked for: p = w·R / (T − s) (w the bit, T the board, s the skin).
//   Bridges break each cut into slots (staggered row to row) so a through-cut part holds together.
// holes: round holes on a grid or a hex lattice, through; each cleared from its middle outward,
//   so nothing is left loose in it.
// The soft edge thins the pattern toward the mark's edge: slots break into shorter dashes,
// holes get smaller (and drop out under the bit's own size).

const PIERCE_P = (k, label, min, max, step, def, unit = 'mm', basic = false) => ({ k, label, type: 'range', min, max, step, def, unit, basic });
export const PIERCES = {
  kerf: {
    label: 'kerfs', short: 'kerfs', blurb: 'Parallel cuts along a bend line: the part bends across them.',
    params: [PIERCE_P('radius', 'Bend radius', 20, 3000, 1, 200, 'mm', true), PIERCE_P('skin', 'Skin left', 0, 20, 0.1, 2.5, 'mm', true),
      PIERCE_P('bridge', 'Bridge', 0, 60, 0.5, 0), PIERCE_P('slot', 'Slot length', 10, 600, 1, 80)],
  },
  holes: {
    label: 'holes', short: 'holes', blurb: 'Round holes right through, on a grid or a hex lattice.',
    params: [PIERCE_P('size', 'Hole size', 2, 80, 0.5, 10, 'mm', true), PIERCE_P('spacing', 'Spacing', 3, 160, 0.5, 18, 'mm', true),
      { k: 'layout', label: 'Layout', type: 'select', options: ['hex', 'grid'], def: 'hex' }],
  },
};
// the skin's allowable bending strain: birch ply about 0.75 % (0.5–1 %), a guess until strips are bent
export const SKIN_STRAIN = 0.0075;
export function pierceDefaults(id) { const o = {}; for (const q of PIERCES[id].params) o[q.k] = q.def; return o; }
export function newPierce(pattern = 'kerf', over = {}) {
  return { fill: 'pierce', pattern, params: pierceDefaults(pattern), angle: 0, origin: [0, 0], fade: 0, tool: 'flat18', ...over };
}
// the bit a fill names: a full spec (fill.bit, from a host's tool library), or one of TOOLS by id
export function fillTool(f) {
  if (f && f.bit && f.bit.type && f.bit.diameter > 0) return makeTool(f.bit);
  if (f && typeof f.tool === 'string' && TOOLS[f.tool]) return makeTool(f.tool);
  return makeTool(f && f.fill === 'pierce' ? 'flat18' : 'ball14');
}
// the kerf pitch for a bit width w, board T, skin s and bend radius R (closure: the kerfs just touch)
export function kerfPitch(w, T, s, R) { return w * R / Math.max(1e-6, T - Math.max(0, s)); }

// The cuts, in the part's frame: { slots: [{ a: [x, y], b: [x, y] }], holes: [{ x, y, d }], depth,
// through, pitch, width, mask } — or null for an empty region.
export function pierceCuts(mark, o = {}) {
  const f = mark && mark.fill;
  if (!f || f.fill !== 'pierce' || !PIERCES[f.pattern]) return null;
  const region = regionSpec(mark.region);
  if (!region || (region.type === 'paint' && !region.data.some((v) => v))) return null;
  const A = mark.xf || IDENTITY, s = xfScale(A), I = xfInvert(A);
  const tool = fillTool(f), w = tool.diameter, T = o.thickness > 0 ? o.thickness : 19;
  const p = { ...pierceDefaults(f.pattern), ...(f.params || {}) };
  const mask = makeMask(region);
  const soft = Math.max(0, f.fade || 0) / s;
  const weight = maskWeight(mask, soft);
  const b = mask.bbox, ang = (f.angle || 0) * Math.PI / 180;
  const out = { slots: [], holes: [], width: w, depth: T, through: true, pitch: 0, mask };
  const toPart = (x, y) => xfApply(A, x, y);
  if (f.pattern === 'kerf') {
    const skin = Math.min(Math.max(0, p.skin), T);
    out.through = skin <= 0;
    out.depth = T - skin;
    // in the mark's frame the pitch is the part's over the mark's scale
    const pitch = out.pitch = kerfPitch(w, T, skin, p.radius);
    const pm = pitch / s, step = Math.min(0.5, w / 4) / s;
    const ox = (f.origin || [0, 0])[0], oy = (f.origin || [0, 0])[1];
    const box = { u0: b.x0 - ox, v0: b.y0 - oy, u1: b.x1 - ox, v1: b.y1 - oy };
    const dash = Math.max(4 * w, 12) / s, period = (p.slot + p.bridge) / s;
    const lines = linesInBox(ang, pm, box);
    lines.forEach(([[ax, ay], [bx, by]], li) => {
      const L = Math.hypot(bx - ax, by - ay), dx = (bx - ax) / L, dy = (by - ay) / L, n = Math.ceil(L / step);
      // this line's place along the pattern, so bridges stagger row to row
      const t0 = (ax + ox) * dx + (ay + oy) * dy, stag = (li & 1) ? period / 2 : 0;
      let run = null;
      const flush = () => { if (run && Math.hypot(run[2] - run[0], run[3] - run[1]) * s >= w) out.slots.push({ a: toPart(run[0], run[1]), b: toPart(run[2], run[3]) }); run = null; };
      for (let i = 0; i <= n; i++) {
        const t = i * L / n, x = ax + ox + dx * t, y = ay + oy + dy * t;
        const m = weight(x, y), along = t0 + t;
        // the bit's center at least half the bit inside the mark, so no cut crosses its edge
        let keep = mask.sd(x, y) * s >= w / 2 - 1e-6 && (m >= 0.999 || (m > 0.02 && (((along % dash) + dash) % dash) / dash < m));
        if (keep && p.bridge > 0) keep = ((((along + stag) % period) + period) % period) < p.slot / s;
        if (keep) { if (!run) run = [x, y, x, y]; else { run[2] = x; run[3] = y; } } else flush();
      }
      flush();
    });
  } else {
    const hex = p.layout !== 'grid', px = p.spacing / s, py = hex ? px * Math.sqrt(3) / 2 : px;
    const ox = (f.origin || [0, 0])[0], oy = (f.origin || [0, 0])[1];
    const c = Math.cos(ang), sn = Math.sin(ang);
    const cs = [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].map(([x, y]) => [c * (x - ox) + sn * (y - oy), -sn * (x - ox) + c * (y - oy)]);
    const lb = { u0: Math.min(...cs.map((q) => q[0])), u1: Math.max(...cs.map((q) => q[0])), v0: Math.min(...cs.map((q) => q[1])), v1: Math.max(...cs.map((q) => q[1])) };
    for (const [u, v] of latticeCenters(px, py, hex ? 0.5 : 0, lb)) {
      const x = ox + c * u - sn * v, y = oy + sn * u + c * v;
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
      const m = weight(x, y);
      if (m <= 0) continue;
      const d = p.size * Math.min(1, m);
      // the whole hole inside the mark, and no smaller than the bit
      if (d < w - 1e-6 || mask.sd(x, y) * s < d / 2 - 1e-6) continue;
      const [X, Y] = toPart(x, y);
      out.holes.push({ x: X, y: Y, d });
    }
  }
  out.inv = I;
  return out;
}

// The moves for a pierce mark, part frame, z from the top (0) down: each slot fed end to end at
// each depth in turn, each hole spiralled out from its middle at each depth (a hole the bit's own
// size is plunged). stepDown: the depth a pass (0 = all at once).
export function pierceToolpath(mark, o = {}) {
  const cuts = pierceCuts(mark, o);
  if (!cuts) return { moves: [], cuts: null };
  const tool = fillTool(mark.fill), E = emitter(o), w = tool.diameter;
  const deep = o.maxDepth > 0 ? Math.min(cuts.depth, o.maxDepth) : cuts.depth;
  const sd = o.stepDown > 0 ? o.stepDown : deep;
  const zs = [];
  for (let z = -sd; z > -deep + 1e-6; z -= sd) zs.push(z);
  zs.push(-deep);
  // nearest-neighbour order from the front-left, each slot from its nearer end
  const left = cuts.slots.map((q) => ({ ...q }));
  let cx = -Infinity, cy = -Infinity;
  const order = [];
  while (left.length) {
    let bi = 0, bd = Infinity, rev = false;
    left.forEach((q, i) => {
      const da = Math.hypot(q.a[0] - cx, q.a[1] - cy), db = Math.hypot(q.b[0] - cx, q.b[1] - cy);
      if (!isFinite(cx)) { const k = q.a[0] + q.a[1]; if (k < bd) { bd = k; bi = i; rev = false; } return; }
      if (da < bd) { bd = da; bi = i; rev = false; }
      if (db < bd) { bd = db; bi = i; rev = true; }
    });
    const q = left.splice(bi, 1)[0];
    order.push(rev ? { a: q.b, b: q.a } : q);
    const e = order[order.length - 1].b; cx = e[0]; cy = e[1];
  }
  for (const q of order) {
    E.travelTo(q.a[0], q.a[1], o.clearZ ?? 1);
    let at = q.a;
    for (const z of zs) {
      E.feed(at[0], at[1], z);
      const to = at === q.a ? q.b : q.a;
      E.feed(to[0], to[1], z);
      at = to;
    }
    E.retract();
  }
  const holes = cuts.holes.slice().sort((h1, h2) => Math.round(h1.y / 5) - Math.round(h2.y / 5) || h1.x - h2.x);
  for (const h of holes) {
    E.travelTo(h.x, h.y, o.clearZ ?? 1);
    const rmax = Math.max(0, (h.d - w) / 2), ring = Math.max(0.2, 0.4 * w);
    for (const z of zs) {
      E.feed(h.x, h.y, z);
      if (rmax <= 0.01) continue;
      // outward rings to the hole's edge, then back to the middle for the next depth
      for (let r = Math.min(ring, rmax); ; r = Math.min(rmax, r + ring)) {
        const n = Math.max(12, Math.ceil(2 * Math.PI * r / 0.5));
        E.feed(h.x + r, h.y, z);
        for (let k = 1; k <= n; k++) E.feed(h.x + r * Math.cos(k / n * TAU), h.y + r * Math.sin(k / n * TAU), z);
        if (r >= rmax - 1e-9) break;
      }
      E.feed(h.x, h.y, z);
    }
    E.retract();
  }
  E.retract();
  return { moves: E.moves, cuts, tool, strategy: cuts.slots.length ? 'slots' : 'holes' };
}

// What to say about a pierce mark, in plain words; every limit here wants a test strip
export function pierceChecks(mark, o = {}) {
  const cuts = pierceCuts(mark, o);
  if (!cuts) return { warnings: [], notes: [], cuts: null };
  const f = mark.fill, tool = fillTool(f), w = tool.diameter, T = o.thickness > 0 ? o.thickness : 19;
  const p = { ...pierceDefaults(f.pattern), ...(f.params || {}) };
  const L = o.len || ((v) => `${fmt(v, 1)} mm`);
  const warnings = [], notes = ['These numbers are a starting point: cut a test strip first.'];
  if (tool.type !== 'flat') warnings.push(`A ${tool.name} leaves a ${tool.type === 'v' ? 'V' : 'round'}-bottomed cut; through cuts want a straight (flat) bit.`);
  if (f.pattern === 'kerf') {
    const skin = Math.min(Math.max(0, p.skin), T), rib = cuts.pitch - w;
    notes.unshift(`Kerfs every ${L(cuts.pitch)}, ${cuts.through ? 'right through' : `${L(T - skin)} deep, leaving ${L(skin)}`}, ${cuts.slots.length} cut${cuts.slots.length === 1 ? '' : 's'}.`);
    if (rib < 2 * w) warnings.push(`The kerfs are ${L(cuts.pitch)} apart: the wood between them is thinner than two bit widths and may snap. Ask for a gentler bend (a bigger radius) or use a thinner bit.`);
    if (skin > 0) {
      const rmin = skin / (2 * SKIN_STRAIN);
      if (p.radius < rmin) warnings.push(`With ${L(skin)} of skin, a bend tighter than about ${L(rmin)} may crack it. Leave less skin, or bend it gentler.`);
      if (skin >= T) warnings.push(`The skin is as thick as the board: the kerfs cut nothing.`);
    } else if (!(p.bridge > 0)) warnings.push(`With no skin and no bridges every kerf cuts right through: the part comes apart in strips. Leave some skin, or add bridges.`);
    if (cuts.through && p.bridge > 0 && p.bridge < w) warnings.push(`Bridges ${L(p.bridge)} long are shorter than the bit is wide (${L(w)}): they may break. Make them longer.`);
  } else {
    notes.unshift(`${cuts.holes.length} hole${cuts.holes.length === 1 ? '' : 's'}, right through.`);
    if (p.size < w) warnings.push(`A ${tool.name} can't cut ${L(p.size)} holes: the bit is ${L(w)} across. Make the holes bigger or use a thinner bit.`);
    const web = p.spacing - p.size;
    if (web < 2 * w) warnings.push(`Only ${L(Math.max(0, web))} of wood is left between the holes, less than two bit widths: it may break. Space them farther apart or make them smaller.`);
  }
  if (o.outside > 0.02) warnings.push(`${Math.round(o.outside * 100)}% of the mark is off the part: those cuts go through the board around the part.`);
  return { warnings, notes, cuts, tool, strategy: cuts.slots.length ? 'slots' : 'holes' };
}

// A pierce mark for the laser: an SVG in mm, cuts on LightBurn's red layer (slots as lines, the
// bit's width noted), holes on its blue layer. offset: where the part's frame sits on the sheet.
export function pierceSVG(mark, o = {}) {
  const cuts = pierceCuts(mark, o);
  if (!cuts) return '';
  const xs = [], ys = [];
  for (const q of cuts.slots) { xs.push(q.a[0], q.b[0]); ys.push(q.a[1], q.b[1]); }
  for (const h of cuts.holes) { xs.push(h.x - h.d / 2, h.x + h.d / 2); ys.push(h.y - h.d / 2, h.y + h.d / 2); }
  if (!xs.length) return '';
  const pad = 5, x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad, W = Math.max(...xs) + pad - x0, H = Math.max(...ys) + pad - y0;
  const X = (x) => +(x - x0).toFixed(3), Y = (y) => +(H - (y - y0)).toFixed(3);
  const lines = cuts.slots.map((q) => `<line x1="${X(q.a[0])}" y1="${Y(q.a[1])}" x2="${X(q.b[0])}" y2="${Y(q.b[1])}"/>`).join('\n');
  const circles = cuts.holes.map((h) => `<circle cx="${X(h.x)}" cy="${Y(h.y)}" r="${+(h.d / 2).toFixed(3)}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${+W.toFixed(3)}mm" height="${+H.toFixed(3)}mm" viewBox="0 0 ${+W.toFixed(3)} ${+H.toFixed(3)}">
<!-- ${mark.fill.pattern}: kerf width ${fmt(cuts.width, 2)} mm, pitch ${fmt(cuts.pitch, 2)} mm. A starting point: cut a test strip. -->
<g id="cuts" fill="none" stroke="#FF0000" stroke-width="0.1">
${lines}
</g>
<g id="holes" fill="none" stroke="#0000FF" stroke-width="0.1">
${circles}
</g>
</svg>
`;
}

// ---------------------------------------------------------------------------------------------
// Pictures: a height field shaded as a carved surface, for any host to draw (marks, swatches).
//
// shadeHeight(H, W, Hn, res, colors, inside, depth) -> Uint8ClampedArray RGBA, row 0 at the top.
//   H: W x Hn depths (mm below the top, row 0 = the far edge); res: mm per pixel;
//   colors: { lo, hi } [r, g, b] for a deep wall in shadow and a top in the light — a host passes
//   a bounded range around its own surface color, so a mark reads alike on light and dark grounds;
//   inside: optional W x Hn 0/1 (transparent where 0); depth: the deepest it can go (else H's own).
export function shadeHeight(H, W, Hn, res, colors, inside, depth) {
  const D = new Uint8ClampedArray(W * Hn * 4), { lo, hi } = colors;
  let dmax = depth || 0;
  if (!dmax) for (let k = 0; k < H.length; k++) if (H[k] > dmax) dmax = H[k];
  dmax = Math.max(0.5, dmax);
  const L = [-0.55, 0.55, 0.63];
  for (let j = 0; j < Hn; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, o = k * 4;
    if (inside && !inside[k]) continue;
    // lit from the back left; the surface is z = -h, its normal (hx, hy, 1) with y up the page
    const hx = (H[j * W + Math.min(W - 1, i + 1)] - H[j * W + Math.max(0, i - 1)]) / (2 * res) * 1.6;
    const hy = (H[Math.max(0, j - 1) * W + i] - H[Math.min(Hn - 1, j + 1) * W + i]) / (2 * res) * 1.6;
    const sh = Math.max(0, (hx * L[0] + hy * L[1] + L[2]) / Math.hypot(hx, hy, 1)) / 0.93;
    const t = clamp01(0.62 * Math.min(1, sh) + 0.38 * (1 - H[k] / dmax));
    D[o] = lo[0] + (hi[0] - lo[0]) * t; D[o + 1] = lo[1] + (hi[1] - lo[1]) * t; D[o + 2] = lo[2] + (hi[2] - lo[2]) * t; D[o + 3] = 255;
  }
  return D;
}

// A pattern's swatch: an N x N picture of a patch sized to show a few repeats, at its own numbers
export const SWATCH_SPAN = { dots: 40, dashdot: 52, morse: 60, ribs: 44, knurl: 30, noise: 90, waves: 90, stone: 70, weave: 44, motif: 50 };
export function swatch(id, N, colors, params) {
  const span = SWATCH_SPAN[id] || 50, res = span / N;
  const tex = texture({ pattern: id, params, transform: { ox: 0, oy: 0 } });
  const H = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = tex.base.h(i * res, (N - 1 - j) * res);
  return shadeHeight(H, N, N, res, colors, null, tex.depth);
}

const API = {
  hash3, perlin2, fbm2, worley2, cap, stepRepeat, blend, MORSE, morseEncode, strokeField, WEAVE_DRAFTS, MOTIFS, PATTERNS, defaults,
  rectMask, ellipseMask, polygonMask, paintMask, unionMask, makeMask, maskWeight, texture, TOOLS, makeTool, toolOffsets, dropCutter,
  heightGrid, stepoverForScallop, rasterPath, plungeDots, centerlinePath, toolpath, estimateTime, formatTime, analyze, createSim,
  simulate, compare, FILLS, PATHS, IDENTITY, encodeRuns, decodeRuns, newGrid, paintWhere, stampDisc, stampStroke, gridCount,
  regionSpec, storeRegion, xfApply, xfInvert, xfThen, xfScale, placeTexture, newFill, markTexture, pathFor, markToolpath, feedRuns,
  markChecks, BASIC, shadeHeight, SWATCH_SPAN, swatch,
  PIERCES, SKIN_STRAIN, pierceDefaults, newPierce, fillTool, kerfPitch, pierceCuts, pierceToolpath, pierceChecks, pierceSVG,
};
if (typeof window !== 'undefined') window.SwarfTexCore = API;
export default API;
