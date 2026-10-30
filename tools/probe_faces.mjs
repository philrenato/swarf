// Faces point out: an outline drawn clockwise and one drawn counter-clockwise
// (SVG paths, and DRAW's pen both ways) make solids with positive volume, so
// their tops face up and light like the rest (Phil 10-27: "too dark").
//   node tools/probe_faces.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME || (process.env.HOME + '/.local/bin/chrome-for-testing');
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.SwarfVector), { timeout: 90000, polling: 200 });
  await new Promise(r => setTimeout(r, 1500));
  const vols = await page.evaluate(() => {
    const a = window.kiri.api;
    for (const w of a.widgets.all()) a.platform.delete(w);
    const svg = d => `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><path d="${d}" fill="#000"/></svg>`;
    a.platform.load_svg(svg('M0,0 L80,0 L80,30 L0,30 Z'), 'cw-in-svg', { depth: 6, resolution: 2, segmin: 48, soup: true, dpi: 0 });
    a.platform.load_svg(svg('M0,0 L0,30 L80,30 L80,0 Z'), 'ccw-in-svg', { depth: 6, resolution: 2, segmin: 48, soup: true, dpi: 0 });
    // what DRAW writes, both ways round
    const V = window.SwarfVector;
    a.platform.load_svg(V.svgOf([{ crv: V.polyCrv([[0, 0], [50, 0], [25, 40]], true) }]), 'pen-ccw', { depth: 6, resolution: 2, segmin: 48, soup: true, dpi: 0 });
    a.platform.load_svg(V.svgOf([{ crv: V.polyCrv([[0, 0], [25, 40], [50, 0]], true) }]), 'pen-cw', { depth: 6, resolution: 2, segmin: 48, soup: true, dpi: 0 });
    return a.widgets.all().map(w => {
      const g = w.mesh.geometry.attributes.position.array; let v = 0;
      for (let i = 0; i < g.length; i += 9) v += (g[i] * (g[i + 4] * g[i + 8] - g[i + 5] * g[i + 7]) - g[i + 1] * (g[i + 3] * g[i + 8] - g[i + 5] * g[i + 6]) + g[i + 2] * (g[i + 3] * g[i + 7] - g[i + 4] * g[i + 6])) / 6;
      return [w.meta.file, +v.toFixed(1)];
    });
  });
  for (const [name, v] of vols) check(v > 0, `${name}: volume ${v} mm³`);
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `faces: ${bad.length} failed` : 'faces: ok');
process.exit(bad.length || errors.length ? 1 : 0);
