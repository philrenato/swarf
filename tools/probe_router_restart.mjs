// The router comes back on after every bit change (review 105 stop-ship, its reduced case SP-d: two
// boards with an inlay pocket each and an outline on another bit; the second board's pocket went in with
// the router off). Exported in both orders, read by control's own reader.
//   node tools/probe_router_restart.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const url = process.argv[2] || 'http://localhost:8080/kiri/';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 600000, userDataDir: mkdtempSync(join(tmpdir(), 'swarf-router-')) });
const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
page.on('pageerror', e => errors.push(e.message));
const logs = []; page.on('console', m => logs.push(m.type() + ' ' + m.text().slice(0, 240)));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfTex), { timeout: 90000, polling: 200 });
await wait(1500);
await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(600);
await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); const s = a.conf.get(); s.process.ops = []; a.conf.save(); });
const board = name => page.evaluate(name => window.kiri.api.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="100mm" viewBox="0 0 120 100"><rect width="120" height="100"/></svg>', name, { depth: 19, soup: true, dpi: 0 }), name);
await board('board a'); await wait(1500);
await board('board b'); await wait(1500);
await page.evaluate(() => { const a = window.kiri.api, [p, q] = a.widgets.all(); p.move(-70, 0, 0); q.move(70, 0, 0); a.platform.select(p); a.platform.select(q); });
await wait(400);
await page.click('#swarf-step-tex'); await page.waitForFunction(() => window.__swarfTex.state()?.parts?.length === 2, { timeout: 15000 });
// a pocket on each board: the review's reduced case (SP-d)
for (const i of [0, 1]) {
  await page.evaluate(i => {
    const S = window.__swarfTex.state(), C = window.SwarfTexCore, p = S.parts[i];
    const cx = (p.box[0] + p.box[2]) / 2, cy = (p.box[1] + p.box[3]) / 2;
    const g = C.newGrid(p.box[0] - 2, p.box[1] - 2, p.box[2] + 2, p.box[3] + 2, 0.5);
    C.paintWhere(g, (x, y) => Math.hypot(x - cx, y - cy) < 20, 1);
    p.marks.push({ id: 'in' + i, made: 'region', region: g, xf: C.IDENTITY.slice(), fill: C.newFill('waves'), ver: 1 }); S.sel = i; S.mark = p.marks.length - 1; p.dirty = true;
    window.__swarfTex.render();
  }, i);
  await wait(400);
  await page.click('.tx-fill[data-fill="inlay"]'); await wait(1500);
}
await page.click('#tx-done'); await wait(2500);
// the pockets on one bit, an outline on another; and the other way about
await page.evaluate(() => { const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
await wait(500);
// the file, read in node by control's own reader (control's scripts load when control opens)
const w = { console, performance }; w.window = w; vm.createContext(w);
vm.runInContext(readFileSync(new URL('../web/kiri/swarf-run-parse.js', import.meta.url), 'utf8'), w);
const P = w.SwarfRunParse;
const read = async order => {
  await page.evaluate(order => {
    const a = window.kiri.api, s = a.conf.get(), ops = s.process.ops, oo = ops.find(o => o.type === 'outline'), io = ops.find(o => o.type === 'inlay');
    oo.tool = s.tools.find(t => t.type === 'endmill' && t.id !== io.tool).id;
    if (order === 'outline first') { ops.splice(ops.indexOf(oo), 1); ops.splice(ops.indexOf(io), 0, oo); }
    a.conf.save(); document.getElementById('act-clear').click();
  }, order);
  await wait(800);
  const pv = await page.evaluate(() => new Promise(res => { const e = window.kiri.api.event; e.on('preview.end', () => res('end')); e.on('preview.error', x => res('error ' + x)); document.getElementById('act-paths').click(); setTimeout(() => res('timeout'), 150000); }));
  check(pv === 'end', `${order}: toolpaths made (${pv})`);
  if (pv !== 'end') {
    console.log(logs.slice(-15).join('\n'));
    console.log(JSON.stringify(await page.evaluate(() => { const a = window.kiri.api; return { view: a.view.get(), status: a.ui.prostatus?.innerText, busy: !a.ui.progressOverlay?.classList.contains('hide'), ops: a.conf.get().process.ops.map(o => [o.type, o.tool, o.down, o.depth]), parts: a.widgets.all().map(w => [w.meta.file, !!w.meta.disabled]), alert: document.getElementById('alert-area')?.innerText?.trim().slice(0, 300) }; })));
    await browser.close(); process.exit(1);
  }
  await wait(800);
  const text = await page.evaluate(() => new Promise(res => { window.kiri.api.function.export(g => res(typeof g === 'string' ? g : g?.gcode || String(g))); setTimeout(() => res(''), 120000); }));
  const p = P.parse(text, { machineUnits: 'mm' });
  return { changes: p.events.filter(e => e.kind === 'tool-change').length, on: p.events.filter(e => e.kind === 'spindle-on').length, dead: P.routerOffCut(p), cuts: p.moves.filter(m => !m.rapid && m.z < -0.05).length };
};
for (const order of ['pockets first', 'outline first']) {
  const r = await read(order);
  console.log(order, JSON.stringify(r));
  check(r.cuts > 10, `${order}: the file cuts (${r.cuts})`);
  check(r.changes >= 1, `${order}: the bit changes (${r.changes})`);
  check(!r.dead, `${order}: the router is on for every cut (${JSON.stringify(r.dead)})`);
  check(r.on >= r.changes, `${order}: switched on after each change (${r.on} on, ${r.changes} changes)`);
}
check(!errors.length, `no page errors: ${errors.slice(0, 3).join(' | ')}`);
await browser.close();
console.log(bad.length ? `FAILED ${bad.length}` : 'ALL OK');
process.exit(bad.length ? 1 : 0);
