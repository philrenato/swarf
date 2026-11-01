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
// and a fill. Two fills: 'texture' carves the top, 'pierce' cuts through (bendy-ply kerfs, holes;
// see Pierce).
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

const P = (k, label, min, max, step, def, unit = 'mm', typed) => ({ k, label, type: 'range', min, max, step, def, unit, ...(typed ? { lo: typed[0], hi: typed[1] } : {}) });
// What a box takes when typed (Phil 11-01: "give the slider the normal range of values that people might
// use ... and allow plausible values to be typed into a number box"): the slider spans the usual range;
// a length can be typed from a quarter of its low end to four times its high end, an angle anywhere in a
// turn either way, a seed any whole number; a percentage or a count keeps the slider's ends.
export function typedRange(q) {
  if (q.lo != null && q.hi != null) return [q.lo, q.hi];
  if (q.k === 'seed') return [1, 9999];
  if (q.unit === 'mm') return [q.min > 0 ? Math.max(0.05, q.min / 4) : q.min, q.max * 4];
  if (q.unit === '°') return [-360, 360];
  return [q.min, q.max];
}
const S = (k, label, options, def) => ({ k, label, type: 'select', options, def });
const T = (k, label, def) => ({ k, label, type: 'text', def });
const PROFILES = ['ball', 'cone', 'flat'];

// Reaction-diffusion (Gray-Scott): two chemicals on a small grid that wraps at its edges, seeded at a
// few places and run to a steady pattern. Each style is a (feed, kill) pair. The run is made once per
// style and seed, kept as snapshots along the way, so growth (from the first blobs to the whole area)
// only picks between them. The grid repeats every RD_N cells; a stripe or spot is about RD_WIDTH cells.
export const RD_STYLES = { spots: [0.0367, 0.0649], maze: [0.029, 0.057], worms: [0.046, 0.063], coral: [0.0545, 0.062], cells: [0.039, 0.058] };
const RD_N = 96, RD_WIDTH = 6.5, RD_STEPS = [30, 120, 300, 600, 1000, 1400, 1900, 2600, 3400, 4300, 5200];
const rdCache = new Map();
function rdRun(style, seed) {
  const key = style + '|' + seed;
  if (rdCache.has(key)) return rdCache.get(key);
  const [F, K] = RD_STYLES[style] || RD_STYLES.maze, N = RD_N, NN = N * N;
  let u = new Float32Array(NN).fill(1), v = new Float32Array(NN), u2 = new Float32Array(NN), v2 = new Float32Array(NN);
  for (let q = 0; q < 8; q++) {
    const cx = Math.floor(hash3(q, 1, 91, seed) * N), cy = Math.floor(hash3(q, 2, 91, seed) * N);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const k = ((cy + dy + N) % N) * N + ((cx + dx + N) % N); u[k] = 0.5; v[k] = 0.25 + 0.05 * hash3(dx, dy, q, seed); }
  }
  const snaps = [];
  for (let it = 1, si = 0; si < RD_STEPS.length; it++) {
    for (let y = 0; y < N; y++) {
      const ym = ((y + N - 1) % N) * N, y0 = y * N, yp = ((y + 1) % N) * N;
      for (let x = 0; x < N; x++) {
        const xm = (x + N - 1) % N, xp = (x + 1) % N, k = y0 + x;
        const lu = 0.2 * (u[y0 + xm] + u[y0 + xp] + u[ym + x] + u[yp + x]) + 0.05 * (u[ym + xm] + u[ym + xp] + u[yp + xm] + u[yp + xp]) - u[k];
        const lv = 0.2 * (v[y0 + xm] + v[y0 + xp] + v[ym + x] + v[yp + x]) + 0.05 * (v[ym + xm] + v[ym + xp] + v[yp + xm] + v[yp + xp]) - v[k];
        const uvv = u[k] * v[k] * v[k];
        u2[k] = u[k] + lu - uvv + F * (1 - u[k]);
        v2[k] = v[k] + 0.5 * lv + uvv - (F + K) * v[k];
      }
    }
    [u, u2] = [u2, u]; [v, v2] = [v2, v];
    if (it === RD_STEPS[si]) { snaps.push(v.slice()); si++; }
  }
  // one scale for every snapshot (the grown pattern's top), so early blobs stay as deep as late ones
  let top = 0; for (const x of snaps[snaps.length - 1]) top = Math.max(top, x);
  top = top || 1;
  for (const a of snaps) for (let i = 0; i < a.length; i++) a[i] = Math.min(1, a[i] / top);
  if (rdCache.size > 12) rdCache.delete(rdCache.keys().next().value);
  rdCache.set(key, snaps);
  return snaps;
}
// the pattern at a growth from 0 (first blobs) to 1 (the whole area), between two snapshots
function rdGrowth(style, seed, g) {
  const snaps = rdRun(style, seed), f = g * (snaps.length - 1), i = Math.min(snaps.length - 2, Math.floor(f)), t = f - i;
  if (t <= 0) return snaps[i];
  const a = snaps[i], b = snaps[i + 1], out = new Float32Array(a.length);
  for (let k = 0; k < a.length; k++) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

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
      P('wiggle', 'Wiggle', 0, 15, 0.5, 0), P('wavelength', 'Wiggle length', 10, 150, 1, 60), S('profile', 'Profile', PROFILES, 'ball')],
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
    params: [P('scale', 'Lump size', 5, 80, 1, 28), P('octaves', 'Detail', 1, 6, 1, 3, ''), P('roughness', 'Roughness', 0.2, 0.8, 0.05, 0.5, ''),
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
  reaction: {
    label: 'reaction', blurb: 'Grown from a few seeds: spots, mazes, worms, coral, cells.',
    params: [S('style', 'Style', Object.keys(RD_STYLES), 'maze'), P('growth', 'Growth', 0, 100, 1, 100, '%'), P('size', 'Detail', 3, 30, 0.5, 7),
      P('depth', 'Depth', 0.2, 6, 0.1, 1.6), P('crisp', 'Crisp edges', 0, 1, 0.05, 0.6, ''), P('seed', 'Seed', 1, 99, 1, 5, '')],
    build(p) {
      const g = rdGrowth(p.style, p.seed | 0, Math.max(0, Math.min(100, p.growth)) / 100), N = RD_N, cell = p.size / RD_WIDTH;
      // a strong pattern: the grown chemical's level, sharpened about its middle (crisp 0: as grown; 1: nearly a step)
      const gain = 1 + 9 * p.crisp, at = (x, y) => {
        const fx = ((x / cell) % N + N) % N, fy = ((y / cell) % N + N) % N, i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
        const i1 = (i + 1) % N, j1 = (j + 1) % N;
        return lerp(lerp(g[j * N + i], g[j * N + i1], tx), lerp(g[j1 * N + i], g[j1 * N + i1], tx), ty);
      };
      const t = (v) => 0.5 + 0.5 * Math.tanh(gain * (v - 0.5) * 2) / Math.tanh(gain);
      return { h: (u, v) => p.depth * t(at(u, v)), depth: p.depth, feature: p.size, featureLabel: `${fmt(p.size)} mm stripes and spots`, kind: 'surface' };
    },
  },
  blob: {
    label: 'blobtex', blurb: 'Circles of every size melting together, puffed in or out.',
    params: [P('size', 'Blob size', 3, 40, 0.5, 10), P('variety', 'Size variety', 0, 1, 0.05, 0.6, ''), P('density', 'Density', 10, 100, 5, 60, '%'),
      P('merge', 'Merge', 0, 1, 0.05, 0.5, ''), S('puff', 'Puff', ['dish', 'pillow'], 'dish'), P('span', 'Puff span', 1, 30, 0.5, 8),
      S('shape', 'Puff shape', ['round', 'dome', 'soft'], 'round'), P('depth', 'Depth', 0.2, 6, 0.1, 2), P('seed', 'Seed', 1, 99, 1, 3, '')],
    build(p) {
      // Metaballs: one circle (or none, by density) jittered in each cell of a grid, radius about Size.
      // Each adds (1 - (d/R)^2)^3 inside R = 1.6 r; the outline is where the sum reaches a level that
      // Merge lowers (lower level: fatter blobs that fuse sooner). Inside, the distance to that outline
      // is (sum - level) / |gradient|; the puff rises over Puff span, so a wide area puffs fully and a
      // narrow neck or a small blob only part way, as a stuffed shape does.
      const r0 = p.size, cell = r0 * 2.2, seed = p.seed | 0, keep = Math.max(0.05, p.density / 100);
      const level = 0.55 - 0.4 * p.merge, reach = 1.6, span = Math.max(0.1, p.span);
      const ball = (ci, cj) => {
        if (hash3(ci, cj, 1, seed) > keep) return null;
        const r = r0 * Math.max(0.25, 1 + p.variety * (hash3(ci, cj, 2, seed) * 2 - 1) * 0.85);
        return [(ci + 0.15 + 0.7 * hash3(ci, cj, 3, seed)) * cell, (cj + 0.15 + 0.7 * hash3(ci, cj, 4, seed)) * cell, r * reach];
      };
      const n = Math.ceil(r0 * 1.85 * reach / cell) + 1, R0 = r0 * reach, q0 = 1 - Math.cbrt(level);
      const gFloor = 0.5 * 6 * Math.pow(level, 2 / 3) * Math.sqrt(q0) / R0;
      const shape = p.shape === 'dome' ? (t) => t * (2 - t) : p.shape === 'soft' ? smoothstep : (t) => Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
      const h = (u, v) => {
        const ci = Math.floor(u / cell), cj = Math.floor(v / cell);
        let f = 0, gx = 0, gy = 0;
        for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) {
          const c = ball(ci + a, cj + b);
          if (!c) continue;
          const dx = u - c[0], dy = v - c[1], q = (dx * dx + dy * dy) / (c[2] * c[2]);
          if (q >= 1) continue;
          const w = 1 - q;
          f += w * w * w;
          const k = -6 * w * w / (c[2] * c[2]);      // d/dx of (1 - q)^3 is -3 (1-q)^2 * 2dx/R^2
          gx += k * dx; gy += k * dy;
        }
        if (f <= level) return p.puff === 'pillow' ? p.depth : 0;
        // the gradient is flat at a saddle between two centers, where (sum - level) / |gradient| would run
        // off to a seam of full depth; a floor of half one circle's slope at its own outline keeps a neck shallow
        const d = (f - level) / Math.max(gFloor, Math.hypot(gx, gy));
        const t = shape(Math.min(1, d / span));
        return p.puff === 'pillow' ? p.depth * (1 - t) : p.depth * t;
      };
      return { h, depth: p.depth, feature: Math.min(r0 * 0.5, span), featureLabel: `${fmt(r0)} mm blobs`, kind: 'surface' };
    },
  },
  waves: {
    label: 'ocean waves', blurb: 'A sum of wave trains with sharp crests.',
    params: [P('wavelength', 'Wavelength', 8, 80, 1, 30), P('count', 'Waves', 1, 10, 1, 6, ''), P('spread', 'Spread', 0, 90, 1, 40, '°'),
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
    params: [S('shape', 'Motif', Object.keys(MOTIFS), 'x'), P('size', 'Size', 4, 80, 0.5, 14), P('px', 'Step X', 6, 60, 0.5, 18), P('py', 'Step Y', 6, 60, 0.5, 18),
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
  memphis: {
    label: 'memphis', blurb: 'Squiggles, zigzags, triangles and rings, like an 80s print.',
    params: [S('mix', 'Mix', ['everything', 'squiggles', 'shapes', 'confetti'], 'everything'), P('size', 'Glyph size', 6, 60, 0.5, 16),
      P('density', 'Density', 10, 100, 5, 100, '%'), P('spacing', 'Spacing', 8, 80, 0.5, 22), P('width', 'Line width', 0.8, 8, 0.1, 2.4), P('depth', 'Depth', 0.2, 5, 0.1, 1.4),
      S('fill', 'Shapes', ['outline', 'solid'], 'outline'), P('turn', 'Tumble', 0, 1, 0.05, 1, ''), P('scatter', 'Scatter', 0, 0.45, 0.01, 0.3, ''), S('profile', 'Profile', PROFILES, 'cone'), P('seed', 'Seed', 1, 99, 1, 8, '')],
    build(p) {
      const sz = p.size, sp = p.spacing, hw = p.width / 2, seed = p.seed | 0;
      const kinds = MEMPHIS_MIX[p.mix] || MEMPHIS_MIX.everything, solid = p.fill === 'solid';
      // each cell of a square lattice holds one glyph: its kind, turn and offset from the cell's hash
      // density: the share of cells that hold a glyph (Phil 11-01: "80s should get density"); the rest stay plain
      const dens = Math.min(1, Math.max(0, (p.density ?? 100) / 100));
      const glyph = (i, j) => {
        if (dens < 1 && hash3(i, j, 5, seed) >= dens) return null;
        const k = kinds[Math.floor(hash3(i, j, 1, seed) * kinds.length) % kinds.length];
        const a = p.turn * TAU * hash3(i, j, 2, seed), sc = k === 'dash' || k === 'dot' ? 0.6 : 1;
        const cu = (i + 0.5 + p.scatter * (2 * hash3(i, j, 3, seed) - 1)) * sp, cv = (j + 0.5 + p.scatter * (2 * hash3(i, j, 4, seed) - 1)) * sp;
        return { segs: MEMPHIS[k], solid: solid && MEMPHIS_SOLID[k], c: Math.cos(a), s: Math.sin(a), cu, cv, sc: sz * sc };
      };
      const reach = Math.max(1, Math.ceil((sz * 0.6 + hw) / sp + p.scatter));
      return {
        h: (u, v) => {
          const i0 = Math.floor(u / sp), j0 = Math.floor(v / sp);
          let d = Infinity;
          for (let j = j0 - reach; j <= j0 + reach; j++) for (let i = i0 - reach; i <= i0 + reach; i++) {
            const g = glyph(i, j); if (!g) continue;
            const du = u - g.cu, dv = v - g.cv;
            if (Math.abs(du) > g.sc * 0.6 + hw || Math.abs(dv) > g.sc * 0.6 + hw) continue;
            // into the glyph's own frame (unit size)
            const x = (du * g.c + dv * g.s) / g.sc, y = (-du * g.s + dv * g.c) / g.sc;
            // a solid shape is a flat pocket to its outline's middle, its rim the line's own slope
            if (g.solid && insidePoly(x, y, g.solid)) return p.depth;
            for (const q of g.segs) { const e = segDist(x, y, q) * g.sc; if (e < d) d = e; }
          }
          return cap(d, hw, p.depth, p.profile);
        },
        depth: p.depth, feature: p.width, featureLabel: `${fmt(p.width)} mm lines`, kind: 'strokes', strokeWidth: p.width,
        strokes: (b) => {
          const out = [];
          for (let j = Math.floor(b.v0 / sp) - reach; j <= Math.ceil(b.v1 / sp) + reach; j++) for (let i = Math.floor(b.u0 / sp) - reach; i <= Math.ceil(b.u1 / sp) + reach; i++) {
            const g = glyph(i, j); if (!g) continue;
            const at = (x, y) => [g.cu + (x * g.c - y * g.s) * g.sc, g.cv + (x * g.s + y * g.c) * g.sc];
            // the segments joined back into the polylines they came from
            let line = null;
            for (const q of g.segs) {
              const a = at(q[0], q[1]), e = at(q[2], q[3]);
              if (line && Math.hypot(line[line.length - 1][0] - a[0], line[line.length - 1][1] - a[1]) < 1e-6) line.push(e);
              else { if (line) out.push(line); line = [a, e]; }
            }
            if (line) out.push(line);
          }
          return out;
        },
      };
    },
  },
  quilt: {
    label: 'quilted', blurb: 'Puffed cells between stitched seams.',
    params: [S('style', 'Quilting', ['diamond', 'square', 'honeycomb', 'channel'], 'diamond'), P('size', 'Cell size', 10, 80, 0.5, 32),
      P('depth', 'Depth', 0.3, 6, 0.1, 2.4), P('puff', 'Puff', 0, 1, 0.05, 0.7, ''), P('seam', 'Seam width', 0.8, 8, 0.1, 2),
      S('stitch', 'Stitches', ['line', 'dashes'], 'line'), P('stitchLen', 'Stitch length', 2, 20, 0.5, 6), P('angle', 'Diamond angle', 30, 90, 1, 60, '°')],
    build(p) {
      const L = p.size, hw = p.seam / 2, puff = clamp01(p.puff), dashes = p.stitch === 'dashes';
      // the cells puff up to the top; where they meet the seam they have come down to 70% of the depth,
      // and the stitched seam itself runs the full depth
      const low = 0.7 * p.depth;
      const near = seamNear(p.style, L, p.angle);
      return {
        h: (u, v) => {
          const { d, along, f } = near(u, v);
          // f: 1 in the cell's middle, 0 on its seams, smooth between (sines across each family of
          // seams); puff lifts its shoulders, so a plump cell is flat on top and steep at the seam
          const pillow = low * (1 - Math.pow(clamp01(f), 1 - 0.7 * puff));
          const sewn = !dashes || ((along / p.stitchLen) % 1 + 1) % 1 < 0.62;
          return Math.max(pillow, sewn ? cap(d, hw, p.depth, 'ball') : 0);
        },
        depth: p.depth, feature: p.seam, featureLabel: `${fmt(p.seam)} mm seams`, kind: 'surface',
      };
    },
  },
};

// the glyphs of the memphis pattern, unit size, as segments [x0, y0, x1, y1] (polylines in order)
const poly = (pts, closed) => { const o = []; const n = closed ? pts.length : pts.length - 1; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; o.push([a[0], a[1], b[0], b[1]]); } return o; };
const arcPts = (r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [r * Math.cos(a), r * Math.sin(a)]; });
const MEMPHIS = {
  squiggle: poly(Array.from({ length: 25 }, (_, i) => { const x = -0.5 + i / 24; return [x, 0.16 * Math.sin(x * TAU * 1.5)]; })),
  zigzag: poly([[-0.5, -0.12], [-0.3, 0.12], [-0.1, -0.12], [0.1, 0.12], [0.3, -0.12], [0.5, 0.12]]),
  arc: poly(arcPts(0.36, Math.PI * 0.1, Math.PI * 0.9, 16)),
  triangle: poly([[0, 0.38], [0.36, -0.24], [-0.36, -0.24]], true),
  ring: poly(arcPts(0.3, 0, TAU, 28).slice(0, 28), true),
  plus: [[-0.3, 0, 0.3, 0], [0, -0.3, 0, 0.3]],
  dot: poly(arcPts(0.08, 0, TAU, 10).slice(0, 10), true),
  dash: [[-0.35, 0, 0.35, 0]],
  stripes: [[-0.36, -0.2, 0.36, -0.2], [-0.36, 0, 0.36, 0], [-0.36, 0.2, 0.36, 0.2]],
};
// the closed glyphs, as polygons, for solid shapes
const MEMPHIS_SOLID = { triangle: [[0, 0.38], [0.36, -0.24], [-0.36, -0.24]], ring: arcPts(0.3, 0, TAU, 28).slice(0, 28), dot: arcPts(0.08, 0, TAU, 10).slice(0, 10) };
const MEMPHIS_MIX = {
  everything: ['squiggle', 'zigzag', 'arc', 'triangle', 'ring', 'plus', 'dot', 'dash', 'stripes'],
  squiggles: ['squiggle', 'zigzag', 'arc'],
  shapes: ['triangle', 'ring', 'plus', 'stripes'],
  confetti: ['dash', 'dot', 'dash', 'plus'],
};
// the nearest seam of a quilting: d its distance, along a coordinate down it (for stitches), f the
// cell's pillow (1 in its middle, 0 on every seam)
function seamNear(style, L, angleDeg) {
  const line = (w, a) => { const k = Math.round(w / a); return { d: Math.abs(w - k * a) }; };
  const sn = (w) => Math.abs(Math.sin(Math.PI * w / L));
  if (style === 'square') return (u, v) => { const a = line(u, L), b = line(v, L), f = sn(u) * sn(v); return a.d < b.d ? { d: a.d, along: v, f } : { d: b.d, along: u, f }; };
  if (style === 'channel') return (u, v) => ({ d: line(v, L).d, along: u, f: sn(v) });
  if (style === 'honeycomb') {
    // flat-to-flat L: centers on a triangular lattice L apart; a cell's edge normals at 0°, 60°, 120°
    const N = [[1, 0], [0.5, Math.sqrt(3) / 2], [-0.5, Math.sqrt(3) / 2]], bx = [L, 0], by = [L / 2, L * Math.sqrt(3) / 2];
    return (u, v) => {
      const jf = v / by[1], ifl = (u - jf * by[0]) / bx[0];
      let best = null;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const j = Math.round(jf) + dj, i = Math.round(ifl) + di, cx = i * bx[0] + j * by[0], cy = j * by[1];
        const qx = u - cx, qy = v - cy;
        let hd = 0, k = 0;
        for (let n = 0; n < 3; n++) { const t = Math.abs(qx * N[n][0] + qy * N[n][1]); if (t > hd) { hd = t; k = n; } }
        if (!best || hd < best.hd) best = { hd, along: -qx * N[k][1] + qy * N[k][0], f: N.reduce((m, n) => m * Math.cos(Math.PI * (qx * n[0] + qy * n[1]) / L), 1) };
      }
      return { d: Math.max(0, L / 2 - best.hd), along: best.along, f: best.f };
    };
  }
  // diamond: two families of seams at ±angle/2 from the row direction, each L apart
  const h = (angleDeg / 2) * Math.PI / 180, n1 = [-Math.sin(h), Math.cos(h)], n2 = [Math.sin(h), Math.cos(h)];
  return (u, v) => {
    const w1 = u * n1[0] + v * n1[1], w2 = u * n2[0] + v * n2[1];
    const a = line(w1, L), b = line(w2, L), f = sn(w1) * sn(w2);
    return a.d < b.d ? { d: a.d, along: u * n1[1] - v * n1[0], f } : { d: b.d, along: u * n2[1] - v * n2[0], f };
  };
}

