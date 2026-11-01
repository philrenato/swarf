// A save while restore is still loading the saved parts, and the page leaving straight after
// (a reload, or index.html's one fresh load after a hard reload): the part is still there on the
// next load. Before 091 that save wrote an empty list and deleted the part's stored data for good.
//   node tools/probe_restore_race.mjs [url]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const n = p => p.evaluate(() => window.kiri.api.widgets.all().length);
const ready = p => p.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfDraw), { timeout: 90000, polling: 200 });
try {
  const page = await browser.newPage();
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(3000); await ready(page); await wait(1500);
  await page.evaluate(() => { for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w); });
  await page.evaluate(() => window.kiri.api.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><rect width="100" height="60"/></svg>', 'race.svg'));
  await wait(3000);
  await page.evaluate(() => window.kiri.api.space.save(true));
  await wait(1000);
  check(await n(page) === 1, 'one part, saved');
  for (const round of [1, 2]) {
    await page.evaluate(() => { const a = window.kiri.api; a.space.restore(); a.space.save(true); setTimeout(() => location.reload(), 0); }).catch(() => {});
    await wait(4000); await ready(page);
    await page.waitForFunction(() => window.kiri.api.widgets.all().length === 1, { timeout: 30000, polling: 250 }).catch(() => {});
    check(await n(page) === 1, `round ${round}: a save mid-restore, then a reload: the part is still there (${await n(page)})`);
  }
} finally { await browser.close(); }
console.log(bad.length ? `${bad.length} failed` : 'restore race: all ok');
process.exit(bad.length ? 1 : 0);
