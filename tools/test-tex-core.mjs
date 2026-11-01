// TEX's core in node (web/kiri/swarf-tex-core.mjs): every pattern within its depth, the drop cutter
// never below the design, the scallop stepover, one plunge per dot, Morse SOS read back, the plain
// warnings; then the marks: a painted region kept as runs, a mark turned and scaled with its part,
// its moves never below its depth or the board, and room left for a pierce fill.
//   node tools/test-tex-core.mjs
import * as T from '../web/kiri/swarf-tex-core.mjs';
import { createRequire } from 'node:module';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('FAIL', msg); } };
const t0 = Date.now();

// 1. every pattern: h finite, 0 <= h <= depth, and not flat (it actually cuts something)
const board = { w: 300, h: 200 };
for (const id of Object.keys(T.PATTERNS)) {
  const tex = T.texture({ pattern: id, mask: { type: 'rect', x0: 20, y0: 20, x1: 180, y1: 140 }, soft: 3, transform: { angle: 17, ox: 100, oy: 80 } });
  let bad = 0, over = 0, max = 0, min = Infinity;
  for (let k = 0; k < 6000; k++) {
    const x = 10 + (k * 7.31) % 180, y = 10 + (k * 3.77) % 140;
    const h = tex.h(x, y);
    if (!Number.isFinite(h)) bad++;
    if (h < -1e-9 || h > tex.depth + 1e-6) over++;
    max = Math.max(max, h); min = Math.min(min, h);
  }
  ok(bad === 0, `${id}: h finite`);
  ok(over === 0, `${id}: 0 <= h <= depth (${tex.depth})`);
  ok(max > 0.25 * tex.depth, `${id}: uses its depth (max ${max.toFixed(2)} of ${tex.depth})`);
  ok(tex.h(5, 5) === 0 && tex.h(199, 150) === 0, `${id}: zero outside the mask`);
  ok(tex.feature >= 0 && typeof tex.featureLabel === 'string', `${id}: declares feature size`);
  console.log(`  ${id.padEnd(8)} depth ${tex.depth}  range ${min.toFixed(2)}..${max.toFixed(2)}  feature ${tex.featureLabel}`);
}
// overlay blend stays within its combined depth
{
  const tex = T.texture({ pattern: 'stone', overlay: { pattern: 'noise', amount: 0.5 }, mask: { type: 'ellipse', cx: 50, cy: 50, rx: 40, ry: 30 } });
  let over = 0; for (let k = 0; k < 3000; k++) { const h = tex.h(10 + k % 80, 20 + (k * 13) % 60); if (!(h >= 0 && h <= tex.depth + 1e-6)) over++; }
  ok(over === 0, 'overlay: stone + noise within combined depth');
}

// 2. drop cutter never gouges below the target (exact against the analytic h at sampled radii)
for (const toolId of Object.keys(T.TOOLS)) {
  const tool = T.makeTool(toolId);
  for (const id of ['dots', 'stone', 'waves', 'knurl']) {
    const tex = T.texture({ pattern: id, mask: { type: 'rect', x0: 0, y0: 0, x1: 60, y1: 60 } });
    const offs = T.toolOffsets(tool, 0.1, tex.depth + 0.01);
    let worst = 0;
    for (let k = 0; k < 60; k++) {
      const x = 5 + (k * 9.7) % 50, y = 5 + (k * 4.3) % 50;
      const z = T.dropCutter(tex.h, tool, x, y, { offsets: offs });
      // probe the cutter's surface on rings it was not sampled on
      for (let r = 0; r <= tool.R; r += tool.R / 7) for (let a = 0; a < 6.283; a += 0.37) {
        const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
        const pen = (-tex.h(px, py)) - (z + tool.prof(r));   // > 0 means the cutter is below the target
        worst = Math.max(worst, pen);
      }
    }
    ok(worst < 0.06, `drop cutter ${toolId} on ${id}: worst penetration ${worst.toFixed(3)} mm`);
  }
}
// raster path itself never cuts below the target by more than grid tolerance (sim vs ideal)
{
  const tex = T.texture({ pattern: 'dots', params: { pitch: 12, diameter: 8, depth: 1.5 }, mask: { type: 'rect', x0: 10, y0: 10, x1: 70, y1: 50 } });
  const tool = T.makeTool('ball18');
  const path = T.rasterPath(tex, tool, { scallop: 0.03, res: 0.2 });
  const grid = { x0: 0, y0: 0, nx: 321, ny: 241, res: 0.25 };
  const Z = T.simulate(path.moves, grid, tool);
  const cmp = T.compare(Z, grid, tex, 0.1);
  ok(cmp.overcut < 0.002, `raster sim: overcut ${(cmp.overcut * 100).toFixed(2)}% of cells beyond 0.1 mm`);
  ok(cmp.within > 0.85, `raster sim with a small ball matches the design on ${(cmp.within * 100).toFixed(0)}% of cells`);
}

// 3. scallop stepover formula
{
  const ball = T.makeTool('ball14'), r = 3.175;
  for (const h of [0.01, 0.05, 0.1]) {
    const so = T.stepoverForScallop(ball, h);
    ok(Math.abs(so - 2 * Math.sqrt(2 * r * h - h * h)) < 1e-9, `scallop ${h}: exact chord`);
    ok(Math.abs(so - 2 * Math.sqrt(2 * r * h)) / so < 0.01, `scallop ${h}: ~2*sqrt(2rh)`);
    // the scallop between two passes really is h: the two circles meet h above the bottom
    const mid = so / 2;
    ok(Math.abs((r - Math.sqrt(r * r - mid * mid)) - h) < 1e-9, `scallop ${h}: cusp height check`);
  }
  const v = T.makeTool('v90');
  ok(Math.abs(T.stepoverForScallop(v, 0.1) - 0.2) < 1e-9, 'V90 scallop 0.1 -> 0.2 mm stepover');
}

// 4. plunge mode: one plunge per dot inside the mask
{
  const mask = { type: 'ellipse', cx: 100, cy: 80, rx: 60, ry: 40 };
  const tex = T.texture({ pattern: 'dots', params: { pitch: 10, diameter: 6, depth: 1.5, layout: 'hex' }, mask });
  const tool = T.makeTool('ball14');
  const res = T.plungeDots(tex, tool, {});
  // independent count: walk the hex lattice and test each center against the ellipse
  let expect = 0;
  const py = 10 * Math.sqrt(3) / 2;
  for (let j = -20; j <= 40; j++) for (let i = -20; i <= 40; i++) {
    const x = i * 10 + ((j & 1) ? 5 : 0), y = j * py;
    if (((x - 100) / 60) ** 2 + ((y - 80) / 40) ** 2 <= 1) expect++;
  }
  const bottoms = res.moves.filter((m) => !m.rapid && Math.abs(m.z + 1.5) < 1e-9).length;
  ok(bottoms === expect && res.dots === expect, `plunge: ${bottoms} plunges for ${expect} dots in the mask`);
  const est = T.estimateTime(res.moves, {});
  ok(est.plunges === expect, `plunge: time estimate counts ${est.plunges} plunges`);
  ok(est.seconds > 0, `plunge time positive (${T.formatTime(est.seconds)})`);
  // with step-down 0.5 it still has one bottom per dot
  const res2 = T.plungeDots(tex, tool, { stepDown: 0.5 });
  ok(res2.moves.filter((m) => !m.rapid && Math.abs(m.z + 1.5) < 1e-9).length === expect, 'plunge with step-down: one bottom per dot');
}

