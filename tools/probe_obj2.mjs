import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://localhost:8181/kiri/';
const OBJ = '/Users/philrenato/Desktop/1.obj';
const objText = readFileSync(OBJ, 'utf8');

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    defaultViewport: { width: 1600, height: 1000 },
    args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const out = { console: [], errors: [], steps: {} };
try {
    const page = await browser.newPage();
    page.on('console', m => out.console.push({ t: m.type(), m: m.text() }));
    page.on('pageerror', e => out.errors.push({ kind: 'pe', m: e.message, s: e.stack?.slice(0,400) }));

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForFunction(() => !!(window.kiri && window.kiri.api), { timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));

    // use the real file input
    const input = await page.$('input[type=file]');
    if (input) {
        out.steps.foundInput = true;
        await input.uploadFile(OBJ);
        // wait for load
        await new Promise(r => setTimeout(r, 4000));
    } else {
        out.steps.foundInput = false;
    }

    out.steps.postLoad = await page.evaluate(() => {
        const api = window.kiri.api;
        const ws = api.widgets.all();
        const w = ws[0];
        if (!w) return { ok: false, widgetCount: 0 };
        const b = w.getBoundingBox();
        const geo = w.mesh?.geometry;
        return {
            widgetCount: ws.length,
            bounds: { dim: { x: b.max.x-b.min.x, y: b.max.y-b.min.y, z: b.max.z-b.min.z }},
            positionCount: geo?.attributes?.position?.count,
            meta: w.meta
        };
    });

    // TOOLPATHS
    await page.evaluate(() => document.getElementById('act-paths')?.click());
    const done = await page.evaluate(async () => new Promise(resolve => {
        window.kiri.api.event.on('preview.end', () => resolve({ ok: true }));
        window.kiri.api.event.on('preview.error', (e) => resolve({ ok: false, err: String(e) }));
        window.kiri.api.event.on('slice.error', (e) => resolve({ ok: false, err: String(e) }));
        setTimeout(() => resolve({ ok: false, via: 'timeout' }), 30000);
    }));
    out.steps.previewResult = done;
    await new Promise(r => setTimeout(r, 1000));

    out.steps.afterPaths = await page.evaluate(() => {
        const api = window.kiri.api;
        const w = api.widgets.all()[0];
        return {
            widgetSlices: w && w.slices ? w.slices.length : 0,
            topSliderMax: document.getElementById('slider-max')?.textContent,
            widgetStackObjCount: w && w.stack && w.stack.obj && w.stack.obj.view ? w.stack.obj.view.children.length : null
        };
    });
    await page.screenshot({ path: '/tmp/swarf-obj2.png' });
} catch (e) {
    out.errors.push({ kind: 'host', m: e.message, s: e.stack?.slice(0,500) });
} finally {
    await browser.close();
    console.log(JSON.stringify(out, null, 2));
}
