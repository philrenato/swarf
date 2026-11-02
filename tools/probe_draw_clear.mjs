// DRAW's clear and Delete take away what was drawn there, never a part made elsewhere (Phil 11-02:
// "make sure things made in draw can be deleted without necessarily deleting a part not made in draw.
// Should work like clear in tex"): a board made elsewhere with a hole drawn in it and a part drawn
// beside it; Delete on the board takes the hole and keeps the board; clear takes the drawn part and
// gives the board its own outline back; a board with nothing drawn on it is not DRAW's to delete.
//   node tools/probe_draw_clear.mjs [url]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const wait = ms => new Promise(r => setTimeout(r, ms));
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
  // a board made elsewhere (as SHAPE makes one), 100 x 60, at the bed's middle
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); try { localStorage.removeItem('swarf-draw-inside'); } catch (e) { }
    a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><rect width="100" height="60"/></svg>', 'board', { depth: 12, soup: true, dpi: 0 }); });
  await wait(1500);
  const openDraw = async () => {
    await page.click('#swarf-step-draw');
    await page.waitForFunction(() => window.__swarfDraw.state(), { timeout: 5000 });
    await page.evaluate(() => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); S.k = 2.5; S.ox = r.width / 2; S.oy = r.height / 2; window.__swarfDraw.render(); });
  };
  const done = async () => { await page.click('#sd-done'); await wait(2000); };
  const widgets = () => page.evaluate(() => window.kiri.api.widgets.all().map(w => ({ name: w.meta.file, drawn: !!w.meta.drawn, orig: Array.isArray(w.meta.orig) ? w.meta.orig.length : 0 })));
  // a hole drawn in the board, and a part of its own beside it
  await openDraw();
  await page.keyboard.press('e');
  await drag(page, [-10, -10], [10, 10]);
  await page.keyboard.press('r');
  await drag(page, [70, -20], [100, 20]);
  await done();
  let W = await widgets();
  const tb = (await tops(page)).find(t => t.name === 'board');
  check(W.length === 2 && W.find(w => w.name === 'board' && !w.drawn && w.orig === 1) && W.find(w => w.name !== 'board' && w.drawn) && tb && tb.loops === 2, `a hole in the board, a part drawn beside it: the board remembers its own outline (${JSON.stringify(W)}, top loops ${tb && tb.loops})`);
  // Delete on the board in DRAW: the hole goes, the board stays
  await openDraw();
  await page.evaluate(() => { const S = window.__swarfDraw.state(); S.sel = S.parts.findIndex(p => p.name === 'board'); window.__swarfDraw.render(); });
  await page.evaluate(() => document.getElementById('sd-svg').focus()); await page.keyboard.press('Delete'); await wait(200);
  let P = await page.evaluate(() => window.__swarfDraw.state().parts.filter(p => !p.gone).map(p => ({ name: p.name, n: p.curves.length })));
  const s1 = await said(page);
  check(P.find(p => p.name === 'board' && p.n === 1) && P.length === 2 && /the part stays/.test(s1), `Delete on the board: what was drawn on it goes, the board stays (${JSON.stringify(P)}, "${s1}")`);
  await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta'); await wait(200);
  P = await page.evaluate(() => window.__swarfDraw.state().parts.filter(p => !p.gone).map(p => ({ name: p.name, n: p.curves.length })));
  check(P.find(p => p.name === 'board' && p.n === 2), `undo brings the hole back (${JSON.stringify(P)})`);
  // clear with nothing picked: the drawn part goes, the board goes back to its own outline
  await page.evaluate(() => { const S = window.__swarfDraw.state(); S.sel = -1; window.__swarfDraw.render(); });
  const canClear = await page.evaluate(() => !document.getElementById('sd-clear').disabled);
  await page.click('#sd-clear'); await wait(200);
  const s2 = await said(page);
  await done();
  W = await widgets();
  const tb2 = (await tops(page)).find(t => t.name === 'board');
  check(canClear && W.length === 1 && W[0].name === 'board' && !W[0].drawn && tb2 && tb2.loops === 1 && Math.abs(tb2.area - 6000) < 5, `clear: the drawn part goes, the board is its own rectangle again (${JSON.stringify(W)}, ${JSON.stringify(tb2)}, "${s2}")`);
  // nothing left to clear: the button rests
  await openDraw();
  const idle = await page.evaluate(() => document.getElementById('sd-clear').disabled);
  await page.evaluate(() => document.getElementById('sd-svg').focus()); await page.evaluate(() => { const S = window.__swarfDraw.state(); S.sel = 0; window.__swarfDraw.render(); });
  await page.keyboard.press('Delete'); await wait(200);
  const s3 = await said(page);
  const still = await page.evaluate(() => window.__swarfDraw.state().parts.filter(p => !p.gone).length);
  check(idle && still === 1 && /not made in draw/.test(s3), `a board made elsewhere with nothing drawn: clear rests, Delete says to delete it in cam (${s3})`);
  await page.evaluate(() => window.__swarfDraw.close(false));
  check(!errors.length, `no page errors${errors.length ? ': ' + errors[0] : ''}`);
} finally { await browser.close(); }
console.log(bad.length ? `draw clear: ${bad.length} failed` : 'draw clear: ok');
process.exit(bad.length ? 1 : 0);
