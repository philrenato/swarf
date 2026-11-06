// Simulate frames the board in the clear part of the window (review 105 F7, r086 S5): from any camera, at
// 1440x900 and 1366x768, for a small part, a wide one and a whole-sheet one, no corner of the board sits
// under the panels, the menus or the bar; the view looks down; the board is not a dot; and one fit at a
// time holds. The speed row says how the run compares with the real cut, and the number is measured here too.
//   node tools/probe_sim_frame.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const url = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || tmpdir();
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const rect = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}"/></svg>`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-simframe-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const size = async (w, h) => { await page.setViewport({ width: w, height: h }); await wait(500); };
  await size(1440, 900);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.moto?.space), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(800);
  // every fit from the moment of the press: tweens are counted, so two at once would show
  await page.evaluate(() => {
    const V = window.moto.space.view; window.__fits = [];
    for (const k of ['fit', 'place']) { const f = V[k]; if (f) V[k] = function (then, opts) { window.__fits.push({ k, tween: opts?.tween !== false, t: performance.now() }); return f.call(this, then, opts); }; }
  });
  const leave = () => page.evaluate(() => { document.getElementById('act-clear')?.click(); }).then(() => wait(500));
  const fresh = () => page.evaluate(() => { const a = window.kiri.api, s = a.conf.get(); a.view.set_arrange(); a.platform.clear(); s.process.ops = []; a.conf.save(); a.event.emit('cam.op.render'); }).then(() => wait(500));
  const part = (w, h, name) => page.evaluate((svg, name) => { window.kiri.api.platform.load_svg(svg, name, { depth: 12, soup: true, dpi: 0 }); }, rect(w, h), name).then(() => wait(900));
  const outline = () => page.evaluate(() => [...document.querySelectorAll('#op-add-list > div')].find(d => d.textContent.trim() === 'outline').click()).then(() => wait(400));
  const toolpaths = () => page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); document.getElementById('act-paths').click(); setTimeout(res, 60000); })).then(() => wait(600));
  const camera = kind => page.evaluate(kind => {
    const V = window.moto.space.view;
    if (kind === 'front') V.front(); else if (kind === 'near') V.panTo(400, 0, 300, 1.2, 1.45, 50);
  }, kind).then(() => wait(600));
  const measure = () => page.evaluate(() => {
    const THREE = window.THREE, st = window.__swarfSimStock, { camera, renderer } = window.moto.space.internals();
    if (!st) return { none: true };
    camera.updateMatrixWorld(); st.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(st), r = renderer.domElement.getBoundingClientRect();
    const corners = [];
    for (let i = 0; i < 8; i++) {
      const v = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
      corners.push([r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]);
    }
    const panels = {};
    for (const id of ['panel', 'panel-left', 'panel-right', 'swarf-right-rail', 'menubar', 'mode-tools', 'layer-animate']) {
      const e = document.getElementById(id); if (!e) continue;
      const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') continue;
      const b = e.getBoundingClientRect(); if (b.width < 20 || b.height < 16) continue;
      panels[id] = [b.left, b.top, b.right, b.bottom];
    }
    const c = box.getCenter(new THREE.Vector3()), d = camera.position.clone().sub(c).normalize();
    const pos = camera.position;
    return { corners, panels, downDeg: Math.acos(Math.min(1, d.y)) * 180 / Math.PI, W: innerWidth, H: innerHeight, cam: [pos.x, pos.y, pos.z], fits: window.__fits.slice() };
  });
  const under = (m) => {
    const out = [];
    m.corners.forEach(([x, y], i) => {
      if (x < 0 || y < 0 || x > m.W || y > m.H) out.push(`corner ${i} off the window at ${Math.round(x)},${Math.round(y)}`);
      for (const [id, b] of Object.entries(m.panels)) if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) out.push(`corner ${i} (${Math.round(x)},${Math.round(y)}) under #${id}`);
    });
    return out;
  };
  const span = m => { const xs = m.corners.map(c => c[0]), ys = m.corners.map(c => c[1]); return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]; };
  const simulate = async () => {
    await page.evaluate(() => { window.__fits.length = 0; document.getElementById('act-animate').click(); });
    await page.waitForFunction(() => !!window.__swarfSimStock, { timeout: 90000, polling: 100 });
    await wait(1400);   // the tween lands, its correction with it
  };
  const cases = [['a small part', 150, 100], ['a wide part', 1800, 300], ['a whole sheet', 2400, 1200], ['a tall part', 200, 1100]];
  const views = [[1440, 900], [1366, 768]];
  for (const [w, h] of views) {
    await size(w, h);
    for (const [name, pw, ph] of cases) for (const low of [null, 'front', 'near']) {
      await fresh(); await part(pw, ph, 'p'); await outline(); await toolpaths();
      if (low) await camera(low);
      await simulate();
      const m = await measure(), bads = m.none ? ['no board'] : under(m), [sx, sy] = m.none ? [0, 0] : span(m);
      const tag = `${w}×${h}, ${name}, camera ${low || 'as it was'}`;
      check(!bads.length, `${tag}: no corner under anything${bads.length ? ': ' + bads.slice(0, 3).join('; ') : ''}`);
      if (!m.none) {
        check(m.downDeg < 60, `${tag}: looks down (${m.downDeg.toFixed(0)}° from straight down)`);
        const free = Math.min(w - 330, 9999), freeH = h - 150;
        check(sx > free * 0.35 || sy > freeH * 0.35, `${tag}: fills the clear part (${Math.round(sx)} × ${Math.round(sy)} px)`);
        const tw = m.fits.filter(f => f.tween).length;
        check(tw <= 1, `${tag}: one fit at a time (${tw} tweens)`);
        const m2 = await (async () => { await wait(800); return measure(); })();
        check(Math.hypot(m2.cam[0] - m.cam[0], m2.cam[1] - m.cam[1], m2.cam[2] - m.cam[2]) < 0.01 * Math.hypot(...m.cam), `${tag}: stays put`);
      }
      if (low === 'front' && name === 'a small part') await page.screenshot({ path: join(OUT, `sim-frame-${w}.png`) });
      await leave();
    }
    // simulate pressed with no toolpaths yet: they are made first, then it frames
    await fresh(); await part(300, 200, 'p'); await outline(); await camera('front');
    await page.evaluate(() => { window.__fits.length = 0; window.__swarfSimStock = null; document.getElementById('act-animate').click(); });
    await page.waitForFunction(() => !!window.__swarfSimStock, { timeout: 90000, polling: 100 });
    await wait(1600);
    let m = await measure();
    check(!m.none && !under(m).length && m.downDeg < 60, `${w}×${h}, no toolpaths first: framed once they are made: ${(m.none ? ['no board'] : under(m)).slice(0, 2).join('; ')} (${m.downDeg?.toFixed(0)}°)`);
    // a press of F while it plays: still clear
    await camera('front');
    await page.keyboard.press('f'); await wait(1300);
    m = await measure();
    check(!under(m).length && m.downDeg < 60, `${w}×${h}, F in simulate: the board stays clear: ${under(m).slice(0, 2).join('; ')}`);
    await leave();
  }

  // the speed row, against the clock
  await size(1440, 900);
  // a round part: enough short moves for the run to last. (A straight outline plays in under a second.)
  await fresh();
  await page.evaluate(() => { window.kiri.api.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="200mm" viewBox="0 0 200 200"><circle cx="100" cy="100" r="100"/></svg>', 'round', { depth: 12, resolution: 2, segmin: 48, soup: true, dpi: 0 }); }); await wait(900);
  await outline(); await toolpaths(); await wait(1500);
  await page.evaluate(() => document.getElementById('act-animate').click());
  await page.waitForFunction(() => !!window.__swarfSimStock, { timeout: 60000, polling: 100 });
  const T0 = Date.now();
  let start = null, end = null, seconds = 0, shown = '', times = 0;
  while (Date.now() - T0 < 180000) {
    const s = await page.evaluate(() => { const E = window.SwarfEstimateUI.state(), e = document.getElementById('swarf-sim-real'); return { f: E.frac, sec: E.est?.seconds, text: e?.textContent || '', times: +(e?.dataset.times || 0), title: e?.title, vis: !!e?.offsetParent }; });
    if (s.sec) seconds = s.sec;
    if (s.f > 0.02 && !start) start = { t: Date.now(), f: s.f };
    if (s.text) { shown = s.text; times = s.times; }
    if (s.f >= 0.9 && !end) { end = { t: Date.now(), f: s.f }; break; }
    await wait(100);
  }
  check(/^about [\d.]+× real time$/.test(shown), `the speed row says it: "${shown}"`);
  const rowTitle = await page.evaluate(() => document.getElementById('swarf-sim-real')?.title);
  check(!!rowTitle, 'with a tooltip');
  check(start && end && seconds > 0, `the run was timed (est ${seconds.toFixed(0)} s)`);
  if (start && end && seconds > 0) {
    const wall = (end.t - start.t) / 1000, real = (end.f - start.f) * seconds / wall;
    console.log(`note: ${seconds.toFixed(0)} s of cutting played in ${(wall / (end.f - start.f)).toFixed(1)} s: ${real.toFixed(1)}× measured, ${times}× shown`);
    check(times > 0 && times / real < 1.5 && real / times < 1.5, `what it says is what happened (${times}× shown, ${real.toFixed(1)}× measured here)`);
  }
  check(await page.evaluate(() => !/machine's own speed/.test([...document.querySelectorAll('#layer-animate input')].map(i => i.title).join(' '))), "the field no longer calls 1 the machine's own speed");
  check(!errors.length, `no page errors: ${errors.slice(0, 3).join(' | ')}`);
} catch (e) { check(false, `the probe stopped: ${e.message}`); }
await browser.close();
console.log(bad.length ? `FAILED ${bad.length}` : 'ALL OK');
process.exit(bad.length ? 1 : 0);
