import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'https://renato.design/swarf-app/';
const STL = '/Users/philrenato/Desktop/1.stl';

const stlB64 = readFileSync(STL).toString('base64');

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    defaultViewport: { width: 1600, height: 1000 },
    args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const out = { console: [], errors: [], steps: {} };

try {
    const page = await browser.newPage();
    page.on('console', m => {
        const t = m.text();
        // only keep interesting ones
        if (t.match(/swarf|error|Error|rough|slice|ops|stock|toolpath/i)) {
            out.console.push({ t: m.type(), m: t });
        }
    });
    page.on('pageerror', e => out.errors.push({ kind: 'pageerror', m: e.message }));
    page.on('requestfailed', r => out.errors.push({ kind: 'rf', url: r.url(), f: r.failure()?.errorText }));

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // the migration will reload once; wait for it
    await new Promise(r => setTimeout(r, 4000));
    // try again if still loading
    await page.waitForFunction(() => !!(window.kiri && window.kiri.api && window.kiri.api.event), { timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000));

    out.steps.load = await page.evaluate(async (b64) => {
        try {
            const bin = atob(b64);
            const buf = new Uint8Array(bin.length);
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
            try { window.kiri.api.platform.layout?.(); } catch (e) {}
            const bb = widget.getBoundingBox();
            return { ok: true, triangles: n, bounds: { dim: { x: bb.max.x-bb.min.x, y: bb.max.y-bb.min.y, z: bb.max.z-bb.min.z }}};
        } catch (e) { return { ok:false, err: e.message }; }
    }, stlB64);

    await new Promise(r => setTimeout(r, 1500));

    out.steps.beforePaths = await page.evaluate(() => {
        const api = window.kiri.api;
        const s = api.conf.get();
        return {
            mode: s.mode,
            opsBefore: (s.process.ops || []).map(o => ({ type: o.type })),
            camStockOffset: s.process.camStockOffset,
            camStockXYZ: [s.process.camStockX, s.process.camStockY, s.process.camStockZ],
            migKey: localStorage.getItem('swarf.r14.profile-reset-v8')
        };
    });

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
        const widgets = api.widgets.all();
        const s = api.conf.get();
        const w = widgets[0];
        return {
            ops: (s.process.ops || []).map(o => ({ type: o.type, tool: o.tool, all: o.all, inside: o.inside })),
            stock: s.stock,
            widgetSlices: w ? (w.slices ? w.slices.length : 0) : 0,
            viewIsPreview: api.view.is_preview ? api.view.is_preview() : null,
            viewIsArrange: api.view.is_arrange ? api.view.is_arrange() : null,
            widgetStackObjCount: w && w.stack && w.stack.obj && w.stack.obj.view ? w.stack.obj.view.children.length : null,
            topSliderMax: document.getElementById('slider-max')?.textContent
        };
    });
} catch (e) {
    out.errors.push({ kind: 'host', m: e.message, s: e.stack?.slice(0,500) });
} finally {
    await browser.close();
    console.log(JSON.stringify(out, null, 2));
}
