// TEX, through to the file. A 120 x 80 part, 19 mm thick, with an outline step: TEX opens from
// the step row (the row folds, tex lit), the brush paints a mark across the part, the card picks
// ocean waves 2 mm deep; done leaves TEX, keeps the mark on the part and adds one texture step
// before the outline. The exported file cuts the texture inside the painted stroke, never below
// 2 mm, before the outline cuts the part free; after a reload the mark, the step and the cut are
// all still there. A copy of the part shares the step; Escape and the cam step both leave TEX.
//   node tools/probe_tex.mjs [url]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-tex';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
// a bed point (mm) on the open board (DRAW's or TEX's), in page pixels
const px = (page, x, y) => page.evaluate((x, y) => { const B = window.__swarfTex.state() || window.__swarfDraw.state(), r = document.querySelector('#swarf-draw svg').getBoundingClientRect(); return [r.left + B.ox + x * B.k, r.top + B.oy - y * B.k]; }, x, y);
async function drag(page, a, b, n = 10) {
  const [x0, y0] = await px(page, ...a), [x1, y1] = await px(page, ...b);
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (let i = 1; i <= n; i++) { await page.mouse.move(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n); await wait(15); }
  await page.mouse.up(); await wait(120);
}
const setField = (page, id, v) => page.evaluate((id, v) => { const i = document.getElementById(id); i.value = v; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }, id, v);
const setSelect = (page, id, v) => page.evaluate((id, v) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, id, v);
// every move's end point, with the tool it was cut by: X Y Z carried modally, tool from each change
function moves(gc) {
  const out = []; let X = 0, Y = 0, Z = 0, tool = 0;
  for (const line of gc.split('\n')) {
    const t = /&Tool\s*=\s*(\d+)/.exec(line);
    if (t) { tool = +t[1]; continue; }
    const m = /^G([01])\b(.*)/.exec(line.trim());
    if (!m) continue;
    const g = (k) => { const r = new RegExp(k + '(-?[\\d.]+)').exec(m[2]); return r ? +r[1] : null; };
    X = g('X') ?? X; Y = g('Y') ?? Y; Z = g('Z') ?? Z;
    out.push({ x: X, y: Y, z: Z, cut: m[1] === '1', tool });
  }
  return out;
}
async function paths(page) {
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  const pv = await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', () => res('preview.end')); window.kiri.api.event.on('preview.error', e => res('preview.error ' + e)); setTimeout(() => res('timeout'), 120000); }));
  const gc = await page.evaluate(() => new Promise(res => { try { window.kiri.api.function.export(g => res(typeof g === 'string' ? g : (g?.gcode || String(g)))); } catch (e) { res(''); } setTimeout(() => res(''), 60000); }));
  return { pv, gc };
}
const ready = page => page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfDraw && window.__swarfTex && window.SwarfTexCore && document.getElementById('swarf-step-tex')), { timeout: 90000, polling: 200 });
const tex = page => page.evaluate(() => {
  const a = window.kiri.api, ops = a.conf.get().process.ops;
  return {
    ws: a.widgets.all().map(w => ({ id: w.id, name: w.meta.file, marks: (w.meta.tex || []).map(m => ({ id: m.id, pattern: m.fill.pattern, depth: m.fill.depth, cells: m.region.runs.filter((n, i) => i % 2).reduce((s, n) => s + n, 0) })) })),
    ops: ops.filter(o => o.type !== '|').map(o => (o.type === 'texture' ? `texture:${o.texmark}` : o.type)),
    labels: [...document.querySelectorAll('#oplist .label')].map(l => l.textContent)
  };
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(`${e.message} ${(String(e.stack || '').split('\n')[1] || '').trim()}`));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await ready(page);
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  await page.evaluate(() => { for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w); const s = window.kiri.api.conf.get(); s.process.ops = []; window.kiri.api.conf.save(); try { localStorage.removeItem('swarf-tex-fill'); localStorage.removeItem('swarf-tex-brush'); } catch (e) { } });
  await wait(300);
  // a part: DRAW's rectangle, 120 x 80, 19 mm thick, and an outline step
  await page.click('#swarf-step-draw');
  await page.waitForFunction(() => window.__swarfDraw.state(), { timeout: 5000 });
  await page.evaluate(() => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); S.k = 2.5; S.ox = r.width / 2 - 150; S.oy = r.height / 2 + 100; });
  await page.keyboard.press('r');
  await setField(page, 'sd-pen-t', '19');
  await drag(page, [0, 0], [120, 80]);
  await page.click('#sd-done');
  await wait(1500);
  await page.evaluate(() => { const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(400);
  check((await page.evaluate(() => window.kiri.api.widgets.all().length)) === 1, 'a 19 mm part on the bed, with an outline step');

  // TEX opens from the step row: the row folds to the modes, tex lit
  await page.click('#swarf-step-tex');
  await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 5000 });
  const opened = await page.evaluate(() => ({ mode: window.__swarfModes.mode(), lit: document.getElementById('swarf-step-tex').classList.contains('swarf-step-on'), paths: getComputedStyle(document.getElementById('act-paths')).display, parts: window.__swarfTex.state().parts.length }));
  check(opened.mode === 'tex' && opened.lit && opened.paths === 'none' && opened.parts === 1, `TEX opens: mode tex, its step lit, cam's steps folded, the part on the board (${JSON.stringify(opened)})`);
  await page.evaluate(() => { const S = window.__swarfTex.state(), r = document.getElementById('tx-svg').getBoundingClientRect(); S.k = 2.5; S.ox = r.width / 2 - 150; S.oy = r.height / 2 + 100; });
  // the brush, 20 mm across, paints a stroke across the part's middle
  await page.keyboard.press('b');
  await setField(page, 'tx-bsize', '20');
  await drag(page, [25, 40], [95, 45], 20);
  let st = await page.evaluate(() => { const S = window.__swarfTex.state(), p = S.parts[S.sel], m = p && p.marks[S.mark]; return m && { cells: m.region.data.reduce((s, v) => s + v, 0), res: m.region.res, brush: S.brush, card: document.getElementById('tx-card').textContent }; });
  const want = (70 * 20 + Math.PI * 100) / 0.25;    // the stroke's capsule, in 0.5 mm cells
  check(st && st.brush === 20 && Math.abs(st.cells - want) < want * 0.08, `the brush paints the stroke: ${st && st.cells} cells (a 20 mm capsule 70 mm long is about ${Math.round(want)})`);
  // the eraser takes a bite out of it; undo puts it back
  await page.keyboard.press('u');
  await drag(page, [60, 30], [60, 55], 6);
  const bitten = await page.evaluate(() => { const S = window.__swarfTex.state(); return S.parts[S.sel].marks[S.mark].region.data.reduce((s, v) => s + v, 0); });
  await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta');
  const back = await page.evaluate(() => { const S = window.__swarfTex.state(); return S.parts[S.sel].marks[S.mark].region.data.reduce((s, v) => s + v, 0); });
  check(bitten < st.cells - 500 && back === st.cells, `erase takes a bite (${st.cells} → ${bitten}), ⌘Z puts it back (${back})`);
  // a second mark: region (G) fills the part's whole top; an ellipse (E) on a third; delete takes both away
  const cells = () => page.evaluate(() => { const S = window.__swarfTex.state(), m = S.parts[S.sel].marks[S.mark]; return { n: S.parts[S.sel].marks.length, at: S.mark, c: m ? m.region.data.reduce((s, v) => s + v, 0) : 0 }; });
  await page.click('#tx-new');
  await page.keyboard.press('g');
  { const [x, y] = await px(page, 10, 10); await page.mouse.click(x, y); await wait(150); }
  const reg = await cells();
  check(reg.n === 2 && Math.abs(reg.c - 120 * 80 / 0.25) < 120 * 80 / 0.25 * 0.02, `region (G) fills the part's top: ${reg.c} cells (120 x 80 is ${120 * 80 / 0.25})`);
  await page.click('#tx-new');
  await page.keyboard.press('e');
  await drag(page, [20, 20], [60, 50]);
  const ell = await cells(), area = Math.PI * 20 * 15 / 0.25;
  check(ell.n === 3 && Math.abs(ell.c - area) < area * 0.04, `ellipse (E) drags one out: ${ell.c} cells (about ${Math.round(area)})`);
  await page.keyboard.press('v');
  await page.keyboard.press('Delete');
  await page.evaluate(() => { window.__swarfTex.state().mark = 1; });
  await page.keyboard.press('Backspace');
  await page.evaluate(() => { window.__swarfTex.state().mark = 0; });
  await page.keyboard.press('b');
  const one = await cells();
  check(one.n === 1 && one.c === st.cells, `delete takes them away, the first mark stays (${JSON.stringify(one)})`);
  // the card: ocean waves, 2 mm deep, the 1/4 in ball
  await setSelect(page, 'tx-pat', 'waves');
  await setField(page, 'tx-depth', '2');
  await setSelect(page, 'tx-bit', '1018');
  await page.waitForFunction(() => /About .* to cut/.test(document.getElementById('tx-card').textContent), { timeout: 20000 }).catch(() => {});
  st = await page.evaluate(() => { const S = window.__swarfTex.state(), m = S.parts[S.sel].marks[S.mark]; return { pattern: m.fill.pattern, depth: m.fill.depth, tool: m.fill.tool, card: document.getElementById('tx-card').textContent, img: !!document.querySelector('#tx-svg image.tx-mark') }; });
  check(st.pattern === 'waves' && st.depth === 2 && st.tool === 1018 && /About .* to cut/.test(st.card) && st.img, `the card fills the mark: ${st.pattern}, ${st.depth} mm, ${st.tool}; "${(/About [^.]*/.exec(st.card) || [''])[0]}"; the mark drawn on the board`);
  await page.screenshot({ path: `${OUT}-board.png` });
  const look = await page.evaluate(() => {
    const c = document.getElementById('tx-card'), cr = c.getBoundingClientRect(), note = [...c.querySelectorAll('.sd-note')].find(n => /About/.test(n.textContent));
    const pick = c.querySelector('.tx-pick.on'), other = document.getElementById('tx-new'), bg = el => el && getComputedStyle(el).backgroundColor;
    return { sws: c.querySelectorAll('.tx-sw').length, on: [...c.querySelectorAll('.tx-sw.on')].map(b => b.dataset.pat), more: !!c.querySelector('details.tx-more:not([open])'),
      seen: !!note && note.getBoundingClientRect().bottom <= cr.bottom, edge: !!document.querySelector('#tx-svg path.tx-edge'), pick: pick && pick.textContent, lit: !!pick && bg(pick) !== bg(other) };
  });
  check(look.sws === 10 && look.on.join() === 'waves' && look.more, `the card: ten swatches, waves lit, the finer points folded (${JSON.stringify({ sws: look.sws, on: look.on, more: look.more })})`);
  check(look.seen, 'the cut time is in view, up by the pattern');
  check(look.edge && look.lit && /^1 · brush \d+ × \d+ mm$/.test(look.pick), `the picked mark: its edge dashed on the board, its button lit and named ("${look.pick}")`);
  // Escape steps back (tool, mark, part) and does not leave while there is something to undo
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  const esc = await page.evaluate(() => ({ open: !!window.__swarfTex.state(), say: document.getElementById('tx-say').textContent }));
  check(esc.open && /Escape again/.test(esc.say), `Escape steps back and asks before dropping the mark ("${esc.say}")`);
  // done leaves TEX: the mark kept on the part, one texture step before the outline
  await page.click('#tx-done');
  await wait(800);
  let k = await tex(page);
  const left = await page.evaluate(() => ({ open: !!window.__swarfTex.state(), mode: window.__swarfModes.mode(), cls: document.body.className.includes('swarf-tex-open') }));
  check(!left.open && left.mode === 'cam' && !left.cls, `done leaves TEX (${JSON.stringify(left)})`);
  const mk = k.ws[0].marks[0];
  check(k.ws[0].marks.length === 1 && mk.pattern === 'waves' && mk.depth === 2 && mk.cells === st.cells || (mk && Math.abs(mk.cells - back) === 0), `the mark is kept on the part (${JSON.stringify(k.ws[0].marks)})`);
  check(k.ops.join() === `texture:${mk.id},outline` && k.labels.some(l => /^texture: ocean waves on /.test(l)), `one texture step, before the outline (${k.ops}; "${k.labels.join('", "')}")`);

  // the file: the texture inside the stroke, never below 2 mm, cut before the outline
  const box = await page.evaluate(() => {
    const w = window.kiri.api.widgets.all()[0], m = w.meta.tex[0], g = window.SwarfTexCore.regionSpec(m.region), p = w.track.pos;
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) if (g.data[j * g.nx + i]) { const x = g.x0 + (i + 0.5) * g.res + p.x, y = g.y0 + (j + 0.5) * g.res + p.y; b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
    const s = window.kiri.api.conf.get(), stock = s.stock || {};
    return { b, bed: [p.x, p.y], tool: s.tools.find(t => t.id === s.process.ops[0].tool).number };
  });
  let { pv, gc } = await paths(page);
  check(pv === 'preview.end' && gc.length > 100, `toolpaths and a file (${pv}, ${gc.length} bytes)`);
  const judge = (gc) => {
    const M = moves(gc), T = M.filter(q => q.tool === box.tool), O = M.filter(q => q.tool !== box.tool && q.tool);
    const cutsT = T.filter(q => q.cut && q.z < -0.05);
    const lo = Math.min(...cutsT.map(q => q.z));
    // in the file's own frame: the texture's cuts within the stroke's box (the file's X, Y are from the stock corner)
    const xs = cutsT.map(q => q.x), ys = cutsT.map(q => q.y);
    const span = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    const firstO = M.findIndex(q => q.tool !== box.tool && q.tool), lastT = M.map(q => q.tool).lastIndexOf(box.tool);
    return { n: cutsT.length, lo, span, x0: Math.min(...xs), before: firstO < 0 || lastT < firstO, outlineDeep: Math.min(...O.map(q => q.z)) };
  };
  let J = judge(gc);
  const bw = box.b[2] - box.b[0], bh = box.b[3] - box.b[1];
  console.log('   texture cuts:', J.n, 'lowest', J.lo, 'span', J.span.map(v => v.toFixed(1)).join(' x '), 'painted', bw.toFixed(1), 'x', bh.toFixed(1));
  check(J.n > 200 && J.lo >= -2.001 && J.lo < -1, `the texture is in the file: ${J.n} cuts, the lowest at Z ${J.lo} (never below -2)`);
  check(J.span[0] <= bw + 0.5 && J.span[1] <= bh + 0.5 && J.span[0] > bw * 0.7, `its cuts stay inside the painted stroke (${J.span.map(v => v.toFixed(1)).join(' x ')} within ${bw.toFixed(1)} x ${bh.toFixed(1)})`);
  check(J.before && J.outlineDeep < -18.9, `the texture is cut before the outline cuts the part free (outline to Z ${J.outlineDeep})`);
  await page.screenshot({ path: `${OUT}-paths.png` });
  // simulate plays it (the bit stamped into the board), with no error
  await page.evaluate(() => { const b = [...document.querySelectorAll('.swarf-step, #act-animate, button')].find(e => /^\s*simulate\s*$/i.test(e.textContent)); b && b.click(); });
  await wait(6000);
  await page.screenshot({ path: `${OUT}-simulate.png` });
  check(!errors.length, `simulate plays the texture step with no error${errors.length ? ` (${errors[0]})` : ''}`);
  await page.evaluate(() => window.kiri.api.view.set_arrange()); await wait(800);

  // a reload: the mark, the step and the cut are all still there
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.waitForFunction(() => window.kiri.api.widgets.all().length === 1, { timeout: 30000 }).catch(() => {});
  await wait(1500);
  k = await tex(page);
  check(k.ws[0] && k.ws[0].marks.length === 1 && k.ws[0].marks[0].cells === mk.cells && k.ops.join() === `texture:${mk.id},outline`, `after a reload: the mark on its part, its step first (${JSON.stringify(k.ws[0] && k.ws[0].marks)}; ${k.ops})`);
  ({ pv, gc } = await paths(page));
  const J2 = judge(gc);
  check(pv === 'preview.end' && J2.n === J.n && J2.lo === J.lo, `after a reload the file cuts the same texture (${J2.n} cuts, lowest ${J2.lo})`);

  // the part turned a quarter turn in cam: the mark turns with it (the cut's span swaps)
  await page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all()[0]; a.platform.deselect(); a.platform.select(w); a.selection.rotate(0, 0, Math.PI / 2); a.platform.deselect(); });
  await wait(600);
  ({ pv, gc } = await paths(page));
  const J4 = judge(gc);
  check(pv === 'preview.end' && Math.abs(J4.span[0] - J.span[1]) < 1.5 && Math.abs(J4.span[1] - J.span[0]) < 1.5 && J4.lo >= -2.001, `turned a quarter turn: the texture turns with its part (${J4.span.map(v => v.toFixed(1)).join(' x ')}, was ${J.span.map(v => v.toFixed(1)).join(' x ')})`);
  await page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all()[0]; a.platform.select(w); a.selection.rotate(0, 0, -Math.PI / 2); a.platform.deselect(); });
  await wait(600);

  // in inches, TEX's lengths say inches; TEX opens with the mark; the cam step leaves it, as done does
  await page.evaluate(() => { const s = window.kiri.api.ui.units; s.value = 'in'; s.onchange(); });
  await wait(300);
  await page.click('#swarf-step-tex');
  await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 5000 });
  const again = await page.evaluate(() => window.__swarfTex.state().parts[0].marks.map(m => m.fill.pattern));
  check(again.join() === 'waves', `TEX opens with the mark (${again})`);
  const shaded = await page.waitForFunction(() => window.__swarfTex.state().parts[0].marks.every(m => m.img && m.img.mode === 'full'), { timeout: 5000 }).then(() => true, () => false);
  check(shaded, 'TEX opens with its marks shaded (not flat)');
  await page.evaluate(() => { const S = window.__swarfTex.state(); S.sel = 0; S.mark = 0; });
  await page.keyboard.press('b');
  const inch = await page.evaluate(() => ({ depth: document.getElementById('tx-depth')?.value, u: [...document.querySelectorAll('#tx-card .u')].map(u => u.textContent).filter(Boolean) }));
  check(inch.depth === String(+(2 / 25.4).toFixed(4)) && inch.u.length && inch.u.every(u => u === 'in' || u === '%' || u === '°'), `in inches the card's lengths are inches (depth ${inch.depth} ${[...new Set(inch.u)].join(' ')})`);
  await page.evaluate(() => { const s = window.kiri.api.ui.units; s.value = 'mm'; s.onchange(); });
  await page.click('#swarf-step-cam');
  await wait(400);
  check(!(await page.evaluate(() => !!window.__swarfTex.state())), 'the cam step leaves TEX');
  // with nothing changed, Escape leaves at once
  await page.click('#swarf-step-tex');
  await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 5000 });
  await page.keyboard.press('Escape');
  await wait(200);
  check(!(await page.evaluate(() => !!window.__swarfTex.state())), 'Escape leaves TEX when nothing changed');

  // DRAW: the part slid 1 mm to the right keeps its mark, moved with it, and its step
  await page.click('#swarf-step-draw');
  await page.waitForFunction(() => window.__swarfDraw.state(), { timeout: 5000 });
  await page.evaluate(() => { const S = window.__swarfDraw.state(); S.sel = S.parts.findIndex(p => !p.line); });
  await page.keyboard.press('ArrowRight');
  await page.click('#sd-done');
  await wait(1500);
  k = await tex(page);
  check(k.ws.length === 1 && k.ws[0].marks.length === 1 && k.ws[0].marks[0].cells === mk.cells && k.ops.filter(o => o.startsWith('texture')).length === 1, `DRAW rebuilds the part slid 1 mm: its mark and its step stay (${JSON.stringify(k.ws[0] && k.ws[0].marks)}; ${k.ops})`);
  ({ pv, gc } = await paths(page));
  const J5 = judge(gc);
  check(pv === 'preview.end' && J5.n === J.n && Math.abs(J5.span[0] - J.span[0]) < 0.3, `and the file still cuts it, the same size (${J5.n} cuts, ${J5.span.map(v => v.toFixed(1)).join(' x ')})`);

  // a copy of the part keeps the mark, and the same step cuts both
  await page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all()[0]; a.platform.deselect(); a.platform.select(w); a.selection.duplicate(); });
  await wait(800);
  k = await tex(page);
  check(k.ws.length === 2 && k.ws.every(w => w.marks.length === 1 && w.marks[0].id === mk.id) && k.ops.filter(o => o.startsWith('texture')).length === 1 && k.labels.some(l => /^texture: ocean waves on .*, /.test(l)), `a copy shares the mark and its one step (${k.labels.join(' | ')})`);
  ({ pv, gc } = await paths(page));
  const J3 = judge(gc);
  check(pv === 'preview.end' && J3.n > J.n * 1.8 && J3.lo >= -2.001, `the step cuts both parts (${J3.n} cuts, lowest ${J3.lo})`);
  await page.setViewport({ width: 1280, height: 720 });
  await page.click('#swarf-step-tex');
  await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 5000 });
  await page.evaluate(() => { const S = window.__swarfTex.state(); S.sel = 0; S.mark = 0; });
  await page.keyboard.press('v');
  await page.waitForFunction(() => /About/.test(document.getElementById('tx-card').textContent), { timeout: 15000 }).catch(() => {});
  const small = await page.evaluate(() => { const c = document.getElementById('tx-card'), cr = c.getBoundingClientRect(), n = [...c.querySelectorAll('.sd-note')].find(n => /About/.test(n.textContent)), seen = id => { const e = document.getElementById(id); return !!e && e.getBoundingClientRect().bottom <= cr.bottom + 0.5; }; return { note: !!n && n.getBoundingClientRect().bottom <= cr.bottom, depth: seen('tx-depth'), bit: seen('tx-bit'), path: seen('tx-path'), fits: c.scrollHeight <= c.clientHeight + 1, inView: cr.bottom <= innerHeight }; });
  check(small.note && small.depth && small.bit && small.path && small.fits && small.inView, `at 1280 x 720 the basic card fits: cut time, depth, bit and path in view, no scrolling (${JSON.stringify(small)})`);
  await page.screenshot({ path: `${OUT}-1280.png` });
  await page.click('#tx-cancel');
  await page.setViewport({ width: 1440, height: 900 });
  await wait(300);
  // the concerns: a texture deeper than the board is said
  const said = await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) for (const m of w.meta.tex) m.fill.depth = 25; a.conf.save(); return [...document.querySelectorAll('#swarf-concerns-body .swarf-concern')].map(c => c.textContent).filter(t => /texture/.test(t)); });
  check(said.some(t => /cut through/.test(t)), `concerns say a texture deeper than the board (${said[0] && said[0].slice(0, 90)}…)`);
  // the step taken away in cam: its mark goes with it, said, and does not come back
  await page.evaluate(() => { const row = [...document.querySelectorAll('#oplist > div')].find(r => /^texture/.test(r.querySelector('.label')?.textContent || '')); row?.querySelector('.del')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
  await wait(600);
  const gone = await page.evaluate(() => ({ marks: window.kiri.api.widgets.all().map(w => (w.meta.tex || []).length), ops: window.kiri.api.conf.get().process.ops.map(o => o.type), say: document.getElementById('alert-text')?.textContent || document.body.innerText.match(/The mark on [^\n]*/)?.[0] || '' }));
  check(gone.marks.every(n => n === 0) && !gone.ops.includes('texture') && /gone with its step/.test(gone.say), `a texture step taken away in cam takes its mark, and says so (${JSON.stringify(gone)})`);

  // PIERCE (advanced mode only): a texture mark and a pierce mark on one part. Basic mode offers no
  // pierce; in advanced mode the fill row makes a rectangle mark kerfs, right through with bridges.
  await page.evaluate(() => { localStorage.setItem('swarf-expert', '0'); document.body.classList.remove('swarf-expert'); window.kiri.api.platform.delete(window.kiri.api.widgets.all()[1]); });
  await wait(400);
  await page.click('#swarf-step-tex');
  await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 5000 });
  await page.evaluate(() => { const S = window.__swarfTex.state(), r = document.getElementById('tx-svg').getBoundingClientRect(); S.k = 2.5; S.ox = r.width / 2 - 150; S.oy = r.height / 2 + 100; S.sel = 0; S.mark = -1; });
  const P0 = await page.evaluate(() => { const S = window.__swarfTex.state(), p = S.parts[0]; return [p.pos[0] + p.box[0], p.pos[1] + p.box[1]]; });
  await page.keyboard.press('r');
  await drag(page, [P0[0] + 10, P0[1] + 10], [P0[0] + 45, P0[1] + 30]);
  const basicFill = await page.evaluate(() => !!document.querySelector('#tx-card .tx-fill'));
  const first = await page.evaluate(() => { const S = window.__swarfTex.state(); return S.parts.map(p => p.marks.map(m => m.region.data.reduce((a, v) => a + v, 0))); });
  check(!basicFill && first[0].length === 1 && first[0][0] > 1000, `basic mode: a rectangle marks the part, and the card offers no pierce (${JSON.stringify(first)})`);
  await page.evaluate(() => { localStorage.setItem('swarf-expert', '1'); document.body.classList.add('swarf-expert'); });
  await page.evaluate(() => document.getElementById('tx-new').click());   // the toast from the step taken away may still sit over the card
  await page.keyboard.press('r');
  const PR = [P0[0] + 60, P0[1] + 12, P0[0] + 110, P0[1] + 68];
  await drag(page, [PR[0], PR[1]], [PR[2], PR[3]]);
  await page.keyboard.press('v');
  await page.evaluate(() => [...document.querySelectorAll('#tx-card .tx-fill')].find(b => b.dataset.fill === 'pierce')?.click());
  await wait(200);
  await setField(page, 'tx-p-radius', '120');
  await setField(page, 'tx-p-skin', '0');
  await page.evaluate(() => { const d = document.querySelector('#tx-card details.tx-more'); if (d) d.open = true; });
  await setField(page, 'tx-p-bridge', '8');
  await setField(page, 'tx-p-slot', '30');
  await page.waitForFunction(() => /test strip/.test(document.getElementById('tx-card').textContent) && /About/.test(document.getElementById('tx-card').textContent), { timeout: 20000 }).catch(() => {});
  const pc = await page.evaluate(() => { const S = window.__swarfTex.state(), m = S.parts[0].marks[S.mark]; return { fill: m.fill.fill, pattern: m.fill.pattern, p: m.fill.params, bit: m.fill.bit, card: document.getElementById('tx-card').textContent, cuts: document.querySelectorAll('#tx-svg .tx-cut').length }; });
  check(pc.fill === 'pierce' && pc.pattern === 'kerf' && pc.p.skin === 0 && pc.p.bridge === 8 && pc.bit && pc.bit.type === 'flat' && /test strip/.test(pc.card) && pc.cuts > 0, `advanced mode: the fill row makes it pierce: kerfs right through, bridges 8 mm, a ${pc.bit && pc.bit.name} straight bit, the cuts drawn, "a starting point: cut a test strip"`);
  await page.screenshot({ path: `${OUT}-pierce.png` });
  await page.click('#tx-done');
  await wait(1000);
  k = await tex(page);
  const types = k.ops.map(o => o.split(':')[0]);
  const fills = await page.evaluate(() => window.kiri.api.widgets.all().map(w => (w.meta.tex || []).map(m => `${m.fill.fill}:${m.id}`)));
  check(types.join() === 'texture,pierce,outline' && k.labels.some(l => /^pierce: kerfs on /.test(l)), `the pierce step after the texture, before the outline (${types}; ${k.labels.filter(Boolean).join(' | ')}; marks ${JSON.stringify(fills)}; ops ${k.ops})`);
  // auto tabs keep out of the pierced area
  const tabs = await page.evaluate(PR => { const a = window.kiri.api, w = a.widgets.all()[0], p = w.track.pos, plan = window.__swarfAutoTabs.plan([w])[0]; return { n: plan.kept.length, inside: plan.kept.filter(t => t.x + p.x > PR[0] - 10 && t.x + p.x < PR[2] + 10 && t.y + p.y > PR[1] - 10 && t.y + p.y < PR[3] + 10).length, tabs: plan.kept.map(t => [+(t.x + p.x).toFixed(1), +(t.y + p.y).toFixed(1)]) }; }, PR);
  check(tabs.n > 0 && tabs.inside === 0, `auto tabs keep out of the pierced area (${tabs.n} tabs, ${tabs.inside} near it: ${JSON.stringify(tabs.tabs)})`);
  // the file: the kerfs cut right through, inside the mark
  ({ pv, gc } = await paths(page));
  const pt = await page.evaluate(() => { const s = window.kiri.api.conf.get(), op = s.process.ops.find(o => o.type === 'pierce'); return s.tools.find(t => t.id === op.tool).number; });
  const PM = moves(gc).filter(q => q.tool === pt && q.cut && q.z < -0.05);
  const pxs = PM.map(q => q.x), pys = PM.map(q => q.y), pspan = [Math.max(...pxs) - Math.min(...pxs), Math.max(...pys) - Math.min(...pys)], plo = Math.min(...PM.map(q => q.z));
  check(pv === 'preview.end' && PM.length > 10 && plo <= -18.99 && plo >= -19.02 && pspan[0] <= 50 && pspan[1] <= 56, `the file cuts the kerfs right through (to Z ${plo}), inside the mark (${pspan.map(v => v.toFixed(1)).join(' x ')} within 50 x 56)`);
  await page.evaluate(() => { const b = [...document.querySelectorAll('.swarf-step, #act-animate, button')].find(e => /^\s*simulate\s*$/i.test(e.textContent)); b && b.click(); });
  await wait(5000);
  await page.screenshot({ path: `${OUT}-pierce-sim.png` });
  check(!errors.length, `simulate plays the pierce step with no error${errors.length ? ` (${errors[0]})` : ''}`);
  await page.evaluate(() => window.kiri.api.view.set_arrange()); await wait(600);

  // POINTS (H): the texture mark's edge as points; its rightmost dragged 10 mm right, the paint and
  // the file's texture follow it there
  const ttool = await page.evaluate(() => { const s = window.kiri.api.conf.get(), op = s.process.ops.find(o => o.type === 'texture'); return s.tools.find(t => t.id === op.tool).number; });
  const spanOf = gc => { const T0 = moves(gc).filter(q => q.tool === ttool && q.cut && q.z < -0.05), xs = T0.map(q => q.x); return { n: T0.length, w: Math.max(...xs) - Math.min(...xs), x1: Math.max(...xs) }; };
  const before = spanOf(gc);
  await page.click('#swarf-step-tex');
  await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 5000 });
  await page.evaluate(() => { const S = window.__swarfTex.state(), r = document.getElementById('tx-svg').getBoundingClientRect(); S.k = 2.5; S.ox = r.width / 2 - 150; S.oy = r.height / 2 + 100; S.sel = 0; S.mark = S.parts[0].marks.findIndex(m => m.fill.fill === 'texture'); });
  await page.keyboard.press('h');
  const pts = await page.evaluate(() => { const S = window.__swarfTex.state(), p = S.parts[0], m = p.marks[S.mark]; const g = m.region; let x1 = -Infinity; for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) if (g.data[j * g.nx + i]) x1 = Math.max(x1, g.x0 + (i + 1) * g.res); const H = [...document.querySelectorAll('#tx-svg rect.sd-pt')].map(r => { const b = r.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }); return { n: H.length, right: H.sort((a, b) => b[0] - a[0])[0], x1: x1 + p.pos[0], curve: !!document.querySelector('#tx-svg path.tx-curve'), card: document.getElementById('tx-say').textContent }; });
  check(pts.n >= 4 && pts.curve && new RegExp(`fitted to ${pts.n} points`).test(pts.card), `points (H): the mark's edge shows ${pts.n} points on its curve, fitted to the paint ("${pts.card}")`);
  await page.mouse.move(pts.right[0], pts.right[1]); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(pts.right[0] + 25 * i / 10, pts.right[1]); await wait(20); }
  await page.mouse.up(); await wait(300);
  const after = await page.evaluate(() => { const S = window.__swarfTex.state(), p = S.parts[0], m = p.marks[S.mark], g = m.region; let x1 = -Infinity; for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) if (g.data[j * g.nx + i]) x1 = Math.max(x1, g.x0 + (i + 1) * g.res); return x1 + p.pos[0]; });
  check(Math.abs(after - pts.x1 - 10) < 1.5, `dragging the rightmost point 10 mm takes the mark's edge there (${pts.x1.toFixed(1)} → ${after.toFixed(1)})`);
  await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta');
  const undone = await page.evaluate(() => { const S = window.__swarfTex.state(), p = S.parts[0], m = p.marks[S.mark], g = m.region; let x1 = -Infinity; for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) if (g.data[j * g.nx + i]) x1 = Math.max(x1, g.x0 + (i + 1) * g.res); return x1 + p.pos[0]; });
  check(Math.abs(undone - pts.x1) < 0.01, `⌘Z puts the edge back (${undone.toFixed(1)})`);
  // T3: arrows move the picked point, as DRAW's do (5 presses: 5 mm)
  const pick1 = await page.evaluate(() => [...document.querySelectorAll('#tx-svg rect.sd-pt')].map(r => { const b = r.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }).sort((a, b) => b[0] - a[0])[0]);
  await page.mouse.click(pick1[0], pick1[1]); await wait(100);
  for (let i = 0; i < 5; i++) { await page.keyboard.press('ArrowRight'); await wait(60); }
  const edgeX = () => page.evaluate(() => { const S = window.__swarfTex.state(), p = S.parts[0], m = p.marks[S.mark], g = m.region; let x1 = -Infinity; for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) if (g.data[j * g.nx + i]) x1 = Math.max(x1, g.x0 + (i + 1) * g.res); return x1 + p.pos[0]; });
  const arrowed = await edgeX();
  check(Math.abs(arrowed - pts.x1 - 5) < 1, `arrows move the picked point: 5 presses, the edge 5 mm out (${pts.x1.toFixed(1)} → ${arrowed.toFixed(1)})`);
  for (let i = 0; i < 5; i++) { await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta'); }
  // T2: a point dragged far across the mark stops where the edge would cross, and stays there
  const pick2 = await page.evaluate(() => { const R = [...document.querySelectorAll('#tx-svg rect.sd-pt')].map(r => { const b = r.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }); return { right: R.sort((a, b) => b[0] - a[0])[0], left: R.sort((a, b) => a[0] - b[0])[0] }; });
  const startX = await edgeX(), startCells = await page.evaluate(() => { const S = window.__swarfTex.state(); return S.parts[0].marks[S.mark].region.data.reduce((a, v) => a + v, 0); });
  await page.mouse.move(pick2.right[0], pick2.right[1]); await page.mouse.down();
  for (let i = 1; i <= 30; i++) { await page.mouse.move(pick2.right[0] + (pick2.left[0] - 60 - pick2.right[0]) * i / 30, pick2.right[1]); await wait(15); }
  await page.mouse.up(); await wait(300);
  const landed = await page.evaluate(() => { const S = window.__swarfTex.state(), m = S.parts[0].marks[S.mark]; return { say: document.getElementById('tx-say').textContent, cross: window.SwarfTexCore.curvesCross(m.curve), cells: m.region.data.reduce((a, v) => a + v, 0) }; });
  const landedX = await edgeX();
  check(/stopped where the edge would have crossed/i.test(landed.say) && !landed.cross && landed.cells > 0 && landed.cells !== startCells, `a drag that would cross lands at its last good place, not back at the start, said ("${landed.say}"; ${startCells} → ${landed.cells} cells)`);
  await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta');
  // drag it again, keep it, and the file's texture follows
  const pts2 = await page.evaluate(() => [...document.querySelectorAll('#tx-svg rect.sd-pt')].map(r => { const b = r.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }).sort((a, b) => b[0] - a[0])[0]);
  await page.mouse.move(pts2[0], pts2[1]); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(pts2[0] + 25 * i / 10, pts2[1]); await wait(20); }
  await page.mouse.up(); await wait(300);
  await page.click('#tx-done'); await wait(800);
  ({ pv, gc } = await paths(page));
  const grown = spanOf(gc);
  check(pv === 'preview.end' && grown.x1 - before.x1 > 6 && grown.x1 - before.x1 < 13, `the file's texture follows the dragged point (its far edge ${before.x1.toFixed(1)} → ${grown.x1.toFixed(1)})`);

  // MAKE IT A PART / A HOLE: the texture mark becomes a part of its own beside its part (DRAW's done
  // makes it, the mark goes); a new rectangle mark becomes a hole cut through the part
  const before2 = await page.evaluate(() => window.kiri.api.widgets.all().length);
  await page.click('#swarf-step-tex');
  await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 5000 });
  await page.evaluate(() => { const S = window.__swarfTex.state(); S.sel = 0; S.mark = S.parts[0].marks.findIndex(m => m.fill.fill === 'texture'); });
  await page.keyboard.press('v');
  const mk2 = await page.evaluate(() => { const S = window.__swarfTex.state(), p = S.parts[0], m = p.marks[S.mark], g = m.region; let b = [Infinity, Infinity, -Infinity, -Infinity]; for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) if (g.data[j * g.nx + i]) { const x = g.x0 + (i + 0.5) * g.res, y = g.y0 + (j + 0.5) * g.res; b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)]; } return { id: m.id, w: b[2] - b[0], h: b[3] - b[1], btn: !!document.getElementById('tx-as-part') }; });
  await page.evaluate(() => document.getElementById('tx-as-part').click());
  await page.waitForFunction(() => window.__swarfDraw.state(), { timeout: 5000 });
  const inDraw = await page.evaluate(() => { const S = window.__swarfDraw.state(), p = S.parts[S.sel]; return { name: p && p.name, fresh: p && !p.w, say: document.getElementById('sd-say').textContent }; });
  check(mk2.btn && inDraw.fresh && /a part from the mark's outline/.test(inDraw.say), `make it a part: DRAW opens with the new part picked ("${inDraw.say}")`);
  await page.click('#sd-done'); await wait(1500);
  const madeP = await page.evaluate(id => { const a = window.kiri.api, ws = a.widgets.all(); const w = ws[ws.length - 1], g = w.mesh.geometry; g.computeBoundingBox(); const b = g.boundingBox; return { n: ws.length, w: b.max.x - b.min.x, h: b.max.y - b.min.y, t: b.max.z - b.min.z, gone: ws.every(x => !(x.meta.tex || []).some(m => m.id === id)), ops: a.conf.get().process.ops.map(o => o.type) }; }, mk2.id);
  check(madeP.n === before2 + 1 && Math.abs(madeP.w - mk2.w) < 1.5 && Math.abs(madeP.h - mk2.h) < 1.5 && Math.abs(madeP.t - 19) < 0.05 && madeP.gone && !madeP.ops.includes('texture'), `done: a new part with the mark's outline (${madeP.w.toFixed(1)} x ${madeP.h.toFixed(1)} x ${madeP.t.toFixed(1)}, the mark ${mk2.w.toFixed(1)} x ${mk2.h.toFixed(1)}); the mark and its step are gone (${madeP.ops})`);
  // a rectangle mark inside the part, made a hole (the new part put away, so the file holds one part)
  await page.evaluate(() => { const a = window.kiri.api, ws = a.widgets.all(); a.platform.delete(ws[ws.length - 1]); });
  await wait(500);
  await page.click('#swarf-step-tex');
  await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 5000 });
  await page.evaluate(() => { const S = window.__swarfTex.state(), r = document.getElementById('tx-svg').getBoundingClientRect(); S.k = 2.5; S.ox = r.width / 2 - 150; S.oy = r.height / 2 + 100; S.sel = S.parts.findIndex(p => /^rectangle 1$/.test(p.name)); S.mark = -1; });
  const P1 = await page.evaluate(() => { const S = window.__swarfTex.state(), p = S.parts[S.sel]; return [p.pos[0] + p.box[0], p.pos[1] + p.box[1]]; });
  await page.keyboard.press('r');
  await drag(page, [P1[0] + 15, P1[1] + 45], [P1[0] + 40, P1[1] + 70]);
  await page.keyboard.press('v');
  await page.evaluate(() => document.getElementById('tx-as-hole').click());
  await page.waitForFunction(() => window.__swarfDraw.state(), { timeout: 5000 });
  const hd = await page.evaluate(() => ({ say: document.getElementById('sd-say').textContent }));
  check(/is cut from rectangle 1/.test(hd.say), `make it a hole: DRAW cuts it from the part ("${hd.say}")`);
  await page.click('#sd-done'); await wait(1500);
  ({ pv, gc } = await paths(page));
  const otool = await page.evaluate(() => { const s = window.kiri.api.conf.get(), op = s.process.ops.find(o => o.type === 'outline'); return s.tools.find(t => t.id === op.tool).number; });
  const deep = moves(gc).filter(q => q.tool === otool && q.cut && q.z <= -18.9);
  // the hole's own cut: the outline's through-cut points well inside the part's outer cut
  const ob = [Math.min(...deep.map(q => q.x)), Math.min(...deep.map(q => q.y)), Math.max(...deep.map(q => q.x)), Math.max(...deep.map(q => q.y))];
  const inner = deep.filter(q => q.x > ob[0] + 8 && q.x < ob[2] - 8 && q.y > ob[1] + 8 && q.y < ob[3] - 8);
  const ib = inner.length ? [Math.max(...inner.map(q => q.x)) - Math.min(...inner.map(q => q.x)), Math.max(...inner.map(q => q.y)) - Math.min(...inner.map(q => q.y))] : [0, 0];
  check(pv === 'preview.end' && inner.length > 3 && Math.abs(ib[0] - ib[1]) < 2 && ib[0] > 15 && ib[0] < 26, `done: the file cuts the hole right through (${inner.length} cuts at Z -19, ${ib.map(v => v.toFixed(1)).join(' x ')} inside the 25 x 25 hole, the bit's center)`);
  await page.evaluate(() => { localStorage.setItem('swarf-expert', '0'); document.body.classList.remove('swarf-expert'); });
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `tex: ${bad.length} failed, ${errors.length} page errors` : 'tex: ok');
process.exit(bad.length || errors.length ? 1 : 0);
