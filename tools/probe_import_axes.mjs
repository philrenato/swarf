// Phil 11-09, three files from Rhino. A DXF drawn at an elevation (Z -292.1) came in floating, 311 mm
// thick, in two broken pieces: every curve now lies on the XY plane at Z 0, and an open spline joins the
// polyline it meets, so the board is one closed part, the typed thickness, on the bed. An OBJ came in
// standing on its edge: OBJ is Y up (Rhino maps Z to Y by default), so Y up turns to Z up.
//   node tools/probe_import_axes.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const url = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };

// a 100 x 50 board as Rhino writes it: an open POLYLINE (three sides) and an open cubic SPLINE (the
// fourth, bowed out 15 mm), both at Z -292.1, in mm
const Z = '-292.1';
const g = (...p) => p.join('\n');
const pt = (c, x, y) => g(` ${c}0`, x, ` ${c === '' ? '2' : c}0`, y, ` ${c === '' ? '3' : c}0`, Z);
const vtx = (x, y) => g('  0', 'VERTEX', '  8', '0', ' 10', x, ' 20', y, ' 30', Z);
const dxf = g('  0', 'SECTION', '  2', 'HEADER', '  9', '$INSUNITS', ' 70', '4', '  0', 'ENDSEC',
  '  0', 'SECTION', '  2', 'ENTITIES',
  '  0', 'POLYLINE', '  8', '0', ' 66', '1', ' 10', '0', ' 20', '0', ' 30', Z, ' 70', '8',
  vtx(100, 0), vtx(100, -50), vtx(0, -50), vtx(0, 0), '  0', 'SEQEND', '  8', '0',
  '  0', 'SPLINE', '  8', '0', ' 70', '8', ' 71', '3', ' 72', '8', ' 73', '4',
  ...[0, 0, 0, 0, 1, 1, 1, 1].flatMap(k => [' 40', String(k)]),
  ...[[0, 0], [33, 15], [67, 15], [100, 0]].flatMap(([x, y]) => [' 10', String(x), ' 20', String(y), ' 30', Z]),
  '  0', 'ENDSEC', '  0', 'EOF', '');

// a 100 x 60 x 10 box written Y up (Rhino Z -> OBJ Y, Rhino Y -> OBJ -Z), as Rhino's default export
const P = [[0, 0, 0], [100, 0, 0], [100, 60, 0], [0, 60, 0], [0, 0, 10], [100, 0, 10], [100, 60, 10], [0, 60, 10]];
const F = [[1, 3, 2], [1, 4, 3], [5, 6, 7], [5, 7, 8], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 4, 8], [3, 8, 7], [4, 1, 5], [4, 5, 8]];
const obj = ['# Rhino', ...P.map(([x, y, z]) => `v ${x} ${z} ${-y}`), ...F.map(f => `f ${f.join(' ')}`), ''].join('\n');
// the same box saved Z up (Rhino with "Map Rhino Z to OBJ Y" unticked): read Y up it stands on its edge
const objZ = ['# Rhino, Z up', ...P.map(([x, y, z]) => `v ${x} ${y} ${z}`), ...F.map(f => `f ${f.join(' ')}`), ''].join('\n');
// 115a: the same 100 x 50 board flat at one elevation (no note), and with its spline 10 mm higher (two heights)
// fresh review 11-13: the three sides as an LWPOLYLINE, its one height in code 38, beside the spline at the
// same elevation: one height, no note (it read 0 and said two)
const dxfLw = elev => g('  0', 'SECTION', '  2', 'HEADER', '  9', '$INSUNITS', ' 70', '4', '  0', 'ENDSEC',
  '  0', 'SECTION', '  2', 'ENTITIES',
  '  0', 'LWPOLYLINE', '  8', '0', ' 90', '4', ' 70', '0', ' 38', elev,
  ...[[0, 0], [100, 0], [100, -50], [0, -50]].flatMap(([x, y]) => [' 10', String(x), ' 20', String(y)]),
  '  0', 'SPLINE', '  8', '0', ' 70', '8', ' 71', '3', ' 72', '8', ' 73', '4',
  ...[0, 0, 0, 0, 1, 1, 1, 1].flatMap(k => [' 40', String(k)]),
  ...[[0, -50], [-15, -33], [-15, -17], [0, 0]].flatMap(([x, y]) => [' 10', String(x), ' 20', String(y), ' 30', Z]),
  '  0', 'ENDSEC', '  0', 'EOF', '');