// 5. Morse
ok(T.morseEncode('SOS') === '... --- ...', 'morse SOS -> "... --- ..."');
ok(T.morseEncode('SOS').replace(/ /g, '') === '...---...', 'morse SOS -> ...---...');
ok(T.morseEncode('hi there') === '.... .. / - .... . .-. .', 'morse words split by /');
{
  // the strokes of one SOS row read back as dot dot dot dash dash dash dot dot dot
  const tex = T.texture({ pattern: 'morse', params: { text: 'SOS', unit: 3, width: 3, rows: 100, shift: 0 }, mask: { type: 'rect', x0: -1.6, y0: -2, x1: 110, y1: 2 } });
  const st = tex.strokes().filter((s) => Math.abs(s.pts[0].y) < 0.5).sort((a, b) => a.pts[0].x - b.pts[0].x);
  const read = st.slice(0, 9).map((s) => (s.pts.length === 1 || Math.hypot(s.pts[s.pts.length - 1].x - s.pts[0].x) < 1e-6 ? '.' : '-')).join('');
  ok(read === '...---...', `morse strokes read ${read}`);
  // and the height field has a dot at the first dot center and nothing in a letter gap
  ok(tex.h(1.5, 0) > 0.9 * tex.depth, 'morse h: first dot is cut');
  ok(tex.h(16.5, 0) === 0, 'morse h: letter gap is uncut');
}

// 6. time estimates positive for every strategy
{
  const mask = { type: 'rect', x0: 20, y0: 20, x1: 80, y1: 60 };
  const cases = [['stone', 'ball14', 'raster'], ['knurl', 'v90', 'centerline'], ['morse', 'v60', 'centerline'], ['waves', 'ball18', 'crosshatch'], ['noise', 'ball14', 'raster']];
  for (const [pat, tool, strategy] of cases) {
    const tex = T.texture({ pattern: pat, mask });
    const p = T.toolpath(tex, tool, { strategy, stepDown: 1, maxDepth: 3 });
    const est = T.estimateTime(p.moves, {});
    ok(p.moves.length > 10 && est.seconds > 0, `${pat}/${tool}/${strategy}: ${p.moves.length} moves, ${T.formatTime(est.seconds)}`);
    ok(p.moves.every((m) => m.z >= -3 - 1e-9 && Number.isFinite(m.x + m.y + m.z)), `${pat}/${strategy}: respects max depth, finite`);
    ok(p.moves.every((m) => !m.rapid || m.z >= 0), `${pat}/${strategy}: no rapid below the top`);
  }
}

