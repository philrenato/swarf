// DRAW: the bed as a drawing. An L-shaped part is turned 30°, mirrored,
// stretched 1.5× across and moved; its drawing on the board must lie on the
// part's own top edges (both ways, within 0.15 mm). Then, with the mouse: a
// point is dragged, a point added on an edge and removed again, and the pen
// draws a triangle. "done" rebuilds the L where it was drawn with the point
// moved, makes the triangle a part, keeps both 6 mm thick, and the drawings
// still line up after a reload. Then toolpaths and control.
//   node tools/probe_draw.mjs [url]
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const CHROME = process.env.CHROME || '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-draw';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };

// in the page: worst distance from each top vertex of each part to its drawing
// on the board, and from each drawing corner to the nearest top vertex
const ALIGN = () => {
  const out = [];
  for (const w of window.kiri.api.widgets.all()) {
    const curves = window.__swarfDraw.bedCurves(w), pos = w.track.pos;
    const g = w.mesh.geometry.attributes.position.array;
    let zmax = -Infinity;
    for (let i = 2; i < g.length; i += 3) zmax = Math.max(zmax, g[i]);
    const top = [];
    for (let i = 0; i < g.length; i += 3) if (g[i + 2] > zmax - 1e-4) top.push([g[i] + pos.x, g[i + 1] + pos.y]);
    const seg = [];
    for (const c of curves) {
      const C = window.SwarfVector.cubics(c.crv);
      for (const q of C) for (let k = 0; k < 200; k++) {
        const at = t => { const m = 1 - t; return [0, 1].map(j => m * m * m * q[0][j] + 3 * m * m * t * q[1][j] + 3 * m * t * t * q[2][j] + t * t * t * q[3][j]); };
        seg.push([at(k / 200), at((k + 1) / 200)]);
      }
    }
    const dseg = (p, [a, b]) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1; let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L; t = Math.max(0, Math.min(1, t)); return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]); };
    let onCurve = 0;
    for (const p of top) onCurve = Math.max(onCurve, Math.min(...seg.map(s => dseg(p, s))));
    let corners = 0;
    for (const c of curves) if (c.crv.degree === 1) for (const P of c.crv.ctrlPts) corners = Math.max(corners, Math.min(...top.map(t => Math.hypot(t[0] - P[0], t[1] - P[1]))));
    out.push({ name: w.meta.file, onCurve: +onCurve.toFixed(3), corners: +corners.toFixed(3), top: top.length });
  }
  return out;
};
const aligned = (rows, what) => check(rows.length && rows.every(r => r.top > 2 && r.onCurve < 0.15 && r.corners < 0.15), `${what}: ${JSON.stringify(rows)}`);