const dxfAt = (zPoly, zSpline) => dxf.split('\n').map((l, i, a) => l === Z ? (a.slice(i + 1).includes('SPLINE') ? zPoly : zSpline) : l).join('\n');

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1440, height: 900 }, userDataDir: mkdtempSync(join(tmpdir(), 'swarf-axes-')), args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_files && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 200 });
  await wait(1500);
  // the alerts an import says (api.show.alert), caught from here on
  await page.evaluate(() => { const a = window.kiri.api, was = a.show.alert; window.__said = []; a.show.alert = function (m, ...r) { window.__said.push(String(m)); return was.call(this, m, ...r); }; });
  const said = () => page.evaluate(() => window.__said.splice(0));
  const closeCard = () => page.evaluate(() => { const b = [...document.querySelectorAll('button[id^="obj-up-ok-"]')].pop(); if (b) b.click(); });
  const sizes = () => page.evaluate(() => window.kiri.api.widgets.all().map(w => { const b = w.getBoundingBox(); return { size: [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map(v => +v.toFixed(2)), zmin: +b.min.z.toFixed(2) }; }));
  const is = (o, x, y, z) => o.length === 1 && Math.abs(o[0].size[0] - x) < 0.05 && Math.abs(o[0].size[1] - y) < 0.05 && Math.abs(o[0].size[2] - z) < 0.05 && Math.abs(o[0].zmin) < 0.05;
  async function load(text, name, thick) {
    await closeCard();
    await page.evaluate((text, name) => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); a.platform.load_files([new File([text], name)]); }, text, name);
    await wait(1200);
    if (thick) await page.evaluate(t => { const i = [...document.querySelectorAll('input[id^="dxf-depth-"]')].pop(); if (i) { i.value = String(t); i.dispatchEvent(new Event('input', { bubbles: true })); } const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'make parts' && b.offsetParent); b && b.click(); }, thick);
    await wait(2000);
    return page.evaluate(() => window.kiri.api.widgets.all().map(w => { const b = w.getBoundingBox(); return { name: w.meta.file, size: [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].map(v => +v.toFixed(2)), zmin: +b.min.z.toFixed(2) }; }));
  }
  const d = await load(dxf, 'rhino-board.dxf', 12);
  console.log('  dxf:', JSON.stringify(d));
  check(d.length === 1, `DXF: one part, the spline and the polyline joined (${d.length})`);
  check(d[0] && Math.abs(d[0].size[0] - 100) < 0.5 && d[0].size[1] > 50 + 10 && d[0].size[1] < 50 + 12, `DXF: 100 wide, 50 + the bow deep (${d[0] && d[0].size.slice(0, 2)})`);
  check(d[0] && Math.abs(d[0].size[2] - 12) < 0.05 && Math.abs(d[0].zmin) < 0.05, `DXF: the typed 12 mm thick, on the bed (${d[0] && d[0].size[2]} thick from Z ${d[0] && d[0].zmin})`);
  check(d[0] && d[0].name === 'rhino-board.dxf', `DXF: one piece keeps the file's name ("${d[0] && d[0].name}")`);
  const o = await load(obj, 'rhino-box.obj');
  console.log('  obj:', JSON.stringify(o));
  check(o.length === 1 && Math.abs(o[0].size[0] - 100) < 0.05 && Math.abs(o[0].size[1] - 60) < 0.05 && Math.abs(o[0].size[2] - 10) < 0.05, `OBJ (Y up): lies flat, 100 x 60 x 10 (${o[0] && o[0].size})`);
  // the card: size in shop units, which face is up, Y up checked
  const card = await page.evaluate(() => { const c = [...document.querySelectorAll('.swarf-obj-up')].pop(); return c && c.offsetParent ? { text: c.textContent.replace(/\s+/g, ' '), y: c.querySelector('input[value="y"]').checked } : null; });
  console.log('  card:', JSON.stringify(card));
  check(!!card && card.y && /comes in at .*100.*60.*10.*tall.*face is up/.test(card.text), `OBJ: the card says the size and the face up, Y up picked`);
  await closeCard();
  const pick = up => page.evaluate(up => { const r = [...document.querySelectorAll(`.swarf-obj-up input[value="${up}"]`)].pop(); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, up);
  const oz = await load(objZ, 'rhino-zup.obj');
  check(is(oz, 100, 10, 60), `OBJ (Z up, read Y up): on its edge by default, 100 x 10 x 60 (${oz[0] && oz[0].size})`);
  await pick('z'); await wait(500);
  const oz2 = await sizes();
  check(is(oz2, 100, 60, 10), `OBJ: Z up stands it flat in place, 100 x 60 x 10 on the bed (${oz2[0] && oz2[0].size} from Z ${oz2[0] && oz2[0].zmin})`);
  const cardText = await page.evaluate(() => [...document.querySelectorAll('.swarf-obj-up')].pop().textContent);
  check(/10\b.*tall/.test(cardText.replace(/\s+/g, ' ')), `OBJ: the card's size follows the turn`);
  await pick('y'); await wait(500);
  const oz3 = await sizes();
  check(is(oz3, 100, 10, 60), `OBJ: Y up again turns it back on its edge (${oz3[0] && oz3[0].size})`);
  await pick('z'); await wait(300);
  await closeCard(); await wait(300);
  await page.evaluate(() => window.kiri.api.doit.undo()); await wait(500);
  const oz4 = await sizes();
  check(is(oz4, 100, 10, 60), `OBJ: undo takes the flip back after the card closed (${oz4[0] && oz4[0].size})`);
  await page.evaluate(() => window.kiri.api.doit.redo()); await wait(500);
  const oz5 = await sizes();
  check(is(oz5, 100, 60, 10), `OBJ: redo flips it flat again (${oz5[0] && oz5[0].size})`);
  await said();
  const d2 = await load(dxfAt('-292.1', '-282.1'), 'two-heights.dxf', 12);
  const s2 = await said();
  console.log('  said:', JSON.stringify(s2));
  check(d2.length === 1 && Math.abs(d2[0].size[2] - 12) < 0.05, `DXF two heights: still one part 12 thick (${d2[0] && d2[0].size})`);
  check(s2.some(m => /^drawn at 2 heights: projected flat onto the board, (12(\.0+)? mm|0\.47\d* in) thick$/.test(m)), `DXF two heights: the note says 2 heights and 12 mm`);
  const d1 = await load(dxfAt('-292.1', '-292.1'), 'one-height.dxf', 12);
  const s1 = await said();
  check(d1.length === 1 && !s1.some(m => /^drawn at \d+ heights/.test(m)), `DXF one elevation: no heights note (${JSON.stringify(d1)} ${JSON.stringify(s1)})`);
  const d3 = await load(dxfLw(Z), 'lw-one-height.dxf', 12);
  const s3 = await said();
  check(d3.length >= 1 && !s3.some(m => /^drawn at \d+ heights/.test(m)), `DXF LWPOLYLINE + spline at one elevation: no heights note (${JSON.stringify(s3)})`);
  const d4 = await load(dxfLw('-282.1'), 'lw-two-heights.dxf', 12);
  const s4 = await said();
  check(d4.length >= 1 && s4.some(m => /^drawn at 2 heights/.test(m)), `DXF LWPOLYLINE 10 mm above the spline: the note says 2 heights (${JSON.stringify(s4)})`);
  check(!errors.length, `no page errors ${errors.slice(0, 3).join(' | ')}`);
} finally {
  await browser.close();
}
console.log(bad.length ? `\n${bad.length} FAILED` : '\nPASS');
process.exit(bad.length ? 1 : 0);
