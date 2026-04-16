import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://localhost:8181/kiri/';
const STL = '/Users/philrenato/Desktop/1.stl';
const stlB64 = readFileSync(STL).toString('base64');

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    defaultViewport: { width: 1600, height: 1000 },
    args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.kiri && window.kiri.api), { timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));

    // load STL directly
    await page.evaluate(async (b64) => {
        const bin = atob(b64);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        const dv = new DataView(buf.buffer);
        const n = dv.getUint32(80, true);
        const verts = new Float32Array(n * 9);
        let vi = 0;
        for (let i = 0; i < n; i++) {
            const off = 84 + i * 50 + 12;
            for (let v = 0; v < 9; v++) verts[vi++] = dv.getFloat32(off + v * 4, true);
        }
        const widget = window.kiri.api.new.widget();
        widget.loadVertices(verts);
        window.kiri.api.platform.add(widget);
    }, stlB64);
    await new Promise(r => setTimeout(r, 1500));

    const result = await page.evaluate(() => {
        const api = window.kiri.api;
        // check doit wired
        const doitType = typeof api.doit.undo;
        // check a widget exists
        const w = api.widgets.all()[0];
        if (!w) return { err: 'no widget' };
        const pre = { pos: { x: w.track.pos.x, y: w.track.pos.y } };

        // simulate a move action: rotate via event emit (do.js listens)
        // easier: fire mouse.drag.done after setting moved accumulator manually
        // but moved is private. Use rotate instead — it directly pushes to stack.
        api.event.emit('selection.rotate', { x: 0, y: 0, z: 0.1 }); // +0.1 rad Z
        // now check doit has a stack
        // we can't read private stack; just fire undo and see if it does something visible.
        const post1 = { pos: { x: w.track.pos.x, y: w.track.pos.y } };

        // trigger undo via keyboard sim
        const ev = new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true });
        document.dispatchEvent(ev);

        return {
            doitType,
            doitIsNoop: api.doit.undo.toString().includes('noop') || api.doit.undo.name === 'noop',
            pre, post1
        };
    });

    console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
