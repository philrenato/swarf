// A rough step marked inside only stays inside the part: on a 120 x 80 x 20 mm box with a
// 40 x 30 mm pocket 10 mm deep, the rough's cuts lie within the part's outline (the pocket is
// cleared, the outside is not traced). The same step without inside only still traces the outside.
//   node tools/probe_rough_inside.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const url = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };

// ascii STL: a box with a pocket in its top, built on a grid so no edge meets another mid-way
function pocketBoxSTL() {
  const f = [];
  const tri = (a, b, c) => f.push(`facet normal 0 0 0\nouter loop\nvertex ${a.join(' ')}\nvertex ${b.join(' ')}\nvertex ${c.join(' ')}\nendloop\nendfacet`);
  const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };   // ccw seen from outside
  const X = [0, 40, 80, 120], Y = [0, 25, 55, 80], H = 20, F = 10;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const [x0, x1, y0, y1] = [X[i], X[i + 1], Y[j], Y[j + 1]];
    const z = i === 1 && j === 1 ? F : H;
    quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]);   // top (or pocket floor)
    quad([x0, y0, 0], [x0, y1, 0], [x1, y1, 0], [x1, y0, 0]);   // bottom
  }
  for (let i = 0; i < 3; i++) {
    const [a, b] = [X[i], X[i + 1]], [c, d] = [Y[i], Y[i + 1]];
    quad([a, 0, 0], [b, 0, 0], [b, 0, H], [a, 0, H]);         // south
    quad([b, 80, 0], [a, 80, 0], [a, 80, H], [b, 80, H]);     // north
    quad([120, c, 0], [120, d, 0], [120, d, H], [120, c, H]); // east
    quad([0, d, 0], [0, c, 0], [0, c, H], [0, d, H]);         // west
  }
  quad([80, 25, F], [40, 25, F], [40, 25, H], [80, 25, H]);   // pocket walls, facing in
  quad([40, 55, F], [80, 55, F], [80, 55, H], [40, 55, H]);
  quad([40, 25, F], [40, 55, F], [40, 55, H], [40, 25, H]);
  quad([80, 55, F], [80, 25, F], [80, 25, H], [80, 55, H]);
  return `solid p\n${f.join('\n')}\nendsolid p\n`;
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1440, height: 900 }, userDataDir: mkdtempSync(join(tmpdir(), 'swarf-rough-in-')), args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_files && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(b64 => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); a.platform.load_files([new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'pocketbox.stl')]); }, Buffer.from(pocketBoxSTL()).toString('base64'));
  await wait(2500);
  async function rough(inside) {
    await page.evaluate(inside => {
      const a = window.kiri.api, p = a.conf.get().process, tools = a.conf.get().tools;
      const tool = (tools.find(t => t.id === p.camRoughTool) || tools.find(t => t.type === 'endmill') || tools[0]).id;
      p.ops = [{ type: 'rough', tool, direction: 'climb', spindle: 12000, down: 5, step: 0.4, rate: 1000, plunge: 250, leave: 0, leavez: 0, all: false, flats: false, inside, omitthru: false, ov_topz: 0, ov_botz: 0 }];
    }, inside);
    const st = await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', () => res('ok')); window.kiri.api.event.on('preview.error', e => res('error ' + e)); document.getElementById('act-paths').click(); setTimeout(() => res('timeout'), 120000); }));
    check(st === 'ok', `inside ${inside}: toolpaths ${st}`);
    await wait(800);
    return page.evaluate(() => {
      const a = window.kiri.api, bb = a.widgets.all()[0].getBoundingBox();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, segs = 0;
      for (const m of a.stacks.getStack('print').obj.meshes) {
        if (m.userData.layer !== 'milling') continue;
        const p = m.geometry.attributes.position.array;
        for (let i = 0; i + 5 < p.length; i += 6) { segs++; for (const k of [0, 3]) { x0 = Math.min(x0, p[i + k]); x1 = Math.max(x1, p[i + k]); y0 = Math.min(y0, p[i + k + 1]); y1 = Math.max(y1, p[i + k + 1]); } }
      }
      return { segs, cut: { x0, x1, y0, y1 }, part: { x0: bb.min.x, x1: bb.max.x, y0: bb.min.y, y1: bb.max.y } };
    });
  }
  const say = r => `cuts x ${r.cut.x0.toFixed(1)}..${r.cut.x1.toFixed(1)}, y ${r.cut.y0.toFixed(1)}..${r.cut.y1.toFixed(1)}; part x ${r.part.x0.toFixed(1)}..${r.part.x1.toFixed(1)}, y ${r.part.y0.toFixed(1)}..${r.part.y1.toFixed(1)} (${r.segs} segments)`;
  const within = r => r.cut.x0 > r.part.x0 + 1 && r.cut.x1 < r.part.x1 - 1 && r.cut.y0 > r.part.y0 + 1 && r.cut.y1 < r.part.y1 - 1;
  const inR = await rough(true);
  console.log('  inside only:', say(inR));
  check(inR.segs > 0, 'inside only: the rough clears the pocket');
  check(within(inR), 'inside only: every cut lies inside the part\'s outline (no trace round the outside)');
  const outR = await rough(false);
  console.log('  not inside only:', say(outR));
  check(outR.cut.x0 < outR.part.x0 && outR.cut.x1 > outR.part.x1 && outR.cut.y0 < outR.part.y0 && outR.cut.y1 > outR.part.y1, 'not inside only: the rough still traces round the outside');
  check(!errors.length, `no page errors ${errors.slice(0, 3).join(' | ')}`);
} finally {
  await browser.close();
}
console.log(bad.length ? `\n${bad.length} FAILED` : '\nPASS');
process.exit(bad.length ? 1 : 0);
