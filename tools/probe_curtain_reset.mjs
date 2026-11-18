// The loading curtain's reload keeps the student's work; start over deletes it (after a confirm).
//   - a part on the bed survives ?reset=1 (the reload path: service worker and caches only)
//   - the stuck state waits 30 s, not 5 (checked in the page's own script)
//   - start over asks first; cancelled, nothing is deleted
//   node tools/probe_curtain_reset.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const ready = page => page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_files && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 200 });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-curtain-')), args: ['--window-size=1280,800'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ready(page); await wait(1200);
  const src = await page.evaluate(() => [...document.scripts].map(s => s.textContent).join('\n'));
  check(/\}, 30000\);/.test(src) && !/\}, 5000\);\s*\}\)\(\);/.test(src), 'the stuck state waits 30 s');
  check(await page.evaluate(() => !!document.getElementById('swarf-wipe-reset') && document.getElementById('swarf-hard-reset').textContent.trim() === 'reload swarf'), 'reload and start over are two buttons');
  // a part on the bed
  await page.evaluate(() => { const a = window.kiri.api; a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><rect width="100" height="60"/></svg>', 'keepme', { depth: 12, resolution: 2, soup: true, dpi: 0 }); });
  await wait(2500);
  const n0 = await page.evaluate(() => window.kiri.api.widgets.all().length);
  check(n0 >= 1, `a part on the bed (${n0})`);
  // the reload path
  const u = new URL(PAGE); u.searchParams.set('reset', '1');
  await page.goto(u.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => /[?&]_=\d+/.test(location.search), { timeout: 30000 }).catch(() => {});
  await ready(page); await wait(2500);
  const n1 = await page.evaluate(() => window.kiri.api.widgets.all().length);
  check(n1 === n0, `the part survives reload swarf (${n0} → ${n1})`);
  // start over asks; cancel keeps everything
  let asked = false;
  page.once('dialog', d => { asked = true; d.dismiss(); });
  await page.evaluate(() => { const b = document.getElementById('swarf-wipe-reset'); b.style.display = 'inline-block'; b.click(); });
  await wait(800);
  const n2 = await page.evaluate(() => window.kiri.api.widgets.all().length);
  check(asked && n2 === n0, `start over asks first; cancelled, the part stays (${asked}, ${n2})`);
  check(!errors.length, `no page errors${errors.length ? ': ' + errors[0] : ''}`);
} finally { await browser.close(); }
console.log(bad.length ? `curtain reset: ${bad.length} failed` : 'curtain reset: ok');
process.exit(bad.length ? 1 : 0);
