// Copies, rows x columns (review 105 fix order 4): from the right-click on a part and from edit: a small card
// asks how many across, how many back, and the gap (12 mm, the arrival rule's). The cells stay on the bed and
// off other parts, and the card says when they cannot. One undo takes them all back, one redo brings them back.
// Tabs and marks follow as they do for duplicate; a word or a drawing kept together stays together in each cell.
//   node tools/probe_copies.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const P = createRequire(import.meta.url)('../web/kiri/swarf-run-parse.js');
const url = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const rect = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}"/></svg>`;
const two = `<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="40mm" viewBox="0 0 120 40"><rect width="50" height="40"/><rect x="70" width="50" height="40"/></svg>`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-copies-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfMenu && window.__swarfSize), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(800);
  const fresh = () => page.evaluate(() => { const a = window.kiri.api, s = a.conf.get(); a.platform.clear(); s.process.ops = []; a.conf.save(); a.event.emit('cam.op.render'); }).then(() => wait(500));
  const part = (svg, name, depth = 12) => page.evaluate((svg, name, depth) => { window.kiri.api.platform.load_svg(svg, name, { depth, soup: true, dpi: 0, place: true }); }, svg, name, depth).then(() => wait(900));
  const parts = () => page.evaluate(() => window.kiri.api.widgets.all().map(w => { const g = w.mesh.geometry; g.computeBoundingBox(); const b = g.boundingBox, p = w.track.pos; return { name: w.meta.file, id: w.id, x0: b.min.x + p.x, y0: b.min.y + p.y, x1: b.max.x + p.x, y1: b.max.y + p.y, tabs: (w.anno.tab || []).length, tex: (w.meta.tex || []).length, group: w.group.length }; }));
  const bed = () => page.evaluate(() => { const d = window.kiri.api.conf.get().device; return { W: d.bedWidth / 2, D: d.bedDepth / 2 }; });
  const onBed = (list, B) => list.every(p => p.x0 >= -B.W - 0.01 && p.x1 <= B.W + 0.01 && p.y0 >= -B.D - 0.01 && p.y1 <= B.D + 0.01);
  const overlaps = list => { let n = 0; for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { const a = list[i], b = list[j]; if (a.x0 < b.x1 - 0.01 && b.x0 < a.x1 - 0.01 && a.y0 < b.y1 - 0.01 && b.y0 < a.y1 - 0.01) n++; } return n; };
  const pick = name => page.evaluate(name => { const a = window.kiri.api, w = a.widgets.all().find(w => w.meta.file === name); a.platform.deselect(); a.platform.select(w, false); }, name).then(() => wait(200));
  const screen = name => page.evaluate(name => { const a = window.kiri.api, w = name ? a.widgets.all().find(w => w.meta.file === name) : a.widgets.all()[0], THREE = window.THREE, { camera, renderer } = window.moto.space.internals(); const box = new THREE.Box3().setFromObject(w.mesh), v = box.getCenter(new THREE.Vector3()).project(camera), r = renderer.domElement.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; }, name);
  const open = () => page.evaluate(() => window.__swarfSize.copies && window.__swarfSize.copies());
  const card = () => page.evaluate(() => { const m = [...document.querySelectorAll('#dialog button')].find(b => /^make$/i.test(b.textContent.trim())), e = document.getElementById('copies-across'); return { open: !!e && !!document.getElementById('dialog')?.open, why: document.getElementById('copies-why')?.textContent || '', says: document.getElementById('copies-says')?.textContent || '', gap: document.getElementById('copies-gap')?.value, disabled: !!m?.disabled, titles: ['copies-across', 'copies-back', 'copies-gap'].every(i => document.getElementById(i)?.title), makeTitle: m?.title }; });
  const type = async (id, text) => { await page.click('#' + id, { clickCount: 3 }); await page.keyboard.type(String(text)); await wait(100); };
  const press = word => page.evaluate(word => [...document.querySelectorAll('#dialog button')].find(b => b.textContent.trim().toLowerCase() === word)?.click(), word).then(() => wait(700));
  const undo = () => page.evaluate(() => window.kiri.api.doit.undo()).then(() => wait(500));
  const redo = () => page.evaluate(() => window.kiri.api.doit.redo()).then(() => wait(500));

  // 1: the right-click, a real right mouse click on the part
  await fresh(); await part(rect(100, 60), 'box'); await pick('box');
  const [mx, my] = await screen('box');
  await page.mouse.click(mx, my, { button: 'right' }); await wait(300);
  const rows = await page.evaluate(() => window.__swarfMenu.rows());
  check(rows.includes('copies…'), `the right-click on a part offers copies (${rows.length} rows)`);
  const rowTitle = await page.evaluate(() => [...document.querySelectorAll('.swarf-ctx button')].find(b => b.textContent === 'copies…')?.title);
  check(!!rowTitle, 'its row has a tooltip');
  await page.evaluate(() => [...document.querySelectorAll('.swarf-ctx button')].find(b => b.textContent === 'copies…')?.click()); await wait(500);
  let c = await card();
  check(c.open, 'it opens a card');
  if (!c.open) throw new Error('no card');
  check(parseFloat(c.gap) === 12, `the gap starts at 12 mm (${c.gap})`);
  check(c.titles && !!c.makeTitle, 'every control on the card has a tooltip');
  await type('copies-across', 3); await type('copies-back', 2);
  c = await card();
  check(/6 in all, 5 new/.test(c.says), `the card counts them: "${c.says}"`);
  await press('make');
  let L = await parts();
  check(L.length === 6, `3 across, 2 back: 6 parts (${L.length})`);
  check(overlaps(L) === 0, 'no two overlap');
  const xs = [...new Set(L.map(p => +p.x0.toFixed(1)))].sort((a, b) => a - b), ys = [...new Set(L.map(p => +p.y0.toFixed(1)))].sort((a, b) => a - b);
  check(xs.length === 3 && Math.abs(xs[1] - xs[0] - 112) < 0.1, `across: 100 mm parts, 12 mm clear (${xs})`);
  check(ys.length === 2 && Math.abs(ys[1] - ys[0] - 72) < 0.1, `back: 60 mm parts, 12 mm clear (${ys})`);
  check(new Set(L.map(p => p.name)).size === 6, `each has its own name (${L.map(p => p.name)})`);
  const said = await page.evaluate(() => document.getElementById('alert-area')?.innerText || document.body.innerText.match(/Made 5 copies[^\n]*/)?.[0] || '');
  check(/Made 5 copies of box/.test(said), `it says what it made: "${said.slice(0, 90)}"`);
  check(await page.evaluate(() => { const a = window.kiri.api, THREE = window.THREE, { camera } = window.moto.space.internals(); camera.updateMatrixWorld(); return a.widgets.all().every(w => { const b = new THREE.Box3().setFromObject(w.mesh).getCenter(new THREE.Vector3()).project(camera); return Math.abs(b.x) < 1 && Math.abs(b.y) < 1; }); }), 'all of them in view');

  // 2: one undo takes them all back, a redo brings them all, and undo still works after
  const before = L.find(p => p.name === 'box');
  await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta'); await wait(600);
  L = await parts();
  check(L.length === 1 && L[0].name === 'box', `one ⌘Z takes them all back (${L.length} left)`);
  check(Math.abs(L[0].x0 - before.x0) < 0.01, 'the original stays where it was');
  const undoSay = await page.evaluate(() => document.body.innerText.match(/Took back[^\n]*|Deleted[^\n]*/)?.[0] || '');
  check(/^Took back/.test(undoSay), `the undo says so: "${undoSay}"`);
  await redo(); L = await parts();
  check(L.length === 6 && overlaps(L) === 0, `one redo brings all six back (${L.length})`);
  await undo(); L = await parts();
  check(L.length === 1, `and undo again (${L.length})`);

  // 3: runs off: said, and make waits; nothing is made
  await pick('box'); await open(); await wait(500);
  await type('copies-across', 99); c = await card();
  check(/runs off the bed/.test(c.why) && /across fit/.test(c.why) && c.disabled, `too many across is said, make waits: "${c.why}"`);
  await type('copies-across', 1); await type('copies-back', 99); c = await card();
  check(/runs off the bed/.test(c.why) && c.disabled, `too many back is said: "${c.why}"`);
  await type('copies-back', 1); c = await card();
  check(c.disabled && /part you have/.test(c.why), `one by one makes nothing: "${c.why}"`);
  await type('copies-across', 'x'); c = await card();
  check(c.disabled && /whole numbers/.test(c.why), `a word is refused: "${c.why}"`);
  await type('copies-across', 2); await type('copies-gap', '-3'); c = await card();
  check(c.disabled && /gap/i.test(c.why), `a gap below 0 is refused: "${c.why}"`);
  await press('cancel');
  check((await parts()).length === 1, 'cancel makes nothing');

  // 4: near the bed's edge the cells grow the other way, on the bed
  const B = await bed();
  await fresh(); await part(rect(100, 60), 'edge');
  await page.evaluate(B => { const w = window.kiri.api.widgets.all()[0]; w.move(B.W - 60, B.D - 40, 0, true); }, B); await wait(200);
  await pick('edge'); await open(); await wait(500);
  await type('copies-across', 3); await type('copies-back', 2); c = await card();
  check(!c.disabled && !c.why, `in the corner it still fits (${c.why || 'no complaint'})`);
  await press('make'); L = await parts();
  check(L.length === 6 && onBed(L, B) && overlaps(L) === 0, `the six stay on the bed, none overlapping (${L.length})`);
  await undo();

  // 5: another part in the way: around it, or said
  await fresh(); await part(rect(100, 60), 'a'); await part(rect(100, 60), 'b');
  L = await parts();
  check(L.length === 2 && overlaps(L) === 0, 'two parts side by side');
  await pick('a'); await open(); await wait(500);
  await type('copies-across', 2); c = await card();
  check(!c.disabled, `a part in the way: the copy goes the other side (${c.why || 'no complaint'})`);
  await press('make'); L = await parts();
  check(L.length === 3 && overlaps(L) === 0 && onBed(L, B), `three parts, none overlapping, b not moved (${L.map(p => Math.round(p.x0))})`);
  await undo();
  // walled in on both sides, so no cell can go anywhere: told
  await page.evaluate(() => { window.kiri.api.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><rect width="100" height="60"/></svg>', 'wall', { depth: 12, soup: true, dpi: 0 }); }); await wait(900);
  await page.evaluate(() => { const a = window.kiri.api, w = n => a.widgets.all().find(x => x.meta.file === n); const p = w('a').track.pos; w('wall').move(p.x - 112, p.y, 0, true); w('b').move(p.x + 112, p.y, 0, true); }); await wait(200);
  await pick('a'); await open(); await wait(500);
  await type('copies-across', 2); c = await card();
  check(c.disabled && /lands on/.test(c.why), `walled in: "${c.why}"`);
  await press('cancel');

  // 6: the edit menu, real mouse; nothing picked and one part is that part; several and nothing picked asks
  await fresh(); await part(rect(80, 40), 'menu');
  await page.evaluate(() => window.kiri.api.platform.deselect()); await wait(200);
  const editAt = await page.evaluate(() => { const s = [...document.querySelectorAll('#menubar .top-menu > span')].find(x => /^edit/i.test(x.textContent.trim())); const r = s.getBoundingClientRect(); return [r.left + 10, r.top + r.height / 2]; });
  await page.mouse.click(...editAt); await wait(300);
  const item = await page.evaluate(() => { const e = document.getElementById('swarf-edit-copies'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, title: e.title || e.parentElement.title, shown: r.width > 0, text: e.textContent.trim() }; });
  check(item?.shown && /copies/.test(item.text) && !!item.title, `edit has copies, with a tooltip (${item?.text})`);
  if (item?.shown) { await page.mouse.click(item.x, item.y); await wait(500); }
  c = await card();
  check(c.open, 'edit › copies opens the card, the one part picked for you');
  if (c.open) { await type('copies-across', 2); await press('make'); }
  check((await parts()).length === 2, 'and makes the copy');
  await page.evaluate(() => window.kiri.api.platform.deselect()); await wait(200);
  await open(); await wait(400);
  c = await card();
  check(!c.open && /Pick a part/.test(await page.evaluate(() => document.body.innerText)), 'two parts and nothing picked: it asks you to pick');

  // 7: tabs and marks come with each; every copy reaches the file
  await fresh(); await part(rect(100, 60), 'tabbed');
  await page.evaluate(() => [...document.querySelectorAll('#op-add-list > div')].find(d => d.textContent.trim() === 'outline').click()); await wait(500);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => /^auto tabs$/i.test(b.textContent.trim()) && b.offsetParent); (b || document.getElementById('swarf-autotabs'))?.click(); }); await wait(800);
  await page.evaluate(() => { const w = window.kiri.api.widgets.all()[0]; w.meta.tex = [{ id: 'probe', made: 'probe' }]; }); // the record travels as duplicate's does
  const tabs0 = (await parts())[0].tabs;
  check(tabs0 > 0, `the part has tabs (${tabs0})`);
  await pick('tabbed'); await open(); await wait(500);
  await type('copies-across', 2); await type('copies-back', 2); await press('make');
  L = await parts();
  check(L.length === 4 && L.every(p => p.tabs === tabs0), `each copy has its tabs (${L.map(p => p.tabs)})`);
  check(L.every(p => p.tex === 1), `each copy has its marks (${L.map(p => p.tex)})`);
  const ids = await page.evaluate(() => window.kiri.api.widgets.all().flatMap(w => (w.anno.tab || []).map(t => t.id)));
  check(new Set(ids).size === ids.length, 'each tab has its own id');
  await page.evaluate(() => { for (const w of window.kiri.api.widgets.all()) delete w.meta.tex; });
  const text = await page.evaluate(() => new Promise(res => { const t = setTimeout(() => res(''), 90000); window.kiri.api.function.clear_progress?.(); window.kiri.api.function.export(s => { clearTimeout(t); res(s); }); }));
  const moves = P.parse(text, { machineUnits: 'mm' }).moves.filter(m => !m.rapid && m.z < -11);
  const zone = (x, y) => L.some(p => x > p.x0 - 5 && x < p.x1 + 5 && y > p.y0 - 5 && y < p.y1 + 5);
  const bb = moves.reduce((u, m) => [Math.min(u[0], m.x), Math.max(u[1], m.x), Math.min(u[2], m.y), Math.max(u[3], m.y)], [Infinity, -Infinity, Infinity, -Infinity]);
  check(bb[1] - bb[0] > 200 && bb[3] - bb[2] > 120, `the file cuts all four cells (${Math.round(bb[1] - bb[0])} × ${Math.round(bb[3] - bb[2])} mm)`);
  void zone;
  await page.evaluate(() => { const a = window.kiri.api; a.view.set_arrange(); }); await wait(600);

  // 8: a drawing's pieces stay one thing in each cell, and the group undoes as one
  await fresh(); await part(two, 'shapes');
  L = await parts();
  check(L.length === 2 && L[0].group === 2, `a drawing of two pieces, kept together (${L.length})`);
  await pick('shapes'); await open(); await wait(500);
  await type('copies-across', 3); await press('make');
  L = await parts();
  check(L.length === 6 && L.every(p => p.group === 2), `3 across: six pieces in groups of two (${L.map(p => p.group)})`);
  check(overlaps(L) === 0, 'no two overlap');
  const rowsN = await page.evaluate(() => document.querySelectorAll('#ws-widgets > *').length);
  check(rowsN === 3, `objects has three rows (${rowsN})`);
  await undo(); L = await parts();
  check(L.length === 2, `one undo: back to the two pieces (${L.length})`);
  await redo(); L = await parts();
  check(L.length === 6 && L.every(p => p.group === 2), `one redo: the groups are back (${L.map(p => p.group)})`);

  // 9: in inches the gap reads in inches
  await page.evaluate(() => { const u = window.kiri.api.ui.units; });
  await fresh(); await part(rect(100, 60), 'inch');
  await page.evaluate(() => { const s = window.kiri.api.conf.get(); s.controller.units = 'in'; window.SwarfLength?.setUnit?.('in'); window.kiri.api.event.emit('units.set'); }); await wait(300);
  if (await page.evaluate(() => window.SwarfLength.unit() === 'in')) {
    await pick('inch'); await open(); await wait(500); c = await card();
    check(Math.abs(window_parse(c.gap) - 12) < 0.2, `in inches the gap is still about 12 mm ("${c.gap}")`);
    await type('copies-gap', '1/2'); await type('copies-across', 2); await press('make'); L = await parts();
    const xs2 = L.map(p => p.x0).sort((a, b) => a - b);
    check(Math.abs(xs2[1] - xs2[0] - 112.7) < 0.1, `a typed 1/2 is 12.7 mm (${(xs2[1] - xs2[0]).toFixed(2)} step)`);
  } else console.log('note: units did not switch by that route; inches not checked here');
  check(!errors.length, `no page errors: ${errors.slice(0, 3).join(' | ')}`);
} catch (e) { check(false, `the probe stopped: ${e.message}`); }
await browser.close();
console.log(bad.length ? `FAILED ${bad.length}` : 'ALL OK');
process.exit(bad.length ? 1 : 0);
function window_parse(t) { const s = String(t).trim(); const m = s.match(/^(\d+)\/(\d+)$/); return (m ? m[1] / m[2] : parseFloat(s)) * 25.4; }
