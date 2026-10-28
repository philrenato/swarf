// DRAW's drawing tools, with the mouse: a rectangle dragged corner to corner
// (then typed 120 mm wide), an ellipse with shift (a 60 mm circle, exact arcs),
// and a pen outline with a smooth point (drag at the click). Turning one handle
// of the smooth point turns the other with it, same length. "done" makes three
// parts where they were drawn; toolpaths follow.
//   node tools/probe_draw_tools.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-draw-tools';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const px = (page, x, y) => page.evaluate((x, y) => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); return [r.left + S.ox + x * S.k, r.top + S.oy - y * S.k]; }, x, y);
async function drag(page, a, b, shift) {
  const [x0, y0] = await px(page, ...a), [x1, y1] = await px(page, ...b);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(x0 + (x1 - x0) * i / 10, y0 + (y1 - y0) * i / 10); await wait(15); }
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
  await wait(80);
}
const sel = page => page.evaluate(() => { const S = window.__swarfDraw.state(), p = S.parts[S.sel]; if (!p) return null; const P = p.curves[0].crv.ctrlPts; const C = p.curves.flatMap(c => window.SwarfVector.cubics(c.crv)); const b = [Infinity, Infinity, -Infinity, -Infinity]; for (const q of C) for (let k = 0; k <= 64; k++) { const t = k / 64, m = 1 - t; const x = m * m * m * q[0][0] + 3 * m * m * t * q[1][0] + 3 * m * t * t * q[2][0] + t * t * t * q[3][0], y = m * m * m * q[0][1] + 3 * m * m * t * q[1][1] + 3 * m * t * t * q[2][1] + t * t * t * q[3][1]; b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); } return { name: p.name, deg: p.curves[0].crv.degree, chain: window.__swarfDraw.isChain(p.curves[0].crv), n: P.length, P: P.map(q => [q[0], q[1]]), box: b.map(v => +v.toFixed(2)) }; });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfDraw && window.SwarfVector?.bezierChainCrv && document.getElementById('swarf-step-draw')), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  await page.evaluate(() => { for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w); });
  await wait(300);
  await page.click('#swarf-step-draw');
  await page.waitForFunction(() => window.__swarfDraw.state(), { timeout: 5000 });
  // zoom so 1 mm is about 2 px around the middle of the bed
  await page.evaluate(() => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); S.k = 2.5; S.ox = r.width / 2 - 100; S.oy = r.height / 2 + 40; });

  // rectangle
  await page.keyboard.press('r');
  await drag(page, [-120, -60], [-20, -10]);
  let s = await sel(page);
  check(s && /rectangle/.test(s.name) && s.deg === 1 && s.box.join() === '-120,-60,-20,-10', `rectangle dragged: ${JSON.stringify(s && s.box)}`);
  await page.evaluate(() => { const i = document.getElementById('sd-w'); i.value = '120'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  s = await sel(page);
  check(s.box.join() === '-130,-60,-10,-10', `typed width 120 stretches it about its centre: ${s.box}`);

  // ellipse with shift = circle
  await page.keyboard.press('e');
  await drag(page, [20, -60], [80, -30], true);
  s = await sel(page);
  check(s && /ellipse/.test(s.name) && s.chain && s.deg === 2 && Math.abs(s.box[2] - s.box[0] - 60) < 0.01 && Math.abs(s.box[3] - s.box[1] - 60) < 0.01, `shift-drag ellipse is a 60 mm circle: ${s && s.box}`);

  // pen: corner, smooth point (drag), corner, close
  await page.keyboard.press('p');
  const clickAt = async (x, y) => { const [a, b] = await px(page, x, y); await page.mouse.click(a, b); await wait(60); };
  await clickAt(-100, 20);
  await drag(page, [-60, 70], [-30, 70]);
  await clickAt(-20, 20);
  await clickAt(-100, 20);
  s = await sel(page);
  // anchors 0,3,6,(9 = 0); the smooth anchor at index 3, its handles 2 and 4 mirrored about it
  const mir = s && s.n === 10 && Math.abs(s.P[2][0] - (2 * s.P[3][0] - s.P[4][0])) < 1e-9 && Math.abs(s.P[2][1] - (2 * s.P[3][1] - s.P[4][1])) < 1e-9;
  check(s && /drawing/.test(s.name) && s.chain && s.deg === 3 && mir && s.P[4][0] === -30 && s.P[4][1] === 70, `pen with a smooth point: ${JSON.stringify(s && { n: s.n, a: s.P[3], h: s.P[4], o: s.P[2] })}`);
  await page.screenshot({ path: `${OUT}-pen.png` });
  const ground = await page.evaluate(() => [...document.querySelectorAll('#sd-svg .sd-lab')].map(t => t.textContent));
  check(ground.some(t => /^bed \d+ × \d+ mm$/.test(t)) && ground.includes('0, 0') && ground.some(t => / mm$| m$/.test(t) && !/bed/.test(t)), `the board shows its ground: ${JSON.stringify(ground)}`);

  // turn the out-handle down 20 mm: the in-handle turns the other way, keeping its length
  const before = s.P;
  const el = await page.evaluate(() => { const r = document.querySelector('#sd-svg [data-pt="0:4"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.move(el[0], el[1]); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(el[0], el[1] + i * 5); await wait(15); }
  await page.mouse.up();
  s = await sel(page);
  const A = s.P[3], H = s.P[4], O = s.P[2];
  const len0 = Math.hypot(before[2][0] - before[3][0], before[2][1] - before[3][1]), len1 = Math.hypot(O[0] - A[0], O[1] - A[1]);
  const cross = (H[0] - A[0]) * (A[1] - O[1]) - (H[1] - A[1]) * (A[0] - O[0]);
  check(H[1] < before[4][1] - 5 && Math.abs(len1 - len0) < 1e-6 && Math.abs(cross) < 1e-6 && A[0] === before[3][0], `the other handle turned with it, same length (${len0.toFixed(2)} → ${len1.toFixed(2)}, cross ${cross.toFixed(6)})`);

  await page.click('#sd-done');
  await wait(1500);
  const ws = await page.evaluate(() => window.kiri.api.widgets.all().map(w => { const g = w.mesh.geometry; g.computeBoundingBox(); const b = g.boundingBox, p = w.track.pos; return { name: w.meta.file, t: +(b.max.z - b.min.z).toFixed(2), x0: +(b.min.x + p.x).toFixed(1), x1: +(b.max.x + p.x).toFixed(1), y0: +(b.min.y + p.y).toFixed(1), y1: +(b.max.y + p.y).toFixed(1) }; }));
  const rect = ws.find(w => /rectangle/.test(w.name));
  check(ws.length === 3 && rect && rect.x0 === -130 && rect.x1 === -10 && rect.y0 === -60 && rect.y1 === -10, `done: three parts, the rectangle where it was drawn ${JSON.stringify(ws)}`);
  await page.evaluate(() => { const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(400);
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  const pv = await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', () => res('preview.end')); window.kiri.api.event.on('preview.error', e => res('preview.error ' + e)); setTimeout(() => res('timeout'), 90000); }));
  check(pv === 'preview.end', `toolpaths: ${pv}`);
  await page.screenshot({ path: `${OUT}-paths.png` });
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `draw tools: ${bad.length} failed, ${errors.length} page errors` : 'draw tools: ok');
process.exit(bad.length || errors.length ? 1 : 0);
