// a pocket with no floor picked cuts nothing and used to look done (review 105 F4): concerns says so.
// Toolpaths with no step adds a rough and says so (review 105 F5).
//   node tools/probe_empty_pocket.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const url = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-pocket-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.SwarfLength), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(600);
  await page.evaluate(() => { window.kiri.api.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80"><rect width="120" height="80"/></svg>', 'board', { depth: 19, soup: true, dpi: 0 }); }); await wait(1500);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); });
  // toolpaths with no step: rough added, out loud
  await page.evaluate(() => { const a = window.kiri.api, old = a.show.alert; window.__said = []; a.show.alert = function (t) { window.__said.push(String(t)); return old.apply(this, arguments); }; });
  await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); document.getElementById('act-paths').click(); setTimeout(res, 60000); })); await wait(800);
  const said = await page.evaluate(() => ({ said: window.__said, ops: window.kiri.api.conf.get().process.ops.map(o => o.type) }));
  check(said.ops.includes('rough'), `rough was added (${said.ops})`);
  check(said.said.some(t => /added rough/.test(t)), `and said so (${JSON.stringify(said.said)})`);
  await page.evaluate(() => document.getElementById('act-clear').click()); await wait(800);
  const says = () => page.evaluate(() => { document.dispatchEvent(new Event('swarf-concerns-refresh')); return document.body.textContent.includes('a pocket has nothing to clear'); });
  check(!(await says()), 'no pocket, no concern');
  await page.evaluate(() => [...document.querySelectorAll('button,span,div')].find(b => b.offsetParent && b.children.length === 0 && b.textContent.trim() === 'pocket').click()); await wait(1200);
  check(await says(), 'an empty pocket raises the concern');
  check(!errors.length, `no page errors (${errors.join(' | ')})`);
} catch (e) { check(false, 'threw: ' + e.message); }
await browser.close();
console.log(bad.length ? `empty pocket: ${bad.length} failed` : 'empty pocket: ok');
process.exit(bad.length ? 1 : 0);
