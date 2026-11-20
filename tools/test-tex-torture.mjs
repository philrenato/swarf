// TEX torture: random marks on random parts, every pattern (and its select choices) x every bit
// TEX offers and a few odd ones, every path, odd step-downs and boards; V-carves of random outlines
// (drawn and painted, on and off the part); inlay pockets and their plugs; pierce kerfs and holes.
// Every case, as many of these as apply:
//   terminates in bounded time; every move finite; the same input makes the same moves
//   never below the mark's depth, nor the board's (a V-carve keeps its skin, a pocket its depth)
//   no rapid below the top of the board
//   the cut (the core's material sim) stays in the mark: nothing cut on the part away from the paint
//   a raster never cuts below the design (no gouge), measured against the design near each cell
//   with a step-down, no move goes deeper than a step below the wood the moves before it left
//   a V-carve's cone never crosses the outline or the part's edge; a pocket's bit never the wall
//   the plug fits the pocket its bit cuts, its gap all round
//   node tools/test-tex-torture.mjs [cases=400] [seed=1]
import * as T from '../web/kiri/swarf-tex-core.mjs';
import { writeFileSync } from 'node:fs';
// DUMP=file.json writes each case's input there before it runs (the last one is the one that hung)
const dump = (o) => { if (process.env.DUMP) writeFileSync(process.env.DUMP, JSON.stringify(o)); };

const N = +(process.argv[2] || 400), SEED = +(process.argv[3] || 1);
const t0 = Date.now();
let pass = 0, fail = 0, cases = 0;
const fails = [];
const ok = (c, msg) => { if (c) pass++; else { fail++; fails.push(msg); console.log('FAIL', msg); } return c; };

// a seeded generator, so a failure names a case that runs again
let rs = SEED >>> 0 || 1;
const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + (b - a) * rnd();

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const turn = (L, a, cx, cy) => L.map(([x, y]) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]);
const segD = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l)) : 0; return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy); };
const edgeD = (loops, x, y) => { let d = Infinity; for (const L of loops) for (let i = 0; i < L.length; i++) d = Math.min(d, segD(x, y, L[i], L[(i + 1) % L.length])); return d; };
const inLoops = (loops, x, y) => { let c = false; for (const L of loops) for (let i = 0, j = L.length - 1; i < L.length; j = i++) { const [xi, yi] = L[i], [xj, yj] = L[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };

// parts: a board at the corner, one off the origin, a turned one, an L, a plate with a hole, a tiny one
function randomPart() {
  const k = pick(['rect', 'off', 'turned', 'L', 'hole', 'tiny', 'thin']);
  const w = between(20, 90), h = between(20, 70);
  if (k === 'rect') return { k, loops: [rect(0, 0, w, h)] };
  if (k === 'off') return { k, loops: [rect(300, 200, 300 + w, 200 + h)] };
  if (k === 'turned') return { k, loops: [turn(rect(0, 0, w, h), between(0.1, 1.4), w / 2, h / 2)] };
  if (k === 'L') return { k, loops: [[[0, 0], [w, 0], [w, h / 3], [w / 3, h / 3], [w / 3, h], [0, h]]] };
  if (k === 'hole') return { k, loops: [rect(0, 0, w, h), rect(w / 3, h / 3, 2 * w / 3, 2 * h / 3).reverse()] };
  if (k === 'tiny') return { k, loops: [rect(0, 0, between(1, 6), between(1, 6))] };
  return { k, loops: [rect(0, 0, w, between(0.5, 3))] };
}
const boxOf = (loops) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const L of loops) for (const [x, y] of L) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [x0, y0, x1, y1]; };

