// TEX, DRAW's carves and inlays, and the shape library's parts, through the whole app on the ShopBot and
// the MR-1, each file read back the way control reads it and run through its plans. The marks are
// awkward on purpose: half off the part, on a part smaller than the bit, letters over the edge, a
// pocket's plug, a groove pattern's own bit. Each case:
//   made in time, no page error; the file (and each MR-1 bit file) reads whole, in millimeters, no NaN
//   the same job writes the same file
//   no rapid sideways below the top; the router on in the wood; no deeper than the board and the
//   outline's 0.3 mm; a texture alone no deeper than its own depth; the cut inside the part and a bit
//   every cut at or under the step's own feed; the router at the step's own speed; on the MR-1 no speed
//   past the spindle's and no bit change inside a file
//   control's plan from the top, and from a line partway: up, over, router on, slowly down
//   node tools/probe_torture_tex_export.mjs [url] [filter]
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const require = createRequire(import.meta.url);
const P = require('../web/kiri/swarf-run-parse.js');
globalThis.SwarfRunParse = P;
const R = require('../web/kiri/swarf-run-plan.js');
const PAGE = process.argv[2] || 'http://127.0.0.1:8841/swarf-app/';
const FILTER = process.argv[3] ? new RegExp(process.argv[3]) : null;
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what, info) => { if (!ok) { console.log('FAIL', what, info !== undefined ? JSON.stringify(info).slice(0, 400) : ''); bad.push(what); } return ok; };
const dir = mkdtempSync(join(tmpdir(), 'swarf-texexport-'));
const THICK = 19.05;

// marks, in the part's frame (mm); each is made on the page from these words
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const star = (cx, cy, R, r, n) => { const p = []; for (let i = 0; i < 2 * n; i++) { const a = i * Math.PI / n + Math.PI / 2, k = i % 2 ? r : R; p.push([cx + k * Math.cos(a), cy + k * Math.sin(a)]); } return p; };
const cases = [];
const board = { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80"><rect width="120" height="80"/></svg>', w: 120, h: 80 };
for (const device of ['ShopBot.Basic', 'Langmuir.MR-1']) {
  const dv = device === 'ShopBot.Basic' ? 'shopbot' : 'mr1';
  // groove patterns at their own bits, painted over the right half and past the part's edge
  for (const id of ['morse', 'dashdot', 'memphis', 'motif', 'ribs', 'knurl'])
    cases.push({ name: `${dv} ${id} half off the edge`, device, part: board, marks: [{ kind: 'texture', id, paint: [60, -10, 135, 90] }] });
  // a part smaller than the 1/4 in ball, the whole top painted
  cases.push({ name: `${dv} waves on an 8 mm disc`, device, part: { shape: ['circle', { d: 8 }] }, marks: [{ kind: 'texture', id: 'waves', paint: 'all' }], outline: true });
  // dots, plunged, on a star part, with its outline
  cases.push({ name: `${dv} dots on a star + outline`, device, part: { shape: ['star', { d: 100, p: 5, i: 44 }] }, marks: [{ kind: 'texture', id: 'dots', paint: 'all' }], outline: true });
  // letters carved with a V, the last one over the part's edge
  cases.push({ name: `${dv} V-carved letters over the edge`, device, part: board, marks: [{ kind: 'vcarve', loops: [rect(10, 20, 16, 60), rect(16, 37, 30, 43), rect(30, 20, 36, 60), rect(50, 20, 56, 60), rect(110, 30, 130, 50)] }] });
  // an inlay pocket (a star, inside corners tighter than the bit) and the outline that frees the part
  cases.push({ name: `${dv} inlay star + outline`, device, part: board, marks: [{ kind: 'inlay', loops: [star(60, 40, 25, 10, 5)] }], outline: true });
  // a ring part: a texture over its hole
  cases.push({ name: `${dv} stone on a ring`, device, part: { shape: ['ring', { d: 85.6, di: 50 }] }, marks: [{ kind: 'texture', id: 'stone', paint: 'all' }] });
}

let browser, page;
async function boot() {
  if (browser) await browser.close().catch(() => {});
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(dir, 'p-')), protocolTimeout: 900000, args: ['--window-size=1440,900'] });
  page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfTex && window.SwarfTexCore && window.__swarfShape && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 250 });
  await wait(1500);
}
const exportNow = () => page.evaluate(() => new Promise(res => { kiri.api.function.export((g, out) => res({ text: typeof g === 'string' ? g : (g?.gcode || String(g)), files: (out && out.swarfBitFiles) || null })); setTimeout(() => res(null), 240000); }));

