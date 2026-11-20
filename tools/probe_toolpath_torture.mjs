// Toolpath torture: many parts (the shape library's, SVGs with holes and islands, STLs from disk and
// generated reliefs) x steps (outline in and out, rough, pocket, contour, drill) x bits (1/16 to 1/2,
// ball, V) x tabs (none, auto, auto at most). Each case makes its toolpaths and its file, and the
// file is read the way control reads it:
//   made: no error, in time; the file has moves; no NaN
//   no rapid sideways below the top of the board; the router never off in the wood
//   no deeper than the board and a little (2 mm), no higher than 60 mm
//   the cut no wider than the part and two bits (the bit's path around a sharp corner) and a little
//   an outline or rough that frees the part: reaches the bottom; with tabs it lifts at least once per tab
//   contour rings: from the edge in, clockwise (climb)
// A case whose part a bit cannot cut (a 2 mm wall, a 1/2 in bit in an 8 mm circle) must still make a
// file or say why; a hang, an error or a dangerous file fails.
//   node tools/probe_toolpath_torture.mjs [url] [filter]     (STL=path,... adds files; OUT=dir keeps files)
import puppeteer from 'puppeteer-core';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const P = createRequire(import.meta.url)('../web/kiri/swarf-run-parse.js');
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const FILTER = process.argv[3] ? new RegExp(process.argv[3]) : null;
const OUT = process.env.OUT || '';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], rows = [], errors = [];
const check = (ok, what, info) => { if (!ok) { console.log('FAIL', what, info !== undefined ? JSON.stringify(info) : ''); bad.push(what); } return ok; };

// ---- parts -------------------------------------------------------------------------------------
const tmp = mkdtempSync(join(tmpdir(), 'swarf-torture-'));
const circ = (x, y, d) => `M${x - d / 2} ${y}a${d / 2} ${d / 2} 0 1 0 ${d} 0a${d / 2} ${d / 2} 0 1 0 ${-d} 0Z`;
const svgDoc = (w, h, d) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}"><path fill-rule="evenodd" d="${d}"/></svg>`;
// a plate with a grid of holes (drill, pocket, loose pieces)
const holes = (() => { let d = 'M0 0H160V100H0Z'; for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) d += circ(20 + i * 24, 22 + j * 28, [6.35, 10, 16][j]); return svgDoc(160, 100, d); })();
// a frame with an island in its hole (the island is a part of its own, cut free)
const nested = svgDoc(140, 140, 'M0 0H140V140H0ZM20 20V120H120V20Z' + 'M45 45H95V95H45Z');
// a comb: fingers 3, 6 and 9 mm wide with 3, 6, 9 mm gaps (narrower than some bits)
const comb = (() => { let d = 'M0 0H120V20H0Z'; let x = 2; for (const w of [3, 6, 9, 3, 6, 9]) { d += `M${x} 20H${x + w}V70H${x}Z`; x += w * 2 + 4; } return svgDoc(120, 70, d); })();