// The one to three numbers that size each pattern: what a card shows first. The rest (and every
// seed, which a card can offer as a shuffle) are the pattern's finer points.
export const BASIC = {
  dots: ['pitch', 'diameter'], dashdot: ['sequence', 'width'], morse: ['text'], ribs: ['pitch', 'width'], knurl: ['pitch'],
  noise: ['scale'], reaction: ['style', 'growth', 'size'], blob: ['size', 'puff', 'span'], waves: ['wavelength'], stone: ['size', 'mortar'], weave: ['thread'], motif: ['shape', 'size'],
  memphis: ['mix', 'size', 'density'], quilt: ['style', 'size'],
};
// one word each, for a swatch's caption
const SHORT = { dots: 'dots', dashdot: 'dash', morse: 'morse', ribs: 'flutes', knurl: 'knurl', noise: 'noise', reaction: 'react', blob: 'blob', waves: 'waves', stone: 'stone', weave: 'weave', motif: 'repeat', memphis: '80s', quilt: 'quilt' };
for (const id in PATTERNS) PATTERNS[id].short = SHORT[id] || PATTERNS[id].label;
for (const [id, ks] of Object.entries(BASIC)) for (const q of PATTERNS[id].params) {
  if (ks.includes(q.k)) q.basic = true;
  if (q.k === 'seed') q.shuffle = true;
}

export function defaults(id) {
  const o = {};
  for (const q of (PATTERNS[id] ? PATTERNS[id].params : [])) o[q.k] = q.def;
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
  rx = Math.max(1e-6, Math.abs(rx)); ry = Math.max(1e-6, Math.abs(ry));
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
  if (!pts || pts.length < 3) throw new Error('polygonMask needs three points or more');
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
  const N = nx * ny, outside = new Uint8Array(N);
  for (let i = 0; i < N; i++) outside[i] = data[i] ? 0 : 1;
  const inD = chamfer(outside, nx, ny), outD = chamfer(data, nx, ny);
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
// How the soft edge comes up to full depth, 0..1 over its width (Phil 11-01: falloffs at the edge):
// smooth eases in and out; straight is a plain ramp; round drops steeply at the edge and levels off
// (a rounded-over rim); cove starts gently and steepens (a scooped hollow).
export const CURVES = {
  smooth: smoothstep,
  straight: (t) => t,
  round: (t) => Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t))),
  cove: (t) => 1 - Math.sqrt(Math.max(0, 1 - t * t)),
};
export const CURVE_WORDS = { smooth: 'smooth', straight: 'straight ramp', round: 'round: steep at the edge', cove: 'cove: gentle at the edge' };
// 0..1 inside the region; the soft edge ramps from the boundary inward over `soft` mm.
export function maskWeight(mask, soft = 0, curve = 'smooth') {
  if (!mask) return () => 1;
  if (soft <= 0) return (x, y) => (mask.sd(x, y) >= 0 ? 1 : 0);
  const C = CURVES[curve] || smoothstep;
  return (x, y) => { const d = mask.sd(x, y); return d <= 0 ? 0 : d >= soft ? 1 : C(d / soft); };
}

// The border: a band along the mark's edge, `inset` in from it and `width` wide, cut to its own
// depth in one of these sections (u runs 0 at the band's outer side to 1 at its inner side; the
// value is how deep below the top, as a share of the border's depth). beads are worked apart.
export const BORDERS = {
  none: null,
  groove: (u) => Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2)),
  vgroove: (u) => 1 - Math.abs(2 * u - 1),
  bead: (u) => 1 - Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2)),
  beads: null,
  step: () => 1,
  chamfer: (u) => 1 - u,
  roundover: (u) => 1 - Math.sqrt(Math.max(0, 1 - (1 - u) * (1 - u))),
  cove: (u) => Math.sqrt(Math.max(0, 1 - u * u)),
  rim: () => 0,
};
export const BORDER_WORDS = {
  none: 'none', groove: 'round groove', vgroove: 'V groove', bead: 'round bead', beads: 'a row of beads', step: 'step down',
  chamfer: 'chamfer', roundover: 'roundover', cove: 'cove', rim: 'plain rim (left at the top)',
};
export function borderDefaults() { return { style: 'none', width: 6, depth: 2, inset: 0, pitch: 6, along: 'all' }; }

