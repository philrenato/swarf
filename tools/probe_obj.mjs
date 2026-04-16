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
    page.on('console', m => {
        const t = m.text();
        if (t.match(/swarf|error|Error|weld|face|slice|ops|toolpath|obj|OBJ|NaN/i)) out.console.push({ t: m.type(), m: t });
    });
    page.on('pageerror', e => out.errors.push({ kind: 'pe', m: e.message }));

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForFunction(() => !!(window.kiri && window.kiri.api && window.kiri.api.event), { timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));

    // Load OBJ via blob URL through platform.load_url
    out.steps.load = await page.evaluate(async (objText) => {
        try {
            const blob = new Blob([objText], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            // can't rely on extension in blob URL; use a data url with name hint via load_url options
            // Instead, parse directly via the exposed kiri internals if any
            // Try platform.load_url with explicit ext
            return await new Promise((resolve, reject) => {
                window.kiri.api.event.once?.('load.url', (e) => {
                    const w = e.widgets && e.widgets[0];
                    resolve({
                        ok: true,
                        widgetCount: e.widgets?.length,
                        bounds: w ? (() => { const b = w.getBoundingBox(); return { dim: { x: b.max.x-b.min.x, y: b.max.y-b.min.y, z: b.max.z-b.min.z }}})() : null,
                        meshLen: w && w.mesh && w.mesh.geometry && w.mesh.geometry.attributes.position ? w.mesh.geometry.attributes.position.count : null
                    });
                });
                // fallback: poll widgets
                setTimeout(() => {
                    const ws = window.kiri.api.widgets.all();
                    if (ws.length) {
                        const w = ws[0];
                        const b = w.getBoundingBox();
                        resolve({ ok: true, widgetCount: ws.length, bounds: { dim: { x: b.max.x-b.min.x, y: b.max.y-b.min.y, z: b.max.z-b.min.z }}, meshLen: w.mesh?.geometry?.attributes?.position?.count, via: 'poll' });
                    } else resolve({ ok: false, via: 'poll-empty' });
                }, 8000);
                window.kiri.api.platform.load_url(url + '#filename=1.obj', {});
            });
        } catch (e) { return { ok: false, err: e.message, stack: e.stack?.slice(0,400) }; }
    }, objText);

    await new Promise(r => setTimeout(r, 1500));

    // TOOLPATHS
    await page.evaluate(() => document.getElementById('act-paths')?.click());
    const done = await page.evaluate(async () => new Promise(resolve => {
        window.kiri.api.event.on('preview.end', () => resolve({ ok: true, via: 'preview.end' }));
        window.kiri.api.event.on('preview.error', (e) => resolve({ ok: false, via: 'preview.error', err: String(e) }));
        window.kiri.api.event.on('slice.error', (e) => resolve({ ok: false, via: 'slice.error', err: String(e) }));
        setTimeout(() => resolve({ ok: false, via: 'timeout' }), 30000);
    }));
    out.steps.previewResult = done;
    await new Promise(r => setTimeout(r, 1000));

    out.steps.afterPaths = await page.evaluate(() => {
        const api = window.kiri.api;
        const w = api.widgets.all()[0];
        return {
            ops: api.conf.get().process.ops?.map(o => o.type),
            widgetSlices: w && w.slices ? w.slices.length : 0,
            topSliderMax: document.getElementById('slider-max')?.textContent,
            widgetStackObjCount: w && w.stack && w.stack.obj && w.stack.obj.view ? w.stack.obj.view.children.length : null,
            viewIsPreview: api.view.is_preview && api.view.is_preview()
        };
    });
    await page.screenshot({ path: '/tmp/swarf-obj-probe.png' });
} catch (e) {
    out.errors.push({ kind: 'host', m: e.message, s: e.stack?.slice(0,500) });
} finally {
    await browser.close();
    console.log(JSON.stringify(out, null, 2));
}
