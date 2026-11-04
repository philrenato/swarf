// A ramp's feed (Phil 11-04: "Air cut is going VERY slow"): export held any move that went down at all
// to the plunge speed, so a 260 mm ramp dropping 1.8 mm ran at 5 mm/s. The plunge speed holds the Z
// motion now. On a rough with ramps, a rough plunging straight down and a stone texture: no move
// descends faster than the plunge speed; a shallow ramp runs faster than it; a straight plunge runs at it.
//   node tools/probe_ramp_feed.mjs [url]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome-path.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Parse = require('../web/kiri/swarf-run-parse.js');
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
// every cutting move that goes down: its length, drop, feed (mm/s) and Z speed
const downs = text => Parse.parse(text, { machineUnits: 'mm' }).moves.filter(m => !m.rapid && m.z < m.z0 - 1e-6).map(m => {
  const L = Math.hypot(m.x - m.x0, m.y - m.y0, m.z - m.z0), dz = m.z0 - m.z;
  return { xy: Math.hypot(m.x - m.x0, m.y - m.y0), feed: m.feed, zs: m.feed * dz / L };
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfTex && window.SwarfTexCore && window.SwarfEstimateUI), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); const s = a.conf.get(); s.process.ops = []; a.conf.save(); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="127mm" height="254mm" viewBox="0 0 127 254"><rect width="127" height="254" fill="#000"/></svg>', 'board', { depth: 12.7, resolution: 2, soup: true, dpi: 0 }); });
  await wait(1200);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'rough'); el && el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(500);
  // the file for the toolpaths made now
  const file = () => page.evaluate(() => new Promise(res => {
    const a = window.kiri.api, done = () => setTimeout(() => a.function.estimateFile(t => res(t)), 400);
    a.event.on('preview.end', done); a.function.prepare();
  }));
  const plunge = await page.evaluate(() => { const o = window.kiri.api.conf.get().process; return Math.min(o.ops[0].plunge, o.camFastFeedZ) / 60; });
  const ease = await page.evaluate(() => { const o = window.kiri.api.conf.get().process; o.ops[0].plunge = o.camFastFeedZ; o.camEaseDown = true; return o.ops[0].rate / 60; });
  const rough = await file();
  const a = downs(rough);
  const ramps = a.filter(d => d.xy > 20);
  console.log(`    ramps: ${ramps.length}, ${ramps[0]?.feed.toFixed(1)} mm/s; plunge ${plunge.toFixed(1)} mm/s; cut ${ease.toFixed(1)} mm/s`);
  check(ramps.length > 2 && ramps.every(d => d.feed > plunge * 1.5), 'a shallow ramp runs faster than the plunge speed');
  check(ramps.every(d => d.feed <= ease + 0.01), 'and no faster than the cut');
  // the motors run rough under 25 mm/s: a cut set above that stays above it on its ramps and full-width passes
  check(ease < 25 || ramps.every(d => d.feed >= 24.9), `ramps stay above the rough band (${Math.min(...ramps.map(d => d.feed)).toFixed(1)} mm/s)`);
  const flats = Parse.parse(rough, { machineUnits: 'mm' }).moves.filter(m => !m.rapid && m.z === m.z0 && m.feed);
  check(ease < 25 || flats.every(d => d.feed >= 24.9), `and so do the flat passes (${Math.min(...flats.map(d => d.feed)).toFixed(1)} mm/s)`);
  check(a.every(d => d.zs <= plunge * 1.01), `no move in it descends faster than the plunge speed (fastest ${Math.max(...a.map(d => d.zs)).toFixed(2)} mm/s)`);

  // no ramps: the bit goes straight down at the plunge speed
  await page.evaluate(() => { window.kiri.api.conf.get().process.camEaseDown = false; window.kiri.api.view.set_arrange(); });
  await wait(500);
  const b = downs(await file());
  const straight = b.filter(d => d.xy < 1e-6);
  check(straight.length > 0 && straight.every(d => Math.abs(d.feed - plunge) < 0.05), `a straight plunge runs at the plunge speed (${straight[0]?.feed.toFixed(2)} mm/s)`);
  await page.evaluate(() => { window.kiri.api.conf.get().process.camEaseDown = true; window.kiri.api.view.set_arrange(); });
  await wait(500);

  // a texture goes up and down in short steps: downhill ones keep the feed unless steep
  await page.click('#swarf-step-tex');
  await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 15000 });
  await page.evaluate(() => {
    const S = window.__swarfTex.state(), C = window.SwarfTexCore, p = S.parts[0];
    S.sel = 0;
    const g = C.newGrid(p.box[0] - 2, p.box[1] - 2, p.box[2] + 2, p.box[3] + 2, 0.5);
    C.paintWhere(g, (x, y) => x > p.box[0] + 30 && x < p.box[0] + 90 && y > p.box[1] + 30 && y < p.box[1] + 90, 1);
    p.marks.push({ id: 'rf', made: 'region', region: g, xf: C.IDENTITY.slice(), fill: C.newFill('stone', { tool: 1018, origin: [0, 0] }), ver: 1 });
    S.mark = 0; p.dirty = true;
  });
  await page.click('#tx-done');
  await wait(1000);
  const c = downs(await file());
  check(c.length > 50 && c.every(d => d.zs <= plunge * 1.01), `a texture's ${c.length} downhill moves stay under the plunge speed (fastest ${Math.max(...c.map(d => d.zs)).toFixed(2)} mm/s)`);
  const quick = c.filter(d => d.feed > plunge * 1.5).length;
  check(quick > c.length / 2, `and most keep their feed (${quick} of ${c.length} faster than the plunge speed)`);
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `ramp feed: ${bad.length} failed, ${errors.length} page errors` : 'ramp feed: ok');
process.exit(bad.length || errors.length ? 1 : 0);
