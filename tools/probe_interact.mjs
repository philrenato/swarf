import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const stlB64 = readFileSync('/Users/philrenato/Desktop/1.stl').toString('base64');
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport:{width:1600,height:1000}, args:['--enable-webgl','--use-gl=angle','--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    await page.goto('http://localhost:8181/kiri/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.kiri && window.kiri.api), { timeout: 15000 });
    await new Promise(r => setTimeout(r, 2500));

    // load STL
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

    const state = await page.evaluate(() => {
        const api = window.kiri.api;
        const ui = api.ui;
        const conf = api.conf.get();
        // try to access freeLayout
        const fl = ui?.freeLayout;
        const al = ui?.autoLayout;
        // peek the context buttons
        const rotBtn = document.getElementById('context-rotate-panel');
        const scaleBtn = document.getElementById('context-scale-panel');
        const rotPanel = document.getElementById('panel-rotate');
        const scalePanel = document.getElementById('panel-scale');
        return {
            freeLayoutExists: !!fl,
            freeLayoutChecked: fl?.checked,
            freeLayoutNodeType: fl?.tagName || typeof fl,
            autoLayoutChecked: al?.checked,
            controlFreeLayout: conf?.controller?.freeLayout,
            controlAutoLayout: conf?.controller?.autoLayout,
            rotBtn: !!rotBtn,
            rotPanel: !!rotPanel,
            rotPanelHidden: rotPanel?.classList?.contains('hide'),
            scaleBtn: !!scaleBtn,
            scalePanel: !!scalePanel,
            scalePanelHidden: scalePanel?.classList?.contains('hide')
        };
    });

    console.log(JSON.stringify(state, null, 2));

    // try to click the edit menu then rotate to see if panel opens
    await page.evaluate(() => document.getElementById('context-rotate-panel')?.click());
    await new Promise(r => setTimeout(r, 400));
    const afterClick = await page.evaluate(() => {
        const rp = document.getElementById('panel-rotate');
        return { hiddenAfterClick: rp?.classList?.contains('hide'), computedDisplay: rp ? window.getComputedStyle(rp).display : null };
    });
    console.log('after click rotate:', JSON.stringify(afterClick));
} finally { await browser.close(); }