// The level-`level` lines of f over a box, by marching squares, as polylines ({ pts, closed }).
export function isoLines(f, bbox, res, level = 0) {
  const nx = Math.max(2, Math.ceil((bbox.x1 - bbox.x0) / res) + 1), ny = Math.max(2, Math.ceil((bbox.y1 - bbox.y0) / res) + 1);
  const g = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) g[j * nx + i] = f(bbox.x0 + i * res, bbox.y0 + j * res) - level;
  const X = (i) => bbox.x0 + i * res, Y = (j) => bbox.y0 + j * res;
  const at = (k1, k2, x1, y1, x2, y2) => { const a = g[k1], b = g[k2], t = a === b ? 0.5 : a / (a - b); return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]; };
  const segs = [], ends = new Map();
  const add = (ka, pa, kb, pb) => {
    const n = segs.length; segs.push([ka, pa, kb, pb]);
    for (const k of [ka, kb]) { const l = ends.get(k); if (l) l.push(n); else ends.set(k, [n]); }
  };
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx + 1, d = a + nx;
    const code = (g[a] > 0 ? 1 : 0) | (g[b] > 0 ? 2 : 0) | (g[c] > 0 ? 4 : 0) | (g[d] > 0 ? 8 : 0);
    if (code === 0 || code === 15) continue;
    const E = [
      () => ['h' + i + ',' + j, at(a, b, X(i), Y(j), X(i + 1), Y(j))],
      () => ['v' + (i + 1) + ',' + j, at(b, c, X(i + 1), Y(j), X(i + 1), Y(j + 1))],
      () => ['h' + i + ',' + (j + 1), at(d, c, X(i), Y(j + 1), X(i + 1), Y(j + 1))],
      () => ['v' + i + ',' + j, at(a, d, X(i), Y(j), X(i), Y(j + 1))],
    ];
    const pair = (p, q) => { const [ka, pa] = E[p](), [kb, pb] = E[q](); add(ka, pa, kb, pb); };
    const mid = (g[a] + g[b] + g[c] + g[d]) / 4 > 0;
    switch (code) {
      case 1: case 14: pair(3, 0); break;
      case 2: case 13: pair(0, 1); break;
      case 3: case 12: pair(3, 1); break;
      case 4: case 11: pair(1, 2); break;
      case 6: case 9: pair(0, 2); break;
      case 7: case 8: pair(3, 2); break;
      case 5: if (mid) { pair(3, 2); pair(0, 1); } else { pair(3, 0); pair(1, 2); } break;
      case 10: if (mid) { pair(3, 0); pair(1, 2); } else { pair(3, 2); pair(0, 1); } break;
    }
  }
  const used = new Uint8Array(segs.length), out = [];
  const next = (k, from) => (ends.get(k) || []).find((n) => n !== from && !used[n]);
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const [ka, pa, kb, pb] = segs[s0];
    const fwd = [pb], back = [];
    let k = kb, n = s0;
    for (;;) { const m = next(k, n); if (m === undefined) break; used[m] = 1; const S2 = segs[m]; const far = S2[0] === k ? 2 : 0; fwd.push(S2[far + 1]); k = S2[far]; n = m; }
    const closed = k === ka;
    if (!closed) {
      k = ka; n = s0;
      for (;;) { const m = next(k, n); if (m === undefined) break; used[m] = 1; const S2 = segs[m]; const far = S2[0] === k ? 2 : 0; back.push(S2[far + 1]); k = S2[far]; n = m; }
    }
    out.push({ pts: [...back.reverse(), pa, ...fwd], closed });
  }
  return out;
}
// points along polylines, `pitch` apart (a closed one evenly, its pitch bent to fit a whole number)
export function alongLines(lines, pitch) {
  const out = [];
  for (const { pts, closed } of lines) {
    const P = closed ? [...pts, pts[0]] : pts, cum = [0];
    for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const L = cum[cum.length - 1];
    if (L < pitch * 0.5) continue;
    const n = closed ? Math.max(1, Math.round(L / pitch)) : Math.floor(L / pitch) + 1, step = closed ? L / n : pitch;
    const off = closed ? 0 : (L - (n - 1) * step) / 2;
    for (let q = 0, i = 1; q < n; q++) {
      const t = off + q * step;
      while (i < P.length - 1 && cum[i] < t) i++;
      const f = (t - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
      out.push([P[i - 1][0] + (P[i][0] - P[i - 1][0]) * f, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * f]);
    }
  }
  return out;
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
  const sh = spec.shape || {}, curve = sh.curve || 'smooth';
  const w = maskWeight(mask, spec.soft || 0, curve);
  let h = (x, y) => { const m = w(x, y); return m > 0 ? hb(x, y) * m : 0; };
  // the mark shaped (Phil 11-01: "invert, where background lowers and tex raises", falloffs, a border
  // band of various characters; lots of mixing and remixing): relief up turns the pattern over (its
  // high places are cut, its low ones stay), floor sinks the whole mark first, and a border band runs
  // along the edge. Any of them makes a surface the raster cuts (no plunges or centerlines).
  const B = sh.border && sh.border.style && sh.border.style !== 'none' ? { ...borderDefaults(), ...sh.border } : null;
  const up = sh.relief === 'up', floor = Math.max(0, +sh.floor || 0);
  let kind = base.kind;
  if (up || floor > 0 || B) {
    kind = 'surface';
    const soft = spec.soft || 0, C = CURVES[curve] || smoothstep, d0 = depth;
    const edge = spec.edge ? makeMask(spec.edge) : mask;
    const B0 = B ? Math.max(0, B.inset) : 0, Bw = B ? Math.max(0.1, B.width) : 0, B1 = B0 + Bw, Bd = B ? Math.max(0, B.depth) : 0;
    const prof = B && BORDERS[B.style];
    // the beads' centers: on the middle of the band, `pitch` apart, worked out once
    let bead = null;
    if (B && B.style === 'beads' && mask) {
      const R = Bw / 2, pitch = Math.max(Bw * 0.5, B.pitch || Bw), bb = mask.bbox;
      const lines = isoLines((x, y) => edge.sd(x, y), { x0: bb.x0 - 1, y0: bb.y0 - 1, x1: bb.x1 + 1, y1: bb.y1 + 1 }, Math.max(0.15, Math.min(0.5, Bw / 6)), B0 + R);
      const cs = alongLines(lines, pitch), cell = Math.max(R, pitch), grid = new Map();
      for (const c of cs) { const key = Math.floor(c[0] / cell) + ',' + Math.floor(c[1] / cell); const l = grid.get(key); if (l) l.push(c); else grid.set(key, [c]); }
      bead = (x, y) => {
        const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
        let r2 = Infinity;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const c of grid.get((gx + a) + ',' + (gy + b)) || []) r2 = Math.min(r2, (c[0] - x) ** 2 + (c[1] - y) ** 2);
        const q = Math.sqrt(r2) / R;
        return q >= 1 ? 1 : 1 - Math.sqrt(1 - q * q);
      };
      bead.count = cs.length;
    }
    const band = (u, x, y) => (bead ? bead(x, y) : prof ? prof(Math.min(1, Math.max(0, u))) : 0) * Bd;
    h = (x, y) => {
      const d = mask ? mask.sd(x, y) : 1;
      if (d <= 0) return 0;
      if (B) {
        const e = edge ? edge.sd(x, y) : d;
        // off the part (the bit's reach past its edge) the band's outer side carries on
        if (e < B0) return B0 > 0 ? 0 : band(0, x, y);
        if (e <= B1) return band((e - B0) / Bw, x, y);
      }
      const di = B ? Math.min(d, (edge ? edge.sd(x, y) : d) - B1) : d;
      const m = di <= 0 ? 0 : soft <= 0 || di >= soft ? 1 : C(di / soft);
      if (m <= 0) return 0;
      const v = hb(x, y);
      return (floor + (up ? d0 - v : v)) * m;
    };
    depth = Math.max(floor + d0, Bd);
    if (B && B.style !== 'rim' && B.style !== 'step') feature = Math.min(feature || Infinity, Bw / 2);
    if (bead) feature = Math.min(feature, Bw / 2);
  }
  const bbox = mask ? mask.bbox : (spec.board ? { x0: 0, y0: 0, x1: spec.board.w, y1: spec.board.h } : { x0: -50, y0: -50, x1: 50, y1: 50 });
  const localBox = (pad = 0) => {
    const cs = [[bbox.x0, bbox.y0], [bbox.x1, bbox.y0], [bbox.x0, bbox.y1], [bbox.x1, bbox.y1]];
    const us = cs.map(([x, y]) => toU(x, y)), vs = cs.map(([x, y]) => toV(x, y));
    return { u0: Math.min(...us) - pad, u1: Math.max(...us) + pad, v0: Math.min(...vs) - pad, v1: Math.max(...vs) + pad };
  };
  return {
    pattern: spec.pattern, label: pat.label, params, h, w, mask, bbox, depth, feature, kind, shape: sh,
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
  const R = t.diameter / 2, ta = t.type === 'v' ? Math.max(1e-6, Math.tan(t.angle * Math.PI / 360)) : 0;
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
  if (!Number.isFinite(s)) return '';
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
  // o.sayDepth false: the caller says the max-depth line in its own words (markChecks)
  if (o.sayDepth !== false && tex.depth > maxDepth + 1e-6) warnings.push(`The pattern goes ${L1(tex.depth)} deep; max depth is ${L1(maxDepth)}, so the deepest parts come out flat at ${L1(maxDepth)}.`);
  if (tex.kind === 'dots' && tex.dotDiameter) {
    const D = tex.dotDiameter, dp = Math.min(tex.params.depth, maxDepth);
    if (tool.widthAt(dp) > D * 1.03) {
      const dent = tool.widthAt(dp);
      const pr = tool.type === 'ball' ? 'ball' : tool.type === 'v' ? 'cone' : 'flat';
      // how deep a no-gouge raster gets at a dot's center
      const mx = (tex.bbox.x0 + tex.bbox.x1) / 2, my = (tex.bbox.y0 + tex.bbox.y1) / 2;
      const c = tex.dots().reduce((b, q) => (!b || Math.hypot(q.x - mx, q.y - my) < Math.hypot(b.x - mx, b.y - my) ? q : b), null);
      const reach = c ? -dropCutter(tex.h, tool, c.x, c.y, { res: Math.min(0.1, D / 20) }) : 0;
      warnings.push(`The ${tool.name} can't make ${L1(D)} dots ${L1(dp)} deep${tool.type === 'flat' ? ` — it is ${L2(tool.diameter)} across` : ''}. Plunged, it would make ${L1(dent)} dents; rastered without gouging it only gets ${L2(reach)} deep at each dot's center.`);
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
    if (tool.type !== 'v' && tool.widthAt(dp) > W * 1.03) warnings.push(`The ${tool.name} can't cut ${L1(W)} grooves ${L1(dp)} deep; the narrowest groove it can cut that deep is ${L1(tool.widthAt(dp))}. Raster will leave them shallower; centerline will cut them wider.`);
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
//     fill: { fill: 'texture', pattern, params, scale, angle, origin: [x, y], fade, depth, tool, bit,
//             path: 'auto' | 'raster' | 'crosshatch' | 'plunge' | 'centerline', finish, grit,
//             relief: 'in' | 'up', floor, curve, border }   (newFill, fillShape)
//           | { fill: 'pierce', ... }   (see Pierce)
//   }
//
// The region and the pattern both live in the mark's frame, so a mark scales, turns and mirrors
// with its part as a picture would; its depth stays the depth.

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
  return { fill: 'texture', pattern, params, scale: 1, angle: 0, origin: [0, 0], fade: 3, depth: params.depth, tool: suggestBit(pattern, params), path: 'auto', finish: 'standard', grit: 0, ...over };
}

// The bit each pattern cuts best by default (Phil 11-01: the default bit and stepover should make the
// pattern recognizable). Measured against the design on a 60 mm square (cut vs designed surface):
// the 1/4 in ball holds every surface and dot pattern at a correlation of 0.92 or more in a few
// minutes; line patterns (knurl, step & repeat, memphis as lines) come out exact and faster with a
// 90° V along their centerlines. A pocketed or solid fill needs the ball's raster.
export function suggestBit(pattern, params = {}) {
  if (pattern === 'knurl') return 'v90';
  if ((pattern === 'motif' && params.fill !== 'pocket') || (pattern === 'memphis' && params.fill !== 'solid')) return 'v90';
  // reaction's stripes and spots are about Detail wide: under 9 mm the 1/8 in ball keeps them crisp
  if (pattern === 'reaction' && (params.size ?? 7) < 9) return 'ball18';
  return 'ball14';
}

// How finely a raster goes over the texture: the scallop (the ridge left between passes) the
// stepover is worked out from. Standard leaves 0.05 mm ridges (a ball) that sanding takes off;
// smoother costs time for little you can see; ridged and bold leave the passes showing, on purpose.
export const FINISHES = { smooth: 0.2, fine: 0.5, standard: 1, ridged: 4, bold: 10 };
export const FINISH_WORDS = { smooth: 'smooth (slow)', fine: 'fine', standard: 'standard', ridged: 'ridged: the passes show', bold: 'bold ridges' };

// The mark's texture in the part's frame (null for an empty region or a fill that is not a texture).
// o.part: the part's outline loops (its frame): the paint counts only on its top and runs full to
// its edges, carried o.extend mm past them so a bit reaches the edge (clipToPart).
export function markTexture(mark, o = {}) {
  const f = mark && mark.fill;
  if (!f || f.fill !== 'texture' || !PATTERNS[f.pattern]) return null;
  let region = regionSpec(mark.region);
  if (!region) return null;
  if (o.part && region.type === 'paint') { const c = clipToPart(region, mark.xf, o.part, o.extend ?? 0); if (!c.paint.data.some((v) => v)) return null; region = edgeMask(c); }
  if (region.type === 'paint' && region.data && !region.data.some((v) => v)) return null;
  const A = mark.xf || IDENTITY, s = xfScale(A);
  const tex = texture({
    pattern: f.pattern,
    params: { ...(f.params || {}), depth: f.depth },
    transform: { angle: f.angle || 0, scale: f.scale || 1, ox: (f.origin || [0, 0])[0], oy: (f.origin || [0, 0])[1] },
    mask: region,
    soft: Math.max(0, f.fade || 0) / s,
    shape: fillShape(f, s),
    edge: f.border && f.border.along !== 'paint' && region.part ? region.part : null,
    overlay: f.grit > 0 ? { pattern: 'noise', params: { scale: 7, octaves: 2, depth: 1, seed: 5 }, amount: f.grit, mode: 'add' } : null,
  });
  return placeTexture(tex, A);
}

// ---------------------------------------------------------------------------------------------
// The TEX recipe (v1): a mark's texture as a file another app can draw (Phil 11-01: Unreason first).
// The pattern, its numbers, the turn and scale, the shaping and the region, in the mark's own mm;
// how it is cut (bit, path, finish) apart, for readers that cut. `check` carries 64 depths and the
// stroke and dot counts, so a reader can say whether it draws what swarf draws, never "close".
// A pattern whose meaning changes gets a new number in PATTERN_VERSIONS; a reader refuses one it
// does not know rather than half-read it.
export const RECIPE_FORMAT = 'tex-recipe', RECIPE_VERSION = 1, RECIPE_CORE = 'swarf-tex-core 093';
export const PATTERN_VERSIONS = Object.fromEntries(Object.keys(PATTERNS).map((k) => [k, 1]));
export function recipeOf(mark) {
  const f = mark && mark.fill;
  if (!f || f.fill !== 'texture' || !PATTERNS[f.pattern]) return null;
  const region = storeRegion(regionSpec(mark.region));
  const r = {
    format: RECIPE_FORMAT, version: RECIPE_VERSION, core: RECIPE_CORE,
    pattern: f.pattern, patternVersion: PATTERN_VERSIONS[f.pattern],
    params: { ...defaults(f.pattern), ...(f.params || {}), depth: f.depth },
    transform: { angle: f.angle || 0, scale: f.scale || 1, origin: (f.origin || [0, 0]).slice() },
    shape: { relief: f.relief === 'up' ? 'up' : 'in', floor: +f.floor || 0, fade: +f.fade || 0, curve: f.curve || 'smooth', grit: +f.grit || 0,
      border: f.border && f.border.style && f.border.style !== 'none' ? { ...borderDefaults(), ...f.border } : null },
    region: { frame: 'plane-mm', ...region },
    making: { tool: f.tool, bit: f.bit || null, path: f.path || 'auto', finish: f.finish || 'standard' },
  };
  r.check = checkOf(r);
  return r;
}
// the fill a recipe stands for (and back into a mark, in its own frame)
export function fillOfRecipe(r) {
  const s = r.shape || {};
  return {
    fill: 'texture', pattern: r.pattern, params: { ...r.params }, depth: r.params.depth, angle: r.transform.angle, scale: r.transform.scale,
    origin: r.transform.origin.slice(), fade: s.fade || 0, curve: s.curve || 'smooth', relief: s.relief, floor: s.floor || 0, grit: s.grit || 0,
    border: s.border ? { ...s.border } : undefined, tool: r.making && r.making.tool, bit: r.making && r.making.bit || undefined,
    path: (r.making && r.making.path) || 'auto', finish: (r.making && r.making.finish) || 'standard',
  };
}
export function textureOfRecipe(r) {
  const why = recipeRefusal(r);
  if (why) throw new Error(why);
  const { frame, ...region } = r.region;
  return markTexture({ region, xf: IDENTITY.slice(), fill: fillOfRecipe(r) });
}
// why a recipe cannot be read here, or null
export function recipeRefusal(r) {
  if (!r || r.format !== RECIPE_FORMAT) return 'not a TEX recipe';
  if (r.version !== RECIPE_VERSION) return `TEX recipe version ${r.version}; this reads version ${RECIPE_VERSION}`;
  if (!PATTERNS[r.pattern]) return `the pattern "${r.pattern}" is not one this core draws`;
  if (r.patternVersion !== PATTERN_VERSIONS[r.pattern]) return `${PATTERNS[r.pattern].label} version ${r.patternVersion}; this core draws version ${PATTERN_VERSIONS[r.pattern]}`;
  return null;
}
// 64 depths on an 8 x 8 grid over the region's box (cell middles), and the stroke and dot counts
export function checkOf(r) {
  const tex = textureOfRecipe(r);
  if (!tex) return { grid: [], strokes: 0, dots: 0, tol: 1e-6 };
  const b = tex.bbox, grid = [];
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
    const x = b.x0 + (i + 0.5) * (b.x1 - b.x0) / 8, y = b.y0 + (j + 0.5) * (b.y1 - b.y0) / 8;
    grid.push([+x.toFixed(6), +y.toFixed(6), +tex.h(x, y).toFixed(9)]);
  }
  return { grid, strokes: tex.kind === 'strokes' ? tex.strokes().length : 0, dots: tex.kind === 'dots' ? tex.dots().length : 0, tol: 1e-6 };
}
// a reader's own depths h(x, y) against the recipe's check: { ok, off, worst, said }
export function verifyRecipe(r, h, counts = {}) {
  const c = r.check || { grid: [] }, tol = c.tol || 1e-6;
  let off = 0, worst = 0;
  for (const [x, y, z] of c.grid) { const e = Math.abs(h(x, y) - z); if (e > tol) off++; worst = Math.max(worst, e); }
  const cnt = (counts.strokes != null && counts.strokes !== c.strokes) || (counts.dots != null && counts.dots !== c.dots);
  const ok = !off && !cnt;
  return { ok, off, worst, said: ok ? `matches ${r.core}` : `this reader draws a different texture: ${off} of ${c.grid.length} samples off by up to ${+worst.toFixed(3)} mm${cnt ? ', and its strokes or dots count differently' : ''}` };
}

// the fill's shaping in the mark's frame (lengths over the mark's scale s; depths stay)
export function fillShape(f, s = 1) {
  const b = f.border && f.border.style && f.border.style !== 'none' ? { ...borderDefaults(), ...f.border } : null;
  return {
    relief: f.relief === 'up' ? 'up' : 'in', floor: Math.max(0, +f.floor || 0), curve: f.curve || 'smooth',
    border: b ? { ...b, width: b.width / s, inset: b.inset / s, pitch: b.pitch / s } : null,
  };
}

// which path a texture takes with a tool: the one asked for when it fits the pattern, else the
// best for it: one plunge per dot when the bit can make the dots, the groove's center with a V
export function pathFor(tex, toolIn, style = 'auto') {
  const tool = toolIn.prof ? toolIn : makeTool(toolIn);
  const ok = { raster: true, crosshatch: true, plunge: tex.kind === 'dots', centerline: tex.kind === 'strokes' };
  if (style !== 'auto' && ok[style]) return style;
  if (tex.kind === 'dots' && tool.type !== 'flat' && tool.widthAt(tex.params.depth) <= tex.dotDiameter * 1.03) return 'plunge';
  // a pocketed or solid fill has areas to clear, which a centerline never reaches
  if (tex.kind === 'strokes' && tool.type === 'v' && tex.params.fill !== 'pocket' && tex.params.fill !== 'solid') return 'centerline';
  return 'raster';
}

// the mark's moves, part frame, z from the top (0) down; maxDepth caps them (the board's thickness)
export function markToolpath(mark, o = {}) {
  if (mark && mark.fill && mark.fill.fill === 'pierce') return pierceToolpath(mark, { ...o, thickness: o.thickness || o.maxDepth });
  const tool = fillTool(mark && mark.fill);
  // the bit's radius past the part's edge, and a little: it reaches the edge with its whole flank
  const tex = markTexture(mark, { part: o.part, extend: tool.R + 0.5 });
  if (!tex) return { moves: [], tex: null };
  const strategy = pathFor(tex, tool, mark.fill.path);
  const b = tex.bbox, area = Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0));
  // a finer grid for small marks; a big one stays under a few million samples
  const res = o.res || Math.max(0.2, Math.min(0.6, Math.sqrt(area / 1.5e6)));
  const scallop = (tool.type === 'v' ? 0.15 : 0.05) * (FINISHES[mark.fill.finish] || 1);
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
  const tool = fillTool(mark && mark.fill);
  const tex = markTexture(mark, { part: o.part, extend: tool.R + 0.5 });
  if (!tex) return { warnings: [], notes: [], tex: null };
  const L = o.len || ((v) => `${fmt(v, 1)} mm`);
  const strategy = pathFor(tex, tool, mark.fill.path);
  const maxDepth = Math.min(tex.depth, o.thickness > 0 ? o.thickness : Infinity);
  // the board's own words for the max depth come first, not the pattern's
  const a = analyze(tex, tool, { maxDepth, strategy, len: o.len, sayDepth: false });
  const warnings = a.warnings;
  if (o.thickness > 0 && tex.depth >= o.thickness - 1e-6) warnings.unshift(`The texture goes ${L(tex.depth)} deep and the board is ${L(o.thickness)} thick: it would cut through. It stops at the board's bottom.`);
  const deep = Math.min(tex.depth, o.thickness > 0 ? o.thickness : Infinity);
  if (tool.flute > 0 && deep > tool.flute + 0.1) warnings.unshift(`The ${tool.name} cuts ${L(tool.flute)} deep at most (its flutes); this texture goes ${L(deep)}. Make it shallower or use a longer bit.`);
  if (o.outside > 0.02) warnings.push(`${Math.round(o.outside * 100)}% of the mark is off the part: that much of the texture cuts air, or the board around the part.`);
  return { warnings, notes: a.notes, tex, tool, strategy };
}
// what a mark will cut: the checks, the path the core picks and the cut time (TEX's card, in its
// worker or on the page)   o = { thickness (mm), part, len, down (step down), rate, plunge (mm/min) }
export function markReport(mark, o = {}) {
  const chk = markChecks(mark, { thickness: o.thickness, len: o.len, part: o.part });
  let seconds = 0, strategy = 'raster';
  if (chk.tex || chk.cuts) {
    const p = markToolpath(mark, { maxDepth: o.thickness, stepDown: o.down > 0 ? o.down : 0, res: 0.6, part: o.part });
    seconds = estimateTime(p.moves, { feed: o.rate / 60, plunge: o.plunge / 60 }).seconds;
    strategy = p.strategy;
  }
  return { warnings: chk.warnings, notes: chk.notes, strategy, seconds };
}

