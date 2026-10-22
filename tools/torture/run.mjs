/*
 * Torture-test driver. For every case in cases.mjs: load the parts into the
 * real app, set machine / material / units / origin / ops, generate
 * toolpaths, export G-code, run SIMULATE to the end and save what it drew.
 * check.mjs then judges each case against the part geometry.
 *
 *   node tools/torture/run.mjs [filter] [--out dir]
 *   SWARF_URL defaults to the dev server (http://localhost:8080/kiri/)
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPart } from './parts.mjs';
import { CASES } from './cases.mjs';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : new URL('./out', import.meta.url).pathname;
const filter = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
const APP_URL = process.env.SWARF_URL || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const cases = CASES.filter(c => !filter || c.id.includes(filter));
mkdirSync(OUT, { recursive: true });

const partCache = {};
const part = name => partCache[name] ??= buildPart(name);

const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new', defaultViewport: { width: 1400, height: 900 },
    args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader'],
    protocolTimeout: 600000,
});

async function boot() {
    const page = await browser.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') page.__errors.push('console: ' + m.text().slice(0, 300)); });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait(5000); // the profile migration reloads once on a fresh profile
    await page.waitForFunction(() => !!(window.kiri?.api?.platform && document.getElementById('swarf-material-select')), { timeout: 60000, polling: 200 });
    await wait(1500);
    await page.evaluate(() => {
        const api = window.kiri.api;
        window.__alerts = [];
        const alert = api.show.alert;
        api.show.alert = (...a) => { window.__alerts.push(String(a[0]).slice(0, 200)); return alert(...a); };
    });
    return page;
}

let page = await boot();
const summary = [];

for (const c of cases) {
    const dir = join(OUT, c.id);
    mkdirSync(dir, { recursive: true });
    const t0 = Date.now();
    const rec = { id: c.id, spec: c, errors: [], alerts: [], timings: {} };
    page.__errors = [];
    try {
        // reset to a clean arrange view with no widgets
        await page.evaluate(() => {
            const api = window.kiri.api;
            api.function.clear?.();
            api.platform.delete(api.widgets.all().slice());
            window.__alerts = [];
        });
        await wait(500);
        await page.evaluate(dev => window.kiri.api.devices.select(dev), c.device || 'Langmuir.MR-1');
        await wait(800);
        await page.evaluate(({ units, origin, pad }) => {
            const api = window.kiri.api, s = api.conf.get();
            s.controller.units = units || 'mm';
            s.process.camOriginCenter = origin?.center ?? true;
            s.process.camOriginTop = origin?.top ?? true;
            // stock offset mode: camStockX/Y/Z are added to the parts' bounds
            s.process.camStockX = pad?.x ?? 0; s.process.camStockY = pad?.y ?? 0; s.process.camStockZ = pad?.z ?? 0;
            s.process.camStockOffset = true;
            api.conf.save();
        }, { units: c.units, origin: c.origin, pad: c.stockPad });
        await page.evaluate(m => {
            const sel = document.getElementById('swarf-material-select');
            sel.value = m;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }, c.material || 'hardwood');
        await wait(400);

        // load parts
        const pocketMap = [];
        for (const p of c.parts) {
            const built = part(p.name);
            for (let k = 0; k < (p.copies || 1); k++) {
                const b64 = Buffer.from(built.verts.buffer, built.verts.byteOffset, built.verts.byteLength).toString('base64');
                const wid = await page.evaluate(({ b64, rot, scale, name }) => {
                    const bin = atob(b64), buf = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
                    const api = window.kiri.api, w = api.new.widget();
                    w.loadVertices(new Float32Array(buf.buffer));
                    w.meta.file = name;
                    api.platform.add(w);
                    if (scale) w.scale(scale, scale, scale);
                    if (rot) w.rotate(...rot.map(d => d * Math.PI / 180));
                    return w.id;
                }, { b64, rot: p.rotate, scale: p.scale, name: p.name });
                pocketMap.push({ wid, faces: built.pocketFaces });
            }
        }
        await page.evaluate(() => { window.kiri.api.platform.layout(); });
        await wait(800);

        // ops: added through the real "add a step" buttons (the app's own
        // defaults), then overridden; tool by name, pocket faces per widget
        await page.evaluate(() => {
            const ops = window.kiri.api.conf.get().process.ops;
            ops.length = 0;
            ops.push({ type: '|' });
            window.kiri.api.conf.save();
        });
        for (const o of c.ops) {
            const ok = await page.evaluate(lbl => {
                const list = document.getElementById('op-add-list');
                const el = list && Array.from(list.children).find(c => c.innerText.trim().toLowerCase() === lbl);
                el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                return !!el;
            }, o.type);
            if (!ok) throw new Error('no add button for ' + o.type);
            await wait(300);
        }
        rec.opsSet = await page.evaluate(({ ops, pocketMap }) => {
            const api = window.kiri.api, s = api.conf.get();
            const real = s.process.ops.filter(o => o.type !== '|');
            if (real.length !== ops.length) throw new Error(`added ${real.length} ops, wanted ${ops.length}`);
            ops.forEach((o, i) => {
                const r = real[i];
                if (r.type !== o.type) throw new Error(`op ${i} is ${r.type}, wanted ${o.type}`);
                const t = s.tools.find(t => t.name === o.tool);
                if (!t) throw new Error('no tool ' + o.tool);
                Object.assign(r, o, { tool: t.id });
                if (o.type === 'pocket') {
                    r.surfaces = {};
                    for (const p of pocketMap) if (p.faces.length) r.surfaces[p.wid] = p.faces;
                }
            });
            api.conf.save();
            return real.map(o => ({ ...o, surfaces: o.surfaces ? Object.fromEntries(Object.entries(o.surfaces).map(([k, v]) => [k, v.length])) : undefined }));
        }, { ops: c.ops, pocketMap });
        await wait(300);

        // toolpaths
        const t1 = Date.now();
        await page.evaluate(() => document.getElementById('act-paths')?.click());
        rec.preview = await page.evaluate(() => new Promise(res => {
            const api = window.kiri.api;
            api.event.on('preview.end', () => res('end'));
            api.event.on('preview.error', e => res('error: ' + e));
            setTimeout(() => res('timeout'), 240000);
        }));
        rec.timings.paths = Date.now() - t1;
        await wait(800);
        await page.evaluate(() => { window.moto.space.view.load({ left: 0.6, up: 0.9, panX: 0, panY: 0, panZ: 0 }); window.moto.space.view.fit?.(undefined, { padding: 1.2 }); });
        await wait(600);
        await page.screenshot({ path: join(dir, 'paths.png') });

        // state the checker needs
        const state = await page.evaluate(() => {
            const api = window.kiri.api, s = api.conf.get();
            const widgets = api.widgets.all().map(w => {
                const bb = w.getBoundingBox();
                const g = w.mesh.geometry.attributes.position;
                let mn = [1e9, 1e9, 1e9];
                for (let i = 0; i < g.count; i++) { mn[0] = Math.min(mn[0], g.getX(i)); mn[1] = Math.min(mn[1], g.getY(i)); mn[2] = Math.min(mn[2], g.getZ(i)); }
                const tp = w.track.pos; const d = [bb.min.x - mn[0] + tp.x, bb.min.y - mn[1] + tp.y, bb.min.z - mn[2] + tp.z];
                const arr = new Float32Array(g.count * 3);
                for (let i = 0; i < g.count; i++) { arr[i * 3] = g.getX(i) + d[0]; arr[i * 3 + 1] = g.getY(i) + d[1]; arr[i * 3 + 2] = g.getZ(i) + d[2]; }
                let s2 = ''; const u8 = new Uint8Array(arr.buffer);
                for (let i = 0; i < u8.length; i += 0x8000) s2 += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
                return { id: w.id, file: w.meta.file, pos: { ...tp }, bb: { min: { x: bb.min.x + tp.x, y: bb.min.y + tp.y, z: bb.min.z + tp.z }, max: { x: bb.max.x + tp.x, y: bb.max.y + tp.y, z: bb.max.z + tp.z } }, verts: btoa(s2), indexed: !!w.mesh.geometry.index };
            });
            const tools = s.tools.map(t => ({ id: t.id, name: t.name, type: t.type, metric: t.metric, flute_diam: t.flute_diam, flute_len: t.flute_len, shaft_diam: t.shaft_diam, number: t.number, taper_tip: t.taper_tip }));
            return {
                stock: s.stock, origin: s.origin, units: s.controller.units,
                process: Object.fromEntries(Object.entries(s.process).filter(([k]) => /^(camOrigin|camZ|camStock|ops$|camFast|camEase|output)/.test(k))),
                device: { name: s.device.deviceName, bedWidth: s.device.bedWidth, bedDepth: s.device.bedDepth, maxHeight: s.device.maxHeight, spindleMax: s.device.spindleMax, spindleMin: s.device.spindleMin, feedMax: s.device.feedMax, feedMaxZ: s.device.feedMaxZ, originCenter: s.device.originCenter },
                tools, widgets, alerts: window.__alerts.slice(),
            };
        });
        for (const w of state.widgets) {
            writeFileSync(join(dir, `widget-${w.id}.bin`), Buffer.from(w.verts, 'base64'));
            delete w.verts;
        }
        Object.assign(rec, { stock: state.stock, origin: state.origin, units: state.units, process: state.process, device: state.device, tools: state.tools, widgets: state.widgets });
        rec.alerts.push(...state.alerts);

        // G-code
        const t2 = Date.now();
        const gcode = await page.evaluate(() => new Promise(res => {
            try { window.kiri.api.function.export(gc => res(typeof gc === 'string' ? gc : (gc?.gcode || String(gc)))); }
            catch (e) { res('EXPORT THREW: ' + e.message); }
            setTimeout(() => res('EXPORT TIMEOUT'), 240000);
        }));
        rec.timings.export = Date.now() - t2;
        writeFileSync(join(dir, 'program.nc'), gcode);
        rec.gcodeBytes = gcode.length;
        await page.evaluate(() => document.querySelectorAll('.modal, #mod-any').forEach(m => { const x = m.querySelector('button'); }));
        await page.keyboard.press('Escape');
        await wait(300);

        // SIMULATE to the end
        const t3 = Date.now();
        await page.evaluate(() => {
            window.__added = [];
            const w = window.moto.space.world, add = w.add;
            if (!w.__wrapped) { w.add = o => { (window.__added ||= []).push(o); return add(o); }; w.__wrapped = true; }
            document.getElementById('act-animate')?.click();
        });
        await wait(1500);
        await page.evaluate(() => { window.__swarfCustomSpeed = 1e9; window.dispatchEvent(new Event('swarf.speed.custom')); });
        let last = -1, stall = 0, prog = 0;
        while (true) {
            await wait(1000);
            prog = await page.evaluate(() => parseFloat(window.kiri.api.ui.anim?.progress?.value || '0'));
            if (prog >= 100) break;
            if (prog === last) { if (++stall > 60) break; } else stall = 0;
            last = prog;
            if (Date.now() - t3 > 900000) break;
        }
        rec.simProgress = prog;
        rec.timings.sim = Date.now() - t3;
        await wait(1000);
        const sim = await page.evaluate(() => {
            const hm = (window.__added || []).filter(o => o.renderOrder === -10).pop();
            if (!hm) return null;
            const p = hm.geometry.attributes.position;
            const arr = new Float32Array(p.count * 3);
            for (let i = 0; i < p.count; i++) { arr[i * 3] = p.getX(i) + hm.position.x; arr[i * 3 + 1] = p.getY(i) + hm.position.y; arr[i * 3 + 2] = p.getZ(i) + hm.position.z; }
            let s = ''; const u8 = new Uint8Array(arr.buffer);
            for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
            return { count: p.count, data: btoa(s) };
        });
        if (sim) writeFileSync(join(dir, 'sim.bin'), Buffer.from(sim.data, 'base64'));
        rec.simCount = sim?.count || 0;
        await page.evaluate(() => {
            window.__swarfLightstream = false;
            window.dispatchEvent(new Event('swarf.lightstream.toggle'));
            window.moto.space.view.load({ left: 0.6, up: 0.9, panX: 0, panY: 0, panZ: 0 });
            window.moto.space.view.fit?.(undefined, { padding: 1.2 });
        });
        await wait(800);
        await page.screenshot({ path: join(dir, 'sim.png') });
        await page.evaluate(() => document.getElementById('act-clear')?.click());
        await wait(500);
    } catch (e) {
        rec.errors.push('host: ' + (e.message || e));
        try { await page.close(); } catch {}
        page = await boot();
    }
    rec.errors.push(...page.__errors);
    rec.timings.total = Date.now() - t0;
    writeFileSync(join(dir, 'case.json'), JSON.stringify(rec, null, 1));
    summary.push({ id: c.id, preview: rec.preview, sim: rec.simProgress, errors: rec.errors.length, ms: rec.timings.total });
    console.log(`${c.id.padEnd(34)} paths:${String(rec.preview).padEnd(6)} sim:${String(rec.simProgress).padStart(5)}% err:${rec.errors.length} ${(rec.timings.total / 1000).toFixed(0)}s`);
}
await browser.close();
writeFileSync(join(OUT, 'run.json'), JSON.stringify(summary, null, 1));
