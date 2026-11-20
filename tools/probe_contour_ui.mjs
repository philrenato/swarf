// The contour step's pattern on its card (145): lines / cross / perimeter, an angle for lines and
// cross (none for perimeter), the step line names it, a typed angle is kept (0-180), and a second
// contour step starts along X like the first (it used to turn to Y unseen).
//   node tools/probe_contour_ui.mjs [url]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfShape), { timeout: 90000, polling: 250 });
  await wait(1500);
  await page.evaluate(() => { const a = kiri.api; a.devices.select('ShopBot.Basic'); a.platform.clear(); a.conf.get().process.ops = []; a.conf.save(); });
  await wait(600);
  await page.evaluate(() => kiri.api.platform.load_svg(window.__swarfShape.svgFor('rect', { w: 100, h: 60 }), 'p', { depth: 19.05, resolution: 2, segmin: 48, soup: true, dpi: 0, place: true }));
  await page.waitForFunction(() => kiri.api.widgets.all().length >= 1, { timeout: 30000 });
  const addStep = type => page.evaluate(t => [...document.getElementById('op-add-list').children].find(e => e.innerText.trim().toLowerCase() === t)?.dispatchEvent(new MouseEvent('click', { bubbles: true })), type);
  await addStep('contour'); await wait(500);
  const card = () => page.evaluate(() => {
    const ops = kiri.api.conf.get().process.ops, i = ops.findIndex(o => o.type === 'contour'), rec = ops[i];
    const sum = document.querySelector(`#oplist .swarf-op-sum[data-step="${i}"]`), box = sum && sum.parentElement;
    const sel = box && box.querySelector('select[data-swarf-field="pattern"]'), ang = box && box.querySelector('input[data-swarf-field="lineAngle"]');
    return { rec: { pattern: rec.pattern, lineAngle: rec.lineAngle, axis: rec.axis }, line: sum ? sum.textContent : '', opts: sel ? [...sel.options].map(o => o.value) : null, value: sel && sel.value, angle: ang ? ang.value : null, angleTip: ang ? ang.closest('label').title : '', id: box && box.id };
  });
  let c = await card();
  check(JSON.stringify(c.opts) === '["lines","cross","perimeter"]' && c.value === 'lines', `the card offers lines, cross, perimeter; lines picked (${c.opts}, ${c.value})`);
  check(c.angle === '0' && /0 along X/.test(c.angleTip), `the angle starts at 0, its tip says which way (${c.angle})`);
  check(/lines at 0°/.test(c.line), `the step line: "${c.line}"`);
  const pick = v => page.evaluate((v, id) => { const s = document.querySelector(`[id="${id}"] select[data-swarf-field="pattern"]`); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, v, c.id);
  await pick('perimeter'); await wait(400); c = await card();
  check(c.rec.pattern === 'perimeter' && c.angle === null && /rings in from the edge/.test(c.line), `perimeter: kept, no angle, "${c.line}"`);
  await pick('cross'); await wait(400); c = await card();
  check(c.rec.pattern === 'cross' && c.angle !== null && /cross at 0°/.test(c.line), `cross: the angle is back, "${c.line}"`);
  const type = async v => { await page.evaluate((v, id) => { const i = document.querySelector(`[id="${id}"] input[data-swarf-field="lineAngle"]`); i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); }, v, c.id); await wait(400); c = await card(); };
  await type('45°');
  check(c.rec.lineAngle === 45 && /cross at 45°/.test(c.line), `45° typed: ${c.rec.lineAngle}, "${c.line}"`);
  await type('200');
  check(c.rec.lineAngle === 20, `200 is the same way as 20: ${c.rec.lineAngle}`);
  await type('90');
  check(c.rec.lineAngle === 90 && c.rec.axis === 'Y', `90 runs along Y (axis ${c.rec.axis})`);
  await addStep('contour'); await wait(500);
  const second = await page.evaluate(() => kiri.api.conf.get().process.ops.filter(o => o.type === 'contour').map(o => o.axis));
  check(second.length === 2 && second[1] === 'X', `a second contour starts along X (${second})`);
  check(!errors.length, `no page errors ${errors.slice(0, 2).join(' | ')}`);
} catch (e) { check(false, `probe ran: ${e.message}`); } finally { await browser.close(); }
console.log(bad.length ? `contour ui: ${bad.length} failed` : 'contour ui: ok');
process.exit(bad.length ? 1 : 0);