// the mark's frame: the identity, a turn, a scale, a mirror (a part turned or scaled after it was marked)
function randomXf(cx, cy) {
  const k = pick(['id', 'id', 'turn', 'scale', 'mirror']);
  if (k === 'id') return T.IDENTITY.slice();
  const a = k === 'turn' ? between(0, 6.28) : 0, s = k === 'scale' ? between(0.5, 2) : 1, m = k === 'mirror' ? -1 : 1;
  const A = [s * Math.cos(a) * m, -s * Math.sin(a), s * Math.sin(a) * m, s * Math.cos(a), 0, 0];
  // keep the mark's middle where it was
  const p = T.xfApply(A, cx, cy); A[4] = cx - p[0]; A[5] = cy - p[1];
  return A;
}
// paint in the mark's frame over the part's box (and past it): a rectangle, a disc, strokes, all, a
// speck smaller than any bit, one wholly off the part, overlapping blobs, a stripe on the edge
function randomPaint(box) {
  const [x0, y0, x1, y1] = box, w = x1 - x0, h = y1 - y0, res = pick([0.25, 0.5, 0.5, 1]);
  const g = T.newGrid(x0 - 15, y0 - 15, x1 + 15, y1 + 15, res);
  const k = pick(['all', 'rect', 'disc', 'strokes', 'speck', 'off', 'blobs', 'edge']);
  if (k === 'all') T.paintWhere(g, () => true, 1);
  else if (k === 'rect') { const a = [between(x0 - 5, x1), between(y0 - 5, y1)]; T.paintWhere(g, (x, y) => x >= a[0] && y >= a[1] && x <= a[0] + between(1, w) && y <= a[1] + between(1, h), 1); }
  else if (k === 'disc') T.stampDisc(g, between(x0, x1), between(y0, y1), between(0.3, Math.max(w, h) / 2), 1);
  else if (k === 'strokes') for (let i = 0; i < 4; i++) T.stampStroke(g, between(x0, x1), between(y0, y1), between(x0, x1), between(y0, y1), between(0.3, 6), 1);
  else if (k === 'speck') T.stampDisc(g, between(x0, x1), between(y0, y1), 0.3, 1);
  else if (k === 'off') T.paintWhere(g, (x, y) => x < x0 - 3, 1);
  else if (k === 'blobs') for (let i = 0; i < 6; i++) T.stampDisc(g, between(x0, x1), between(y0, y1), between(2, 12), 1);
  else T.paintWhere(g, (x, y) => x >= x0 - 2 && x <= x0 + between(0.5, 6), 1);
  return { k, g };
}

// the bits TEX offers, a library bit's full spec, and odd ones (tiny, a sharp 30° V, a blunt 150°)
const BITS = [...Object.keys(T.TOOLS).map((id) => ({ tool: id })),
  { bit: { id: 'tiny', name: '0.5 mm ball', type: 'ball', diameter: 0.5 } },
  { bit: { id: 'v30', name: '30° V', type: 'v', angle: 30, diameter: 6.35 } },
  { bit: { id: 'v150', name: '150° V', type: 'v', angle: 150, diameter: 25 } },
  { bit: { id: 'big', name: '1/2 in flat', type: 'flat', diameter: 12.7 } },
  { bit: { id: 'bad', name: 'a saved 0° V', type: 'v', angle: 0, diameter: 6 } }];
const VARIANTS = [];
for (const [id, P] of Object.entries(T.PATTERNS)) {
  VARIANTS.push({ id, over: {} });
  for (const q of P.params) if (q.type === 'select' && q.k !== 'layout') for (const v of q.options) if (v !== q.def) VARIANTS.push({ id, over: { [q.k]: v } });
}
const STEPS = [0, 0, 0.3, 1, 3, 25, -1, NaN, 0.02];
const BOARDS = [19.05, 12, 6, 3, 1, 0.5];

// a sim grid over the moves' reach
function simOf(moves, tool, box, res) {
  const pad = tool.R + 2 * res, x0 = box[0] - pad, y0 = box[1] - pad;
  const g = { x0, y0, res, nx: Math.ceil((box[2] - box[0] + 2 * pad) / res) + 1, ny: Math.ceil((box[3] - box[1] + 2 * pad) / res) + 1 };
  return g;
}
const cellsCap = (g) => g.nx * g.ny <= 2.5e6;

