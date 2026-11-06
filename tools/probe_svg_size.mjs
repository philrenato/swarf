// an SVG comes in at the size it says (review 105 F1: width="8in" viewBox="0 0 203.2 127" came in 25.4
// times too big), the import card says that size before the parts are made, and a kept drawing agrees.
//   node tools/probe_svg_size.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const url = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const dir = mkdtempSync(join(tmpdir(), 'swarf-svg-'));
const rect = (w, h) => `<path d="M0 0H${w}V${h}H0Z"/>`;
const CASES = [
  ['inch width, mm viewBox', '<svg xmlns="http://www.w3.org/2000/svg" width="8in" height="5in" viewBox="0 0 203.2 127">' + rect(203.2, 127) + '</svg>', 203.2, 127, true],
  ['inch width, point viewBox', '<svg xmlns="http://www.w3.org/2000/svg" width="4in" height="2in" viewBox="0 0 288 144">' + rect(288, 144) + '</svg>', 101.6, 50.8, true],
  ['inch width, inch viewBox', '<svg xmlns="http://www.w3.org/2000/svg" width="4in" height="2in" viewBox="0 0 4 2">' + rect(4, 2) + '</svg>', 101.6, 50.8, true],
  ['mm width, tenth-mm viewBox, offset', '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="10 10 1000 500"><path d="M10 10H1010V510H10Z"/></svg>', 100, 50, true],
  ['mm width, mm viewBox', '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50">' + rect(100, 50) + '</svg>', 100, 50, true],
  ['points, point viewBox', '<svg xmlns="http://www.w3.org/2000/svg" width="72pt" height="36pt" viewBox="0 0 72 36">' + rect(72, 36) + '</svg>', 25.4, 12.7, true],
  ['no units', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60">' + rect(120, 60) + '</svg>', 120, 60, false],
];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-svgp-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.SwarfLength), { timeout: 90000, polling: 200 });
  await wait(1500);
  const input = await page.$('#load-file');
  let n = 0;
  const load = async (svg, name) => {
    const f = join(dir, `${name}-${++n}.svg`); writeFileSync(f, svg);
    const had = await page.evaluate(() => window.kiri.api.widgets.all().length);
    await input.uploadFile(f);
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.offsetParent && b.textContent.trim() === 'make parts'), { timeout: 15000 });
    const say = await page.evaluate(() => document.querySelector('.swarf-import-size')?.textContent || '');
    await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.trim() === 'make parts').click());
    await page.waitForFunction(k => window.kiri.api.widgets.all().length > k, { timeout: 15000 }, had); await wait(500);
    return say;
  };
  for (const [what, svg, w, h, real] of CASES) {
    await page.evaluate(() => { const a = window.kiri.api; a.platform.clear(); }); await wait(300);
    const say = await load(svg, 'c');
    const box = await page.evaluate(() => { const b = window.kiri.api.widgets.all()[0].getBoundingBox(); return [b.max.x - b.min.x, b.max.y - b.min.y]; });
    check(Math.abs(box[0] - w) < 0.05 && Math.abs(box[1] - h) < 0.05, `${what}: ${box.map(v => v.toFixed(2))} mm, wanted ${w} × ${h}`);
    check(say.includes(`${+w.toFixed(1)}`) || say.includes(`${w}`), `${what}: the card says it first ("${say}")`);
    check(real === !/no real units/.test(say), `${what}: the card ${real ? 'does not warn' : 'warns of no real units'}`);
  }
  // two parts from an inch/mm file: each keeps its own shapes, in mm, and DRAW reads them at that size
  await page.evaluate(() => window.kiri.api.platform.clear()); await wait(300);
  await load('<svg xmlns="http://www.w3.org/2000/svg" width="8in" height="2in" viewBox="0 0 203.2 50.8"><path d="M0 0H40V40H0Z"/><path d="M100 0H180V40H100Z"/></svg>', 'two');
  const two = await page.evaluate(() => window.kiri.api.widgets.all().map(w => { const b = w.getBoundingBox(); return { w: +(b.max.x - b.min.x).toFixed(2), head: /<svg[^>]*>/.exec(w.meta.svg)?.[0], paths: (w.meta.svg.match(/<path/g) || []).length }; }));
  check(two.length === 2 && two.map(t => t.w).sort((a, b) => a - b).join() === '40,80', `two parts at their size (${two.map(t => t.w)})`);
  check(two.every(t => t.paths === 1), `each part keeps its own shape (${two.map(t => t.paths)})`);
  check(two.every(t => /8in|203\.2mm/.test(t.head) ? /203\.2mm/.test(t.head) : true), `the kept drawing is in mm (${two[0]?.head})`);
  check(!errors.length, `no page errors (${errors.join(' | ')})`);
} catch (e) { check(false, 'threw: ' + e.message); }
await browser.close();
console.log(bad.length ? `svg size: ${bad.length} failed` : 'svg size: ok');
process.exit(bad.length ? 1 : 0);
