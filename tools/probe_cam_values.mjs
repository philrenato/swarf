// A step's numbers are the ones the file runs. On the ShopBot a new step starts on the shop's 1/4 in
// up-cut (52-910), and the bit list opens on the shop's bits ("in the shop", then "other"); the MR-1
// keeps the plain end 1/4. An outline's card shows the feed the file cuts at (every pass is full width),
// a typed feed runs as typed, and under 1500 mm/min on the ShopBot the step's line says so. A cut-out
// goes 0.3 mm into the spoilboard and the step's line says it; holes alone, or a typed bottom, do not;
// the tabs stay where they were.
//   node tools/probe_cam_values.mjs [url]
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
const near = (a, b, tol = 0.06) => Math.abs(a - b) <= tol;
const W = 120, H = 80, T = 19.05;
const rect = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}"/></svg>`;
const holed = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}"><path fill-rule="evenodd" d="M0 0H${W}V${H}H0ZM70 25H100V55H70Z"/></svg>`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-camvalues-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfSetMaterial && document.getElementById('op-add-list')), { timeout: 90000, polling: 200 });
  await wait(1500);
  const machine = async (d, mat) => { await page.evaluate(d => window.kiri.api.devices.select(d), d); await wait(800); await page.evaluate(m => window.__swarfSetMaterial(m), mat); await wait(300); };
  const fresh = () => page.evaluate(() => { const a = window.kiri.api, s = a.conf.get(); a.platform.clear(); s.process.ops = []; a.conf.save(); a.event.emit('cam.op.render'); }).then(() => wait(500));
  const part = (svg, depth) => page.evaluate((svg, depth) => { window.kiri.api.platform.load_svg(svg, 'plate', { depth, soup: true, dpi: 0, place: true }); }, svg, depth).then(() => wait(900));
  const add = type => page.evaluate(type => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); [...document.querySelectorAll('#op-add-list > div')].find(d => d.textContent.trim() === type).click(); }, type).then(() => wait(600));
  const op = type => page.evaluate(type => { const s = window.kiri.api.conf.get(), o = s.process.ops.filter(o => o.type === type).pop(); const t = s.tools.find(t => t.id == o.tool); return { ...o, toolName: t && t.name, part: t && t.swarf && t.swarf.part }; }, type);
  const patch = (type, p) => page.evaluate((type, p) => { const a = window.kiri.api, o = a.conf.get().process.ops.filter(o => o.type === type).pop(); Object.assign(o, p); a.conf.save(); a.event.emit('cam.op.render'); }, type, p).then(() => wait(400));
  const line = () => page.evaluate(() => [...document.querySelectorAll('#oplist .swarf-op-sum')].map(e => e.textContent).find(t => t) || '');
  const file = () => page.evaluate(() => new Promise(res => { const t = setTimeout(() => res(''), 120000); window.kiri.api.function.clear_progress?.(); window.kiri.api.function.export(text => { clearTimeout(t); res(text); }); }));
  const cuts = text => P.parse(text, { machineUnits: 'mm' }).moves.filter(m => !m.rapid);
  const flatFeeds = text => [...new Set(cuts(text).filter(m => near(m.z, m.z0, 0.001) && Math.hypot(m.x - m.x0, m.y - m.y0) > 0.01).map(m => Math.round(m.feed * 60)))];

  // ── D2: the shop's bit on the ShopBot ──
  await machine('ShopBot.Basic', 'hardwood');
  await fresh(); await part(rect, T);
  for (const type of ['outline', 'rough', 'pocket']) {
    await add(type);
    const o = await op(type);
    check(o.part === '52-910', `ShopBot: a new ${type} starts on the shop's 1/4 up-cut (${o.toolName})`);
  }
  // the step card's bit select (the outline's, the first step)
  const g2 = await page.evaluate(() => { const sel = document.querySelector('#oplist select[data-swarf-field="tool"]'); return sel ? { g: [...sel.querySelectorAll('optgroup')].map(g => ({ label: g.label, names: [...g.children].map(o => o.textContent) })), value: sel.value } : { g: [] }; });
  check(g2.g.length === 2 && g2.g[0].label === 'in the shop' && g2.g[1].label === 'other', `the bit list: "in the shop" first, then "other" (${g2.g.map(g => g.label)})`);
  check(g2.g[0] && g2.g[0].names.length === 4 && g2.g[0].names.every(n => /\d\d-\d\d\d/.test(n)), `the shop's four bits, by part number (${g2.g[0]?.names})`);
  check(g2.g[1] && g2.g[1].names.includes('end 1/4'), 'end 1/4 is under other');
  check(g2.value === String((await page.evaluate(() => window.kiri.api.conf.get().process.ops[0].tool))), `the select shows the step's bit (${g2.value})`);
  await machine('Langmuir.MR-1', 'hardwood');
  await fresh(); await part(rect, 12);
  await add('outline');
  const mr = await op('outline');
  check(mr.toolName === 'end 1/4', `MR-1: a new outline keeps the plain end 1/4 (${mr.toolName})`);
  const mrSel = await page.evaluate(() => document.querySelectorAll('#oplist select[data-swarf-field="tool"] optgroup').length);
  check(mrSel === 0, 'MR-1: the bit list is one list');

  // ── D3: the outline's card feed is the file's ──
  await machine('ShopBot.Basic', 'hardwood');
  await fresh(); await part(rect, T);
  await add('outline');
  await patch('outline', { tool: await page.evaluate(() => window.kiri.api.conf.get().tools.find(t => t.name === 'end 1/4').id) });
  await page.evaluate(() => { const a = window.kiri.api; a.conf.get().process.ops.find(o => o.type === 'outline').preset = ''; window.__swarfApplyFeeds(); }); await wait(500);
  let o = await op('outline');
  const derive = await page.evaluate(() => { const s = window.kiri.api.conf.get(), t = s.tools.find(t => t.name === 'end 1/4'); return window.__swarfAtSpeed(window.__swarfMaterial, 6.35, window.__swarfLimits(s), t, 0); });
  check(o.rate === Math.max(1500, Math.round(derive.feed * 0.8 / 10) * 10), `the card's feed is the material's at full width (${o.rate}, material ${derive.feed})`);
  let text = await file();
  let feeds = flatFeeds(text);
  check(feeds.length && feeds.every(f => near(f, o.rate, 1)), `the file cuts at the card's ${o.rate} mm/min (${feeds})`);
  let l = await line();
  check(!/full-width/.test(l), `the step's line names no other speed (${l})`);
  await patch('outline', { rate: 1000 });
  text = await file(); feeds = flatFeeds(text);
  check(feeds.length && feeds.every(f => near(f, 1000, 1)), `a typed 1000 runs at 1000 (${feeds})`);
  l = await line();
  check(/under 1500 mm\/min/.test(l), `and the step's line says it is under the ShopBot's 1500 (${l})`);
  await patch('outline', { rate: 2000 });
  text = await file(); feeds = flatFeeds(text);
  check(feeds.length && feeds.every(f => near(f, 2000, 1)), `a typed 2000 runs at 2000 (${feeds})`);
  check(!/under 1500/.test(await line()), 'above 1500 nothing is said');
  // the time estimate reads the same file
  check(await page.evaluate(() => typeof window.SwarfEstimateUI?.state === 'function'), 'the estimate is on the page');

  // ── D13: through, said, tabs held ──
  await fresh(); await part(rect, T);
  await add('outline');
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select_all?.(); window.__swarfAutoTabs.place(); }); await wait(900);
  l = await line();
  check(/19\.05 mm deep \+ 0\.3 mm through/.test(l), `the step's line says how far through (${l})`);
  text = await file();
  let c = cuts(text), deepest = Math.min(...c.map(m => m.z));
  check(near(deepest, -T - 0.3, 0.03), `the outline goes 0.3 mm past the board's bottom (${deepest})`);
  check(deepest >= -(T + 2.01), 'no deeper than the board + 2');
  const tabZ = list => { const zs = list.filter(m => near(m.z, m.z0, 0.001) && m.z > -T + 0.5 && m.z < -T + 15).map(m => +m.z.toFixed(2)); return zs.length ? Math.min(...zs) : null; };
  const withThru = tabZ(c);
  await patch('outline', { thru: 0 });
  text = await file(); c = cuts(text);
  check(near(Math.min(...c.map(m => m.z)), -T, 0.03), `through 0 stops at the bottom (${Math.min(...c.map(m => m.z))})`);
  const noThru = tabZ(c);
  check(withThru !== null && noThru !== null && near(withThru, noThru, 0.3), `the tabs' top stays put (${withThru} with, ${noThru} without)`);
  await patch('outline', { thru: 5 });
  text = await file(); c = cuts(text);
  check(Math.min(...c.map(m => m.z)) >= -(T + 2.01), `a typed 5 is held to 2 (${Math.min(...c.map(m => m.z))})`);
  await patch('outline', { thru: 0.3, ov_botz: 5 });
  text = await file(); c = cuts(text);
  check(near(Math.min(...c.map(m => m.z)), -(T - 5), 0.05) && !/through/.test(await line()), `a typed bottom is not taken through (${Math.min(...c.map(m => m.z))})`);
  await fresh(); await part(holed, T);
  await add('outline');
  await patch('outline', { inside: true, outside: false });
  text = await file(); c = cuts(text);
  check(near(Math.min(...c.map(m => m.z)), -T, 0.03) && !/through/.test(await line()), `holes alone stop at the bottom (${Math.min(...c.map(m => m.z))})`);
  check(!errors.length, `no page errors (${errors.slice(0, 3).join(' | ')})`);
} catch (e) { check(false, 'threw: ' + e.message); }
await browser.close();
console.log(bad.length ? `cam values: ${bad.length} failed` : 'cam values: ok');
process.exit(bad.length ? 1 : 0);