// with a step-down: each move's end, before the move runs, is no more than a step below the wood
function stepDownCheck(moves, tool, g, sd, name, side = 0) {
  if (!(sd > 0) || !cellsCap(g)) return true;
  const s = T.createSim(g, tool);
  let worst = 0, at = null;
  for (let m = 0; m < moves.length; m++) {
    const b = moves[m];
    if (!b.rapid && b.z < -1e-6) {
      const i = Math.round((b.x - g.x0) / g.res), j = Math.round((b.y - g.y0) / g.res);
      // the wood's top there: the deepest of the cell and its neighbors (a sharp V's tip falls between
      // the sim's cells)
      let top = Infinity;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, c = j + dj; if (a >= 0 && c >= 0 && a < g.nx && c < g.ny) top = Math.min(top, s.Z[c * g.nx + a]); }
      if (i >= 0 && j >= 0 && i < g.nx && j < g.ny) { const over = top - b.z; if (over > worst) { worst = over; at = { m, x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(3), top: +top.toFixed(3) }; } }
    }
    s.run(moves, m, m + 1);
  }
  const good = worst <= Math.max(sd, side) + 0.06 + g.res * (tool.type === "v" ? 0.71 / tool.tanHalf : 0.1);
  if (!good && process.env.SHOW) moves.slice(Math.max(0, at.m - 8), at.m + 3).forEach((q, i) => console.log('   ', at.m - 8 + i, q.rapid ? 'rapid' : 'feed', q.x.toFixed(3), q.y.toFixed(3), q.z.toFixed(3)));
  return ok(good, `${name}: no move more than the ${sd} mm step-down below the wood (worst ${worst.toFixed(3)} ${JSON.stringify(at)})`);
}

function basicChecks(name, moves, floor, ms) {
  ok(ms < 20000, `${name}: made in ${ms} ms`);
  ok(moves.every((m) => Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.z)), `${name}: every move finite`);
  let lo = 0; for (const m of moves) if (m.z < lo) lo = m.z;
  ok(lo >= -floor - 1e-6, `${name}: never below ${floor.toFixed(3)} (lowest ${lo.toFixed(3)})`);
  let prev = null, bad = null;
  for (const m of moves) { if (m.rapid && (m.z < -1e-9 || (prev && prev.z < -1e-9 && Math.hypot(m.x - prev.x, m.y - prev.y) > 1e-6))) { bad = m; break; } prev = m; }
  ok(!bad, `${name}: no rapid below the top ${bad ? JSON.stringify(bad) : ''}`);
  return lo;
}
const same = (a, b) => a.length === b.length && a.every((m, i) => m.x === b[i].x && m.y === b[i].y && m.z === b[i].z && m.rapid === b[i].rapid);

