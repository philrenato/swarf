// Contour torture on real relief parts: reliefs made here as STLs whose heights are known (smooth
// waves, terraces with vertical walls, a spike narrower than the bit, a pit, a part smaller than the
// bit, a sign-sized panel), cut by a contour at every pattern (lines at 0 to 180, cross, rings, inside
// only), stepovers from a hundredth of the bit to more than the bit, flat, ball, V and tiny bits. The
// file is read the way control reads it, and:
//   made in time; the file has cuts; no NaN; no rapid sideways below the top of the board
//   no cut into the relief: the bit's tip, all along every cut, is above every point of the relief
//     under the bit (its own shape: flat, ball, V), to within the raster the contour samples on
//   never below the part's bottom; the cut within the part and a bit (inside only: within the part)
//   no cut into a tab's top
//   the one-pass concern: said for a contour over the edge with nothing before it that clears round
//     the part (none, a pocket, an inside outline, a rough switched off); not said after a rough
//   the same job twice makes the same file
//   node tools/probe_torture_contour.mjs [url] [filter]
import puppeteer from 'puppeteer-core';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const P = createRequire(import.meta.url)('../web/kiri/swarf-run-parse.js');
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const FILTER = process.argv[3] ? new RegExp(process.argv[3]) : null;
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], rows = [], errors = [];
const check = (ok, what, info) => { if (!ok) { console.log('FAIL', what, info !== undefined ? JSON.stringify(info) : ''); bad.push(what); } return ok; };

// ---- reliefs -----------------------------------------------------------------------------------
const tmp = mkdtempSync(join(tmpdir(), 'swarf-contour-torture-'));
function stl(tris) {
  const b = Buffer.alloc(84 + tris.length * 50); b.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => { const o = 84 + i * 50 + 12; t.forEach((v, k) => b.writeFloatLE(v, o + k * 4)); });
  return b;
}
// a closed heightfield solid, z = f(x, y) on its top over an nx by ny grid; returns the STL and the
// grid of heights the top is made of (the surface between them is flat triangles)
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
  return { buf: stl(T), w, h, nx, ny, f, top: Math.max(...Array.from({ length: (nx + 1) * (ny + 1) }, (_, k) => Z(k % (nx + 1), Math.floor(k / (nx + 1))))) };
}
const parts = {
  waves: relief(120, 80, 120, 80, (x, y) => 8 + 4 * Math.sin(x / 7) * Math.cos(y / 9)),
  // terraces: walls straight up, the steps narrower than some bits
  terraces: relief(100, 60, 200, 120, (x, y) => 4 + 3 * (Math.floor(x / 12) % 3) + (y > 30 && y < 34 ? 6 : 0)),
  // a cone 3 mm across at its foot and 14 mm tall on a low plinth: narrower than the bit
  spike: relief(60, 60, 120, 120, (x, y) => { const r = Math.hypot(x - 30, y - 30); return 3 + Math.max(0, 14 - r * 14 / 1.5); }),
  // a pit 3 mm wide in a flat top: no bit fits it, and none may cut its rim
  pit: relief(50, 40, 100, 80, (x, y) => (Math.abs(x - 25) < 1.5 && Math.abs(y - 20) < 8) ? 1.5 : 10),
  // smaller than a 1/4 in bit
  tiny: relief(5, 4, 20, 16, (x, y) => 2 + Math.sin(x) * 0.5 + y / 8),
  // a sign: the raster follows the part's size
  panel: relief(600, 400, 150, 100, (x, y) => 10 + 6 * Math.sin(x / 40) * Math.cos(y / 30)),
};
for (const [n, p] of Object.entries(parts)) { p.file = join(tmp, `${n}-relief.stl`); writeFileSync(p.file, p.buf); }

// ---- cases -------------------------------------------------------------------------------------
const T = { e116: 1002, e18: 1001, e14: 1000, b18: 1004, b14: 1018, v90: 1105 };
const cases = [];
const add = (name, part, ops, o = {}) => cases.push({ name, part, ops, tabs: o.tabs || 'none', concern: o.concern, twice: o.twice });
for (const [w, set] of [['lines 0', { pattern: 'lines', lineAngle: 0 }], ['lines 17', { pattern: 'lines', lineAngle: 17 }], ['lines 90', { pattern: 'lines', lineAngle: 90 }],
  ['lines 133', { pattern: 'lines', lineAngle: 133 }], ['lines 179.5', { pattern: 'lines', lineAngle: 179.5 }], ['lines 180', { pattern: 'lines', lineAngle: 180 }],
  ['cross 30', { pattern: 'cross', lineAngle: 30 }], ['perimeter', { pattern: 'perimeter' }], ['perimeter inside', { pattern: 'perimeter', inside: true }], ['lines 61 inside', { pattern: 'lines', lineAngle: 61, inside: true }]])
  add(`waves contour b14 ${w}`, 'waves', [{ type: 'contour', tool: T.b14, set }], { twice: w === 'lines 17' });
