// Simulate's paths on and off by step (Phil 11-01: "when simulate is done can we allow the visible
// toolpaths to be turned on and off with checkboxes like toolpaths already does?"). A 100 mm disc
// with two steps (rough, outline): toolpaths, then simulate to the end. The toolpaths view's toggle
// row holds one box per step, named as the step list names them, above the sim bar (never under it,
// never past the window's edge) at 1280x720 and 1366x768; unticking a step takes its trail away and
// leaves the other's, ticking brings it back; lightstreams off hides the row; leaving simulate takes
// the boxes away and the toolpaths view has its own toggles again. Screenshots of each size.
//   node tools/probe_sim_paths.mjs [url]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-sim-paths';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1280,720'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfLightstreamLoaded), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => { try { localStorage.setItem('swarf.lightstream', '1'); } catch (e) {} window.__swarfLightstream = true; window.kiri.api.devices.select('ShopBot.Basic'); });
  await wait(800);
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); const s = a.conf.get(); s.process.ops = []; a.conf.save(); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#000"/></svg>', 'disc', { depth: 6, resolution: 2, segmin: 48, soup: true, dpi: 0 }); a.platform.deselect(); });
  await wait(800);
  for (const kind of ['rough', 'outline']) {
    await page.evaluate(k => { const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === k); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, kind);
    await wait(400);
  }
  const steps = await page.evaluate(() => window.kiri.api.conf.get().process.ops.map(o => o.type).filter(t => t !== '|'));
  check(steps.join() === 'rough,outline', `two steps: ${steps.join(', ')}`);
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  const pv = await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', () => res('preview.end')); setTimeout(() => res('timeout'), 90000); }));
  check(pv === 'preview.end', `toolpaths (${pv})`);
  const kiriRow = await page.evaluate(() => [...document.querySelectorAll('#layers .var-row label')].map(l => l.textContent));
  // simulate to the end, at 8×: faster, the trail samples the bit too far apart to draw a 100 mm circle
  await page.evaluate(() => { const b = [...document.querySelectorAll('.swarf-step, #act-animate, button')].find(e => /^\s*simulate\s*$/i.test(e.textContent)); b && b.click(); });
  await page.waitForFunction(() => window.__swarfSimStock, { timeout: 30000 }).catch(() => {});
  await wait(800);
  await page.evaluate(() => { window.__swarfCustomSpeed = 8; window.dispatchEvent(new Event('swarf.speed.custom')); });
  await page.waitForFunction(() => +window.kiri.api.ui.anim.progress.value >= 100, { timeout: 240000, polling: 500 }).then(() => check(true, 'simulate ran to the end'), () => check(false, 'simulate ran to the end'));
  await wait(1200);
  const segs = await page.evaluate(() => window.__swarfLSSteps());
  console.log('   trail by step:', JSON.stringify(segs));
  check(Object.keys(segs).filter(k => k !== 'undefined' && segs[k].segs > 0).length === 2, 'the trail knows each step\'s cut');
  const row = () => page.evaluate(() => {
    const boxes = [...document.querySelectorAll('#layers .swarf-sim-path')].filter(r => r.offsetParent);
    const bar = document.getElementById('layer-animate').getBoundingClientRect(), all = document.getElementById('layers').getBoundingClientRect();
    return { names: boxes.map(r => r.querySelector('label').textContent), checked: boxes.map(r => r.querySelector('input').checked), bottom: all.bottom, left: all.left, right: all.right, top: all.top, barTop: bar.top, w: innerWidth, h: innerHeight, points: window.__swarfLSPoints || 0, sameLook: boxes.every(r => r.classList.contains('var-row')) };
  });
  const r0 = await row();
  check(r0.names.join() === 'rough,outline' && r0.checked.every(Boolean) && r0.sameLook, `one box per step, ticked, the toolpaths view's row (${r0.names.join(', ')}; toolpaths had ${kiriRow.join(', ')})`);
  for (const [w, h] of [[1280, 720], [1366, 768]]) {
    await page.setViewport({ width: w, height: h });
    await wait(900);
    const r = await row();
    check(r.bottom <= r.barTop + 0.5 && r.top > 0 && r.left >= 0 && r.right <= r.w && r.names.length === 2, `${w}x${h}: the row sits above the sim bar (row ${r.top.toFixed(0)}–${r.bottom.toFixed(0)}, bar from ${r.barTop.toFixed(0)}), inside the window`);
    await page.screenshot({ path: `${OUT}-${w}x${h}.png` });
  }
  await page.setViewport({ width: 1280, height: 720 });
  await wait(600);
  const click = name => page.evaluate(n => { const r = [...document.querySelectorAll('#layers .swarf-sim-path')].find(x => x.querySelector('label').textContent === n); r.querySelector('input').click(); }, name);
  const full = (await row()).points;
  await click('rough'); await wait(300);
  const noRough = (await row()).points;
  check(full > 0 && noRough > 0 && noRough < full, `rough unticked: its trail goes, outline's stays (${full} → ${noRough} trail points)`);
  await page.screenshot({ path: `${OUT}-no-rough.png` });
  await click('outline'); await wait(300);
  const none = (await row()).points;
  check(none === 0, `both unticked: no trail (${none})`);
  await click('rough'); await click('outline'); await wait(300);
  const back = (await row()).points;
  check(back === full, `both ticked again: the whole trail is back (${back})`);
  // lightstreams off: nothing to toggle, the row goes; on: it is back
  await page.click('.swarf-toggle-lightstream'); await wait(300);
  const off = await row();
  await page.click('.swarf-toggle-lightstream'); await wait(300);
  const on = await row();
  check(off.names.length === 0 && on.names.length === 2, `lightstreams off hides the row (${off.names.length}), on shows it (${on.names.length})`);
  // leaving simulate for the toolpaths: the step boxes go, the toolpaths view's own toggles return
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); setTimeout(res, 90000); }));
  await wait(600);
  const tp = await page.evaluate(() => ({ sim: document.querySelectorAll('#layers .swarf-sim-path').length, kiri: [...document.querySelectorAll('#layers .var-row label')].map(l => l.textContent), cls: document.body.classList.contains('swarf-sim-paths'), shown: getComputedStyle(document.getElementById('layers')).display }));
  check(tp.sim === 0 && !tp.cls && tp.kiri.join() === kiriRow.join() && tp.shown !== 'none', `back in toolpaths: no step boxes, its own toggles (${tp.kiri.join(', ')})`);
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `sim paths: ${bad.length} failed, ${errors.length} page errors` : 'sim paths: ok');
process.exit(bad.length || errors.length ? 1 : 0);
