// TEX, through to the file. A 120 x 80 part, 19 mm thick, with an outline step: TEX opens from
// the step row (the row folds, tex lit), the brush paints a mark across the part, the card picks
// ocean waves 2 mm deep; done leaves TEX, keeps the mark on the part and adds one texture step
// before the outline. The exported file cuts the texture inside the painted stroke, never below
// 2 mm, before the outline cuts the part free; after a reload the mark, the step and the cut are
// all still there. A copy of the part shares the step; Escape and the cam step both leave TEX.
//   node tools/probe_tex.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME || '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
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
  // the card: ocean waves, 2 mm deep, the 1/4 in ball
  await setSelect(page, 'tx-pat', 'waves');
  await setField(page, 'tx-depth', '2');
  await setSelect(page, 'tx-bit', 'ball14');
  await page.waitForFunction(() => /About .* to cut/.test(document.getElementById('tx-card').textContent), { timeout: 20000 }).catch(() => {});
  st = await page.evaluate(() => { const S = window.__swarfTex.state(), m = S.parts[S.sel].marks[S.mark]; return { pattern: m.fill.pattern, depth: m.fill.depth, tool: m.fill.tool, card: document.getElementById('tx-card').textContent, img: !!document.querySelector('#tx-svg image.tx-mark') }; });
  check(st.pattern === 'waves' && st.depth === 2 && st.tool === 'ball14' && /About .* to cut/.test(st.card) && st.img, `the card fills the mark: ${st.pattern}, ${st.depth} mm, ${st.tool}; "${(/About [^.]*/.exec(st.card) || [''])[0]}"; the mark drawn on the board`);
  await page.screenshot({ path: `${OUT}-board.png` });
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
    return { n: cutsT.length, lo, span, before: firstO < 0 || lastT < firstO, outlineDeep: Math.min(...O.map(q => q.z)) };
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

  // TEX opens with the mark; the cam step leaves it, as done does
  await page.click('#swarf-step-tex');
  await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 5000 });
  const again = await page.evaluate(() => window.__swarfTex.state().parts[0].marks.map(m => m.fill.pattern));
  check(again.join() === 'waves', `TEX opens with the mark (${again})`);
  await page.click('#swarf-step-cam');
  await wait(400);
  check(!(await page.evaluate(() => !!window.__swarfTex.state())), 'the cam step leaves TEX');
  // with nothing changed, Escape leaves at once
  await page.click('#swarf-step-tex');
  await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 5000 });
  await page.keyboard.press('Escape');
  await wait(200);
  check(!(await page.evaluate(() => !!window.__swarfTex.state())), 'Escape leaves TEX when nothing changed');

  // a copy of the part keeps the mark, and the same step cuts both
  await page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all()[0]; a.platform.deselect(); a.platform.select(w); a.selection.duplicate(); });
  await wait(800);
  k = await tex(page);
  check(k.ws.length === 2 && k.ws.every(w => w.marks.length === 1 && w.marks[0].id === mk.id) && k.ops.filter(o => o.startsWith('texture')).length === 1 && k.labels.some(l => /^texture: ocean waves on .*, /.test(l)), `a copy shares the mark and its one step (${k.labels.join(' | ')})`);
  ({ pv, gc } = await paths(page));
  const J3 = judge(gc);
  check(pv === 'preview.end' && J3.n > J.n * 1.8 && J3.lo >= -2.001, `the step cuts both parts (${J3.n} cuts, lowest ${J3.lo})`);
  // the concerns: a texture deeper than the board is said
  const said = await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) for (const m of w.meta.tex) m.fill.depth = 25; a.conf.save(); return [...document.querySelectorAll('#swarf-concerns-body .swarf-concern')].map(c => c.textContent).filter(t => /texture/.test(t)); });
  check(said.some(t => /cut through/.test(t)), `concerns say a texture deeper than the board (${said[0] && said[0].slice(0, 90)}…)`);
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `tex: ${bad.length} failed, ${errors.length} page errors` : 'tex: ok');
process.exit(bad.length || errors.length ? 1 : 0);