// ---------------------------------------------------------------------------------------------
// The mark on its part (Phil 10-30: "paint goes to, can't go past, the top edge, ever; everything
// has to be reachable by the mill; hitting the edge means pierce/texture to the edge").
//
// clipToPart(region, xf, loops, extend): the paint counts only on the part's top (loops: the part's
// outline and holes, even-odd, in the part's frame). Where the paint meets the part's edge, or a
// hole's, the mark is carried `extend` mm on past that edge into the air, so (1) the soft edge fades
// only along the paint's own boundary inside the part, never along the part's edge, and (2) the bit
// may hang past the edge to reach it. Returns, in the mark's frame on a grid padded to hold that:
//   { region: the paint as the cutter sees it, paint: paint ∩ part, on: 1 where the part's top is }
export function clipToPart(region, xf, loops, extend = 0) {
  const g = regionSpec(region);
  if (!g || g.type !== 'paint' || !loops || !loops.length) return { region: g, paint: g, on: null };
  const A = xf || IDENTITY, I = xfInvert(A), s = xfScale(A);
  const pad = Math.ceil(Math.max(0, extend) / s / g.res) + 1;
  const nx = g.nx + 2 * pad, ny = g.ny + 2 * pad, res = g.res, x0 = g.x0 - pad * res, y0 = g.y0 - pad * res, N = nx * ny;
  // the part's top in the mark's frame, by scanline: even-odd crossings of every loop on each row
  const on = new Uint8Array(N), segs = [];
  for (const L of loops) for (let i = 0; i < L.length; i++) {
    const a = xfApply(I, L[i][0], L[i][1]), b = xfApply(I, L[(i + 1) % L.length][0], L[(i + 1) % L.length][1]);
    if (a[1] !== b[1]) segs.push(a[1] < b[1] ? [a[0], a[1], b[0], b[1]] : [b[0], b[1], a[0], a[1]]);
  }
  for (let j = 0; j < ny; j++) {
    const y = y0 + (j + 0.5) * res, xs = [];
    for (const q of segs) if (y >= q[1] && y < q[3]) xs.push(q[0] + (y - q[1]) * (q[2] - q[0]) / (q[3] - q[1]));
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - x0) / res - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[k + 1] - x0) / res - 0.5));
      for (let i = i0; i <= i1; i++) on[j * nx + i] = 1;
    }
  }
  const paint = new Uint8Array(N);
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const k = (j + pad) * nx + i + pad;
    if (g.data[j * g.nx + i] && on[k]) paint[k] = 1;
  }
  // carried past the edge: off-part cells within `extend` of the paint
  const data = paint.slice();
  if (extend > 0) {
    const D = chamfer(paint, nx, ny), lim = extend / s / res;
    for (let k = 0; k < N; k++) if (!on[k] && D[k] <= lim) data[k] = 1;
  }
  // the soft edge is measured to the paint's own edge only: off the part counts as painted
  const fade = paint.slice();
  for (let k = 0; k < N; k++) if (!on[k]) fade[k] = 1;
  const grid = (d) => ({ type: 'paint', x0, y0, res, nx, ny, data: d });
  return { region: grid(data), paint: grid(paint), fade: grid(fade), on };
}
// a mask for texture(): it cuts where `region` is, fading as the distance to `fade`'s edge
export function edgeMask(c) {
  const reg = paintMask(c.region), fm = paintMask(c.fade), R = c.region, small = R.res * 0.25;
  const inR = (x, y) => { const i = Math.floor((x - R.x0) / R.res), j = Math.floor((y - R.y0) / R.res); return i >= 0 && j >= 0 && i < R.nx && j < R.ny && R.data[j * R.nx + i] === 1; };
  const part = c.paint ? paintMask(c.paint) : null;
  return { bbox: reg.bbox, empty: reg.empty, sd: (x, y) => (inR(x, y) ? Math.max(small, fm.sd(x, y)) : Math.min(-small, reg.sd(x, y))), cut: reg, part };
}
// distance (in cells) from every cell to the nearest set cell: two-pass chamfer
function chamfer(set, nx, ny) {
  const N = nx * ny, D = new Float32Array(N), BIG = 1e9, b = Math.SQRT2;
  for (let k = 0; k < N; k++) D[k] = set[k] ? 0 : BIG;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i; let v = D[k]; if (!v) continue;
    if (i > 0) v = Math.min(v, D[k - 1] + 1);
    if (j > 0) { v = Math.min(v, D[k - nx] + 1); if (i > 0) v = Math.min(v, D[k - nx - 1] + b); if (i < nx - 1) v = Math.min(v, D[k - nx + 1] + b); }
    D[k] = v;
  }
  for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i; let v = D[k]; if (!v) continue;
    if (i < nx - 1) v = Math.min(v, D[k + 1] + 1);
    if (j < ny - 1) { v = Math.min(v, D[k + nx] + 1); if (i < nx - 1) v = Math.min(v, D[k + nx + 1] + b); if (i > 0) v = Math.min(v, D[k + nx - 1] + b); }
    D[k] = v;
  }
  return D;
}
// how far in from its own edge the paint reaches at its deepest (mm in the grid's frame): a bit wider
// than twice this cannot go round it
export function insideReach(region) {
  const g = regionSpec(region), N = g.nx * g.ny, off = new Uint8Array(N);
  for (let k = 0; k < N; k++) off[k] = g.data[k] ? 0 : 1;
  const D = chamfer(off, g.nx, g.ny);
  let m = 0;
  for (let k = 0; k < N; k++) if (g.data[k] && D[k] > m) m = D[k];
  return m * g.res;
}
// how far a point (part frame) is from the part's edge (any loop)
export function edgeDistance(loops, x, y) {
  let d = Infinity;
  for (const L of loops) for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length]; d = Math.min(d, segDist(x, y, [a[0], a[1], b[0], b[1]])); }
  return d;
}

