import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const stlB64 = readFileSync('/Users/philrenato/Desktop/1.stl').toString('base64');
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport:{width:1600,height:1000}, args:['--enable-webgl','--use-gl=angle','--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    const log = [];
    page.on('console', m => log.push({ t: m.type(), m: m.text() }));
    page.on('pageerror', e => log.push({ t: 'pageerror', m: e.message }));
    page.on('requestfailed', r => log.push({ t: 'rf', u: r.url(), f: r.failure()?.errorText }));
    page.on('response', r => {
        if (r.status() >= 400 && r.url().includes('swarf-app')) log.push({ t: 'http'+r.status(), u: r.url() });
    });

    await page.goto('https://renato.design/swarf-app/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));  // migration reload
    await page.waitForFunction(() => !!(window.kiri && window.kiri.api), { timeout: 20000 });
    await new Promise(r => setTimeout(r, 2500));

    await page.evaluate(async (b64) => {
        const bin = atob(b64); const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        const widget = window.kiri.api.new.widget();
        const dv = new DataView(buf.buffer);
        const n = dv.getUint32(80, true);
        const verts = new Float32Array(n * 9);
        let vi = 0;
        for (let i = 0; i < n; i++) {
            const off = 84 + i * 50 + 12;
            for (let v = 0; v < 9; v++) verts[vi++] = dv.getFloat32(off + v * 4, true);
        }
        widget.loadVertices(verts);
        window.kiri.api.platform.add(widget);
    }, stlB64);
    await new Promise(r => setTimeout(r, 1500));

    await page.evaluate(() => document.getElementById('act-paths')?.click());
    const done = await page.evaluate(async () => new Promise(resolve => {
        window.kiri.api.event.on('preview.end', () => resolve({ ok: true }));
        window.kiri.api.event.on('preview.error', (e) => resolve({ ok: false, err: String(e) }));
        window.kiri.api.event.on('slice.error', (e) => resolve({ ok: false, err: String(e) }));
        setTimeout(() => resolve({ ok: false, via: 'timeout' }), 30000);
    }));
    console.log('result:', JSON.stringify(done));
    console.log('---');
    for (const l of log.slice(-30)) console.log(l.t + ':', (l.m||l.u||'').slice(0,140));
} finally { await browser.close(); }
