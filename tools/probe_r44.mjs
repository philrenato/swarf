// r44, the second pass on the 10-28 review:
//  - a fresh visit has an empty bed with the start card (no demo cube) and hard wood;
//    the card's "make a shape" opens SHAPE and the card goes when a part lands
//  - the ShopBot's bed is 2438.4 x 1219.2
//  - one camera rule: a part onto an empty bed is framed; a duplicate beside it that
//    stays in view, and a delete, leave the camera where it was; an empty bed homes
//  - the size card names a shaped edge ("chamfer 3 mm edge")
//  - DRAW: a pen outline that crosses itself is marked, and done says so and stays open;
//    a press 6 px off a point still takes that point; a press inside a word's "o" picks the word
//   node tools/probe_r44.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const px = (page, x, y) => page.evaluate((x, y) => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); return [r.left + S.ox + x * S.k, r.top + S.oy - y * S.k]; }, x, y);
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfStart && window.__swarfDraw && window.kiri.api.frame), { timeout: 90000, polling: 200 });
  await wait(2500);
  const st = await page.evaluate(() => ({ n: window.kiri.api.widgets.all().length, card: document.getElementById('swarf-start').classList.contains('on'), mat: localStorage.getItem('swarf.material.current') }));
  check(st.n === 0 && st.card, `fresh visit: an empty bed with the start card (${st.n} parts, card ${st.card})`);
  check(st.mat === 'hardwood', `the default material is hard wood (${st.mat})`);

  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  const bed = await page.evaluate(() => { const d = window.kiri.api.conf.get().device; return [d.bedWidth, d.bedDepth]; });
  check(bed.join() === '2438.4,1219.2', `the ShopBot's bed is 4 x 8 ft: ${bed.join(' x ')}`);

  // make a chamfered rectangle from the card
  await page.evaluate(() => [...document.querySelectorAll('#swarf-start button')].find(b => b.textContent === 'make a shape').click());
  await page.waitForFunction(() => document.getElementById('shape-edge') && document.getElementById('dialog').open, { timeout: 5000 });
  const setv = (id, v) => page.evaluate((id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, id, v);
  await setv('shape-kind', 'rect'); await setv('shape-w', '100'); await setv('shape-h', '60'); await setv('shape-t', '12'); await setv('shape-edge', 'chamfer'); await setv('shape-es', '3'); await wait(150);
  await page.evaluate(() => [...document.querySelectorAll('#dialog button')].find(b => /^make$/i.test(b.textContent.trim())).click());
  await wait(1500);
  const cam = () => page.evaluate(() => window.moto.space.internals().camera.position.toArray().map(v => +v.toFixed(1)).join());
  // the part fills a fair share of the view: its screen box is 25-75 % of the width
  const share = await page.evaluate(() => {
    const T = window.THREE, c = window.moto.space.internals().camera, b = new T.Box3();
    for (const w of window.kiri.api.widgets.all()) b.expandByObject(w.mesh);
    let x0 = 1, x1 = -1;
    for (let i = 0; i < 8; i++) { const v = new T.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(c); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); }
    return +((x1 - x0) / 2).toFixed(2);
  });
  check(share > 0.25 && share < 0.75, `a part on an empty bed is framed: it spans ${share * 100}% of the view's width`);
  const card = await page.evaluate(() => ({ start: document.getElementById('swarf-start').classList.contains('on'), edge: document.querySelector('#swarf-size .edge').textContent }));
  check(!card.start, 'the start card goes when a part lands');
  check(card.edge === 'chamfer 3 mm edge', `the size card names the edge: "${card.edge}"`);
  const c0 = await cam();
  await page.evaluate(() => [...document.querySelectorAll('#swarf-size .act')].find(b => b.textContent === 'duplicate').click());
  await wait(1200);
  // the copy lands 12 mm to the right (r45); the camera moves only if it would be off screen, and then all is in view
  const allIn = () => page.evaluate(() => {
    const T = window.THREE, c = window.moto.space.internals().camera, b = new T.Box3();
    for (const w of window.kiri.api.widgets.all()) b.expandByObject(w.mesh);
    for (let i = 0; i < 8; i++) { const v = new T.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(c); if (Math.abs(v.x) > 0.95 || Math.abs(v.y) > 0.95) return false; }
    return true;
  });
  const c1 = await cam();
  check(await allIn(), `after a duplicate both parts are in view (${c0} → ${c1})`);
  await page.evaluate(() => [...document.querySelectorAll('#swarf-size .act')].find(b => b.textContent === 'delete').click());
  await wait(1200);
  const c2 = await cam();
  check(c2 === c1, `a delete leaves the camera (${c1} → ${c2})`);
  await page.evaluate(() => { for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w); });
  await wait(1200);
  check(await page.evaluate(() => document.getElementById('swarf-start').classList.contains('on')), 'an emptied bed shows the start card again');

  // DRAW
  await page.evaluate(() => [...document.querySelectorAll('#swarf-start button')].find(b => b.textContent === 'draw one').click());
  await page.waitForFunction(() => window.__swarfDraw.state(), { timeout: 5000 });
  await page.evaluate(() => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); S.k = 2.5; S.ox = r.width / 2 - 100; S.oy = r.height / 2 + 40; });
  await page.keyboard.press('p');
  const clickAt = async (x, y) => { const [a, b] = await px(page, x, y); await page.mouse.click(a, b); await wait(60); };
  // a bow tie: its sides cross at (0, 25)
  for (const q of [[-40, 0], [40, 50], [40, 0], [-40, 50]]) await clickAt(...q);
  await clickAt(-40, 0);
  await wait(200);
  let d = await page.evaluate(() => { const S = window.__swarfDraw.state(), p = S.parts[S.sel]; return { cross: p && p.cross, say: document.getElementById('sd-say').textContent, mark: !!document.querySelector('#swarf-draw .sd-cross') }; });
  check(d.cross && Math.abs(d.cross[0]) < 0.01 && Math.abs(d.cross[1] - 25) < 0.01 && d.mark && /crosses itself near 0, 25 mm/.test(d.say), `a bow tie is marked where it crosses: ${JSON.stringify(d.cross)} "${d.say}"`);
  await page.click('#sd-done'); await wait(400);
  d = await page.evaluate(() => ({ open: !!window.__swarfDraw.state(), say: document.getElementById('sd-say') && document.getElementById('sd-say').textContent, n: window.kiri.api.widgets.all().length }));
  check(d.open && d.n === 0 && /Then press done/.test(d.say), `done stays open and says why: "${d.say}"`);
  // a press 6 px off the top-right point takes it
  const [tx, ty] = await px(page, 40, 50);
  await page.mouse.move(tx + 6, ty - 3); await page.mouse.down();
  const ptAfterDown = await page.evaluate(() => [...window.__swarfDraw.state().pts]);
  await page.mouse.up(); await wait(100);
  check(ptAfterDown.length === 1 && ptAfterDown[0] === '0:1', `a press 6 px off a point takes that point: ${JSON.stringify(ptAfterDown)}`);
  // move the crossing points into a plain rectangle and the mark goes
  await page.evaluate(() => { const S = window.__swarfDraw.state(), P = S.parts[S.sel].curves[0].crv.ctrlPts; P[1][0] = 40; P[1][1] = 0; P[2][0] = 40; P[2][1] = 50; });
  const [qx, qy] = await px(page, 40, 50);
  await page.mouse.move(qx, qy); await page.mouse.down(); await page.mouse.move(qx + 4, qy); await page.mouse.move(qx, qy); await page.mouse.up(); await wait(100);
  d = await page.evaluate(() => { const S = window.__swarfDraw.state(); return { cross: S.parts[S.sel].cross, mark: !!document.querySelector('#swarf-draw .sd-cross') }; });
  check(!d.cross && !d.mark, `straightened, the mark goes (${JSON.stringify(d.cross)})`);
  // text: a press in the word's box, on no ink, picks the word
  await page.keyboard.press('t'); await wait(300);
  await clickAt(-60, -80); await wait(600);
  await page.keyboard.press('Escape'); await wait(100);
  await clickAt(150, 150); await wait(100);    // nothing picked
  const word = await page.evaluate(() => { const S = window.__swarfDraw.state(), i = S.parts.findIndex(p => p.text); const p = S.parts[i]; let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const c of p.curves) for (const q of c.crv.ctrlPts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); } return { i, sel: S.sel, gap: [(x0 + x1) / 2, (y0 + y1) / 2] }; });
  // the middle of the word's box: between or inside letters, often on no ink
  await clickAt(...word.gap); await wait(100);
  const picked = await page.evaluate(() => window.__swarfDraw.state().sel);
  check(picked === word.i, `a press in the word's box picks the word (${picked}, want ${word.i})`);
  await page.click('#sd-cancel'); await wait(300);

  check(errors.length === 0, `no page errors ${errors.slice(0, 3).join(' | ')}`);
} catch (e) {
  check(false, `threw: ${e.message}`);
} finally {
  await browser.close();
}
console.log(bad.length ? `r44: ${bad.length} FAILED` : 'r44: ok');
process.exit(bad.length ? 1 : 0);