// ---------------------------------------------------------------------------------------------
// The mark's edge as a curve with points (Pgon's and MASQ's region curve, in 2D on the mark's grid).
// - FIT: the paint's 0.5 contour (marching squares), faired, handles at even arc length. Handles are
//   INTERPOLATION points of a closed uniform cubic B-spline (a cyclic tridiagonal solve), so a dragged
//   point lands where the hand put it. One curve per loop; a hole in the paint is its own loop.
// - BACK INTO THE PAINT: inside the curves (their winding, from the orientation each loop had when it
//   was fitted: the paint on its left) = painted; the soft edge is then measured to the curve. The
//   paint at the START of a drag fixes the grid; nothing is read from the last move (no ratchet).
// - A curve that crosses itself or another refuses: the old paint stands.

function solveCyclic(n, rhs) {
  const a = 1, c = 1, gamma = -4;
  const bb = new Float64Array(n).fill(4); bb[0] = 4 - gamma; bb[n - 1] = 4 - a * c / gamma;
  const thomas = (d) => {
    const cp = new Float64Array(n), dp = new Float64Array(n);
    cp[0] = c / bb[0]; dp[0] = d[0] / bb[0];
    for (let i = 1; i < n; i++) { const den = bb[i] - a * cp[i - 1]; cp[i] = c / den; dp[i] = (d[i] - a * dp[i - 1]) / den; }
    const x = new Float64Array(n); x[n - 1] = dp[n - 1];
    for (let i = n - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1];
    return x;
  };
  const u = new Float64Array(n); u[0] = gamma; u[n - 1] = c;
  const y = thomas(rhs), q = thomas(u);
  const f = (y[0] + a * y[n - 1] / gamma) / (1 + q[0] + a * q[n - 1] / gamma);
  const x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = y[i] - f * q[i];
  return x;
}
// the closed spline's control points that make it pass through every handle
export function controlsFor(handles) {
  const n = handles.length;
  if (n < 3) return null;
  const cx = solveCyclic(n, Float64Array.from(handles, (h) => 6 * h[0])), cy = solveCyclic(n, Float64Array.from(handles, (h) => 6 * h[1]));
  return handles.map((_, i) => [cx[i], cy[i]]);
}
export function splineAt(Q, u) {
  const n = Q.length, i = Math.floor(u), t = u - i, t2 = t * t, t3 = t2 * t;
  const at = (k) => Q[((k % n) + n) % n];
  const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
  const b0 = (1 - 3 * t + 3 * t2 - t3) / 6, b1 = (4 - 6 * t2 + 3 * t3) / 6, b2 = (1 + 3 * t + 3 * t2 - 3 * t3) / 6, b3 = t3 / 6;
  return [p0[0] * b0 + p1[0] * b1 + p2[0] * b2 + p3[0] * b3, p0[1] * b0 + p1[1] * b1 + p2[1] * b2 + p3[1] * b3];
}
// a closed curve as a polyline: `per` samples a span, and which span each sample lies on
export function sampleCurve(handles, per = 12) {
  const Q = controlsFor(handles);
  if (!Q) return { pts: [], span: [] };
  const pts = [], span = [];
  for (let k = 0; k < handles.length; k++) for (let j = 0; j < per; j++) { pts.push(splineAt(Q, k + j / per)); span.push(k); }
  return { pts, span };
}
const loopLen = (P) => { let L = 0; for (let i = 0; i < P.length; i++) L += Math.hypot(P[(i + 1) % P.length][0] - P[i][0], P[(i + 1) % P.length][1] - P[i][1]); return L; };
const loopArea2 = (P) => { let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += (P[j][0] + P[i][0]) * (P[j][1] - P[i][1]); return -a / 2; };
function resampleLoop(P, count) {
  const n = P.length, seg = P.map((p, i) => Math.hypot(P[(i + 1) % n][0] - p[0], P[(i + 1) % n][1] - p[1]));
  const total = seg.reduce((a, b) => a + b, 0), out = [];
  let acc = 0, i = 0;
  for (let k = 0; k < count; k++) {
    const want = total * k / count;
    while (i < n - 1 && acc + seg[i] < want) { acc += seg[i]; i++; }
    const t = seg[i] > 0 ? (want - acc) / seg[i] : 0, a = P[i], b = P[(i + 1) % n];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}
// Taubin λ|μ: the cells' staircase comes off and the loop does not shrink
function fair(P, passes) {
  let p = P.map((q) => q.slice());
  const step = (k) => { const n = p.length; p = p.map((c, i) => { const a = p[(i - 1 + n) % n], b = p[(i + 1) % n]; return [c[0] + k * ((a[0] + b[0]) / 2 - c[0]), c[1] + k * ((a[1] + b[1]) / 2 - c[1])]; }); };
  for (let it = 0; it < passes; it++) { step(0.6307); step(-0.6732); }
  return p;
}
// The paint's edge loops (marching squares on the cells, paint on each loop's left), in the grid's frame
export function paintLoops(region) {
  const g = regionSpec(region), { nx, ny, res, x0, y0 } = g, d = g.data;
  const at = (i, j) => (i >= 0 && j >= 0 && i < nx && j < ny ? d[j * nx + i] : 0);
  // directed boundary edges between cell corners, paint on the left: corner (i, j) is (x0 + i res, y0 + j res)
  const next = new Map(), key = (i, j) => i * 100003 + j;
  const add = (a, b) => { const k = key(a[0], a[1]); const l = next.get(k); if (l) l.push(b); else next.set(k, [b]); };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!at(i, j)) continue;
    if (!at(i, j - 1)) add([i, j], [i + 1, j]);
    if (!at(i + 1, j)) add([i + 1, j], [i + 1, j + 1]);
    if (!at(i, j + 1)) add([i + 1, j + 1], [i, j + 1]);
    if (!at(i - 1, j)) add([i, j + 1], [i, j]);
  }
  const loops = [];
  for (const [k0, list] of next) {
    while (list.length) {
      const start = [Math.floor(k0 / 100003), k0 % 100003];
      const L = [start];
      let cur = list.pop(), guard = 0;
      while (guard++ < 4e6) {
        if (cur[0] === start[0] && cur[1] === start[1]) break;
        L.push(cur);
        const l = next.get(key(cur[0], cur[1]));
        if (!l || !l.length) break;
        cur = l.pop();
      }
      // corners to edge midpoints (the 0.5 contour of the cells), in mm
      const P = L.map((q, i) => { const r = L[(i + 1) % L.length]; return [x0 + (q[0] + r[0]) / 2 * res, y0 + (q[1] + r[1]) / 2 * res]; });
      if (P.length >= 4) loops.push(P);
    }
  }
  return loops;
}
// how far a curve through these handles strays from the polyline it was fitted to (its worst point)
function fitError(handles, P) {
  const C = sampleCurve(handles, 8).pts;
  let worst = 0;
  const near = (q, L) => { let d = Infinity; for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length]; d = Math.min(d, segDist(q[0], q[1], [a[0], a[1], b[0], b[1]])); } return d; };
  for (const q of C) worst = Math.max(worst, near(q, P));
  for (let i = 0; i < P.length; i += Math.max(1, Math.floor(P.length / 120))) worst = Math.max(worst, near(P[i], C));
  return worst;
}
// FIT: { loops: [{ handles, orient }] }. With `tol` (mm in the grid's frame): each loop gets the fewest
// points, from one per ~10 mm up, whose curve stays within tol of the paint's edge. With `count`
// instead: that many on the longest loop, the rest by length (fewer and more).
export function fitCurves(region, { count = 0, tol = 1, minCount = 4, maxCount = 80 } = {}) {
  const g = regionSpec(region);
  const raw = paintLoops(g).filter((P) => loopLen(P) > 4 * g.res);
  if (!raw.length) return { loops: [] };
  const faired = raw.map((P) => fair(resampleLoop(P, Math.max(24, Math.round(loopLen(P) / (g.res * 0.5)))), 6));
  const Lmax = Math.max(...faired.map(loopLen));
  return {
    loops: faired.map((P) => {
      let n;
      if (count > 0) n = Math.max(minCount, Math.round(count * loopLen(P) / Lmax));
      else {
        n = Math.max(minCount, Math.min(maxCount, Math.round(loopLen(P) / 10)));
        while (n < maxCount && fitError(resampleLoop(P, n), P) > tol) n = Math.min(maxCount, Math.ceil(n * 1.25));
      }
      const handles = resampleLoop(P, n);
      return { handles, orient: Math.sign(loopArea2(handles)) || 1 };
    }),
  };
}
const segX = (a, b, c, d) => {
  const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
  if (Math.abs(den) < 1e-12) return false;
  const s = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den, t = ((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / den;
  return s > 1e-9 && s < 1 - 1e-9 && t > 1e-9 && t < 1 - 1e-9;
};
// does any sampled curve cross itself or another (or turn over: its orientation flipped)?
export function curvesCross(curves) {
  const S = curves.loops.map((c) => sampleCurve(c.handles, 8).pts);
  for (let li = 0; li < S.length; li++) if (Math.sign(loopArea2(S[li])) !== curves.loops[li].orient) return true;
  for (let a = 0; a < S.length; a++) for (let b = a; b < S.length; b++) {
    const A = S[a], B = S[b];
    for (let i = 0; i < A.length; i++) for (let j = a === b ? i + 2 : 0; j < B.length; j++) {
      if (a === b && i === 0 && j === A.length - 1) continue;
      if (segX(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return true;
    }
  }
  return false;
}
// BACK INTO THE PAINT: a fresh grid like `base` (the paint at the drag's start), painted where the
// curves wind (each counted with the orientation it was fitted with). null when they cross.
export function rewriteFromCurves(base, curves) {
  if (curvesCross(curves)) return null;
  const g = regionSpec(base), { nx, ny, res, x0, y0 } = g, data = new Uint8Array(nx * ny);
  const polys = curves.loops.map((c) => ({ P: sampleCurve(c.handles, 12).pts, o: c.orient }));
  for (let j = 0; j < ny; j++) {
    const y = y0 + (j + 0.5) * res, cross = [];
    // winding by scanline: an outer loop runs counterclockwise (paint on its left) and counts +1
    // inside, a hole's clockwise loop -1; the orientations are the ones fitted (a flip is refused above)
    for (const { P } of polys) for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      if ((a[1] <= y) === (b[1] <= y)) continue;
      cross.push([a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]), b[1] > a[1] ? -1 : 1]);
    }
    cross.sort((p, q) => p[0] - q[0]);
    let w = 0, c = 0;
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * res;
      while (c < cross.length && cross[c][0] < x) { w += cross[c][1]; c++; }
      if (w > 0) data[j * nx + i] = 1;
    }
  }
  return { ...g, data };
}
// where on the curves a point is nearest: { loop, span, t, d, p } (span: the handle before it)
export function nearestOnCurves(curves, x, y) {
  let best = null;
  curves.loops.forEach((c, li) => {
    const { pts, span } = sampleCurve(c.handles, 16);
    pts.forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - y); if (!best || d < best.d) best = { loop: li, span: span[i], d, p }; });
  });
  return best;
}

// ---------------------------------------------------------------------------------------------
// Pierce: cuts that go through (or nearly through) the board from a mark, so the part bends or
// lets light and air through. Ported from the bendy-ply generator, router first. Every number
// here is a RULE OF THUMB until test strips are cut and measured.
//
//   fill = { fill: 'pierce', pattern: 'kerf' | 'holes', params, angle, origin, fade, tool, bit }
//
// kerf: straight cuts along the bend line (the mark's turn sets it), a bit wide, leaving `skin`
//   under them (0 = right through). The pitch is where neighboring kerfs just close when the
//   part bends to the radius asked for: p = w·R / (T − s) (w the bit, T the board, s the skin).
//   Bridges break each cut into slots (staggered row to row) so a through-cut part holds together.
// holes: round holes on a grid or a hex lattice, through; each cleared from its middle outward,
//   so nothing is left loose in it.
// The soft edge thins the pattern toward the mark's edge: slots break into shorter dashes,
// holes get smaller (and drop out under the bit's own size).