// 7. plain warning for a tool that's too big
{
  const tex = T.texture({ pattern: 'dots', params: { diameter: 3, depth: 1.5, pitch: 6 }, mask: { type: 'rect', x0: 0, y0: 0, x1: 40, y1: 40 } });
  const a = T.analyze(tex, 'ball14', {});
  ok(a.warnings.some((w) => /1\/4 in ball can't make 3 mm dots/.test(w)), 'warning: 1/4 ball vs 3 mm dots');
  console.log('  ' + a.warnings[0]);
  const b = T.analyze(T.texture({ pattern: 'dots', mask: { type: 'rect', x0: 0, y0: 0, x1: 40, y1: 40 } }), 'ball18', {});
  ok(b.warnings.length === 0, 'no warning: 1/8 ball vs 6.5 mm dots');
}

// 8. paint mask: distance field agrees with the analytic rect it was painted from
{
  const nx = 200, ny = 120, res = 0.5, data = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const x = (i + 0.5) * res, y = (j + 0.5) * res; data[j * nx + i] = x > 20 && x < 80 && y > 15 && y < 45 ? 1 : 0; }
  const pm = T.paintMask({ nx, ny, res, data }), rm = T.rectMask(20, 15, 80, 45);
  let worst = 0;
  for (const [x, y] of [[50, 30], [22, 30], [50, 17], [10, 10], [85, 50], [79, 44]]) worst = Math.max(worst, Math.abs(pm.sd(x, y) - rm.sd(x, y)));
  ok(worst < 1.2, `paint mask sd within ${worst.toFixed(2)} mm of the rect`);
}


// 9. marks: a painted region survives its run-length coding
{
  const g = T.newGrid(-40, -30, 40, 30, 0.5);
  const n = T.stampStroke(g, -20, 0, 20, 5, 6, 1) + T.stampDisc(g, 25, -15, 4, 1);
  T.stampDisc(g, 0, 2, 3, 0);                                 // erase a hole in it
  const stored = T.storeRegion(g);
  ok(!stored.data && Array.isArray(stored.runs) && stored.runs.length < g.data.length / 20, `runs: ${stored.runs.length} for ${g.data.length} cells`);
  const back = T.regionSpec(stored);
  let same = true; for (let i = 0; i < g.data.length; i++) if (back.data[i] !== g.data[i]) { same = false; break; }
  ok(same && n > 0 && T.gridCount(back) === T.gridCount(g), 'runs decode to the same cells');
  ok(g.data[Math.floor((2 + 30) / 0.5) * g.nx + Math.floor(40 / 0.5)] === 0, 'the erased disc is empty');
  ok(JSON.stringify(JSON.parse(JSON.stringify(stored))) === JSON.stringify(stored), 'a stored region is plain JSON');
}

// 10. a mark turned 30°, scaled 1.5 and moved with its part reads the same surface at the moved point
{
  const g = T.newGrid(0, 0, 60, 40, 0.5);
  T.paintWhere(g, (x, y) => x > 5 && x < 55 && y > 5 && y < 35, 1);
  const mark = { id: 'm1', region: T.storeRegion(g), xf: T.IDENTITY.slice(), fill: T.newFill('stone', { origin: [30, 20], fade: 0 }) };
  const a = 30 * Math.PI / 180, s = 1.5;
  const turned = { ...mark, xf: [s * Math.cos(a), -s * Math.sin(a), s * Math.sin(a), s * Math.cos(a), 12, -7] };
  const t0 = T.markTexture(mark), t1 = T.markTexture(turned);
  let worst = 0;
  for (let k = 0; k < 400; k++) {
    const x = 3 + (k * 7.13) % 54, y = 3 + (k * 3.31) % 34;
    const [X, Y] = T.xfApply(turned.xf, x, y);
    worst = Math.max(worst, Math.abs(t0.h(x, y) - t1.h(X, Y)));
  }
  ok(worst < 1e-6, `turned + scaled mark: same surface at the moved point (worst ${worst.toExponential(1)})`);
  ok(Math.abs(t1.feature - t0.feature * s) < 1e-9 && Math.abs(t1.depth - t0.depth) < 1e-12, 'features scale with the part, depth does not');
  const inv = T.xfInvert(turned.xf), round = T.xfApply(inv, ...T.xfApply(turned.xf, 3, 4));
  ok(Math.hypot(round[0] - 3, round[1] - 4) < 1e-9, 'xfInvert undoes xf');
  const m = T.xfThen(T.xfThen(T.IDENTITY, [2, 0, 0, 2, 0, 0]), [0, -1, 1, 0, 5, 0]);
  ok(JSON.stringify(T.xfApply(m, 1, 0)) === JSON.stringify([5, 2]), 'xfThen applies the first, then the second');
}

// 11. a mark's moves: never below its depth or below the board, never a rapid in the wood,
//     and its cutting runs each start above the board
{
  const g = T.newGrid(0, 0, 80, 50, 0.5);
  T.paintWhere(g, (x, y) => ((x - 40) / 32) ** 2 + ((y - 25) / 18) ** 2 <= 1, 1);
  const cases = [['waves', 'ball14', 2.2, 'auto'], ['dots', 'ball14', 1.6, 'auto'], ['knurl', 'v90', 3, 'auto'], ['morse', 'v60', 1.2, 'auto'], ['stone', 'flat14', 2.4, 'crosshatch']];
  for (const [pat, tool, depth, path] of cases) {
    const mark = { id: pat, region: T.storeRegion(g), xf: [1, 0, 0, 1, 0, 0], fill: T.newFill(pat, { tool, depth, path, origin: [40, 25] }) };
    const thick = pat === 'knurl' ? 2 : 19;
    const r = T.markToolpath(mark, { maxDepth: thick, stepDown: 1.5 });
    const deep = Math.min(depth, thick), low = Math.min(...r.moves.map((q) => q.z));
    ok(r.moves.length > 10 && low >= -deep - 1e-6, `${pat}/${tool}/${r.strategy}: ${r.moves.length} moves, lowest ${low.toFixed(3)} (no deeper than ${deep})`);
    ok(r.moves.every((q) => !q.rapid || q.z >= 0), `${pat}: no rapid below the top`);
    const runs = T.feedRuns(r.moves);
    ok(runs.length > 0 && runs.every((run) => run[0][2] >= 0 && run.every((p) => p[2] >= -deep - 1e-6)), `${pat}: ${runs.length} cutting runs, each starts above the board`);
    const chk = T.markChecks(mark, { thickness: thick });
    if (pat === 'knurl') ok(chk.warnings.some((w) => /it would cut through/.test(w)), 'a texture deeper than the board is said');
    else ok(!chk.warnings.some((w) => /cut through/.test(w)), `${pat}: no cut-through warning on a 19 mm board`);
  }
  const reg = T.storeRegion(g);
  ok(T.pathFor(T.markTexture({ region: reg, fill: T.newFill('dots', { origin: [40, 25] }) }), 'ball14') === 'plunge', 'auto: dots the bit can make are plunged');
  ok(T.pathFor(T.markTexture({ region: reg, fill: T.newFill('ribs', { origin: [40, 25] }) }), 'v60') === 'centerline', 'auto: grooves with a V follow their centers');
  ok(T.pathFor(T.markTexture({ region: reg, fill: T.newFill('waves', { origin: [40, 25] }) }), 'ball14', 'plunge') === 'raster', 'a path that does not fit the pattern falls back to raster');
  const big = T.markChecks({ region: reg, fill: T.newFill('dots', { tool: 'ball14', params: { ...T.defaults('dots'), diameter: 3, pitch: 6 }, depth: 1.5, origin: [40, 25] }) }, { thickness: 19, len: (v) => `${(v / 25.4).toFixed(3)} in` });
  ok(big.warnings.some((w) => /1\/4 in ball can't make 0\.118 in dots 0\.059 in deep/.test(w)), `the warning in the app's units: ${big.warnings[0]}`);
  ok(T.markChecks({ region: reg, fill: T.newFill('waves') }, { outside: 0.3 }).warnings.some((w) => /30% of the mark is off the part/.test(w)), 'a mark off its part is said');
  // room for a pierce fill: not a texture, so no texture moves (and no error)
  ok(T.markTexture({ region: reg, fill: T.newPierce('kerf') }) === null && T.markToolpath({ region: reg, fill: { fill: 'pierce' } }).moves.length === 0, 'a pierce fill is no texture; one with no pattern cuts nothing');
  const empty = T.newGrid(0, 0, 10, 10, 0.5);
  ok(T.markTexture({ region: T.storeRegion(empty), fill: T.newFill('waves') }) === null, 'an empty region has no texture');
}

// 12. the card's words from the core: lowercase names, one or two numbers that size each pattern
//     shown first, seeds offered as a shuffle; the feature size in the app's units
for (const [id, P] of Object.entries(T.PATTERNS)) {
  ok(P.label === P.label.toLowerCase(), `${id}: its name is lowercase ("${P.label}")`);
  const basic = P.params.filter((q) => q.basic).map((q) => q.k);
  ok(basic.length >= 1 && basic.length <= 3 && !basic.includes('depth') && !basic.includes('seed'), `${id}: ${basic.join(', ')} first`);
  ok(P.params.filter((q) => q.k === 'seed').every((q) => q.shuffle && !q.basic), `${id}: a seed is a shuffle`);
}
{
  const g = T.newGrid(0, 0, 80, 50, 0.5);
  T.paintWhere(g, () => true, 1);
  const chk = T.markChecks({ region: T.storeRegion(g), fill: T.newFill('noise', { tool: 'ball14', origin: [40, 25] }) }, { thickness: 19, len: (v) => `${(v / 25.4).toFixed(3)} in` });
  const line = chk.notes.find((n) => /finest detail/.test(n)) || '';
  ok(/\(~0\.138 in finest lumps\)/.test(line) && !/ mm/.test(line), `the feature size in inches: "${line}"`);
}

// 13. pictures: a swatch for every pattern, shaded inside the host's bounded range
{
  const lo = [60, 50, 40], hi = [230, 220, 200];
  for (const id of Object.keys(T.PATTERNS)) {
    const D = T.swatch(id, 32, { lo, hi });
    let mn = 255, mx = 0, out = 0;
    for (let i = 0; i < D.length; i += 4) { mn = Math.min(mn, D[i]); mx = Math.max(mx, D[i]); if (D[i] < lo[0] - 1 || D[i] > hi[0] + 1 || D[i + 3] !== 255) out++; }
    ok(D.length === 32 * 32 * 4 && out === 0 && mx - mn > 30, `${id} swatch: ${mn}..${mx}, all within ${lo[0]}..${hi[0]}`);
  }
  const H = new Float32Array(9).fill(1), inside = new Uint8Array(9); inside[4] = 1;
  const D = T.shadeHeight(H, 3, 3, 1, { lo, hi }, inside);
  ok(D[3] === 0 && D[4 * 4 + 3] === 255, 'shadeHeight leaves pixels outside the mask clear');
}

// 14. pierce: kerf pitch p = w·R/(T−s); slots a bit wide, inside the mark, never below the board;
//     holes inside the mark, no smaller than the bit; the soft edge thins the pattern
{
  ok(Math.abs(T.kerfPitch(3.175, 19, 2.5, 200) - 3.175 * 200 / 16.5) < 1e-9, 'kerf pitch: w·R/(T−s)');
  const g = T.newGrid(0, 0, 200, 120, 0.5);
  T.paintWhere(g, (x, y) => x > 20 && x < 180 && y > 20 && y < 100, 1);
  const reg = T.storeRegion(g), inMark = (x, y) => x >= 20 - 1e-6 && x <= 180 + 1e-6 && y >= 20 - 1e-6 && y <= 100 + 1e-6;
  const kerf = { region: reg, xf: T.IDENTITY.slice(), fill: T.newPierce('kerf', { origin: [100, 60], params: { radius: 150, skin: 2.5, bridge: 0, slot: 80 } }) };
  const K = T.pierceCuts(kerf, { thickness: 19 });
  const w = 3.175, pitch = w * 150 / 16.5;
  ok(Math.abs(K.pitch - pitch) < 1e-9 && K.width === w && Math.abs(K.depth - 16.5) < 1e-9 && !K.through, `kerfs: pitch ${K.pitch.toFixed(2)} mm, ${K.depth} deep, a ${K.width} mm bit`);
  // every slot runs along x (turn 0), the bit's whole width inside the mark, spaced the pitch apart
  const ys = [...new Set(K.slots.map((q) => +q.a[1].toFixed(3)))].sort((a, b) => a - b);
  ok(K.slots.length >= 3 && K.slots.every((q) => Math.abs(q.a[1] - q.b[1]) < 1e-9 && inMark(q.a[0] - w / 2, q.a[1] - w / 2) && inMark(q.b[0] + w / 2, q.b[1] + w / 2)), `${K.slots.length} slots, each a bit wide inside the mark`);
  ok(ys.slice(1).every((y, i) => Math.abs(y - ys[i] - pitch) < 0.01), 'slots spaced the pitch apart');
  const KP = T.pierceToolpath(kerf, { thickness: 19, stepDown: 6 });
  const lo = Math.min(...KP.moves.map((q) => q.z));
  ok(Math.abs(lo + 16.5) < 1e-9 && KP.moves.every((q) => !q.rapid || q.z >= 0), `kerf moves: down to the skin (-16.5), passes of 6 mm, no rapid in the wood (lowest ${lo})`);
  const cutsK = KP.moves.filter((q) => !q.rapid && q.z < 0);
  ok(cutsK.every((q) => inMark(q.x - w / 2, q.y - w / 2) && inMark(q.x + w / 2, q.y + w / 2)), 'every kerf cut stays inside the mark');
  // a turn of 90 sets the bend line across: slots now run along y
  const K90 = T.pierceCuts({ ...kerf, fill: { ...kerf.fill, angle: 90 } }, { thickness: 19 });
  ok(K90.slots.length && K90.slots.every((q) => Math.abs(q.a[0] - q.b[0]) < 1e-6), 'the mark\'s turn sets the bend line');
  // through, with bridges: slots no longer than asked, staggered
  const KT = T.pierceCuts({ ...kerf, fill: { ...kerf.fill, params: { radius: 150, skin: 0, bridge: 8, slot: 30 } } }, { thickness: 19 });
  ok(KT.through && KT.depth === 19 && KT.slots.every((q) => Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]) <= 30 + 0.6), `through kerfs with bridges: ${KT.slots.length} slots no longer than 30 mm`);
  ok(T.pierceChecks({ ...kerf, fill: { ...kerf.fill, params: { radius: 150, skin: 0, bridge: 0, slot: 30 } } }, { thickness: 19 }).warnings.some((x) => /comes apart in strips/.test(x)), 'no skin, no bridges: said');
  // the soft edge thins the slots: less cut length near the edge
  const len = (c) => c.slots.reduce((a, q) => a + Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]), 0);
  const KF = T.pierceCuts({ ...kerf, fill: { ...kerf.fill, fade: 25 } }, { thickness: 19 });
  ok(len(KF) < len(K) * 0.85 && KF.slots.length > K.slots.length, `the soft edge breaks the slots up near the edge (${len(K).toFixed(0)} → ${len(KF).toFixed(0)} mm, ${K.slots.length} → ${KF.slots.length} slots)`);
  const tight = T.pierceChecks({ ...kerf, fill: { ...kerf.fill, params: { radius: 25, skin: 2.5 } } }, { thickness: 19 });
  ok(tight.warnings.some((x) => /thinner than two bit widths/.test(x)) && tight.warnings.some((x) => /may crack/.test(x)) && tight.notes.some((x) => /test strip/.test(x)), 'a tight bend: thin ribs and a cracking skin said; a test strip asked for');

  // review 10-30 F2: the default skin follows the board (2.5 mm, never more than a quarter of it),
  // so 6, 12 and 19 mm boards all get a kerf field on a quarter-turn mark at the default radius;
  // a mark narrower than a pitch or two says the real reason (the mark, not the bend)
  ok(T.defaultSkin(6) === 1.5 && T.defaultSkin(12) === 1.5 && T.defaultSkin(3) === 0.8 && T.defaultSkin(19, 200) === 2.5 && T.defaultSkin(12, 200) === 2.5 && T.defaultSkin(6, 200) === 1.5 && T.pierceDefaults('kerf').skin === 1.5, 'the default skin: min(2.5, board/4, what bends to 100 mm uncracked)');
  const gq = T.newGrid(0, 0, 220, 180, 0.5);
  T.paintWhere(gq, (x, y) => x > 10 && x < 210 && y > 10 && y < 170, 1);   // 200 long, 160 across the bend
  const fields = [];
  for (const th of [6, 12, 19]) {
    const mk = { region: T.storeRegion(gq), xf: T.IDENTITY.slice(), fill: T.newPierce('kerf', { origin: [110, 90] }, th) };
    const c = T.pierceCuts(mk, { thickness: th }), n = T.kerfCount(c), ch = T.pierceChecks(mk, { thickness: th });
    fields.push(`${th} mm: skin ${mk.fill.params.skin}, every ${c.pitch.toFixed(1)} mm, ${n} kerfs`);
    ok(n >= 3 && Math.abs(c.across - 158) < 3 && !ch.notes.some((x) => /across the bend;/.test(x)) && !ch.warnings.some((x) => /may crack|may snap/.test(x)), `a ${th} mm board, default radius, a 160 mm mark: ${n} kerfs, no warning`);
  }
  console.log('  kerf fields at radius 100:', fields.join(' · '));
  const gn = T.newGrid(0, 0, 200, 60, 0.5);
  T.paintWhere(gn, (x, y) => x > 10 && x < 190 && y > 10 && y < 50, 1);    // 180 long, 40 across
  const narrow = T.pierceChecks({ region: T.storeRegion(gn), xf: T.IDENTITY.slice(), fill: T.newPierce('kerf', { origin: [100, 30] }, 6) }, { thickness: 6 });
  const why = narrow.notes.find((x) => /across the bend;/.test(x)) || '';
  ok(/This mark is 40 mm across the bend; kerfs fall every 71 mm, so only 1 fits: make the mark wider across the bend\. A quarter turn at 100 mm wants about 157 mm across\./.test(why) && !narrow.notes.some((x) => /gentle/.test(x)), `a narrow mark on 6 mm says why: "${why}"`);
  // r086 check S3: in inches the card says the nearest 16th, and one pitch the same way in every line
  {
    const LEN = createRequire(import.meta.url)('../web/kiri/swarf-length.js');
    const inch = T.pierceChecks({ region: T.storeRegion(gn), xf: T.IDENTITY.slice(), fill: T.newPierce('kerf', { origin: [100, 30] }, 6) }, { thickness: 6, len: (v) => LEN.prose(v, 'in') });
    const all = inch.notes.concat(inch.warnings).join(' ');
    const pitches = [...all.matchAll(/(?:Kerfs every|kerfs fall every|Every) ([\d /]+ in)/g)].map((m) => m[1]);
    ok(pitches.length === 2 && new Set(pitches).size === 1 && !/\/(32|64) in/.test(all) && !/\d\.\d+ in/.test(all) && /This mark is 1 9\/16 in across the bend; kerfs fall every 2 3\/4 in/.test(all),
      `inch prose: one pitch said one way (${pitches.join(', ')}), no 64ths or decimals: "${all.slice(0, 200)}"`);
  }
  const n19 = T.pierceChecks({ region: T.storeRegion(gn), xf: T.IDENTITY.slice(), fill: T.newPierce('kerf', { origin: [100, 30], params: { radius: 400, skin: 1.5 } }, 19) }, { thickness: 19 });
  ok(n19.notes.some((x) => /across the bend; kerfs fall every 73 mm, so (only 1 fits|none fit): make the mark wider across the bend or the radius smaller/.test(x)), `a gentle bend may come down too: said (${n19.notes[1]})`);

  // holes: inside the mark, no smaller than the bit, smaller toward a soft edge; cleared through
  const holes = { region: reg, xf: T.IDENTITY.slice(), fill: T.newPierce('holes', { origin: [100, 60], params: { size: 10, spacing: 18, layout: 'hex' } }) };
  const H = T.pierceCuts(holes, { thickness: 12 });
  ok(H.holes.length > 20 && H.holes.every((h) => inMark(h.x - h.d / 2, h.y - h.d / 2) && inMark(h.x + h.d / 2, h.y + h.d / 2) && h.d >= w), `${H.holes.length} holes, each wholly inside the mark`);
  const HF = T.pierceCuts({ ...holes, fill: { ...holes.fill, fade: 20 } }, { thickness: 12 });
  ok(HF.holes.some((h) => h.d < 10 - 1e-6) && HF.holes.every((h) => h.d >= w - 1e-9 && h.d <= 10 + 1e-9), 'the soft edge makes the holes smaller near the edge, never under the bit');
  const HP = T.pierceToolpath(holes, { thickness: 12, stepDown: 4 });
  const hc = HP.moves.filter((q) => !q.rapid && q.z <= -12 + 1e-9);
  ok(Math.abs(Math.min(...HP.moves.map((q) => q.z)) + 12) < 1e-9 && H.holes.every((h) => hc.some((q) => Math.abs(Math.hypot(q.x - h.x, q.y - h.y) - (h.d - w) / 2) < 0.05)), 'each hole cleared to its edge, right through');
  ok(T.pierceChecks({ ...holes, fill: { ...holes.fill, params: { size: 2, spacing: 5 } } }, { thickness: 12 }).warnings.some((x) => /can't cut 2 mm holes/.test(x)), 'holes smaller than the bit: said');
  ok(T.markToolpath(holes, { maxDepth: 12 }).moves.length === T.pierceToolpath(holes, { thickness: 12 }).moves.length, 'markToolpath cuts a pierce mark through the board it is given');
  // turned and scaled with its part: holes keep inside the moved mark
  const hx = { ...holes, xf: [0, -1, 1, 0, 0, 0] }, H2 = T.pierceCuts(hx, { thickness: 12 });
  ok(H2.holes.length === H.holes.length, 'a turned mark has the same holes');
  const svg = T.pierceSVG(kerf, { thickness: 19 });
  ok(/<svg[^>]+width="[\d.]+mm"/.test(svg) && (svg.match(/<line /g) || []).length === K.slots.length && /stroke="#FF0000"/.test(svg) && /test strip/.test(svg), 'the laser SVG: one red line a slot, in mm');
}

// 15. the mark on its part (Phil 10-30): paint past the part's edge does not count; where the paint
//     meets the edge the pattern runs full depth to it (the soft edge only along the paint's own
//     edge inside the part); the bit reaches the edge (it may hang past it, never past the reach)
{
  const part = [[[0, 0], [100, 0], [100, 60], [0, 60]], [[70, 20], [85, 20], [85, 40], [70, 40]]];   // a hole
  const g = T.newGrid(-10, -10, 110, 70, 0.5);
  T.paintWhere(g, (x, y) => x < 50, 1);                          // painted past the left edge, to x = 50
  const fill = T.newFill('ribs', { origin: [0, 0], fade: 10, depth: 2, params: { ...T.defaults('ribs'), pitch: 8, width: 6, depth: 2, profile: 'flat' }, tool: 'ball18' });
  const mark = { region: T.storeRegion(g), xf: T.IDENTITY.slice(), fill };
  const tex = T.markTexture(mark, { part, extend: 2 }), bare = T.markTexture({ ...mark, fill: { ...fill, fade: 0 } }, { part, extend: 2 });
  // on a groove (x = 0 mod 8), so the flat profile reads the full depth
  ok(Math.abs(tex.h(0.3, 32) - 2) < 1e-6 && Math.abs(tex.h(0.3, 2) - 2) < 1e-6, `full depth right at the part's edge: ${tex.h(0.3, 32).toFixed(3)} at x 0.3, ${tex.h(0.3, 2).toFixed(3)} at y 2`);
  ok(tex.h(48, 32) < 0.5 * bare.h(48, 32) && tex.h(40, 32) > 0.99 * bare.h(40, 32), `the soft edge fades along the paint's own edge (x 50): ${tex.h(48, 32).toFixed(2)} at 48, ${tex.h(40, 32).toFixed(2)} at 40`);
  ok(tex.h(-5, 32) === 0 && tex.h(-1, 32) > 0, `past the edge: carried 2 mm into the air to let the bit reach (${tex.h(-1, 32).toFixed(2)} at -1), nothing beyond (${tex.h(-5, 32)} at -5)`);
  // a hole in the paint's way: full depth to the hole's edge, carried into it as into air
  const g2 = T.newGrid(-10, -10, 110, 70, 0.5); T.paintWhere(g2, () => true, 1);
  const t2 = T.markTexture({ region: T.storeRegion(g2), xf: T.IDENTITY.slice(), fill }, { part, extend: 2 });
  ok(Math.abs(t2.h(69.7, 32) - 2) < 1e-6 && t2.h(77, 30) === 0, `full depth to a hole's edge (${t2.h(69.7, 32).toFixed(2)}), nothing in its middle`);
  // the cutter reaches the edge: simulated, the cells just inside the edge are cut to the design
  const path = T.markToolpath(mark, { part, maxDepth: 19, res: 0.2 });
  const grid = { x0: -12, y0: -12, nx: 600, ny: 420, res: 0.25 };
  const Z = T.simulate(path.moves, grid, T.makeTool('ball18'));
  let n = 0, near = 0, past = 0;
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) {
    const x = grid.x0 + i * grid.res, y = grid.y0 + j * grid.res, z = Z[j * grid.nx + i];
    if (x > 0.2 && x < 1 && y > 5 && y < 55 && tex.h(x, y) > 1.9) { n++; if (z <= -tex.h(x, y) + 0.15) near++; }
    if (x < -2 - 1.5875 - 0.3 && z < -1e-6) past++;
  }
  ok(n > 50 && near / n > 0.95, `the bit reaches the edge: ${near} of ${n} cells just inside it cut to the design`);
  ok(past === 0, 'and never cuts farther past the edge than its own reach');
  // pierce: holes centered on the part only; a hole meeting the edge opens out through it
  const hm = { region: T.storeRegion(g2), xf: T.IDENTITY.slice(), fill: T.newPierce('holes', { origin: [2, 2], params: { size: 8, spacing: 14, layout: 'grid' } }) };
  const H = T.pierceCuts(hm, { thickness: 12, part });
  ok(H.holes.length && H.holes.every((h) => h.x >= 0 && h.x <= 100 && h.y >= 0 && h.y <= 60 && !(h.x > 70 && h.x < 85 && h.y > 20 && h.y < 40)), `${H.holes.length} holes, each centered on the part's top (none in its hole)`);
  ok(H.holes.some((h) => h.x - h.d / 2 < 0 || h.y - h.d / 2 < 0), 'holes at the edge open out through it');
  ok(T.pierceChecks(hm, { thickness: 12, part }).notes.some((x) => /open notches/.test(x)), 'open notches: said');
  // a kerf running 3 mm in from the edge leaves a sliver: said
  const g3 = T.newGrid(-10, -10, 110, 70, 0.5); T.paintWhere(g3, (x, y) => y > 4 && y < 30, 1);
  const km = { region: T.storeRegion(g3), xf: T.IDENTITY.slice(), fill: T.newPierce('kerf', { origin: [0, 6], params: { radius: 200, skin: 2.5 } }) };
  const kc = T.pierceChecks(km, { thickness: 19, part });
  ok(kc.warnings.some((x) => /thinner than two bit widths that may break off/.test(x)), `a sliver between a kerf and the edge: said (${kc.warnings.find((x) => /strip/.test(x)) || kc.warnings[0]})`);
}

// 16. the mark's edge as a curve with points: fit, then back into the paint
{
  const g = T.newGrid(0, 0, 80, 60, 0.5);
  T.paintWhere(g, (x, y) => ((x - 40) / 25) ** 2 + ((y - 30) / 18) ** 2 <= 1 && Math.hypot(x - 40, y - 30) > 6, 1);   // an ellipse with a hole
  const cv = T.fitCurves(g, { count: 16 });
  ok(cv.loops.length === 2 && cv.loops[0].orient !== cv.loops[1].orient, `two loops (the edge and the hole), opposite turns: ${cv.loops.map((l) => `${l.handles.length}:${l.orient}`).join(' ')}`);
  // round trip: the rewritten paint differs only along the edge, within a cell
  const back = T.rewriteFromCurves(g, cv);
  let diff = 0, far = 0;
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const k = j * g.nx + i;
    if (back.data[k] === g.data[k]) continue;
    diff++;
    let edge = false;
    for (let dj = -2; dj <= 2 && !edge; dj++) for (let di = -2; di <= 2; di++) { const q = (j + dj) * g.nx + i + di; if (q >= 0 && q < g.data.length && g.data[q] !== g.data[k]) { edge = true; break; } }
    if (!edge) far++;
  }
  ok(far === 0 && diff < 0.05 * T.gridCount(g), `fit → rewrite: ${diff} cells changed, all at the edge`);
  // the handles are on the curve: it passes through them
  const Q = T.controlsFor(cv.loops[0].handles), p0 = T.splineAt(Q, 3);
  ok(Math.hypot(p0[0] - cv.loops[0].handles[3][0], p0[1] - cv.loops[0].handles[3][1]) < 1e-9, 'the curve passes through its points');
  // a drag: one point of the outer loop out 8 mm; the edge follows it there
  const outer = cv.loops.find((l) => l.orient > 0), k = outer.handles.reduce((b, h, i) => (h[0] > outer.handles[b][0] ? i : b), 0);
  const moved = { loops: cv.loops.map((l) => (l === outer ? { ...l, handles: l.handles.map((h, i) => (i === k ? [h[0] + 8, h[1]] : h)) } : l)) };
  const drag = T.rewriteFromCurves(g, moved), tip = outer.handles[k];
  const cellAt = (G, x, y) => G.data[Math.floor((y - G.y0) / G.res) * G.nx + Math.floor((x - G.x0) / G.res)];
  ok(drag && cellAt(drag, tip[0] + 7.5, tip[1]) === 1 && cellAt(drag, tip[0] + 8.5, tip[1]) === 0 && cellAt(g, tip[0] + 7.5, tip[1]) === 0, `a dragged point takes the edge to where it was put (${(tip[0] + 8).toFixed(1)})`);
  ok(cellAt(drag, 40, 30) === 0, 'the hole stays a hole');
  // a point dragged across the curve: it crosses itself, the rewrite refuses
  const j2 = (k + Math.floor(outer.handles.length / 2)) % outer.handles.length;
  const bad = { loops: cv.loops.map((l) => (l === outer ? { ...l, handles: l.handles.map((h, i) => (i === k ? [outer.handles[j2][0] - 10, outer.handles[j2][1]] : h)) } : l)) };
  ok(T.rewriteFromCurves(g, bad) === null && T.curvesCross(bad), 'a curve dragged across itself refuses; the old paint stands');
  const near = T.nearestOnCurves(cv, tip[0] + 0.2, tip[1]);
  ok(near && near.d < 0.5 && (near.span === k || near.span === (k - 1 + outer.handles.length) % outer.handles.length), 'a click by the curve finds the span to add a point to');
}

// 17. points fitted by error: a notched stroke gets enough points that the curve stays within ~1 mm
//     of the paint's edge (12 fixed points cut across the notch)
{
  const g = T.newGrid(0, 0, 120, 60, 0.5);
  T.stampStroke(g, 10, 20, 100, 20, 9, 1); T.stampStroke(g, 55, 20, 55, 50, 7, 1);       // a T: a notch each side of the stem
  const fit = T.fitCurves(g, { tol: 1 }), n = fit.loops.reduce((a, l) => a + l.handles.length, 0);
  const back = T.rewriteFromCurves(g, fit);
  let worst = 0;
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const k = j * g.nx + i; if (back.data[k] === g.data[k]) continue;
    // how far this changed cell is from the paint's edge
    let d = 0; while (d < 20) { d++; let edge = false; for (let dj = -d; dj <= d && !edge; dj++) for (let di = -d; di <= d; di++) { const q = (j + dj) * g.nx + i + di; if (q >= 0 && q < g.data.length && g.data[q] !== g.data[k]) { edge = true; break; } } if (edge) break; }
    worst = Math.max(worst, d * g.res);
  }
  const crude = T.rewriteFromCurves(g, T.fitCurves(g, { count: 12 }));
  let lost = 0; for (let k = 0; k < g.data.length; k++) if (crude.data[k] !== g.data[k]) lost++;
  let lostFit = 0; for (let k = 0; k < g.data.length; k++) if (back.data[k] !== g.data[k]) lostFit++;
  ok(worst <= 1.5 && n > 12 && lostFit < lost / 2, `fitted by error: ${n} points, the edge within ${worst} mm of the paint (12 points change ${lost} cells, these ${lostFit})`);
  ok(T.roundProse(166.67) === 167 && T.roundProse(11.55) === 11.5 && T.roundProse(4.97) === 5, 'lengths in sentences are rounded: 167, 11.5, 5');
}

