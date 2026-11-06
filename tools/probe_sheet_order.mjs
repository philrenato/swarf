// the file's order on a sheet of parts (review 105): one bit change per bit, not one per part (M1);
// rapids clear the tallest part on the bed, a thin part beside a thick one (the 122 mm crossing at Z -4.93);
// a step that cuts nothing writes no bit change and no router start (F4); a hole the bit cannot enter is
// said (M2); the export card repeats what is open (F2, M5) and will not save a file with no cutting (m6).
//   node tools/probe_sheet_order.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const P = createRequire(import.meta.url)('../web/kiri/swarf-run-parse.js');
const url = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const rect = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}"/></svg>`;
const ring = (d, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${d}mm" height="${d}mm" viewBox="0 0 ${d} ${d}"><path fill-rule="evenodd" d="M0 0H${d}V${d}H0ZM${(d - h) / 2} ${(d - h) / 2}V${(d + h) / 2}H${(d + h) / 2}V${(d - h) / 2}Z"/></svg>`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-sheet-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfTex), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(800);
  const fresh = () => page.evaluate(() => { const a = window.kiri.api, s = a.conf.get(); a.platform.clear(); s.process.ops = []; a.conf.save(); a.event.emit('cam.op.render'); }).then(() => wait(500));
  const part = (svg, name, depth) => page.evaluate((svg, name, depth) => { window.kiri.api.platform.load_svg(svg, name, { depth, soup: true, dpi: 0, place: true }); }, svg, name, depth).then(() => wait(900));
  const add = (type, patch) => page.evaluate((type, patch) => {
    [...document.querySelectorAll('#op-add-list > div')].find(d => d.textContent.trim() === type).click();
    const a = window.kiri.api, ops = a.conf.get().process.ops, op = ops.filter(o => o.type === type).pop(), tools = a.conf.get().tools;
    if (patch?.tool) op.tool = tools.find(t => t.name === patch.tool).id;
    if (patch?.inside != null) op.inside = patch.inside;
    a.conf.save(); a.event.emit('cam.op.render');
  }, type, patch || null).then(() => wait(500));
  const file = () => page.evaluate(() => new Promise(res => { const t = setTimeout(() => res(''), 90000); window.kiri.api.function.clear_progress?.(); window.kiri.api.function.export(text => { clearTimeout(t); res(text); }); }));
  const facts = text => { const parsed = P.parse(text, { machineUnits: 'mm' }); const lines = text.split('\n'); return { parsed, changes: lines.filter(l => /^C9\b/.test(l)).length, routerOns: lines.filter(l => /^C6\b/.test(l)).length, across: P.rapidAcross(parsed), dead: P.routerOffCut(parsed), cuts: parsed.moves.filter(m => !m.rapid).length }; };

  // M1: three rings, two bits
  await fresh();
  for (const n of ['a', 'b', 'c']) await part(ring(60, 30), n, 12);
  await add('outline', { tool: 'end 1/8', inside: true });
  await add('outline', { tool: 'end 1/4', inside: false });
  let f = facts(await file());
  check(f.changes === 2, `three parts, two bits: two bits loaded, not six (${f.changes})`);
  check(!f.dead && !f.across && f.cuts > 100, `the file still cuts, router on, no rapid in the wood (${f.cuts} cuts)`);

  // the crossing: a thin part beside a thick one, either order on the bed
  for (const order of [['board', 'thin'], ['thin', 'board']]) {
    await fresh();
    for (const n of order) await part(rect(100, 80), n, n === 'board' ? 19 : 9);
    await add('outline', { tool: 'end 1/4', inside: false });
    f = facts(await file());
    const hi = Math.max(...f.parsed.moves.filter(m => m.rapid && Math.hypot(m.x - m.x0, m.y - m.y0) > 1).map(m => Math.min(m.z, m.z0)));
    const low = Math.min(...f.parsed.moves.filter(m => m.rapid && Math.hypot(m.x - m.x0, m.y - m.y0) > 1).map(m => Math.min(m.z, m.z0)));
    check(!f.across && low >= 0, `${order}: every rapid across clears the tallest part (lowest Z ${low.toFixed(2)}, highest ${hi.toFixed(2)})`);
    const min = Math.min(...f.parsed.moves.map(m => m.z));
    check(min < -18.9 && min > -19.1, `${order}: both still cut to the bed (deepest ${min.toFixed(2)})`);
  }

  // F4: a pocket with no floor, on another bit: nothing of it in the file
  await fresh();
  await part(rect(100, 80), 'plate', 12);
  await add('pocket', { tool: 'end 1/8' });
  await add('outline', { tool: 'end 1/4', inside: false });
  f = facts(await file());
  const loads = (await file()).split('\n').filter(l => /Load/.test(l));
  check(f.changes === 1 && !loads.some(l => /1\/8/.test(l)), `an empty pocket writes no bit change (${loads})`);
  check(f.routerOns === 1, `and no router start of its own (${f.routerOns})`);

  // the same, last in the list: the file ends on the bit that cut (review of 109: a change and a router start after the job)
  await fresh();
  await part(rect(100, 80), 'plate', 12);
  await add('outline', { tool: 'end 1/4', inside: false });
  await add('pocket', { tool: 'end 1/8' });
  const last = await file(); f = facts(last);
  check(f.changes === 1 && f.routerOns === 1, `an empty last step adds no bit change or router start (${f.changes}, ${f.routerOns})`);
  const tail = last.split('\n').filter(l => /^(C6|C7|C9|JZ|TR)\b/.test(l));
  check(tail.slice(-2).join() === 'JZ,25.4,C7', `the file ends lifted, router off (${tail.slice(-4)})`);

  // M2: a hole smaller than the bit
  await fresh();
  await part('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="80mm" viewBox="0 0 100 80"><path fill-rule="evenodd" d="M0 0H100V80H0ZM20 20H25V25H20ZM60 20H80V40H60Z"/></svg>', 'plate', 12);
  await add('outline', { tool: 'end 1/4', inside: false });
  await wait(800);
  let open = await page.evaluate(() => window.__swarfConcernsNow().map(c => c.title));
  check(open.some(t => /1 hole in plate too small/.test(t)), `the 5 mm hole is said, the 20 mm one is not counted (${open})`);
  await add('outline', { tool: 'end 1/8', inside: false });
  await page.evaluate(() => { const a = window.kiri.api, ops = a.conf.get().process.ops; ops.splice(ops.findIndex(o => o.type === 'outline'), 1); a.conf.save(); a.event.emit('cam.op.render'); }); await wait(600);
  open = await page.evaluate(() => window.__swarfConcernsNow().map(c => c.title));
  check(!open.some(t => /too small/.test(t)), `with a bit that fits it is not (${open})`);

  // F2, M5: the card says it; a part bigger than the bed
  await fresh();
  await part(rect(2600, 300), 'long', 12);
  await add('outline', { tool: 'end 1/4', inside: false });
  await page.evaluate(() => document.getElementById('act-export').click());
  await page.waitForFunction(() => document.querySelector('.swarf-x-card'), { timeout: 120000 }); await wait(400);
  const card = await page.evaluate(() => ({ text: document.querySelector('.swarf-x-concerns')?.innerText || '', go: document.querySelector('.swarf-x-go').textContent, off: document.querySelector('.swarf-x-go').disabled }));
  check(/bigger than the ShopBot/.test(card.text), `the export card repeats the concern (${card.text.slice(0, 80)})`);
  check(/^save anyway/.test(card.go) && !card.off, `and its button says it knows (${card.go})`);
  await page.keyboard.press('Escape'); await page.evaluate(() => window.kiri.api.modal.hide()); await wait(400);

  // m6: everything left out
  await fresh();
  await part(rect(100, 80), 'plate', 12);
  await add('pocket', { tool: 'end 1/4' });
  await page.evaluate(() => document.getElementById('act-export').click());
  await page.waitForFunction(() => document.querySelector('.swarf-x-card'), { timeout: 120000 }); await wait(400);
  const none = await page.evaluate(() => ({ say: document.querySelector('.swarf-x-nothing')?.textContent || '', off: document.querySelector('.swarf-x-go').disabled }));
  check(/cuts nothing/.test(none.say) && none.off, `a file with no cutting is said and not saved (${none.say})`);
  await page.evaluate(() => window.kiri.api.modal.hide());
  check(!errors.length, `no page errors (${errors.join(' | ')})`);
} catch (e) { check(false, 'threw: ' + e.message); }
await browser.close();
console.log(bad.length ? `sheet order: ${bad.length} failed` : 'sheet order: ok');
process.exit(bad.length ? 1 : 0);