const PIERCE_P = (k, label, min, max, step, def, unit = 'mm', basic = false, tip = '', typed) => ({ k, label, type: 'range', min, max, step, def, unit, basic, tip, ...(typed ? { lo: typed[0], hi: typed[1] } : {}) });
export const PIERCES = {
  kerf: {
    label: 'kerfs', short: 'kerfs', blurb: 'Parallel cuts along a bend line: the part bends across them.',
    params: [PIERCE_P('radius', 'Bend radius', 25, 600, 1, 100, 'mm', true, 'the inside of the curve you want: a coffee can is about 50 mm, a bucket about 150. Smaller bends tighter and needs kerfs closer together', [10, 5000]),
      PIERCE_P('skin', 'Skin left', 0, 6, 0.1, 2.5, 'mm', true, 'wood left under every kerf, on the face that stays smooth (the outside of the bend). 0 cuts right through; then bridges hold the strips together', [0, 50]),
      PIERCE_P('bridge', 'Bridge', 0, 60, 0.5, 0, 'mm', false, 'uncut wood between the slots along each kerf; 0 for kerfs that run unbroken', [0, 300]),
      PIERCE_P('slot', 'Slot length', 20, 300, 1, 80, 'mm', false, 'how long each cut is between bridges (with bridges)', [5, 2000])],
  },
  holes: {
    label: 'holes', short: 'holes', blurb: 'Round holes right through, on a grid or a hex lattice.',
    params: [PIERCE_P('size', 'Hole size', 3, 40, 0.5, 10, 'mm', true, 'across each hole; no smaller than the bit'),
      PIERCE_P('spacing', 'Spacing', 6, 80, 0.5, 18, 'mm', true, 'from one hole\'s middle to the next; the wood between is spacing less size'),
      { k: 'layout', label: 'Layout', type: 'select', options: ['hex', 'grid'], def: 'hex' }],
  },
};
// the skin's allowable bending strain: birch ply about 0.75 % (0.5–1 %), a guess until strips are bent
export const SKIN_STRAIN = 0.0075;
// the skin a board of thickness T starts with: 2.5 mm, but never more than a quarter of the board
// (review 10-30: 2.5 mm on 6 mm plywood left 3.5 mm to flex, so the kerfs fell 91 mm apart), nor
// more than bends to the default radius without cracking (SKIN_STRAIN: 1.5 mm at 100 mm)
export function defaultSkin(T, R = 100) {
  const crack = Math.floor(2 * SKIN_STRAIN * R * 10 + 1e-9) / 10;
  return Math.min(2.5, crack, T > 0 ? Math.round(T / 4 * 10) / 10 : 2.5);
}
export function pierceDefaults(id, T) {
  const o = {};
  for (const q of (PIERCES[id] ? PIERCES[id].params : [])) o[q.k] = q.def;
  if (id === 'kerf') o.skin = defaultSkin(T);
  return o;
}
export function newPierce(pattern = 'kerf', over = {}, T) {
  return { fill: 'pierce', pattern, params: pierceDefaults(pattern, T), angle: 0, origin: [0, 0], fade: 0, tool: 'flat18', ...over };
}
// the bit a fill names: a full spec (fill.bit, from a host's tool library), or one of TOOLS by id
export function fillTool(f) {
  // a V's angle inside (0, 180): a saved file's 0 would make every depth NaN
  if (f && f.bit && f.bit.type && f.bit.diameter > 0 && (f.bit.type !== 'v' || (f.bit.angle > 0 && f.bit.angle < 180))) return makeTool(f.bit);
  if (f && typeof f.tool === 'string' && TOOLS[f.tool]) return makeTool(f.tool);
  return makeTool(f && f.fill === 'pierce' ? 'flat18' : 'ball14');
}
// the kerf pitch for a bit width w, board T, skin s and bend radius R (closure: the kerfs just touch)
export function roundProse(v) { const a = Math.abs(v); return a < 20 ? Math.round(v * 2) / 2 : Math.round(v); }
export function kerfPitch(w, T, s, R) { return w * R / Math.max(1e-6, T - Math.max(0, s)); }

// The cuts, in the part's frame: { slots: [{ a: [x, y], b: [x, y] }], holes: [{ x, y, d }], depth,
// through, pitch, width, mask } — or null for an empty region.
export function pierceCuts(mark, o = {}) {
  const f = mark && mark.fill;
  if (!f || f.fill !== 'pierce' || !PIERCES[f.pattern]) return null;
  let region = regionSpec(mark.region);
  if (!region || (region.type === 'paint' && !region.data.some((v) => v))) return null;
  const A = mark.xf || IDENTITY, s = xfScale(A), I = xfInvert(A);
  const tool = fillTool(f), w = tool.diameter, T = o.thickness > 0 ? o.thickness : 19;
  const p = { ...pierceDefaults(f.pattern, T), ...(f.params || {}) };
  // on its part: a cut that meets the part's edge runs out through it (an open notch)
  let onTop = null;
  if (o.part && region.type === 'paint') {
    const c = clipToPart(region, A, o.part, (f.pattern === 'holes' ? p.size / 2 : w / 2) + 1);
    if (!c.paint.data.some((v) => v)) return null;
    region = edgeMask(c);
    const P = c.paint;
    onTop = (x, y) => { const i = Math.floor((x - P.x0) / P.res), j = Math.floor((y - P.y0) / P.res); return i >= 0 && j >= 0 && i < P.nx && j < P.ny && P.data[j * P.nx + i] === 1; };
  }
  const mask = makeMask(region);
  const soft = Math.max(0, f.fade || 0) / s;
  const weight = maskWeight(mask, soft);
  // containment (a cut wholly inside what may be cut) is measured to the cut's own extent
  const cutMask = mask.cut || mask;
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
    // how far the mark reaches across the bend (square to the kerfs), in the part's mm: a mark
    // narrower than a pitch or two holds no more than a kerf or two, and the notes say so
    {
      const nx = -Math.sin(ang), ny = Math.cos(ang), N = 96;
      let v0 = Infinity, v1 = -Infinity;
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
        const x = b.x0 + (b.x1 - b.x0) * i / N, y = b.y0 + (b.y1 - b.y0) * j / N;
        if (cutMask.sd(x, y) < 0) continue;
        const v = x * nx + y * ny; if (v < v0) v0 = v; if (v > v1) v1 = v;
      }
      out.across = v1 >= v0 ? (v1 - v0) * s : 0;
    }
    lines.forEach(([[ax, ay], [bx, by]], li) => {
      const L = Math.hypot(bx - ax, by - ay), dx = (bx - ax) / L, dy = (by - ay) / L, n = Math.ceil(L / step);
      // this line's place along the pattern, so bridges stagger row to row
      const t0 = (ax + ox) * dx + (ay + oy) * dy, stag = (li & 1) ? period / 2 : 0;
      let run = null;
      // a slot only where it cuts the part: one wholly past the edge would cut air
      const flush = () => { if (run && run[4] && Math.hypot(run[2] - run[0], run[3] - run[1]) * s >= w) out.slots.push({ a: toPart(run[0], run[1]), b: toPart(run[2], run[3]), line: li }); run = null; };
      for (let i = 0; i <= n; i++) {
        const t = i * L / n, x = ax + ox + dx * t, y = ay + oy + dy * t;
        const m = weight(x, y), along = t0 + t;
        // the bit's center at least half the bit inside the mark, so no cut crosses its edge
        let keep = cutMask.sd(x, y) * s >= w / 2 - 1e-6 && (m >= 0.999 || (m > 0.02 && (((along % dash) + dash) % dash) / dash < m));
        if (keep && p.bridge > 0) keep = ((((along + stag) % period) + period) % period) < p.slot / s;
        if (keep) { if (!run) run = [x, y, x, y, false]; else { run[2] = x; run[3] = y; } if (!onTop || onTop(x, y)) run[4] = true; } else flush();
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
      if (m <= 0 || (onTop && !onTop(x, y))) continue;
      const d = p.size * Math.min(1, m);
      // the whole hole inside the mark, and no smaller than the bit
      if (d < w - 1e-6 || cutMask.sd(x, y) * s < d / 2 - 1e-6) continue;
      const [X, Y] = toPart(x, y);
      out.holes.push({ x: X, y: Y, d });
    }
  }
  out.inv = I;
  return out;
}

// The moves for a pierce mark, part frame, z from the top (0) down: each slot fed end to end at
// each depth in turn, each hole spiraled out from its middle at each depth (a hole the bit's own
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
  // nearest-neighbor order from the front-left, each slot from its nearer end
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

// the kerfs as lines across the bend: slots on one line (bridges) count once
export function kerfCount(cuts) {
  if (!cuts || !cuts.slots.length) return 0;
  return new Set(cuts.slots.map((q, i) => (q.line ?? i))).size;
}