// 18. how far in the paint reaches (a bit wider than twice this cannot go round it)
{
  const g = T.newGrid(0, 0, 60, 40, 0.5); T.paintWhere(g, (x, y) => x > 10 && x < 50 && y > 10 && y < 20, 1);
  const r = T.insideReach(g);
  ok(Math.abs(r - 5) < 0.6, `a 10 mm wide strip reaches ${r.toFixed(2)} mm in from its edge`);
}

// 19. the part as a mesh with its marks applied: watertight both ways, the volume the marks take,
//     a pierce hole right through, STL and OBJ written whole
{
  const loops = [[[0, 0], [100, 0], [100, 60], [0, 60]], [[70, 20], [85, 20], [85, 40], [70, 40]]];
  const g = T.newGrid(-5, -5, 105, 65, 0.5); T.paintWhere(g, (x) => x < 50, 1);
  const tex = { region: T.storeRegion(g), xf: T.IDENTITY.slice(), fill: T.newFill('waves', { origin: [50, 30], depth: 2 }) };
  const g2 = T.newGrid(-5, -5, 105, 65, 0.5); T.paintWhere(g2, (x, y) => x > 55 && y < 50, 1);
  const hol = { region: T.storeRegion(g2), xf: T.IDENTITY.slice(), fill: T.newPierce('holes', { origin: [60, 10], params: { size: 8, spacing: 16, layout: 'grid' } }) };
  const solid = 100 * 60 * 12 - 15 * 20 * 12;
  const bare = T.meshCheck(T.partMesh({ loops, thickness: 12, marks: [], res: 0.5 }));
  ok(bare.watertight && Math.abs(bare.volume - solid) < 1, `the bare part: watertight, ${bare.volume.toFixed(0)} mm³ (a 100 x 60 x 12 board less a 15 x 20 hole is ${solid})`);
  for (const cut of [false, true]) {
    const M = T.partMesh({ loops, thickness: 12, marks: [tex, hol], res: 0.5, cut }), c = T.meshCheck(M);
    const holesVol = T.pierceCuts(hol, { thickness: 12, part: loops }).holes.reduce((a, h) => a + Math.PI * h.d * h.d / 4 * 12, 0);
    ok(c.watertight && c.volume < solid - holesVol * 0.8 && c.volume > solid - holesVol * 1.2 - 100 * 60 * 2, `${cut ? 'as cut' : 'as designed'}: watertight (${c.badEdges} bad edges of ${c.edges}), ${c.volume.toFixed(0)} mm³ left, ${M.triangles} triangles`);
    // a hole's middle is open right through: no top there
    const h0 = T.pierceCuts(hol, { thickness: 12, part: loops }).holes[0], P = M.positions;
    let over = 0; for (let i = 0; i < P.length; i += 3) if (Math.hypot(P[i] - h0.x, P[i + 1] - h0.y) < h0.d / 2 - 1 && P[i + 2] > 0.5) over++;
    ok(over === 0, `${cut ? 'as cut' : 'as designed'}: the holes go through`);
    if (!cut) {
      const stl = T.meshSTL(M), obj = T.meshOBJ(M);
      ok(stl.byteLength === 84 + 50 * M.triangles && new DataView(stl).getUint32(80, true) === M.triangles, `STL: ${stl.byteLength} bytes, ${M.triangles} triangles`);
      ok((obj.match(/^f /gm) || []).length === M.triangles && (obj.match(/^v /gm) || []).length === M.positions.length / 3, 'OBJ: every face and vertex');
    }
  }
  ok(T.partMeshSize([[[0, 0], [2440, 0], [2440, 1220], [0, 1220]]], T.autoMeshRes([[[0, 0], [2440, 0], [2440, 1220], [0, 1220]]])).triangles < 1.2e6, 'a 4 x 8 sheet by default stays near a million triangles');
  {
    const board = [[[0, 0], [152.4, 0], [152.4, 254], [0, 254]]], sz = T.partMeshSize(board, T.autoMeshRes(board));
    ok(sz.triangles * 50 / 1e6 <= 10.5, `a 6 x 10 in cutting board by default: ${(sz.triangles / 1000).toFixed(0)} thousand triangles, ${(sz.triangles * 50 / 1e6).toFixed(1)} MB as STL (at most about 10)`);
  }
}

