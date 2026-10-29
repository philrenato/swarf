// DRAW's engraved lines, through to the file. A pen line drawn over an existing 10 mm part
// (ended by clicking its last point again) at 1.5 mm deep, and a pencil line over a new part
// drawn in the same visit at 2.5 mm deep, are kept on their parts; done adds one engrave step,
// first. The exported file cuts along each line (the bit's center on it: the cut's extent is
// the line's) at the part's top less its depth, and still does after a reload.
//   node tools/probe_engrave.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME || '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-engrave';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const px = (page, x, y) => page.evaluate((x, y) => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); return [r.left + S.ox + x * S.k, r.top + S.oy - y * S.k]; }, x, y);
async function drag(page, a, b) {
  const [x0, y0] = await px(page, ...a), [x1, y1] = await px(page, ...b);
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(x0 + (x1 - x0) * i / 10, y0 + (y1 - y0) * i / 10); await wait(15); }
  await page.mouse.up(); await wait(80);
}
const setField = (page, id, v) => page.evaluate((id, v) => { const i = document.getElementById(id); i.value = v; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }, id, v);
// every cutting move's end point, with X Y Z carried modally
function moves(gc) {
  const out = []; let X = 0, Y = 0, Z = 0;
  for (const line of gc.split('\n')) {
    const m = /^G([01])\b(.*)/.exec(line.trim());
    if (!m) continue;
    const g = (k) => { const r = new RegExp(k + '(-?[\\d.]+)').exec(m[2]); return r ? +r[1] : null; };
    X = g('X') ?? X; Y = g('Y') ?? Y; Z = g('Z') ?? Z;
    if (m[1] === '1') out.push([X, Y, Z]);
  }
  return out;
}
const at = (M, z) => { const L = M.filter(p => Math.abs(p[2] - z) < 0.03); const b = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of L) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); } return { n: L.length, w: +(b[2] - b[0]).toFixed(2), h: +(b[3] - b[1]).toFixed(2) }; };
async function paths(page) {
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  const pv = await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', () => res('preview.end')); window.kiri.api.event.on('preview.error', e => res('preview.error ' + e)); setTimeout(() => res('timeout'), 90000); }));
  const gc = await page.evaluate(() => new Promise(res => { try { window.kiri.api.function.export(g => res(typeof g === 'string' ? g : (g?.gcode || String(g)))); } catch (e) { res(''); } setTimeout(() => res(''), 60000); }));
  return { pv, gc };
}
const ready = page => page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfDraw && window.SwarfDrawGeom && document.getElementById('swarf-step-draw')), { timeout: 90000, polling: 200 });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ready(page);
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  await page.evaluate(() => { for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w); const s = window.kiri.api.conf.get(); s.process.ops = []; window.kiri.api.conf.save(); try { localStorage.removeItem('swarf-draw-inside'); } catch (e) { } });
  await wait(300);
  const openDraw = async () => {
    await page.click('#swarf-step-draw');
    await page.waitForFunction(() => window.__swarfDraw.state(), { timeout: 5000 });
    await page.evaluate(() => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); S.k = 2.5; S.ox = r.width / 2 - 100; S.oy = r.height / 2 + 40; });
  };
  // an existing part: a 100 x 60 rectangle, 10 mm thick
  await openDraw();
  await page.keyboard.press('r');
  await setField(page, 'sd-pen-t', '10');
  await drag(page, [0, 0], [100, 60]);
  await page.click('#sd-done');
  await wait(1500);
  check((await page.evaluate(() => window.kiri.api.widgets.all().length)) === 1, 'a 10 mm part on the bed');

  // the pen draws a line over it, 1.5 mm deep, ended by clicking its last point again
  await openDraw();
  await page.keyboard.press('p');
  await setField(page, 'sd-dep', '1.5');
  for (const q of [[20, 30], [50, 45], [80, 30], [80, 30]]) { const [x, y] = await px(page, ...q); await page.mouse.click(x, y); await wait(80); }
  let line = await page.evaluate(() => { const S = window.__swarfDraw.state(), p = S.parts[S.sel]; return p && { line: !!p.line, depth: p.depth, card: document.getElementById('sd-card').textContent }; });
  check(line && line.line && line.depth === 1.5 && /Cut into/.test(line.card), `the pen ends a line by its last point: engraved 1.5 mm into the part (${JSON.stringify(line && { line: line.line, depth: line.depth })})`);
  // a new part in the same visit, with a pencil line over it, 2 mm deep
  await page.keyboard.press('r');
  await drag(page, [-160, 0], [-40, 60]);
  await page.keyboard.press('n');
  await setField(page, 'sd-dep', '2.5');
  {
    const pts = []; for (let i = 0; i <= 80; i++) pts.push([-140 + i, 30 + 12 * Math.sin(i / 10)]);
    const S = []; for (const p of pts) S.push((await px(page, ...p)).map(Math.round));
    await page.mouse.move(...S[0]); await page.mouse.down(); for (const q of S.slice(1)) await page.mouse.move(...q); await page.mouse.up(); await wait(120);
  }
  line = await page.evaluate(() => { const S = window.__swarfDraw.state(), p = S.parts[S.sel]; return p && { line: !!p.line, depth: p.depth, n: p.pencil && p.pencil.n }; });
  check(line && line.line && line.depth === 2.5 && line.n >= 3, `the pencil draws a line over the new part, 2.5 mm deep (${JSON.stringify(line)})`);
  await page.screenshot({ path: `${OUT}-board.png` });
  await page.click('#sd-done');
  await wait(1800);
  const kept = await page.evaluate(() => ({ ws: window.kiri.api.widgets.all().map(w => ({ name: w.meta.file, engrave: (w.meta.engrave || []).map(l => l.depth) })), ops: window.kiri.api.conf.get().process.ops.map(o => (o.engrave ? 'engrave' : o.type)) }));
  check(kept.ws.length === 2 && kept.ws.some(w => w.engrave.join() === '1.5') && kept.ws.some(w => w.engrave.join() === '2.5'), `done: each line kept on its part ${JSON.stringify(kept.ws)}`);
  check(kept.ops[0] === 'engrave' && kept.ops.filter(o => o === 'engrave').length === 1, `one engrave step, first (${kept.ops})`);
  const label = await page.evaluate(() => [...document.querySelectorAll('#oplist .label')].map(l => l.textContent));
  check(label.includes('engrave'), `the step list says engrave (${label})`);
  await page.evaluate(() => { const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(400);
  let { pv, gc } = await paths(page);
  check(pv === 'preview.end' && gc.length > 100, `toolpaths and a file (${pv}, ${gc.length} bytes)`);
  let M = moves(gc);
  const zs = [...new Set(M.map(p => p[2]))].sort((a, b) => a - b);
  console.log('   cutting depths in the file:', zs.slice(0, 12).join(' '), zs.length > 12 ? '…' : '');
  let e1 = at(M, -1.5), e2 = at(M, -2.5);
  check(e1.n >= 3 && Math.abs(e1.w - 60) < 0.2 && Math.abs(e1.h - 15) < 0.2, `the pen line cut at Z -1.5 (the top less 1.5), along the line: ${JSON.stringify(e1)} (60 x 15)`);
  // the pencil line's own extent, from the curve kept on its part
  const own = await page.evaluate(() => { const w = window.kiri.api.widgets.all().find(w => (w.meta.engrave || []).some(l => l.depth === 2.5)), b = [Infinity, Infinity, -Infinity, -Infinity]; for (const q of window.SwarfVector.cubics(w.meta.engrave[0].crv)) for (let k = 0; k <= 32; k++) { const t = k / 32, m = 1 - t; const x = m * m * m * q[0][0] + 3 * m * m * t * q[1][0] + 3 * m * t * t * q[2][0] + t * t * t * q[3][0], y = m * m * m * q[0][1] + 3 * m * m * t * q[1][1] + 3 * m * t * t * q[2][1] + t * t * t * q[3][1]; b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); } return { w: +(b[2] - b[0]).toFixed(2), h: +(b[3] - b[1]).toFixed(2) }; });
  check(e2.n >= 3 && Math.abs(e2.w - own.w) < 0.1 && Math.abs(e2.h - own.h) < 0.1 && Math.abs(own.w - 80) < 1.5, `the pencil line cut at Z -2.5 along its wave: ${JSON.stringify(e2)} (the line: ${own.w} x ${own.h})`);
  check(M.some(p => p[2] < -9.9), 'the outline still cuts the parts free (Z to -10)');
  await page.screenshot({ path: `${OUT}-paths.png` });

  // a reload: the lines and the step are still there, and still cut
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.waitForFunction(() => window.kiri.api.widgets.all().length === 2, { timeout: 30000 }).catch(() => {});
  await wait(1500);
  const back = await page.evaluate(() => ({ ws: window.kiri.api.widgets.all().map(w => (w.meta.engrave || []).map(l => l.depth).join()), ops: window.kiri.api.conf.get().process.ops.map(o => (o.engrave ? 'engrave' : o.type)) }));
  check(back.ws.sort().join('|') === '1.5|2.5' && back.ops.includes('engrave'), `after a reload: the lines are on their parts, the step is there (${JSON.stringify(back)})`);
  ({ pv, gc } = await paths(page));
  M = moves(gc);
  e1 = at(M, -1.5); e2 = at(M, -2.5);
  check(pv === 'preview.end' && Math.abs(e1.w - 60) < 0.2 && Math.abs(e2.w - own.w) < 0.1, `after a reload the file cuts both lines (${JSON.stringify({ e1, e2 })})`);
  // DRAW shows them again, as lines it can edit
  await openDraw();
  const lines = await page.evaluate(() => window.__swarfDraw.state().parts.filter(p => p.line).map(p => p.depth));
  check(lines.sort().join() === '1.5,2.5', `DRAW opens with both lines (${lines})`);
  await page.click('#sd-cancel');
  await wait(300);
  // the part turned a quarter turn in cam: its line turns with it
  await page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all().find(w => (w.meta.engrave || []).some(l => l.depth === 1.5)); a.platform.deselect(); a.platform.select(w); a.selection.rotate(0, 0, Math.PI / 2); a.platform.deselect(); });
  await wait(600);
  ({ pv, gc } = await paths(page));
  e1 = at(moves(gc), -1.5);
  check(pv === 'preview.end' && Math.abs(e1.w - 15) < 0.2 && Math.abs(e1.h - 60) < 0.2, `turned a quarter turn: the pen line cuts 15 x 60 now (${JSON.stringify(e1)})`);
  await openDraw();
  await page.evaluate(() => { const S = window.__swarfDraw.state(); S.sel = S.parts.findIndex(p => p.line && p.depth === 1.5); });
  await page.keyboard.press('v');                   // the card drawn again for it
  const card = await page.evaluate(() => document.getElementById('sd-card').textContent);
  check(/Cut into/.test(card), `DRAW shows the turned line still over its part ("${card.slice(0, 60)}…")`);
  await page.click('#sd-cancel');
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `engrave: ${bad.length} failed, ${errors.length} page errors` : 'engrave: ok');
process.exit(bad.length || errors.length ? 1 : 0);