// ---- textures ----------------------------------------------------------------------------------
function textureCase(n) {
  const part = randomPart(), pb = boxOf(part.loops);
  const cx = (pb[0] + pb[2]) / 2, cy = (pb[1] + pb[3]) / 2;
  const paint = randomPaint(pb), xf = randomXf(cx, cy);
  const v = pick(VARIANTS), b = pick(BITS), sd = pick(STEPS), thick = pick(BOARDS);
  const params = { ...T.defaults(v.id), ...v.over };
  const path = pick(['auto', 'auto', 'auto', 'raster', 'crosshatch', 'plunge', 'centerline']);
  const fill = T.newFill(v.id, { origin: [cx, cy], params, depth: params.depth, path, scale: pick([1, 1, 0.3, 2.5]), angle: pick([0, 0, 33, 90]), fade: pick([3, 0, 0, 8]), finish: pick(['standard', 'standard', 'bold', 'fine']), ...b });
  if (rnd() < 0.15) fill.border = { style: pick(['step', 'rim', 'beads', 'chamfer']), width: between(1, 8), depth: between(0.5, 3) };
  if (rnd() < 0.1) fill.relief = 'up';
  if (rnd() < 0.1) fill.floor = between(0.2, 2);
  if (rnd() < 0.08) fill.depth = pick([0, -1, 40]);
  const mark = { id: 'm' + n, region: T.storeRegion(paint.g), xf, fill };
  const name = `tex#${n} ${v.id}${Object.keys(v.over).length ? ' ' + JSON.stringify(v.over) : ''} ${b.tool || b.bit.id} ${path} on ${part.k} paint ${paint.k} sd ${sd} board ${thick}`;
  if (process.env.ONLY && +process.env.ONLY !== n) return;
  if (process.env.TRACE) console.log(name);
  dump({ name, mark, part: part.loops, thick, sd });
  const st = Date.now();
  let r;
  try { r = T.markToolpath(mark, { maxDepth: thick, stepDown: sd, part: part.loops, res: 0.4 }); }
  catch (e) { ok(false, `${name}: threw ${e.message}`); return; }
  const ms = Date.now() - st;
  const moves = r.moves || [];
  if (!r.tex) { ok(moves.length === 0, `${name}: no texture, no moves`); return; }
  const floor = Math.max(0, Math.min(r.tex.depth, thick));
  basicChecks(name, moves, floor, ms);
  if (!moves.length) return;
  const again = T.markToolpath(mark, { maxDepth: thick, stepDown: sd, part: part.loops, res: 0.4 }).moves;
  ok(same(moves, again), `${name}: the same input makes the same moves`);
  const tool = r.tool;
  // the cut, simulated
  let mb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const m of moves) if (!m.rapid) { mb[0] = Math.min(mb[0], m.x); mb[1] = Math.min(mb[1], m.y); mb[2] = Math.max(mb[2], m.x); mb[3] = Math.max(mb[3], m.y); }
  if (!Number.isFinite(mb[0])) return;
  const g = simOf(moves, tool, mb, 0.4);
  if (!cellsCap(g)) return;
  const Z = T.simulate(moves, g, tool);
  // the paint in the mark's frame: a cell of the part counts as the mark's when paint lies within reach
  const I = T.xfInvert(xf), s = T.xfScale(xf), P = paint.g;
  // (two cells of the cutting grid as well: a hard wall may stand a node farther out, see below)
  const near = Math.ceil((0.75 + 2 * r.res / s) / P.res) + 1;
  const paintNear = (x, y) => {
    const [u, w] = T.xfApply(I, x, y), i0 = Math.floor((u - P.x0) / P.res), j0 = Math.floor((w - P.y0) / P.res);
    for (let j = j0 - near; j <= j0 + near; j++) for (let i = i0 - near; i <= i0 + near; i++) if (i >= 0 && j >= 0 && i < P.nx && j < P.ny && P.data[j * P.nx + i]) return true;
    return false;
  };
  // a centerline groove is its width wide about a centre that runs to the paint's edge, and past the
  // part's edge into the air the bit reaches over: its flank may come back onto the part up to the
  // bit's radius (reported, left as it is); anything else stays on the paint
  const spill = r.strategy === 'centerline' ? Math.max((r.tex.strokeWidth || 0) / 2, tool.R) + 0.2 : 0;
  // how far a cut may dip past a wall the cutting grid holds a cell out: a V's flank over half a cell,
  // a ball's side over two
  const slack = 0.1 + (tool.type === 'v' ? 0.5 * r.res / tool.tanHalf : tool.type === 'ball' ? tool.R - Math.sqrt(Math.max(0, tool.R * tool.R - 4 * r.res * r.res)) : 0);
  let stray = null, gouge = null;
  for (let j = 0; j < g.ny && !stray; j += 1) for (let i = 0; i < g.nx; i++) {
    const z = Z[j * g.nx + i]; if (z > -slack) continue;
    const x = g.x0 + i * g.res, y = g.y0 + j * g.res;
    // on the part, more than a little in from its edge (the bit's flank may hang past an edge)
    if (!inLoops(part.loops, x, y) || edgeD(part.loops, x, y) < 0.5) continue;
    if (paintNear(x, y)) continue;
    if (spill > 0) { let close = false; for (let a = 0; a < 8 && !close; a++) close = paintNear(x + spill * Math.cos(a * Math.PI / 4), y + spill * Math.sin(a * Math.PI / 4)); if (close) continue; }
    stray = { x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(3) }; break;
  }
  ok(!stray, `${name}: the cut stays in the mark (cut on the part away from the paint at ${JSON.stringify(stray)})`);
  // a raster (TEX's own choice) never cuts below the design, near each cell
  // (a ball smaller than the grid's cell falls between its nodes: reported, left; not checked here)
  if ((r.strategy === 'raster' || r.strategy === 'crosshatch') && !(tool.type === 'ball' && tool.R < r.res)) {
    // the cutting grid (r.res) is bilinear between its nodes: a hard wall (no soft edge, a pocketed
    // shape) may stand up to a node farther out, so the design counts within two of its cells
    const h = r.tex.h, e = r.res;
    for (let j = 0; j < g.ny && !gouge; j++) for (let i = 0; i < g.nx; i++) {
      const z = Z[j * g.nx + i]; if (z > -0.05) continue;
      const x = g.x0 + i * g.res, y = g.y0 + j * g.res;
      // off the part is air: the bit hangs past the edge there on purpose
      if (!inLoops(part.loops, x, y) || edgeD(part.loops, x, y) < 0.5) continue;
      let hm = 0; for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) if (a * a + c * c <= 4) hm = Math.max(hm, h(x + a * e, y + c * e));
      if (z < -Math.min(hm, thick) - slack) { gouge = { x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(3), design: +hm.toFixed(3) }; break; }
    }
    ok(!gouge, `${name}: the raster never cuts below the design ${JSON.stringify(gouge)}`);
  }
  stepDownCheck(moves, tool, g, sd, name);
}