async function runCase(c) {
  const t0 = Date.now();
  errors.length = 0;
  await page.evaluate(() => { const a = kiri.api; a.platform.clear(); a.conf.get().process.ops = []; a.conf.save(); });
  await page.evaluate(d => kiri.api.devices.select(d), c.device); await wait(700);
  await page.evaluate((part, t) => {
    const a = kiri.api, svg = part.svg || window.__swarfShape.svgFor(part.shape[0], part.shape[1]);
    a.platform.load_svg(svg, 'part', { depth: t, resolution: 2, segmin: 48, soup: true, dpi: 0, place: true });
  }, c.part, THICK);
  await page.waitForFunction(() => kiri.api.widgets.all().length === 1, { timeout: 30000, polling: 200 }); await wait(800);
  await page.evaluate((outline) => {
    const a = kiri.api; a.platform.select(a.widgets.all()[0]);
    if (outline) { [...document.getElementById('op-add-list').children].find(e => e.innerText.trim().toLowerCase() === 'outline')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); window.__swarfAutoTabs.set({ density: 0, scale: 0, pin: {} }); window.__swarfAutoTabs.place(); }
    a.conf.save();
  }, !!c.outline);
  await wait(500);
  await page.click('#swarf-step-tex'); await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 15000 });
  const box = await page.evaluate((marks) => {
    const S = window.__swarfTex.state(), C = window.SwarfTexCore, p = S.parts[0];
    marks.forEach((m, i) => {
      let region, fill, drawn;
      if (m.kind === 'texture') {
        const [x0, y0, x1, y1] = m.paint === 'all' ? [p.box[0] - 2, p.box[1] - 2, p.box[2] + 2, p.box[3] + 2] : [m.paint[0] + p.box[0], m.paint[1] + p.box[1], m.paint[2] + p.box[0], m.paint[3] + p.box[1]];
        region = C.newGrid(x0, y0, x1, y1, 0.5); C.paintWhere(region, () => true, 1);
        fill = C.newFill(m.id, { origin: [(x0 + x1) / 2, (y0 + y1) / 2] });
      } else {
        // the words are from the part's front-left corner
        const loops = m.loops.map(L => L.map(q => [q[0] + p.box[0], q[1] + p.box[1]]));
        const d = C.drawnRegion(loops, 0.25); region = d.region;
        fill = m.kind === 'vcarve' ? C.newVcarve() : C.newInlay();
        if (m.kind === 'vcarve') drawn = { loops, sig: d.sig };
      }
      p.marks.push({ id: 'tt' + i, made: 'region', region, xf: C.IDENTITY.slice(), fill, ver: 1, ...(drawn ? { drawn } : {}) });
    });
    S.sel = 0; S.mark = 0; p.dirty = true;
    return p.box;
  }, c.marks);
  await page.click('#tx-done'); await wait(1500);
  const ops = await page.evaluate(() => kiri.api.conf.get().process.ops.filter(o => o.type !== '|').map(o => ({ type: o.type, rate: o.rate, plunge: o.plunge, spindle: o.spindle, tool: o.tool })));
  const dev = await page.evaluate(() => { const d = kiri.api.conf.get().device; return { spindleMax: d.spindleMax, feedMax: d.feedMax }; });
  await page.evaluate(() => { window.__ttDone = null; const e = kiri.api.event; e.on('preview.end', () => window.__ttDone = window.__ttDone || 'ok'); e.on('preview.error', x => window.__ttDone = 'error ' + x); document.getElementById('act-paths')?.click(); });
  let made;
  try { await page.waitForFunction(() => !!window.__ttDone, { timeout: 600000, polling: 500 }); made = await page.evaluate(() => window.__ttDone); } catch (e) { made = 'timeout'; }
  const ok = [check(made === 'ok', `${c.name}: toolpaths made`, made)];
  let info = '';
  if (made === 'ok') {
    const r1 = await exportNow(), r2 = await exportNow();
    ok.push(check(r1 && r1.text.length > 100, `${c.name}: a file`));
    if (r1 && r2) ok.push(check(r1.text === r2.text, `${c.name}: the same job writes the same file`));
    const text = r1 ? r1.text : '';
    const files = r1 && r1.files ? r1.files.map(f => f.text) : [text];
    if (c.device === 'Langmuir.MR-1') ok.push(check(!/^M0?6\b/m.test(text) && files.every(f => !/^M0?6\b/m.test(f)), `${c.name}: no bit change inside an MR-1 file`));
    for (const [k, f] of files.entries()) {
      const p = P.parse(f, { machineUnits: 'mm' }), tag = files.length > 1 ? ` (file ${k + 1} of ${files.length})` : '';
      ok.push(check(p.units === 'mm' && !p.unitsGuessed, `${c.name}${tag}: says millimeters`));
      ok.push(check(!p.unsupported.length, `${c.name}${tag}: every line reads`, p.unsupported.slice(0, 2)));
      ok.push(check(!/NaN|undefined|Infinity/.test(f), `${c.name}${tag}: no NaN`));
      ok.push(check(!P.rapidAcross(p), `${c.name}${tag}: no rapid sideways below the top`, P.rapidAcross(p)));
      ok.push(check(!P.routerOffCut(p), `${c.name}${tag}: router on in the wood`, P.routerOffCut(p)));
      let lo = Infinity; for (const m of p.moves) lo = Math.min(lo, m.z);
      // a texture or a carve alone never cuts deeper than its own depth; an outline goes 0.3 mm through
      const texOnly = !c.outline;
      ok.push(check(lo >= -(texOnly ? THICK - 0.2 : THICK + 0.31), `${c.name}${tag}: no deeper than ${texOnly ? 'the board, less its skin' : 'the board and 0.3 mm'} (lowest ${lo.toFixed(2)})`));
      const cb = P.cutBounds(p), reach = 14;
      // the part's frame in the file: X 0 Y 0 at its front-left corner (the part sits at the zero)
      if (cb) ok.push(check(cb.min.x >= -reach && cb.min.y >= -reach && cb.max.x <= (box[2] - box[0]) + reach && cb.max.y <= (box[3] - box[1]) + reach, `${c.name}${tag}: the cut inside the part and a bit`, { cut: cb, part: box }));
      // feeds and speeds as the steps say
      const rates = ops.map(o => o.rate).filter(v => v > 0), maxRate = Math.max(...rates);
      const fast = p.moves.find(m => !m.rapid && m.feed * 60 > maxRate * 1.001 + 0.01);
      ok.push(check(!fast, `${c.name}${tag}: no cut faster than the steps' feeds (${rates.join(', ')} mm/min)`, fast));
      const rpms = p.events.filter(e => e.kind === 'rpm').map(e => e.value);
      if (c.device === 'Langmuir.MR-1') ok.push(check(rpms.some(v => v > 0) && rpms.every(v => v >= 0 && v <= dev.spindleMax), `${c.name}${tag}: every spindle speed within the MR-1's ${dev.spindleMax} (${rpms.join(', ')})`));
      const want = ops.map(o => o.spindle).filter(v => v > 0);
      if (want.length && files.length === 1) ok.push(check(want.every(v => rpms.includes(Math.min(v, dev.spindleMax)) || rpms.includes(v)), `${c.name}${tag}: the steps' speeds are in the file (${want.join(', ')} vs ${rpms.join(', ')})`));
      // control: the whole file, then from a line partway, entered up, over, router on, slowly down
      if (p.moves.length && !p.unsupported.length) {
        const cfg = { safeZ: 25, rapid: { xy: 100, z: 50 }, move: { xy: 100, z: 50 }, jog: { z: 50 }, spinUp: 2, changeZ: 50, spindleSpeed: c.device !== 'ShopBot.Basic' };
        const lines = [...new Set(p.moves.filter(m => !m.rapid && m.z < -0.05).map(m => m.line))];
        for (const [what, prog, pos] of [['the whole file', { name: 'job', moves: p.moves, events: p.events, source: p, spindle: true, cut: true }, { x: 5, y: 5, z: 30 }],
          ...(lines.length ? [(() => { const N = lines[Math.floor(lines.length / 2)]; const fl = P.fromLineProgram(p, N, 25, 'job'); return [`line ${N}`, { ...fl, source: p }, { x: 1, y: 1, z: -2 }]; })()] : [])]) {
          const plan = R.build(prog, { pos, live: true, cfg });
          ok.push(check(!plan.problems.length, `${c.name}${tag} ${what}: a plan control will run`, plan.problems.slice(0, 2)));
          let router = false, from = pos, why = null;
          for (const s of plan.steps) {
            if (s.router !== undefined) router = s.router;
            if (!s.move) continue;
            const m = s.move, side = Math.hypot(m.x - from.x, m.y - from.y) > 1e-6;
            if (s.phase === 'entry' && side && Math.min(m.z, from.z) < Math.min(cfg.safeZ, 0.5) - 1e-6) { why = { why: 'over below safe Z', s }; break; }
            if (s.phase === 'entry' && m.z < from.z - 1e-6 && s.feed > 10) { why = { why: 'down fast', s }; break; }
            if (m.z < -0.05 && !router) { why = { why: 'in the wood, router off', s }; break; }
            if (s.work && s.work.rapid && m.z < from.z - 1e-6 && m.z < -0.05) { why = { why: 'rapid down into the wood', s }; break; }
            from = m;
          }
          ok.push(check(!why, `${c.name}${tag} ${what}: up, over, router on, slowly down`, why));
        }
      }
      info += ` ${f.split('\n').length} lines, z ${lo.toFixed(2)}, S ${[...new Set(rpms)].join('/')}`;
    }
  }
  ok.push(check(errors.length === 0, `${c.name}: no page errors`, errors.slice(0, 3)));
  console.log(`${ok.every(Boolean) ? 'ok  ' : 'FAIL'} ${c.name.padEnd(40)} ${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s ${ops.map(o => `${o.type} F${o.rate} S${o.spindle}`).join(' + ')} ${info}`);
  return made;
}

try {
  await boot();
  const list = cases.filter(c => !FILTER || FILTER.test(c.name));
  console.log(`${list.length} cases`);
  for (const c of list) {
    let made;
    try { made = await runCase(c); }
    catch (e) { check(false, `${c.name}: case ran: ${e.message}`); made = 'crash'; }
    if (made !== 'ok') await boot();
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}
console.log(bad.length ? `tex/export torture: ${bad.length} FAIL` : `tex/export torture: ok (${cases.filter(c => !FILTER || FILTER.test(c.name)).length} cases)`);
process.exit(bad.length ? 1 : 0);
