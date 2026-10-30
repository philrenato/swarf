// The shop's bits in the app (10-29): a stored profile gets the four starter bits by part number
// (the tool-library migration in sync.js), and their names are what a file says it was made for.
//   node tools/probe_shop_bits.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME || (process.env.HOME + '/.local/bin/chrome-for-testing');
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.conf?.get && window.__swarfDerive), { timeout: 90000, polling: 200 });
  await wait(1500);
  const t = await page.evaluate(() => window.kiri.api.conf.get().tools.filter(t => t.swarf && t.swarf.part).map(t => `${t.name}|${t.swarf.cut}|${t.flute_diam}`));
  check(t.length === 4 && t.includes('1/4 down-cut 57-910|down|0.25') && t.includes('1/4 up-cut 52-910|up|0.25'), `the shop's bits are in the tool list [${t}]`);
  // a profile saved before them: take them out, reload, they come back
  await page.evaluate(() => { const s = window.kiri.api.conf.get(); s.tools = s.tools.filter(t => !(t.swarf && t.swarf.part)); window.kiri.api.conf.save(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.kiri?.api?.conf?.get), { timeout: 90000, polling: 200 });
  await wait(1500);
  const n = await page.evaluate(() => window.kiri.api.conf.get().tools.filter(t => t.swarf && t.swarf.part).length);
  check(n === 4, `an older saved profile gets them on load (${n})`);
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `shop bits: ${bad.length} failed, ${errors.length} page errors` : 'shop bits: ok');
process.exit(bad.length || errors.length ? 1 : 0);
