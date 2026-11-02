// A part flipped over and back lies flat (Phil 11-02, rectangle.swarf: a board turned a quarter, then
// flipped over X and over Y, and TEX would not paint on it, "tipped over"): it is flat again, its
// drawing lined up with its top, and TEX marks it; one flipped once lies upside down, its outline
// mirrored and still on its top; one on its side stays tipped and TEX says so where it is pressed; a
// part saved tipped by an older swarf that lies flat is lined up when TEX opens.
//   node tools/probe_flip.mjs [url]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome-path.mjs';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const errors = [];
const url = process.argv[2] || 'http://localhost:8080/kiri/';
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfTex && window.__swarfDraw), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(600);
  // an L, so a mirror shows: 80 x 50, the notch at the top right
  const L = '<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="50mm" viewBox="0 0 80 50"><path d="M0,0 H50 V20 H80 V50 H0 Z"/></svg>';
  const fresh = (svg) => page.evaluate((svg) => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); const s = a.conf.get(); s.process.ops = []; a.conf.save(); a.platform.load_svg(svg, 'L', { depth: 12.7, soup: true, dpi: 0 }); }, svg);
  // how well TEX's outline sits on the part's top: the worst distance of a top corner from it
  const fit = () => page.evaluate(() => {
    const w = window.kiri.api.widgets.all()[0], pos = w.track.pos, D = window.__swarfDraw;
    const loops = D.bedCurves(w).map(c => window.SwarfBoard.flat(c.crv, 1, 128).map(([x, y]) => [x - pos.x, y - pos.y]));
    const g = w.mesh.geometry; g.computeBoundingBox(); const P = g.attributes.position, top = [];
    for (let i = 0; i < P.count; i++) if (P.getZ(i) > g.boundingBox.max.z - 1e-3) top.push([P.getX(i), P.getY(i)]);
    let worst = 0;
    for (const p of top) { let d = Infinity; for (const Q of loops) for (let i = 0; i < Q.length; i++) { const a = Q[i], b = Q[(i + 1) % Q.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, k = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0; d = Math.min(d, Math.hypot(p[0] - a[0] - k * dx, p[1] - a[1] - k * dy)); } worst = Math.max(worst, d); }
    return { tilted: !!w.meta.tilted, worst: +worst.toFixed(3), n: top.length };
  });
  const rot = (x, y, z) => page.evaluate((x, y, z) => { const w = window.kiri.api.widgets.all()[0]; w.rotate(x, y, z); }, x, y, z);
  // paint in TEX at the part's middle: a mark is made
  const paint = async () => {
    await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); });
    await page.click('#swarf-step-tex'); await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 15000 });
    await page.keyboard.press('b'); await wait(200);
    const box = await page.evaluate(() => { const S = window.__swarfTex.state(), p = S.parts[0]; const r = document.querySelector('#tx-board, .sd-board svg, svg.sd-svg')?.getBoundingClientRect(); const part = document.querySelector('.sd-part')?.getBoundingClientRect(); return part ? { x: part.x + part.width * 0.3, y: part.y + part.height * 0.7 } : null; });
    await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x + 15, box.y + 5, { steps: 4 }); await page.mouse.up(); await wait(300);
    const r = await page.evaluate(() => { const S = window.__swarfTex.state(), p = S.parts[0]; return { marks: p.marks.filter(m => m.region.data.some(v => v)).length, said: document.getElementById('tx-say')?.textContent || '' }; });
    await page.evaluate(() => window.__swarfTex.close(false)); await wait(400);
    return r;
  };
  await fresh(L); await wait(1500);
  await rot(0, 0, Math.PI / 2); await rot(Math.PI, 0, 0); await rot(0, Math.PI, 0); await wait(300);
  let f = await fit();
  check(!f.tilted && f.worst < 0.05, `a quarter turn, flipped over X and back over Y: flat, the outline on its top (${JSON.stringify(f)})`);
  let p = await paint();
  check(p.marks === 1, `TEX paints on it (${JSON.stringify(p)})`);
  await fresh(L); await wait(1500);
  await rot(Math.PI, 0, 0); await wait(300);
  f = await fit();
  check(!f.tilted && f.worst < 0.05, `flipped once: upside down, flat, its outline mirrored onto its top (${JSON.stringify(f)})`);
  await fresh(L); await wait(1500);
  await rot(Math.PI / 2, 0, 0); await wait(300);
  f = await fit();
  check(f.tilted, 'a quarter turn over X: on its side, tipped');
  // on its side, TEX marks the face now on top (Phil 11-02: "wherever I am trying to paint is the new top")
  const strip = await page.evaluate(() => { const w = window.kiri.api.widgets.all()[0], g = w.mesh.geometry; g.computeBoundingBox(); const b = g.boundingBox; return [+(b.max.x - b.min.x).toFixed(2), +(b.max.y - b.min.y).toFixed(2)]; });
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); });
  await page.click('#swarf-step-tex'); await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 15000 });
  const face = await page.evaluate(() => { const p = window.__swarfTex.state().parts[0]; return { loops: p.loops.length, box: p.box.map(v => +v.toFixed(2)) }; });
  await page.evaluate(() => { const S = window.__swarfTex.state(), C = window.SwarfTexCore, p = S.parts[0]; const g = C.newGrid(p.box[0] - 2, p.box[1] - 2, p.box[2] + 2, p.box[3] + 2, 0.5); C.paintWhere(g, () => true, 1); const m = { id: 'side', made: 'region', region: g, xf: C.IDENTITY.slice(), fill: C.newFill('waves'), face: null, at: null, ver: 1 }; p.marks.push(m); S.sel = 0; S.mark = p.marks.length - 1; p.dirty = true; });
  // the face and rotation a fresh mark gets come from newMark; this one is claimed on done as the face on top
  await page.click('#tx-done'); await wait(1500);
  const sideMark = await page.evaluate(() => { const m = window.kiri.api.widgets.all()[0].meta.tex[0]; return { face: m.face, xf: m.xf }; });
  // the L on its side: its highest face is the 50 mm run beside the notch, the board's 12.7 thick; the
  // rest of its silhouette (80 mm) is lower and is not the top
  check(face.loops === 1 && Math.abs((face.box[2] - face.box[0]) - 50) < 0.6 && Math.abs((face.box[3] - face.box[1]) - 12.7) < 0.6 && strip[0] > 79, `on its side, TEX's part is the face on top: 50 x 12.7 of an 80 mm silhouette (${JSON.stringify(face)}, ${strip.join(' x ')})`);
  check(Array.isArray(sideMark.face) && Math.abs(Math.abs(sideMark.face[1]) - 1) < 1e-6, `the mark is on that face: the board's ${JSON.stringify(sideMark.face)}`);
  const cuts = async () => { await page.evaluate(() => window.kiri.api.function.prepare()); await wait(4000); return page.evaluate(() => { const op = window.kiri.api.conf.get().process.ops.find(o => o.type === 'texture'); return op && op.marks ? Object.values(op.marks).reduce((n, l) => n + l.length, 0) : -1; }); };
  check(await cuts() === 1, 'its texture step cuts it while that face is on top');
  // lay it flat: the mark waits; on its side again: back where it was
  await page.evaluate(() => { const a = window.kiri.api; a.view.set_arrange && a.view.set_arrange(); a.platform.select(a.widgets.all()[0]); });
  await page.click('#swarf-step-tex'); await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 15000 });
  const hasBtn = await page.evaluate(() => !!document.getElementById('tx-layflat'));
  await page.click('#tx-layflat'); await wait(800);
  const flatNow = await page.evaluate(() => { const p = window.__swarfTex.state().parts[0]; return { marks: p.marks.length, dormant: p.dormant.length, note: document.getElementById('tx-card').textContent }; });
  await page.evaluate(() => window.__swarfTex.close(false)); await wait(300);
  f = await fit();
  check(hasBtn && !f.tilted && f.worst < 0.05 && flatNow.marks === 0 && flatNow.dormant === 1 && /waits/.test(flatNow.note), `"lay it flat": flat, its outline on its top, the side's mark waiting (${JSON.stringify({ f, marks: flatNow.marks, dormant: flatNow.dormant })})`);
  check(await cuts() === 0, 'flat, the side\'s texture cuts nothing');
  await page.evaluate(() => { const a = window.kiri.api; a.view.set_arrange && a.view.set_arrange(); });
  await rot(Math.PI / 2, 0, 0); await wait(300);
  const back = await page.evaluate(() => window.kiri.api.widgets.all()[0].meta.tex[0].xf);
  check(back.every((v, i) => Math.abs(v - sideMark.xf[i]) < 1e-6) && await cuts() === 1, `on its side again: the mark where it was (${back.map(v => +v.toFixed(3))}), cut again`);
  // saved tipped by an older swarf, lying flat after all (rectangle.swarf): lined up when TEX opens
  await fresh(L); await wait(1500);
  await rot(0, 0, Math.PI); await wait(300);
  await page.evaluate(() => { const w = window.kiri.api.widgets.all()[0]; w.meta.tilted = true; delete w.meta.rq; delete w.meta.rflat; w.meta.xf = [1, 0, 0, 1]; });
  p = await paint();
  f = await fit();
  check(p.marks === 1 && !f.tilted && f.worst < 0.05, `an old file's flat part marked tipped: TEX lines it up and paints (${JSON.stringify({ p, f })})`);
  check(!errors.length, `no page errors${errors.length ? ': ' + errors[0] : ''}`);
} finally { await browser.close(); }
console.log(bad.length ? `flip: ${bad.length} failed` : 'flip: ok');
process.exit(bad.length ? 1 : 0);
