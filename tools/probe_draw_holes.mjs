// DRAW holes, add, cut and regions, with the mouse. A circle drawn wholly inside a rectangle
// is a hole in it (the made part's top face is the rectangle less the circle, and DRAW shows
// the hole again when it opens); "a part of its own" makes it a separate part instead; "cut
// from the part" bites a circle out of the rectangle's edge; "add to the part" joins a tab on.
// Two overlapping rectangles in the regions tool make three regions; emptying the middle one
// leaves two parts. Toolpaths follow.
//   node tools/probe_draw_holes.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME || (process.env.HOME + '/.local/bin/chrome-for-testing');
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-draw-holes';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const px = (page, x, y) => page.evaluate((x, y) => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); return [r.left + S.ox + x * S.k, r.top + S.oy - y * S.k]; }, x, y);
async function drag(page, a, b) {
  const [x0, y0] = await px(page, ...a), [x1, y1] = await px(page, ...b);
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(x0 + (x1 - x0) * i / 10, y0 + (y1 - y0) * i / 10); await wait(15); }
  await page.mouse.up();
  await wait(80);
}
const said = page => page.evaluate(() => document.getElementById('sd-say').textContent);
const parts = page => page.evaluate(() => window.__swarfDraw.state().parts.filter(p => !p.gone).map(p => ({ name: p.name, n: p.curves.length, line: !!p.line })));
const setMode = (page, v) => page.evaluate(v => { const s = document.getElementById('sd-mode'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, v);
// each part's top face area (mm²) and how many separate edges its top face has
const tops = page => page.evaluate(() => window.kiri.api.widgets.all().map(w => {
  const g = w.mesh.geometry, P = g.attributes.position.array, I = g.index ? g.index.array : null;
  let zmax = -Infinity; for (let i = 2; i < P.length; i += 3) zmax = Math.max(zmax, P[i]);
  const nt = I ? I.length / 3 : P.length / 9, v = k => (I ? I[k] : k);
  let area = 0; const edges = new Map();
  for (let t = 0; t < nt; t++) {
    const a = v(3 * t), b = v(3 * t + 1), c = v(3 * t + 2);
    if (![a, b, c].every(i => P[3 * i + 2] > zmax - 1e-4)) continue;
    const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1];
    area += Math.abs(ux * vy - uy * vx) / 2;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) { const k = [p, q].map(i => `${P[3 * i].toFixed(3)},${P[3 * i + 1].toFixed(3)}`).sort().join('|'); edges.set(k, (edges.get(k) || 0) + 1); }
  }
  // the top face's boundary edges, joined into loops
  const bnd = [...edges].filter(([, n]) => n === 1).map(([k]) => k.split('|'));
  const adj = new Map(); for (const [p, q] of bnd) { (adj.get(p) || adj.set(p, []).get(p)).push(q); (adj.get(q) || adj.set(q, []).get(q)).push(p); }
  const seen = new Set(); let loops = 0;
  for (const s of adj.keys()) { if (seen.has(s)) continue; loops++; const st = [s]; while (st.length) { const x = st.pop(); if (seen.has(x)) continue; seen.add(x); st.push(...adj.get(x)); } }
  return { name: w.meta.file, area: +area.toFixed(1), loops };
}));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfDraw && window.SwarfVector?.bezierChainCrv && window.SwarfDrawGeom && document.getElementById('swarf-step-draw')), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  await page.evaluate(() => { for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w); try { localStorage.removeItem('swarf-draw-inside'); } catch (e) { } });
  await wait(300);
  const openDraw = async () => {
    await page.click('#swarf-step-draw');
    await page.waitForFunction(() => window.__swarfDraw.state(), { timeout: 5000 });
    await page.evaluate(() => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); S.k = 2.5; S.ox = r.width / 2 - 100; S.oy = r.height / 2 + 40; window.__swarfDraw.close && 0; });
    await page.evaluate(() => document.getElementById('sd-svg').dispatchEvent(new Event('pointermove')));
  };
  await openDraw();

  // a rectangle, then a circle wholly inside it: a hole
  await page.keyboard.press('r');
  await drag(page, [0, 0], [100, 60]);
  await page.keyboard.press('e');
  const mode0 = await page.evaluate(() => document.getElementById('sd-mode')?.value);
  check(mode0 === 'auto', `the card's "inside or over a part" starts at "a hole if inside" (${mode0})`);
  await drag(page, [20, 20], [40, 40]);
  let P = await parts(page);
  check(P.length === 1 && P[0].n === 2 && /hole/.test(await said(page)), `a circle drawn inside the rectangle is a hole in it: ${JSON.stringify(P)}, "${await said(page)}"`);
  // "a part of its own": the next circle inside is a separate part; undo takes it back
  await page.keyboard.press('e');
  await setMode(page, 'part');
  await drag(page, [60, 20], [80, 40]);
  P = await parts(page);
  check(P.length === 2 && P[0].n === 2 && P[1].n === 1, `"a part of its own": a separate part (${JSON.stringify(P)})`);
  await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta');
  P = await parts(page);
  check(P.length === 1, `undo takes it back (${P.length} part)`);
  // "cut from the part": a circle over the right edge bites into it
  await page.keyboard.press('e');
  await setMode(page, 'cut');
  await drag(page, [90, 20], [110, 40]);
  P = await parts(page);
  const cutBox = await page.evaluate(() => { const S = window.__swarfDraw.state(), p = S.parts[S.sel]; return { n: p.curves.length, chain: p.curves.every(c => window.__swarfDraw.isChain(c.crv)) }; });
  check(P.length === 1 && P[0].n === 2 && cutBox.chain, `"cut from the part": still one part with its hole, its outline bitten (${JSON.stringify(P)}), smooth pen curves`);
  // "add to the part": a tab joined on the left
  await page.keyboard.press('r');
  await setMode(page, 'add');
  await drag(page, [-20, 20], [10, 40]);
  P = await parts(page);
  check(P.length === 1 && P[0].n === 2, `"add to the part": the tab is part of it (${JSON.stringify(P)})`);
  await page.screenshot({ path: `${OUT}-board.png` });
  await page.click('#sd-done');
  await wait(1500);
  let T = await tops(page);
  // 100 x 60, less a 20 mm circle (hole), less half a 20 mm circle (bite), plus the 20 x 20 tab
  const want = 6000 - Math.PI * 100 - Math.PI * 100 / 2 + 20 * 20;
  check(T.length === 1 && Math.abs(T[0].area - want) < want * 0.01 && T[0].loops === 2, `done: one part, top face ${T[0] && T[0].area} mm² (want ${want.toFixed(1)}), ${T[0] && T[0].loops} edges round its top (outline and hole)`);
  // DRAW again: the hole is still in the drawing
  await openDraw();
  P = await parts(page);
  check(P.length === 1 && P[0].n === 2, `opened again: the part still has its hole (${JSON.stringify(P)})`);

  // regions: two overlapping rectangles (each its own part), the middle emptied
  await page.keyboard.press('r');
  await setMode(page, 'part');
  await drag(page, [-160, -80], [-100, -40]);
  await page.keyboard.press('r');
  await drag(page, [-120, -80], [-60, -40]);
  P = await parts(page);
  check(P.length === 3, `two overlapping rectangles as parts of their own: ${P.length} parts`);
  await page.keyboard.press('g');
  const R = await page.evaluate(() => { const S = window.__swarfDraw.state(); return S.reg ? { n: S.reg.arr.faces.length, filled: S.reg.filled.size, at: S.reg.arr.faces.map(f => f.at), shown: document.querySelectorAll('#sd-svg .sd-reg').length } : null; });
  check(R && R.n === 3 && R.filled === 3 && R.shown === 3, `regions: 3 regions, all filled, all shaded (${JSON.stringify(R && { n: R.n, filled: R.filled, shown: R.shown })})`);
  await page.screenshot({ path: `${OUT}-regions.png` });
  const mid = R.at.findIndex(q => q[0] > -120 && q[0] < -100);
  const [mx, my] = await px(page, -110, -60);
  await page.mouse.click(mx, my);
  await wait(100);
  const after = await page.evaluate(() => [...window.__swarfDraw.state().reg.filled]);
  check(!after.includes(mid) && after.length === 2, `a click empties the middle region (${after})`);
  await page.screenshot({ path: `${OUT}-regions-emptied.png` });
  await page.keyboard.press('v');                   // leaving the tool applies it
  P = await parts(page);
  check(P.length === 3 && P.every(p => p.n === 1 || p.n === 2), `leaving regions: the two ends are two parts, the first part unchanged (${JSON.stringify(P)})`);
  await page.click('#sd-done');
  await wait(1500);
  T = await tops(page);
  const ends = T.filter(t => Math.abs(t.area - 1600) < 2);
  check(T.length === 3 && ends.length === 2, `done: the ends are 40 x 40 parts (${JSON.stringify(T)})`);
  await page.evaluate(() => { const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(400);
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  const pv = await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', () => res('preview.end')); window.kiri.api.event.on('preview.error', e => res('preview.error ' + e)); setTimeout(() => res('timeout'), 90000); }));
  check(pv === 'preview.end', `toolpaths: ${pv}`);
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `draw holes: ${bad.length} failed, ${errors.length} page errors` : 'draw holes: ok');
process.exit(bad.length || errors.length ? 1 : 0);
