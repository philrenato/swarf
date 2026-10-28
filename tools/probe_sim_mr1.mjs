// The MR-1 in cam's SIMULATE (Phil 10-28: "a stationary bed machine ... the axes in
// motion over a fixed bed"). While the simulation plays the world holds still and
// the MR-1's gantry follows the bit in Y, its carriage in X and its spindle in Z;
// "machine" turns it off and on; leaving simulate hides it.
//   node tools/probe_sim_mr1.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME || '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-sim-mr1';
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
  await page.evaluate(() => { try { localStorage.setItem('swarf-run-ghost', '1'); } catch (e) {} window.kiri.api.devices.select('Langmuir.MR-1'); });
  await wait(800);
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100"><rect width="200" height="100" fill="#000"/></svg>', 'board', { depth: 6, resolution: 2, segmin: 48, soup: true, dpi: 0 }); a.platform.deselect(); });
  await wait(600);
  await page.evaluate(() => { const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(400);
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); setTimeout(res, 60000); }));
  // simulate: the bit and the MR-1's axes, sampled as it plays
  await page.evaluate(() => { window.__trk = []; window.kiri.api.event.on('swarf.tool.move', ({ pos }) => { const st = window.__swarfSimMachine.state(); window.__trk.push({ p: [pos.x, pos.y, pos.z], m: st.mr1, wx: st.worldX }); }); });
  await page.evaluate(() => { const b = [...document.querySelectorAll('.swarf-step, #act-animate, button')].find(e => /^\s*simulate\s*$/i.test(e.textContent)); b && b.click(); });
  await page.waitForFunction(() => window.__swarfSimMachine.state().active && window.__trk.length > 30, { timeout: 60000 }).catch(() => {});
  await wait(1500);
  const s = await page.evaluate(() => ({ st: window.__swarfSimMachine.state(), samples: window.__trk.slice(-200) }));
  const spread = s.samples.length ? Math.max(...s.samples.map(q => q.p[0])) - Math.min(...s.samples.map(q => q.p[0])) : 0;
  // each sample: the axes stand where the bit is, and the world never moves
  const worst = s.samples.reduce((m, q) => q.m ? Math.max(m, Math.abs(q.m.x - q.p[0]), Math.abs(q.m.y - q.p[1]), Math.abs(q.m.z - q.p[2])) : Infinity, 0);
  const still = s.samples.every(q => q.wx === 0);
  check(s.st.active && s.st.kind === 'gantry' && s.st.mr1 && s.st.mr1.shown, `simulate shows the MR-1 (${JSON.stringify({ kind: s.st.kind, mr1: s.st.mr1 })})`);
  check(spread > 20 && worst < 1e-6 && still, `the axes follow the bit over a still table: bit travelled ${spread.toFixed(1)} mm in X, axes within ${worst.toExponential(1)} mm, world still ${still} (${s.samples.length} steps)`);
  // turning the machine off and on steps back to the whole machine
  await page.click('#swarf-sim-machine'); await wait(400); await page.click('#swarf-sim-machine'); await wait(1500);
  await page.screenshot({ path: `${OUT}-machine.png` });
  await page.click('#swarf-sim-machine');
  await wait(600);
  const off = await page.evaluate(() => window.__swarfSimMachine.state());
  check(!off.on && off.mr1 && !off.mr1.shown, `machine off: the MR-1 hides`);
  await page.click('#swarf-sim-machine');
  await page.evaluate(() => window.kiri.api.view.set_arrange());
  await wait(600);
  const back = await page.evaluate(() => window.__swarfSimMachine.state());
  check(!back.active && back.mr1 && !back.mr1.shown, `leaving simulate: the MR-1 hides`);
  // the ShopBot again: its own model, its bed sliding
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `sim mr1: ${bad.length} failed, ${errors.length} page errors` : 'sim mr1: ok');
process.exit(bad.length || errors.length ? 1 : 0);
