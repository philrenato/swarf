// ONE PRESS WHERE ONE PRESS IS ALWAYS RIGHT (Phil 11-13): a concern with a fix has its own button.
// For each fix: make the condition, press the button, the concern is gone, undo brings it back,
// redo takes it away again. Fixture: a 300 mm ring with a 150 mm hole, 3/4 in plywood, ShopBot.
//   auto tabs (cut free), hold inside pieces (loose piece), leave it out (empty pocket, drill with
//   no holes, a bottom above the board), raise them (rapids too low), move onto the bed (and no
//   button where the slide would land on another part); a concern that needs a value has none.
//   node tools/probe_concern_fixes.mjs [url]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://127.0.0.1:8492/swarf-app/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.event && window.kiri.api.platform?.load_svg && window.__swarfShape && window.__swarfAutoTabs && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.platform.clear());
  await wait(300);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(900);
  await page.evaluate(() => { const s = document.getElementById('swarf-material-select'); s.value = 'plywood'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await wait(300);
  const load = (kind, v, name) => page.evaluate((kind, v, name) => {
    window.kiri.api.platform.load_svg(window.__swarfShape.svgFor(kind, v), name, { depth: 19.05, resolution: 2, segmin: 48, soup: true, dpi: 0, edge: { kind: 'straight', size: 0 } });
  }, kind, v, name);
  await load('ring', { d: 300, di: 150 }, 'ring');
  await page.waitForFunction(() => window.kiri.api.widgets.all().length === 1, { timeout: 10000 });
  await wait(600);
  const addOp = type => page.evaluate(t => {
    const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === t);
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, type);
  await page.evaluate(() => { window.kiri.api.conf.get().process.ops = []; window.__swarfAutoTabs.set({ density: 0, scale: 0, pin: {} }); });
  await addOp('outline');
  await wait(600);
  const list = async () => { await page.evaluate(() => window.kiri.api.event.emit('cam.op.render')); await wait(300);
    return page.evaluate(() => [...document.querySelectorAll('#swarf-concerns-body .swarf-concern')].map(c => ({ t: c.querySelector('strong').textContent, fix: c.querySelector('.swarf-concern-fix')?.textContent || '', tip: c.querySelector('.swarf-concern-fix')?.title || '' }))); };
  const has = (c, re) => c.some(x => re.test(x.t));
  const press = (re) => page.evaluate(src => {
    const re = new RegExp(src);
    const c = [...document.querySelectorAll('#swarf-concerns-body .swarf-concern')].find(c => re.test(c.querySelector('strong').textContent));
    const b = c && c.querySelector('.swarf-concern-fix');
    if (!b) return null;
    b.click();
    return [...document.querySelectorAll('.alert, #alert-area, .kiri-alert')].map(e => e.textContent).join(' | ') || 'pressed';
  }, re.source);
  const undo = () => page.evaluate(() => window.kiri.api.doit.undo());
  const redo = () => page.evaluate(() => window.kiri.api.doit.redo());
  // the whole round for one fix: there with its button, gone on a press, back on undo, gone on redo
  const round = async (name, re, verb) => {
    let c = await list();
    const it = c.find(x => re.test(x.t));
    check(it && it.fix === verb && it.tip && it.tip.split(/\s+/).length <= 12, `${name}: "${it?.t}" has "${verb}" (${it?.fix}; tip "${it?.tip}")`);
    const said = await press(re);
    await wait(700);
    c = await list();
    check(said && !has(c, re), `${name}: pressed, the concern is gone (${said}) [${c.map(x => x.t)}]`);
    await undo(); await wait(700);
    c = await list();
    check(has(c, re), `${name}: undo brings it back [${c.map(x => x.t)}]`);
    await redo(); await wait(700);
    c = await list();
    check(!has(c, re), `${name}: redo takes it away again`);
  };

  // 1. auto tabs on a part cut free
  await round('auto tabs', /ring is cut free with no tabs/, 'auto tabs');
  let au = await page.evaluate(() => window.__swarfAutoTabs.audit(window.kiri.api.widgets.all()[0]));
  check(au.outerTabs >= 4, `auto tabs: the ring is held (${au.outerTabs} outside)`);

  // 2. hold inside pieces: the part's own setting turned it off
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); const el = document.getElementById('swarf-autotabs-holes'); el.checked = false; el.dispatchEvent(new Event('change')); a.platform.deselect(); });
  await wait(600);
  let c = await list();
  check(has(c, /1 loose piece inside ring/) && !has(c, /cut free/), `hold inside pieces off: only the loose piece is a concern [${c.map(x => x.t)}]`);
  await round('hold inside pieces', /1 loose piece inside ring/, 'hold inside pieces');
  au = await page.evaluate(() => window.__swarfAutoTabs.audit(window.kiri.api.widgets.all()[0]));
  const set = await page.evaluate(() => { const a = window.kiri.api; return a.widgets.annotate(a.widgets.all()[0].id).tabset?.pin || {}; });
  check(au.loose[0].tabs >= 1 && au.outerTabs >= 4 && set.holes !== false, `hold inside pieces: ${au.loose[0].tabs} in the hole, ${au.outerTabs} outside, the part's setting on (${JSON.stringify(set)})`);

  // 3. leave it out: an empty pocket, a drill with no hole its size, a bottom above the board
  await addOp('pocket');
  await wait(600);
  await round('empty pocket', /a pocket has nothing to clear/, 'leave it out');
  check(await page.evaluate(() => window.kiri.api.conf.get().process.ops.find(o => o.type === 'pocket')?.disabled === true), 'empty pocket: the step stays in the list, turned off');
  await addOp('drill');
  await wait(600);
  await round('drill with no holes', /a drill step has no holes to drill/, 'leave it out');
  await addOp('rough');
  await wait(600);
  await page.evaluate(() => { const a = window.kiri.api, o = a.conf.get().process.ops.filter(o => o.type === 'rough').pop(); o.ov_botz = 30; a.conf.save(); });
  await wait(400);
  await round('bottom above the board', /rough bottom is/, 'leave it out');
  // below the board is a depth the student chooses: no button
  await page.evaluate(() => { const a = window.kiri.api, o = a.conf.get().process.ops.filter(o => o.type === 'rough').pop(); o.disabled = false; o.ov_botz = -10; a.conf.save(); });
  c = await list();
  const deep = c.find(x => /rough bottom is/.test(x.t));
  check(deep && !deep.fix, `a bottom below the board keeps its hint, no button (${deep?.t})`);
  await page.evaluate(() => { const a = window.kiri.api, p = a.conf.get().process; p.ops = p.ops.filter(o => o.type !== 'rough'); a.conf.save(); });

  // 4. rapids too close to the board: back to swarf's 5 mm
  await page.evaluate(() => { const a = window.kiri.api; a.conf.get().process.camZClearance = 1; a.conf.save(); });
  await round('z clearance', /rapids only/, 'raise them');
  const zc = await page.evaluate(() => window.kiri.api.conf.get().process.camZClearance);
  check(Math.abs(zc - 5.08) < 0.01, `z clearance after redo: ${zc}`);

  // 5. hanging off the bed: the shortest slide back on
  const off = await page.evaluate(() => {
    const a = window.kiri.api, w = a.widgets.all()[0], bw = a.conf.get().device.bedWidth;
    const g = w.mesh.geometry; g.computeBoundingBox();
    const hi = w.track.pos.x + g.boundingBox.max.x;
    w.move(bw / 2 + 50 - hi, 0, 0); a.platform.update_bounds();
    return { bw, x: w.track.pos.x };
  });
  await round('off the bed', /ring hangs off the bed/, 'move onto the bed');
  const at = await page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all()[0], g = w.mesh.geometry; g.computeBoundingBox(); return { x: w.track.pos.x, hi: w.track.pos.x + g.boundingBox.max.x }; });
  check(Math.abs(at.hi - off.bw / 2) < 0.6, `moved the least way: its edge at the bed's (${at.hi.toFixed(1)} vs ${off.bw / 2})`);
  // a slide that would land on another part: no button
  await load('ring', { d: 40, di: 10 }, 'puck');
  await page.waitForFunction(() => window.kiri.api.widgets.all().length === 2, { timeout: 10000 });
  await wait(600);
  await page.evaluate(() => {
    const a = window.kiri.api, [ring, puck] = a.widgets.all(), bw = a.conf.get().device.bedWidth;
    // a load lays the bed out again: put the ring back over the edge, then the puck where it would slide
    const g = ring.mesh.geometry; g.computeBoundingBox();
    ring.move(bw / 2 + 50 - (ring.track.pos.x + g.boundingBox.max.x), -ring.track.pos.y, 0);
    puck.move(bw / 2 - 290 - puck.track.pos.x, -puck.track.pos.y, 0); a.platform.update_bounds();
  });
  c = await list();
  const hang = c.find(x => /ring hangs off the bed/.test(x.t));
  check(hang && !hang.fix, `the slide would land on the puck: no button, the hint stays (${hang?.t}, "${hang?.fix}")`);

  // a concern that needs the student's value has no button
  await page.evaluate(() => { const a = window.kiri.api, o = a.conf.get().process.ops.find(o => o.type === 'outline'); o.down = 12; a.conf.save(); });
  c = await list();
  const sd = c.find(x => /step-down over half/.test(x.t));
  check(sd && !sd.fix, `step-down over half the bit: hint only (${sd?.t})`);
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `concern fixes: ${bad.length} failed, ${errors.length} page errors` : 'concern fixes: ok');
process.exit(bad.length || errors.length ? 1 : 0);