// a binary STL from triangles
function stl(tris) {
  const b = Buffer.alloc(84 + tris.length * 50); b.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => { const o = 84 + i * 50 + 12; t.forEach((v, k) => b.writeFloatLE(v, o + k * 4)); });
  return b;
}
// a closed heightfield solid: z = f(x, y) on top, flat bottom, walls
function relief(w, h, nx, ny, f) {
  const T = [], X = i => i * w / nx, Y = j => j * h / ny, Z = (i, j) => f(X(i), Y(j));
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const a = [X(i), Y(j), Z(i, j)], b = [X(i + 1), Y(j), Z(i + 1, j)], c = [X(i + 1), Y(j + 1), Z(i + 1, j + 1)], d = [X(i), Y(j + 1), Z(i, j + 1)];
    T.push([...a, ...b, ...c], [...a, ...c, ...d]);
    const A = [X(i), Y(j), 0], B = [X(i + 1), Y(j), 0], C = [X(i + 1), Y(j + 1), 0], D = [X(i), Y(j + 1), 0];
    T.push([...A, ...C, ...B], [...A, ...D, ...C]);
  }
  const wall = (p, q, zp, zq) => { T.push([...p, 0, ...q, 0, ...q, zq], [...p, 0, ...q, zq, ...p, zp]); };
  for (let i = 0; i < nx; i++) { wall([X(i + 1), 0], [X(i), 0], Z(i + 1, 0), Z(i, 0)); wall([X(i), h], [X(i + 1), h], Z(i, ny), Z(i + 1, ny)); }
  for (let j = 0; j < ny; j++) { wall([0, Y(j)], [0, Y(j + 1)], Z(0, j), Z(0, j + 1)); wall([w, Y(j + 1)], [w, Y(j)], Z(nx, j + 1), Z(nx, j)); }
  return stl(T);
}
const gen = {
  'waves-relief.stl': relief(120, 80, 120, 80, (x, y) => 8 + 4 * Math.sin(x / 7) * Math.cos(y / 9)),
  'dome.stl': relief(90, 90, 90, 90, (x, y) => { const r = Math.hypot(x - 45, y - 45); return 3 + (r < 40 ? Math.sqrt(40 * 40 - r * r) / 2 : 0); }),
  // a sign-sized relief: the patterns' resolution has to follow the part's size
  'panel-relief.stl': relief(500, 350, 250, 175, (x, y) => 10 + 6 * Math.sin(x / 30) * Math.cos(y / 25)),
};
for (const [n, b] of Object.entries(gen)) writeFileSync(join(tmp, n), b);
const H = homedir();
const disk = [
  ...Object.keys(gen).map(n => join(tmp, n)),
  `${H}/Documents/claude/swarf/swarf-local/swarf-app/obj/pocket-test.stl`,
  `${H}/Documents/antigravity/torc/quality/production-envelope/stls/trial-03-custom-signet.stl`,
  `${H}/Documents/claude/openvcad_eval/fixtures/whole_insole.stl`,
  `${H}/Desktop/Deform09.stl`,
  ...(process.env.STL ? process.env.STL.split(',') : []),
].filter(p => existsSync(p));

// ---- cases -------------------------------------------------------------------------------------
const T = { e116: 1002, e18: 1001, e14: 1000, e12: 1010, b18: 1004, b14: 1018, v90: 1105, drill14: 1006 };
const cases = [];
const add = (name, part, ops, o = {}) => cases.push({ name, part, ops, dir: o.dir, cover: o.cover, like: o.like, liftsLike: o.liftsLike, tabs: o.tabs || 'none', thick: o.thick, device: o.device || 'ShopBot.Basic', material: o.material || 'plywood', expectFree: o.expectFree ?? ops.some(q => (q.type === 'outline' && !q.inside) || q.type === 'rough') });
const shapes = {
  ring: ['ring', { d: 85.6, di: 70 }], star: ['star', { d: 100, p: 5, i: 44 }], rounded: ['rounded', { w: 150, h: 100, r: 10 }],
  tiny: ['circle', { d: 8 }], slot: ['slot', { w: 60, h: 5 }], big: ['rect', { w: 1200, h: 600 }], tri: ['polygon', { d: 40, n: 3 }],
  thinring: ['ring', { d: 50, di: 46 }],
};
for (const [k, [kind, v]] of Object.entries(shapes)) {
  const part = { shape: kind, v };
  for (const bit of ['e116', 'e18', 'e14', 'e12']) add(`${k} outline ${bit}`, part, [{ type: 'outline', tool: T[bit] }], { tabs: bit === 'e14' ? 'auto' : 'none' });
  for (const tabs of ['none', 'auto', 'most']) add(`${k} rough e14 tabs:${tabs}`, part, [{ type: 'rough', tool: T.e14 }], { tabs });
  add(`${k} outline inside e18 + outline e14 tabs`, part, [{ type: 'outline', tool: T.e18, inside: true }, { type: 'outline', tool: T.e14 }], { tabs: 'auto' });
  add(`${k} outline v90`, part, [{ type: 'outline', tool: T.v90 }]);
  add(`${k} outline b14 thin 6mm`, part, [{ type: 'outline', tool: T.b14 }], { thick: 6, tabs: 'auto' });
}
// edges shaped on the shape card (points between the top and the bottom: the tabs go on the silhouette)
for (const edge of ['chamfer', 'round']) for (const [k, kind, v] of [['rounded', 'rounded', { w: 150, h: 100, r: 10 }], ['ring', 'ring', { d: 85.6, di: 50 }], ['star', 'star', { d: 100, p: 5, i: 60 }]]) {
  add(`${k} ${edge} edge outline e14 tabs`, { shape: kind, v, edge: { kind: edge, size: 4 } }, [{ type: 'outline', tool: T.e14 }], { tabs: 'auto' });
  add(`${k} ${edge} edge rough e12 tabs:most`, { shape: kind, v, edge: { kind: edge, size: 4 } }, [{ type: 'rough', tool: T.e12 }], { tabs: 'most' });
}
// the step a shaped edge asks for (concerns › add contour): contour, then the outline that cuts it out
for (const [w, set] of [['lines', {}], ['perimeter', { pattern: 'perimeter' }]])
  add(`rounded chamfer edge contour b14 ${w} + outline e14 tabs`, { shape: 'rounded', v: { w: 150, h: 100, r: 10 }, edge: { kind: 'chamfer', size: 4 } }, [{ type: 'contour', tool: T.b14, set }, { type: 'outline', tool: T.e14 }], { tabs: 'auto' });