for (const [bit, b] of [['e18', T.e18], ['v90', T.v90], ['e116', T.e116], ['b18', T.b18]]) for (const w of ['lines 37', 'perimeter']) {
  const set = w === 'perimeter' ? { pattern: 'perimeter' } : { pattern: 'lines', lineAngle: 37 };
  add(`terraces contour ${bit} ${w}`, 'terraces', [{ type: 'contour', tool: b, set }]);
  add(`spike contour ${bit} ${w}`, 'spike', [{ type: 'contour', tool: b, set }]);
}
for (const step of [0.05, 1.2, 3]) {
  add(`pit contour e18 lines 45 step ${step}`, 'pit', [{ type: 'contour', tool: T.e18, set: { pattern: 'lines', lineAngle: 45, step } }]);
  add(`pit contour b14 perimeter step ${step}`, 'pit', [{ type: 'contour', tool: T.b14, set: { pattern: 'perimeter', step } }]);
}
// a part smaller than the bit: angled lines and rings sample a grid no finer than a hundredth of
// the bit, so every bit finishes in seconds there
for (const w of ['lines 0', 'lines 45', 'perimeter', 'perimeter inside']) {
  const [pattern, a] = w.split(' ');
  for (const t of ['e116', 'b14', 'v90'])
    add(`tiny contour ${t} ${w}`, 'tiny', [{ type: 'contour', tool: T[t], set: { pattern, lineAngle: +a || 0, inside: /inside/.test(w) } }]);
}
add('panel contour b14 lines 150', 'panel', [{ type: 'contour', tool: T.b14, set: { pattern: 'lines', lineAngle: 150 } }]);
// tabs left by a rough, ridden over by every pattern
for (const w of ['lines 45', 'cross 20', 'perimeter'])
  add(`waves rough e14 + contour b14 ${w} tabs`, 'waves', [{ type: 'rough', tool: T.e14 }, { type: 'contour', tool: T.b14, set: { pattern: w.split(' ')[0], lineAngle: +w.split(' ')[1] || 0 } }], { tabs: 'auto', concern: false });
// the one-pass concern's inputs
add('waves pocket + contour (concern)', 'waves', [{ type: 'pocket', tool: T.e14 }, { type: 'contour', tool: T.b14, set: { pattern: 'lines', lineAngle: 45 } }], { concern: true });
add('waves outline inside + contour (concern)', 'waves', [{ type: 'outline', tool: T.e14, inside: true, set: { outside: false } }, { type: 'contour', tool: T.b14, set: { pattern: 'perimeter' } }], { concern: true });
add('waves rough off + contour (concern)', 'waves', [{ type: 'rough', tool: T.e14, set: { disabled: true } }, { type: 'contour', tool: T.b14, set: { pattern: 'perimeter' } }], { concern: true });
add('waves contour inside (no concern)', 'waves', [{ type: 'contour', tool: T.b14, set: { pattern: 'perimeter', inside: true } }], { concern: false });

// ---- run ---------------------------------------------------------------------------------------
let browser, page;
async function boot() {
  if (browser) await browser.close().catch(() => {});
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmp, 'profile-')), protocolTimeout: 900000, args: ['--window-size=1440,900'] });
  page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfAutoTabs && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 250 });
  await wait(1500);
}
const within = (p, ms, what) => Promise.race([p, wait(ms).then(() => { throw new Error(`${what}: no answer in ${ms / 1000} s`); })]);

async function makeFile(c) {
  await page.evaluate(() => { window.__tortureDone = null; const e = kiri.api.event; e.on('preview.end', () => window.__tortureDone = window.__tortureDone || 'ok'); e.on('preview.error', x => window.__tortureDone = 'error ' + x); document.getElementById('act-paths')?.click(); });
  let made;
  try { await page.waitForFunction(() => !!window.__tortureDone, { timeout: 420000, polling: 500 }); made = await page.evaluate(() => window.__tortureDone); }
  catch (e) { made = 'timeout: no toolpaths in 420 s'; }
  let text = '';
  if (made === 'ok') {
    try { text = await within(page.evaluate(() => new Promise(res => kiri.api.function.export(g => res(typeof g === 'string' ? g : (g?.gcode || String(g)))))), 240000, 'export'); }
    catch (e) { made = e.message; }
  }
  return { made, text };
}