// 20. no stair steps: every wall lies on the true outline (the part's polygon, a hole's circle, a
//     slot's sides), kerf grooves to a skin keep sharp walls, and the files carry normals
{
  const disc = []; for (let k = 0; k < 64; k++) { const a = k / 64 * 2 * Math.PI; disc.push([50 + 40 * Math.cos(a), 40 + 40 * Math.sin(a)]); }
  const loops = [disc];
  const g = T.newGrid(5, -5, 95, 85, 0.5); T.paintWhere(g, (x, y) => y > 40, 1);
  const kerf = { region: T.storeRegion(g), xf: T.IDENTITY.slice(), fill: T.newPierce('kerf', { origin: [50, 50], params: { radius: 80, skin: 3, bridge: 0, slot: 80 } }) };
  const g2 = T.newGrid(5, -5, 95, 85, 0.5); T.paintWhere(g2, (x, y) => y < 35, 1);
  const holes = { region: T.storeRegion(g2), xf: T.IDENTITY.slice(), fill: T.newPierce('holes', { origin: [50, 20], params: { size: 9, spacing: 15, layout: 'hex' } }) };
  const M = T.partMesh({ loops, thickness: 12, marks: [kerf, holes], res: 1 }), c = T.meshCheck(M);
  ok(c.watertight, `a disc with kerfs to a skin and holes through: watertight (${c.badEdges} bad of ${c.edges}), ${M.triangles} triangles`);
  // every wall vertex on the disc's polygon or on a hole's circle (no grid stairs)
  const H = T.pierceCuts(holes, { thickness: 12, part: loops }).holes;
  const onOutline = (x, y) => T.edgeDistance(loops, x, y) < 1e-4 || H.some((h) => Math.abs(Math.hypot(x - h.x, y - h.y) - h.d / 2) < 0.02);
  let off = 0, walls = 0;
  for (let t = 0; t < M.indices.length; t += 3) if (M.kinds[t / 3] === 1) for (let e = 0; e < 3; e++) { const v = M.indices[t + e]; walls++; if (!onOutline(M.positions[v * 3], M.positions[v * 3 + 1])) off++; }
  ok(walls > 0 && off === 0, `every wall corner lies on the true outline (${off} of ${walls} off it)`);
  // the kerf grooves: their floors at the skin (12 - 9 = 3 mm left), walls within a hair of vertical
  const K = T.pierceCuts(kerf, { thickness: 12, part: loops });
  let floorAt = Infinity;
  for (let t = 0; t < M.indices.length; t += 3) if (M.kinds[t / 3] === 0) for (let e = 0; e < 3; e++) { const v = M.indices[t + e], x = M.positions[v * 3], y = M.positions[v * 3 + 1], z = M.positions[v * 3 + 2]; if (K.slots.some((q) => T.edgeDistance([[q.a, q.b]], x, y) < K.width / 2 - 0.1)) floorAt = Math.min(floorAt, z); }
  ok(Math.abs(floorAt - 3) < 1e-3, `kerf grooves to the skin: their floor at ${floorAt.toFixed(3)} mm (3 mm of skin)`);
  const N = T.meshNormals(M);
  let up = 0, n = 0; for (let t = 0; t < M.indices.length; t += 3) if (M.kinds[t / 3] === 0) { n++; if (N.face[t + 2] > 0) up++; }
  ok(n && up === n, 'the top faces up');
  const obj = T.meshOBJ(M);
  ok((obj.match(/^vn /gm) || []).length === M.positions.length / 3 + (M.kinds.length - M.kinds.filter((k) => k === 0).length) && /^f \d+\/\/\d+/m.test(obj), 'OBJ: smooth normals on the top, one a face on the walls and the bottom');
  const glb = new DataView(T.meshGLB(M));
  const jl = glb.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb.buffer, 20, jl)));
  ok(glb.getUint32(0, true) === 0x46546c67 && glb.getUint32(8, true) === glb.byteLength && json.accessors[2].count === M.indices.length && json.meshes[0].primitives[0].attributes.NORMAL === 1, `GLB: ${glb.byteLength} bytes, ${json.accessors[0].count} vertices, ${json.accessors[2].count / 3} triangles, in meters, y up`);
}

