// Separate the parts (Phil 11-16: "if multiple parts come in together, for instance as an stl, allow
// a right click to ungroup these parts so they can be selected and worked on and deleted separately").
//   - one STL of four solids (two boxes, a ring and a block sitting inside the ring) comes in as one
//     part; the import says it holds 4 solids; a right-click lists "separate the parts"; pressing it
//     makes 4 parts, each where it sat (the footprint is unchanged), named -1 .. -4
//   - each piece can be picked alone and deleted alone; one undo puts the deleted piece back, the
//     next puts the one part back, redo makes the pieces again
//   - a hollow box (an outer shell and an inside-out inner shell) is one solid: no row
//   - a single box: no row
//   - parts grouped on import (two OBJ objects, "group objects?" yes): the row ungroups them, and
//     afterwards one moves without the other; undo groups them again
//   node tools/probe_separate.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };

// ── fixtures: ASCII STL of axis boxes; a box turned inside out is a hollow ──
function boxTris(x0, y0, z0, x1, y1, z1, flip = false) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return f.map(t => (flip ? [t[0], t[2], t[1]] : t).map(i => v[i]));
}
// a square ring: four boxes sharing corners would weld into one solid, so it is one closed shell
// made of an outer box and an inner box turned inside out, joined top and bottom
function ringTris(cx, cy, R, r, h) {
  const out = [];
  const o = [[cx - R, cy - R], [cx + R, cy - R], [cx + R, cy + R], [cx - R, cy + R]];
  const i = [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
  for (let k = 0; k < 4; k++) {
    const a = o[k], b = o[(k + 1) % 4], c = i[k], d = i[(k + 1) % 4];
    out.push([[...a, 0], [...b, 0], [...b, h]], [[...a, 0], [...b, h], [...a, h]]);     // outer wall
    out.push([[...c, 0], [...d, h], [...d, 0]], [[...c, 0], [...c, h], [...d, h]]);     // inner wall
    out.push([[...a, h], [...b, h], [...d, h]], [[...a, h], [...d, h], [...c, h]]);     // top
    out.push([[...a, 0], [...d, 0], [...b, 0]], [[...a, 0], [...c, 0], [...d, 0]]);     // bottom
  }
  return out;
}
const stl = (name, tris) => `solid ${name}\n` + tris.map(t => ` facet normal 0 0 0\n  outer loop\n${t.map(p => `   vertex ${p.join(' ')}`).join('\n')}\n  endloop\n endfacet`).join('\n') + `\nendsolid ${name}\n`;
const FOUR_SOLIDS = stl('three', [...boxTris(0, 0, 0, 40, 30, 12), ...boxTris(60, 0, 0, 90, 50, 12), ...ringTris(150, 25, 25, 15, 12), ...boxTris(140, 15, 0, 160, 35, 12)]);
const HOLLOW = stl('hollow', [...boxTris(0, 0, 0, 60, 60, 20), ...boxTris(10, 10, 5, 50, 50, 15, true)]);
const ONE = stl('one', boxTris(0, 0, 0, 50, 50, 10));
const OBJ2 = ['o first', 'v 0 0 0', 'v 40 0 0', 'v 40 0 40', 'f 1 2 3', 'o second', 'v 60 0 0', 'v 100 0 0', 'v 100 0 40', 'f 4 5 6'].join('\n');

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-separate-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_files && window.__swarfMenu && window.kiri.api.selection.separate), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  // alerts said, kept to read back
  await page.evaluate(() => { const a = window.kiri.api, was = a.show.alert; window.__said = []; a.show.alert = function (t) { window.__said.push(String(t)); return was.apply(this, arguments); }; });
  const load = (text, name) => page.evaluate((text, name) => { const a = window.kiri.api; a.platform.clear(); window.__said = []; a.platform.load_files([new File([text], name)]); }, text, name).then(() => wait(2500));
  const parts = () => page.evaluate(() => window.kiri.api.widgets.all().map(w => {
    const b = new window.THREE.Box3().setFromObject(w.mesh);
    return { name: w.meta.file, id: w.id, min: [b.min.x, b.min.z].map(v => +v.toFixed(2)), max: [b.max.x, b.max.z].map(v => +v.toFixed(2)), group: w.group.length };
  }));
  const foot = ps => [Math.min(...ps.map(p => p.min[0])), Math.min(...ps.map(p => p.min[1])), Math.max(...ps.map(p => p.max[0])), Math.max(...ps.map(p => p.max[1]))].map(v => +v.toFixed(2));
  const screenOf = idx => page.evaluate(i => {
    const THREE = window.THREE, w = window.kiri.api.widgets.all()[i], { camera, renderer } = window.moto.space.internals();
    const b = new THREE.Box3().setFromObject(w.mesh), c = b.getCenter(new THREE.Vector3()); c.y = b.max.y; c.project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    return { x: r.left + (c.x + 1) / 2 * r.width, y: r.top + (1 - c.y) / 2 * r.height };
  }, idx);
  const rightClick = async (x, y) => { await page.mouse.move(x, y); await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' }); await wait(400); };
  const rows = () => page.evaluate(() => window.__swarfMenu.rows());
  const closeMenu = () => page.keyboard.press('Escape').then(() => wait(200));
  const press = async label => {
    const r = await page.evaluate(l => { const b = [...document.querySelectorAll('.swarf-ctx button')].find(b => b.textContent === l); if (!b) return null; const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2, title: b.title }; }, label);
    if (!r) return null;
    await page.mouse.click(r.x, r.y); await wait(900); return r;
  };
  const top = () => page.evaluate(() => { window.kiri.api.platform.deselect?.(); window.moto.space.view.top(); }).then(() => wait(1200));
  const undo = () => page.evaluate(() => window.kiri.api.doit.undo()).then(() => wait(500));
  const redo = () => page.evaluate(() => window.kiri.api.doit.redo()).then(() => wait(500));

  // ── one STL, four solids ──
  await load(FOUR_SOLIDS, 'four.stl');
  let p0 = await parts();
  check(p0.length === 1, `the STL comes in as one part (${p0.length})`);
  const said0 = await page.evaluate(() => window.__said.join(' | '));
  check(/holds 4 separate solids/.test(said0) && /separate the parts/.test(said0), `the import says it holds 4 solids and how to separate them (${said0.slice(0, 160)})`);
  await top();
  let at = await screenOf(0);
  await rightClick(at.x, at.y);
  let r = await rows();
  console.log('   rows:', r.join(' · '));
  check(r.includes('separate the parts'), 'a right-click lists separate the parts');
  // a hand tab on the far box's outline, and a pocket step with a floor picked on the ring: both
  // must land on their own piece after
  await page.evaluate(() => {
    const a = window.kiri.api, w = a.widgets.all()[0], arr = w.getGeoVertices({ unroll: true });
    // the mesh is centred on the file's 175 x 50 footprint: the second box (file x 60..90) spans
    // x -27.5..2.5 here; a tab half a mm inside its +x side
    w.anno = w.anno || {};
    w.anno.tab = [{ id: 1, pos: { x: 2.0, y: 0, z: 3 }, dim: { x: 6, y: 6, z: 3 }, rot: [0, 0, 0, 1] }];
    // a triangle on the ring's top (x 37.5..87.5 here, z 12) that is not the block's top (52.5..72.5)
    let ringTop = -1;
    for (let t = 0; t < arr.length / 9 && ringTop < 0; t++) {
      const o = t * 9, xs = [arr[o], arr[o + 3], arr[o + 6]], zs = [arr[o + 2], arr[o + 5], arr[o + 8]];
      if (zs.every(z => z > 11.9) && Math.min(...xs) >= 37.49 && Math.max(...xs) <= 87.51 && !xs.every(x => x >= 52.49 && x <= 72.51)) ringTop = t;
    }
    window.__ringTop = ringTop;
    a.conf.get().process.ops = [{ type: 'pocket', surfaces: { [w.id]: [ringTop] } }];
    window.__farTabX = w.anno.tab[0].pos.x;
  });
  const tip = await press('separate the parts');
  check(tip && tip.title && tip.title.split(/\s+/).length <= 12, `its tooltip is under twelve words (${tip && tip.title})`);
  let p1 = await parts();
  console.log('   pieces:', JSON.stringify(p1.map(p => [p.name, p.min, p.max])));
  check(p1.length === 4, `four parts now (${p1.length})`);
  check(JSON.stringify(foot(p1)) === JSON.stringify(foot(p0)), `together they sit where the one part sat (${foot(p0)} vs ${foot(p1)})`);
  check(p1.map(p => p.name).sort().join() === 'four-1,four-2,four-3,four-4', `named four-1..4 (${p1.map(p => p.name)})`);
  check(p1.every(p => p.group === 1), 'each moves on its own (a group of one)');
  const sizes = p1.map(p => [p.max[0] - p.min[0], p.max[1] - p.min[1]].map(v => Math.round(v)).join('x')).sort();
  check(sizes.join() === '20x20,30x50,40x30,50x50', `the pieces are the two boxes, the ring and the block inside it (${sizes})`);
  const carried = await page.evaluate(() => {
    const a = window.kiri.api, ws = a.widgets.all(), op = a.conf.get().process.ops[0];
    const withTab = ws.filter(w => w.anno && (w.anno.tab || []).length).map(w => { const b = new window.THREE.Box3().setFromObject(w.mesh); return { name: w.meta.file, wide: Math.round(b.max.x - b.min.x), tabx: w.anno.tab[0].pos.x, halfw: (b.max.x - b.min.x) / 2 }; });
    const floors = ws.filter(w => (op.surfaces[w.id] || []).length).map(w => { const b = new window.THREE.Box3().setFromObject(w.mesh); const arr = w.getGeoVertices({ unroll: true }), t = op.surfaces[w.id][0] * 9; return { wide: Math.round(b.max.x - b.min.x), top: [arr[t + 2], arr[t + 5], arr[t + 8]].every(z => z > 11.9) }; });
    return { withTab, floors };
  });
  console.log('   carried:', JSON.stringify(carried));
  check(carried.withTab.length === 1 && carried.withTab[0].wide === 30 && Math.abs(carried.withTab[0].tabx - (carried.withTab[0].halfw - 0.5)) < 0.01, 'the tab goes to the far box, on its edge');
  check(carried.floors.length === 1 && carried.floors[0].wide === 50 && carried.floors[0].top, 'the picked floor goes to the ring, the same triangle');
  const said1 = await page.evaluate(() => window.__said.slice(-1)[0] || '');
  check(/is now 4 parts/.test(said1), `it says so (${said1})`);

  const solidsIn = await page.evaluate(() => window.kiri.api.widgets.all().reduce((n, w) => n + window.kiri.api.selection.pieces(w).length, 0));
  check(solidsIn === 4, `each piece is one solid now (${solidsIn})`);

  // one undo: the one part where it was; redo: the four again
  await undo();
  let pu = await parts();
  check(pu.length === 1 && pu[0].name === 'four.stl' && JSON.stringify(foot(pu)) === JSON.stringify(foot(p0)), `undo: the one part, where it was (${pu.map(p => p.name)})`);
  await redo();
  check((await parts()).length === 4, 'redo: four parts again');

  // pick one alone, delete it alone; undo brings it back; undo again is the one part; redo the three
  await top();
  const ring = (await parts()).findIndex(p => Math.round(p.max[0] - p.min[0]) === 50 && Math.round(p.max[1] - p.min[1]) === 50);
  at = await screenOf(ring);
  await rightClick(at.x, at.y);
  r = await rows();
  check(!r.includes('separate the parts'), 'a piece of one solid has no separate row');
  const picked = await page.evaluate(() => window.kiri.api.selection.widgets().map(w => w.meta.file));
  check(picked.length === 1, `a right-click picks that piece alone (${picked})`);
  await press('delete');
  let p2 = await parts();
  check(p2.length === 3 && !p2.some(p => p.name === picked[0]), `delete takes only that piece (${p2.map(p => p.name)})`);
  await undo();
  check((await parts()).length === 4, 'undo brings the piece back');

  // ── a hollow box is one solid ──
  await load(HOLLOW, 'hollow.stl');
  await top();
  at = await screenOf(0);
  await rightClick(at.x, at.y);
  r = await rows();
  check(!r.includes('separate the parts'), 'a hollow box (inner shell inside out) has no separate row');
  check(!/separate solids/.test(await page.evaluate(() => window.__said.join(' | '))), 'and the import says nothing about solids');
  await closeMenu();

  // ── one box ──
  await load(ONE, 'one.stl');
  await top();
  at = await screenOf(0);
  await rightClick(at.x, at.y);
  check(!(await rows()).includes('separate the parts'), 'one box has no separate row');
  await closeMenu();

  // ── parts that move as one (a group, as a file's objects come in when grouped) ──
  await page.evaluate((t1, t2) => { const a = window.kiri.api; a.platform.clear(); a.platform.load_files([new File([t1], 'g1.stl'), new File([t2], 'g2.stl')]); }, stl('g1', boxTris(0, 0, 0, 40, 40, 10)), stl('g2', boxTris(0, 0, 0, 30, 30, 10)));
  await wait(2500);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.deselect(); for (const w of a.widgets.all()) a.platform.select(w, true); a.group.merge(); a.platform.deselect(); });
  await wait(500);
  let g0 = await parts();
  check(g0.length === 2 && g0.every(p => p.group === 2), `two parts move as one (${JSON.stringify(g0.map(p => p.group))})`);
  await top();
  at = await screenOf(0);
  await rightClick(at.x, at.y);
  r = await rows();
  check(r.includes('separate the parts'), 'a grouped part lists separate the parts');
  await press('separate the parts');
  let g1 = await parts();
  check(g1.every(p => p.group === 1), 'after: each is its own');
  const moved = await page.evaluate(() => { const a = window.kiri.api, [w0, w1] = a.widgets.all(); const x1 = w1.track.pos.x; w0.move(5, 0, 0); return w1.track.pos.x === x1; });
  check(moved, 'moving one leaves the other where it was');
  // turned alone, it turns about itself: its footprint's centre stays put
  const turned = await page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all()[1], c = () => { const b = new window.THREE.Box3().setFromObject(w.mesh); return [(b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2]; }; const before = c(); a.platform.deselect(); a.platform.select(w, false); a.selection.rotate(0, 0, Math.PI / 2); const after = c(); return Math.hypot(before[0] - after[0], before[1] - after[1]); });
  check(turned < 0.01, `a part from the group turns about itself (moved ${turned.toFixed(3)} mm)`);
  await undo();
  await undo();
  check((await parts()).every(p => p.group === 2), 'undo groups them again');

  // ── speed: a big mesh is counted fast enough for a right-click ──
  const ms = await page.evaluate(() => {
    const a = window.kiri.api, n = 200000, v = new Float32Array(n * 9);
    for (let t = 0; t < n; t++) { const x = (t % 1000) * 0.1, y = Math.floor(t / 1000) * 0.1; v.set([x, y, 0, x + 0.1, y, 0, x, y + 0.1, 0], t * 9); }
    const w = a.widgets.new().loadVertices(v);
    const t0 = performance.now(); a.selection.pieces(w); return Math.round(performance.now() - t0);
  });
  console.log(`   200k triangles counted in ${ms} ms`);
  check(ms < 3000, `a 200k-triangle mesh is counted in under 3 s (${ms} ms)`);

  check(!errors.length, `no page errors (${errors.slice(0, 3).join(' | ')})`);
} finally {
  await browser.close();
}
console.log(bad.length ? `\n${bad.length} FAILED` : '\nPASS');
process.exit(bad.length ? 1 : 0);