// a flat ring: perimeter rings go round the hole too, so the top beside the hole is cut
for (const inside of [false, true]) add(`ring contour b14 perimeter${inside ? ' inside' : ''}`, { shape: 'ring', v: { d: 85.6, di: 50 } }, [{ type: 'contour', tool: T.b14, set: { pattern: 'perimeter', inside } }], { expectFree: false, dir: 'any', cover: [26, 30] });
add('ring contour b14 lines 45', { shape: 'ring', v: { d: 85.6, di: 50 } }, [{ type: 'contour', tool: T.b14, set: { pattern: 'lines', lineAngle: 45 } }], { expectFree: false, dir: 45 });
add('ring rough e14 tabs:auto mr1 aluminum', { shape: 'ring', v: { d: 85.6, di: 70 } }, [{ type: 'rough', tool: T.e18 }], { tabs: 'auto', device: 'Langmuir.MR-1', material: 'aluminum', thick: 6 });
for (const [k, svg] of Object.entries({ holes, nested, comb })) {
  add(`${k} outline e14 tabs`, { svg }, [{ type: 'outline', tool: T.e14 }], { tabs: 'auto' });
  add(`${k} outline e14 tabs:most`, { svg }, [{ type: 'outline', tool: T.e14 }], { tabs: 'most' });
  add(`${k} rough e18 tabs`, { svg }, [{ type: 'rough', tool: T.e18 }], { tabs: 'auto' });
  add(`${k} pocket e18`, { svg }, [{ type: 'pocket', tool: T.e18 }], { expectFree: false });
  add(`${k} drill + outline`, { svg }, [{ type: 'drill', tool: T.drill14 }, { type: 'outline', tool: T.e14 }], { tabs: 'auto' });
  add(`${k} outline e116 tabs`, { svg }, [{ type: 'outline', tool: T.e116 }], { tabs: 'auto' });
}
for (const f of disk) {
  const n = f.split('/').pop();
  add(`${n} rough e14 + contour b18`, { stl: f }, [{ type: 'rough', tool: T.e14 }, { type: 'contour', tool: T.b18 }], { tabs: 'auto' });
  add(`${n} contour b14`, { stl: f }, [{ type: 'contour', tool: T.b14 }], { expectFree: false, dir: 0 });
  // contour patterns (145): lines at an angle, cross, rings in from the edge, inside only or over the edge
  if (/waves|dome/.test(n)) {
    for (const [w, set, dir] of [['lines 90', { pattern: 'lines', lineAngle: 90, axis: 'Y' }, 90], ['lines 45', { pattern: 'lines', lineAngle: 45 }, 45],
      ['lines 120', { pattern: 'lines', lineAngle: 120 }, 120], ['lines 30', { pattern: 'lines', lineAngle: 30 }, 30], ['cross 0', { pattern: 'cross', lineAngle: 0 }, 'cross 0'], ['cross 30', { pattern: 'cross', lineAngle: 30 }, 'cross 30'],
      ['perimeter', { pattern: 'perimeter' }, 'rings'], ['perimeter inside', { pattern: 'perimeter', inside: true }, 'rings']]) {
      // lines at an angle follow a slanted edge from one line to the next, lifting about as often as along X
      add(`${n} contour b14 ${w}`, { stl: f }, [{ type: 'contour', tool: T.b14, set }], { expectFree: false, dir, liftsLike: /lines|perimeter/.test(w) ? `${n} contour b14` : undefined });
    }
    add(`${n} rough e14 + contour b18 cross 45`, { stl: f }, [{ type: 'rough', tool: T.e14 }, { type: 'contour', tool: T.b18, set: { pattern: 'cross', lineAngle: 45 } }], { tabs: 'auto', dir: 'any' });
    // after rough leaves tabs, a patterned contour rides over them as the 0° one does
    for (const [w, set] of [['lines 45', { pattern: 'lines', lineAngle: 45 }], ['perimeter', { pattern: 'perimeter' }]])
      add(`${n} rough e14 + contour b14 ${w} tabs`, { stl: f }, [{ type: 'rough', tool: T.e14 }, { type: 'contour', tool: T.b14, set }], { tabs: 'auto', dir: 'any' });
    // a tapered bit: the stepover is a share of its width at every angle, so 45° is the same job as 0°
    add(`${n} contour v90 lines 0`, { stl: f }, [{ type: 'contour', tool: T.v90, set: { pattern: 'lines', lineAngle: 0 } }], { expectFree: false, dir: 0 });
    add(`${n} contour v90 lines 45`, { stl: f }, [{ type: 'contour', tool: T.v90, set: { pattern: 'lines', lineAngle: 45 } }], { expectFree: false, dir: 45, like: `${n} contour v90 lines 0` });
  }
  if (/panel/.test(n)) for (const [w, set, dir] of [['lines 45', { pattern: 'lines', lineAngle: 45 }, 45], ['perimeter', { pattern: 'perimeter' }, 'rings']])
    add(`${n} contour b14 ${w}`, { stl: f }, [{ type: 'contour', tool: T.b14, set }], { expectFree: false, dir });
  add(`${n} rough e12 tabs:most`, { stl: f }, [{ type: 'rough', tool: T.e12 }], { tabs: 'most' });
  add(`${n} outline e18`, { stl: f }, [{ type: 'outline', tool: T.e18 }], { tabs: 'auto' });
}

