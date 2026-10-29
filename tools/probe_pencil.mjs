// DRAW's pencil, with the mouse. A freehand wave over nothing becomes an open line of a few
// smooth pen points (Bézier handles in line, so they edit like the pen's), held to 1.5 px of
// the stroke; the card's points field re-fits it to 8, then to 4. A freehand loop that ends
// near its start closes into an outline, its own part; a smaller loop drawn inside it is a
// hole in it. A pencil point drags like a pen point. "done" makes the part.
//   node tools/probe_pencil.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME || '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-pencil';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const px = (page, x, y) => page.evaluate((x, y) => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); return [r.left + S.ox + x * S.k, r.top + S.oy - y * S.k]; }, x, y);
// a stroke through bed points (mm), at whole pixels as a mouse gives them
async function stroke(page, pts) {
  const S = [];
  for (const p of pts) S.push((await px(page, ...p)).map(Math.round));
  await page.mouse.move(...S[0]); await page.mouse.down();
  for (const q of S.slice(1)) await page.mouse.move(...q);
  await page.mouse.up();
  await wait(120);
}
const picked = page => page.evaluate(() => {
  const S = window.__swarfDraw.state(), p = S.parts[S.sel];
  if (!p) return null;
  const c = p.curves[0].crv, P = c.ctrlPts, closed = Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 1e-6;
  const anchors = c.degree === 3 ? (P.length - 1) / 3 + (closed ? 0 : 1) : null;
  // each inner anchor smooth: its two handles in line with it
  let smooth = true;
  for (let i = 3; i < P.length - 1; i += 3) { const a = P[i - 1], m = P[i], b = P[i + 1]; const u = [m[0] - a[0], m[1] - a[1]], v = [b[0] - m[0], b[1] - m[1]]; if (Math.abs(u[0] * v[1] - u[1] * v[0]) > 1e-6 * (Math.hypot(...u) * Math.hypot(...v)) + 1e-9) smooth = false; }
  return { name: p.name, line: !!p.line, closed, deg: c.degree, chain: window.__swarfDraw.isChain(c), anchors, n: p.pencil && p.pencil.n, smooth, curves: p.curves.length, field: document.getElementById('sd-pts')?.value };
});
// the farthest any stroke point lies from the picked curve (mm)
const strays = page => page.evaluate(() => {
  const S = window.__swarfDraw.state(), p = S.parts[S.sel], st = p.pencil.stroke, L = [];
  for (const q of window.SwarfVector.cubics(p.curves[0].crv)) for (let k = 0; k <= 64; k++) { const t = k / 64, m = 1 - t; L.push([0, 1].map(j => m * m * m * q[0][j] + 3 * m * m * t * q[1][j] + 3 * m * t * t * q[2][j] + t * t * t * q[3][j])); }
  let worst = 0;
  for (const s of st) { let b = Infinity; for (const q of L) b = Math.min(b, Math.hypot(q[0] - s[0], q[1] - s[1])); worst = Math.max(worst, b); }
  return { worst, k: S.k };
});
const setField = (page, id, v) => page.evaluate((id, v) => { const i = document.getElementById(id); i.value = v; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }, id, v);
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfDraw && window.SwarfDrawGeom && document.getElementById('swarf-step-draw')), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  await page.evaluate(() => { for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w); try { localStorage.removeItem('swarf-draw-inside'); } catch (e) { } });
  await wait(300);
  await page.click('#swarf-step-draw');
  await page.waitForFunction(() => window.__swarfDraw.state(), { timeout: 5000 });
  await page.evaluate(() => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); S.k = 2.5; S.ox = r.width / 2 - 100; S.oy = r.height / 2 + 40; });

  // an open wave over nothing
  await page.keyboard.press('n');
  const wave = []; for (let i = 0; i <= 120; i++) { const x = -150 + i; wave.push([x, 60 + 15 * Math.sin(i / 12)]); }
  await stroke(page, wave);
  let p = await picked(page);
  const st = await strays(page);
  check(p && p.line && !p.closed && p.deg === 3 && p.chain && p.anchors === p.n && p.n >= 4 && p.n <= 20 && p.smooth, `a freehand wave: an open line of ${p && p.n} smooth pen points (${JSON.stringify(p)})`);
  check(st.worst <= 1.5 / st.k + 0.05, `held to 1.5 px of the stroke: ${st.worst.toFixed(3)} mm at ${st.k} px/mm`);
  check(p.field === String(p.n), `the card's points field shows ${p.field}`);
  await setField(page, 'sd-pts', '8');
  p = await picked(page);
  check(p.anchors === 8 && p.n === 8 && p.smooth && p.line, `points 8: re-fitted to 8 smooth points (${p.anchors})`);
  await setField(page, 'sd-pts', '4');
  p = await picked(page);
  check(p.anchors === 4 && p.n === 4, `points 4: re-fitted to 4 (${p.anchors})`);
  const w4 = (await strays(page)).worst;
  await setField(page, 'sd-pts', '12');
  const w12 = (await strays(page)).worst;
  check(w12 < w4, `more points follow the hand closer (12: ${w12.toFixed(2)} mm, 4: ${w4.toFixed(2)} mm)`);
  await page.screenshot({ path: `${OUT}-wave.png` });

  // a freehand loop that ends near its start: a closed outline, a part of its own
  await page.keyboard.press('n');
  const loop = []; for (let i = 0; i <= 100; i++) { const t = 2 * Math.PI * i / 100; loop.push([40 + 40 * Math.cos(t) * (1 + 0.08 * Math.sin(3 * t)), 30 * Math.sin(t)]); }
  await stroke(page, loop);
  p = await picked(page);
  check(p && !p.line && p.closed && p.deg === 3 && p.chain && p.anchors === p.n && p.n >= 5 && p.smooth, `a freehand loop closes: an outline of ${p && p.n} smooth points (${JSON.stringify(p)})`);
  // a small loop inside it: a hole
  await page.keyboard.press('n');
  const small = []; for (let i = 0; i <= 60; i++) { const t = 2 * Math.PI * i / 60; small.push([40 + 10 * Math.cos(t), 10 * Math.sin(t)]); }
  await stroke(page, small);
  p = await picked(page);
  check(p && p.curves === 2 && /hole/.test(await page.evaluate(() => document.getElementById('sd-say').textContent)), `a small loop inside it is a hole in it (${p && p.curves} curves)`);
  // a pencil point drags like a pen point: the part keeps its shape elsewhere
  const before = await page.evaluate(() => { const S = window.__swarfDraw.state(); return S.parts[S.sel].curves[0].crv.ctrlPts.map(q => [q[0], q[1]]); });
  const [ax, ay] = await px(page, before[0][0], before[0][1]);
  await page.mouse.click(ax, ay); await wait(80);
  await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move(ax + 10, ay, { steps: 5 }); await page.mouse.move(ax + 20, ay, { steps: 5 }); await page.mouse.up();
  await wait(100);
  const moved = await page.evaluate(() => { const S = window.__swarfDraw.state(); return S.parts[S.sel].curves[0].crv.ctrlPts.map(q => [q[0], q[1]]); });
  const dx = moved.map((q, i) => +(q[0] - before[i][0]).toFixed(1));
  check(Math.abs(dx[0] - 8) < 0.2 && Math.abs(dx[1] - 8) < 0.2 && dx.slice(3, -2).every(v => v === 0), `its first point dragged 8 mm with its handles, the rest stayed (${dx.slice(0, 4)}…)`);
  await page.screenshot({ path: `${OUT}-loop.png` });
  await page.click('#sd-done');
  await wait(1500);
  const ws = await page.evaluate(() => window.kiri.api.widgets.all().map(w => ({ name: w.meta.file, engrave: (w.meta.engrave || []).length })));
  check(ws.length === 1, `done: the loop is a part (the wave over nothing is left out) ${JSON.stringify(ws)}`);
  const alert = await page.evaluate(() => [...document.querySelectorAll('#alerts, .alerts, #alert-area')].map(e => e.textContent).join(' '));
  console.log('   said:', alert.slice(0, 220));
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `pencil: ${bad.length} failed, ${errors.length} page errors` : 'pencil: ok');
process.exit(bad.length || errors.length ? 1 : 0);