// ---- V-carve -----------------------------------------------------------------------------------
function star(cx, cy, R, r, n) { const p = []; for (let i = 0; i < 2 * n; i++) { const a = i * Math.PI / n; const k = i % 2 ? r : R; p.push([cx + k * Math.cos(a), cy + k * Math.sin(a)]); } return p; }
function randomOutline(box) {
  const [x0, y0, x1, y1] = box, w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const k = pick(['bar', 'thin', 'star', 'letterO', 'speck', 'off', 'spike', 'two', 'big']);
  if (k === 'bar') return { k, loops: [rect(cx - between(2, 20), cy - between(1, 8), cx + between(2, 20), cy + between(1, 8))] };
  if (k === 'thin') return { k, loops: [rect(cx - 15, cy - 0.15, cx + 15, cy + 0.15)] };
  if (k === 'star') return { k, loops: [star(cx, cy, between(5, 25), between(1, 5), pick([3, 5, 8]))] };
  if (k === 'letterO') { const R = between(4, 15); return { k, loops: [star(cx, cy, R, R, 24), star(cx, cy, R * 0.5, R * 0.5, 24).reverse()] }; }
  if (k === 'speck') return { k, loops: [rect(cx, cy, cx + 0.3, cy + 0.3)] };
  if (k === 'off') return { k, loops: [rect(x0 - 12, cy - 5, x0 + 8, cy + 5)] };
  if (k === 'spike') return { k, loops: [[[cx - 10, cy], [cx + 20, cy + 0.2], [cx - 10, cy + 6]]] };
  if (k === 'two') return { k, loops: [rect(cx - 10, cy - 4, cx, cy + 4), rect(cx + 0.05, cy - 4, cx + 10, cy + 4)] };
  return { k, loops: [rect(x0 - 2, y0 - 2, x1 + 2, y1 + 2)] };
}
const VBITS = [{ tool: 'v90' }, { tool: 'v60' }, { bit: { id: 'v30', name: '30° V', type: 'v', angle: 30, diameter: 6.35 } }, { bit: { id: 'v150', name: '150° V', type: 'v', angle: 150, diameter: 25 } },
  { bit: { id: 'vsmall', name: 'small 60° V', type: 'v', angle: 60, diameter: 3, flute: 2 } }, { tool: 'flat18' }];
