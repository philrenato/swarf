import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'fs';
const CHROME = process.env.CHROME || '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PAGE = process.argv[2] || 'http://127.0.0.1:8139/swarf-app/';
const OUT = process.argv[3];
const b = await puppeteer.launch({ protocolTimeout: 60000, executablePath: CHROME, headless: 'new', args: ['--window-size=1200,900'] });
const page = await b.newPage(); await page.setViewport({ width: 1200, height: 900 });
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.THREE && window.THREE.WebGLRenderer && window.kiri && window.kiri.api && window.SwarfShopBotModel, { timeout: 90000 });
await new Promise(r => setTimeout(r, 6000));   // the service worker may reload the page once
await page.waitForFunction(() => window.THREE && window.THREE.WebGLRenderer && window.kiri && window.kiri.api && window.SwarfShopBotModel, { timeout: 90000 });
// one model on its own canvas, from about where the photos stood (tools/look_shopbot.mjs [url] [outdir])
const MR1 = process.env.MODEL === 'mr1';
const shots = MR1 ? [
  ['mr1-front', [-900, -1500, 900], [0, 0, 100], 0, 60],
  ['mr1-side', [-1700, 0, 300], [0, 0, 100], 200, 120],
  ['mr1-back-left', [900, 1400, 1000], [0, 0, 100], -200, 20],
] : [
  ['front-right', [-1900, -2600, 1500], [0, 600, 100], 600, 120],
  ['front', [-2300, 300, 700], [0, 600, 250], 300, 60],
  ['chainL', [-1500, -1400, 1300], [0, 600, 300], 100, 40],
  ['chainR', [-1500, -1400, 1300], [0, 600, 300], 1150, 180],
  ['side', [0, -2800, 300], [-200, 600, 0], 600, 100],
];
await page.evaluate(v => { window.__lbMR1 = v; }, MR1);
for (const [name, cam, tgt, y, z] of shots) {
  await page.evaluate((cam, tgt, y, z) => {
    const T = window.THREE;
    let c = document.getElementById('lookbot');
    if (!c) { c = document.createElement('canvas'); c.id = 'lookbot'; c.style.cssText = 'position:fixed;inset:0;width:1200px;height:900px;z-index:99999;background:#1a1420'; document.body.append(c); }
    const r = window.__lbR || (window.__lbR = new T.WebGLRenderer({ canvas: c, antialias: true, preserveDrawingBuffer: true }));
    r.setSize(1200, 900, false); r.setClearColor(0x1a1420, 1);
    const s = new T.Scene();
    if (window.__lbMR1) { const m = window.__lbM || (window.__lbM = window.SwarfMR1Model.build(T)); s.add(m.root); m.set(y * 0.6, y, z); }
    else { const m = window.__lbM || (window.__lbM = window.SwarfShopBotModel.build(T)); s.add(m.gantry, m.bed); m.bed.position.set(-900, 0, 0); m.set(y, z); }
    const cm = new T.PerspectiveCamera(40, 1200 / 900, 1, 50000); cm.up.set(0, 0, 1);
    cm.position.set(...cam); cm.lookAt(new T.Vector3(...tgt));
    r.render(s, cm);
    let tris = 0; s.traverse(o => { if (o.isMesh) { const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
    window.__lbTris = tris;
    return c.toDataURL('image/png');
  }, cam, tgt, y, z).then(u => writeFileSync(`${OUT}/bot-${name}.png`, Buffer.from(u.split(',')[1], 'base64')));
}
console.log('triangles', await page.evaluate(() => window.__lbTris));
await b.close();
