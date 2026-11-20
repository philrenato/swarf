// Cut-out torture: parts cut free on one bed (several, copies, different thicknesses, holes, islands,
// tiny and bed-sized), with auto tabs, a last pass, drills and pockets, on the ShopBot and the MR-1, in
// mm and inches. Each case makes its file, reads it the way control does, and checks:
//   made: no error, in time, no NaN; the same job twice gives the same file
//   through: each part cut out goes to the bed and the outline's 0.3 mm on, no deeper (a drill's point
//            aside: it is said apart)
//   tabs: every tab sits on the bed, lies on the cut's path (it holds something), and no cut goes into
//         it below its top; every piece the cut frees (the part, an island, a hole's piece) has a tab or
//         concerns say it is loose
//   rapids: every rapid across a part is at or above that part's top (the tallest part, not its own)
//   order: nothing is cut inside a part after its cut-out's last pass (the part held by tabs alone)
//   feeds: every cut's feed above zero and at most the machine's top speed
//   node tools/probe_torture_cutout.mjs [url] [filter]      (OUT=dir keeps the files)
import puppeteer from 'puppeteer-core';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const P = createRequire(import.meta.url)('../web/kiri/swarf-run-parse.js');
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const FILTER = process.argv[3] ? new RegExp(process.argv[3]) : null;
const OUT = process.env.OUT || '';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], rows = [], errors = [];
const check = (ok, what, info) => { if (!ok) { console.log('FAIL', what, info !== undefined ? JSON.stringify(info).slice(0, 400) : ''); bad.push(what); } return ok; };
const t0 = Date.now();

