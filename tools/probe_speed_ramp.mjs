// The speed control: steps start at the material's safe numbers and can be raised toward a ceiling.
//  - in node, over every material x bit x machine x cutter: "start" is today's numbers to the digit;
//    each step up never lowers rpm, feed, plunge or step-down; nothing passes the machine's caps
//    (spindleMax, 90% of feedMax for a raised feed, feedMaxZ); the MR-1's ceilings land on the
//    formula's own numbers for a few bits; carbide reaches higher than HSS
//  - in the page, on the MR-1: the speed on its own labelled row under the material, its numbers
//    under it; max moves rpm, feed, plunge and step-down together on the step; a typed field is
//    custom and holds through a speed change until "use the speed"; a saved .swarf keeps the speed
//  - on the ShopBot, start is what it was
//   node tools/probe_speed_ramp.mjs [url]        (NODE_ONLY=1: the node half, no browser)
import puppeteer from 'puppeteer-core';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://127.0.0.1:8793/swarf-app/';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };

// ---- node: the app's own functions over the whole library ----
const win = { localStorage: { getItem() { return null; }, setItem() {} } };
win.window = win; win.document = { readyState: 'loading', addEventListener() {} }; win.fetch = () => new Promise(() => {}); win.console = console;
vm.runInNewContext(read('web/kiri/swarf-material.js'), win);
const { __swarfDerive: derive, __swarfAtSpeed: atSpeed, __swarfCeiling: ceiling } = win;
const mats = JSON.parse(read('web/kiri/swarf-materials.json')).materials;
const defaults = read('src/kiri/app/conf/defaults.js');
const toolsSrc = defaults.slice(defaults.indexOf('tools:[', defaults.indexOf('template:')));
const tools = new Function(`return [${toolsSrc.slice(7, toolsSrc.indexOf('\n        ],'))}]`)();
const mm = t => (t.flute_diam || t.shaft_diam) * (t.metric ? 1 : 25.4);
const FZ = Number(defaults.match(/camFastFeedZ:\s*([\d.]+)/)[1]);
const devs = readdirSync(join(root, 'src/kiri/dev/cam')).map(f => JSON.parse(read('src/kiri/dev/cam/' + f))).map(d => ({
  name: d.deviceName, spindleMin: d.spindleMin || 0, spindleMax: d.spindleMax, feedMax: d.feedMax,
  feedMaxZ: Math.min(...[d.feedMaxZ, FZ].filter(v => v > 0)), shopbot: /shopbot/i.test(d.deviceName), endFlutes: d.endmillFlutes || 0,
}));
let n = 0, sameStart = 0, mono = 0, caps = 0, missing = 0;
for (const d of devs) for (const m of mats) for (const t0 of tools) for (const cutter of ['hss', 'carbide']) {
  if (!m.top) { missing++; continue; }
  const t = { ...t0, swarf: { ...(t0.swarf || {}), cutter } };
  const D = mm(t), s0 = derive(m, D, d, t), seq = [0, 1, 2, 3, 4].map(l => atSpeed(m, D, d, t, l));
  n++;
  if (JSON.stringify(seq[0]) !== JSON.stringify(s0)) { sameStart++; if (sameStart < 4) console.log('    start differs', d.name, m.id, t.name, cutter); }
  for (let i = 1; i < 5; i++) for (const k of ['spindle', 'feed', 'plunge', 'stepdown']) if (seq[i][k] < seq[i - 1][k] - 1e-9) { mono++; if (mono < 4) console.log('    falls', d.name, m.id, t.name, cutter, k, i); }
  for (const p of seq) {
    const over = p.spindle > d.spindleMax || p.feed > Math.max(s0.feed, d.feedMax * 0.9) + 1e-9 || p.plunge > Math.max(s0.plunge, d.feedMaxZ) + 1e-9 || p.plunge > Math.max(s0.plunge, p.feed);
    if (over) { caps++; if (caps < 4) console.log('    over a cap', d.name, m.id, t.name, cutter, JSON.stringify(p)); }
  }
}
check(!missing, `every material has a ceiling (${missing} without)`);
check(n > 1000 && !sameStart, `start is today's numbers on every one of ${n} (material, bit, machine, cutter) (${sameStart} differ)`);
check(!mono, `a step up never lowers rpm, feed, plunge or step-down (${mono} fall)`);
check(!caps, `nothing passes the machine's caps (${caps} over)`);
// the MR-1's ceilings, against the formula worked by hand (rpm, mm/min, mm a pass in a full slot)
const MR1 = devs.find(d => !d.shopbot), byId = id => mats.find(m => m.id === id);
const end = w => ({ type: 'endmill', metric: true, flute_diam: w, shaft_diam: w, flute_len: 25.4 });
// the hand-worked table is for 2-flute bits (4 in steel); the MR-1 takes an unmarked end mill as 4-flute
const two = (w, id) => ({ ...end(w), swarf: { flutes: id === 'mild_steel' ? 4 : 2 } });
const top = (id, w, cutter) => ceiling(byId(id), w, MR1, { ...two(w, id), swarf: { ...two(w, id).swarf, cutter } });
const near = (v, want, tol) => Math.abs(v - want) <= tol;
for (const [id, w, cutter, S, F, Dn] of [['aluminum_6061', 6.35, 'hss', 4500, 460, 1.6], ['aluminum_6061', 6.35, 'carbide', 8000, 1020, 3.2], ['aluminum_6061', 12.7, 'carbide', 7500, 1910, 1.2],
  ['mild_steel', 12.7, 'hss', 650, 180, 1.3], ['hdpe', 12.7, 'hss', 6250, 2290, 6.3], ['hardwood', 3.175, 'hss', 8000, 1020, 1.6]]) {
  const c = top(id, w, cutter);
  check(near(c.spindle, S, 50) && near(c.feed, F, 20) && near(c.stepdown, Dn, 0.1), `MR-1 ceiling, ${id} ${w} mm ${cutter}: S${c.spindle} F${c.feed} ${c.stepdown} mm (formula S${S} F${F} ${Dn})`);
}
const al = byId('aluminum_6061');
const hs = atSpeed(al, 6.35, MR1, { ...end(6.35) }, 4), cb = atSpeed(al, 6.35, MR1, { ...end(6.35), swarf: { cutter: 'carbide' } }, 4);
check(cb.feed > hs.feed && cb.spindle > hs.spindle, `carbide reaches higher than HSS (aluminium 1/4 in max: HSS S${hs.spindle} F${hs.feed}, carbide S${cb.spindle} F${cb.feed})`);
const flutes4 = atSpeed(al, 6.35, MR1, { ...end(6.35), swarf: { flutes: 4 } }, 0), flutes2 = atSpeed(al, 6.35, MR1, { ...end(6.35), swarf: { flutes: 2 } }, 0);
check(flutes4.feed > flutes2.feed && flutes4.spindle === flutes2.spindle, `a bit's own flute count sets the feed at the same chip (2: F${flutes2.feed}, 4: F${flutes4.feed})`);

