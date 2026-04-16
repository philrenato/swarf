#!/usr/bin/env node
/**
 * One-shot diagnostic: load ~/Desktop/1.stl into swarf, click TOOLPATHS,
 * capture widget bounds, ops, and what (if anything) showed up in the
 * print stack (rendered toolpath geometry).
 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://localhost:8181/kiri/';
const STL = '/Users/philrenato/Desktop/1.stl';

const stlBuf = readFileSync(STL);
const stlB64 = stlBuf.toString('base64');

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
    page.on('pageerror', e => out.errors.push({ kind: 'pageerror', m: e.message, s: e.stack }));
    page.on('requestfailed', r => out.errors.push({ kind: 'requestfailed', url: r.url(), f: r.failure()?.errorText }));

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // wait for kiri api
    await page.waitForFunction(() => !!(window.kiri && window.kiri.api && window.kiri.api.event), { timeout: 15000 });
    // small settle
    await new Promise(r => setTimeout(r, 2000));

    // inject the STL directly via load_data
    out.steps.load = await page.evaluate(async (b64) => {
        try {
            const bin = atob(b64);
            const buf = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
            // load_data is not exported on api — use file.js parseSTL equivalent via the imported STL
            // Try via api.platform.add with a widget made from parsed vertices
            const widget = window.kiri.api.new.widget();
            // Use STL loader via kiri's load pipeline: file.js exports load
            // but it's not on window. Use file drag simulation instead via a hidden input.
            // Easier: parse the binary STL in-page.
            const dv = new DataView(buf.buffer);
            const n = dv.getUint32(80, true);
            const verts = new Float32Array(n * 9);
            let vi = 0;
            for (let i = 0; i < n; i++) {
                const off = 84 + i * 50 + 12;
                for (let v = 0; v < 9; v++) {
                    verts[vi++] = dv.getFloat32(off + v * 4, true);
                }
            }
            widget.loadVertices(verts);
            window.kiri.api.platform.add(widget);
            try { window.kiri.api.platform.layout?.(); } catch (e) {}
            try { window.kiri.api.space?.update?.(); } catch (e) {}
            const bb = widget.getBoundingBox();
            return {
                ok: true,
                triangles: n,
                verts: vi,
                bounds: {
                    min: { x: bb.min.x, y: bb.min.y, z: bb.min.z },
                    max: { x: bb.max.x, y: bb.max.y, z: bb.max.z },
                    dim: { x: bb.max.x - bb.min.x, y: bb.max.y - bb.min.y, z: bb.max.z - bb.min.z }
                }
            };
        } catch (e) {
            return { ok: false, error: e.message, stack: e.stack };
        }
    }, stlB64);

    await new Promise(r => setTimeout(r, 1500));

    // Capture state before clicking TOOLPATHS
    out.steps.beforePaths = await page.evaluate(() => {
        const api = window.kiri.api;
        const s = api.conf.get();
        return {
            widgetCount: api.widgets.all().length,
            mode: s.mode,
            stock: s.stock,
            bounds: s.bounds ? { min: s.bounds.min, max: s.bounds.max } : null,
            opsBefore: (s.process.ops || []).map(o => ({ type: o.type, tool: o.tool })),
            camStockOffset: s.process.camStockOffset,
            camStockXYZ: [s.process.camStockX, s.process.camStockY, s.process.camStockZ]
        };
    });

    // Click TOOLPATHS
    await page.evaluate(() => document.getElementById('act-paths')?.click());
    out.steps.clicked = 'act-paths';

    // Wait up to 30s for preview to complete
    const done = await page.evaluate(async () => {
        return new Promise(resolve => {
            let errored = null;
            window.kiri.api.event.on('preview.end', () => resolve({ ok: true, via: 'preview.end' }));
            window.kiri.api.event.on('preview.error', (e) => resolve({ ok: false, via: 'preview.error', err: e }));
            window.kiri.api.event.on('slice.error', (e) => resolve({ ok: false, via: 'slice.error', err: e }));
            setTimeout(() => resolve({ ok: false, via: 'timeout' }), 30000);
        });
    });
    out.steps.previewResult = done;

    await new Promise(r => setTimeout(r, 1000));

    // Inspect post-preview state
    out.steps.afterPaths = await page.evaluate(() => {
        const api = window.kiri.api;
        const widgets = api.widgets.all();
        const s = api.conf.get();
        const w = widgets[0];
        return {
            widgetCount: widgets.length,
            ops: (s.process.ops || []).map(o => ({ type: o.type, tool: o.tool, down: o.down, step: o.step, leave: o.leave })),
            stock: s.stock,
            widgetSlices: w ? (w.slices ? w.slices.length : 'no-slices-prop') : 'no-widget',
            widgetCamOps: w && w.camops ? w.camops.length : 0,
            viewIsPreview: api.view.is_preview ? api.view.is_preview() : null,
            viewIsArrange: api.view.is_arrange ? api.view.is_arrange() : null,
            topSliderMax: document.getElementById('slider-max')?.textContent,
            layersDivChildren: document.querySelectorAll('#layers > *').length,
            // does the stack reveal anything?
            stacksTop: (() => {
                try {
                    const s = api.const.STACKS;
                    if (s.getStack) {
                        const stack = s.getStack('print');
                        if (stack) return { hasStack: true, label: 'print' };
                    }
                    return { hasStack: false };
                } catch (e) { return { err: e.message }; }
            })(),
            widgetHasStack: !!(w && w.stack),
            widgetStackObjCount: w && w.stack && w.stack.obj && w.stack.obj.view && w.stack.obj.view.children ? w.stack.obj.view.children.length : null,
            // dump scene: count line/mesh descendants and their positions
            lineSegDetail: (() => {
                try {
                    if (!w?.stack?.obj?.view?.children) return null;
                    const details = [];
                    w.stack.obj.view.children.slice(0,3).forEach((grp, gi) => {
                        grp.children.forEach((ls, li) => {
                            const geo = ls.geometry;
                            const pos = geo?.attributes?.position;
                            details.push({
                                grp: gi, ls: li,
                                type: ls.type,
                                visible: ls.visible,
                                posCount: pos?.count ?? null,
                                sample: pos && pos.count > 0 ? [pos.getX(0), pos.getY(0), pos.getZ(0)] : null,
                                sampleEnd: pos && pos.count > 1 ? [pos.getX(pos.count-1), pos.getY(pos.count-1), pos.getZ(pos.count-1)] : null,
                                matType: ls.material?.type,
                                matOpacity: ls.material?.opacity,
                                matColor: ls.material?.color ? `#${ls.material.color.getHexString()}` : null
                            });
                        });
                    });
                    return details;
                } catch (e) { return { err: e.message }; }
            })(),
            stackObjTypes: (() => {
                try {
                    if (!w || !w.stack || !w.stack.obj || !w.stack.obj.view) return null;
                    const view = w.stack.obj.view;
                    const counts = {};
                    const positions = [];
                    view.children.forEach((c,i) => {
                        const k = c.constructor?.name || c.type || 'unknown';
                        counts[k] = (counts[k]||0) + 1;
                        if (i < 5) {
                            let childScan = null;
                            if (c.children) childScan = { childCount: c.children.length, types: c.children.slice(0,3).map(x=>x.type||x.constructor?.name) };
                            positions.push({
                                idx: i,
                                type: k,
                                visible: c.visible,
                                pos: [c.position.x, c.position.y, c.position.z],
                                childScan
                            });
                        }
                    });
                    return { counts, positions, total: view.children.length };
                } catch (e) { return { err: e.message }; }
            })(),
            // what do the layer checkboxes control?
            layerNames: Array.from(document.querySelectorAll('#layers label')).map(n => n.textContent?.trim())
        };
    });
    await page.screenshot({ path: '/tmp/swarf-1stl-noFit.png', fullPage: false });
    // fit view to widget so the toolpaths are visible in headless render
    await page.evaluate(() => {
        try {
            const api = window.kiri.api;
            if (api.const?.SPACE?.view?.fit) api.const.SPACE.view.fit();
        } catch (e) {}
    });
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: '/tmp/swarf-1stl-fitted.png', fullPage: false });
    out.steps.screenshot = '/tmp/swarf-1stl-fitted.png';
} catch (e) {
    out.errors.push({ kind: 'host-throw', m: e.message, s: e.stack });
} finally {
    await browser.close();
    console.log(JSON.stringify(out, null, 2));
}
