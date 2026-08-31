/**
 * Probe: drive the MATERIAL dropdown like a student and check that the
 * selected material's preset actually lands on the ops and on the process
 * ramp — and, for one material, that the feed reaches the G-code.
 *
 * Usage: node tools/probe_materials.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.argv[2] || 'http://localhost:8099/kiri/';
const STL = '/Users/philrenato/Documents/claude/swarf/swarf_repo/web/obj/cube.stl';
const TABLE = JSON.parse(readFileSync('web/kiri/swarf-materials.json', 'utf8'));

const stlB64 = readFileSync(STL).toString('base64');
const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    defaultViewport: { width: 1600, height: 1000 },
    args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const out = { errors: [], dropdown: null, perMaterial: [], gcode: null, verdict: 'unknown' };

try {
    const page = await browser.newPage();
    page.on('pageerror', e => out.errors.push(e.message));

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // swarf's profile migration reloads the page once on a fresh browser
    // profile. A handle grabbed before that is torn out from under us, and
    // the failure reads as "kiri.api is undefined" long after boot.
    await new Promise(r => setTimeout(r, 5000));
    await page.waitForFunction(
        () => !!(window.kiri?.api?.event && window.kiri.api.new && window.kiri.api.platform),
        { timeout: 60000, polling: 200 });
    await new Promise(r => setTimeout(r, 1500));

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
    await new Promise(r => setTimeout(r, 1500));

    // wait for the swarf material dropdown to be injected into #camops
    await page.waitForFunction(() => !!document.getElementById('swarf-material-select'), { timeout: 20000 });
    out.dropdown = await page.evaluate(() =>
        Array.from(document.getElementById('swarf-material-select').options).map(o => o.value));

    // add a rough op and a contour op through the real "add a step" grid
    for (const label of ['rough', 'contour']) {
        await page.evaluate(lbl => {
            const list = document.getElementById('op-add-list');
            const el = Array.from(list.children).find(c => c.innerText.trim().toLowerCase() === lbl);
            el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }, label);
        await new Promise(r => setTimeout(r, 400));
    }

    for (const id of out.dropdown) {
        await page.evaluate(mid => {
            const sel = document.getElementById('swarf-material-select');
            sel.value = mid;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }, id);
        await new Promise(r => setTimeout(r, 350));
        const read = await page.evaluate(() => {
            const s = window.kiri.api.conf.get();
            const tools = s.tools || [];
            return {
                ease: s.process.camEaseDown,
                angle: s.process.camEaseAngle,
                ops: (s.process.ops || []).filter(o => o && o.type && o.type !== '|').map(o => {
                    const t = tools.find(t => t.id === o.tool || t.number === o.tool);
                    return {
                        type: o.type,
                        toolMM: t ? +((t.flute_diam || 0) * (t.metric ? 1 : 25.4)).toFixed(4) : null,
                        rate: o.rate, plunge: o.plunge, spindle: o.spindle, down: o.down, step: o.step,
                    };
                }),
            };
        });
        out.perMaterial.push({ id, ...read });
    }

    // Does the preset reach the G-code? Cut two materials that disagree on
    // every number. One material alone proves nothing: the device header
    // opens with a fixed M03, so a spindle speed that never varies would be
    // that header, not the material.
    out.gcode = {};
    for (const mid of ['mild_steel', 'aluminum_6061']) {
        await page.evaluate(m => {
            const sel = document.getElementById('swarf-material-select');
            sel.value = m;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }, mid);
        await new Promise(r => setTimeout(r, 500));
        await page.evaluate(() => document.getElementById('act-paths')?.click());
        const preview = await page.evaluate(() => new Promise(res => {
            window.kiri.api.event.on('preview.end', () => res('preview.end'));
            window.kiri.api.event.on('preview.error', e => res('preview.error ' + e));
            setTimeout(() => res('timeout'), 60000);
        }));
        const gcode = await page.evaluate(() => new Promise(res => {
            try { window.kiri.api.function.export(gc => res(typeof gc === 'string' ? gc : (gc?.gcode || String(gc)))); }
            catch (e) { res('ERR ' + e.message); }
            setTimeout(() => res('ERR timeout'), 30000);
        }));
        out.gcode[mid] = {
            preview,
            bytes: gcode.length,
            feeds: [...new Set((gcode.match(/F[\d.]+/g) || []).map(f => +f.slice(1)))].sort((a, b) => a - b),
            spindles: [...new Set((gcode.match(/\bS\d+/g) || []).map(s => +s.slice(1)))].sort((a, b) => a - b),
        };
    }
} catch (e) {
    out.errors.push('host: ' + e.message);
} finally {
    await browser.close();
}

// ---- verdict: every material's ops must carry ITS OWN numbers -----------
const table = Object.fromEntries(TABLE.materials.map(m => [m.id, m]));
const problems = [];
if (out.dropdown?.length !== TABLE.materials.length) {
    problems.push(`dropdown lists ${out.dropdown?.length} of ${TABLE.materials.length} materials`);
}
for (const row of out.perMaterial) {
    const m = table[row.id];
    if (!m) { problems.push(`${row.id}: not in the table`); continue; }
    if (row.ease !== (m.ramp.ease !== false)) problems.push(`${row.id}: camEaseDown ${row.ease} != ${m.ramp.ease}`);
    if (row.angle !== m.ramp.angle) problems.push(`${row.id}: camEaseAngle ${row.angle} != ${m.ramp.angle}`);
    if (!row.ops.length) problems.push(`${row.id}: no ops to check`);
    for (const op of row.ops) {
        const diams = Object.keys(m.by_tool).map(Number);
        const best = diams.reduce((a, b) => Math.abs(b - op.toolMM) < Math.abs(a - op.toolMM) ? b : a);
        const p = m.by_tool[String(best)];
        const cmp = [['rate', 'feed'], ['plunge', 'plunge'], ['spindle', 'spindle'], ['down', 'stepdown'], ['step', 'stepover']];
        for (const [opk, mk] of cmp) {
            if (op[opk] !== p[mk]) problems.push(`${row.id}/${op.type} (${op.toolMM}mm→${best}): ${opk}=${op[opk]}, expected ${p[mk]}`);
        }
    }
}
// a preset that never applied would look identical across every material
const sig = new Set(out.perMaterial.map(r => JSON.stringify([r.angle, r.ops.map(o => o.rate)])));
if (out.perMaterial.length > 1 && sig.size === 1) problems.push('every material produced identical numbers — nothing is being applied');
for (const [mid, g] of Object.entries(out.gcode || {})) {
    const presets = Object.values(table[mid].by_tool);
    const feeds = presets.map(v => v.feed), spins = presets.map(v => v.spindle);
    if (g.preview !== 'preview.end') problems.push(`${mid}: toolpaths did not finish (${g.preview})`);
    if (!g.feeds.some(f => feeds.includes(f))) {
        problems.push(`${mid}: no preset feed (${feeds}) in the G-code F words: ${g.feeds}`);
    }
    if (!g.spindles.some(s => spins.includes(s))) {
        problems.push(`${mid}: no preset spindle (${spins}) in the G-code S words: ${g.spindles}`);
    }
    // the MR-1 caps at 8000 rpm; an S word above that is a program no machine can run
    if (g.spindles.some(s => s > 8000)) {
        problems.push(`${mid}: G-code commands ${g.spindles.filter(s => s > 8000)} rpm, over the 8000 rpm limit`);
    }
    // the device header opens at 1500 rpm, a speed no preset uses — so an
    // op-driven speed has to show up alongside it
    if (!g.spindles.some(s => s !== 1500)) {
        problems.push(`${mid}: the only S word is the device header's 1500 — no operation set its own speed`);
    }
}
// two materials that disagree in the table must disagree in the G-code
const gcs = Object.values(out.gcode || {});
if (gcs.length > 1 && JSON.stringify(gcs[0].spindles) === JSON.stringify(gcs[1].spindles)) {
    problems.push(`both materials exported the same spindle speeds (${gcs[0].spindles}) — the device header is speaking, not the material`);
}
if (gcs.length > 1 && JSON.stringify(gcs[0].feeds) === JSON.stringify(gcs[1].feeds)) {
    problems.push(`both materials exported the same feeds (${gcs[0].feeds}) — the preset is not reaching the program`);
}

out.verdict = problems.length ? 'FAIL' : 'PASS';
out.problems = problems;
console.log(JSON.stringify(out, null, 2));
process.exit(problems.length ? 1 : 0);