async function runCase(c) {
  const t0 = Date.now();
  errors.length = 0;
  const part = parts[c.part];
  await page.evaluate(() => { const a = kiri.api; a.platform.clear(); a.conf.get().process.ops = []; a.conf.save(); });
  await page.evaluate(() => kiri.api.devices.select('ShopBot.Basic')); await wait(700);
  const input = await page.$('#load-file');
  await input.uploadFile(part.file);
  await page.waitForFunction(() => kiri.api.widgets.all().length >= 1 || document.querySelector('.swarf-stl-units'), { timeout: 180000, polling: 300 });
  await wait(800);
  // the reliefs are drawn in mm: a tiny one must not be read as inches
  await page.evaluate(() => {
    const r = document.querySelector('.swarf-stl-units input[type=radio][value=mm]');
    if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); r.click(); }
    [...document.querySelectorAll('.swarf-stl-units button')].find(b => b.textContent === 'done')?.click();
  });
  await page.waitForFunction(() => kiri.api.widgets.all().length >= 1, { timeout: 180000, polling: 300 });
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
      window.__swarfAutoTabs.set({ density: 0, scale: 0, pin: {} });
      window.__swarfAutoTabs.place();
    }
    a.conf.save(); a.event.emit('cam.op.render');
    const ws = a.widgets.all(), b = ws[0].getBoundingBox();
    const box = { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z };
    const tabList = (a.widgets.annotate(ws[0].id).tab || []).map(t => ({ x: t.pos.x, y: t.pos.y, top: t.pos.z + t.dim.z / 2, half: Math.min(t.dim.x, t.dim.y) / 2 }));
    const contour = s.process.ops.find(o => o.type === 'contour');
    const t = contour && s.tools.find(t => t.id === contour.tool);
    const unit = t && !t.metric ? 25.4 : 1;
    const tool = t ? { type: t.type, d: t.flute_diam * unit, len: t.flute_len * unit, tip: (t.taper_tip || 0) * unit } : null;
    return { box, tabList, tool, inside: !!(contour && contour.inside), step: contour && contour.step, ops: s.process.ops.filter(o => o.type !== '|').map(o => o.type + (o.disabled ? ' (off)' : '')) };
  }, c.ops, c.tabs);
  await wait(700);
  const { made, text } = await makeFile(c);
  const concerns = await page.evaluate(() => (window.__swarfConcernsNow?.() || []).map(c => `${c.title}: ${c.body}`)).catch(() => []);
  const r = { name: c.name, secs: Math.round((Date.now() - t0) / 1000), made, ...setup };
  const ok = [];
  ok.push(check(made === 'ok', `${c.name}: toolpaths made`, { made }));
  if (c.concern !== undefined) {
    const said = concerns.some(t => /deep beside the part in one pass/.test(t));
    ok.push(check(said === c.concern, `${c.name}: the one-pass concern ${c.concern ? 'is' : 'is not'} said`, concerns));
  }
  if (made === 'ok') {
    const p = P.parse(text), cuts = p.moves.filter(m => !m.rapid);
    const board = setup.box.z;
    ok.push(check(cuts.length > 0, `${c.name}: the file cuts`));
    ok.push(check(!/NaN|undefined|Infinity/.test(text), `${c.name}: no NaN in the file`));
    const dive = P.rapidAcross(p);
    ok.push(check(!dive, `${c.name}: no rapid sideways below the top`, dive));
    // the contour's own moves: after the last rapid that brings in its bit (the contour is the last step)
    const isContourOnly = c.ops.every(q => q.type === 'contour');
    let lo = Infinity; for (const m of cuts) lo = Math.min(lo, m.z);
    r.minZ = +(lo + board).toFixed(3);
    if (isContourOnly) ok.push(check(lo >= -board - 0.05, `${c.name}: never below the part's bottom`, r.minZ));
    // inside the part and a bit (inside only: the bit's centre on the part)
    if (isContourOnly && setup.tool) {
      // over the edge the contour's clip is the part grown by the bit's radius and three raster cells
      // (angled lines and rings: the grid is no finer than a hundredth of the bit)
      const res = Math.max(0.05, 1 / Math.sqrt(500000 / (setup.box.x * setup.box.y)), setup.tool.d / 100);
      const R = setup.tool.d / 2, m0 = setup.inside ? 0.05 : R + 3 * res + 0.1;
      const out = cuts.find(m => m.x < -m0 || m.y < -m0 || m.x > setup.box.x + m0 || m.y > setup.box.y + m0);
      ok.push(check(!out, `${c.name}: the cut within the part${setup.inside ? '' : ' and a bit'}`, out && { x: out.x, y: out.y, line: out.line }));
    }
    // no cut into the relief: the tip against every height of the part's grid under the bit, the
    // bit's own shape, allowing the contour's raster (its cell sideways, read at a cell corner)
    if (setup.tool && isContourOnly) {
      const { type, d, len, tip } = setup.tool, R = d / 2;
      // (angled lines and rings: the grid is no finer than a hundredth of the bit)
      const res = Math.max(0.05, 1 / Math.sqrt(500000 / (setup.box.x * setup.box.y)), setup.tool.d / 100);
      const slack = 2 * res + 0.05;
      const zoff = dist => type === 'ballmill' ? Math.sqrt(Math.max(0, R * R - dist * dist)) - R
        : (type === 'tapermill' && dist > tip / 2) ? -((dist - tip / 2) / (R - tip / 2)) * len : 0;
      // the part as loaded: an STL the units card read as inches is the same relief, larger
      const k = setup.box.x / part.w;
      const gx = k * part.w / part.nx, gy = k * part.h / part.ny, fz = (x, y) => k * part.f(x / k, y / k);
      const need = (x, y) => {
        const rr = R - slack;
        let z = 0;
        if (rr <= 0) return z;
        for (let i = Math.max(0, Math.floor((x - rr) / gx)); i <= Math.min(part.nx, Math.ceil((x + rr) / gx)); i++) for (let j = Math.max(0, Math.floor((y - rr) / gy)); j <= Math.min(part.ny, Math.ceil((y + rr) / gy)); j++) {
          const dist = Math.hypot(i * gx - x, j * gy - y);
          if (dist > rr) continue;
          z = Math.max(z, fz(i * gx, j * gy) + zoff(Math.min(R, dist + slack)));
        }
        return z;
      };
      let worst = { deep: 0 }, samples = 0;
      const every = Math.max(1, Math.floor(cuts.length / 6000));
      for (let k = 0; k < cuts.length; k += every) {
        const m = cuts[k], len2 = Math.hypot(m.x - m.x0, m.y - m.y0), n = Math.min(20, Math.max(1, Math.ceil(len2 / 0.5)));
        for (let j = 0; j <= n; j++) {
          const f = j / n, x = m.x0 + (m.x - m.x0) * f, y = m.y0 + (m.y - m.y0) * f, z = m.z0 + (m.z - m.z0) * f + board;
          const deep = need(x, y) - z;
          samples++;
          if (deep > worst.deep) worst = { deep: +deep.toFixed(3), at: [+x.toFixed(2), +y.toFixed(2)], z: +z.toFixed(3), line: m.line };
        }
      }
      r.gouge = worst.deep;
      ok.push(check(worst.deep <= 0.1, `${c.name}: no cut into the relief (${samples} points)`, worst));
    }
    // no cut into a tab: a cut whose centre is over a tab stays at its top
    if (setup.tabList.length) {
      let worst = null;
      for (const t of setup.tabList) {
        const cx = t.x + setup.box.x / 2, cy = t.y + setup.box.y / 2, h = Math.max(0, t.half - 0.5);
        for (const m of cuts) if (Math.abs(m.x - cx) < h && Math.abs(m.y - cy) < h && m.z + board < t.top - 0.05) { worst = { at: [+m.x.toFixed(1), +m.y.toFixed(1)], z: +(m.z + board).toFixed(2), top: +t.top.toFixed(2) }; break; }
        if (worst) break;
      }
      ok.push(check(!worst, `${c.name}: no cut into a tab`, worst));
    }
    if (c.twice) {
      const again = await makeFile(c);
      ok.push(check(again.made === 'ok' && again.text === text, `${c.name}: the same job twice makes the same file`, { made: again.made, same: again.text === text }));
    }
    r.cuts = cuts.length;
  }
  ok.push(check(errors.length === 0, `${c.name}: no page errors`, errors.slice(0, 3)));
  r.pass = ok.every(Boolean);
  rows.push(r);
  console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${c.name.padEnd(52)} ${String(r.secs).padStart(4)}s part ${setup.box.x.toFixed(1)}x${setup.box.y.toFixed(1)}x${setup.box.z.toFixed(1)} cuts ${r.cuts ?? '-'} floor ${r.minZ ?? '-'}${r.gouge != null ? ' gouge ' + r.gouge.toFixed(3) : ''}`);
  return made;
}

const T0 = Date.now();
try {
  await boot();
  const list = cases.filter(c => !FILTER || FILTER.test(c.name));
  console.log(`${list.length} cases`);
  for (const c of list) {
    let made;
    try { made = await runCase(c); }
    catch (e) { check(false, `${c.name}: case ran: ${e.message}`); made = 'crash'; }
    if (made !== 'ok' && made !== undefined && !/^error/.test(made)) await boot();
  }
} finally {
  if (browser) await browser.close().catch(() => {});
}
const secs = Math.round((Date.now() - T0) / 1000);
console.log(bad.length ? `contour torture: ${bad.length} FAIL in ${rows.filter(r => !r.pass).length} of ${rows.length} cases, ${secs} s` : `contour torture: ok (${rows.length} cases, ${secs} s)`);
process.exit(bad.length ? 1 : 0);
