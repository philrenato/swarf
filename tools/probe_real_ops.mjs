import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.argv[3] || 'http://localhost:8099/kiri/';
const STL = process.argv[2] || '/Users/philrenato/Documents/claude/swarf/swarf_repo/web/obj/cube.stl';
const OP_LABELS = (process.argv[4] || 'rough,outline,pocket,contour').split(',');

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
    page.on('console', m => out.console.push({ t: m.type(), m: m.text() }));
    page.on('pageerror', e => out.errors.push({ kind: 'pageerror', m: e.message }));

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 4000));
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
            return { ok: true, triangles: n };
        } catch (e) { return { ok: false, err: e.message }; }
    }, stlB64);

    await new Promise(r => setTimeout(r, 1500));

    // clear any auto-injected default op first (swarf auto-adds a rough op on TOOLPATHS
    // when ops is empty) so we control exactly what's in the stack for this test
    await page.evaluate(() => {
        const api = window.kiri.api;
        const s = api.conf.get();
        s.process.ops = [];
    });

    // drive the REAL "add a step" UI grid, exactly like a student would click it
    out.steps.opsAdded = [];
    for (const label of OP_LABELS) {
        const clicked = await page.evaluate((lbl) => {
            const list = document.getElementById('op-add-list');
            if (!list) return false;
            const el = Array.from(list.children).find(c => c.innerText.trim().toLowerCase() === lbl.toLowerCase());
            if (!el) return false;
            el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            return true;
        }, label);
        out.steps.opsAdded.push({ label, clicked });
        await new Promise(r => setTimeout(r, 300));
    }

    out.steps.opsInStack = await page.evaluate(() => {
        const s = window.kiri.api.conf.get();
        return (s.process.ops || []).map(o => o.type);
    });

    await page.evaluate(() => document.getElementById('act-paths')?.click());

    const done = await page.evaluate(async () => new Promise(resolve => {
        window.kiri.api.event.on('preview.end', () => resolve({ ok: true, via: 'preview.end' }));
        window.kiri.api.event.on('preview.error', (e) => resolve({ ok: false, via: 'preview.error', err: String(e) }));
        window.kiri.api.event.on('slice.error', (e) => resolve({ ok: false, via: 'slice.error', err: String(e) }));
        setTimeout(() => resolve({ ok: false, via: 'timeout' }), 45000);
    }));
    out.steps.previewResult = done;

    out.steps.afterPaths = await page.evaluate(() => {
        const api = window.kiri.api;
        const w = api.widgets.all()[0];
        return {
            widgetSlices: w ? (w.slices ? w.slices.length : 0) : 0,
            viewIsPreview: api.view.is_preview ? api.view.is_preview() : null,
        };
    });
} catch (e) {
    out.errors.push({ kind: 'host', m: e.message, s: e.stack?.slice(0, 500) });
} finally {
    await browser.close();
    console.log(JSON.stringify(out, null, 2));
}