function vcarveCase(n) {
  const part = randomPart(), pb = boxOf(part.loops), out = randomOutline(pb);
  const b = pick(VBITS), thick = pick(BOARDS), sd = pick(STEPS), limit = pick([0, 0, 1, 3, -2]);
  const drawn = rnd() < 0.6;
  const { region, sig } = T.drawnRegion(out.loops, 0.25);
  const mark = { id: 'v' + n, region: T.storeRegion(region), xf: T.IDENTITY.slice(), fill: T.newVcarve({ limit, ...b }), ...(drawn ? { drawn: { loops: out.loops, sig } } : {}) };
  const usePart = rnd() < 0.8;
  const name = `vcarve#${n} ${out.k} ${drawn ? 'drawn' : 'painted'} ${b.tool || b.bit.id} on ${usePart ? part.k : 'no part'} board ${thick} sd ${sd} limit ${limit}`;
  dump({ name, mark, part: usePart ? part.loops : null, thick, sd });
  if (process.env.ONLY && +process.env.ONLY !== n) return;
  if (process.env.TRACE) console.log(name);
  const st = Date.now();
  let r;
  try { r = T.vcarveToolpath(mark, { maxDepth: thick, stepDown: sd, part: usePart ? part.loops : undefined, res: 0.3 }); }
  catch (e) { ok(false, `${name}: threw ${e.message}`); return; }
  const ms = Date.now() - st, moves = r.moves || [];
  if (!moves.length) { ok(ms < 20000, `${name}: made in ${ms} ms`); return; }
  const tool = r.tool, tan = tool.tanHalf;
  const floor = Math.min(tool.R / tan, tool.flute > 0 ? tool.flute : Infinity, limit > 0 ? limit : Infinity, Math.max(thick / 2, thick - T.VCARVE.skin));
  basicChecks(name, moves, floor, ms);
  // the cone at each cut point: inside the outline and the part, its rim never past either edge
  const cut = (x, y) => inLoops(out.loops, x, y) && (!usePart || inLoops(part.loops, x, y));
  const edges = usePart ? [...out.loops, ...part.loops] : out.loops;
  // painted outlines are the paint's edge, faired: a cell's give
  const tol = (drawn ? 0.08 : 0.4) + 0.05;
  let bad = null;
  for (const m of moves) {
    if (m.rapid || m.z > -0.02) continue;
    const rim = -m.z * tan;
    if (drawn ? !cut(m.x, m.y) && edgeD(edges, m.x, m.y) > tol : false) { bad = { m, why: 'outside' }; break; }
    const d = edgeD(drawn ? edges : usePart ? part.loops : [], m.x, m.y);
    if (drawn && rim > d + tol + Math.max(0.05, 0.02 * rim)) { bad = { x: +m.x.toFixed(2), y: +m.y.toFixed(2), z: +m.z.toFixed(3), rim: +rim.toFixed(3), edge: +d.toFixed(3) }; break; }
    if (!drawn && usePart && !inLoops(part.loops, m.x, m.y) && edgeD(part.loops, m.x, m.y) > tol) { bad = { m, why: 'off the part' }; break; }
  }
  ok(!bad, `${name}: the cone stays inside the outline and the part ${JSON.stringify(bad)}`);
  let mb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const m of moves) if (!m.rapid) { mb[0] = Math.min(mb[0], m.x); mb[1] = Math.min(mb[1], m.y); mb[2] = Math.max(mb[2], m.x); mb[3] = Math.max(mb[3], m.y); }
  // a V-carve's flat floor goes in rings at the held depth, each a stepover out from the last: its tip
  // takes that stepover's depth of new wood whatever the step-down (reported, left as it is)
  const ring = Math.max(0.05, mark.fill.stepover > 0 ? mark.fill.stepover : T.stepoverForScallop(tool, 0.15));
  stepDownCheck(moves, tool, simOf(moves, tool, mb, 0.15), sd, name, ring / tan);
}

