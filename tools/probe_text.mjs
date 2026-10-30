// DRAW text: the text tool reads real glyph outlines (built-in Russo One).
// "HI" at 40 mm has capitals 40 mm tall, with its baseline where it was
// clicked; changing the words in the card to "OH" re-sets them in place (the O
// with its counter as a hole); a font picked from a file (Inter) sets them in
// that face. "done" makes the letters parts; toolpaths follow.
//   node tools/probe_text.mjs [url]
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
const CHROME = process.env.CHROME || (process.env.HOME + '/.local/bin/chrome-for-testing');
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-text';
const INTER = fileURLToPath(new URL('./fixtures-2d/Inter-Regular.ttf', import.meta.url));
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const px = (page, x, y) => page.evaluate((x, y) => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); return [r.left + S.ox + x * S.k, r.top + S.oy - y * S.k]; }, x, y);
const part = page => page.evaluate(() => {
  const S = window.__swarfDraw.state(), p = S.parts[S.sel];
  if (!p) return null;
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const c of p.curves) for (const q of window.SwarfVector.cubics(c.crv)) for (let k = 0; k <= 32; k++) { const t = k / 32, m = 1 - t; for (const j of [0, 1]) { const v = m * m * m * q[0][j] + 3 * m * m * t * q[1][j] + 3 * m * t * t * q[2][j] + t * t * t * q[3][j]; b[j] = Math.min(b[j], v); b[j + 2] = Math.max(b[j + 2], v); } }
  return { name: p.name, n: p.curves.length, text: p.text && p.text.str, box: b.map(v => +v.toFixed(2)) };
});
const setInput = (page, id, v) => page.evaluate((id, v) => { const i = document.getElementById(id); i.focus(); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); i.blur(); }, id, v);
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfDraw && window.SwarfVector && document.getElementById('swarf-step-draw')), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  await page.evaluate(() => { for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w); });
  await wait(300);
  await page.click('#swarf-step-draw');
  await page.waitForFunction(() => window.__swarfDraw.state(), { timeout: 5000 });
  await page.evaluate(() => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); S.k = 3; S.ox = r.width / 2 - 100; S.oy = r.height / 2; });
  await page.keyboard.press('t');
  await page.waitForFunction(() => window.__swarfDraw.text.font, { timeout: 15000 }).then(() => check(true, 'the built-in font loads'), () => check(false, 'the built-in font loads'));
  await setInput(page, 'sd-str', 'HI');
  await setInput(page, 'sd-th', '40');
  await page.evaluate(() => { const i = document.getElementById('sd-th'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  const [cx, cy] = await px(page, -100, 0);
  await page.mouse.move(cx + 30, cy + 30); await page.mouse.move(cx, cy);
  await page.mouse.click(cx, cy);
  await wait(200);
  let p = await part(page);
  check(p && p.name === 'HI' && p.n === 2 && Math.abs(p.box[1]) < 0.05 && Math.abs(p.box[3] - 40) < 0.3 && Math.abs(p.box[0] + 100) < 6, `"HI" 40 mm capitals on the baseline at y 0, from x -100: ${JSON.stringify(p)}`);
  await setInput(page, 'sd-str', 'OH');
  await wait(150);
  p = await part(page);
  // the O overshoots the capital height a little, as a round letter should
  check(p && p.text === 'OH' && p.n === 3 && p.box[3] > 39.5 && p.box[3] < 41.5 && p.box[1] < 0.05 && p.box[1] > -1.5, `words changed to "OH" in place: ${JSON.stringify(p)}`);
  const russo = p.box[2] - p.box[0];
  // a font from a file
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 5000 }), page.select('#sd-fontsel', 'file')]);
  await chooser.accept([INTER]);
  await page.waitForFunction(() => window.__swarfDraw.text.name === 'Inter-Regular', { timeout: 5000 }).catch(() => {});
  await wait(200);
  p = await part(page);
  const font = await page.evaluate(() => window.__swarfDraw.text.name);
  check(font === 'Inter-Regular' && p && p.n === 3 && Math.abs(p.box[2] - p.box[0] - russo) > 1, `set in Inter from a file: ${font}, ${(p.box[2] - p.box[0]).toFixed(1)} mm wide (Russo One ${russo.toFixed(1)})`);
  await page.screenshot({ path: `${OUT}-board.png` });
  await page.click('#sd-done');
  await wait(1500);
  const ws = await page.evaluate(() => window.kiri.api.widgets.all().map(w => { const g = w.mesh.geometry; g.computeBoundingBox(); const b = g.boundingBox; return { name: w.meta.file, t: +(b.max.z - b.min.z).toFixed(2), w: +(b.max.x - b.min.x).toFixed(1) }; }));
  check(ws.length === 2 && ws.every(w => w.t === 6), `done: the O and the H are parts, 6 mm thick ${JSON.stringify(ws)}`);
  // the letters stay together: picking one picks the word
  const together = await page.evaluate(() => { const a = window.kiri.api; a.platform.deselect(); a.platform.select(a.widgets.all()[0]); return a.selection.count(); });
  const said = await page.evaluate(() => [...document.querySelectorAll('.alert, #alert-area, .swarf-alert, #alerts')].map(e => e.textContent).join(' '));
  check(together === 2, `picking one letter picks the word (${together} picked)`);
  // the O keeps its counter: its top face has a hole (inner ring of vertices)
  const holed = await page.evaluate(() => {
    const w = window.kiri.api.widgets.all().reduce((a, b) => (a.mesh.geometry.attributes.position.count > b.mesh.geometry.attributes.position.count ? a : b));
    const g = w.mesh.geometry.attributes.position.array; let zmax = -Infinity; for (let i = 2; i < g.length; i += 3) zmax = Math.max(zmax, g[i]);
    let cx = 0, cy = 0, n = 0; for (let i = 0; i < g.length; i += 3) if (g[i + 2] > zmax - 1e-4) { cx += g[i]; cy += g[i + 1]; n++; }
    cx /= n; cy /= n;
    // nothing of the top face sits at the middle of the O
    let near = Infinity; for (let i = 0; i < g.length; i += 3) if (g[i + 2] > zmax - 1e-4) near = Math.min(near, Math.hypot(g[i] - cx, g[i + 1] - cy));
    return +near.toFixed(2);
  });
  check(holed > 5, `the O's counter is a hole (nearest top vertex ${holed} mm from its middle)`);
  await page.evaluate(() => { const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(400);
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  const pv = await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', () => res('preview.end')); window.kiri.api.event.on('preview.error', e => res('preview.error ' + e)); setTimeout(() => res('timeout'), 90000); }));
  check(pv === 'preview.end', `toolpaths: ${pv}`);
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `text: ${bad.length} failed, ${errors.length} page errors` : 'text: ok');
process.exit(bad.length || errors.length ? 1 : 0);
