// TAB SETTINGS, parametric (Phil 10-29: "make all the tab attributes parametric and editable"):
// on a 300 x 200 part of 3/4 in plywood on the ShopBot, every field of tabs › auto tabs shows the
// automatic value in grey, and a typed value is pinned and the applied tabs follow at once:
// length, height (held under the board), reach, how many, from corners; a tab placed by hand
// takes a typed length; a scale puts the tabs back at the new size with the pinned count; a
// material change puts them back on the next slice; inches are typed as fractions; the settings
// survive a reload; "all automatic" clears them; the trash forgets them; the toolpath lifts over
// every tab at the typed height.
//   node tools/probe_tab_params.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME || (process.env.HOME + '/.local/bin/chrome-for-testing');
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const near = (a, b, e = 0.02) => Math.abs(a - b) <= e;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  const ready = () => page.waitForFunction(() => !!(window.kiri?.api?.event && window.kiri.api.platform?.load_svg && window.__swarfShape && window.__swarfAutoTabs && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 200 });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ready();
  await wait(1500);
  const material = m => page.evaluate(m => { const s = document.getElementById('swarf-material-select'); s.value = m; s.dispatchEvent(new Event('change', { bubbles: true })); }, m);

  await page.evaluate(() => window.kiri.api.platform.clear());
  await wait(300);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(900);
  await material('plywood');
  await wait(300);
  await page.evaluate(() => {
    const a = window.kiri.api;
    a.platform.load_svg(window.__swarfShape.svgFor('rect', { w: 300, h: 200 }), 'rectangle', { depth: 19.05, resolution: 2, segmin: 48, soup: true, dpi: 0, edge: { kind: 'straight', size: 0 } });
  });
  await page.waitForFunction(() => window.kiri.api.widgets.all().length === 1, { timeout: 10000 });
  await wait(600);
  await page.evaluate(() => {
    const a = window.kiri.api, s = a.conf.get();
    s.process.ops = [];
    const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'outline');
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    a.platform.select(a.widgets.all()[0]);
    window.__swarfAutoTabs.set({ density: 0, scale: 0, pin: {} });
  });
  await wait(400);

  const tabs = () => page.evaluate(() => {
    const a = window.kiri.api, w = a.widgets.all()[0];
    const list = a.widgets.annotate(w.id).tab || [];
    return { list: list.map(r => ({ id: r.id, auto: !!r.auto, x: r.dim.x, y: r.dim.y, z: r.dim.z, pz: r.pos.z, px: r.pos.x, py: r.pos.y })), boxes: Object.keys(w.tabs || {}).length, set: a.widgets.annotate(w.id).tabset || null };
  });
  const fieldsNow = () => page.evaluate(() => Object.fromEntries(window.__swarfAutoTabs.fields.map(f => {
    const el = document.getElementById(`swarf-autotabs-${f.key}`);
    return [f.key, el ? (el.type === 'checkbox' ? el.checked : { v: el.value, ph: el.placeholder, pinned: el.classList.contains('pinned'), unit: el.parentNode.querySelector('.unit')?.textContent }) : null];
  })));
  // type in a field and press enter, as a student would
  const type = async (key, text) => {
    await page.evaluate((key, text) => {
      const el = document.getElementById(`swarf-autotabs-${key}`);
      el.focus(); el.value = text;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }, key, text);
    await wait(300);
  };
  const say = () => page.evaluate(() => document.getElementById('swarf-autotabs-say').textContent);

  // the panel shows every attribute, automatic values in grey
  let f = await fieldsNow();
  check(Object.values(f).every(v => v !== null), `every attribute has a field (${Object.keys(f).join(', ')})`);
  check(f.width.v === '' && near(+f.width.ph, 12.7) && f.width.unit === 'mm', `length is automatic: grey ${f.width.ph} ${f.width.unit}`);
  check(f.height.v === '' && near(+f.height.ph, 4.76), `height is automatic: grey ${f.height.ph}`);
  check(f.count.v === '' && f.count.ph === '4', `how many is automatic: grey ${f.count.ph}`);
  check(f.holes === true && f.holeMin.ph === '15.7', `hold inside pieces on, holes from 15.7 mm for a 1/4 in bit: any loose piece (${f.holes}, ${f.holeMin.ph})`);
  const hidden = await page.evaluate(() => ['camTabsWidth', 'camTabsHeight', 'camTabsDepth'].map(k => { const el = window.kiri.api.ui[k]; const row = el && (el.closest('.var-row') || el.parentNode); return !row || row.offsetParent === null || row.classList.contains('hide'); }));
  check(hidden.every(Boolean), `the three old size inputs are not shown twice (${hidden})`);

  // apply the starting set, then every field moves them
  await page.evaluate(() => { window.__swarfAutoTabs.preview(); document.getElementById('swarf-autotabs-apply').click(); });
  await wait(400);
  let t = await tabs();
  check(t.list.length === 4 && t.boxes === 4 && t.set, `applied: 4 auto tabs, and the part keeps its settings (${t.list.length}, ${!!t.set})`);

  await type('width', '20');
  t = await tabs(); f = await fieldsNow();
  check(t.list.length === 4 && t.list.every(r => near(r.y, 20)) && t.boxes === 4, `length 20: the 4 tabs are 20 mm long at once (${t.list.map(r => r.y)})`);
  check(f.width.v === '20' && f.width.pinned, `the field says 20, pinned (${JSON.stringify(f.width)})`);

  await type('count', '6');
  t = await tabs();
  check(t.list.length === 6 && t.list.every(r => near(r.y, 20)) && t.boxes === 6, `how many 6: 6 tabs, still 20 long (${t.list.length}, ${t.boxes} drawn)`);

  await type('height', '30');
  t = await tabs();
  const held = t.list[0].z;
  check(near(held, 17.15, 0.02) && /held/i.test(await say()), `height 30 on a 19.05 board is held under it: ${held} ("${await say()}")`);
  await type('height', '6');
  t = await tabs();
  check(t.list.every(r => near(r.z, 6)), `height 6: every tab 6 tall (${t.list.map(r => r.z)})`);
  const zs = t.list.map(r => r.pz);
  await type('depth', '10');
  t = await tabs();
  check(t.list.every(r => near(r.x, 10)), `reach 10: every tab reaches 10 (${t.list.map(r => r.x)})`);

  // a typo says so and changes nothing
  await type('width', 'abc');
  t = await tabs(); f = await fieldsNow();
  check(t.list.every(r => near(r.y, 20)) && f.width.v === '20' && /number/.test(await say()), `"abc" in length is refused, 20 stays ("${await say()}")`);

  // a tab placed by hand takes the typed length when it changes
  await page.evaluate(() => {
    const a = window.kiri.api, w = a.widgets.all()[0], l = a.widgets.annotate(w.id).tab;
    const a0 = l.find(r => r.auto);
    l.push({ pos: { x: a0.pos.x, y: a0.pos.y, z: a0.pos.z }, dim: { x: 6.35, y: 12.7, z: 6 }, rot: a0.rot, id: 42 });
  });
  await type('width', '25');
  t = await tabs();
  const hand = t.list.find(r => r.id === 42);
  check(hand && near(hand.y, 25) && near(hand.x, 10), `your own tab takes length 25 and reach 10 too (${hand && [hand.x, hand.y]})`);
  check(t.list.filter(r => r.auto).every(r => near(r.y, 25)), 'and the auto tabs are 25 long');
  const proc = await page.evaluate(() => { const p = window.kiri.api.conf.get().process; return [p.camTabsWidth, p.camTabsHeight, p.camTabsDepth]; });
  check(near(proc[0], 25) && near(proc[1], 6) && near(proc[2], 10), `the next tab placed by hand is 25 x 6, reach 10 (${proc})`);
  // take the hand tab out again for the counts below
  await page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all()[0], an = a.widgets.annotate(w.id); const r = an.tab.find(r => r.id === 42); const live = w.tabs[42]; if (live) { w.adds.remove(live.box); w.mesh.remove(live.box); delete w.tabs[42]; } an.tab = an.tab.filter(r => r.id !== 42); });

  // inches: a fraction in, the field in inches, the tab in mm underneath
  await page.evaluate(() => { const s = window.kiri.api.ui.units; s.value = 'in'; s.onchange(); s.dispatchEvent(new Event('change')); });
  await wait(500);
  await type('width', '3/4');
  t = await tabs(); f = await fieldsNow();
  check(t.list.every(r => near(r.y, 19.05)) && f.width.v === '0.75' && f.width.unit === 'in', `3/4 in inches: tabs 19.05 mm long, the field says ${f.width.v} ${f.width.unit}`);
  await page.evaluate(() => { const s = window.kiri.api.ui.units; s.value = 'mm'; s.onchange(); s.dispatchEvent(new Event('change')); });
  await wait(500);

  // a scale takes every tab away in Kiri; these come back at the new size with the pinned count
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); a.selection.scale(2, 1, 1); });
  await wait(800);
  t = await tabs();
  const box = await page.evaluate(() => window.kiri.api.widgets.all()[0].track.box);
  check(t.list.length === 6 && t.list.every(r => near(r.y, 19.05)) && t.boxes === 6, `after a scale to ${box.w.toFixed(0)} wide: 6 tabs back, still 19.05 long (${t.list.length}, ${t.boxes} drawn)`);
  check(t.list.every(r => Math.abs(r.px) <= box.w / 2 + 12 && Math.abs(r.py) <= box.h / 2 + 12), 'and they sit on the new outline');

  // automatic values follow the material: acrylic, slice, the automatic length changes
  await type('width', '');
  t = await tabs();
  const woodLen = t.list[0].y;
  check(near(woodLen, 12.7), `length emptied: back to automatic ${woodLen}`);
  await material('acrylic');
  await wait(400);
  await page.evaluate(() => window.kiri.api.event.emit('slice.begin', 'CAM'));
  await wait(300);
  t = await tabs();
  check(t.list.length === 6 && t.list.every(r => near(r.z, 6)), `acrylic: pinned height 6 stays (${t.list.map(r => r.z)})`);
  const sigOk = await page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all()[0]; return !!a.widgets.annotate(w.id).tabset.sig; });
  check(sigOk, 'the part remembers what its tabs were placed for');
  await material('plywood');
  await wait(300);

  // from corners: a big clearance pushes rectangle tabs to the sides' middles or drops some
  await type('corner', '200');
  t = await tabs();
  check(t.list.length < 6, `from corners 200 on a 600 x 200 part: fewer fit (${t.list.length})`);
  await type('corner', '');

  // the settings survive a reload
  await page.evaluate(() => { const a = window.kiri.api; a.space.auto_save && a.space.auto_save(); });
  await wait(5000);              // cam saves a part 1.5 s after it changes
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready();
  await page.waitForFunction(() => window.kiri.api.widgets.all().length === 1, { timeout: 30000 }).catch(() => {});
  await wait(1500);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); });
  await wait(600);
  t = await tabs(); f = await fieldsNow();
  check(t.set && t.set.pin.count === 6 && t.set.pin.height === 6 && t.list.length === 6, `after a reload: the part's settings and its 6 tabs (${t.set && JSON.stringify(t.set.pin)}, ${t.list.length})`);
  check(f.count.v === '6' && f.height.v === '6' && f.count.pinned, `and selecting it shows them (${f.count.v}, ${f.height.v})`);

  // the toolpath lifts over every tab at 6 mm
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  const done = await page.evaluate(() => new Promise(res => {
    window.kiri.api.event.on('preview.end', () => res('ok'));
    window.kiri.api.event.on('preview.error', e => res('error ' + e));
    setTimeout(() => res('timeout'), 60000);
  }));
  const gc = done === 'ok' ? await page.evaluate(() => new Promise(res => { try { window.kiri.api.function.export(g => res(typeof g === 'string' ? g : (g?.gcode || String(g)))); } catch (e) { res(''); } setTimeout(() => res(''), 30000); })) : '';
  let places = 0, zmin = 0;
  if (gc) {
    const k = /G20/.test(gc) ? 25.4 : 1;
    let z = 0, at = false;
    const zs = [];
    for (const line of gc.split(/\r?\n/)) { const mz = line.match(/Z(-?[\d.]+)/); if (mz && /^G0?1\b/.test(line)) zs.push(+mz[1] * k); }
    zmin = Math.min(...zs);
    for (const line of gc.split(/\r?\n/)) {
      const mz = line.match(/Z(-?[\d.]+)/);
      if (!mz || !/^G0?1\b/.test(line)) continue;
      z = +mz[1] * k;
      const top = Math.abs(z - (zmin + 6)) < 0.3;
      if (top && !at) places++;
      at = top;
    }
  }
  check(done === 'ok' && places >= 6, `the outline lifts to 6 mm above the bottom in ${places} places (wanted 6 or more, ${done})`);
  await page.evaluate(() => document.getElementById('act-arrange')?.click());
  await wait(800);

  // all automatic, then the trash: every tab gone and the settings forgotten
  await page.evaluate(() => document.getElementById('swarf-autotabs-auto').click());
  await wait(400);
  f = await fieldsNow(); t = await tabs();
  check(['width', 'height', 'depth', 'count', 'corner'].every(k => f[k].v === '') && t.list.length === +f.count.ph && near(t.list[0].y, 12.7), `all automatic: empty fields, the automatic ${f.count.ph} tabs on the 600 x 200 part, 12.7 long again (${t.list.length}, ${t.list[0]?.y})`);
  await page.evaluate(() => window.kiri.api.event.emit('cam.tabs.clear'));
  await wait(300);
  t = await tabs();
  check(t.list.length === 0 && !t.set, `trash: no tabs, no settings (${t.list.length}, ${!!t.set})`);
  await page.evaluate(() => window.kiri.api.event.emit('slice.begin', 'CAM'));
  await wait(300);
  t = await tabs();
  check(t.list.length === 0, 'and a slice does not bring them back');
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `tab settings: ${bad.length} failed, ${errors.length} page errors` : 'tab settings: ok');
process.exit(bad.length || errors.length ? 1 : 0);
