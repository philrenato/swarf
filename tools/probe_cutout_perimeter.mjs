// The toolpaths view shows a cut-out all the way round (Phil 11-09, test.stl: a 168 x 610 mm board
// with one curved edge showed the trail only along the curve, so it read as half cut; simulate was
// right). The lightstream dropped every move longer than 50 mm as a rapid, and a straight side is one
// move. It now takes the stack's cut layer ('milling') at any length. For a plain box, where every
// side is one long move, and a board with one wavy edge: the trail spans the part plus the bit on
// both axes, and holds nothing of the rapids, the bit or the arrows.
//   node tools/probe_cutout_perimeter.mjs [url] [extra.stl]
import puppeteer from 'puppeteer-core';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const url = process.argv[2] || 'http://localhost:8080/kiri/';
const extra = process.argv[3];
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };

// ascii STL of an extruded outline (xy pairs, ccw, star-shaped about its centroid), height h
function extrudeSTL(pts, h) {
  const f = [];
  const tri = (a, b, c) => f.push(`facet normal 0 0 0\nouter loop\nvertex ${a.join(' ')}\nvertex ${b.join(' ')}\nvertex ${c.join(' ')}\nendloop\nendfacet`);
  const n = pts.length;
  const cx = pts.reduce((s, p) => s + p[0], 0) / n, cy = pts.reduce((s, p) => s + p[1], 0) / n;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
    tri([x1, y1, 0], [x2, y2, 0], [x2, y2, h]);
    tri([x1, y1, 0], [x2, y2, h], [x1, y1, h]);
    tri([cx, cy, h], [x1, y1, h], [x2, y2, h]);
    tri([cx, cy, 0], [x2, y2, 0], [x1, y1, 0]);
  }
  return `solid p\n${f.join('\n')}\nendsolid p\n`;
}
const box = extrudeSTL([[0, 0], [120, 0], [120, 80], [0, 80]], 12);
const wavy = (() => { const p = [[0, 0]]; for (let i = 0; i <= 40; i++) { const y = i * 300 / 40; p.push([60 - 20 * (1 - Math.cos(y / 300 * 2 * Math.PI)) / 2, y]); } p.push([0, 300]); return extrudeSTL(p, 18); })();

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1440, height: 900 }, userDataDir: mkdtempSync(join(tmpdir(), 'swarf-cutout-')), args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_files && window.__swarfLSSpan && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 200 });
  await wait(1500);
  async function part(data, name, label, straight = [0, 1, 2, 3]) {
    await page.evaluate((b64, name) => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); a.conf.get().process.ops = []; a.platform.load_files([new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], name)]); }, Buffer.from(data).toString('base64'), name);
    await wait(2500);
    const st = await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', () => res('ok')); window.kiri.api.event.on('preview.error', e => res('error ' + e)); document.getElementById('act-paths').click(); setTimeout(() => res('timeout'), 120000); }));
    check(st === 'ok', `${label}: toolpaths ${st}`);
    await wait(800);
    const r = await page.evaluate(() => {
      const w = window.kiri.api.widgets.all()[0], bb = w.getBoundingBox();
      const tool = window.kiri.api.conf.get().tools.find(t => t.id === (window.kiri.api.conf.get().process.ops.find(o => o.type === 'rough') || {}).tool);
      const dia = tool ? tool.flute_diam * (tool.metric ? 1 : 25.4) : 6.35;
      // the cut layer's own extent, the same frame as the trail
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, cutSegs = 0, longest = 0;
      for (const m of window.kiri.api.stacks.getStack('print').obj.meshes) {
        if (m.userData.layer !== 'milling') continue;
        const a = m.geometry.attributes.position.array;
        for (let i = 0; i + 5 < a.length; i += 6) { cutSegs++; longest = Math.max(longest, Math.hypot(a[i + 3] - a[i], a[i + 4] - a[i + 1])); for (const k of [0, 3]) { x0 = Math.min(x0, a[i + k]); x1 = Math.max(x1, a[i + k]); y0 = Math.min(y0, a[i + k + 1]); y1 = Math.max(y1, a[i + k + 1]); } }
      }
      // the middle of each side of the cut's box: the trail passes through each (a straight side is one long move)
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const sides = [[mx, y0], [mx, y1], [x0, my], [x1, my]].map(([x, y]) => +window.__swarfLSNear(x, y).toFixed(2));
      return { sides, w: bb.max.x - bb.min.x, d: bb.max.y - bb.min.y, dia, span: window.__swarfLSSpan(), cut: { x0, x1, y0, y1 }, cutSegs, longest, kept: window.__swarfLSPrePop };
    });
    const sw = r.span.x1 - r.span.x0, sd = r.span.y1 - r.span.y0;
    console.log(`  ${label}: part ${r.w.toFixed(1)} x ${r.d.toFixed(1)}, bit ${r.dia.toFixed(2)}; cuts ${r.cutSegs} segments, longest ${r.longest.toFixed(1)} mm; trail ${sw.toFixed(1)} x ${sd.toFixed(1)}, ${r.kept} kept`);
    check(r.longest > 50, `${label}: the cut has moves longer than 50 mm (what the old rule dropped)`);
    check(straight.every(k => r.sides[k] < 0.5), `${label}: the trail passes the middle of every straight side of the cut (off by ${r.sides.join(', ')} mm)`);
    check(sw >= r.w + r.dia * 0.9 && sd >= r.d + r.dia * 0.9, `${label}: the trail goes round the whole part (${sw.toFixed(1)} x ${sd.toFixed(1)} >= part + bit)`);
    const near = (a, b) => Math.abs(a - b) < 0.05;
    check(near(r.span.x0, r.cut.x0) && near(r.span.x1, r.cut.x1) && near(r.span.y0, r.cut.y0) && near(r.span.y1, r.cut.y1), `${label}: and no further than the cuts (no rapids, bit or arrows in it)`);
  }
  await part(box, 'box.stl', 'box 120 x 80');
  await part(wavy, 'wavy.stl', 'board with one wavy edge', [0, 1, 2]);   // its right side bows in
  if (extra) await part(readFileSync(extra), extra.split('/').pop(), extra.split('/').pop(), []);
  check(!errors.length, `no page errors ${errors.slice(0, 3).join(' | ')}`);
} finally {
  await browser.close();
}
console.log(bad.length ? `\n${bad.length} FAILED` : '\nPASS');
process.exit(bad.length ? 1 : 0);
