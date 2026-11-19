// TEX defaults, every one: each pattern (and each choice of its select fields: a style, a shape, a
// mix) as TEX first gives it (newFill: its default numbers, scale 100 %, its suggested bit), painted
// over a small (60 x 60 mm) and a medium (150 x 100 mm) part of 3/4 in plywood, must be
//   cuttable:  no warning from the core's own checks; a toolpath with moves, all finite, never below
//              the pattern's depth or the board, no rapid in the wood; under an hour on the medium part
//   seeable:   cut (the core's material sim) it leaves relief you can see: the cut surface varies by
//              where the design is deep the cut is 0.4 mm or more below where the design is the top,
//              and the cut follows the design (correlation 0.6 or more)
// Pierce's kerfs and holes, at their defaults, go through the core's pierce checks the same way.
//   node tools/test-tex-defaults.mjs [pattern]
import * as T from '../web/kiri/swarf-tex-core.mjs';

const ONLY = process.argv[2];
const THICK = 19.05;
let pass = 0, fail = 0;
const lines = [];
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } return c; };

const variants = [];
for (const [id, P] of Object.entries(T.PATTERNS)) {
  if (ONLY && id !== ONLY) continue;
  variants.push({ id, label: id, over: {} });
  for (const q of P.params) if (q.type === 'select' && q.k !== 'profile' && q.k !== 'layout') {
    for (const v of q.options) if (v !== q.def) variants.push({ id, label: `${id} ${q.k}=${v}`, over: { [q.k]: v } });
  }
}

function markOn(w, h, id, over) {
  const g = T.newGrid(0, 0, w, h, 0.5);
  T.paintWhere(g, () => true, 1);
  const params = { ...T.defaults(id), ...over };
  const fill = T.newFill(id, { origin: [w / 2, h / 2], params, depth: params.depth, tool: T.suggestBit(id, params) });
  return { region: T.storeRegion(g), xf: T.IDENTITY.slice(), fill };
}

function corr(a, b) {
  const n = a.length; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

for (const v of variants) {
  for (const [w, h, size] of [[60, 60, 'small'], [150, 100, 'medium']]) {
    const name = `${v.label} on ${size}`;
    const mark = markOn(w, h, v.id, v.over);
    const part = [[[0, 0], [w, 0], [w, h], [0, h]]];
    const chk = T.markChecks(mark, { thickness: THICK, part });
    ok(chk.tex, `${name}: makes a texture`);
    if (!chk.tex) continue;
    ok(chk.warnings.length === 0, `${name}: the default is cuttable with its own bit (${chk.tool.name}): ${chk.warnings.join(' | ')}`);
    const res = 0.4;
    const path = T.markToolpath(mark, { maxDepth: THICK, res, part });
    const mv = path.moves || [];
    ok(mv.length > 10, `${name}: a toolpath (${mv.length} moves)`);
    if (mv.length <= 10) continue;
    const finite = mv.every(m => Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.z));
    ok(finite, `${name}: every move finite`);
    const minZ = Math.min(...mv.map(m => m.z));
    ok(minZ >= -(path.tex.depth + 0.05) && minZ >= -THICK, `${name}: never below its depth ${path.tex.depth} (lowest ${minZ.toFixed(2)})`);
    let dive = null, prev = null;
    for (const m of mv) { if (m.rapid && prev && Math.min(m.z, prev.z) < -0.05 && Math.hypot(m.x - prev.x, m.y - prev.y) > 0.05) { dive = m; break; } prev = m; }
    ok(!dive, `${name}: no rapid sideways in the wood ${dive ? JSON.stringify(dive) : ''}`);
    const time = T.estimateTime(mv);
    if (size === 'medium') ok(time.seconds < 3600, `${name}: under an hour on 150 x 100 (${T.formatTime(time.seconds)})`);
    // cut it: the sim over the part, inset past the soft edge and the bit (what the eye reads)
    const tool = path.tool, inset = (mark.fill.fade || 0) + tool.R + 1;
    const g = { x0: 0, y0: 0, res: 0.5, nx: Math.round(w / 0.5) + 1, ny: Math.round(h / 0.5) + 1 };
    const Z = T.simulate(mv, g, tool);
    const cut = [], want = [];
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      const x = i * g.res, y = j * g.res;
      if (x < inset || y < inset || x > w - inset || y > h - inset) continue;
      cut.push(-Z[j * g.nx + i]); want.push(path.tex.h(x, y));
    }
    // what the eye reads: where the design is deep, the cut is deep; where it is the top, the top.
    // (a sparse pattern, a few grooves on a flat board, reads as well as a dense one)
    const D = path.tex.depth, med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
    const deep = cut.filter((c, k) => want[k] >= 0.7 * D), top = cut.filter((c, k) => want[k] <= 0.1 * D);
    const relief = med(deep) - (top.length ? med(top) : 0), r = corr(cut, want);
    ok(deep.length > 20, `${name}: the design's deep parts are on the part (${deep.length} cells)`);
    ok(relief >= 0.4, `${name}: relief you can see: the deep parts cut ${relief.toFixed(2)} mm below the rest (0.4 or more)`);
    ok(r >= 0.6, `${name}: the cut follows the design (correlation ${r.toFixed(2)})`);
    lines.push(`${name.padEnd(40)} ${chk.tool.name.padEnd(12)} ${path.strategy.padEnd(10)} depth ${String(path.tex.depth).padEnd(4)} relief ${relief.toFixed(2)}  corr ${r.toFixed(2)}  ${T.formatTime(time.seconds).padStart(8)}  feature ${path.tex.featureLabel || ''}`);
  }
}

// pierce at its defaults on a 200 x 120 part of 3/4 in plywood
if (!ONLY) for (const id of Object.keys(T.PIERCES)) {
  const g = T.newGrid(0, 0, 200, 120, 0.5);
  T.paintWhere(g, (x, y) => x > 20 && x < 180 && y > 20 && y < 100, 1);
  const mark = { region: T.storeRegion(g), xf: T.IDENTITY.slice(), fill: T.newPierce(id, { origin: [100, 60] }, THICK) };
  const chk = T.markChecks(mark, { thickness: THICK });
  ok(chk.warnings.length === 0, `pierce ${id}: default cuttable: ${chk.warnings.join(' | ')}`);
  const p = T.markToolpath(mark, { maxDepth: THICK, thickness: THICK, stepDown: 6 });
  const mv = p.moves || [];
  ok(mv.length > 10 && mv.every(m => Number.isFinite(m.z)), `pierce ${id}: a toolpath (${mv.length} moves)`);
  ok(Math.min(...mv.map(m => m.z)) >= -THICK - 1.01, `pierce ${id}: no deeper than the board and 1 mm`);
  let prev = null, dive = false;
  for (const m of mv) { if (m.rapid && prev && Math.min(m.z, prev.z) < -0.05 && Math.hypot(m.x - prev.x, m.y - prev.y) > 0.05) dive = true; prev = m; }
  ok(!dive, `pierce ${id}: no rapid sideways in the wood`);
  lines.push(`pierce ${id.padEnd(33)} ${String(mv.length).padStart(6)} moves  ${T.formatTime(T.estimateTime(mv).seconds)}`);
}

console.log(lines.join('\n'));
console.log(`tex defaults: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
