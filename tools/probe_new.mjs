// file › new clears the scene (Phil 11-05: "make sure when I hit new it actually clears the scene - I had
// to restart"). New selected everything with a toggle, so a part already picked was let go and stayed,
// and a part hidden by the toolpaths or simulate view could not be picked at all. Every way in: nothing
// left on the bed, in the steps, in the trail, or in control, and nothing comes back on a reload.
//   node tools/probe_new.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-new-')), args: ['--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('pageerror', e => errors.push(e.message));
const ready = () => page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.SwarfLength && document.getElementById('swarf-step-shape')), { timeout: 60000 }).then(() => wait(2000));
await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await ready();
await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(800);
const part = async () => {
  const had = await page.evaluate(() => window.kiri.api.widgets.all().length);
  await page.click('#swarf-step-shape'); await wait(600);
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /^make$/i.test(b.textContent.trim()) && b.offsetParent).click());
  await page.waitForFunction(n => window.kiri.api.widgets.all().length > n, { timeout: 10000 }, had); await wait(800);
};
const toolpaths = () => page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); document.getElementById('act-paths').click(); setTimeout(res, 60000); })).then(() => wait(800));
// press file › new and answer the card with the word that clears
const pressNew = async () => {
  await page.evaluate(() => document.getElementById('file-new').click()); await wait(500);
  const said = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].filter(b => b.offsetParent && /^(ok|clear|clear it)$/i.test(b.textContent.trim())); if (b[0]) b[0].click(); return b.map(x => x.textContent.trim()); });
  check(said.length === 1, `new asks once, with one word that clears: [${said}]`);
  await wait(1200);
};
const state = () => page.evaluate(() => {
  const a = window.kiri.api, proc = a.conf.get().process;
  let world = 0; try { window.moto.space.world.traverse?.(o => { if (o.isMesh && o.visible && o.geometry?.attributes?.position && a.widgets.all().every(w => w.mesh !== o)) world++; }); } catch (e) {}
  return { parts: a.widgets.all().length, picked: a.selection.count(), ops: (proc.ops || []).filter(o => o.type !== '|').length, view: a.view.get(), rows: document.querySelectorAll('#ws-widgets > *').length, steps: document.querySelectorAll('#oplist .draggable, #oplist .op, #oplist-int > *').length, prog: !!window.__swarfRun?.state?.prog, trail: window.__swarfLSPoints || 0, stacks: Object.keys(a.stacks.getStacks?.() || {}).length };
});
const clean = async name => {
  const s = await state();
  check(s.parts === 0, `${name}: no parts left (${s.parts})`);
  check(s.ops === 0, `${name}: no steps left (${s.ops})`);
  check(s.view === 1, `${name}: back on the bed (view ${s.view})`);
  check(s.picked === 0, `${name}: nothing picked (${s.picked})`);
  check(s.rows === 0, `${name}: the objects list is empty (${s.rows})`);
  check(!s.prog, `${name}: control holds no program`);
  check(s.stacks === 0, `${name}: no toolpaths left (${s.stacks} stacks)`);
  check(s.trail === 0, `${name}: no trail left (${s.trail})`);
  return s;
};
// 1: one part, picked (it arrives picked)
await part(); await pressNew(); await clean('one picked part');
// 2: two parts, one picked
await part(); await part();
await page.evaluate(() => { const a = window.kiri.api; a.platform.deselect(); a.platform.select(a.widgets.all()[0]); });
await pressNew(); await clean('two parts, one picked');
// 3: two parts, all picked
await part(); await part();
await page.evaluate(() => window.kiri.api.platform.select_all()); await wait(200);
await pressNew(); await clean('two parts, all picked');
// 4: from the toolpaths view
await part(); await toolpaths();
check((await state()).view !== 1, 'toolpaths view reached');
await pressNew(); await clean('from toolpaths');
// 5: from simulate, playing
await part(); await toolpaths();
await page.evaluate(() => document.getElementById('act-animate').click()); await wait(2500);
await pressNew(); await clean('from simulate');
// 6: the app still works, and a new part can be cut
await part(); await toolpaths();
check((await state()).parts === 1, 'a part made after new');
await page.evaluate(() => document.getElementById('act-clear')?.click()); await wait(800);
// 7: nothing comes back on a reload
await pressNew(); await clean('before reload'); await wait(1000);
await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await wait(1500);
await clean('after reload');
// 8: cancelled, nothing moves
await part();
await page.evaluate(() => document.getElementById('file-new').click()); await wait(500);
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.offsetParent && /^(cancel|keep it|keep everything)$/i.test(b.textContent.trim())); b && b.click(); }); await wait(600);
check((await state()).parts === 1, 'cancel keeps the part');
check(!errors.length, `no page errors: ${errors.slice(0, 3).join(' | ')}`);
await browser.close();
console.log(bad.length ? `FAILED ${bad.length}` : 'ALL OK');
process.exit(bad.length ? 1 : 0);