// 40. defaults that make the pattern (Phil 11-01): line patterns default to a 90° V on their centerlines,
//     solid/pocket fills and surfaces to the 1/4 in ball; the finish moves the raster's stepover both ways;
//     memphis density thins the glyphs
{
  ok(T.suggestBit('memphis') === 'v90' && T.suggestBit('memphis', { fill: 'solid' }) === 'ball14' && T.suggestBit('knurl') === 'v90'
    && T.suggestBit('motif', { fill: 'pocket' }) === 'ball14' && T.suggestBit('quilt') === 'ball14' && T.newFill('memphis').tool === 'v90', 'each pattern\'s own default bit');
  const g = T.newGrid(0, 0, 40, 40, 0.5); T.paintWhere(g, () => true, 1);
  const so = fin => T.markToolpath({ id: 'f', region: g, xf: T.IDENTITY.slice(), fill: T.newFill('waves', { finish: fin }) }, { res: 0.5 }).stepover;
  const [a, b, c] = ['fine', 'standard', 'bold'].map(so);
  ok(a < b && b < c && c < 6.35 * 0.6, `finish: fine ${a.toFixed(2)} < standard ${b.toFixed(2)} < bold ${c.toFixed(2)} mm stepover, bold still under 60% of the ball`);
  const solid = T.markToolpath({ id: 's', region: g, xf: T.IDENTITY.slice(), fill: T.newFill('memphis', { tool: 'v90', params: { ...T.defaults('memphis'), fill: 'solid' } }) }, { res: 0.5 });
  ok(solid.strategy !== 'centerline', `solid memphis with a V rasters (${solid.strategy}): a centerline never clears the shapes`);
  const n = den => T.markToolpath({ id: 'd', region: g, xf: T.IDENTITY.slice(), fill: T.newFill('memphis', { params: { ...T.defaults('memphis'), density: den } }) }, { res: 0.5 }).moves.length;
  ok(n(30) < n(100) * 0.6, `memphis density 30% cuts fewer moves (${n(30)} vs ${n(100)})`);
}

