// 2D drawings in: an Illustrator .ai and a .pdf (made by Unreason's writers,
// tools/fixtures-2d) import through cam's file input as two parts at true size
// (a 100 mm circle and a 60 x 40 rectangle), and the open line is reported and
// left out.   node tools/probe_2d_import.mjs [url]
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
const CHROME = process.env.CHROME || (process.env.HOME + '/.local/bin/chrome-for-testing');
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const FIX = fileURLToPath(new URL('./fixtures-2d/', import.meta.url));
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
try {
  for (const file of ['two-shapes.ai', 'two-shapes.pdf']) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on('pageerror', e => errors.push(`${file}: ${e.message}`));
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !!(window.kiri?.api?.platform && window.SwarfVector), { timeout: 90000, polling: 200 });
    await wait(1500);
    await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
    await page.evaluate(() => window.kiri.api.platform.clear && window.kiri.api.widgets.all().forEach(w => window.kiri.api.platform.delete(w)));
    await wait(500);
    const alerts = [];
    await page.exposeFunction('__alert', t => alerts.push(t));
    await page.evaluate(() => { const a = window.kiri.api.show.alert; window.kiri.api.show.alert = (t, s) => { window.__alert(String(t)); return a(t, s); }; });
    const input = await page.$('#load-file');
    await input.uploadFile(FIX + file);
    await page.waitForFunction(() => [...document.querySelectorAll('#dialog button')].some(b => /make parts/i.test(b.textContent)), { timeout: 15000 });
    await page.evaluate(() => { document.getElementById('svg-depth').value = '6'; [...document.querySelectorAll('#dialog button')].find(b => /make parts/i.test(b.textContent)).click(); });
    await page.waitForFunction(() => window.kiri.api.widgets.all().length >= 2, { timeout: 15000 }).catch(() => {});
    await wait(800);
    const sizes = await page.evaluate(() => window.kiri.api.widgets.all().map(w => {
      const b = new window.THREE.Box3().setFromObject(w.mesh);
      return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map(v => +v.toFixed(1)).sort((a, b) => a - b);
    }));
    const has = (a, b, c) => sizes.some(s => Math.abs(s[0] - a) < 0.2 && Math.abs(s[1] - b) < 0.6 && Math.abs(s[2] - c) < 0.6);
    check(sizes.length === 2 && has(6, 100, 100) && has(6, 40, 60), `${file}: parts ${JSON.stringify(sizes)}`);
    check(alerts.some(t => /1 open line was left out/.test(t)), `${file}: the open line is reported (${JSON.stringify(alerts)})`);
    check(await page.evaluate(() => window.kiri.api.widgets.all().every(w => /<svg/.test(w.meta.svg || ''))), `${file}: each part keeps its drawing`);
    await page.close();
  }
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `2d import: ${bad.length} failed, ${errors.length} page errors` : '2d import: ok');
process.exit(bad.length || errors.length ? 1 : 0);
