// Fixes from the Fable design review, 10-28.
//  #5  size card: width 150 -> 200 with Tab keeps proportions, and leaving the
//      depth box does not squash it back (it kept a stale 100)
//  #6  duplicate: its own name, and parts packed with room for a bit between
//  #4  the picked part glows; an unpicked one does not
//  #12 DRAW card: "delete this part"
//  #2  CONTROL on another machine offers to switch to the ShopBot, then opens
//  #19 the simulator's continuous jog follows the speed row (it ran 6000 mm/min)
//   node tools/probe_review.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const RECT = '<svg xmlns="http://www.w3.org/2000/svg" width="150mm" height="100mm" viewBox="0 0 150 100"><rect width="150" height="100" fill="#000"/></svg>';
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfSize && window.__swarfDraw && window.__swarfRun), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  const fresh = () => page.evaluate(svg => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); const [w] = a.platform.load_svg(svg, 'rectangle-150x100mm-6thick', { depth: 6, resolution: 2, segmin: 48, soup: true, dpi: 0 }); a.platform.select(w); }, RECT);
  await fresh();
  await wait(700);
  // #5
  const card = () => page.evaluate(() => [...document.querySelectorAll('#swarf-size .ax input')].map(i => i.value));
  const w0 = await page.$('#swarf-size .ax input');
  await w0.click({ clickCount: 3 }); await page.keyboard.type('200'); await page.keyboard.press('Tab');
  await wait(700);
  const c1 = await card();
  await page.keyboard.press('Tab');                     // leave the depth box without typing
  await wait(700);
  const c2 = await card();
  const real = await page.evaluate(() => { const w = window.kiri.api.widgets.all()[0], g = w.mesh.geometry; g.computeBoundingBox(); const b = g.boundingBox; return [+(b.max.x - b.min.x).toFixed(1), +(b.max.y - b.min.y).toFixed(1)]; });
  check(c1.join() === '200,133.33,6' && c2.join() === '200,133.33,6' && real.join() === '200,133.3', `keep proportions with Tab: ${c1} then ${c2}, the part ${real.join(' x ')}`);
  const labels = await page.evaluate(() => [...document.querySelectorAll('#swarf-size .ax small')].map(s => s.textContent));
  check(labels.join() === 'width,depth,thickness', `the size card says ${labels.join(' × ')}`);
  // #4
  const glow = () => page.evaluate(() => window.kiri.api.widgets.all().map(w => { const m = Array.isArray(w.mesh.material) ? w.mesh.material[0] : w.mesh.material; return m.emissive ? m.emissive.getHexString() : null; }));
  await wait(300);
  const g1 = await glow();
  await page.evaluate(() => window.kiri.api.platform.deselect());
  await wait(400);
  const g2 = await glow();
  check(g1[0] === '6a5638' && g2[0] !== '6a5638', `the picked part glows (${g1[0]}), unpicked it does not (${g2[0]})`);
  // #6
  await page.evaluate(() => window.kiri.api.platform.select(window.kiri.api.widgets.all()[0]));
  await wait(300);
  await page.evaluate(() => [...document.querySelectorAll('#swarf-size .act')].find(b => b.textContent === 'duplicate').click());
  await wait(1200);
  const dup = await page.evaluate(() => window.kiri.api.widgets.all().map(w => { const g = w.mesh.geometry; g.computeBoundingBox(); const b = g.boundingBox, p = w.track.pos; return { name: w.meta.file, x0: b.min.x + p.x, x1: b.max.x + p.x, y0: b.min.y + p.y, y1: b.max.y + p.y }; }));
  const [A, B] = dup, gap = Math.max(B.x0 - A.x1, A.x0 - B.x1, B.y0 - A.y1, A.y0 - B.y1);
  check(dup.length === 2 && A.name !== B.name && /-2$/.test(B.name) && gap >= 11.9, `duplicate: "${A.name}" and "${B.name}", ${gap.toFixed(1)} mm apart`);
  // #12
  await page.evaluate(() => { const a = window.kiri.api; a.platform.deselect(); a.platform.select(a.widgets.all()[1]); });
  await page.click('#swarf-step-draw');
  await page.waitForFunction(() => document.getElementById('sd-del'), { timeout: 5000 });
  await page.click('#sd-del');
  await page.click('#sd-done');
  await wait(1200);
  const n = await page.evaluate(() => window.kiri.api.widgets.all().length);
  check(n === 1, `DRAW "delete this part" removes it on done (${n} left)`);
  // #2
  await page.evaluate(() => window.kiri.api.devices.select('Langmuir.MR-1'));
  await wait(1000);
  // 10-28: control is the ShopBot's alone; on the MR-1 the step is hidden, back on the ShopBot it opens
  const hiddenOnMr1 = await page.evaluate(() => !document.getElementById('swarf-step-run').offsetParent);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(1000);
  await page.click('#swarf-step-run');
  const opened = await page.waitForFunction(() => window.__swarfRun.state.open && /shopbot/i.test(window.kiri.api.conf.get().device.deviceName), { timeout: 15000 }).then(() => true, () => false);
  check(hiddenOnMr1 && opened, `CONTROL hidden on the MR-1 (${hiddenOnMr1}), opens on the ShopBot (${opened})`);
  // #19: hold continuous +X at 250 mm/min for a second, simulator at 1×
  await page.evaluate(() => { const M = window.__swarfRun.state.machine; M.timeScale = 1; });
  const pick = t => page.evaluate(t => [...document.querySelectorAll('#swarf-run .sr-modes button')].find(b => b.textContent === t).click(), t);
  await pick('250'); await pick('continuous');
  const x0 = await page.evaluate(() => window.__swarfRun.state.machine.state.pos.x);
  const pad = await page.evaluate(() => { const b = document.querySelector('#swarf-run .sr-pad button[data-axis="+X"]'); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.move(pad[0], pad[1]); await page.mouse.down(); await wait(1000); await page.mouse.up();
  await wait(300);
  const moved = await page.evaluate(x0 => window.__swarfRun.state.machine.state.pos.x - x0, x0);
  check(moved > 2 && moved < 8, `continuous jog at 250 mm/min for 1 s moved ${moved.toFixed(1)} mm (about 4.2)`);
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `review: ${bad.length} failed, ${errors.length} page errors` : 'review: ok');
process.exit(bad.length || errors.length ? 1 : 0);
