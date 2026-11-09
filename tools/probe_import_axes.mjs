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

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1440, height: 900 }, userDataDir: mkdtempSync(join(tmpdir(), 'swarf-axes-')), args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_files && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 200 });
  await wait(1500);
  async function load(text, name, thick) {
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
  check(!errors.length, `no page errors ${errors.slice(0, 3).join(' | ')}`);
} finally {
  await browser.close();
}
console.log(bad.length ? `\n${bad.length} FAILED` : '\nPASS');
process.exit(bad.length ? 1 : 0);