// ---- inlay -------------------------------------------------------------------------------------
const IBITS = [{ tool: 'flat18' }, { tool: 'flat14' }, { bit: { id: 'f116', name: '1/16 in flat', type: 'flat', diameter: 1.5875 } }, { tool: 'ball18' }];
function inlayCase(n) {
  const part = randomPart(), pb = boxOf(part.loops), out = randomOutline(pb);
  const b = pick(IBITS), thick = pick(BOARDS), sd = pick(STEPS);
  const depth = pick([3, 1, 6, 0, -2, 25]), gap = pick([0.1, 0.1, 0, 0.3, -1]);
  const res = pick([0.1, 0.25]);
  const { region } = T.drawnRegion(out.loops, res);
  const mark = { id: 'i' + n, region: T.storeRegion(region), xf: T.IDENTITY.slice(), fill: T.newInlay({ depth, gap, ...b }) };
  const usePart = rnd() < 0.8, opt = { maxDepth: thick, stepDown: sd, part: usePart ? part.loops : undefined };
  const name = `inlay#${n} ${out.k} ${b.tool || b.bit.id} depth ${depth} gap ${gap} on ${usePart ? part.k : 'no part'} board ${thick} sd ${sd}`;
  dump({ name, mark, part: usePart ? part.loops : null, thick, sd });
  if (process.env.ONLY && +process.env.ONLY !== n) return;
  if (process.env.TRACE) console.log(name);
  const st = Date.now();
  let r;
  try { r = T.inlayToolpath(mark, opt); }
  catch (e) { ok(false, `${name}: threw ${e.message}`); return; }
  const ms = Date.now() - st, moves = r.moves || [];
  if (!moves.length) { ok(ms < 30000, `${name}: made in ${ms} ms`); return; }
  const want = Math.max(0.01, depth);
  basicChecks(name, moves, Math.min(want, thick), ms);
  // the bit's side never in wood that was not painted: round its rim, every point is the paint (a
  // cell's give, and the fairing of the paint's staircase) or off the part (air)
  const paintEdge = T.paintLoops(region), R = r.inlay.r, give = res + 0.15;
  let bad = null;
  for (const m of moves) {
    if (m.rapid || m.z > -1e-6) continue;
    for (let a = 0; a < 24 && !bad; a++) {
      const x = m.x + (R - give) * Math.cos(a * Math.PI / 12), y = m.y + (R - give) * Math.sin(a * Math.PI / 12);
      const wood = !usePart || inLoops(part.loops, x, y);
      if (wood && !inLoops(paintEdge, x, y)) bad = { at: [+m.x.toFixed(3), +m.y.toFixed(3)], rim: [+x.toFixed(3), +y.toFixed(3)], r: R, edge: +edgeD(paintEdge, x, y).toFixed(3) };
    }
    if (bad) break;
  }
  ok(!bad, `${name}: the bit never cuts wood that was not painted ${JSON.stringify(bad)}`);
  // the plug: its edge at least the gap inside the pocket its bit cuts (simulated)
  const plug = T.inlayPlug(mark, opt);
  // (a plug the card already says will not go in is said, not cut wrong: skipped here)
  const refused = plug && T.inlayChecks(mark, { thickness: thick, part: opt.part }).warnings.some((w) => /will not go in/.test(w));
  if (plug && !refused && r.inlay.box && r.tool.type === "flat" && plug.gap >= 0.05) {
    const tool = r.tool, h = 0.05, [x0, y0, x1, y1] = r.inlay.box;
    const g = { x0, y0, res: h, nx: Math.ceil((x1 - x0) / h) + 1, ny: Math.ceil((y1 - y0) / h) + 1 };
    if (g.nx * g.ny < 4e6) {
      const Z = T.simulate(moves, g, tool), floor = -Math.min(want, thick) + 0.02;
      const G = Math.max(0, plug.gap), reach = Math.max(0, G - 2 * h - 0.01), k = Math.ceil(reach / h);
      let worst = null;
      outer: for (const L of plug.loops) for (const [x, y] of L) {
        const i0 = Math.round((x - x0) / h), j0 = Math.round((y - y0) / h);
        for (let j = j0 - k; j <= j0 + k; j++) for (let i = i0 - k; i <= i0 + k; i++) {
          if (Math.hypot(i - i0, j - j0) * h > reach) continue;
          const z = i >= 0 && j >= 0 && i < g.nx && j < g.ny ? Z[j * g.nx + i] : 0;
          if (z > floor) { worst = { x: +x.toFixed(3), y: +y.toFixed(3), at: [+(x0 + i * h).toFixed(3), +(y0 + j * h).toFixed(3)], z: +z.toFixed(3), gap: G }; break outer; }
        }
      }
      ok(!worst, `${name}: the plug's edge sits its gap inside the pocket as cut ${JSON.stringify(worst)}`);
    }
  }
}