// ---- parts (all symmetric about their centers, so the SVG's y-down and the bed's y-up agree) ------
const svgDoc = (w, h, d) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}"><path fill-rule="evenodd" d="${d}"/></svg>`;
const R = (x, y, w, h) => `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
const C = (x, y, d) => `M${x - d / 2} ${y}a${d / 2} ${d / 2} 0 1 0 ${d} 0a${d / 2} ${d / 2} 0 1 0 ${-d} 0Z`;
// pieces in the part's own frame, from its center: what the cut frees and must be held
const rectPiece = (kind, w, h) => ({ kind, w, h });
const circPiece = (kind, d) => ({ kind, d });
const PARTS = {
  plate: { svg: svgDoc(160, 100, R(0, 0, 160, 100)), pieces: [rectPiece('outer', 160, 100)] },
  disc: { svg: svgDoc(60, 60, C(30, 30, 60)), pieces: [circPiece('outer', 60)] },
  smalldisc: { svg: svgDoc(20, 20, C(10, 10, 20)), pieces: [circPiece('outer', 20)] },
  tiny: { svg: svgDoc(5, 5, R(0, 0, 5, 5)), pieces: [rectPiece('outer', 5, 5)] },
  // a frame whose window holds an island: three pieces come free (frame, the window's ring, the island)
  frame: { svg: svgDoc(160, 160, R(0, 0, 160, 160) + R(30, 30, 100, 100) + R(65, 65, 30, 30)), pieces: [rectPiece('outer', 160, 160), rectPiece('hole', 100, 100), rectPiece('island', 30, 30)] },
  // the same with a small island, less than a tab's foot round
  frameSmall: { svg: svgDoc(160, 160, R(0, 0, 160, 160) + R(30, 30, 100, 100) + R(72, 72, 16, 16)), pieces: [rectPiece('outer', 160, 160), rectPiece('hole', 100, 100), rectPiece('island', 16, 16)] },
  // a ring: its hole's piece comes free
  ring: { svg: svgDoc(120, 120, C(60, 60, 120) + C(60, 60, 70)), pieces: [circPiece('outer', 120), circPiece('hole', 70)] },
  // two pieces in one part (two shapes in one drawing)
  pair: { svg: svgDoc(200, 60, R(0, 0, 60, 60) + R(140, 0, 60, 60)), pieces: [] },
  // a plate with round holes a 1/4 in drill fits
  drilled: { svg: svgDoc(120, 80, R(0, 0, 120, 80) + C(30, 40, 6.35) + C(90, 40, 6.35) + C(60, 20, 6.35) + C(60, 60, 6.35)), pieces: [rectPiece('outer', 120, 80)] },
  big: { svg: svgDoc(1200, 600, R(0, 0, 1200, 600)), pieces: [rectPiece('outer', 1200, 600)] },
  // one mesh, so one part, with a piece too small for a tab of its own: a frame whose window holds a
  // 16 mm island, and two plates beside a 12 mm square
  stlframe: { stl: [[[-80, -80, 160, 160], [-50, -50, 100, 100]], [[-8, -8, 16, 16]]], pieces: [rectPiece('outer', 160, 160), rectPiece('hole', 100, 100), rectPiece('island', 16, 16)] },
  stlpair: { stl: [[[-100, -30, 60, 60]], [[40, -30, 60, 60]], [[-6, -6, 12, 12]]], pieces: [rectPiece('square', 12, 12)] },
};

// a binary STL of flat pieces T thick: each piece a rectangle [x, y, w, h] with at most one
// rectangular window, its top and bottom in quads, its walls facing out of the material
function stlOf(pieces, T) {
  const tris = [];
  const quad = (a, b, c, d) => tris.push([a, b, c], [a, c, d]);
  const corners = ([x, y, w, h]) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  for (const [outer, hole] of pieces) {
    const o = corners(outer);
    for (let i = 0; i < 4; i++) { const a = o[i], b = o[(i + 1) % 4]; quad([...a, 0], [...b, 0], [...b, T], [...a, T]); }
    if (!hole) { quad([...o[0], T], [...o[1], T], [...o[2], T], [...o[3], T]); quad([...o[0], 0], [...o[3], 0], [...o[2], 0], [...o[1], 0]); continue; }
    const h = corners(hole);
    for (let i = 0; i < 4; i++) {
      const a = h[i], b = h[(i + 1) % 4];
      quad([...b, 0], [...a, 0], [...a, T], [...b, T]);
      quad([...o[i], T], [...o[(i + 1) % 4], T], [...b, T], [...a, T]);
      quad([...o[i], 0], [...a, 0], [...b, 0], [...o[(i + 1) % 4], 0]);
    }
  }
  const buf = Buffer.alloc(84 + tris.length * 50); buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => t.flat().forEach((v, k) => buf.writeFloatLE(v, 84 + i * 50 + 12 + k * 4)));
  return buf;
}
const stlDir = mkdtempSync(join(tmpdir(), 'swarf-cutout-stl-'));

// ---- cases ---------------------------------------------------------------------------------------
const cases = [];
const add = (name, o) => cases.push({ name, device: 'ShopBot.Basic', units: 'mm', material: 'plywood', tabs: 'auto', ...o });
const outline = (tool = 'end 1/4', x = {}) => ({ type: 'outline', tool, ...x });
for (const device of ['ShopBot.Basic', 'Langmuir.MR-1']) {
  const mat = device === 'ShopBot.Basic' ? 'plywood' : 'aluminum_6061';
  const thick = device === 'ShopBot.Basic' ? 19.05 : 6.35;
  const tool = device === 'ShopBot.Basic' ? 'end 1/4' : 'end 1/8';
  const d = device.split('.').pop();
  for (const units of ['mm', 'in']) {
    add(`${d} ${units} plate outline tabs`, { device, units, material: mat, parts: [['plate', thick]], ops: [outline(tool)] });
    add(`${d} ${units} three plates, two bits`, { device, units, material: mat, parts: [['plate', thick], ['plate', thick], ['plate', thick]], ops: [outline('end 1/8', { inside: true }), outline(tool)] });
  }
  add(`${d} frame with island`, { device, material: mat, parts: [['frame', thick]], ops: [outline(tool)] });
  add(`${d} frame, small island`, { device, material: mat, parts: [['frameSmall', thick]], ops: [outline(tool)] });
  add(`${d} ring`, { device, material: mat, parts: [['ring', thick]], ops: [outline(tool)] });
  add(`${d} ring, last pass`, { device, material: mat, parts: [['ring', thick]], ops: [outline(tool, { lastpass: true, leave: 0.5 })] });
  add(`${d} small disc`, { device, material: mat, parts: [['smalldisc', thick]], ops: [outline(tool)] });
  add(`${d} tiny part`, { device, material: mat, parts: [['tiny', thick]], ops: [outline(tool)] });
  add(`${d} two pieces in one part`, { device, material: mat, parts: [['pair', thick]], ops: [outline(tool)] });
  add(`${d} half beside thick`, { device, material: mat, parts: [['plate', thick], ['disc', thick / 2]], ops: [outline(tool)] });
  add(`${d} thin beside thick`, { device, material: mat, parts: [['plate', thick], ['disc', thick / 2], ['plate', thick / 3]], ops: [outline(tool)] });
  add(`${d} drill then outline`, { device, material: mat, parts: [['drilled', thick], ['drilled', thick]], ops: [{ type: 'drill', tool: 'drill 1/4' }, outline(tool)] });
  add(`${d} no steps (auto rough)`, { device, material: mat, parts: [['plate', thick], ['disc', thick]], ops: [] });
  add(`${d} rough, tabs`, { device, material: mat, parts: [['ring', thick], ['plate', thick]], ops: [{ type: 'rough', tool }] });
  add(`${d} copies 3x2`, { device, material: mat, parts: [['ring', thick]], copies: [3, 2], ops: [outline(tool)] });
  add(`${d} no tabs, outline`, { device, material: mat, parts: [['plate', thick], ['disc', thick]], ops: [outline(tool)], tabs: 'none' });
  add(`${d} tabs: most, larger`, { device, material: mat, parts: [['ring', thick], ['plate', thick]], ops: [outline(tool)], tabs: 'most' });
}
add('ShopBot one mesh: frame, 16 mm island', { parts: [['stlframe', 19.05]], ops: [outline('end 1/4')] });
add('ShopBot one mesh: two plates and a 12 mm square', { parts: [['stlpair', 19.05]], ops: [outline('end 1/4')] });
add('ShopBot big part tabs', { parts: [['big', 19.05]], ops: [outline('end 1/4')] });
add('ShopBot outline 1/2 in bit, small disc', { parts: [['smalldisc', 19.05]], ops: [outline('end 1/2')] });
add('ShopBot outline 1/16, frame', { parts: [['frame', 6.35]], ops: [outline('end 1/16')] });
add('ShopBot outline, rough after (wrong order)', { parts: [['plate', 19.05]], ops: [outline('end 1/4'), { type: 'rough', tool: 'end 1/8' }] });

// ---- run -----------------------------------------------------------------------------------------
let browser, page;
async function boot() {
  if (browser) await browser.close().catch(() => {});
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-cutout-')), protocolTimeout: 600000, args: ['--window-size=1440,900'] });
  page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfAutoTabs && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 250 });
  await wait(1500);
}
const within = (p, ms, what) => Promise.race([p, wait(ms).then(() => { throw new Error(`${what}: no answer in ${ms / 1000} s`); })]);

async function exportText() {
  // a refused slice never calls the export back: its error is the answer
  const got = await within(page.evaluate(() => new Promise(res => {
    const e = window.kiri.api.event;
    e.on('slice.error', x => res({ error: 'slice: ' + x })); e.on('preview.error', x => res({ error: 'toolpaths: ' + x }));
    window.kiri.api.function.clear_progress?.(); window.kiri.api.function.export(g => res({ text: typeof g === 'string' ? g : (g?.gcode || String(g)) }));
  })), 300000, 'export');
  if (got.error) throw new Error(got.error);
  return got.text;
}

async function setup(c) {
  await page.evaluate(() => { const a = kiri.api; a.platform.clear(); a.conf.get().process.ops = []; a.conf.save(); });
  await page.evaluate(d => kiri.api.devices.select(d), c.device); await wait(700);
  await page.evaluate(u => { const s = window.kiri.api.ui.units; if (s && s.value !== u) { s.value = u; s.onchange(); } }, c.units); await wait(300);
  await page.evaluate(m => { const s = document.getElementById('swarf-material-select'); if ([...s.options].some(o => o.value === m)) { s.value = m; s.dispatchEvent(new Event('change', { bubbles: true })); } }, c.material); await wait(250);
  for (const [k, t] of c.parts) {
    if (PARTS[k].stl) {
      const f = join(stlDir, `${k}.stl`);
      writeFileSync(f, stlOf(PARTS[k].stl, t));
      const n = await page.evaluate(() => kiri.api.widgets.all().length);
      await (await page.$('#load-file')).uploadFile(f);
      await page.waitForFunction(n => kiri.api.widgets.all().length > n || document.querySelector('.swarf-stl-units'), { timeout: 60000, polling: 300 }, n);
      await wait(800);
      await page.evaluate(() => [...document.querySelectorAll('.swarf-stl-units button')].find(b => b.textContent === 'done')?.click());
      await page.waitForFunction(n => kiri.api.widgets.all().length > n, { timeout: 60000, polling: 300 }, n);
    } else await page.evaluate((svg, name, depth) => window.kiri.api.platform.load_svg(svg, name, { depth, soup: true, dpi: 0, place: true }), PARTS[k].svg, k, t);
    await wait(700);
  }
  await page.waitForFunction(n => kiri.api.widgets.all().length >= n, { timeout: 30000, polling: 200 }, c.parts.length);
  if (c.copies) {
    await page.evaluate(() => { const a = kiri.api, w = a.widgets.all()[0]; a.platform.deselect(); a.platform.select(w, false); });
    await page.evaluate(() => window.__swarfSize.copies && window.__swarfSize.copies()); await wait(600);
    for (const [id, v] of [['copies-across', c.copies[0]], ['copies-back', c.copies[1]]]) { await page.click('#' + id, { clickCount: 3 }); await page.keyboard.type(String(v)); await wait(100); }
    await page.evaluate(() => [...document.querySelectorAll('#dialog button')].find(b => /^make$/i.test(b.textContent.trim()))?.click()); await wait(900);
  }
  return page.evaluate((ops, tabs) => {
    const a = kiri.api, s = a.conf.get();
    s.process.ops = [];
    for (const q of ops) {
      [...document.getElementById('op-add-list').children].find(e => e.innerText.trim().toLowerCase() === q.type)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const op = s.process.ops.filter(o => o.type === q.type).pop();
      if (!op) continue;
      const t = s.tools.find(t => t.name === q.tool); if (t) op.tool = t.id;
      for (const k of ['inside', 'lastpass', 'leave']) if (q[k] != null) op[k] = q[k];
    }
    // every part picked (a pick toggles one already picked, so from none)
    a.platform.deselect();
    for (const w of a.widgets.all()) if (!a.selection.contains(w)) a.platform.select(w, true);
    if (tabs !== 'none') {
      window.__swarfAutoTabs.set({ density: tabs === 'most' ? 2 : 0, scale: tabs === 'most' ? 2 : 0, pin: {} });
      window.__swarfAutoTabs.place();
    }
    a.platform.deselect();
    a.conf.save(); a.event.emit('cam.op.render');
    const ang = r => { let z = 0, w = 1; if (Array.isArray(r)) { z = r[2]; w = r[3]; } else if (r) { z = r._z ?? r.z ?? 0; w = r._w ?? r.w ?? 1; } return 2 * Math.atan2(z, w); };
    const parts = a.widgets.all().filter(w => !w.track.synth).map(w => {
      const g = w.mesh.geometry; g.computeBoundingBox(); const b = g.boundingBox, p = w.track.pos;
      return { name: w.meta.file, kind: (w.meta.file || '').replace(/[^a-zA-Z].*$/, '') || w.meta.file, x0: b.min.x + p.x, y0: b.min.y + p.y, x1: b.max.x + p.x, y1: b.max.y + p.y, cx: p.x, cy: p.y, h: w.track.box.d, track: [w.track.top, w.track.tzoff, p.z],
        tabs: (a.widgets.annotate(w.id).tab || []).map(t => ({ x: t.pos.x + p.x, y: t.pos.y + p.y, z0: t.pos.z - t.dim.z / 2, top: t.pos.z + t.dim.z / 2, reach: t.dim.x, w: t.dim.y, a: ang(t.rot) })) };
    });
    const tools = s.tools, dia = o => { const t = tools.find(t => t.id === o.tool); return t ? (t.metric ? t.flute_diam : t.flute_diam * 25.4) : 0; };
    const real = s.process.ops.filter(o => o.type !== '|');
    return { parts, ops: real.map(o => ({ type: o.type, dia: dia(o), inside: !!o.inside, rate: o.rate, plunge: o.plunge })), thru: s.process.camOutlineThru, feedMax: s.device.feedMax || 0, units: s.controller?.units };
  }, c.ops, c.tabs);
}

// a point in a tab's box, in the file's frame: along its reach and along the edge
function inTab(t, x, y, trimW = 0.3) {
  const dx = x - t.fx, dy = y - t.fy, ca = Math.cos(t.a), sa = Math.sin(t.a);
  const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
  return Math.abs(u) <= t.reach / 2 && Math.abs(v) <= t.w / 2 - trimW;
}
// samples along a move, every `step` mm
function* along(m, step = 0.5) {
  const L = Math.hypot(m.x - m.x0, m.y - m.y0), n = Math.max(1, Math.ceil(L / step));
  for (let i = 0; i <= n; i++) { const f = i / n; yield { x: m.x0 + (m.x - m.x0) * f, y: m.y0 + (m.y - m.y0) * f, z: m.z0 + (m.z - m.z0) * f }; }
}

async function runCase(c) {
  const s0 = Date.now();
  errors.length = 0;
  const setupInfo = await setup(c);
  await wait(500);
  if (process.env.DUMP) console.log(JSON.stringify(setupInfo.parts.map(q => [q.name, q.track, q.tabs.slice(0, 2).map(t => [t.z0, t.top])])));
  let text = '', made = 'ok';
  try { text = await exportText(); } catch (e) { made = e.message; }
  const concerns = await page.evaluate(() => (window.__swarfConcernsNow?.() || []).map(c => `${c.title}: ${c.body}`)).catch(() => []);
  if (process.env.DUMP) console.log('concerns', JSON.stringify(concerns.map(t => t.split(':')[0])));
  const r = { name: c.name, made, secs: 0, parts: setupInfo.parts.length, tabs: setupInfo.parts.reduce((n, p) => n + p.tabs.length, 0) };
  const ok = [];
  ok.push(check(made === 'ok' && text.length > 0, `${c.name}: file made`, { made }));
  if (made === 'ok' && text) {
    if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, c.name.replace(/[^\w.-]+/g, '_') + (c.device.includes('MR') ? '.nc' : '.sbp')), text); }
    ok.push(check(!/NaN|undefined|Infinity/.test(text), `${c.name}: no NaN in the file`));
    const p = P.parse(text, { machineUnits: c.units === 'in' ? 'in' : 'mm' });
    const cuts = p.moves.filter(m => !m.rapid);
    ok.push(check(cuts.length > 0, `${c.name}: the file cuts`));
    // the same job again: the same file
    const again = await exportText().catch(() => '');
    ok.push(check(again === text, `${c.name}: the same job gives the same file`, { a: text.length, b: again.length }));
    const parts = setupInfo.parts;
    const cb = P.cutBounds(p);
    const ux0 = Math.min(...parts.map(q => q.x0)), ux1 = Math.max(...parts.map(q => q.x1)), uy0 = Math.min(...parts.map(q => q.y0)), uy1 = Math.max(...parts.map(q => q.y1));
    // the file's frame: the cut's middle is the parts' middle; its zero on the tallest part's top
    const ox = (cb.min.x + cb.max.x) / 2 - (ux0 + ux1) / 2, oy = (cb.min.y + cb.max.y) / 2 - (uy0 + uy1) / 2;
    const tall = Math.max(...parts.map(q => q.h)), bed = -tall;
    const outl = setupInfo.ops.find(o => o.type === 'outline' && !o.inside) || setupInfo.ops.find(o => o.type === 'rough') || { dia: 6.35 };
    const rad = (outl.dia || 6.35) / 2;
    const isOutline = setupInfo.ops.some(o => o.type === 'outline' && !o.inside);
    const thru = isOutline ? (setupInfo.thru ?? 0.3) : 0;
    const drills = setupInfo.ops.some(o => o.type === 'drill');
    let deepest = Infinity; for (const m of cuts) if (m.z < deepest) deepest = m.z;
    r.minZ = +deepest.toFixed(3);
    // through: each part to the bed and the outline's allowance, no further (a drill's point aside)
    for (const q of parts) {
      const x0 = q.x0 + ox - rad - 0.5, x1 = q.x1 + ox + rad + 0.5, y0 = q.y0 + oy - rad - 0.5, y1 = q.y1 + oy + rad + 0.5;
      let lo = Infinity; for (const m of cuts) if (m.x >= x0 && m.x <= x1 && m.y >= y0 && m.y <= y1 && Math.hypot(m.x - m.x0, m.y - m.y0) > 0.05) lo = Math.min(lo, m.z, m.z0);
      ok.push(check(Math.abs(lo - (bed - thru)) <= 0.02 || (!isOutline && lo <= bed + 0.05 && lo >= bed - 0.05), `${c.name}: ${q.name} cut to the bed and ${thru} mm on (side cuts' floor ${lo.toFixed(3)}, want ${(bed - thru).toFixed(3)})`));
    }
    if (drills) {
      r.drillPast = +(bed - deepest).toFixed(2);
      // every hole drilled where it is on its part, every part's four, and no plunge anywhere else
      const want = parts.filter(q => q.kind === 'drilled').flatMap(q => [[-30, 0], [30, 0], [0, -20], [0, 20]].map(([dx, dy]) => ({ x: q.cx + dx + ox, y: q.cy + dy + oy, n: 0 })));
      const plunges = cuts.filter(m => Math.hypot(m.x - m.x0, m.y - m.y0) < 0.01 && m.z < bed - thru - 0.05);
      const stray = plunges.find(m => !want.some(h => Math.hypot(h.x - m.x, h.y - m.y) < 0.2 && ++h.n));
      ok.push(check(!stray, `${c.name}: every drill plunge on a hole`, stray && { at: [+stray.x.toFixed(2), +stray.y.toFixed(2)], holes: want.map(h => [+h.x.toFixed(1), +h.y.toFixed(1)]) }));
      ok.push(check(want.every(h => h.n > 0), `${c.name}: every hole drilled (${want.filter(h => h.n).length} of ${want.length})`));
    }
    else ok.push(check(deepest >= bed - Math.max(thru, 0) - 0.02, `${c.name}: nothing deeper than the bed and the allowance (${deepest.toFixed(3)})`));
    // tabs: on the bed, on the cut's path, never cut into
    const tabs = parts.flatMap(q => q.tabs.map(t => ({ ...t, part: q.name, fx: t.x + ox, fy: t.y + oy, fz0: bed + t.z0, ftop: bed + t.top })));
    for (const t of tabs) {
      ok.push(check(Math.abs(t.z0) < 0.05, `${c.name}: a tab on ${t.part} sits on the bed (its bottom ${t.z0.toFixed(2)} above it)`));
      let crossed = 0, into = null;
      for (const m of cuts) {
        if (Math.hypot(m.x - m.x0, m.y - m.y0) < 0.01) continue;
        for (const s of along(m)) {
          if (!inTab(t, s.x, s.y)) continue;
          crossed++;
          if (s.z < t.ftop - 0.05 && !into) into = { at: [+s.x.toFixed(1), +s.y.toFixed(1)], z: +s.z.toFixed(2), top: +t.ftop.toFixed(2), line: m.line };
        }
      }
      ok.push(check(crossed > 0, `${c.name}: a tab on ${t.part} lies on the cut's path`, { at: [+t.fx.toFixed(1), +t.fy.toFixed(1)] }));
      ok.push(check(!into, `${c.name}: no cut into a tab on ${t.part}`, into));
    }
    // every freed piece held: tabs on its edge, or concerns say it is loose / cut free with no tabs
    const said = concerns.some(t => /loose|no tabs|cut free/.test(t));
    if (c.tabs !== 'none' && isOutline) for (const q of parts) {
      const def = PARTS[q.kind] || PARTS[q.name];
      // a drawing whose island loads as a part of its own: each part checks the pieces of its size
      const qw = q.x1 - q.x0, qh = q.y1 - q.y0, size = pc => [pc.w ?? pc.d, pc.h ?? pc.d];
      const outer = def && def.pieces.find(pc => pc.kind === 'outer');
      const whole = !outer || (Math.abs(size(outer)[0] - qw) < 1 && Math.abs(size(outer)[1] - qh) < 1);
      const mine = ((def && def.pieces) || []).filter(pc => whole ? !(def.svg && pc.kind === 'island') : Math.abs(size(pc)[0] - qw) < 1 && Math.abs(size(pc)[1] - qh) < 1);
      for (const pc of mine) {
        const near = q.tabs.filter(t => {
          const lx = t.x - q.cx, ly = t.y - q.cy;
          if (pc.d) return Math.abs(Math.hypot(lx, ly) - pc.d / 2) < t.reach + 0.5;
          const ex = Math.abs(Math.abs(lx) - pc.w / 2), ey = Math.abs(Math.abs(ly) - pc.h / 2);
          return (ex < t.reach + 0.5 && Math.abs(ly) <= pc.h / 2 + 0.5) || (ey < t.reach + 0.5 && Math.abs(lx) <= pc.w / 2 + 0.5);
        }).length;
        r[`held_${pc.kind}`] = (r[`held_${pc.kind}`] || []).concat(near);
        ok.push(check(near > 0 || said, `${c.name}: the ${pc.kind} piece of ${q.name} has a tab, or concerns say it is loose`, { tabs: q.tabs.length, concerns }));
      }
    }
    if (c.tabs === 'none' && isOutline) ok.push(check(said, `${c.name}: no tabs: concerns say the part is cut free`, concerns));
    // rapids: over every part at or above its top
    let low = null;
    for (const m of p.moves) {
      if (!m.rapid || Math.hypot(m.x - m.x0, m.y - m.y0) < 0.05) continue;
      for (const s of along(m, 1)) {
        for (const q of parts) {
          if (s.x < q.x0 + ox - rad || s.x > q.x1 + ox + rad || s.y < q.y0 + oy - rad || s.y > q.y1 + oy + rad) continue;
          if (s.z < bed + q.h - 0.05 && !low) low = { part: q.name, z: +s.z.toFixed(2), top: +(bed + q.h).toFixed(2), line: m.line };
        }
      }
    }
    ok.push(check(!low, `${c.name}: every rapid across a part clears its top`, low));
    // order: after a part's last cut at its floor (the cut-out's last pass), nothing is cut inside it
    // (a last pass comes after the first passes' cut-out by design; concerns ask for tabs there)
    if (isOutline && !c.ops.some(o => o.lastpass)) for (const q of parts) {
      const def = PARTS[q.kind], shape = def && def.pieces.find(pc => pc.kind === 'outer');
      if (!shape || Math.abs((shape.w ?? shape.d) - (q.x1 - q.x0)) > 1) continue;
      const hole = def.pieces.find(pc => pc.kind === 'hole');
      const cx = q.cx + ox, cy = q.cy + oy;
      // how far a point is inside the outside edge (negative: outside it), and inside the hole's
      const inOuter = (x, y) => shape.d ? shape.d / 2 - Math.hypot(x - cx, y - cy) : Math.min(shape.w / 2 - Math.abs(x - cx), shape.h / 2 - Math.abs(y - cy));
      const inHole = (x, y) => !hole ? -Infinity : hole.d ? hole.d / 2 - Math.hypot(x - cx, y - cy) : Math.min(hole.w / 2 - Math.abs(x - cx), hole.h / 2 - Math.abs(y - cy));
      const material = (x, y) => inOuter(x, y) > rad + 1.5 && inHole(x, y) < -(rad + 1.5);
      let last = -1;
      p.moves.forEach((m, i) => { const d = inOuter(m.x, m.y); if (!m.rapid && m.z <= bed - thru + 0.02 && Math.hypot(m.x - m.x0, m.y - m.y0) > 0.05 && d < -rad + 1 && d > -rad - 1) last = i; });
      const later = last < 0 ? null : p.moves.slice(last + 1).find(m => !m.rapid && m.z < 0 && material(m.x, m.y) && material(m.x0, m.y0));
      const wrongOrder = setupInfo.ops.findIndex(o => o.type === 'outline' && !o.inside) < setupInfo.ops.length - 1;
      if (!wrongOrder) ok.push(check(!later, `${c.name}: nothing cut inside ${q.name} after its cut-out`, later && { line: later.line, z: later.z }));
      else r.afterCutout = !!later;
    }
    if (/wrong order/.test(c.name)) r.orderConcern = concerns.filter(t => /order|after|loose|before/.test(t));
    // feeds
    const top = setupInfo.feedMax > 0 ? setupInfo.feedMax / 60 : Infinity;
    const badFeed = cuts.find(m => !(m.feed > 0) || m.feed > top + 1e-6);
    ok.push(check(!badFeed, `${c.name}: every cut's feed above zero and at most the machine's ${(top * 60).toFixed(0)} mm/min`, badFeed && { feed: badFeed.feed, line: badFeed.line }));
    // the parser's own safety reads
    ok.push(check(!P.routerOffCut(p), `${c.name}: router on in the wood`, P.routerOffCut(p)));
  }
  ok.push(check(errors.length === 0, `${c.name}: no page errors`, errors.slice(0, 3)));
  r.secs = Math.round((Date.now() - s0) / 1000);
  r.pass = ok.every(Boolean);
  rows.push(r);
  console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${c.name.padEnd(44)} ${String(r.secs).padStart(4)}s parts ${r.parts} tabs ${r.tabs} minZ ${r.minZ}${r.drillPast != null ? ' drill past bed ' + r.drillPast : ''}${r.afterCutout != null ? ' cut after cut-out ' + r.afterCutout : ''}${r.orderConcern ? ' concerns ' + JSON.stringify(r.orderConcern) : ''}`);
  return made;
}

try {
  await boot();
  const list = cases.filter(c => !FILTER || FILTER.test(c.name));
  console.log(`${list.length} cases`);
  for (const c of list) {
    let made;
    try { made = await runCase(c); } catch (e) { check(false, `${c.name}: case ran: ${e.message}`); made = 'crash'; }
    if (made !== 'ok') await boot();
  }
} finally {
  if (browser) await browser.close().catch(() => {});
}
console.log(`${rows.length} cases in ${Math.round((Date.now() - t0) / 1000)} s`);
console.log(bad.length ? `cut-out torture: ${bad.length} FAIL in ${rows.filter(r => !r.pass).length} of ${rows.length} cases` : `cut-out torture: ok (${rows.length} cases)`);
process.exit(bad.length ? 1 : 0);
