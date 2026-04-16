import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const stlB64 = readFileSync('/Users/philrenato/Desktop/1.stl').toString('base64');
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport:{width:1600,height:1000}, args:['--enable-webgl','--use-gl=angle','--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    await page.goto('http://localhost:8181/kiri/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.kiri && window.kiri.api), { timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));
    await page.evaluate(async (b64) => {
        const bin = atob(b64); const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        const dv = new DataView(buf.buffer);
        const n = dv.getUint32(80, true);
        const verts = new Float32Array(n * 9);
        let vi = 0;
        for (let i = 0; i < n; i++) {
            const off = 84 + i * 50 + 12;
            for (let v = 0; v < 9; v++) verts[vi++] = dv.getFloat32(off + v * 4, true);
        }
        const w = window.kiri.api.new.widget();
        w.loadVertices(verts);
        window.kiri.api.platform.add(w);
    }, stlB64);
    await new Promise(r => setTimeout(r, 2000));
    // toolpaths
    await page.evaluate(() => document.getElementById('act-paths')?.click());
    await page.evaluate(async () => new Promise(resolve => {
        window.kiri.api.event.on('preview.end', resolve);
        setTimeout(resolve, 30000);
    }));
    await new Promise(r => setTimeout(r, 1500));
    // simulate
    await page.evaluate(() => document.getElementById('act-animate')?.click());
    await new Promise(r => setTimeout(r, 6000));  // let animation run a bit
    // fit
    await page.evaluate(() => {
        const meshes = window.kiri.api.widgets.all().map(w => w.mesh);
        if (meshes.length && window.moto.space.view.fit) window.moto.space.view.fit(undefined, { padding: 1.8 });
    });
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: '/tmp/swarf-simulate.png' });
    const state = await page.evaluate(() => {
        const api = window.kiri.api;
        return {
            viewIsAnimate: api.view.is_animate?.(),
            viewName: api.view.get?.(),
            sceneChildCount: window.moto?.space?.world?.children?.length
        };
    });
    console.log(JSON.stringify(state, null, 2));
} finally { await browser.close(); }