// What to say about a pierce mark, in plain words; every limit here wants a test strip
export function pierceChecks(mark, o = {}) {
  const cuts = pierceCuts(mark, o);
  if (!cuts) return { warnings: [], notes: [], cuts: null };
  const f = mark.fill, tool = fillTool(f), w = tool.diameter, T = o.thickness > 0 ? o.thickness : 19;
  const p = { ...pierceDefaults(f.pattern, T), ...(f.params || {}) };
  // every length said once, one way (r086 check S3: the pitch read 2 37/64 in one sentence and
  // 2 9/16 in the next): o.len rounds (the app's prose); by default the app's mm rounding
  const L = o.len || ((v) => `${fmt(roundProse(v), 1)} mm`);
  const warnings = [], notes = ['These numbers are a starting point: cut a test strip first.'];
  if (tool.type !== 'flat') warnings.push(`The ${tool.name} leaves a ${tool.type === 'v' ? 'V' : 'round'}-bottomed cut; through cuts want a straight (flat) bit.`);
  // deeper than the bit's flutes: the shank rubs, or the collet meets the board (fill.bit.flute, mm)
  const deep = cuts.through ? T : T - Math.min(Math.max(0, p.skin || 0), T);
  if (tool.flute > 0 && deep > tool.flute + 0.1) warnings.unshift(`The ${tool.name} cuts ${L(tool.flute)} deep at most (its flutes); this goes ${L(deep)}. Use thinner stock, a longer bit, or a texture instead.`);
  if (f.pattern === 'kerf') {
    const skin = Math.min(Math.max(0, p.skin), T), rib = cuts.pitch - w;
    // kerfs counted as lines across the bend (bridges break one kerf into slots)
    const nk = kerfCount(cuts);
    notes.unshift(`Kerfs every ${L(cuts.pitch)}, ${cuts.through ? 'right through' : `${L(T - skin)} deep, leaving ${L(skin)}`}, ${nk} kerf${nk === 1 ? '' : 's'}.`,
      // the rule in words: rounded numbers in a sum never multiply out on a calculator (deep review S12)
      'The spacing is the bit\'s width × the bend radius ÷ (the board − the skin): where the kerfs just close when it bends.');
    // too few kerfs: the reason is the mark, not the bend (review 10-30 F2: "a bend this gentle
    // needs few kerfs" sent students to the radius, which on a thin board cracks the skin first)
    if (nk < 3 && cuts.across > 0) {
      const rmin = skin > 0 ? skin / (2 * SKIN_STRAIN) : 0, tighter = p.radius > rmin * 1.25 + 1;
      notes.splice(1, 0, `This mark is ${L(cuts.across)} across the bend; kerfs fall every ${L(cuts.pitch)}, so ${nk ? `only ${nk} fit${nk === 1 ? 's' : ''}` : 'none fit'}: make the mark wider across the bend${tighter ? ' or the radius smaller' : ''}. A quarter turn at ${L(p.radius)} wants about ${L(Math.PI / 2 * p.radius)} across.`);
    }
    if (rib < 2 * w) warnings.push(`The kerfs are ${L(cuts.pitch)} apart: the wood between them is thinner than two bit widths and may snap. Ask for a gentler bend (a bigger radius) or use a thinner bit.`);
    if (skin > 0) {
      const rmin = skin / (2 * SKIN_STRAIN);
      if (p.radius < rmin) warnings.push(`With ${L(skin)} of skin, a bend tighter than about ${L(rmin)} may crack it. Leave less skin, or bend it gentler.`);
      if (skin >= T) warnings.push(`The skin is as thick as the board: the kerfs cut nothing.`);
    } else if (!(p.bridge > 0)) warnings.push(`With no skin and no bridges every kerf cuts right through: the part comes apart in strips. Leave some skin, or add bridges.`);
    if (cuts.through && p.bridge > 0 && p.bridge < w) warnings.push(`Bridges ${L(p.bridge)} long are shorter than the bit is wide (${L(w)}): they may break. Make them longer.`);
  } else {
    notes.unshift(`${cuts.holes.length} hole${cuts.holes.length === 1 ? '' : 's'}, right through.`);
    if (p.size < w) warnings.push(`The ${tool.name} can't cut ${L(p.size)} holes: the bit is ${L(w)} across. Make the holes bigger or use a thinner bit.`);
    const web = p.spacing - p.size;
    if (web < 2 * w) warnings.push(`Only ${L(Math.max(0, web))} of wood is left between the holes, less than two bit widths: it may break. Space them farther apart or make them smaller.`);
  }
  if (o.part) {
    // a strip of the part between a cut and its edge, thinner than two bits: it may break off
    let thin = Infinity;
    for (const q of cuts.slots) for (let k = 0; k <= 8; k++) {
      const x = q.a[0] + (q.b[0] - q.a[0]) * k / 8, y = q.a[1] + (q.b[1] - q.a[1]) * k / 8, e = edgeDistance(o.part, x, y) - w / 2;
      if (e > 0.05 && e < thin) thin = e;
    }
    for (const h of cuts.holes) { const e = edgeDistance(o.part, h.x, h.y) - h.d / 2; if (e > 0.05 && e < thin) thin = e; }
    if (thin < 2 * w) warnings.push(`A cut runs ${L(thin)} from the part's edge, leaving a strip thinner than two bit widths that may break off. Paint the mark right to the edge (the cut then opens out through it) or keep it farther in.`);
    const open = cuts.slots.some((q) => edgeDistance(o.part, q.a[0], q.a[1]) < w / 2 || edgeDistance(o.part, q.b[0], q.b[1]) < w / 2) || cuts.holes.some((h) => edgeDistance(o.part, h.x, h.y) < h.d / 2);
    if (open) notes.push('Cuts that meet the part\'s edge run out through it, as open notches.');
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
<!-- ${mark.fill.pattern}: ${mark.fill.pattern === 'kerf' ? `kerf width ${fmt(cuts.width, 2)} mm, pitch ${fmt(cuts.pitch, 2)} mm` : `${(cuts.holes || []).length} holes, bit ${fmt(cuts.width, 2)} mm`}. A starting point: cut a test strip. -->
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
// The part as a mesh with its marks applied, for rendering (Phil 10-30: "is there a way to export
// those out as renderable meshes?"). A watertight solid in mm, z up from the board's bottom (0) to
// its top (the board's thickness): its outline and holes as walls, its top displaced by every
// texture, every pierce cut through (or down to its skin).
//
//   partMesh({ loops, thickness, marks, res, cut }) -> { positions, indices, res, cells, triangles }
//     loops: the part's outline and holes (even-odd), its own frame, mm
//     cut: false = as designed (each pattern's own surface); true = as cut (what each mark's bit
//     leaves, the drop cutter's moves stamped into a heightmap as the simulation does)
//     res: mm a grid cell; by default the finest under `maxCells` cells
//
// The walls follow the true outline: the part's polygon and every through-cut's real shape (a slot
// the bit's width round its path, a hole its circle), never the grid. The top is cut into strips at
// every outline vertex, every grid row and every crossing; each strip into trapezoids between the
// outline's edges, each trapezoid zipped into triangles through the grid's columns, so the top is a
// heightfield inside the true outline. Grooves left to a skin get their walls from two loops a hair
// either side of their edge. Each point is one vertex, so every edge belongs to two triangles.
export function partMeshSize(loops, res) {
  const b = loopsBox(loops), area = Math.max(1, (b[2] - b[0]) * (b[3] - b[1]));
  // each outline corner adds a row of the grid's columns (about a third survive the thinning, measured)
  const corners = loops.reduce((n, L) => n + L.length, 0) / 3, rows = (b[3] - b[1]) / res + corners;
  const cells = Math.ceil(rows * (b[2] - b[0]) / res * 0.4);
  return { cells, triangles: cells * 4 + Math.ceil(2 * ((b[2] - b[0]) + (b[3] - b[1])) / res) * 2 };
}
const loopsBox = (loops) => { const b = [Infinity, Infinity, -Infinity, -Infinity]; for (const L of loops) for (const q of L) { b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]); } return b; };
// 48 000 cells: a 6 x 10 in cutting board comes out near 0.9 mm, about 200 thousand triangles and
// 10 MB as STL, a file a student can email (review 10-30 F10: 0.5 mm made it 31 MB)
export function autoMeshRes(loops, maxCells = 48000) {
  const b = loopsBox(loops), area = Math.max(1, (b[2] - b[0]) * (b[3] - b[1]));
  return Math.max(0.5, Math.sqrt(area / maxCells));
}
export function partMesh(o) {
  const T = o.thickness, marks = o.marks || [];
  const res = o.res > 0 ? o.res : autoMeshRes(o.loops, o.maxCells);
  // ── the outline: the part's loops (outer counterclockwise, holes clockwise) and every through-cut
  //    (clockwise), so material is where the winding is positive: cuts that cross the edge or each
  //    other need no boolean ──
  const clean = (L) => { const out = []; for (const q of L) { const l = out[out.length - 1]; if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) > 1e-6) out.push([q[0], q[1]]); } if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-6) out.pop(); return out; };
  // a drawn curve's outline comes with a corner every fraction of a millimetre; each corner is a row of
  // the mesh below, so the corners that change little (under a sixteenth of the grid off the line) go first
  const thin = Math.min(0.1, res / 16);
  const simplify = (L) => {
    if (L.length < 8) return L;
    const keep = new Uint8Array(L.length); keep[0] = 1; keep[L.length - 1] = 1;
    const stack = [[0, L.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let far = -1, fd = thin;
      for (let i = a + 1; i < b; i++) { const d = segDist(L[i][0], L[i][1], [L[a][0], L[a][1], L[b][0], L[b][1]]); if (d > fd) { fd = d; far = i; } }
      if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
    }
    const out = L.filter((_, i) => keep[i]);
    return out.length >= 3 ? out : L;
  };
  const partLoops = o.loops.map(clean).map(simplify).filter((L) => L.length >= 3).map((L, i, all) => {
    const depth = all.reduce((n, M, k) => n + (k !== i && insidePoly(L[0][0], L[0][1], M) ? 1 : 0), 0);
    const ccw = loopArea2(L) > 0, want = depth % 2 === 0;
    return ccw === want ? L : L.slice().reverse();
  });
  const circle = (cx, cy, r, cw) => { const n = Math.max(24, Math.ceil(2 * Math.PI * r / Math.min(0.6, res))); const L = []; for (let k = 0; k < n; k++) { const a = (cw ? -1 : 1) * k / n * 2 * Math.PI; L.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return L; };
  const stadium = (a, b, r, cw) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L0 = Math.hypot(dx, dy) || 1e-9, ux = dx / L0, uy = dy / L0, nx = -uy, ny = ux;
    const n = Math.max(8, Math.ceil(Math.PI * r / Math.min(0.6, res))), out = [];
    // counterclockwise: down the right side of a→b, round b, up the left, round a
    for (let k = 0; k <= n; k++) { const t = -Math.PI / 2 + k / n * Math.PI, c = Math.cos(t), s = Math.sin(t); out.push([b[0] + r * (ux * c + nx * s), b[1] + r * (uy * c + ny * s)]); }
    for (let k = 0; k <= n; k++) { const t = Math.PI / 2 + k / n * Math.PI, c = Math.cos(t), s = Math.sin(t); out.push([a[0] + r * (ux * c + nx * s), a[1] + r * (uy * c + ny * s)]); }
    return cw ? out.reverse() : out;
  };
  const cutLoops = [], breaks = [], depthFns = [];
  // ── how deep the marks go at a point (0 the top, T through) ──
  for (const m of marks) {
    if (!m || !m.fill) continue;
    if (m.fill.fill === 'pierce') {
      const c = pierceCuts(m, { thickness: T, part: o.loops });
      if (!c) continue;
      const w2 = c.width / 2, eps = Math.min(0.02, res / 10);
      if (c.through) for (const q of c.slots) cutLoops.push(stadium(q.a, q.b, w2, true));
      else for (const q of c.slots) {
        // a groove to its skin: its walls sharp, as two near loops the surface steps between
        breaks.push(stadium(q.a, q.b, w2 - eps, false), stadium(q.a, q.b, w2 + eps, false));
        depthFns.push((x, y) => (segDist(x, y, [q.a[0], q.a[1], q.b[0], q.b[1]]) <= w2 ? c.depth : 0));
      }
      for (const h of c.holes) cutLoops.push(circle(h.x, h.y, h.d / 2, true));
      if (o.cut) { const p = markToolpath(m, { maxDepth: T, part: o.loops }); if (p.moves && p.moves.length) depthFns.push(simDepth(p, m)); }
    } else if (o.cut) {
      const p = markToolpath(m, { maxDepth: T, part: o.loops, res: Math.max(0.2, Math.min(res, 0.6)) });
      if (p.moves && p.moves.length) depthFns.push(simDepth(p, m));
    } else {
      const tex = markTexture(m, { part: o.loops });
      if (tex) depthFns.push((x, y) => Math.min(T, tex.h(x, y)));
    }
  }
  // what a mark's bit leaves, on a fine heightmap over its moves, read bilinearly
  function simDepth(p, m) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of p.moves) if (!q.rapid) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    const tool = p.tool || fillTool(m.fill), pad = tool.R + 1, r = Math.min(res, 0.25);
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    const nx = Math.ceil((x1 - x0) / r) + 1, ny = Math.ceil((y1 - y0) / r) + 1;
    const sim = createSim({ x0, y0, nx, ny, res: r }, tool);
    sim.run(p.moves);
    return (x, y) => {
      const fx = (x - x0) / r, fy = (y - y0) / r;
      if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return 0;
      const i = Math.min(nx - 2, fx | 0), j = Math.min(ny - 2, fy | 0), tx = fx - i, ty = fy - j, k = j * nx + i, Z = sim.Z;
      return Math.min(T, -((Z[k] * (1 - tx) + Z[k + 1] * tx) * (1 - ty) + (Z[k + nx] * (1 - tx) + Z[k + nx + 1] * tx) * ty));
    };
  }
  const depthAt = (x, y) => { let d = 0; for (const f of depthFns) { const v = f(x, y); if (v > d) d = v; } return d; };
  // ── every edge, its winding (a counterclockwise loop counts +1 inside it; a break line 0) ──
  const E = [];
  const addLoops = (Ls, boundary) => { for (const L of Ls) for (let i = 0; i < L.length; i++) { const a = L[i], b = L[(i + 1) % L.length]; if (a[1] === b[1]) { if (boundary) E.push({ a, b, h: true }); continue; } E.push({ a, b, w: boundary ? (b[1] > a[1] ? -1 : 1) : 0, y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) }); } };
  addLoops(partLoops, true); addLoops(cutLoops, true); addLoops(breaks, false);
  const slanted = E.filter((e) => !e.h), xAt = (e, y) => e.a[0] + (y - e.a[1]) * (e.b[0] - e.a[0]) / (e.b[1] - e.a[1]);
  // ── the strips: every vertex's height, every grid row, every crossing of two edges ──
  const box = loopsBox(partLoops), ys = new Set();
  for (const e of E) { ys.add(e.a[1]); ys.add(e.b[1]); }
  const gy0 = Math.floor(box[1] / res) * res, gx0 = Math.floor(box[0] / res) * res;
  for (let y = gy0; y <= box[3] + res; y += res) if (y > box[1] && y < box[3]) ys.add(+y.toFixed(9));
  {
    // crossings, found through a bucket grid of the edges
    const cell = Math.max(2, res * 4), B = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
    slanted.forEach((e, n) => { const i0 = Math.floor(Math.min(e.a[0], e.b[0]) / cell), i1 = Math.floor(Math.max(e.a[0], e.b[0]) / cell), j0 = Math.floor(e.y0 / cell), j1 = Math.floor(e.y1 / cell); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = key(i, j); let l = B.get(k); if (!l) B.set(k, l = []); l.push(n); } });
    const seen = new Set();
    for (const l of B.values()) for (let p = 0; p < l.length; p++) for (let q = p + 1; q < l.length; q++) {
      const A = slanted[l[p]], C = slanted[l[q]], k = l[p] < l[q] ? l[p] * 1e7 + l[q] : l[q] * 1e7 + l[p];
      if (seen.has(k)) continue; seen.add(k);
      const d = (A.b[0] - A.a[0]) * (C.b[1] - C.a[1]) - (A.b[1] - A.a[1]) * (C.b[0] - C.a[0]);
      if (Math.abs(d) < 1e-12) continue;
      const s = ((C.a[0] - A.a[0]) * (C.b[1] - C.a[1]) - (C.a[1] - A.a[1]) * (C.b[0] - C.a[0])) / d, t = ((C.a[0] - A.a[0]) * (A.b[1] - A.a[1]) - (C.a[1] - A.a[1]) * (A.b[0] - A.a[0])) / d;
      if (s > 1e-9 && s < 1 - 1e-9 && t > 1e-9 && t < 1 - 1e-9) ys.add(A.a[1] + s * (A.b[1] - A.a[1]));
    }
  }
  const Y = [...ys].sort((p, q) => p - q).filter((y, i, a) => i === 0 || y - a[i - 1] > 1e-7);
  const isGrid = (y) => Math.abs((y - gy0) / res - Math.round((y - gy0) / res)) < 1e-6;
  // ── each strip's trapezoids: between consecutive separators where material is ──
  slanted.sort((p, q) => p.y0 - q.y0);
  const strips = [];
  let act = [], ei = 0;
  for (let k = 0; k + 1 < Y.length; k++) {
    const ya = Y[k], yb = Y[k + 1], ym = (ya + yb) / 2;
    while (ei < slanted.length && slanted[ei].y0 <= ym) act.push(slanted[ei++]);
    act = act.filter((e) => e.y1 > ym);
    const here = act.filter((e) => e.y0 < ym).map((e) => ({ e, xm: xAt(e, ym) })).sort((p, q) => p.xm - q.xm);
    const traps = [];
    let w = 0, left = null;
    for (const { e } of here) {
      if (e.w) {
        const before = w; w += e.w;
        if (before <= 0 && w > 0) left = { e, wall: true };
        else if (before > 0 && w <= 0 && left) { traps.push([left, { e, wall: true }]); left = null; }
      } else if (w > 0 && left) { traps.push([left, { e, wall: false }]); left = { e, wall: false }; }
    }
    strips.push({ ya, yb, traps: traps.map(([L, R]) => ({ L, R, xla: xAt(L.e, ya), xlb: xAt(L.e, yb), xra: xAt(R.e, ya), xrb: xAt(R.e, yb) })) });
  }
  // ── each line's vertices: every trapezoid corner on it, and the grid's columns on a grid row ──
  const lineX = Y.map(() => []);
  strips.forEach((s, k) => { for (const t of s.traps) { lineX[k].push(t.xla, t.xra); lineX[k + 1].push(t.xlb, t.xrb); } });
  const covered = (k) => { const iv = []; if (k > 0) for (const t of strips[k - 1].traps) iv.push([t.xlb, t.xrb]); if (k < strips.length) for (const t of strips[k].traps) iv.push([t.xla, t.xra]); return iv; };
  // every line gets the grid's columns, not only the grid rows: a line through an outline corner with
  // its two ends alone zipped into long slivers edge to edge, and the top was sampled only at the outline
  // (an STL of a drawn part came out flat, its texture missing)
  for (let k = 0; k < Y.length; k++) {
    for (const [a, b] of covered(k)) for (let x = Math.ceil((a - gx0) / res) * res + gx0; x < b; x += res) if (x > a) lineX[k].push(x);
    lineX[k] = lineX[k].sort((p, q) => p - q).filter((x, i, a) => i === 0 || x - a[i - 1] > 1e-7);
  }
  // ── vertices: one top and one bottom per point ──
  const pos = [], kind = [], idx = [], vmap = new Map(), floor = Math.min(0.2, T * 0.02);
  const snapX = (k, x) => { const L = lineX[k]; let lo = 0, hi = L.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (L[m] < x - 1e-7) lo = m + 1; else hi = m; } return L[lo]; };
  const vert = (k, x, top) => {
    x = snapX(k, x);
    const key = `${k}:${x.toFixed(7)}:${top ? 1 : 0}`;
    let v = vmap.get(key);
    if (v === undefined) { v = pos.length / 3; vmap.set(key, v); pos.push(x, Y[k], top ? Math.max(floor, T - depthAt(x, Y[k])) : 0); }
    return v;
  };
  const tri = (a, b, c, kd) => { idx.push(a, b, c); kind.push(kd); };
  const chain = (k, a, b) => lineX[k].filter((x) => x >= a - 1e-7 && x <= b + 1e-7);
  strips.forEach((s, k) => {
    for (const t of s.traps) {
      // the top and the bottom: zip the two chains, left to right
      const A = chain(k, t.xla, t.xra), Bc = chain(k + 1, t.xlb, t.xrb);
      for (const top of [true, false]) {
        let i = 0, j = 0;
        while (i < A.length - 1 || j < Bc.length - 1) {
          const ia = vert(k, A[i], top), jb = vert(k + 1, Bc[j], top);
          const fa = i < A.length - 1 ? (A[i + 1] - t.xla) / Math.max(1e-9, t.xra - t.xla) : Infinity;
          const fb = j < Bc.length - 1 ? (Bc[j + 1] - t.xlb) / Math.max(1e-9, t.xrb - t.xlb) : Infinity;
          if (fa <= fb) {
            const na = vert(k, A[i + 1], top);
            top ? tri(ia, na, jb, 0) : tri(ia, jb, na, 2); i++;
          } else {
            const nb = vert(k + 1, Bc[j + 1], top);
            top ? tri(ia, nb, jb, 0) : tri(ia, jb, nb, 2); j++;
          }
        }
      }
      // the sides that are the outline: walls, outward
      const wall = (pk, px, qk, qx) => { const pb = vert(pk, px, false), qb = vert(qk, qx, false), qt = vert(qk, qx, true), pt = vert(pk, px, true); tri(pb, qb, qt, 1); tri(pb, qt, pt, 1); };
      if (t.L.wall) wall(k + 1, t.xlb, k, t.xla);
      if (t.R.wall) wall(k, t.xra, k + 1, t.xrb);
    }
  });
  // ── walls along each line where material is on one side only ──
  for (let k = 0; k < Y.length; k++) {
    const below = k > 0 ? strips[k - 1].traps.map((t) => [t.xlb, t.xrb]) : [], above = k < strips.length ? strips[k].traps.map((t) => [t.xla, t.xra]) : [];
    const inside = (iv, x) => iv.some(([a, b]) => x > a + 1e-7 && x < b - 1e-7);
    const L = lineX[k];
    for (let i = 0; i + 1 < L.length; i++) {
      const xm = (L[i] + L[i + 1]) / 2, b = inside(below, xm), a = inside(above, xm);
      if (b === a) continue;
      const p = b ? L[i + 1] : L[i], q = b ? L[i] : L[i + 1];
      const pb = vert(k, p, false), qb = vert(k, q, false), qt = vert(k, q, true), pt = vert(k, p, true);
      tri(pb, qb, qt, 1); tri(pb, qt, pt, 1);
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), kinds: Uint8Array.from(kind), res, triangles: idx.length / 3 };
}
// smooth normals on the top (area-weighted over its triangles), flat on the walls and the bottom
export function meshNormals(mesh) {
  const P = mesh.positions, I = mesh.indices, K = mesh.kinds, vn = new Float32Array(P.length), fn = new Float32Array(I.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    fn[t] = nx / l; fn[t + 1] = ny / l; fn[t + 2] = nz / l;
    if (!K || K[t / 3] === 0) for (const v of [a, b, c]) { vn[v] += nx; vn[v + 1] += ny; vn[v + 2] += nz; }
  }
  for (let v = 0; v < vn.length; v += 3) { const l = Math.hypot(vn[v], vn[v + 1], vn[v + 2]) || 1; vn[v] /= l; vn[v + 1] /= l; vn[v + 2] /= l; }
  return { vertex: vn, face: fn };
}
// every edge in exactly two triangles, once each way; the enclosed volume
export function meshCheck(mesh) {
  const P = mesh.positions, I = mesh.indices, E = new Map();
  let bad = 0, vol = 0;
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t], I[t + 1], I[t + 2]];
    for (let e = 0; e < 3; e++) { const a = v[e], c = v[(e + 1) % 3], k = a < c ? `${a},${c}` : `${c},${a}`, s = a < c ? 1 : -1, r = E.get(k) || [0, 0]; r[0]++; r[1] += s; E.set(k, r); }
    const [ax, ay, az] = [P[v[0] * 3], P[v[0] * 3 + 1], P[v[0] * 3 + 2]], [bx, by, bz] = [P[v[1] * 3], P[v[1] * 3 + 1], P[v[1] * 3 + 2]], [cx, cy, cz] = [P[v[2] * 3], P[v[2] * 3 + 1], P[v[2] * 3 + 2]];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  for (const r of E.values()) if (r[0] !== 2 || r[1] !== 0) bad++;
  return { watertight: bad === 0, badEdges: bad, edges: E.size, volume: vol, triangles: I.length / 3 };
}
// a binary STL (mm)
export function meshSTL(mesh, name = 'swarf') {
  const P = mesh.positions, I = mesh.indices, n = I.length / 3, buf = new ArrayBuffer(84 + 50 * n), dv = new DataView(buf);
  const head = `${name} (mm)`.slice(0, 79);
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i) & 127);
  dv.setUint32(80, n, true);
  for (let t = 0, o = 84; t < n; t++, o += 50) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    for (let k = 0; k < 3; k++) { const q = I[t * 3 + k] * 3; dv.setFloat32(o + 12 + k * 12, P[q], true); dv.setFloat32(o + 16 + k * 12, P[q + 1], true); dv.setFloat32(o + 20 + k * 12, P[q + 2], true); }
    dv.setUint16(o + 48, 0, true);
  }
  return buf;
}
// a Wavefront OBJ (mm; z up, as swarf's other OBJ exports), with normals: smooth across the top so
// it renders soft, one per face on the walls and the bottom so their edges stay hard
export function meshOBJ(mesh, name = 'swarf') {
  const P = mesh.positions, I = mesh.indices, K = mesh.kinds, N = meshNormals(mesh), out = [`# ${name}, mm, z up`, `o ${name.replace(/\s+/g, '_')}`];
  const nv = P.length / 3;
  for (let i = 0; i < P.length; i += 3) out.push(`v ${+P[i].toFixed(4)} ${+P[i + 1].toFixed(4)} ${+P[i + 2].toFixed(4)}`);
  for (let i = 0; i < P.length; i += 3) out.push(`vn ${+N.vertex[i].toFixed(5)} ${+N.vertex[i + 1].toFixed(5)} ${+N.vertex[i + 2].toFixed(5)}`);
  let extra = 0;
  const faces = [];
  for (let t = 0; t < I.length; t += 3) {
    if (!K || K[t / 3] === 0) { faces.push(`f ${I[t] + 1}//${I[t] + 1} ${I[t + 1] + 1}//${I[t + 1] + 1} ${I[t + 2] + 1}//${I[t + 2] + 1}`); continue; }
    out.push(`vn ${+N.face[t].toFixed(5)} ${+N.face[t + 1].toFixed(5)} ${+N.face[t + 2].toFixed(5)}`);
    const n = nv + (++extra);
    faces.push(`f ${I[t] + 1}//${n} ${I[t + 1] + 1}//${n} ${I[t + 2] + 1}//${n}`);
  }
  return out.concat(faces).join('\n') + '\n';
}
// a binary glTF (GLB): one mesh, positions and normals, smooth top and hard walls. glTF is in
// meters with y up: x stays, the part's z (up) is y, its y is -z; 1 mm = 0.001
export function meshGLB(mesh, name = 'swarf') {
  const P = mesh.positions, I = mesh.indices, K = mesh.kinds, N = meshNormals(mesh);
  const pos = [], nrm = [], idx = [];
  const put = (x, y, z, nx, ny, nz) => { pos.push(x * 0.001, z * 0.001, -y * 0.001); nrm.push(nx, nz, -ny); return pos.length / 3 - 1; };
  // the top's vertices once each, smooth; a wall's or the bottom's own corners, flat
  const topV = new Int32Array(P.length / 3).fill(-1);
  for (let t = 0; t < I.length; t += 3) {
    if (!K || K[t / 3] === 0) {
      for (let e = 0; e < 3; e++) { const v = I[t + e]; if (topV[v] < 0) topV[v] = put(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], N.vertex[v * 3], N.vertex[v * 3 + 1], N.vertex[v * 3 + 2]); idx.push(topV[v]); }
    } else for (let e = 0; e < 3; e++) { const v = I[t + e]; idx.push(put(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], N.face[t], N.face[t + 1], N.face[t + 2])); }
  }
  const F = Float32Array.from(pos), Nn = Float32Array.from(nrm), U = Uint32Array.from(idx);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < F.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], F[i + k]); max[k] = Math.max(max[k], F[i + k]); }
  const bin = new Uint8Array(F.byteLength + Nn.byteLength + U.byteLength);
  bin.set(new Uint8Array(F.buffer), 0); bin.set(new Uint8Array(Nn.buffer), F.byteLength); bin.set(new Uint8Array(U.buffer), F.byteLength + Nn.byteLength);
  const json = {
    asset: { version: '2.0', generator: 'swarf tex' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, mode: 4 }] }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: F.byteLength, target: 34962 }, { buffer: 0, byteOffset: F.byteLength, byteLength: Nn.byteLength, target: 34962 }, { buffer: 0, byteOffset: F.byteLength + Nn.byteLength, byteLength: U.byteLength, target: 34963 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: F.length / 3, type: 'VEC3', min, max }, { bufferView: 1, componentType: 5126, count: Nn.length / 3, type: 'VEC3' }, { bufferView: 2, componentType: 5125, count: U.length, type: 'SCALAR' }],
  };
  let js = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - js.length % 4) % 4, bpad = (4 - bin.length % 4) % 4;
  const total = 12 + 8 + js.length + jpad + 8 + bin.length + bpad, buf = new ArrayBuffer(total), dv = new DataView(buf), u8 = new Uint8Array(buf);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, js.length + jpad, true); dv.setUint32(16, 0x4e4f534a, true); u8.set(js, 20); for (let i = 0; i < jpad; i++) u8[20 + js.length + i] = 0x20;
  const b0 = 20 + js.length + jpad;
  dv.setUint32(b0, bin.length + bpad, true); dv.setUint32(b0 + 4, 0x004e4942, true); u8.set(bin, b0 + 8);
  return buf;
}
// the part as a mesh with its marks (as designed or as cut), written as STL, OBJ or GLB
export function meshFile({ loops, thickness, marks, res, cut, format, name }) {
  const M = partMesh({ loops, thickness, marks, res, cut }), check = meshCheck(M);
  if (format === 'obj') return { text: meshOBJ(M, name), triangles: M.triangles, check };
  if (format === 'glb') return { buf: meshGLB(M, name), glb: true, triangles: M.triangles, check };
  return { buf: meshSTL(M, name), triangles: M.triangles, check };
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
export const SWATCH_SPAN = { dots: 40, dashdot: 52, morse: 60, ribs: 44, knurl: 30, noise: 90, reaction: 60, blob: 60, waves: 90, stone: 70, weave: 44, motif: 50, memphis: 70, quilt: 80 };
export function swatch(id, N, colors, params) {
  const span = SWATCH_SPAN[id] || 50, res = span / N;
  const tex = texture({ pattern: id, params, transform: { ox: 0, oy: 0 } });
  const H = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[j * N + i] = tex.base.h(i * res, (N - 1 - j) * res);
  return shadeHeight(H, N, N, res, colors, null, tex.depth);
}

const API = {
  hash3, perlin2, fbm2, worley2, cap, stepRepeat, blend, RD_STYLES, MORSE, morseEncode, strokeField, WEAVE_DRAFTS, MOTIFS, PATTERNS, defaults,
  rectMask, ellipseMask, polygonMask, paintMask, unionMask, makeMask, maskWeight, texture, TOOLS, makeTool, toolOffsets, dropCutter,
  heightGrid, stepoverForScallop, rasterPath, plungeDots, centerlinePath, toolpath, estimateTime, formatTime, analyze, createSim,
  simulate, compare, IDENTITY, encodeRuns, decodeRuns, newGrid, paintWhere, stampDisc, stampStroke, gridCount,
  regionSpec, storeRegion, xfApply, xfInvert, xfThen, xfScale, placeTexture, newFill, suggestBit, FINISHES, FINISH_WORDS, markTexture, pathFor, markToolpath, feedRuns,
  markChecks, markReport, BASIC, shadeHeight, SWATCH_SPAN, swatch,
  clipToPart, edgeDistance, insideReach, controlsFor, splineAt, sampleCurve, paintLoops, fitCurves, curvesCross, rewriteFromCurves, nearestOnCurves,
  partMesh, partMeshSize, autoMeshRes, meshCheck, meshNormals, meshSTL, meshOBJ, meshGLB, meshFile,
  RECIPE_FORMAT, RECIPE_VERSION, RECIPE_CORE, PATTERN_VERSIONS, recipeOf, fillOfRecipe, textureOfRecipe, recipeRefusal, checkOf, verifyRecipe,
  typedRange, CURVES, CURVE_WORDS, BORDERS, BORDER_WORDS, borderDefaults, isoLines, alongLines, fillShape,
  roundProse, PIERCES, SKIN_STRAIN, defaultSkin, kerfCount, pierceDefaults, newPierce, fillTool, kerfPitch, pierceCuts, pierceToolpath, pierceChecks, pierceSVG,
};
if (typeof window !== 'undefined') window.SwarfTexCore = API;
export default API;
