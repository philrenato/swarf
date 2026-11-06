// V-carve from one route (review 105 F3, F14, M4; Phil 11-06): draw › text on a board, the words field
// taking the typing at once, carve into the board with a V-bit picked by name; done makes a v-carve
// step before the outline and no letter parts; the words come back in draw, changed, and through a
// reload; a plain part of its own stays possible. Then the file itself, from known shapes: the deepest
// Z is width / 2 / tan(half angle), or the bit's cone, the flat depth or the board, whichever comes
// first; every feed keeps the cone's rim inside the outline; the router is on.
// Everything about a cut is read from the exported .sbp, through the parser control reads it with.
// judge() is run first on doctored files: a gate that cannot fail says nothing.
//   OUT=/some/dir node tools/probe_vcarve.mjs [url]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-vcarve';
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };

// A file against what it should have cut. loops: the outline in file coordinates; tan: the bit's;
// want: the deepest Z, positive; thick: the board. Returns what is wrong, in words. The parser's own
// checks come from the page; rapidAcross (from 108) is checked here too, for a build without it.
function judge(moves, P, { loops, tan, want, thick, tol = 0.03, rim = 0.12 }) {
  const wrong = [], feeds = moves.filter(m => !m.rapid && Math.min(m.z, m.z0) < -1e-6);
  if (!feeds.length) return ['no feed moves into the board'];
  let deep = 0;
  for (const m of feeds) deep = Math.max(deep, -m.z, -m.z0);
  if (Math.abs(deep - want) > tol) wrong.push(`deepest ${deep.toFixed(3)}, wanted ${want.toFixed(3)}`);
  if (thick > 0 && deep > thick + 1e-3) wrong.push(`below the board: ${deep.toFixed(3)} of ${thick}`);
  if (P.on === 0) wrong.push('the router is never started');
  if (P.routerOff) wrong.push(`router off at line ${P.routerOff.line}`);
  if (P.rapid) wrong.push(`a rapid across the board at line ${P.rapid.line}`);
  const inPoly = (x, y) => { let c = false; for (const L of loops) for (let i = 0, j = L.length - 1; i < L.length; j = i++) if ((L[i][1] > y) !== (L[j][1] > y) && x < (L[j][0] - L[i][0]) * (y - L[i][1]) / (L[j][1] - L[i][1]) + L[i][0]) c = !c; return c; };
  const distTo = (x, y) => { let best = Infinity; for (const L of loops) for (let i = 0, j = L.length - 1; i < L.length; j = i++) { const ax = L[j][0], ay = L[j][1], ex = L[i][0] - ax, ey = L[i][1] - ay, t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey || 1))); best = Math.min(best, Math.hypot(x - ax - t * ex, y - ay - t * ey)); } return best; };
  let out = 0, over = 0, worst = 0;
  for (const m of feeds) {
    const n = Math.max(1, Math.ceil(Math.hypot(m.x - m.x0, m.y - m.y0) / 0.5));
    for (let k = 0; k <= n; k++) {
      const x = m.x0 + (m.x - m.x0) * k / n, y = m.y0 + (m.y - m.y0) * k / n, z = m.z0 + (m.z - m.z0) * k / n;
      if (z >= -1e-6) continue;
      if (!inPoly(x, y)) { out++; continue; }
      const r = -z * tan, gap = r - distTo(x, y);
      if (gap > worst) worst = gap;
      if (gap > rim) over++;
    }
  }
  if (out) wrong.push(`${out} points of the moves outside the outline`);
  if (over) wrong.push(`${over} points where the cone's rim passes the outline (worst ${worst.toFixed(3)} mm)`);
  return wrong;
}
// the gate fails when it should: doctored files
{
  const bar = [[[0, 0], [60, 0], [60, 10], [0, 10]]];
  const good = [{ x0: 5, y0: 5, z0: 0, x: 55, y: 5, z: -5, rapid: false, line: 1 }];
  const o = { loops: bar, tan: 1, want: 5, thick: 19 };
  check(judge(good, {}, { ...o, rim: 0.2 }).length === 0, 'judge: the true cut passes');
  check(judge(good, {}, { ...o, want: 4 }).some(w => /deepest/.test(w)), 'judge: a wrong depth fails');
  check(judge([{ ...good[0], z: -8 }], {}, { ...o, want: 8, thick: 6 }).some(w => /below the board/.test(w)), 'judge: below the board fails');
  check(judge(good, { routerOff: { line: 1 } }, o).some(w => /router/.test(w)), 'judge: router off fails');
  check(judge(good, { on: 0 }, o).some(w => /never started/.test(w)), 'judge: a file that never starts the router fails');
  check(judge(good, { rapid: { line: 1 } }, o).some(w => /rapid/.test(w)), 'judge: a rapid across the board fails');
  check(judge([{ ...good[0], y0: 12, y: 12 }], {}, o).some(w => /outside/.test(w)), 'judge: a move outside the outline fails');
  check(judge([{ ...good[0], y0: 2, y: 2, z0: -5 }], {}, o).some(w => /rim/.test(w)), 'judge: a cone past the outline fails');
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfDraw && window.__swarfTex && window.SwarfTexCore && window.SwarfRunParse), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  const board = (w, h, t) => page.evaluate((w, h, t) => {
    const a = window.kiri.api;
    for (const x of a.widgets.all()) a.platform.delete(x);
    const s = a.conf.get(); s.process.ops = []; a.conf.save();
    a.platform.load_svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}"/></svg>`, 'sign', { depth: t, soup: true, dpi: 0 });
  }, w, h, t);
  const openDraw = async () => {
    await page.click('#swarf-step-draw');
    await page.waitForFunction(() => window.__swarfDraw.state(), { timeout: 8000 });
    await page.evaluate(() => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(), p = S.parts.find(p => p.w); if (!p) return; const q = p.w.track.pos, g = p.w.getBoundingBox(); S.k = 2; S.ox = r.width / 2 - q.x * S.k; S.oy = r.height / 2 + q.y * S.k; window.__swarfDraw.render(); });
  };
  const px = (x, y) => page.evaluate((x, y) => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(); return [r.left + S.ox + x * S.k, r.top + S.oy - y * S.k]; }, x, y);
  // the bed point of a spot on the board, measured from the board's front left corner
  const onBoard = (u, v) => page.evaluate((u, v) => { const w = window.kiri.api.widgets.all()[0], b = w.getBoundingBox(), g = w.mesh.geometry; g.computeBoundingBox(); return [w.track.pos.x + g.boundingBox.min.x + u, w.track.pos.y + g.boundingBox.min.y + v]; }, u, v);
  const setField = (id, v) => page.evaluate((id, v) => { const i = document.getElementById(id); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); }, id, v);
  const exportFile = () => page.evaluate(() => new Promise(res => { window.kiri.api.function.export(t => res(t)); setTimeout(() => res(null), 120000); }));
  const parsed = text => page.evaluate(text => {
    const P = window.SwarfRunParse, p = P.parse(text), rapidAt = (P.rapidAcross ? P.rapidAcross(p) : p.moves.find(m => m.rapid && Math.min(m.z, m.z0) < -0.05 && Math.hypot(m.x - m.x0, m.y - m.y0) > 0.05)) || null;
    return { moves: p.moves, routerOff: P.routerOffCut(p), rapid: rapidAt, units: p.units, on: p.events.filter(e => e.kind === 'spindle-on' || (e.kind === 'output' && e.value[0] === 1 && e.value[1] === 1)).length, unsupported: p.unsupported.length };
  }, text);

  // ── the route: draw › text ─────────────────────────────────────
  await board(240, 100, 19);
  await wait(1200);
  await openDraw();
  await page.keyboard.press('t');
  await page.waitForFunction(() => window.__swarfDraw.text.font, { timeout: 15000 }).catch(() => {});
  await wait(200);
  const first = await page.evaluate(() => ({ mode: document.getElementById('sd-mode')?.value, opts: [...(document.getElementById('sd-mode')?.options || [])].map(o => o.textContent), bits: [...(document.getElementById('sd-vbit')?.options || [])].map(o => o.textContent) }));
  check(first.mode === 'carve', `text starts as a carve (${first.mode})`);
  check(first.opts.some(o => o === 'carve into sign') && first.opts.includes('a part of its own') && first.opts.includes('a hole if inside') && first.opts.includes('cut from the part') && first.opts.includes('add to the part'), `the card: the same choices as shapes, and carve into the board by name (${first.opts})`);
  check(first.bits.some(b => /90°/.test(b)) && first.bits.some(b => /60°/.test(b)), `the 60° and 90° V-bits by name (${first.bits})`);
  await setField('sd-th', '40');
  await page.evaluate(() => document.getElementById('sd-th').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  const [bx, by] = await onBoard(30, 30), [cx, cy] = await px(bx, by);
  await page.mouse.move(cx + 20, cy + 20); await page.mouse.move(cx, cy);
  await page.mouse.click(cx, cy);
  await page.waitForFunction(() => { const S = window.__swarfDraw.state(); return S.tool === 'select' && S.parts[S.sel] && S.parts[S.sel].text; }, { timeout: 8000 }).catch(() => {});
  const focus = await page.evaluate(() => { const e = document.activeElement; return { id: e && e.id, all: e && e.selectionStart === 0 && e.selectionEnd === e.value.length && e.value.length > 0 }; });
  check(focus.id === 'sd-str' && focus.all, `after placing, the words field has focus, all selected (${JSON.stringify(focus)})`);
  await page.keyboard.type('HI');   // real keys: "typing goes nowhere" was the bug
  await wait(150);
  const typed = await page.evaluate(() => { const S = window.__swarfDraw.state(), p = S.parts[S.sel]; return { str: p.text.str, name: p.name, n: p.curves.length, carve: !!p.carve, field: document.getElementById('sd-str').value, focus: document.activeElement.id, over: p.over, say: document.getElementById('sd-say').textContent, tool: S.tool }; });
  check(typed.str === 'HI' && typed.field === 'HI' && typed.n === 2 && typed.focus === 'sd-str' && typed.tool === 'select', `typing goes in, letter by letter (${JSON.stringify(typed)})`);
  check(typed.carve && !typed.over, 'on the board it is a carve, with no "overlaps" warning');
  await page.screenshot({ path: `${OUT}-draw.png` });
  await page.click('#sd-done');
  await wait(1200);
  const made = await page.evaluate(() => { const a = window.kiri.api, ws = a.widgets.all(); return { n: ws.length, names: ws.map(w => w.meta.file), ops: a.conf.get().process.ops.map(o => o.type + ':' + (o.texlabel || '')), mark: (ws[0].meta.tex || []).map(m => ({ fill: m.fill.fill, words: m.drawn && m.drawn.text && m.drawn.text.str })) }; });
  check(made.n === 1, `no letter parts: one board on the bed (${made.names})`);
  check(made.mark.length === 1 && made.mark[0].fill === 'vcarve' && made.mark[0].words === 'HI', `a v-carve mark with its words on the board (${JSON.stringify(made.mark)})`);
  check(made.ops.some(o => /^vcarve:v-carve: HI on sign/.test(o)), `a v-carve step (${made.ops})`);
  // an outline step: the v-carve stays ahead of it
  await page.evaluate(() => { const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(600);
  const order = await page.evaluate(() => window.kiri.api.conf.get().process.ops.map(o => o.type).filter(t => t === 'vcarve' || t === 'outline'));
  check(order.join() === 'vcarve,outline', `the v-carve comes before the outline (${order})`);
  const opv = await page.evaluate(() => { const o = window.kiri.api.conf.get().process.ops.find(o => o.type === 'vcarve'); return { rate: o.rate, plunge: o.plunge, down: o.down, spindle: o.spindle, preset: !!o.preset }; });
  check(opv.preset && opv.rate > 0 && opv.plunge > 0 && opv.spindle > 0 && opv.down > 1 && opv.down < 4, `its feeds come from the material, its pass from the bit's depth, not its width (${JSON.stringify(opv)})`);
  let text = await exportFile();
  let P = await parsed(text);
  check(P.unsupported === 0 && P.on > 0 && !P.routerOff && !P.rapid, `the words' file: router on (${P.on} starts), none off in a cut, no rapid across the board, the parser reads it all`);
  // simulate: a carved word, to look at
  await page.evaluate(() => { const a = window.kiri.api, s = a.conf.get(); s.process.ops = s.process.ops.filter(o => o.type !== 'outline'); a.conf.save(); document.getElementById('act-paths')?.click(); });
  await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', () => res()); setTimeout(res, 120000); }));
  await page.evaluate(() => { const b = [...document.querySelectorAll('.swarf-step, #act-animate, button')].find(e => /^\s*simulate\s*$/i.test(e.textContent)); b && b.click(); });
  await page.waitForFunction(() => window.__swarfSimStock, { timeout: 30000 }).catch(() => {});
  await wait(800);
  await page.evaluate(() => { window.__swarfCustomSpeed = 4000; window.dispatchEvent(new Event('swarf.speed.custom')); });
  let last = '', still = 0;
  for (let i = 0; i < 200 && still < 3; i++) {
    await wait(1000);
    const sig = await page.evaluate(() => { const A = window.__swarfSimStock && window.__swarfSimStock.geometry.attributes.position.array; if (!A) return ''; let s = 0; for (let k = 2; k < A.length; k += 97) s += A[k]; return s.toFixed(3); });
    if (sig && sig === last) still++; else still = 0;
    last = sig;
  }
  const sim = await page.evaluate(() => { const A = window.__swarfSimStock && window.__swarfSimStock.geometry.attributes.position.array; if (!A) return null; let top = -Infinity, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (let k = 0; k < A.length; k += 3) { top = Math.max(top, A[k + 2]); x0 = Math.min(x0, A[k]); x1 = Math.max(x1, A[k]); y0 = Math.min(y0, A[k + 1]); y1 = Math.max(y1, A[k + 1]); } let cut = 0, deep = 0; for (let k = 0; k < A.length; k += 3) { if (A[k] < x0 + 2 || A[k] > x1 - 2 || A[k + 1] < y0 + 2 || A[k + 1] > y1 - 2) continue; const d = top - A[k + 2]; if (d > 0.3) cut++; if (d > deep) deep = d; } return { deep: +deep.toFixed(2), cut, cells: A.length / 3, step: +Math.hypot(A[3] - A[0], A[4] - A[1]).toFixed(3) }; });
  check(sim && sim.cut > 50 && sim.deep > 2 && sim.deep < 6.5, `simulate cuts the word into the board, no deeper than the bit's cone (${JSON.stringify(sim)})`);
  await page.screenshot({ path: `${OUT}-sim.png` });
  // from above and close, at twice the pixels, to look at the letters
  await page.evaluate(() => { const v = window.kiri.api.space.view; if (v.top) v.top(); if (v.setZoom) v.setZoom(false, 0.25); }).catch(() => {});
  await wait(1200);
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await wait(1200);
  await page.screenshot({ path: `${OUT}-sim-top.png`, clip: { x: 340, y: 100, width: 760, height: 620 } });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.evaluate(() => { const b = [...document.querySelectorAll('.swarf-step, #act-arrange, button')].find(e => /^\s*(arrange|cam)\s*$/i.test(e.textContent)); b && b.click(); });
  await wait(1500);

  // ── the words come back, changed ───────────────────────────────
  await openDraw();
  const back = await page.evaluate(() => { const S = window.__swarfDraw.state(), i = S.parts.findIndex(p => p.carve); S.sel = i; window.__swarfDraw.render(); return { i, str: i >= 0 && S.parts[i].text && S.parts[i].text.str, field: document.getElementById('sd-str')?.value, mode: document.getElementById('sd-mode')?.value, opt: [...(document.getElementById('sd-mode')?.options || [])].find(o => o.value === 'carve')?.textContent }; });
  check(back.i >= 0 && back.str === 'HI' && back.field === 'HI' && back.mode === 'carve' && back.opt === 'carve into sign', `reopening draw, the words are words (${JSON.stringify(back)})`);
  await setField('sd-str', 'HOT');
  await wait(100);
  await page.click('#sd-done');
  await wait(1200);
  const changed = await page.evaluate(() => { const a = window.kiri.api, ws = a.widgets.all(); return { n: ws.length, marks: ws[0].meta.tex.map(m => m.drawn.text.str), ops: a.conf.get().process.ops.filter(o => o.type === 'vcarve').map(o => o.texlabel) }; });
  check(changed.n === 1 && changed.marks.join() === 'HOT' && changed.ops.length === 1 && /HOT/.test(changed.ops[0]), `changed there: one mark, one step, renamed (${JSON.stringify(changed)})`);
  const before = text;
  text = await exportFile();
  check(text && text !== before, 'the file follows the changed words');
  // through a reload
  await wait(2500);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.kiri?.api?.widgets?.all().length === 1 && window.__swarfDraw && window.SwarfTexCore, { timeout: 90000, polling: 300 });
  await wait(2500);
  await openDraw();
  const reloaded = await page.evaluate(() => { const S = window.__swarfDraw.state(), p = S.parts.find(p => p.carve); return p && p.text && p.text.str; });
  check(reloaded === 'HOT', `after a reload the words are still words (${reloaded})`);
  // carve to a plain part of its own, from the same card: the mark and its step go
  await page.evaluate(() => { const S = window.__swarfDraw.state(); S.sel = S.parts.findIndex(p => p.carve); window.__swarfDraw.render(); const m = document.getElementById('sd-mode'); m.value = 'part'; m.dispatchEvent(new Event('change', { bubbles: true })); });
  await wait(100);
  await page.click('#sd-done');
  await wait(1500);
  const plain = await page.evaluate(() => { const a = window.kiri.api, ws = a.widgets.all(); return { n: ws.length, tex: ws.flatMap(w => w.meta.tex || []).length, ops: a.conf.get().process.ops.filter(o => o.type === 'vcarve').length, names: ws.map(w => w.meta.file) }; });
  check(plain.n === 4 && plain.tex === 0 && plain.ops === 0, `a part of its own: letter parts, no mark, no step (${JSON.stringify(plain)})`);
  // on an empty bed the text tool makes a plain part still
  await page.evaluate(() => { const a = window.kiri.api; for (const x of a.widgets.all()) a.platform.delete(x); });
  await wait(300);
  await page.click('#swarf-step-draw');
  await page.waitForFunction(() => window.__swarfDraw.state(), { timeout: 8000 });
  await page.keyboard.press('t');
  await page.waitForFunction(() => window.__swarfDraw.text.font, { timeout: 15000 }).catch(() => {});
  const [ex, ey] = await px(100, 100);
  await page.mouse.move(ex + 10, ey + 10); await page.mouse.move(ex, ey); await page.mouse.click(ex, ey);
  await wait(300);
  const empty = await page.evaluate(() => { const S = window.__swarfDraw.state(), p = S.parts[S.sel]; return { text: p && !!p.text, carve: p && !!p.carve, say: document.getElementById('sd-say').textContent }; });
  check(empty.text && !empty.carve && /over no part/.test(empty.say), `over no part, a part of its own, and said (${JSON.stringify(empty)})`);
  await page.click('#sd-cancel');
  await wait(300);

  // ── known shapes: the file against the outline ─────────────────
  // a rectangle drawn on the board, carve into it; its place in the file is its place on the board
  async function shape({ w, h, t = 19, bit, limit = 0, name }) {
    await board(200, 100, t);
    await wait(1000);
    const a0 = 30, b0 = 30;
    await page.evaluate(() => {
      const s = window.kiri.api.conf.get();
      if (!s.tools.some(t => t.id === 9090)) s.tools.push({ id: 9090, number: 90, type: 'tapermill', name: 'V-bit 90° 2 in', metric: true, shaft_diam: 50, shaft_len: 50, flute_diam: 50, flute_len: 25, taper_angle: 45, taper_tip: 0 });
      window.kiri.api.conf.save();
    });
    await openDraw();
    await page.keyboard.press('r');
    await wait(100);
    await page.evaluate(() => { const m = document.getElementById('sd-mode'); m.value = 'carve'; m.dispatchEvent(new Event('change', { bubbles: true })); });
    await wait(100);
    await page.evaluate(({ bit, limit }) => {
      const s = document.getElementById('sd-vbit');
      if (bit) { const o = [...s.options].find(o => o.textContent === bit); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); }
      if (limit) { const l = document.getElementById('sd-vlim'); l.value = String(limit); l.dispatchEvent(new Event('change', { bubbles: true })); }
    }, { bit, limit });
    const A = await onBoard(a0, b0), B = await onBoard(a0 + w, b0 + h);
    const [p0x, p0y] = await px(A[0], A[1]), [p1x, p1y] = await px(B[0], B[1]);
    await page.mouse.move(p0x, p0y); await page.mouse.down(); await page.mouse.move((p0x + p1x) / 2, (p0y + p1y) / 2); await page.mouse.move(p1x, p1y); await page.mouse.up();
    await wait(200);
    await page.click('#sd-done');
    await wait(1200);
    const info = await page.evaluate(() => { const w = window.kiri.api.widgets.all()[0], m = (w.meta.tex || [])[0]; return { n: window.kiri.api.widgets.all().length, loop: m && m.drawn.loops[0], xf: m && m.xf, tool: m && m.fill.bit && m.fill.bit.name, g: (() => { const g = w.mesh.geometry; g.computeBoundingBox(); return [g.boundingBox.min.x, g.boundingBox.min.y]; })(), s: window.kiri.api.conf.get().stock }; });
    const txt = await exportFile();
    const p = await parsed(txt);
    return { info, p, txt };
  }
  const T90 = 1, T60 = Math.tan(30 * Math.PI / 180);
  const CASES = [
    { name: '10 mm bar, 90° 1/2 in', w: 60, h: 10, tan: T90, want: 5, bit: 'V-bit 90° 1/2' },
    { name: '20 mm bar, 90° 2 in bit', w: 60, h: 20, tan: T90, want: 10, bit: 'V-bit 90° 2 in' },
    { name: '20 mm bar, 90° 1/2 in: held at its cone', w: 60, h: 20, tan: T90, want: 6.35, bit: 'V-bit 90° 1/2' },
    { name: '20 mm bar, 2 in bit, flat depth 3', w: 60, h: 20, tan: T90, want: 3, bit: 'V-bit 90° 2 in', limit: 3 },
    { name: '10 mm bar, 60° 1/2 in', w: 60, h: 10, tan: T60, want: 5 / T60, bit: 'V-bit 60° 1/2' },
    { name: '20 mm bar, 2 in bit, 6 mm board: stops short of its bottom', w: 60, h: 20, tan: T90, want: 5.75, bit: 'V-bit 90° 2 in', t: 6 },
  ];
  for (const c of CASES) {
    const { info, p } = await shape(c);
    check(info.n === 1 && !!info.loop, `${c.name}: carved, no part of its own (${info.tool})`);
    if (!info.loop) continue;
    // the file's origin is the stock's corner: the outline in the file's frame
    const feeds = p.moves.filter(m => !m.rapid && m.z < -1e-6);
    const xs = feeds.flatMap(m => [m.x]), ys = feeds.flatMap(m => [m.y]);
    const fx0 = Math.min(...xs), fy0 = Math.min(...ys);
    // the corner branches reach the corners: the moves' box is the outline's, within a little
    const xb = Math.max(...xs) - fx0, yb = Math.max(...ys) - fy0;
    check(Math.abs(xb - c.w) < 0.4 && Math.abs(yb - c.h) < 0.4, `${c.name}: the moves reach all four corners (${xb.toFixed(2)} x ${yb.toFixed(2)})`);
    const loops = [[[fx0, fy0], [fx0 + c.w, fy0], [fx0 + c.w, fy0 + c.h], [fx0, fy0 + c.h]]];
    const wrong = judge(p.moves, p, { loops, tan: c.tan, want: c.want, thick: c.t || 19 });
    check(!wrong.length, `${c.name}: deepest ${c.want.toFixed(2)}, inside, router on${wrong.length ? ': ' + wrong.join('; ') : ''}`);
  }
  check(!errors.length, `no page errors${errors.length ? ': ' + errors[0] : ''}`);
} finally {
  await browser.close();
}
console.log(bad.length ? `vcarve: ${bad.length} failed` : 'vcarve: ok');
process.exit(bad.length ? 1 : 0);
