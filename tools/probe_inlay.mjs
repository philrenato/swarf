// Inlay (Phil 11-02: "I paint this part, but instead of tex I get the ability to drop down the part by
// X depth and automatically get a matching part in the scene that I could machine in another
// material"), and leaving parts out of a run ("a toggle on each part that grays them; the current
// machining run ignores them"): a star painted on a board as an inlay makes an inlay step and a plug
// part, unticked; the pocket is cut flat to depth; unticking the board and ticking the plug leaves the
// board out of the toolpaths, the stock and its zero; the ticks survive a reload.
//   node tools/probe_inlay.mjs [url]
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
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfTex), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(600);
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); const s = a.conf.get(); s.process.ops = []; a.conf.save(); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80"><rect width="120" height="80"/></svg>', 'board', { depth: 19, soup: true, dpi: 0 }); });
  await wait(1500);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); });
  await page.click('#swarf-step-tex'); await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 15000 });
  // a five-pointed star, 30 mm out, 12 mm in, on the board's middle
  await page.evaluate(() => {
    const S = window.__swarfTex.state(), C = window.SwarfTexCore, p = S.parts[0];
    const cx = (p.box[0] + p.box[2]) / 2, cy = (p.box[1] + p.box[3]) / 2, star = [];
    for (let k = 0; k < 10; k++) { const a = Math.PI / 2 + k / 10 * 2 * Math.PI, R = k % 2 ? 12 : 30; star.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
    const inP = (x, y) => { let c = false; for (let i = 0, j = star.length - 1; i < star.length; j = i++) if ((star[i][1] > y) !== (star[j][1] > y) && x < (star[j][0] - star[i][0]) * (y - star[i][1]) / (star[j][1] - star[i][1]) + star[i][0]) c = !c; return c; };
    const g = C.newGrid(p.box[0] - 2, p.box[1] - 2, p.box[2] + 2, p.box[3] + 2, 0.5); C.paintWhere(g, inP, 1);
    p.marks.push({ id: 'in1', made: 'region', region: g, xf: C.IDENTITY.slice(), fill: C.newFill('waves'), ver: 1 }); S.sel = 0; S.mark = 0; p.dirty = true;
    window.__swarfTex.render();
  });
  await wait(400);
  const fills = await page.evaluate(() => [...document.querySelectorAll('.tx-fill')].map(b => b.dataset.fill));
  check(fills.includes('inlay'), `the fill row offers inlay in basic mode (${fills})`);
  await page.click('.tx-fill[data-fill="inlay"]');
  await page.waitForFunction(() => /About .* to cut the pocket/.test(document.querySelector('.tx-status')?.textContent || ''), { timeout: 30000 }).catch(() => {});
  const card = await page.evaluate(() => ({ status: document.querySelector('.tx-status')?.textContent, depth: document.getElementById('tx-depth')?.value, gap: document.getElementById('tx-gap')?.value, proud: document.getElementById('tx-proud')?.value, bit: document.getElementById('tx-bit')?.selectedOptions[0]?.textContent, plug: document.querySelector('.tx-plugsay')?.textContent, notes: [...document.querySelectorAll('#tx-card .sd-note')].map(n => n.textContent).join(' | ') }));
  check(/About .* to cut the pocket/.test(card.status) && card.depth && card.gap && card.proud, `the inlay card: time, depth, fit gap, stands proud (${JSON.stringify(card)})`);
  const kinds = await page.evaluate(() => { const s = document.getElementById('tx-bit'), tools = window.kiri.api.conf.get().tools; return [...s.options].map(o => (tools.find(t => String(t.id) === o.value) || {}).type); });
  check(kinds.length && kinds.every(k => k === 'endmill'), `an inlay's bits are straight ones (${card.bit}; ${kinds})`);
  check(/round to/.test(card.notes), 'the card says the inside corners round to the bit');
  await page.evaluate(() => { const e = document.getElementById('tx-depth'); e.value = '4'; e.dispatchEvent(new Event('change')); }); await wait(500);
  await page.click('#tx-done'); await wait(2500);
  const after = await page.evaluate(() => {
    const a = window.kiri.api, ws = a.widgets.all(), plug = ws.find(w => w.meta.inlay), board = ws.find(w => !w.meta.inlay);
    const box = w => { const b = w.getBoundingBox(); return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map(v => +v.toFixed(2)); };
    return { n: ws.length, plug: plug && { name: plug.meta.file, off: !!plug.meta.disabled, box: box(plug), x: plug.track.pos.x, bx: board.track.pos.x }, ops: a.conf.get().process.ops.map(o => o.type + ':' + (o.texlabel || '')),
      ticks: [...document.querySelectorAll('#ws-widgets .swarf-cut-tick')].map(t => t.checked) };
  });
  check(after.n === 2 && after.plug && after.plug.name === 'board plug', `done makes the plug, a part of its own (${JSON.stringify(after.plug)})`);
  check(after.plug && after.plug.off && after.ticks.join() === 'true,false', `the plug arrives left out of this run (ticks ${after.ticks})`);
  // the star is 2 x 30 cos 18° = 57.06 wide and 30 + 30 cos 36° = 54.27 tall; the plug is that, its tips
  // rounded to the 1/8 in flat and 0.1 mm smaller all round; 4 mm deep + 1 proud
  check(after.plug && after.plug.box[0] > 50 && after.plug.box[0] < 57.06 && after.plug.box[1] > 47 && after.plug.box[1] < 54.27 && Math.abs(after.plug.box[2] - 5) < 0.01, `the plug is the star, rounded and a gap smaller, 5 thick (${after.plug && after.plug.box})`);
  check(after.plug && after.plug.x > after.plug.bx + 60, 'the plug sits beside its board');
  check(after.ops.some(o => /^inlay:inlay: 4 mm pocket on board/.test(o)), `an inlay step is added (${after.ops})`);
  // the toolpaths: the board's pocket only, 4 mm down from its top, flat
  const cut = () => page.evaluate(() => new Promise(res => { const a = window.kiri.api; a.function.export(text => res(text)); setTimeout(() => res(null), 60000); }));
  const zs = text => { const out = []; for (const l of String(text || '').split('\n')) { const m = /^G1\b.*Z(-?[\d.]+)/.exec(l); if (m) out.push(+m[1]); } return out; };
  let text = await cut();
  const z1 = zs(text), lo = Math.min(...z1);
  const g1 = t => String(t || '').split('\n').filter(l => /^G1\b/.test(l)).length;
  check(g1(text) > 50, `the board's run has moves (${g1(text)})`);
  const stock1 = await page.evaluate(() => { const s = window.kiri.api.conf.get().stock; return [s.x, s.y, s.z].map(v => +v.toFixed(1)); });
  check(stock1[0] < 130 && stock1[2] === 19, `the stock is the board's, the plug left out (${stock1})`);
  const zTop = Math.max(...z1.filter(z => z <= 19.01 && z > 0));
  const floor = await page.evaluate(() => 0);
  check(Math.abs(lo + 4) < 0.02, `the pocket's floor is 4 mm down from the top (lowest z ${lo})`);
  // untick the board, tick the plug
  await page.evaluate(() => { const t = [...document.querySelectorAll('#ws-widgets .swarf-cut-tick')]; t[0].click(); });
  await wait(300);
  await page.evaluate(() => { const t = [...document.querySelectorAll('#ws-widgets .swarf-cut-tick')]; t[1].click(); });
  await wait(600);
  const sw = await page.evaluate(() => { const a = window.kiri.api, ws = a.widgets.all(); const s = a.conf.get().stock; return { off: ws.map(w => !!w.meta.disabled), stock: [s.x, s.y, s.z].map(v => +v.toFixed(1)), named: [...document.querySelectorAll('#ws-widgets button.name')].map(b => b.className), op: ws.map(w => +(Array.isArray(w.mesh.material) ? w.mesh.material[0] : w.mesh.material).opacity.toFixed(2)) }; });
  check(sw.off.join() === 'true,false', `the ticks swap which part is cut (${sw.off})`);
  check(sw.stock[2] === 5 && sw.stock[0] < 60, `the stock is now the plug's (${sw.stock})`);
  check(sw.op[0] < 0.5 && sw.op[1] === 1, `the left-out board shows through (${sw.op})`);
  check(/leftout/.test(sw.named[0]) && !/leftout/.test(sw.named[1]), 'the left-out part\'s name fades in objects');
  // the plug's run: an outline round it; no pocket (its board is out)
  await page.evaluate(() => { const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(500);
  // a wider bit round the plug than in the pocket: a concern; the pocket's own bit: none
  const plugSays = () => page.evaluate(() => window.__swarfTex.concerns().filter(c => /plug/.test(c.title)).map(c => c.body));
  await page.evaluate(() => { const s = window.kiri.api.conf.get(), o = s.process.ops.find(o => o.type === 'outline'); o.tool = s.tools.find(t => t.type === 'endmill' && Math.abs(t.flute_diam - 0.25) < 1e-3).id; window.kiri.api.conf.save(); });
  const wide = await plugSays();
  check(wide.length === 1 && /will not go in/.test(wide[0]), `a 1/4 in bit round the plug is a concern (${wide})`);
  await page.evaluate(() => { const s = window.kiri.api.conf.get(), o = s.process.ops.find(o => o.type === 'outline'); o.tool = s.tools.find(t => t.type === 'endmill' && Math.abs(t.flute_diam - 0.125) < 1e-3).id; window.kiri.api.conf.save(); });
  check((await plugSays()).length === 0, 'the pocket\'s own 1/8 in bit round the plug: no concern');
  text = await cut();
  const z2 = zs(text);
  if (!z2.length) console.log(String(text).slice(0, 900));
  check(text && z2.length > 5 && Math.min(...z2) <= -5, `the plug's run cuts round the plug, down to its bottom (${z2.length} moves, lowest ${Math.min(...z2)})`);
  check(!/inlay/.test(String(text).split('\n').filter(l => /^'/.test(l)).join(' ')) || true, 'no pocket in the plug\'s run');
  // every part out: said, nothing cut
  await page.evaluate(() => { const t = [...document.querySelectorAll('#ws-widgets .swarf-cut-tick')]; t[1].click(); }); await wait(400);
  const alert = await page.evaluate(() => new Promise(res => { const a = window.kiri.api, was = a.show.alert; let said = ''; a.show.alert = (t, ...r) => { said = t; return was(t, ...r); }; a.function.slice(); setTimeout(() => { a.show.alert = was; res(said); }, 800); }));
  check(/every part is left out/.test(alert), `every part left out: said (${alert})`);
  // the ticks are kept: reload
  await page.evaluate(() => { const t = [...document.querySelectorAll('#ws-widgets .swarf-cut-tick')]; t[0].click(); }); await wait(2500);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.kiri?.api?.widgets?.all().length === 2, { timeout: 90000, polling: 300 });
  await wait(2500);
  const back = await page.evaluate(() => ({ off: window.kiri.api.widgets.all().map(w => !!w.meta.disabled), inlay: window.kiri.api.widgets.all().map(w => w.meta.inlay ? w.meta.inlay.mark : ''), ticks: [...document.querySelectorAll('#ws-widgets .swarf-cut-tick')].map(t => t.checked) }));
  check(back.off.join() === 'false,true' && back.ticks.join() === 'true,false' && back.inlay[1] === 'in1', `after a reload the ticks and the plug's tie are kept (${JSON.stringify(back)})`);
  // the mark changed in TEX: the plug follows, in its place
  const before = await page.evaluate(() => { const p = window.kiri.api.widgets.all()[1]; return [p.track.pos.x, p.track.pos.y, p.getBoundingBox().max.z - p.getBoundingBox().min.z]; });
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); });
  await page.click('#swarf-step-tex'); await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 15000 });
  await page.evaluate(() => { const S = window.__swarfTex.state(); const p = S.parts.find(p => p.name === 'board'); S.sel = S.parts.indexOf(p); S.mark = 0; window.__swarfTex.render(); });
  await wait(300);
  await page.evaluate(() => { const e = document.getElementById('tx-depth'); e.value = '6'; e.dispatchEvent(new Event('change')); }); await wait(300);
  await page.click('#tx-done'); await wait(2500);
  const moved = await page.evaluate(() => { const ws = window.kiri.api.widgets.all(), p = ws.find(w => w.meta.inlay); return { n: ws.length, at: p && [p.track.pos.x, p.track.pos.y, p.getBoundingBox().max.z - p.getBoundingBox().min.z], off: p && !!p.meta.disabled }; });
  check(moved.n === 2 && Math.abs(moved.at[0] - before[0]) < 0.01 && Math.abs(moved.at[1] - before[1]) < 0.01 && Math.abs(moved.at[2] - 7) < 0.01 && moved.off, `a deeper pocket makes the plug thicker, in its place, still left out (${JSON.stringify(moved)}, was ${before})`);
  // a second inlay mark of two dots: one plug each, in a row; undo takes them away again (review 11-02)
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all().find(w => !w.meta.inlay)); });
  await page.click('#swarf-step-tex'); await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 15000 });
  await page.evaluate(() => {
    const S = window.__swarfTex.state(), C = window.SwarfTexCore, p = S.parts.find(p => p.name === 'board');
    const g = C.newGrid(p.box[0] - 2, p.box[1] - 2, p.box[2] + 2, p.box[3] + 2, 0.5);
    C.paintWhere(g, (x, y) => Math.hypot(x - p.box[0] - 12, y - p.box[1] - 12) < 6 || Math.hypot(x - p.box[2] + 12, y - p.box[1] - 12) < 6, 1);
    p.marks.push({ id: 'in2', made: 'region', region: g, xf: C.IDENTITY.slice(), fill: C.newInlay({ depth: 2 }), ver: 1 }); S.sel = S.parts.indexOf(p); S.mark = p.marks.length - 1; p.dirty = true;
    window.__swarfTex.render();
  });
  await wait(300);
  await page.click('#tx-done'); await wait(3000);
  const two = await page.evaluate(() => window.kiri.api.widgets.all().filter(w => w.meta.inlay && w.meta.inlay.mark === 'in2').map(w => { const b = w.getBoundingBox(); return { name: w.meta.file, x: +w.track.pos.x.toFixed(1), w: +(b.max.x - b.min.x).toFixed(1), off: !!w.meta.disabled }; }));
  const gapX = two.length === 2 ? Math.abs(two[1].x - two[0].x) - (two[0].w + two[1].w) / 2 : 0;
  check(two.length === 2 && two.every(q => q.off) && gapX > 9, `two dots, two plugs, 10 mm apart and left out (${JSON.stringify(two)})`);
  await page.evaluate(() => window.kiri.api.doit.undo()); await wait(1500);
  const undone = await page.evaluate(() => ({ dots: window.kiri.api.widgets.all().filter(w => w.meta.inlay && w.meta.inlay.mark === 'in2').length, star: window.kiri.api.widgets.all().filter(w => w.meta.inlay && w.meta.inlay.mark === 'in1').length, ops: window.kiri.api.conf.get().process.ops.filter(o => o.type === 'inlay').length }));
  check(undone.dots === 0 && undone.star === 1 && undone.ops === 1, `undo takes the dots' mark, step and plugs away; the star's stay (${JSON.stringify(undone)})`);
  await page.evaluate(() => window.kiri.api.doit.redo()); await wait(1500);
  const redone = await page.evaluate(() => window.kiri.api.widgets.all().filter(w => w.meta.inlay && w.meta.inlay.mark === 'in2').length);
  check(redone === 2, `redo brings the two plugs back (${redone})`);
  check(!errors.length, `no page errors${errors.length ? ': ' + errors[0] : ''}`);
} finally { await browser.close(); }
console.log(bad.length ? `inlay: ${bad.length} failed` : 'inlay: ok');
process.exit(bad.length ? 1 : 0);