// 41. shaping (Phil 11-01: invert, falloffs, border bands, "lots of mixing and remixing"): relief up turns
//     the pattern over, the floor sinks the mark, each border has its section, beads sit pitch apart, and
//     the toolpath cuts what the field says (a raster, never below the deepest part)
{
  const mask = { type: 'rect', x0: 0, y0: 0, x1: 100, y1: 60 };
  const tx = (shape, soft = 0) => T.texture({ pattern: 'ribs', params: { depth: 2 }, mask, soft, shape });
  const base = tx({}), up = tx({ relief: 'up' }), fl = tx({ floor: 1.5 });
  let inv = true, add = true;
  for (let x = 10; x < 90; x += 0.7) { const y = 30, h = base.h(x, y); if (Math.abs(up.h(x, y) - (2 - h)) > 1e-9) inv = false; if (Math.abs(fl.h(x, y) - (1.5 + h)) > 1e-9) add = false; }
  ok(inv && add && up.kind === 'surface' && fl.depth === 3.5, 'relief up = depth − h, the floor adds to h; both rasters; depth counts the floor');
  const B = st => tx({ border: { style: st, width: 6, depth: 2 } });
  ok(B('groove').h(3, 30) === 2 && B('bead').h(3, 30) === 0 && B('step').h(1, 30) === 2 && B('rim').h(3, 30) === 0 && Math.abs(B('chamfer').h(1.5, 30) - 1.5) < 1e-9,
    'border sections: a groove deepest mid-band, a bead at the top mid-band, a step all down, a rim untouched, a chamfer a ramp');
  ok(Math.abs(B('groove').h(20, 30) - base.h(20, 30)) < 1e-9 && tx({ border: { style: 'step', width: 6, depth: 2, inset: 4 } }).h(2, 30) === 0, 'inside the band the pattern is as it was; an inset leaves the top before the band');
  const bd = tx({ border: { style: 'beads', width: 6, depth: 2, pitch: 8 } });
  let tops = 0; for (let x = 4; x < 96; x += 0.25) if (bd.h(x, 3) < 0.02 && bd.h(x - 0.25, 3) >= 0.02) tops++;
  ok(tops >= 10 && tops <= 13, `a row of beads along the bottom edge, 8 mm apart: ${tops} tops across 92 mm`);
  ok(Math.abs(T.CURVES.round(0.5) - Math.sqrt(0.75)) < 1e-9 && T.CURVES.cove(0.5) < 0.5 && T.CURVES.straight(0.3) === 0.3, 'falloff curves: round steep at the edge, cove gentle');
  // painted short of the grid's own sides: a paint mask's edge is where the paint stops
  const g = T.newGrid(0, 0, 60, 40, 0.5); T.paintWhere(g, (x, y) => x > 5 && x < 55 && y > 5 && y < 35, 1);
  const tp = T.markToolpath({ id: 'b', region: g, xf: T.IDENTITY.slice(), fill: T.newFill('ribs', { tool: 'ball18', border: { style: 'step', width: 6, depth: 3 }, relief: 'up' }) }, { res: 0.5 });
  const lo = Math.min(...tp.moves.filter((m) => !m.rapid).map((m) => m.z));
  ok(tp.strategy === 'raster' && lo < -2.9 && lo > -3.01, `a shaped mark rasters (${tp.strategy}) to the border's 3 mm (lowest ${lo.toFixed(2)})`);
}

