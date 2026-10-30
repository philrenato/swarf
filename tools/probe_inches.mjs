// Inches in swarf's own cards (Phil 10-29): with cam's units set to inches, SHAPE, the size card
// and DRAW show inches, read fractions ("4 1/2", "3/4") and lengths with units ("100 mm"), and
// the part comes out the true size in mm underneath. Back to mm at the end.
//   node tools/probe_inches.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME || (process.env.HOME + '/.local/bin/chrome-for-testing');
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.event && window.kiri.api.platform?.load_svg && window.__swarfShape && window.SwarfLength), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  const units = u => page.evaluate(u => { const s = window.kiri.api.ui.units; s.value = u; s.onchange(); }, u);
  await units('in');
  await wait(300);
  check(await page.evaluate(() => window.SwarfLength.unit()) === 'in', 'cam set to inches');
  const setv = (id, v) => page.evaluate((id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, id, v);
  await page.click('#swarf-step-shape');
  await wait(500);
  const units1 = await page.evaluate(() => [...document.querySelectorAll('.swarf-shape tr')].filter(tr => tr.style.display !== 'none' && tr.querySelector('input')).map(tr => tr.querySelector('td').textContent.trim()));
  check(units1.length && units1.every(t => /in$/.test(t)), `SHAPE's lengths say in [${units1}]`);
  await setv('shape-kind', 'rect'); await setv('shape-w', '6'); await setv('shape-h', '4 1/2'); await setv('shape-t', '3/4'); await wait(100);
  const why = await page.evaluate(() => document.getElementById('shape-why').textContent);
  check(!why, `6 × 4 1/2 × 3/4 in is fine ("${why}")`);
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /^make$/i.test(b.textContent.trim()) && b.offsetParent).click());
  await page.waitForFunction(() => window.kiri.api.widgets.all().length === 1, { timeout: 10000 });
  await wait(800);
  const dims = () => page.evaluate(() => {
    const w = window.kiri.api.widgets.all()[0];
    const b = new window.THREE.Box3().setFromObject(w.mesh);
    return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map(v => +v.toFixed(2)).sort((a, b) => a - b);
  });
  let d = await dims();
  check(Math.abs(d[0] - 19.05) < 0.05 && Math.abs(d[1] - 114.3) < 0.3 && Math.abs(d[2] - 152.4) < 0.3, `the part is ${d.join(' × ')} mm (wanted 19.05 × 114.3 × 152.4)`);
  const alert = await page.evaluate(() => [...document.querySelectorAll('.kiri-alert, #alert-area div, .alert')].map(e => e.textContent).join(' | '));
  check(/3\/4 in thick/.test(alert) || !alert, `the made message says 3/4 in ("${alert.slice(0, 80)}")`);
  // the size card, in inches
  await page.evaluate(() => window.kiri.api.platform.select(window.kiri.api.widgets.all()[0]));
  await wait(500);
  const card = () => page.evaluate(() => ({ v: [...document.querySelectorAll('#swarf-size input:not([type=checkbox])')].map(i => i.value), u: document.querySelector('#swarf-size .mm').textContent }));
  let c = await card();
  check(c.u === 'in' && [...c.v].sort().join() === ['0.75', '4.5', '6'].sort().join(), `size card in inches: ${c.v.join(' × ')} ${c.u}`);
  // width 12 with keep proportions: 12 × 9 in, still 3/4 thick; then thickness typed in mm
  const type = (i, t) => page.evaluate((i, t) => { const el = document.querySelectorAll('#swarf-size input:not([type=checkbox])')[i]; el.focus(); el.value = t; el.dispatchEvent(new Event('input')); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); }, i, t);
  const wi = c.v.indexOf('6');
  await type(wi, '12'); await wait(800);
  d = await dims();
  check(Math.abs(d[2] - 304.8) < 0.5 && Math.abs(d[1] - 228.6) < 0.5 && Math.abs(d[0] - 19.05) < 0.05, `width 12 in: ${d.join(' × ')} mm`);
  c = await card();
  const zi = c.v.indexOf('0.75');
  await type(zi, '25.4 mm'); await wait(800);
  d = await dims();
  check(Math.abs(d[0] - 25.4) < 0.05, `thickness typed as 25.4 mm: ${d[0]} mm`);
  c = await card();
  check(c.v.includes('1'), `and the card says 1 (in): ${c.v.join(' × ')}`);
  // DRAW: the part's rows in inches
  await page.evaluate(() => window.__swarfDraw && window.__swarfDraw.open());
  await wait(1200);
  const rows = await page.evaluate(() => ['sd-w', 'sd-d', 'sd-t'].map(id => { const el = document.getElementById(id); return el ? `${el.value} ${el.nextElementSibling ? el.nextElementSibling.textContent : ''}` : null; }));
  check(rows.every(Boolean) && rows.every(r => / in$/.test(r)) && rows[0].startsWith('12 '), `DRAW rows in inches [${rows}]`);
  // depth typed as a fraction in DRAW
  await page.evaluate(() => { const el = document.getElementById('sd-d'); el.value = '8 1/2'; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); });
  await wait(400);
  const d2 = await page.evaluate(() => document.getElementById('sd-d') && document.getElementById('sd-d').value);
  check(d2 === '8.5', `DRAW depth 8 1/2 reads back 8.5 (${d2})`);
  await page.keyboard.press('Escape');
  await wait(300);
  await units('mm');
  await wait(300);
  check(await page.evaluate(() => window.SwarfLength.unit()) === 'mm', 'back to mm');
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `inches: ${bad.length} failed, ${errors.length} page errors` : 'inches: ok');
process.exit(bad.length || errors.length ? 1 : 0);
