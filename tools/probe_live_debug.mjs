import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const stlB64 = readFileSync('/Users/philrenato/Desktop/1.stl').toString('base64');
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport:{width:1600,height:1000}, args:['--enable-webgl','--use-gl=angle','--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    const log = [];
    page.on('console', m => {
        const t = m.text();
        if (t.match(/error|Error|exception|fail|throw|slice|toolpath|paths|rough|preview|worker|wasm/i))
            log.push({ t: m.type(), m: t });
    });
    page.on('pageerror', e => log.push({ t: 'pageerror', m: e.message }));

    await page.goto('https://renato.design/swarf-app/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 6000));
    await page.waitForFunction(() => !!(window.kiri && window.kiri.api), { timeout: 25000 });
    await new Promise(r => setTimeout(r, 3000));

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

    // force isCamMode by checking state
    const preState = await page.evaluate(() => {
        const api = window.kiri.api;
        return {
            mode: api.conf.get().mode,
            viewIsArrange: api.view.is_arrange?.(),
            viewIsPreview: api.view.is_preview?.(),
            widgetCount: api.widgets.all().length,
            selectedCount: api.selection.count(),
            hasClient: typeof api.client === 'object',
            hasFunction: typeof api.function === 'object',
            hasFnPrint: typeof api.function?.print === 'function'
        };
    });
    console.log('preState:', JSON.stringify(preState));

    // Click toolpaths
    await page.evaluate(() => document.getElementById('act-paths')?.click());
    // wait for any slice event or error
    const evts = await page.evaluate(async () => {
        const evts = [];
        const api = window.kiri.api;
        ['preview.end', 'preview.error', 'slice.error', 'slice.end', 'slice.begin', 'preview.begin', 'function.cancel'].forEach(e => {
            api.event.on(e, () => evts.push(e));
        });
        await new Promise(r => setTimeout(r, 15000));
        return evts;
    });
    console.log('events:', JSON.stringify(evts));

    console.log('log:');
    for (const l of log.slice(-30)) console.log(' ', l.t + ':', l.m.slice(0, 180));
} finally { await browser.close(); }
