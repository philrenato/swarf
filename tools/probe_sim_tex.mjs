// Simulate shows a texture as it is cut (Phil 10-30: "is it right that simulate doesn't seem to show
// the texture as it's going?"). A 160 mm disc, 19 mm thick, its whole top marked stone wall (2.4 mm
// mortar): toolpaths, then simulate to the end. The simulated board's heightmap must carry the
// texture: its cells inside the mark vary in depth by about the mortar's depth, cells outside the
// disc stay at the top, and its surface normals follow the cut (a carved board that still shades as
// flat reads as untouched). A screenshot of the result.
//   node tools/probe_sim_tex.mjs [url]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-sim-tex';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfTex && window.SwarfTexCore), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); const s = a.conf.get(); s.process.ops = []; a.conf.save(); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="160mm" height="160mm" viewBox="0 0 160 160"><circle cx="80" cy="80" r="80" fill="#000"/></svg>', 'circle', { depth: 19, resolution: 2, segmin: 48, soup: true, dpi: 0 }); });
  await wait(1200);
  // TEX: the region tool fills the disc's top; stone wall, the 1/4 in ball
  await page.click('#swarf-step-tex');
  await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 15000 });
  await page.evaluate(() => {
    const S = window.__swarfTex.state(), C = window.SwarfTexCore, p = S.parts[0];
    S.sel = 0;
    const g = C.newGrid(p.box[0] - 2, p.box[1] - 2, p.box[2] + 2, p.box[3] + 2, 0.5);
    C.paintWhere(g, (x, y) => Math.hypot(x - (p.box[0] + p.box[2]) / 2, y - (p.box[1] + p.box[3]) / 2) < 78, 1);
    p.marks.push({ id: 'simtex', made: 'region', region: g, xf: C.IDENTITY.slice(), fill: C.newFill('stone', { tool: 1018, origin: [0, 0] }), ver: 1 });
    S.mark = 0; p.dirty = true;
  });
  await page.click('#tx-done');
  await wait(1000);
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  const pv = await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', () => res('preview.end')); setTimeout(() => res('timeout'), 120000); }));
  check(pv === 'preview.end', `toolpaths (${pv})`);
  // simulate, fast, to the end
  await page.evaluate(() => { const b = [...document.querySelectorAll('.swarf-step, #act-animate, button')].find(e => /^\s*simulate\s*$/i.test(e.textContent)); b && b.click(); });
  await page.waitForFunction(() => window.__swarfSimStock, { timeout: 30000 }).catch(() => {});
  await wait(800);
  await page.evaluate(() => { window.__swarfCustomSpeed = 4000; window.dispatchEvent(new Event('swarf.speed.custom')); });
  // done when the board stops changing for 3 s
  let last = '', still = 0;
  for (let i = 0; i < 240 && still < 3; i++) {
    await wait(1000);
    const sig = await page.evaluate(() => { const P = window.__swarfSimStock && window.__swarfSimStock.geometry.attributes.position.array; if (!P) return ''; let s = 0; for (let k = 2; k < P.length; k += 97) s += P[k]; return s.toFixed(3); });
    if (sig && sig === last) still++; else still = 0;
    last = sig;
  }
  const m = await page.evaluate(() => {
    const mesh = window.__swarfSimStock, P = mesh.geometry.attributes.position.array, N = mesh.geometry.attributes.normal && mesh.geometry.attributes.normal.array;
    const w = window.kiri.api.widgets.all()[0], g = w.mesh.geometry; g.computeBoundingBox();
    // the heightmap is in the stock's frame, centered; the disc sits at the stock's middle
    let top = -Infinity; for (let k = 2; k < P.length; k += 3) top = Math.max(top, P[k]);
    let n = 0, sum = 0, sum2 = 0, lo = Infinity, outN = 0, outCut = 0, tilted = 0, nin = 0;
    const cx = (() => { let a = Infinity, b = -Infinity; for (let k = 0; k < P.length; k += 3) { a = Math.min(a, P[k]); b = Math.max(b, P[k]); } return (a + b) / 2; })();
    const cy = (() => { let a = Infinity, b = -Infinity; for (let k = 1; k < P.length; k += 3) { a = Math.min(a, P[k]); b = Math.max(b, P[k]); } return (a + b) / 2; })();
    const step = Math.hypot(P[3] - P[0], P[4] - P[1]);
    for (let k = 0; k < P.length; k += 3) {
      const r = Math.hypot(P[k] - cx, P[k + 1] - cy), d = top - P[k + 2];
      if (r < 60) { n++; sum += d; sum2 += d * d; lo = Math.max(lo === Infinity ? 0 : lo, d); if (N) { nin++; if (N[k + 2] < 0.98) tilted++; } }
      else if (r > 90 && P[k + 2] > 0.01) { outN++; if (d > 0.05) outCut++; }
    }
    const mean = sum / n, sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    // what the material shows: normals from the shader (flat shading) or stored ones
    const mat = mesh.material;
    return { cells: P.length / 3, step: +step.toFixed(3), mean: +mean.toFixed(3), sd: +sd.toFixed(3), deepest: +lo.toFixed(3), outN, outCut, tiltedNormals: nin ? +(tilted / nin).toFixed(3) : 0, flat: !!mat.flatShading, mtype: mat.type };
  });
  console.log('   sim heightmap:', JSON.stringify(m));
  check(m.step > 0 && m.step <= 0.5, `the heightmap is fine enough for the texture: ${m.step} mm cells (${m.cells} of them)`);
  check(m.sd > 0.3 && m.deepest > 1.8 && m.deepest < 2.6, `inside the mark the simulated board varies: depth ${m.mean} ± ${m.sd} mm, deepest ${m.deepest} (stone wall's mortar is 2.4)`);
  check(m.outN > 100 && m.outCut === 0, `outside the disc nothing is cut (${m.outCut} of ${m.outN} cells)`);
  check(m.flat || m.tiltedNormals > 0.2, `the carving shades as carved (${m.flat ? 'normals from the shader' : `${(m.tiltedNormals * 100).toFixed(0)}% of normals inside tilt`}, ${m.mtype})`);
  await page.evaluate(() => { const v = window.kiri.api.space || null; try { window.kiri.api.space.view.top && window.kiri.api.space.view.top(); } catch (e) { } });
  await wait(800);
  await page.screenshot({ path: `${OUT}-done.png` });
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `sim tex: ${bad.length} failed, ${errors.length} page errors` : 'sim tex: ok');
process.exit(bad.length || errors.length ? 1 : 0);
