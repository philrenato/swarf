// NOTHING CUT FREE UNHELD (Phil 10-29: "make sure that tabs handle parts with insides that need to
// be retained ... anything that could fly off the machine. cuts that seem to go all the way
// through without tabs should be flagged"): a 300 mm ring with a 150 mm hole and a 200 mm disc
// ("plate") with a 40 mm hole, 3/4 in plywood on the ShopBot, an outline step.
//   - with no tabs, concerns says each part is cut free and that the hole's piece is loose
//   - auto tabs hold the outside and every hole that leaves a loose piece; the concerns go
//   - "hold inside pieces" off: the hole gets none, and its concern comes back
//   - control's cut checklist from cam warns the same, and never says to reach in
//   node tools/probe_loose.mjs [url]
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
  await page.evaluate(() => {
    const a = window.kiri.api;
    a.conf.get().process.ops = [];
    const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'outline');
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    window.__swarfAutoTabs.set({ density: 0, scale: 0, pin: {} });
  });
  await wait(600);
  const concerns = async () => { await page.evaluate(() => window.kiri.api.event.emit('cam.op.render')); await wait(300); return page.evaluate(() => [...document.querySelectorAll('#swarf-concerns-body .swarf-concern strong')].map(e => e.textContent)); };
  let c = await concerns();
  check(c.some(t => /ring is cut free with no tabs/.test(t)), `no tabs: "ring is cut free with no tabs" (${c})`);
  check(c.some(t => /1 loose piece inside ring/.test(t)), `and "1 loose piece inside ring" (${c})`);

  // a rough to the bottom frees the part too (Phil 10-29: a circle with only a rough step)
  await page.evaluate(() => {
    const a = window.kiri.api;
    a.conf.get().process.ops = [];
    const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'rough');
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await wait(500);
  c = await concerns();
  check(c.some(t => /ring is cut free with no tabs/.test(t)), `a rough alone: still "cut free with no tabs" (${c})`);
  await page.evaluate(() => {
    const a = window.kiri.api;
    a.conf.get().process.ops = [];
    const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'outline');
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await wait(500);

  // auto tabs: the outside and the hole
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); window.__swarfAutoTabs.preview(); document.getElementById('swarf-autotabs-apply').click(); });
  await wait(500);
  let au = await page.evaluate(() => window.__swarfAutoTabs.audit(window.kiri.api.widgets.all()[0]));
  check(au.outerTabs >= 4 && au.loose.length === 1 && au.loose[0].tabs >= 2, `auto tabs hold the outside (${au.outerTabs}) and the hole's piece (${au.loose[0]?.tabs})`);
  c = await concerns();
  check(!c.some(t => /ring/.test(t)), `and the ring's concerns are gone (${c})`);

  // "hold inside pieces" off: the hole's concern comes back
  await page.evaluate(() => { const el = document.getElementById('swarf-autotabs-holes'); el.checked = false; el.dispatchEvent(new Event('change')); });
  await wait(500);
  au = await page.evaluate(() => window.__swarfAutoTabs.audit(window.kiri.api.widgets.all()[0]));
  c = await concerns();
  check(au.outerTabs >= 4 && au.loose[0].tabs === 0 && c.some(t => /1 loose piece inside ring/.test(t)) && !c.some(t => /cut free with no tabs/.test(t)), `hold inside pieces off: the hole has none and says so (${au.loose[0]?.tabs}, ${c})`);
  await page.evaluate(() => { const el = document.getElementById('swarf-autotabs-holes'); el.checked = true; el.dispatchEvent(new Event('change')); });
  await wait(500);

  // a 200 mm disc with a 40 mm hole: its 27 mm piece is loose too, it gets a tab
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); });
  await wait(500);
  await load('ring', { d: 200, di: 40 }, 'plate');
  await page.waitForFunction(() => window.kiri.api.widgets.all().length === 1, { timeout: 10000 });
  await wait(600);
  au = await page.evaluate(() => window.__swarfAutoTabs.audit(window.kiri.api.widgets.all()[0]));
  check(au.loose.length === 1 && Math.abs(au.loose[0].across - 40) < 1.5, `the plate's 40 mm hole leaves a loose piece (holes from ${au.holeMin} mm: ${JSON.stringify(au.loose)})`);
  c = await concerns();
  check(c.some(t => /plate is cut free/.test(t)) && c.some(t => /loose piece inside plate/.test(t)), `concerns name both (${c})`);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); window.__swarfAutoTabs.preview(); document.getElementById('swarf-autotabs-apply').click(); });
  await wait(500);
  au = await page.evaluate(() => window.__swarfAutoTabs.audit(window.kiri.api.widgets.all()[0]));
  const dims = await page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all()[0]; return (a.widgets.annotate(w.id).tab || []).map(r => r.dim.y); });
  check(au.outerTabs >= 3 && au.loose[0].tabs >= 1, `auto tabs: ${au.outerTabs} outside, ${au.loose[0].tabs} in the 40 mm hole (lengths ${dims})`);
  c = await concerns();
  check(!c.some(t => /plate/.test(t)), `no plate concerns left (${c})`);

  // control's checklist from cam: take one tab set away and look at the words
  await page.evaluate(() => window.kiri.api.event.emit('cam.tabs.clear'));
  await wait(300);
  const words = await page.evaluate(() => {
    const out = [];
    try {
      // the same rule control runs: its checklist words, read through the run module's own helper
      const a = window.kiri.api, audit = window.__swarfAutoTabs.audit, w = a.widgets.all()[0], r = audit(w);
      out.push(r.outerTabs, r.loose.filter(h => h.tabs === 0).length);
    } catch (e) { out.push(String(e)); }
    return out;
  });
  check(words[0] === 0 && words[1] === 1, `after the trash: nothing holds the plate or its piece (${words})`);
  const src = await page.evaluate(() => fetch('swarf-run.js').then(r => r.text()));
  check(/cut free with no tab/.test(src) && !/hold (it|them) down/.test(src) && /Never reach in while the router turns/.test(src), 'control warns the same, and never tells anyone to hold a piece down by hand');
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `loose: ${bad.length} failed, ${errors.length} page errors` : 'loose: ok');
process.exit(bad.length || errors.length ? 1 : 0);