// ---- run ---------------------------------------------------------------------------------------
let browser, page;
async function boot() {
  if (browser) await browser.close().catch(() => {});
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmp, 'profile-')), protocolTimeout: 900000, args: ['--window-size=1440,900'] });
  page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfAutoTabs && window.__swarfShape && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 250 });
  await wait(1500);
}
const within = (p, ms, what) => Promise.race([p, wait(ms).then(() => { throw new Error(`${what}: no answer in ${ms / 1000} s`); })]);

async function runCase(c) {
  const t0 = Date.now();
  errors.length = 0;
  await page.evaluate(() => { const a = kiri.api; a.platform.clear(); a.conf.get().process.ops = []; a.conf.save(); });
  await page.evaluate(d => kiri.api.devices.select(d), c.device); await wait(700);
  await page.evaluate(m => { const s = document.getElementById('swarf-material-select'); if ([...s.options].some(o => o.value === m)) { s.value = m; s.dispatchEvent(new Event('change', { bubbles: true })); } }, c.material); await wait(250);
  const thick = c.thick || 19.05;
  if (c.part.stl) {
    const input = await page.$('#load-file');
    await input.uploadFile(c.part.stl);
    await page.waitForFunction(() => kiri.api.widgets.all().length >= 1 || document.querySelector('.swarf-stl-units'), { timeout: 180000, polling: 300 });
    await wait(800);
    await page.evaluate(() => [...document.querySelectorAll('.swarf-stl-units button')].find(b => b.textContent === 'done')?.click());
    await page.waitForFunction(() => kiri.api.widgets.all().length >= 1, { timeout: 180000, polling: 300 });
  } else {
    await page.evaluate((part, t) => {
      const a = kiri.api, svg = part.svg || window.__swarfShape.svgFor(part.shape, part.v);
      a.platform.load_svg(svg, part.shape || 'part', { depth: t, resolution: 2, segmin: 48, soup: true, dpi: 0, place: true, ...(part.edge ? { edge: part.edge } : {}) });
    }, c.part, thick);
    await page.waitForFunction(() => kiri.api.widgets.all().length >= 1, { timeout: 30000, polling: 200 });
  }
  await wait(900);
  const setup = await page.evaluate((ops, tabs) => {
    const a = kiri.api, s = a.conf.get();
    s.process.ops = [];
    for (const q of ops) {
      [...document.getElementById('op-add-list').children].find(e => e.innerText.trim().toLowerCase() === q.type)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const op = s.process.ops.filter(o => o.type === q.type).pop();
      if (!op) continue;
      op.tool = q.tool;
      if (q.inside != null) op.inside = q.inside;
      if (q.set) Object.assign(op, q.set);
    }
    for (const w of a.widgets.all()) a.platform.select(w, true);
    if (tabs !== 'none') {
      window.__swarfAutoTabs.set({ density: tabs === 'most' ? 2 : 0, scale: 0, pin: {} });
      window.__swarfAutoTabs.place();
    }
    a.conf.save(); a.event.emit('cam.op.render');
    const ws = a.widgets.all();
    const bb = ws.map(w => w.getBoundingBox());
    const box = { x: Math.max(...bb.map(b => b.max.x)) - Math.min(...bb.map(b => b.min.x)), y: Math.max(...bb.map(b => b.max.y)) - Math.min(...bb.map(b => b.min.y)), z: Math.max(...bb.map(b => b.max.z)) - Math.min(...bb.map(b => b.min.z)) };
    const tabN = ws.reduce((n, w) => n + (a.widgets.annotate(w.id).tab || []).length, 0);
    const tools = s.tools;
    const dia = Math.max(...s.process.ops.filter(o => o.tool).map(o => { const t = tools.find(t => t.id === o.tool); return t ? (t.metric ? t.flute_diam : t.flute_diam * 25.4) : 0; }));
    const tabList = ws.length === 1 ? (a.widgets.annotate(ws[0].id).tab || []).map(t => ({ x: t.pos.x, y: t.pos.y, top: t.pos.z + t.dim.z / 2, half: Math.min(t.dim.x, t.dim.y) / 2 })) : [];
    return { parts: ws.length, box, tabs: tabN, tabList, ops: s.process.ops.filter(o => o.type !== '|').map(o => o.type), dia, stockZ: s.process.camStockZ };
  }, c.ops, c.tabs);
  await wait(700);
  await page.evaluate(() => { window.__tortureDone = null; const e = kiri.api.event; e.on('preview.end', () => window.__tortureDone = window.__tortureDone || 'ok'); e.on('preview.error', x => window.__tortureDone = 'error ' + x); document.getElementById('act-paths')?.click(); });
  let made;
  try { await page.waitForFunction(() => !!window.__tortureDone, { timeout: 420000, polling: 500 }); made = await page.evaluate(() => window.__tortureDone); }
  catch (e) { made = 'timeout: no toolpaths in 420 s'; }
  let text = '';
  if (made === 'ok') {
    try { text = await within(page.evaluate(() => new Promise(res => kiri.api.function.export(g => res(typeof g === 'string' ? g : (g?.gcode || String(g)))))), 240000, 'export'); }
    catch (e) { made = e.message; }
  }
  const said = await page.evaluate(() => [...document.querySelectorAll('.alert, #app-messages')].map(e => e.innerText).join(' ').slice(0, 300)).catch(() => '');
  const concerns = await page.evaluate(() => (window.__swarfConcernsNow?.() || []).map(c => `${c.title}: ${c.body}`)).catch(() => []);
  const r = { name: c.name, secs: Math.round((Date.now() - t0) / 1000), made, said, ...setup };
  if (OUT && text) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, c.name.replace(/[^\w.-]+/g, '_') + '.sbp'), text); }
  const ok = [];
  ok.push(check(made === 'ok', `${c.name}: toolpaths made`, { made, said }));
  if (made === 'ok') {
    const p = P.parse(text), cuts = p.moves.filter(m => !m.rapid);
    r.lines = text.split('\n').length;
    let lo = Infinity, hi = -Infinity; for (const m of p.moves) { if (m.z < lo) lo = m.z; if (m.z > hi) hi = m.z; }
    r.minZ = +lo.toFixed(2); r.maxZ = +hi.toFixed(2);
    const cb = P.cutBounds(p);
    r.cut = cb ? { x: +(cb.max.x - cb.min.x).toFixed(1), y: +(cb.max.y - cb.min.y).toFixed(1) } : null;
    const board = Math.max(setup.box.z, c.thick || 0);
    // a step with nothing to cut (a pocket with no floor picked) says so in concerns
    const saysEmpty = concerns.some(t => /nothing to clear|cuts nothing/.test(t));
    r.concerns = concerns;
    ok.push(check(cuts.length > 0 || saysEmpty, `${c.name}: the file cuts, or concerns say why not`, { lines: r.lines, concerns }));
    ok.push(check(!/NaN|undefined|Infinity/.test(text), `${c.name}: no NaN in the file`));
    const dive = P.rapidAcross(p), off = P.routerOffCut(p);
    ok.push(check(!dive, `${c.name}: no rapid sideways below the top`, dive));
    ok.push(check(!off, `${c.name}: router on whenever the bit is in the wood`, off));
    // a contour finishes the top: it never goes below the board (the other steps may cut a little through)
    const contourOnly = c.ops.every(q => q.type === 'contour');
    ok.push(check(r.minZ >= -(board + (contourOnly ? 0.05 : 2.01)), `${c.name}: no deeper than the board (${board.toFixed(1)})${contourOnly ? '' : ' + 2'}`, r.minZ));
    // a contour over the edge with nothing before it to clear round the part goes the board's depth
    // beside it in one pass: concerns say so; after a rough or a cut-out outline they do not
    {
      const at = c.ops.findIndex(q => q.type === 'contour' && !(q.set && q.set.inside));
      const cleared = at > 0 && c.ops.slice(0, at).some(q => q.type === 'rough' || (q.type === 'outline' && !q.inside));
      const said = concerns.some(t => /deep beside the part in one pass/.test(t));
      if (at >= 0 && cleared) ok.push(check(!said, `${c.name}: no one-pass concern for a contour after the wood is cleared`, concerns));
      else if (at >= 0 && board > setup.dia + 0.5) ok.push(check(said, `${c.name}: concerns say the contour goes the board's depth beside the part in one pass`, concerns));
    }
    // with tabs and a contour, nothing cuts into a tab: a cut whose centre is over a tab stays at its top
    // (a single part at the front-left zero: the file's 0, 0 is the part's corner, its bottom at -board)
    if (setup.tabList.length && c.ops.some(q => q.type === 'contour')) {
      let worst = null;
      for (const t of setup.tabList) {
        const cx = t.x + setup.box.x / 2, cy = t.y + setup.box.y / 2, h = Math.max(0, t.half - 0.5);
        for (const m of cuts) if (Math.abs(m.x - cx) < h && Math.abs(m.y - cy) < h && m.z + board < t.top - 0.05) { worst = { at: [+m.x.toFixed(1), +m.y.toFixed(1)], z: +(m.z + board).toFixed(2), top: +t.top.toFixed(2) }; break; }
        if (worst) break;
      }
      ok.push(check(!worst, `${c.name}: no cut into a tab`, worst));
    }
    // the top beside a hole is reached: cut points in a band of distances from the part's centre
    if (c.cover && cb) {
      const mx = (cb.min.x + cb.max.x) / 2, my = (cb.min.y + cb.max.y) / 2;
      let n = 0; for (const m of cuts) { const d = Math.hypot(m.x - mx, m.y - my); if (d >= c.cover[0] && d <= c.cover[1] && m.z > -board + 0.5) n++; }
      ok.push(check(n > 0, `${c.name}: cuts the top ${c.cover[0]}-${c.cover[1]} mm from the centre`, n));
    }
    // the same job by another angle: the cut length within half again of its sibling's
    r.cutLen = cuts.reduce((t, m) => t + Math.hypot(m.x - m.x0, m.y - m.y0), 0);
    // lifts: rapids that rise off the work
    r.ups = p.moves.filter(m => m.rapid && m.z > m.z0 + 0.5).length;
    if (c.liftsLike) { const sib = rows.find(x => x.name === c.liftsLike); if (sib && sib.ups != null) ok.push(check(r.ups <= sib.ups * 2 + 4, `${c.name}: lifts about as often as ${c.liftsLike}`, { lifts: r.ups, sibling: sib.ups })); }
    if (c.like) { const sib = rows.find(x => x.name === c.like); if (sib && sib.cutLen) ok.push(check(r.cutLen < sib.cutLen * 1.5, `${c.name}: about the same cutting as ${c.like}`, { mm: Math.round(r.cutLen), sibling: Math.round(sib.cutLen) })); }
    ok.push(check(r.maxZ <= 60, `${c.name}: no higher than 60 mm`, r.maxZ));
    // which way the cuts run: each sideways feed move's direction (0-180), weighted by its length
    if (c.dir !== undefined && c.dir !== 'any') {
      const hist = new Array(180).fill(0); let all = 0;
      for (const m of cuts) { const dx = m.x - m.x0, dy = m.y - m.y0, l = Math.hypot(dx, dy); if (l < 0.2) continue; const a = ((Math.round(Math.atan2(dy, dx) * 180 / Math.PI) % 180) + 180) % 180; hist[a] += l; all += l; }
      const near = (a, tol = 6) => { let s = 0; for (let d = -tol; d <= tol; d++) s += hist[(((a + d) % 180) + 180) % 180]; return all ? s / all : 0; };
      let want, got;
      if (typeof c.dir === 'number') { got = near(c.dir); want = got >= 0.6; }
      else if (/^cross/.test(c.dir)) { const a = +c.dir.split(' ')[1]; got = [near(a), near((a + 90) % 180)].map(v => +v.toFixed(2)); want = got[0] >= 0.25 && got[1] >= 0.25 && got[0] + got[1] >= 0.6; }
      // rings turn with the part's edge: the way at right angles to the most-cut way carries a good
      // share too (a long part puts more along its length; lines at one angle put almost none across)
      else { const top = hist.map((_, a) => near(a)).reduce((b, v, a, all) => v > all[b] ? a : b, 0); got = [near(top), near((top + 90) % 180)].map(v => +v.toFixed(2)); want = got[1] >= 0.2; }
      r.dirShare = got;
      ok.push(check(want, `${c.name}: the cuts run ${typeof c.dir === 'number' ? `at ${c.dir}°` : c.dir === 'rings' ? 'round with the edge (rings)' : `both ways (${c.dir})`}`, got));
    }
    // rings on a part with no hole: cut from the edge in, clockwise all the way (climb), never from
    // the middle out or a ring run backward
    if (c.dir === 'rings' && cb) {
      const mx = (cb.min.x + cb.max.x) / 2, my = (cb.min.y + cb.max.y) / 2;
      const side = cuts.filter(m => Math.hypot(m.x - m.x0, m.y - m.y0) > 0.01);
      const total = side.reduce((t, m) => t + Math.hypot(m.x - m.x0, m.y - m.y0), 0);
      const fromEdge = m => Math.min(m.x - cb.min.x, cb.max.x - m.x, m.y - cb.min.y, cb.max.y - m.y);
      let turn = 0, all = 0, run = 0, early = [0, 0], late = [0, 0];
      for (const m of side) {
        const sw = (m.x0 - mx) * (m.y - my) - (m.x - mx) * (m.y0 - my), l = Math.hypot(m.x - m.x0, m.y - m.y0);
        turn += sw; all += Math.abs(sw);
        if (run < total * 0.1) { early[0] += fromEdge(m) * l; early[1] += l; }
        if (run > total * 0.9) { late[0] += fromEdge(m) * l; late[1] += l; }
        run += l;
      }
      r.ringTurn = all ? +(turn / all).toFixed(2) : 0;
      ok.push(check(r.ringTurn <= -0.8, `${c.name}: the rings run clockwise (climb), none backward`, r.ringTurn));
      const e = early[1] ? early[0] / early[1] : 0, l = late[1] ? late[0] / late[1] : 0;
      ok.push(check(e < l, `${c.name}: the rings run from the edge in`, { firstTenth: +e.toFixed(1), lastTenth: +l.toFixed(1) }));
    }
    if (cb) ok.push(check(r.cut.x <= setup.box.x + 2 * setup.dia + 2.5 && r.cut.y <= setup.box.y + 2 * setup.dia + 2.5, `${c.name}: the cut no wider than the part and two bits (a sharp corner's miter)`, { cut: r.cut, box: setup.box, dia: setup.dia }));
    if (c.expectFree && cb && cuts.length) {
      // the part's bottom: deepest cut within 0.5 mm of the board's bottom (or through)
      ok.push(check(r.minZ <= -(board - 0.5), `${c.name}: cuts down to the bottom of the part`, { minZ: r.minZ, board }));
      if (setup.tabs > 0) {
        // the deepest pass lifts over the tabs: rises from the floor without a rapid, once per tab at least
        // the floor of the sideways cuts (a drill's plunge goes deeper, by its point)
        let floor = Infinity; for (const m of cuts) if (Math.hypot(m.x - m.x0, m.y - m.y0) > 0.05) floor = Math.min(floor, m.z, m.z0); let up = 0, low = false;
        for (const m of p.moves) { if (m.rapid) { low = false; continue; } if (m.z <= floor + 0.05) low = true; else if (low && m.z > floor + 0.5) { up++; low = false; } }
        r.lifts = up;
        ok.push(check(up >= Math.min(setup.tabs, 1), `${c.name}: the last pass lifts over its tabs`, { lifts: up, tabs: setup.tabs }));
      }
    }
  }
  ok.push(check(errors.length === 0, `${c.name}: no page errors`, errors.slice(0, 3)));
  r.pass = ok.every(Boolean);
  rows.push(r);
  console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${c.name.padEnd(48)} ${String(r.secs).padStart(4)}s parts ${setup.parts} tabs ${setup.tabs} z ${r.minZ}..${r.maxZ} cut ${r.cut ? r.cut.x + 'x' + r.cut.y : '-'} box ${setup.box.x.toFixed(0)}x${setup.box.y.toFixed(0)}x${setup.box.z.toFixed(1)}${r.lifts != null ? ' lifts ' + r.lifts : ''}`);
  return r.made;
}

try {
  await boot();
  const list = cases.filter(c => !FILTER || FILTER.test(c.name));
  console.log(`${list.length} cases`);
  for (const c of list) {
    let made;
    try { made = await runCase(c); }
    catch (e) { check(false, `${c.name}: case ran: ${e.message}`); made = 'crash'; }
    // a hang or crash: start again from a fresh page, so one case does not fail the rest
    if (made !== 'ok' && made !== undefined && !/^error/.test(made)) await boot();
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  writeFileSync(join(process.env.SUMMARY_DIR || tmp, 'torture-summary.json'), JSON.stringify(rows, null, 1));
  console.log(`summary: ${join(process.env.SUMMARY_DIR || tmp, 'torture-summary.json')}`);
}
console.log(bad.length ? `toolpath torture: ${bad.length} FAIL in ${rows.filter(r => !r.pass).length} of ${rows.length} cases` : `toolpath torture: ok (${rows.length} cases)`);
process.exit(bad.length ? 1 : 0);