// 42. the TEX recipe (Phil 11-01: textures out to Unreason): a mark's recipe survives JSON, draws the same
//     texture from the file alone, its check matches this core, a changed number is caught by the check,
//     and an unknown pattern version is refused by name
{
  const g = T.newGrid(0, 0, 100, 60, 0.5); T.paintWhere(g, (x, y) => x > 5 && x < 95 && y > 5 && y < 55, 1);
  const mark = { id: 'r', region: T.storeRegion(g), xf: T.IDENTITY.slice(), fill: T.newFill('ribs', { angle: 20, fade: 4, relief: 'up', border: { style: 'bead', width: 5, depth: 1.5 } }) };
  const r = JSON.parse(JSON.stringify(T.recipeOf(mark)));
  ok(r.format === 'tex-recipe' && r.version === 1 && r.check.grid.length === 64 && r.check.grid.some((s) => s[2] > 0.1) && r.making.finish === 'standard', `a recipe with 64 check depths (deepest ${Math.max(...r.check.grid.map((s) => s[2])).toFixed(3)} mm)`);
  const a = T.markTexture(mark), b = T.textureOfRecipe(r);
  let same = true; for (let x = 0; x <= 100; x += 1.7) for (let y = 0; y <= 60; y += 2.3) if (Math.abs(a.h(x, y) - b.h(x, y)) > 1e-12) same = false;
  ok(same, 'the recipe alone draws the mark\'s texture, everywhere');
  ok(T.verifyRecipe(r, b.h).ok && /matches swarf-tex-core/.test(T.verifyRecipe(r, b.h).said), 'its own check matches');
  const r2 = JSON.parse(JSON.stringify(r)); r2.params.pitch = 9;
  const v = T.verifyRecipe(r, T.textureOfRecipe(r2).h);
  ok(!v.ok && v.off > 10, `a reader with another spacing is caught: ${v.said}`);
  ok(/version 7/.test(T.recipeRefusal({ ...r, patternVersion: 7 })) && /not one this core draws/.test(T.recipeRefusal({ ...r, pattern: 'plaid' })), 'an unknown pattern version or pattern is refused by name');
}

// 43. reaction-diffusion (Phil 11-01: "strong reaction|diffusion patterns", one slider from starting to full,
//     the other detail): every style grows a strong two-level pattern, growth spreads it from the seeds over
//     the area, detail scales it, a re-ask is cached; and typed values may pass the slider to plausible ends
{
  const cover = (p) => { const t = T.texture({ pattern: 'reaction', params: { ...T.defaults('reaction'), ...p } }); let n = 0, lo = 0, hi = 0;
    for (let j = 0; j < 80; j++) for (let i = 0; i < 80; i++) { const h = t.h(i * 1.3, j * 1.3) / t.depth; if (h > 0.5) n++; if (h < 0.1) lo++; if (h > 0.9) hi++; }
    return { cut: n / 6400, two: (lo + hi) / 6400 }; };
  const styles = Object.keys(T.RD_STYLES), full = styles.map((style) => cover({ style }));
  ok(full.every((c) => c.cut > 0.15 && c.cut < 0.9 && c.two > 0.6), `every style a strong pattern: cut ${full.map((c) => c.cut.toFixed(2))}, at top or floor ${full.map((c) => c.two.toFixed(2))}`);
  const g0 = cover({ style: 'maze', growth: 0 }).cut, g1 = cover({ style: 'maze', growth: 100 }).cut;
  ok(g0 < g1 * 0.4, `growth spreads it: ${(g0 * 100).toFixed(0)}% cut at 0, ${(g1 * 100).toFixed(0)}% at 100`);
  const t0 = Date.now(); T.texture({ pattern: 'reaction', params: { ...T.defaults('reaction'), growth: 37 } }).h(1, 1);
  ok(Date.now() - t0 < 50, `a growth change after the first run is quick (${Date.now() - t0} ms)`);
  const a = T.texture({ pattern: 'reaction', params: { ...T.defaults('reaction'), size: 5 } }), b = T.texture({ pattern: 'reaction', params: { ...T.defaults('reaction'), size: 10 } });
  let same = true; for (let k = 0; k < 40; k++) if (Math.abs(a.h(k * 0.7, k * 0.3) - b.h(k * 1.4, k * 0.6)) > 1e-9) same = false;
  ok(same, 'detail scales the same pattern (twice the detail, twice the size)');
  const q = (pat, k) => T.PATTERNS[pat].params.find((x) => x.k === k);
  const [lo, hi] = T.typedRange(q('ribs', 'pitch')), [plo, phi] = T.typedRange(q('reaction', 'growth')), [alo, ahi] = T.typedRange(q('quilt', 'angle'));
  ok(lo < q('ribs', 'pitch').min && hi > q('ribs', 'pitch').max && plo === 0 && phi === 100 && alo === -360 && ahi === 360, `typed past the slider: flute spacing ${lo}–${hi} mm (slider ${q('ribs', 'pitch').min}–${q('ribs', 'pitch').max}), growth 0–100%, angles a turn either way`);
  ok(T.suggestBit('reaction', { size: 7 }) === 'ball18' && T.suggestBit('reaction', { size: 14 }) === 'ball14', 'reaction suggests the 1/8 in ball for fine detail');
}

// 44. blobtex (Phil 11-01: "random size and place circles that iso merge into each other ... a positive or
//     negative puff ... based on the span of the area"): dish carves blobs, pillow raises them, merge fattens
//     and fuses them, density thins them, a wide blob puffs deeper than a small one, and the same seed is
//     the same blobs
{
  const B = (p) => T.texture({ pattern: 'blob', params: { ...T.defaults('blob'), ...p } });
  const scan = (t) => { let inside = 0, deep = 0; for (let j = 0; j < 90; j++) for (let i = 0; i < 90; i++) { const h = t.h(i * 1.1, j * 1.1) / t.depth; if (h > 0.01) inside++; if (h > 0.95) deep++; } return { inside: inside / 8100, deep: deep / 8100 }; };
  const dish = scan(B({})), pillow = B({ puff: 'pillow' }), d0 = B({});
  let mirror = true; for (let k = 0; k < 60; k++) { const u = k * 1.7, v = k * 0.9; if (Math.abs(d0.h(u, v) + pillow.h(u, v) - d0.depth) > 1e-9) mirror = false; }
  ok(dish.inside > 0.15 && dish.inside < 0.85 && mirror, `dish carves ${(dish.inside * 100).toFixed(0)}% of the area; pillow is the same blobs raised`);
  const m0 = scan(B({ merge: 0 })).inside, m1 = scan(B({ merge: 1 })).inside, sparse = scan(B({ density: 25 })).inside;
  ok(m1 > m0 * 1.3 && sparse < dish.inside * 0.7, `merge fattens (${(m0 * 100).toFixed(0)}% → ${(m1 * 100).toFixed(0)}%), density thins (${(sparse * 100).toFixed(0)}%)`);
  const wide = scan(B({ span: 4 })).deep, narrow = scan(B({ span: 20 })).deep;
  ok(wide > narrow * 2, `the puff follows the span: ${(wide * 100).toFixed(0)}% at full depth with a 4 mm span, ${(narrow * 100).toFixed(0)}% with 20 mm (only the widest areas)`);
  const a = B({ seed: 9 }), b = B({ seed: 9 }), c = B({ seed: 10 });
  let same = true, diff = false; for (let k = 0; k < 80; k++) { const u = k * 1.3, v = k * 2.1; if (a.h(u, v) !== b.h(u, v)) same = false; if (a.h(u, v) !== c.h(u, v)) diff = true; }
  ok(same && diff, 'the same seed draws the same blobs; another seed others');
}

console.log(`\n${pass} passed, ${fail} failed  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
