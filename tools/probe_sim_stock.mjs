/*
 * Simulate stock gate: loads a plain-cube workspace (rough, 3/8 endmill,
 * stock = part), runs SIMULATE to the end and measures the stock meshes.
 * A cube's top must stay flat at the part top, the block must sit on the
 * bed, and the bottom plate must span the padded heightmap.
 *   node tools/probe_sim_stock.mjs [workspace.kmz]   (dev server on :8080,
 *   or SWARF_URL=https://renato.design/swarf-app/ for the live site)
 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const kmz = process.argv[2] || new URL('./fixtures/kiri_cube_rough.kmz', import.meta.url).pathname;
const b64 = readFileSync(kmz).toString('base64');
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport: { width: 1600, height: 1000 }, args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader'] });
const problems = [];
try {
    const page = await browser.newPage();
    await page.goto(process.env.SWARF_URL || 'http://localhost:8080/kiri/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.kiri && window.kiri.api), { timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    await page.evaluate(b64 => {
        const bin = atob(b64), buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        window.kiri.api.settings.import_zip(buf.buffer, false);
    }, b64);
    await new Promise(r => setTimeout(r, 5000));
    const part = await page.evaluate(() => { const b = window.kiri.api.widgets.all()[0].getBoundingBox(); return { x: b.max.x, z: b.max.z }; });
    await page.evaluate(() => document.getElementById('act-paths')?.click());
    await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); setTimeout(res, 30000); }));
    await new Promise(r => setTimeout(r, 1500));
    await page.evaluate(() => {
        window.__added = [];
        const w = window.moto.space.world, add = w.add;
        w.add = o => { window.__added.push(o); return add(o); };
        document.getElementById('act-animate')?.click();
    });
    await new Promise(r => setTimeout(r, 1500));
    await page.evaluate(() => { window.__swarfCustomSpeed = 100; window.dispatchEvent(new Event('swarf.speed.custom')); });
    await new Promise(r => setTimeout(r, 60000));
    const m = await page.evaluate(inset => window.__added.filter(o => o.renderOrder === -10 || o.renderOrder === -11).map(o => {
        const p = o.geometry.attributes.position;
        let inMin = 1e9, inMax = -1e9, zMin = 1e9, xMax = -1e9;
        for (let i = 0; i < p.count; i++) {
            const x = p.getX(i) + o.position.x, y = p.getY(i) + o.position.y, z = p.getZ(i) + o.position.z;
            xMax = Math.max(xMax, x); zMin = Math.min(zMin, z);
            if (Math.abs(x) < inset && Math.abs(y) < inset) { inMin = Math.min(inMin, z); inMax = Math.max(inMax, z); }
        }
        return { ro: o.renderOrder, inMin, inMax, zMin, xMax };
    }), part.x - 0.5);
    const hm = m.find(o => o.ro === -10), plate = m.find(o => o.ro === -11);
    const near = (a, b) => Math.abs(a - b) < 0.02;
    if (!hm) problems.push('no heightmap mesh');
    else {
        if (!near(hm.inMin, part.z) || !near(hm.inMax, part.z)) problems.push(`top over the part spans ${hm.inMin.toFixed(2)}..${hm.inMax.toFixed(2)}, expected flat at ${part.z.toFixed(2)}`);
        if (!near(hm.zMin, 0)) problems.push(`heightmap bottom at ${hm.zMin.toFixed(2)}, expected the bed (0)`);
    }
    if (!plate) problems.push('no bottom plate');
    else if (hm && Math.abs(plate.xMax - hm.xMax) > 0.1) problems.push(`plate half-width ${plate.xMax.toFixed(2)} vs heightmap ${hm.xMax.toFixed(2)}`);
    console.log(JSON.stringify({ part, meshes: m }, null, 1));
} finally { await browser.close(); }
console.log(problems.length ? 'FAIL\n  ' + problems.join('\n  ') : 'PASS');
process.exit(problems.length ? 1 : 0);
