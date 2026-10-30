// TEX's core in node (web/kiri/swarf-tex-core.mjs): every pattern within its depth, the drop cutter
// never below the design, the scallop stepover, one plunge per dot, Morse SOS read back, the plain
// warnings; then the marks: a painted region kept as runs, a mark turned and scaled with its part,
// its moves never below its depth or the board, and room left for a pierce fill.
//   node tools/test-tex-core.mjs
import * as T from '../web/kiri/swarf-tex-core.mjs';

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
  ok(T.markTexture({ region: reg, fill: { fill: 'pierce', pattern: 'kerf' } }) === null && T.markToolpath({ region: reg, fill: { fill: 'pierce' } }).moves.length === 0, 'a pierce fill is left to a later step');
  const empty = T.newGrid(0, 0, 10, 10, 0.5);
  ok(T.markTexture({ region: T.storeRegion(empty), fill: T.newFill('waves') }) === null, 'an empty region has no texture');
}

console.log(`\n${pass} passed, ${fail} failed  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
