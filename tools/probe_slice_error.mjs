// A toolpaths run that fails stops there: no preview ends on the emptied worker, no file with no
// cuts is exported, and code waiting for the file (control) hears preview.error instead.
//   node tools/probe_slice_error.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-slerr-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(600);
  await page.evaluate(() => window.kiri.api.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80"><rect width="120" height="80"/></svg>', 'board', { depth: 19, soup: true, dpi: 0 }));
  await wait(1500);
  await page.evaluate(() => { const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === 'rough'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(600);
  // a good run first: the file has cuts
  const good = await page.evaluate(() => new Promise(res => { window.kiri.api.function.export(text => res((String(text || '').match(/^G0?1\b/gm) || []).length)); setTimeout(() => res(-1), 60000); }));
  check(good > 0, `a good run exports cutting moves (${good})`);
  // a step-down of 0 on a rough step: the slice fails
  const r = await page.evaluate(() => new Promise(res => {
    const a = window.kiri.api, seen = [];
    for (const ev of ['slice.error', 'slice.end', 'preview.end', 'preview.error', 'export.error']) a.event.on(ev, () => seen.push(ev));
    for (const o of a.conf.get().process.ops) if (o && o.type === 'rough') o.down = 0;
    a.function.clear_progress();
    let called = null;
    a.function.export(text => { called = text; });
    setTimeout(() => res({ seen, called: called === null ? 'never' : (String(called).match(/^G0?1\b/gm) || []).length }), 20000);
  }));
  console.log('   ', JSON.stringify(r));
  check(r.seen.includes('slice.error'), 'the slice fails');
  check(!r.seen.includes('preview.end') && !r.seen.includes('slice.end'), 'no slice or preview is said to have ended');
  check(r.seen.includes('preview.error'), 'the export waiting on it hears preview.error');
  check(r.called === 'never', `no file with no cuts is handed over (${r.called})`);
  check(!errors.length, `no page errors (${errors.slice(0, 3).join(' | ')})`);
} finally {
  await browser.close();
}
console.log(bad.length ? `\n${bad.length} FAILED` : '\nPASS');
