/**
 * Probe: the Concerns drawer must re-evaluate when an op is edited, when the
 * material changes and when the device changes — and each rule must be
 * reachable from a real edit. Fixture: one rough op, then
 *   1. plunge typed up to the feed          → rule 2 fires
 *   2. stepdown typed past half the tool    → rule 3 fires
 *   3. aluminum on the ShopBot (9000 floor) → rule 4 fires
 * and the count must fall back to 0 when the edits are reverted.
 *
 * Usage: node tools/probe_concerns.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.argv[2] || 'http://localhost:8099/kiri/';
const STL = '/Users/philrenato/Documents/claude/swarf/swarf_repo/web/obj/cube.stl';
const stlB64 = readFileSync(STL).toString('base64');
const wait = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    defaultViewport: { width: 1600, height: 1000 },
    args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const out = { errors: [], steps: [], verdict: 'unknown', problems: [] };
try {
    const page = await browser.newPage();
    page.on('pageerror', e => out.errors.push(e.message));
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await wait(5000);
    await page.waitForFunction(() => !!(window.kiri?.api?.event && window.kiri.api.new && window.kiri.api.platform), { timeout: 60000, polling: 200 });
    await wait(1500);
    await page.evaluate(b64 => {
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
    await wait(1500);
    await page.waitForFunction(() => !!document.getElementById('swarf-material-select'), { timeout: 20000 });
    await page.evaluate(() => {
        const list = document.getElementById('op-add-list');
        Array.from(list.children).find(c => c.innerText.trim().toLowerCase() === 'rough')
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await wait(400);

    const concerns = () => page.evaluate(() => ({
        count: +document.getElementById('swarf-concerns-count').textContent,
        titles: [...document.querySelectorAll('#swarf-concerns-body .swarf-concern strong')].map(e => e.textContent),
    }));
    const setOp = (field, value) => page.evaluate(([f, v]) => {
        const op = window.kiri.api.conf.get().process.ops.find(o => o && o.type === 'rough');
        op[f] = v;
        window.kiri.api.conf.save();
        return { rate: op.rate, plunge: op.plunge, down: op.down, spindle: op.spindle };
    }, [field, value]);
    const setMaterial = async mid => {
        await page.evaluate(m => {
            const sel = document.getElementById('swarf-material-select');
            sel.value = m;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }, mid);
        await wait(300);
    };

    await setMaterial('aluminum_6061');
    out.steps.push({ step: 'aluminum, preset', ...(await concerns()) });
    const op = await setOp('plunge', 280);
    await wait(200);
    out.steps.push({ step: 'plunge = feed', op, ...(await concerns()) });
    await setOp('plunge', 100);
    await setOp('down', 4);
    await wait(200);
    out.steps.push({ step: 'stepdown 4 mm on the 1/4', ...(await concerns()) });
    await setOp('down', 1);
    await wait(200);
    out.steps.push({ step: 'reverted', ...(await concerns()) });
    await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
    await wait(800);
    out.steps.push({ step: 'aluminum on the ShopBot', op: await page.evaluate(() => {
        const o = window.kiri.api.conf.get().process.ops.find(o => o && o.type === 'rough');
        return { rate: o.rate, spindle: o.spindle };
    }), ...(await concerns()) });
    await setMaterial('hardwood');
    out.steps.push({ step: 'hardwood on the ShopBot', ...(await concerns()) });
    await page.evaluate(() => window.kiri.api.devices.select('Langmuir.MR-1'));
    await wait(500);
} catch (e) {
    out.errors.push('host: ' + e.message);
} finally {
    await browser.close();
}

const p = out.problems;
const s = Object.fromEntries(out.steps.map(x => [x.step, x]));
const has = (step, word) => s[step]?.titles.some(t => t.includes(word));
if (s['aluminum, preset']?.count !== 0) p.push(`preset shows ${s['aluminum, preset']?.count} concerns: ${s['aluminum, preset']?.titles}`);
if (!has('plunge = feed', 'plunge')) p.push(`rule 2 did not fire on plunge = feed: ${s['plunge = feed']?.titles}`);
if (!has('stepdown 4 mm on the 1/4', 'step-down')) p.push(`rule 3 did not fire on a 4 mm stepdown: ${s['stepdown 4 mm on the 1/4']?.titles}`);
if (s['reverted']?.count !== 0) p.push(`count did not return to 0 after reverting: ${s['reverted']?.titles}`);
if (!has('aluminum on the ShopBot', 'spindle too fast')) p.push(`rule 4 did not fire for aluminum at the ShopBot floor: ${s['aluminum on the ShopBot']?.titles}`);
if (s['hardwood on the ShopBot']?.count !== 0) p.push(`hardwood on the ShopBot shows ${s['hardwood on the ShopBot']?.count}: ${s['hardwood on the ShopBot']?.titles}`);
if (out.errors.length) p.push(`page errors: ${out.errors.join(' | ')}`);
out.verdict = p.length ? 'FAIL' : 'PASS';
console.log(JSON.stringify(out, null, 2));
process.exit(p.length ? 1 : 0);