// ---- the page ----
if (process.env.NODE_ONLY) { console.log(bad.length ? `speed ramp (node): ${bad.length} failed` : 'speed ramp (node): ok'); process.exit(bad.length ? 1 : 0); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-ramp-')), args: ['--window-size=1440,900'] });
const wait = ms => new Promise(r => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(4000);
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && document.getElementById('swarf-material-select') && document.getElementById('swarf-speed-select') && window.SwarfFile), { timeout: 90000, polling: 200 });
  await wait(1500);
  // the machine first: a metal is offered only where the machine cuts metal
  const setup = async (device, mat) => {
    await page.evaluate(d => window.kiri.api.devices.select(d), device); await wait(800);
    await page.evaluate(m => window.__swarfSetMaterial(m), mat); await wait(300);
    await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); const s = a.conf.get(); s.process.ops = []; a.conf.save(); });
    await page.evaluate(() => window.kiri.api.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80"><rect width="120" height="80" fill="#000"/></svg>', 'board', { depth: 19, resolution: 2, soup: true, dpi: 0 }));
    await page.waitForFunction(() => window.kiri.api.widgets.all().length === 1, { timeout: 15000 }); await wait(600);
    await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'outline'); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await wait(600);
    await page.evaluate(() => { const a = window.kiri.api, o = a.conf.get().process.ops.find(o => o.type === 'outline'); o.tool = 1000; a.conf.save(); a.event.settings(); });
    await wait(500);
  };
  const op = () => page.evaluate(() => { const o = window.kiri.api.conf.get().process.ops.find(o => o.type === 'outline'); return { spindle: o.spindle, rate: o.rate, plunge: o.plunge, down: o.down }; });
  const pick = v => page.evaluate(v => { const s = document.getElementById('swarf-speed-select'); s.value = String(v); s.dispatchEvent(new Event('change')); }, v).then(() => wait(500));

  // the ShopBot at start: its numbers as the same derive gives them
  await setup('ShopBot.Basic', 'hardwood');
  const sb = await op();
  const sbWant = derive(byId('hardwood'), 6.35, devs.find(d => d.shopbot), tools.find(t => t.id === 1000));
  check(sb.spindle === sbWant.spindle && sb.rate === sbWant.feed && sb.down === sbWant.stepdown, `ShopBot at start: the step's numbers are today's (${JSON.stringify(sb)})`);

  await setup('Langmuir.MR-1', 'aluminum_6061');
  check(await page.evaluate(() => window.__swarfMaterial.id) === 'aluminum_6061', 'aluminium on the MR-1');
  const row = await page.evaluate(() => { const r = document.getElementById('swarf-speed-row'), s = document.getElementById('swarf-speed-select'), l = document.getElementById(s.getAttribute('aria-labelledby')); return { own: !!(r && s && r.contains(s)) && !document.getElementById('swarf-material-row').contains(s), label: l && l.textContent, words: [...s.options].map(o => o.textContent), value: s.value, shown: !!s.offsetParent }; });
  check(row.own && row.label === 'speed' && row.shown && row.value === '0', `the speed on its own labelled row, at start (${row.words.join(' · ')})`);
  check(row.words.length === 5 && row.words[0] === 'start' && row.words[4] === 'max' && !row.words.some(w => /%/.test(w)), 'start, three steps toward max, max; no percent');
  const numbers = () => page.evaluate(() => document.getElementById('swarf-speed-numbers').innerText);
  const s0 = await op();
  await pick(4);
  const s4 = await op();
  const want = atSpeed(byId('aluminum_6061'), 6.35, devs.find(d => !d.shopbot), tools.find(t => t.id === 1000), 4);
  console.log('    aluminium 1/4 in on the MR-1: start', JSON.stringify(s0), 'max', JSON.stringify(s4));
  check(s4.spindle > s0.spindle && s4.rate > s0.rate && s4.plunge >= s0.plunge && s4.down > s0.down, 'max moves rpm, feed, plunge and step-down together');
  check(s4.spindle === want.spindle && s4.rate === want.feed && s4.down === want.stepdown, 'the step takes the ceiling the formula gives');
  check(s4.spindle <= 8000 && s4.rate <= 2286 && s4.plunge <= 1016, 'never above the MR-1');
  await pick(2);
  const s2 = await op();
  check(s2.rate > s0.rate && s2.rate < s4.rate, `half way sits between (${s0.rate} < ${s2.rate} < ${s4.rate} mm/min)`);
  const n2 = await numbers();
  check(n2.includes(`${s2.spindle} rpm`) && n2.includes(`preset feed ${s2.rate} mm/min`) && n2.includes(`plunge ${s2.plunge} mm/min`) && /down a pass/.test(n2), `the numbers under the speed are the step's ("${n2}")`);
  // a typed field is custom: it holds through a speed change, until "use the speed"
  await page.evaluate(() => { const a = window.kiri.api, o = a.conf.get().process.ops.find(o => o.type === 'outline'); o.rate = 333; a.conf.save(); a.event.settings(); });
  await wait(600);
  check((await op()).rate === 333, 'a feed typed after holds');
  await pick(4);
  check((await op()).rate === 333, 'a speed change keeps the typed feed');
  check(/outline: custom, \d+ rpm, feed 333 mm\/min/.test(await numbers()), `the speed line says the step is custom, with its own numbers ("${await numbers()}")`);
  const use = await page.$('#swarf-speed-numbers button');
  if (use) { const bb = await use.boundingBox(); await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); }
  await wait(600);
  check((await op()).rate === s4.rate, `"use the speed" puts the speed's feed back (${(await op()).rate})`);
  // carbide, ticked beside the step's bit: carbide start and ceiling on every step with that bit
  await pick(0);
  const hssStart = await op();
  const tickStep = on => page.evaluate(on => {
    for (const c of document.querySelectorAll('#oplist .swarf-op-chevron')) c.click();
    const box = document.querySelector('#oplist [data-swarf-field="carbide"]');
    if (!box) return null;
    const lab = box.closest('label');
    const r = { shown: !!box.offsetParent, word: lab.textContent.trim(), tip: lab.title };
    if (box.checked !== on) { box.checked = on; box.dispatchEvent(new Event('change', { bubbles: true })); }
    return r;
  }, on).then(r => wait(700).then(() => r));
  const t1 = await tickStep(true);
  check(t1 && t1.word === 'carbide' && t1.tip.split(/\s+/).length < 12, `a carbide tick by the step's bit (${t1 && t1.word}: "${t1 && t1.tip}")`);
  const cbStart = await op();
  const toolCarb = await page.evaluate(() => { const t = window.kiri.api.conf.get().tools.find(t => t.id === 1000); return !!(t.swarf && t.swarf.cutter === 'carbide'); });
  const wantCb = atSpeed(byId('aluminum_6061'), 6.35, MR1, { ...tools.find(t => t.id === 1000), swarf: { cutter: 'carbide' } }, 0);
  console.log('    aluminium 1/4 in start: HSS', JSON.stringify(hssStart), 'carbide', JSON.stringify(cbStart));
  check(toolCarb && cbStart.spindle > hssStart.spindle && cbStart.rate > hssStart.rate, 'ticked: the bit is carbide and the step starts faster');
  check(cbStart.spindle === wantCb.spindle && cbStart.rate === wantCb.feed && cbStart.spindle <= 8000 && cbStart.rate <= 2540, `the carbide start is the formula's, under the machine (S${cbStart.spindle} F${cbStart.rate})`);
  await pick(4);
  const cbMax = await op();
  check(cbMax.rate > s4.rate, `the carbide ceiling is higher than HSS (${s4.rate} → ${cbMax.rate} mm/min)`);
  await pick(0);
  await tickStep(false);
  const back0 = await op();
  check(back0.spindle === hssStart.spindle && back0.rate === hssStart.rate, 'unticked: back to the HSS numbers');

  // the same tick in the tool library
  await page.evaluate(() => window.kiri.api.show.tools());
  await wait(1000);
  const lib = await page.evaluate(() => {
    const ui = window.kiri.api.ui;
    const opt = [...ui.toolSelect.options].find(o => o.textContent.trim() === 'end 1/4');
    if (!opt) return { has: false, why: 'no end 1/4 in the list' };
    ui.toolSelect.selectedIndex = opt.index; opt.onclick();
    const box = ui.toolCarbide;
    const lab = box && box.closest('.var-row');
    const r = { has: !!box, shown: !!(box && box.offsetParent), word: lab ? lab.textContent.trim() : '', was: box && box.checked };
    if (box) box.click();
    ui.toolsSave.click();
    return r;
  });
  await wait(700);
  await page.evaluate(() => window.kiri.api.modal.hide()); await wait(400);
  await page.evaluate(() => { const a = window.kiri.api; a.event.emit('settings.saved', a.conf.get()); });
  await wait(600);
  const libCarb = await page.evaluate(() => { const t = window.kiri.api.conf.get().tools.find(t => t.id === 1000); return !!(t.swarf && t.swarf.cutter === 'carbide'); });
  const viaLib = await op();
  check(lib.has && lib.shown && /carbide/.test(lib.word) && lib.was === false, `a carbide tick in the tool library (${JSON.stringify(lib)})`);
  check(libCarb && viaLib.spindle === cbStart.spindle && viaLib.rate === cbStart.rate, `ticked there, the step takes the carbide start too (S${viaLib.spindle} F${viaLib.rate})`);
  const stepShows = await page.evaluate(() => { for (const c of document.querySelectorAll('#oplist .swarf-op-chevron')) c.click(); const b = document.querySelector('#oplist [data-swarf-field="carbide"]'); return b && b.checked; });
  check(stepShows === true, 'and the tick by the step shows it');
  await tickStep(false);

  // on the MR-1 an unmarked end mill counts as 2-flute (the lower feed when a bit doesn't say); a bit
  // marked 4-flute gets twice the feed at the same chip
  const f2 = atSpeed(byId('aluminum_6061'), 6.35, MR1, tools.find(t => t.id === 1000), 0), f4 = atSpeed(byId('aluminum_6061'), 6.35, MR1, { ...tools.find(t => t.id === 1000), swarf: { ...(tools.find(t => t.id === 1000).swarf || {}), flutes: 4 } }, 0);
  check(hssStart.rate === f2.feed && f4.feed > f2.feed, `MR-1 end mills start as 2-flute when unmarked (F${f2.feed}; marked 4-flute F${f4.feed})`);

  // the speed is the job's: saved in the process and back from a .swarf
  await pick(3);
  const kept = await op();
  const back = await page.evaluate(() => new Promise(res => {
    const a = window.kiri.api, dl = a.util.download;
    a.util.download = (blob) => {
      a.util.download = dl;
      Promise.resolve(blob instanceof Blob ? blob.arrayBuffer() : blob).then(buf => {
        window.__swarfSpeed.set(0);
        const at0 = window.__swarfSpeed.get();
        window.SwarfFile.remember();   // the bed counts as saved, so opening asks nothing
        // opened the way a file dropped on the bed is (the bed's reader brings the zip library)
        a.platform.load_files([new File([buf], 'ramp.swarf')]);
        Promise.resolve().then(() => setTimeout(() => {
          const o = a.conf.get().process.ops.find(o => o.type === 'outline');
          res({ at0, speed: a.conf.get().process.swarfSpeed, shown: document.getElementById('swarf-speed-select').value, rate: o && o.rate });
        }, 2500));
      });
    };
    window.SwarfFile.save({ name: 'ramp' });
    setTimeout(() => res(null), 30000);
  }));
  console.log('    reopened:', JSON.stringify(back));
  check(back && back.at0 === 0 && back.speed === 3 && back.shown === '3' && back.rate === kept.rate, `a saved .swarf keeps the speed (¾ to max) and the step's numbers`);
} catch (e) {
  console.log('FAIL', e.message); bad.push(e.message);
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `speed ramp: ${bad.length} failed, ${errors.length} page errors` : 'speed ramp: ok');
process.exit(bad.length || errors.length ? 1 : 0);