async function boot(page) {
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfDraw && window.SwarfVector && document.getElementById('swarf-step-draw')), { timeout: 90000, polling: 200 });
  await wait(1500);
}
// mm on the board to page pixels
const px = (page, x, y) => page.evaluate((x, y) => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); return [r.left + S.ox + x * S.k, r.top + S.oy - y * S.k]; }, x, y);

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await boot(page);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  await page.evaluate(() => { for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w); });
  await wait(400);
  // an L: 80 wide, 60 tall, 20 thick legs
  await page.evaluate(() => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="60mm" viewBox="0 0 80 60"><path d="M0,60 H80 V40 H20 V0 H0 Z" fill="#000"/></svg>';
    const a = window.kiri.api, [w] = a.platform.load_svg(svg, 'ell', { depth: 6, resolution: 2, segmin: 48, soup: true, dpi: 0 });
    a.platform.select(w);
    a.selection.rotate(0, 0, Math.PI / 6);
    a.selection.mirror();
    a.selection.scale(1.5, 1, 1);
    w.move(50, -30, 0);
  });
  await wait(600);
  aligned(await page.evaluate(ALIGN), 'turned, mirrored, stretched, moved L lines up with its drawing');
  // one drawing, two parts (cam centres them as a group): each lines up with its own shapes
  const two = readFileSync(new URL('./fixtures-2d/two-shapes.svg', import.meta.url), 'utf8');
  await page.evaluate(svg => window.kiri.api.platform.load_svg(svg, 'two', { depth: 6, resolution: 2, segmin: 48, soup: true, dpi: 0 }), two);
  await wait(600);
  let rows = await page.evaluate(ALIGN);
  aligned(rows.filter(r => /two/.test(r.name)), 'two parts from one drawing each line up');
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all().filter(w => /two/.test(w.meta.file))) a.platform.delete(w); const L = a.widgets.all()[0]; a.platform.deselect(); a.platform.select(L); });
  await wait(400);

  // DRAW opens with the L picked
  await page.click('#swarf-step-draw');
  await page.waitForFunction(() => window.__swarfDraw.state() && document.querySelector('#sd-svg [data-pt]'), { timeout: 5000 });
  let st = await page.evaluate(() => { const S = window.__swarfDraw.state(); return { sel: S.sel, parts: S.parts.length, pts: document.querySelectorAll('#sd-svg [data-pt]:not(.sd-pthit)').length }; });
  check(st.sel === 0 && st.parts === 1 && st.pts === 6, `DRAW opens on the L with its 6 corners: ${JSON.stringify(st)}`);
  await page.screenshot({ path: `${OUT}-open.png` });

  // drag the first corner 40 px right
  const pt = await page.evaluate(() => { const S = window.__swarfDraw.state(), P = S.parts[0].curves[0].crv.ctrlPts[0]; const el = document.querySelector('#sd-svg [data-pt="0:0"]').getBoundingClientRect(); return { x: P[0], y: P[1], k: S.k, cx: el.left + el.width / 2, cy: el.top + el.height / 2 }; });
  await page.mouse.move(pt.cx, pt.cy); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(pt.cx + i * 5, pt.cy); await wait(20); }
  await page.mouse.up();
  const moved = await page.evaluate(() => { const S = window.__swarfDraw.state(), P = S.parts[0].curves[0].crv.ctrlPts; return { first: P[0], last: P[P.length - 1], dirty: S.parts[0].dirty }; });
  const want = Math.round(40 / pt.k * 10) / 10;
  check(moved.dirty && Math.abs(moved.first[0] - pt.x - want) < 0.11 && Math.abs(moved.first[1] - pt.y) < 0.11 && moved.last[0] === moved.first[0], `dragged corner moved ${(moved.first[0] - pt.x).toFixed(2)} mm (want ${want}), closing twin with it`);
  // double-click mid-edge between corners 1 and 2: a 7th point; Delete removes it
  // the edge middle farthest from every corner (a near one sits under a corner's square)
  const mid = await page.evaluate(() => { const P = window.__swarfDraw.state().parts[0].curves[0].crv.ctrlPts; let best = null, far = -1; for (let i = 0; i < P.length - 1; i++) { const m = [(P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2], d = Math.min(...P.map(q => Math.hypot(q[0] - m[0], q[1] - m[1]))); if (d > far) { far = d; best = m; } } return best; });
  const [mx, my] = await px(page, mid[0], mid[1]);
  await page.mouse.click(mx, my); await wait(120); await page.mouse.click(mx, my);
  await wait(100);
  let n = await page.evaluate(() => document.querySelectorAll('#sd-svg [data-pt]:not(.sd-pthit)').length);
  const under = await page.evaluate((x, y) => { const e = document.elementFromPoint(x, y), S = window.__swarfDraw.state(); return { hit: e && e.getAttribute('class'), sel: S.sel, say: document.getElementById('sd-say').textContent }; }, mx, my);
  check(n === 7, `double-click an edge adds a point (${n}) ${JSON.stringify(under)}`);
  await page.keyboard.press('Delete');
  await wait(100);
  n = await page.evaluate(() => document.querySelectorAll('#sd-svg [data-pt]:not(.sd-pthit)').length);
  check(n === 6, `Delete removes it again (${n})`);
  // type a point: corner 3 to an exact place
  await page.mouse.click(...(await page.evaluate(() => { const el = document.querySelector('#sd-svg [data-pt="0:3"]').getBoundingClientRect(); return [el.left + 4, el.top + 4]; })));
  const typed = await page.evaluate(() => { const S = window.__swarfDraw.state(), P = S.parts[0].curves[0].crv.ctrlPts[3]; return [P[0], P[1]]; });
  await page.evaluate(() => { const i = document.getElementById('sd-py'); i.value = String(+i.value + 5); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  const after = await page.evaluate(() => { const P = window.__swarfDraw.state().parts[0].curves[0].crv.ctrlPts[3]; return [P[0], P[1]]; });
  check(Math.abs(after[1] - typed[1] - 5) < 0.01 && Math.abs(after[0] - typed[0]) < 1e-9, `typed y moves the point 5 mm up (${(after[1] - typed[1]).toFixed(3)})`);
  const L = await page.evaluate(() => window.__swarfDraw.state().parts[0].curves[0].crv.ctrlPts.map(p => [p[0], p[1]]));

  // the pen: a triangle at (-60,60) (20,60) (-20,120), closed on its first corner
  await page.keyboard.press('p');
  const tri = [[-60, 60], [20, 60], [-20, 120]];
  for (const [x, y] of tri) { const [a, b] = await px(page, x, y); await page.mouse.click(a, b); await wait(60); }
  { const [a, b] = await px(page, tri[0][0], tri[0][1]); await page.mouse.click(a, b); }
  await wait(100);
  st = await page.evaluate(() => { const S = window.__swarfDraw.state(); return { parts: S.parts.length, tool: S.tool, pts: S.parts[1] && S.parts[1].curves[0].crv.ctrlPts.length }; });
  check(st.parts === 2 && st.tool === 'select' && st.pts === 4, `the pen closes a triangle: ${JSON.stringify(st)}`);
  await page.screenshot({ path: `${OUT}-drawn.png` });
  await page.click('#sd-done');
  await wait(1200);

  const ws = await page.evaluate(() => window.kiri.api.widgets.all().map(w => { const g = w.mesh.geometry; g.computeBoundingBox(); const b = g.boundingBox; return { name: w.meta.file, t: +(b.max.z - b.min.z).toFixed(3), x0: +(b.min.x + w.track.pos.x).toFixed(1), x1: +(b.max.x + w.track.pos.x).toFixed(1), y0: +(b.min.y + w.track.pos.y).toFixed(1), y1: +(b.max.y + w.track.pos.y).toFixed(1) }; }));
  const t = ws.find(w => /drawing/.test(w.name));
  check(ws.length === 2 && ws.every(w => Math.abs(w.t - 6) < 0.01), `done: two parts, both 6 mm thick ${JSON.stringify(ws)}`);
  check(t && Math.abs(t.x0 + 60) < 0.3 && Math.abs(t.x1 - 20) < 0.3 && Math.abs(t.y0 - 60) < 0.3 && Math.abs(t.y1 - 120) < 0.3, `the triangle sits where it was drawn ${JSON.stringify(t)}`);
  // the rebuilt L has its corners where they were left on the board
  const corners = await page.evaluate(L => {
    const w = window.kiri.api.widgets.all().find(w => /ell/.test(w.meta.file)), pos = w.track.pos, g = w.mesh.geometry.attributes.position.array;
    const top = []; for (let i = 0; i < g.length; i += 3) top.push([g[i] + pos.x, g[i + 1] + pos.y]);
    return Math.max(...L.map(P => Math.min(...top.map(t => Math.hypot(t[0] - P[0], t[1] - P[1])))));
  }, L);
  check(corners < 0.15, `the rebuilt L has the edited corners (worst ${corners.toFixed(3)} mm)`);
  aligned(await page.evaluate(ALIGN), 'after done, both drawings line up');

  // turn the triangle in cam, then reload: the drawings still line up
  await page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all().find(w => /drawing/.test(w.meta.file)); a.platform.deselect(); a.platform.select(w); a.selection.rotate(0, 0, 0.35); a.space.auto_save && a.space.auto_save(); });
  await wait(5000);              // cam saves a part 1.5 s after it changes
  aligned(await page.evaluate(ALIGN), 'triangle turned 20° in cam lines up');
  await boot(page);
  const count = await page.evaluate(() => window.kiri.api.widgets.all().length);
  check(count === 2, `after a reload there are still 2 parts (${count})`);
  aligned(await page.evaluate(ALIGN), 'after a reload, both drawings line up');

  // a curve: a 60 mm circle is arcs (a Bézier chain); dragging an anchor carries its handles
  await page.evaluate(() => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="60mm" viewBox="0 0 60 60"><circle cx="30" cy="30" r="30" fill="#000"/></svg>';
    const a = window.kiri.api, [w] = a.platform.load_svg(svg, 'disc', { depth: 6, resolution: 2, segmin: 48, soup: true, dpi: 0 });
    a.platform.deselect(); a.platform.select(w);
  });
  await wait(600);
  await page.click('#swarf-step-draw');
  await page.waitForFunction(() => window.__swarfDraw.state() && document.querySelector('#sd-svg [data-pt]'), { timeout: 5000 });
  const c0 = await page.evaluate(() => { const S = window.__swarfDraw.state(), p = S.parts[S.sel], crv = p.curves[0].crv; return { name: p.name, chain: window.__swarfDraw.isChain(crv), deg: crv.degree, P: crv.ctrlPts.map(q => [q[0], q[1]]), anchors: document.querySelectorAll('#sd-svg rect[data-pt]').length, hd: document.querySelectorAll('#sd-svg circle[data-pt]').length }; });
  check(/disc/.test(c0.name) && c0.chain && c0.anchors >= 4 && c0.hd >= 4, `the circle edits as anchors + handles: ${JSON.stringify({ ...c0, P: c0.P.length })}`);
  const ap = c0.deg;                              // anchor 1 sits at index = degree
  const el = await page.evaluate(i => { const r = document.querySelector(`#sd-svg [data-pt="0:${i}"]`).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, ap);
  console.log('hit', await page.evaluate(([x, y]) => { const h = document.elementFromPoint(x, y); return h && (h.tagName + ' ' + (h.dataset.pt || h.dataset.part || h.id || h.className)); }, el), JSON.stringify(el), await page.evaluate(() => [...window.__swarfDraw.state().pts]));
  await page.mouse.move(el[0], el[1]); await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(el[0], el[1] - i * 5); await wait(20); }
  await page.mouse.up();
  const c1 = await page.evaluate(() => { const S = window.__swarfDraw.state(); return S.parts[S.sel].curves[0].crv.ctrlPts.map(q => [q[0], q[1]]); });
  const dy = i => c1[i][1] - c0.P[i][1];
  console.log('dy', JSON.stringify(c1.map((q, i) => +(q[1] - c0.P[i][1]).toFixed(3))));
  check(dy(ap) > 1 && Math.abs(dy(ap - 1) - dy(ap)) < 1e-9 && Math.abs(dy(ap + 1) - dy(ap)) < 1e-9 && Math.abs(dy(ap + 2)) < 1e-9 && Math.abs(dy(0)) < 1e-9, `anchor moved ${dy(ap).toFixed(1)} mm with both handles, the rest stayed`);
  await page.screenshot({ path: `${OUT}-curve.png` });
  await page.click('#sd-done');
  await wait(1200);
  aligned(await page.evaluate(ALIGN), 'after the curve edit, every drawing lines up');

  // toolpaths and control for the drawn parts
  await page.evaluate(() => {
    const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === 'outline');
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await wait(400);
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  const pv = await page.evaluate(() => new Promise(res => {
    window.kiri.api.event.on('preview.end', () => res('preview.end'));
    window.kiri.api.event.on('preview.error', e => res('preview.error ' + e));
    setTimeout(() => res('timeout'), 60000);
  }));
  check(pv === 'preview.end', `toolpaths: ${pv}`);
  await page.click('#swarf-step-run');
  await page.waitForFunction(() => window.__swarfRun.state.prog, { timeout: 60000 }).catch(() => {});
  const r = await page.evaluate(() => { const p = window.__swarfRun.state.prog; if (!p) return null; const b = window.SwarfRunParse.cutBounds(p.parsed); return { moves: p.parsed.moves.length, w: b && +(b.max.x - b.min.x).toFixed(1), deep: b && +(-b.min.z).toFixed(2) }; });
  check(r && r.moves > 20 && r.deep >= 5.9, `in control: ${JSON.stringify(r)}`);
  await page.screenshot({ path: `${OUT}-control.png` });
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `draw: ${bad.length} failed, ${errors.length} page errors` : 'draw: ok');
process.exit(bad.length || errors.length ? 1 : 0);
