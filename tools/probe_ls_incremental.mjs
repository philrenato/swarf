// The simulate trail's cost per tool move (review r093-code A13: it rebuilt every ribbon on every
// move, O(N²) over a run). probe_sim_tex.mjs's job, a 160 mm disc marked stone wall, simulated to the
// end at a fixed speed. The trail's own swarf.tool.move listener is timed in place (the broker's
// channel is swapped for a timed wrapper), and the run's wall time from the first move to the last
// is taken. At the end it prints what the trail drew (__swarfLSPoints, __swarfLSSteps, and a hash
// of each ribbon's drawn vertices), again with the step's box unticked and ticked back, so two
// builds can be compared run against run, and a screenshot from the top.
//   node tools/probe_ls_incremental.mjs [url]     (OUT=/path/prefix for the json + screenshot)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-ls-incremental';
const SPEED = +(process.env.SPEED || 4000);
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfTex && window.SwarfTexCore && window.__swarfLightstreamLoaded), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => { try { localStorage.setItem('swarf.lightstream', '1'); } catch (e) {} window.__swarfLightstream = true; window.kiri.api.devices.select('ShopBot.Basic'); });
  // the ribbons, as the trail adds them to the world (renderOrder 997-999)
  await page.evaluate(() => { const w = window.moto.space.world, add = w.add; window.__lsRibbons = []; w.add = function (o) { if (o && o.isMesh && o.renderOrder >= 997 && o.renderOrder <= 999) window.__lsRibbons.push(o); return add.apply(this, arguments); }; });
  await wait(800);
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); const s = a.conf.get(); s.process.ops = []; a.conf.save(); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="160mm" height="160mm" viewBox="0 0 160 160"><circle cx="80" cy="80" r="80" fill="#000"/></svg>', 'circle', { depth: 19, resolution: 2, segmin: 48, soup: true, dpi: 0 }); });
  await wait(1200);
  await page.click('#swarf-step-tex');
  await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 15000 });
  await page.evaluate(() => {
    const S = window.__swarfTex.state(), C = window.SwarfTexCore, p = S.parts[0];
    S.sel = 0;
    const g = C.newGrid(p.box[0] - 2, p.box[1] - 2, p.box[2] + 2, p.box[3] + 2, 0.5);
    C.paintWhere(g, (x, y) => Math.hypot(x - (p.box[0] + p.box[2]) / 2, y - (p.box[1] + p.box[3]) / 2) < 78, 1);
    p.marks.push({ id: 'simtex', made: 'region', region: g, xf: C.IDENTITY.slice(), fill: C.newFill('stone', { tool: 1018, origin: [0, 0] }), ver: 1 });
    S.mark = 0; p.dirty = true;
  });
  await page.click('#tx-done');
  await wait(1000);
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  const pv = await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', () => res('preview.end')); setTimeout(() => res('timeout'), 120000); }));
  check(pv === 'preview.end', `toolpaths (${pv})`);
  // the trail's listener, timed where it sits in the broker's channel
  const wrapped = await page.evaluate(() => {
    const ch = window.kiri.api.event.listeners('swarf.tool.move') || [], i = ch.findIndex(f => /onMove/.test(String(f)));
    if (i < 0) return false;
    const fn = ch[i], T = window.__lsT = { n: 0, sum: 0, max: 0, first: 0, last: 0, per: [] };
    ch[i] = function (...a) { const t = performance.now(); fn.apply(this, a); const d = performance.now() - t; T.n++; T.sum += d; if (d > T.max) T.max = d; if (!T.first) T.first = t; T.last = t + d; T.per.push(d); };
    return true;
  });
  check(wrapped, 'the trail\'s swarf.tool.move listener is timed');
  await page.evaluate(() => { const b = [...document.querySelectorAll('.swarf-step, #act-animate, button')].find(e => /^\s*simulate\s*$/i.test(e.textContent)); b && b.click(); });
  await page.waitForFunction(() => window.__swarfSimStock, { timeout: 30000 }).catch(() => {});
  await wait(800);
  await page.evaluate(s => { window.__swarfCustomSpeed = s; window.dispatchEvent(new Event('swarf.speed.custom')); }, SPEED);
  await page.waitForFunction(() => +window.kiri.api.ui.anim.progress.value >= 100, { timeout: 900000, polling: 500 }).then(() => check(true, 'simulate ran to the end'), () => check(false, 'simulate ran to the end'));
  await wait(2000);
  const drawn = () => page.evaluate(() => {
    // each ribbon (core 999, halo 998, bloom 997): its drawn vertices, hashed
    const out = {};
    window.__lsRibbons.forEach(o => {
      const p = o.geometry.attributes.position, dr = o.geometry.drawRange;
      const n = Math.min(p.count, Number.isFinite(dr.count) ? dr.start + dr.count : p.count) * 3;
      let h = 0x811c9dc5, s = 0; const u = new Uint32Array(p.array.buffer, p.array.byteOffset, p.array.length);
      for (let k = 0; k < n; k++) { h = Math.imul(h ^ u[k], 16777619) >>> 0; s += p.array[k]; }
      out[o.renderOrder] = { verts: n / 3, hash: h.toString(16), sum: +s.toFixed(3) };
    });
    return { points: window.__swarfLSPoints, moves: window.__swarfLSMoves, steps: window.__swarfLSSteps(), ribbons: out };
  });
  const end = await drawn();
  const T = await page.evaluate(() => { const T = window.__lsT, p = T.per.slice().sort((a, b) => a - b), q = f => +p[Math.min(p.length - 1, Math.floor(p.length * f))].toFixed(4), last = T.per.slice(-1000);
    return { moves: T.n, totalMs: +T.sum.toFixed(1), meanMs: +(T.sum / T.n).toFixed(4), p50: q(0.5), p99: q(0.99), maxMs: +T.max.toFixed(2), last1000MeanMs: +(last.reduce((a, b) => a + b, 0) / last.length).toFixed(4), wallS: +((T.last - T.first) / 1000).toFixed(2) }; });
  console.log('   timing:', JSON.stringify(T));
  console.log('   end:', JSON.stringify(end));
  // the step's box off, then on again
  const box = '#layers .swarf-sim-path input';
  const hasBox = await page.$(box);
  let off = null, on = null;
  if (hasBox) {
    await page.click(box); await wait(500); off = await drawn();
    await page.click(box); await wait(500); on = await drawn();
    console.log('   box off:', JSON.stringify(off));
    console.log('   box on:', JSON.stringify(on));
    check(off.points === 0 && JSON.stringify(on.ribbons) === JSON.stringify(end.ribbons) && on.points === end.points, 'unticking the step empties the trail, ticking it brings back the same ribbons');
  } else check(false, 'the step has its box');
  await page.evaluate(() => { try { window.kiri.api.space.view.top && window.kiri.api.space.view.top(); } catch (e) { } });
  await wait(800);
  await page.screenshot({ path: `${OUT}-done.png` });
  fs.writeFileSync(`${OUT}.json`, JSON.stringify({ timing: T, end, off, on }, null, 1));
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `ls incremental: ${bad.length} failed, ${errors.length} page errors` : 'ls incremental: ok');
process.exit(bad.length || errors.length ? 1 : 0);
