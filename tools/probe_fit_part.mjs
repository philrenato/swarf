// A part you can see (review 105 F10): typed small in the size strip, or brought in small, it is framed if it
// would be under a fifth of the view; a part already big enough leaves the camera alone; a duplicate leaves the
// camera alone. view › fit to part really works, pressed with a real mouse, from a view that lost the part.
//   node tools/probe_fit_part.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const url = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const rect = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}"/></svg>`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-fit-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.moto?.space), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(800);
  const fresh = () => page.evaluate(() => { const a = window.kiri.api, s = a.conf.get(); a.platform.clear(); s.process.ops = []; a.conf.save(); }).then(() => wait(700));
  const part = (w, h, name) => page.evaluate((svg, name) => { window.kiri.api.platform.load_svg(svg, name, { depth: 12, soup: true, dpi: 0 }); }, rect(w, h), name).then(() => wait(1000));
  const look = name => page.evaluate(name => {
    const a = window.kiri.api, THREE = window.THREE, { camera } = window.moto.space.internals();
    camera.updateMatrixWorld();
    const list = a.widgets.all().filter(w => !name || w.meta.file === name);
    const box = new THREE.Box3(); for (const w of list) box.expandByObject(w.mesh);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) { const v = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
    const p = camera.position;
    return { span: Math.max(x1 - x0, y1 - y0) / 2, inView: x0 > -1 && x1 < 1 && y0 > -1 && y1 < 1, cam: [p.x, p.y, p.z] };
  }, name);
  const moved = (a, b) => Math.hypot(a.cam[0] - b.cam[0], a.cam[1] - b.cam[1], a.cam[2] - b.cam[2]) > 0.001 * Math.hypot(...a.cam);
  // type in the size strip, as a person does; keep proportions as it starts
  const typeWidth = async mm => {
    const box = await page.evaluateHandle(() => document.querySelector('#swarf-size input[title*="width"], #swarf-size label.ax input'));
    await box.click({ clickCount: 3 }); await page.keyboard.type(String(mm)); await page.keyboard.press('Enter'); await wait(1400);
  };

  // 1: resized small: a dot no more
  await fresh(); await part(1000, 500, 'big');
  await page.evaluate(() => { const a = window.kiri.api; a.platform.deselect(); a.platform.select(a.widgets.all()[0], false); }); await wait(300);
  let s0 = await look();
  check(s0.span > 0.2, `a big part fills enough (${(s0.span * 100).toFixed(0)}%)`);
  await typeWidth(30);
  let s1 = await look();
  check(s1.span >= 0.2 && s1.inView, `typed down to 30 mm it is framed, ${(s1.span * 100).toFixed(0)}% of the view (was left at under 20%)`);
  // 2: the review's walk: a part resized smaller among others is framed itself
  await fresh(); await part(1000, 500, 'big'); await part(800, 400, 'other');
  await page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all().find(w => w.meta.file === 'big'); a.platform.deselect(); a.platform.select(w, false); }); await wait(300);
  await typeWidth(30);
  s1 = await look('big');
  check(s1.span >= 0.2 && s1.inView, `with another part on the bed, the one resized is framed (${(s1.span * 100).toFixed(0)}%)`);
  // 3: a resize that leaves it big enough does not move the camera
  await fresh(); await part(1000, 500, 'big');
  await page.evaluate(() => { const a = window.kiri.api; a.platform.deselect(); a.platform.select(a.widgets.all()[0], false); }); await wait(1400);
  s0 = await look();
  await typeWidth(900);
  s1 = await look();
  check(!moved(s0, s1), `900 of 1000: the camera stays where it was (span ${(s1.span * 100).toFixed(0)}%)`);
  // 4: brought in small beside a big part: framed
  await fresh(); await part(1800, 900, 'sheet'); await wait(600);
  await page.evaluate(svg => { window.kiri.api.platform.load_svg(svg, 'tiny', { depth: 12, soup: true, dpi: 0 }); }, rect(20, 20)); await wait(1800);
  s1 = await look('tiny');
  check(s1.span >= 0.2 && s1.inView, `a 20 mm import beside a sheet is framed (${(s1.span * 100).toFixed(0)}%)`);
  // 5: a duplicate of that small part leaves the camera alone (the rule since r44)
  await page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all().find(w => w.meta.file === 'tiny'); a.platform.deselect(); a.platform.select(w, false); }); await wait(1200);
  await page.evaluate(() => { const a = window.kiri.api; window.moto.space.view.fit(undefined, { tween: false, padding: 1, objects: [a.widgets.all().find(w => w.meta.file === 'sheet').mesh] }); }); await wait(400);
  s0 = await look();
  check((await look('tiny')).span < 0.2, 'the view is back on the sheet, the small part small');
  await page.evaluate(() => window.kiri.api.selection.duplicate()); await wait(1200);
  s1 = await look();
  check(!moved(s0, s1), 'a duplicate beside it leaves the camera alone');
  // 6: view › fit to part, a real mouse, from a view that lost the part
  await fresh(); await part(300, 200, 'lost');
  await page.evaluate(() => window.moto.space.view.panTo(3000, 0, 2000, 1, 1.3, 50)); await wait(500);
  s0 = await look();
  check(!s0.inView || s0.span < 0.2, `the view has lost it (span ${(s0.span * 100).toFixed(0)}%, in view ${s0.inView})`);
  const at = await page.evaluate(() => { const s = [...document.querySelectorAll('#menubar .top-menu > span')].find(x => /^view/i.test(x.textContent.trim())); const r = s.getBoundingClientRect(); return [r.left + 10, r.top + r.height / 2]; });
  await page.mouse.click(...at); await wait(300);
  const it = await page.evaluate(() => { const e = document.getElementById('view-fit'), r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, title: e.title, text: e.textContent.trim() }; });
  check(it.w > 0 && /fit to part/.test(it.text) && !!it.title, `view has fit to part, with a tooltip ("${it.title}")`);
  await page.mouse.click(it.x, it.y); await wait(1400);
  s1 = await look();
  check(s1.inView && s1.span >= 0.2, `the press brings it back (${(s1.span * 100).toFixed(0)}% of the view, in view ${s1.inView})`);
  check(!errors.length, `no page errors: ${errors.slice(0, 3).join(' | ')}`);
} catch (e) { check(false, `the probe stopped: ${e.message}`); }
await browser.close();
console.log(bad.length ? `FAILED ${bad.length}` : 'ALL OK');
process.exit(bad.length ? 1 : 0);
