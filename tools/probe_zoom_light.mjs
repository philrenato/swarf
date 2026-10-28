// Zoomed out, the part is still lit (Phil 10-27: "when done drawing and we zoom
// away things are too dark"). The floor fog started a fixed distance from the
// CAMERA, so zooming out fogged the part to black. Now parts take no fog and
// the fog band starts past what the camera looks at, at any zoom.
//   node tools/probe_zoom_light.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME || '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.moto?.space), { timeout: 90000, polling: 200 });
  await wait(2000);
  await page.evaluate(() => { const a = window.kiri.api; a.devices.select('ShopBot.Basic'); });
  await wait(800);
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="200mm" viewBox="0 0 300 200"><rect width="300" height="200" fill="#000"/></svg>', 'slab', { depth: 6, resolution: 2, segmin: 48, soup: true, dpi: 0 }); a.platform.deselect(); });
  await wait(1500);
  const c = await page.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.move(c[0], c[1]);
  for (let i = 0; i < 12; i++) { await page.mouse.wheel({ deltaY: 300 }); await wait(60); }
  await wait(800);
  const r = await page.evaluate(() => {
    const s = window.moto.space; let sc = s.internals().platform; while (sc.parent) sc = sc.parent; const w = window.kiri.api.widgets.all()[0];
    const mats = Array.isArray(w.mesh.material) ? w.mesh.material : [w.mesh.material];
    const cam = s.internals().camera;
    return { fogOff: mats.every(m => m.fog === false), near: sc && sc.fog ? Math.round(sc.fog.near) : null, far: sc && sc.fog ? Math.round(sc.fog.far) : null, cam: cam ? Math.round(cam.position.length()) : null };
  });
  check(r.fogOff, 'the part takes no fog');
  check(r.near > r.cam * 0.9, `zoomed out, the fog starts past the part (near ${r.near}, far ${r.far}, camera ${r.cam ?? '?'} from the origin)`);
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `zoom light: ${bad.length} failed` : 'zoom light: ok');
process.exit(bad.length || errors.length ? 1 : 0);