// ---- pierce ------------------------------------------------------------------------------------
function pierceCase(n) {
  const part = randomPart(), pb = boxOf(part.loops), paint = randomPaint(pb), thick = pick(BOARDS), sd = pick(STEPS);
  const pat = pick(['kerf', 'holes']);
  const over = pat === 'kerf' ? { radius: pick([25, 100, 600, 5]), skin: pick([0, 1, 2.5, 50]), bridge: pick([0, 5, 300]), slot: pick([80, 5, 2000]) } : { size: pick([3, 10, 40, 0.5]), spacing: pick([6, 18, 2]), layout: pick(['hex', 'grid']) };
  const fill = T.newPierce(pat, { angle: pick([0, 45, 90]), ...pick([{ tool: 'flat18' }, { tool: 'flat14' }, { bit: { id: 'f116', name: '1/16 in flat', type: 'flat', diameter: 1.5875 } }]) }, thick);
  fill.params = { ...fill.params, ...over };
  const mark = { id: 'p' + n, region: T.storeRegion(paint.g), xf: randomXf((pb[0] + pb[2]) / 2, (pb[1] + pb[3]) / 2), fill };
  const name = `pierce#${n} ${pat} ${JSON.stringify(over)} paint ${paint.k} on ${part.k} board ${thick} sd ${sd}`;
  if (process.env.ONLY && +process.env.ONLY !== n) return;
  if (process.env.TRACE) console.log(name);
  const st = Date.now();
  let r;
  try { r = T.markToolpath(mark, { maxDepth: thick, stepDown: sd, part: part.loops }); }
  catch (e) { ok(false, `${name}: threw ${e.message}`); return; }
  const ms = Date.now() - st, moves = r.moves || [];
  ok(ms < 20000, `${name}: made in ${ms} ms`);
  if (!moves.length) return;
  basicChecks(name, moves, thick, ms);
  // a through cut stays on the part (its paint carried a little past the edge, where it opens a notch)
  const w = r.tool.diameter, reach = (pat === 'holes' ? Math.max(...r.cuts.holes.map((q) => q.d / 2), w / 2) : w / 2) + 1.5;
  let off = null;
  for (const m of moves) if (!m.rapid && m.z < -0.05 && !inLoops(part.loops, m.x, m.y) && edgeD(part.loops, m.x, m.y) > reach) { off = m; break; }
  ok(!off, `${name}: the cuts stay on the part ${JSON.stringify(off)}`);
}

const kinds = [[textureCase, 0.55], [vcarveCase, 0.2], [inlayCase, 0.13], [pierceCase, 0.12]];
for (let n = 0; n < N; n++) {
  const u = rnd(); let acc = 0;
  if (process.env.TRACE) console.log("case", n);
  for (const [f, p] of kinds) { acc += p; if (u < acc) { f(n); break; } }
  cases++;
}
console.log(`\ntex torture: ${cases} cases, ${pass} checks passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s, seed ${SEED})`);
process.exit(fail ? 1 : 0);
