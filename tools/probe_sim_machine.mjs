// The ShopBot in cam's SIMULATE (Phil 10-27: "Maybe that can also be in the
// simulate main view?"). While the simulation plays, the world (stock, part,
// paths, chips) slides in X by minus the bit's X travel, so the bit stays under
// a gantry that does not move; "machine" in the simulate controls turns it off
// (world still) and on; leaving simulate puts the world back.
//   node tools/probe_sim_machine.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME || '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-sim-machine';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfSimMachine), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => { try { localStorage.setItem('swarf-run-ghost', '1'); } catch (e) {} window.kiri.api.devices.select('ShopBot.Basic'); });
  await wait(800);
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100"><rect width="200" height="100" fill="#000"/></svg>', 'board', { depth: 6, resolution: 2, segmin: 48, soup: true, dpi: 0 }); a.platform.deselect(); });
  await wait(600);
  await page.evaluate(() => { const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(400);
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); setTimeout(res, 60000); }));
  // simulate: the bit's X and the world's X, sampled as it plays
  await page.evaluate(() => { window.__toolX = []; window.kiri.api.event.on('swarf.tool.move', ({ pos }) => window.__toolX.push([pos.x, window.__swarfSimMachine.state().worldX])); });
  await page.evaluate(() => { const b = [...document.querySelectorAll('.swarf-step, #act-animate, button')].find(e => /^\s*simulate\s*$/i.test(e.textContent)); b && b.click(); });
  await page.waitForFunction(() => window.__swarfSimMachine.state().active && window.__toolX.length > 30, { timeout: 60000 }).catch(() => {});
  await wait(1500);
  const s = await page.evaluate(() => ({ st: window.__swarfSimMachine.state(), samples: window.__toolX.slice(-200), off: window.SwarfShopBotModel.OFFSET, chip: !!document.getElementById('swarf-sim-machine') }));
  const spread = s.samples.length ? Math.max(...s.samples.map(q => q[0])) - Math.min(...s.samples.map(q => q[0])) : 0;
  // the world's slide undoes the bit's X travel: bit x + world x stays at the first bit x
  const worst = s.samples.reduce((m, [x, wx]) => Math.max(m, Math.abs(x + wx - s.st.x0)), 0);
  check(s.st.active && s.chip && spread > 20 && worst < 1e-6 && Math.abs(s.st.gantryX - s.st.x0 - s.off) < 1e-6, `the bed slides under a still gantry: bit travelled ${spread.toFixed(1)} mm in X, held to within ${worst.toExponential(1)} mm of the gantry line (${s.samples.length} steps)`);
  await page.screenshot({ path: `${OUT}-on.png` });
  { const c = await page.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }); await page.mouse.move(c[0], c[1]); for (let i = 0; i < 30; i++) { await page.mouse.wheel({ deltaY: -400 }); await wait(50); } await wait(700); await page.screenshot({ path: `${OUT}-far.png` }); }
  // off and on again: turning it on steps back to the whole machine
  await page.click('#swarf-sim-machine'); await wait(400); await page.click('#swarf-sim-machine'); await wait(1500);
  await page.screenshot({ path: `${OUT}-machine.png` });
  // machine off: the world stops sliding
  await page.click('#swarf-sim-machine');
  await wait(600);
  const off = await page.evaluate(() => window.__swarfSimMachine.state());
  check(!off.on && off.worldX === 0, `machine off: the world holds still (${off.worldX})`);
  await page.click('#swarf-sim-machine');
  // leaving simulate puts it back
  await page.evaluate(() => window.kiri.api.view.set_arrange());
  await wait(600);
  const back = await page.evaluate(() => window.__swarfSimMachine.state());
  check(!back.active && back.worldX === 0, `leaving simulate: the world is back (${back.worldX})`);
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `sim machine: ${bad.length} failed, ${errors.length} page errors` : 'sim machine: ok');
process.exit(bad.length || errors.length ? 1 : 0);
