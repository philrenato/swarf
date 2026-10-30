// CAM torture-test fixes (10-29), in the app:
//   - export after a material change makes the toolpaths again: the file has the new feeds
//   - the ShopBot file refuses to run on a ShopBot set to inches (IF %(25)=0 THEN GOTO UNIT_ERROR)
//   - undo a delete: the part is back in its group, its tabs still lift the outline, it can be scaled
//   - an STL with a NaN vertex loads without freezing the page
//   - a resize that takes away tabs placed by hand says so
//   node tools/probe_cam_review.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME || (process.env.HOME + '/.local/bin/chrome-for-testing');
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'], protocolTimeout: 120000 });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.event && window.kiri.api.platform?.load_svg && window.__swarfShape && window.__swarfAutoTabs && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 200 });
  await wait(1500);
  const material = m => page.evaluate(m => { const s = document.getElementById('swarf-material-select'); s.value = m; s.dispatchEvent(new Event('change', { bubbles: true })); }, m);
  const gcode = () => page.evaluate(() => new Promise(res => { try { window.kiri.api.function.export(g => res(typeof g === 'string' ? g : (g?.gcode || String(g)))); } catch (e) { res(''); } setTimeout(() => res(''), 60000); }));
  const preview = () => page.evaluate(() => new Promise(res => {
    window.kiri.api.event.on('preview.end', () => res('ok'));
    window.kiri.api.event.on('preview.error', e => res('error ' + e));
    document.getElementById('act-paths')?.click();
    setTimeout(() => res('timeout'), 60000);
  }));

  // MR-1, plywood, a rectangle and an outline; toolpaths; then aluminum; export
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); });
  await page.evaluate(() => window.kiri.api.devices.select('Langmuir.MR-1'));
  await wait(900);
  await material('plywood');
  await wait(300);
  await page.evaluate(() => window.kiri.api.platform.load_svg(window.__swarfShape.svgFor('rect', { w: 120, h: 80 }), 'rectangle', { depth: 12, resolution: 2, segmin: 48, soup: true, dpi: 0, edge: { kind: 'straight', size: 0 } }));
  await page.waitForFunction(() => window.kiri.api.widgets.all().length === 1, { timeout: 10000 });
  await wait(500);
  await page.evaluate(() => {
    window.kiri.api.conf.get().process.ops = [];
    const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'outline');
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await wait(500);
  check(await preview() === 'ok', 'toolpaths for plywood');
  const plyFeed = await page.evaluate(() => window.kiri.api.conf.get().process.ops.find(o => o.type === 'outline').rate);
  await material('aluminum_6061');
  await wait(600);
  const aluFeed = await page.evaluate(() => window.kiri.api.conf.get().process.ops.find(o => o.type === 'outline').rate);
  const g1 = await gcode();
  const feeds = [...g1.matchAll(/F(\d+(\.\d+)?)/g)].map(m => +m[1]);
  check(aluFeed !== plyFeed && feeds.length && !feeds.includes(plyFeed) && feeds.includes(aluFeed), `export after aluminum: the file has its feed ${aluFeed}, not plywood's ${plyFeed} (${[...new Set(feeds)].slice(0, 6)})`);

  // the ShopBot file: units check after 'UNITS:MM
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(900);
  await material('plywood');
  await wait(400);
  const sbp = await gcode();
  check(/'UNITS:MM\s*\n\s*IF %\(25\)=0 THEN GOTO UNIT_ERROR/.test(sbp) && /UNIT_ERROR:/.test(sbp), "the ShopBot file checks the machine's units before it moves");

  // auto tabs, delete, undo: tabs still lift the outline, and the part scales
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); window.__swarfAutoTabs.set({ density: 0, scale: 0, pin: {} }); window.__swarfAutoTabs.preview(); document.getElementById('swarf-autotabs-apply').click(); });
  await wait(500);
  const lifts = g => { const k = /G20/.test(g) ? 25.4 : 1; const zs = []; for (const l of g.split(/\r?\n/)) { const m = l.match(/^(?:G0?1|M[3Z])\b.*?Z(-?[\d.]+)/i) || l.match(/^M3,[^,]*,[^,]*,(-?[\d.]+)/i); if (m) zs.push(+m[1] * k); } if (!zs.length) return 0; const lo = Math.min(...zs); let n = 0, up = false; for (const z of zs) { const t = z > lo + 1; if (t && !up) n++; up = t; } return n; };
  const before = lifts(await gcode());
  await page.evaluate(() => { const a = window.kiri.api; a.platform.delete(a.widgets.all()[0]); });
  await wait(500);
  await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta');
  await wait(800);
  let n = await page.evaluate(() => window.kiri.api.widgets.all().length);
  if (!n) { await page.evaluate(() => window.kiri.api.event.emit('key.undo') || (window.kiri.api.do && window.kiri.api.do.undo && window.kiri.api.do.undo())); await wait(800); n = await page.evaluate(() => window.kiri.api.widgets.all().length); }
  const grp = await page.evaluate(() => { const w = window.kiri.api.widgets.all()[0]; return w ? { inGroup: w.group.includes(w), tabs: (w.anno.tab || []).length } : null; });
  check(n === 1 && grp && grp.inGroup && grp.tabs >= 4, `undo: the part is back in its group with its tabs (${JSON.stringify(grp)})`);
  const after = lifts(await gcode());
  check(before >= 3 && after >= before - 1, `and the outline still lifts over them (${before} before, ${after} after)`);
  const scaled = await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); try { a.selection.scale(1.5, 1, 1); return true; } catch (e) { return e.message; } });
  check(scaled === true, `and it can be scaled (${scaled})`);

  // a resize that takes away hand tabs says so
  await page.evaluate(() => {
    const a = window.kiri.api, w = a.widgets.all()[0], l = a.widgets.annotate(w.id).tab = a.widgets.annotate(w.id).tab || [];
    const a0 = l.find(r => r.auto);
    l.push({ pos: { ...a0.pos }, dim: { ...a0.dim }, rot: a0.rot, id: 4242 });
    const al = document.getElementById('alert-text'); if (al) al.textContent = '';
  });
  await page.evaluate(() => { const a = window.kiri.api; a.selection.scale(0.8, 1, 1); });
  await wait(600);
  const said = await page.evaluate(() => [...document.querySelectorAll('#alert-text, #alert-area, .alert')].map(e => e.textContent).join(' | '));
  check(/took away 1 tab you placed by hand/.test(said), `the resize says it took the hand tab ("${said.slice(0, 120)}")`);

  // an STL with a NaN vertex: loads, the page answers
  const stl = 'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nfacet normal 0 0 1\nouter loop\nvertex 0 0 5\nvertex nan 0 5\nvertex 0 10 5\nendloop\nendfacet\nendsolid t\n';
  const t0 = Date.now();
  await page.evaluate(s => { const a = window.kiri.api; const f = new File([s], 'nan.stl', { type: 'model/stl' }); a.platform.load_files([f]); }, stl);
  await wait(2500);
  const alive = await Promise.race([page.evaluate(() => 1 + 1), wait(20000).then(() => 0)]);
  check(alive === 2, `an STL with a NaN vertex: the page still answers (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `cam review: ${bad.length} failed, ${errors.length} page errors` : 'cam review: ok');
process.exit(bad.length || errors.length ? 1 : 0);
