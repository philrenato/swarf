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

    // click edit menu, don't open a panel
    await page.screenshot({ path: '/tmp/swarf-select-1-initial.png' });
    // open edit menu to see if it's visible
    await page.evaluate(() => {
        const editMenu = Array.from(document.querySelectorAll('.top-menu > div, .top-menu span, .top-menu button, [class*="top"]'))
            .find(e => e.textContent?.trim()?.toLowerCase()?.startsWith('edit'));
        if (editMenu) editMenu.click();
    });
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: '/tmp/swarf-select-2-edit-menu.png' });
} finally { await browser.close(); }
