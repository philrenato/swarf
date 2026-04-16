import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const stlB64 = readFileSync('/Users/philrenato/Desktop/1.stl').toString('base64');
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport:{width:1600,height:1000}, args:['--enable-webgl','--use-gl=angle','--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    await page.goto('http://localhost:8181/kiri/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.kiri && window.kiri.api), { timeout: 15000 });
    await new Promise(r => setTimeout(r, 2500));
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
    await new Promise(r => setTimeout(r, 1500));

    const pre = await page.evaluate(() => {
        const w = window.kiri.api.widgets.all()[0];
        const b = w.getBoundingBox();
        return {
            dim: { x: b.max.x-b.min.x, y: b.max.y-b.min.y, z: b.max.z-b.min.z },
            trackRot: w.track?.rot && { x: w.track.rot.x, y: w.track.rot.y, z: w.track.rot.z },
            isArrange: window.kiri.api.view.is_arrange(),
            meshCount: window.kiri.api.widgets.all().length
        };
    });
    console.log('pre:', JSON.stringify(pre));

    // direct call: api.selection.rotate with +90 X
    const mid = await page.evaluate(() => {
        try {
            window.kiri.api.selection.rotate(Math.PI / 2, 0, 0);
        } catch (e) { return { err: e.message }; }
        const w = window.kiri.api.widgets.all()[0];
        const b = w.getBoundingBox();
        return {
            dim: { x: b.max.x-b.min.x, y: b.max.y-b.min.y, z: b.max.z-b.min.z },
            trackRot: w.track?.rot && { x: w.track.rot.x, y: w.track.rot.y, z: w.track.rot.z }
        };
    });
    console.log('after api.selection.rotate(90°X):', JSON.stringify(mid));

    // try the button
    await page.evaluate(() => document.getElementById('context-rotate-panel')?.click());
    await new Promise(r => setTimeout(r, 300));
    await page.click('#rot_x_gt');
    await new Promise(r => setTimeout(r, 400));
    const post = await page.evaluate(() => {
        const w = window.kiri.api.widgets.all()[0];
        const b = w.getBoundingBox();
        return {
            dim: { x: b.max.x-b.min.x, y: b.max.y-b.min.y, z: b.max.z-b.min.z },
            trackRot: w.track?.rot && { x: w.track.rot.x, y: w.track.rot.y, z: w.track.rot.z }
        };
    });
    console.log('after rot_x_gt click:', JSON.stringify(post));
} finally { await browser.close(); }
