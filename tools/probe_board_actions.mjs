// The part's three board jobs (review 11-13 #10, Phil 11-13): carving words, pocketing a shape and
// texturing an area live in three modes (draw's text, a pocket step or tex's inlay, tex). A right-click
// on a part lists "carve words", "pocket a shape" and "texture an area", and each opens the mode that
// owns the job with that part picked; closing it leaves nothing behind (no step, no mark, no class on
// the body, the next plain visit is plain). A part draw cannot carve into (a mesh) has no carve words;
// a part with a floor gets one pocket step, not two; the empty bed and an open draw have none.
//   node tools/probe_board_actions.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const THREE_ROWS = ['carve words', 'pocket a shape', 'texture an area'];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-board-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfMenu && window.__swarfDraw && window.__swarfTex && window.__swarfHoles), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  const fresh = () => page.evaluate(() => { const a = window.kiri.api, s = a.conf.get(); a.platform.clear(); s.process.ops = []; a.conf.save(); a.event.emit('cam.op.render'); }).then(() => wait(500));
  const centre = () => page.evaluate(() => {
    const THREE = window.THREE, w = window.kiri.api.widgets.all()[0], { camera, renderer } = window.moto.space.internals();
    const b = new THREE.Box3().setFromObject(w.mesh), c = b.getCenter(new THREE.Vector3()).project(camera), r = renderer.domElement.getBoundingClientRect();
    return { x: r.left + (c.x + 1) / 2 * r.width, y: r.top + (1 - c.y) / 2 * r.height, bedX: r.left + r.width * 0.12, bedY: r.top + r.height * 0.85 };
  });
  const rightClick = async (x, y) => { await page.mouse.move(x, y); await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' }); await wait(400); };
  const rows = () => page.evaluate(() => window.__swarfMenu.rows());
  const press = async label => {
    const r = await page.evaluate(l => { const b = [...document.querySelectorAll('.swarf-ctx button')].find(b => b.textContent === l); if (!b) return null; const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2, title: b.title }; }, label);
    if (!r) return null;
    await page.mouse.click(r.x, r.y); await wait(900); return r;
  };
  // what a mode could leave behind
  const stray = () => page.evaluate(() => {
    const a = window.kiri.api, b = document.body.classList;
    return { draw: !!window.__swarfDraw.state(), tex: !!window.__swarfTex.state(), sheet: !!document.getElementById('swarf-draw'), cls: ['swarf-draw-open', 'swarf-tex-open'].filter(c => b.contains(c)), ops: a.conf.get().process.ops.map(o => o.type), marks: a.widgets.all().reduce((n, w) => n + ((w.meta && w.meta.tex) || []).length, 0), parts: a.widgets.all().length, menu: window.__swarfMenu.isOpen() };
  });
  let ops0 = [];   // the steps before a visit ('|' is the sheet's own marker): a visit leaves them as they were
  const clean = s => !s.draw && !s.tex && !s.sheet && !s.cls.length && s.ops.join() === ops0.join() && s.marks === 0 && s.parts === 1 && !s.menu;
  const picked = () => page.evaluate(() => window.kiri.api.selection.widgets().map(w => w.meta.file || w.id));

  // ── a drawn board ──
  await fresh();
  await page.evaluate(() => window.kiri.api.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="80mm" viewBox="0 0 200 80"><rect width="200" height="80"/></svg>', 'sign', { depth: 19, soup: true, dpi: 0 }));
  await wait(1200);
  await page.evaluate(() => { window.kiri.api.platform.deselect?.(); window.moto.space.view.top(); });
  await wait(1200);
  const at = await centre();
  ops0 = (await stray()).ops;
  await rightClick(at.x, at.y);
  const r1 = await rows();
  console.log('   part rows:', r1.join(' · '));
  check(THREE_ROWS.every(l => r1.includes(l)), 'a right-click on a drawn part lists carve words, pocket a shape, texture an area');
  check(!r1.includes('texture it in tex'), 'texture an area replaces the old texture it in tex row');
  const tips = await page.evaluate(L => L.map(l => [...document.querySelectorAll('.swarf-ctx button')].find(b => b.textContent === l)?.title || ''), THREE_ROWS);
  check(tips.every(t => t && t.split(/\s+/).length <= 12), `each has a tooltip under twelve words (${tips.join(' | ')})`);

  // carve words: draw, the text tool, carving into this part
  await press('carve words');
  // the font comes on the first text visit and its render builds a new card: the field takes the focus again after
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'sd-str' && window.__swarfDraw.text.font, { timeout: 15000 }).catch(() => {});
  await wait(300);
  const dr = await page.evaluate(() => { const S = window.__swarfDraw.state(), m = document.getElementById('sd-mode'); return S && { tool: S.tool, into: S.textFor && S.textFor.name, mode: m && m.value, word: m && m.selectedOptions[0].textContent, focus: document.activeElement && document.activeElement.id, say: document.getElementById('sd-say').textContent }; });
  check(dr && dr.tool === 'text' && dr.into === 'sign', `carve words opens draw on its text tool for this part (${JSON.stringify(dr)})`);
  check(dr && dr.mode === 'carve' && dr.word === 'carve into sign', 'the card reads carve into sign');
  check(dr && dr.focus === 'sd-str' && /click on sign/.test(dr.say), 'the words field takes the typing and the line names the part');
  check((await picked()).join() === 'sign', 'the part stays picked in cam');
  check(!(await page.evaluate(() => window.__swarfMenu.open(300, 300, window.kiri.api.widgets.all()[0]))), 'no menu while draw is open');
  // the words land on the board: carved into it (cancel then drops them)
  await page.keyboard.type('AB'); await wait(150);
  const spot = await page.evaluate(() => { const S = window.__swarfDraw.state(), r = document.getElementById('sd-svg').getBoundingClientRect(), w = window.kiri.api.widgets.all()[0], b = w.getBoundingBox(); return [r.left + S.ox + (b.min.x + 30) * S.k, r.top + S.oy - (b.min.y + 25) * S.k]; });
  await page.mouse.move(spot[0] + 10, spot[1] + 10); await page.mouse.move(spot[0], spot[1]); await page.mouse.click(spot[0], spot[1]);
  await wait(800);
  const placed = await page.evaluate(() => { const S = window.__swarfDraw.state(), p = S.parts[S.sel]; return p && { str: p.text && p.text.str, carve: !!p.carve }; });
  check(placed && placed.str === 'AB' && placed.carve, `typed words placed on it are a carve (${JSON.stringify(placed)})`);
  await page.evaluate(() => window.__swarfDraw.close(false)); await wait(500);
  let s = await stray();
  check(clean(s), `cancel leaves nothing behind (${JSON.stringify(s)})`);
  check(await page.evaluate(() => { window.__swarfDraw.open(); const S = window.__swarfDraw.state(), ok = S.tool === 'select' && !S.textFor; window.__swarfDraw.close(false); return ok; }), 'the next plain visit to draw opens plain');

  // texture an area: tex on this part
  await page.evaluate(() => window.kiri.api.platform.deselect?.()); await wait(200);
  await rightClick(at.x, at.y);
  await press('texture an area');
  const tx = await page.evaluate(() => { const S = window.__swarfTex.state(); return S && { sel: S.sel, name: S.parts[S.sel] && S.parts[S.sel].name, say: document.getElementById('tx-say').textContent }; });
  check(tx && tx.sel >= 0 && /sign/.test(tx.name) && /is picked/.test(tx.say), `texture an area opens tex with the part picked (${JSON.stringify(tx)})`);
  await page.evaluate(() => window.__swarfTex.close(false)); await wait(500);
  s = await stray();
  check(clean(s), `closing tex leaves nothing behind (${JSON.stringify(s)})`);

  // pocket a shape on a flat part: tex, the pocket visit (inlay)
  await rightClick(at.x, at.y);
  await press('pocket a shape');
  const pk = await page.evaluate(() => { const S = window.__swarfTex.state(); return S && { sel: S.sel, name: S.parts[S.sel] && S.parts[S.sel].name, say: document.getElementById('tx-say').textContent }; });
  check(pk && pk.sel >= 0 && /sign/.test(pk.name) && /Pocket: drag/.test(pk.say), `pocket a shape on a flat part opens tex's pocket, the part picked (${JSON.stringify(pk)})`);
  await page.evaluate(() => window.__swarfTex.close(false)); await wait(500);
  s = await stray();
  check(clean(s), `closing it leaves nothing behind, no pocket step (${JSON.stringify(s)})`);
  check(await page.evaluate(() => { window.__swarfTex.open(); const ok = !/Pocket:/.test(document.getElementById('tx-say').textContent); window.__swarfTex.close(false, true); return ok; }), 'the next plain visit to tex is not a pocket visit');

  // ── a tray with a floor (a mesh: draw cannot carve into it) ──
  await fresh();
  await page.evaluate(() => {
    const L = 60, T = 20, F = 12, v = [];
    const q = (a, b, c, d) => v.push(...a, ...b, ...c, ...a, ...c, ...d);
    const o = [[0, 0], [L, 0], [L, L], [0, L]], i = [[10, 10], [50, 10], [50, 50], [10, 50]];
    for (let k = 0; k < 4; k++) {
      const n = (k + 1) % 4;
      q([...o[k], T], [...o[n], T], [...i[n], T], [...i[k], T]);
      q([...o[k], 0], [...o[n], 0], [...o[n], T], [...o[k], T]);
      q([...i[n], F], [...i[k], F], [...i[k], T], [...i[n], T]);
    }
    q([...i[0], F], [...i[1], F], [...i[2], F], [...i[3], F]);
    q([...o[3], 0], [...o[2], 0], [...o[1], 0], [...o[0], 0]);
    const w = window.kiri.api.new.widget(); w.loadVertices(new Float32Array(v)); w.meta.file = 'tray'; window.kiri.api.platform.add(w);
  });
  await wait(1200);
  await page.evaluate(() => { window.kiri.api.platform.deselect?.(); window.moto.space.view.top(); });
  await wait(1200);
  const at2 = await centre();
  // its rim, not the recess: the middle is the floor, still the part
  await rightClick(at2.x, at2.y);
  const r2 = await rows();
  console.log('   tray rows:', r2.join(' · '));
  check(!r2.includes('carve words') && r2.includes('pocket a shape') && r2.includes('texture an area'), 'a mesh part: pocket and texture, no carve words');
  await press('pocket a shape');
  const p1 = await page.evaluate(() => ({ ops: window.kiri.api.conf.get().process.ops.map(o => o.type), sel: window.kiri.api.selection.widgets().length, draw: !!window.__swarfDraw.state(), tex: !!window.__swarfTex.state() }));
  check(p1.ops.filter(t => t === 'pocket').length === 1 && !p1.draw && !p1.tex, `a part with a floor gets a pocket step, no editor over it (${JSON.stringify(p1)})`);
  check((await picked()).join() === 'tray', 'the tray stays picked');
  await rightClick(at2.x, at2.y);
  await press('pocket a shape');
  const p2 = await page.evaluate(() => window.kiri.api.conf.get().process.ops.map(o => o.type));
  check(p2.filter(t => t === 'pocket').length === 1, `again: the empty pocket step is used, not doubled (${p2})`);

  // ── the empty bed ──
  await page.evaluate(() => window.kiri.api.platform.clear()); await wait(600);
  await rightClick(at.bedX, at.bedY);
  const r3 = await rows();
  console.log('   bed rows:', r3.join(' · '));
  check(r3.length > 0 && !THREE_ROWS.some(l => r3.includes(l)), 'the empty bed has none of the three');
  await page.keyboard.press('Escape');
} catch (e) { check(false, 'threw: ' + e.message); }
await browser.close();
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `board actions: ${bad.length} failed, ${errors.length} page errors` : 'board actions: ok');
process.exit(bad.length || errors.length ? 1 : 0);
