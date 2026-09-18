/**
 * Probe: drive the MATERIAL dropdown like a student and check that every
 * material's derived numbers land on the ops and on the process ramp, that
 * a student's own edit survives a preview, that changing an op's tool
 * re-derives for the new diameter, and that the preset reaches the program
 * on BOTH devices (S words on the MR-1, TR words on the ShopBot).
 *
 * Usage: node tools/probe_materials.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.argv[2] || 'http://localhost:8099/kiri/';
const STL = '/Users/philrenato/Documents/claude/swarf/swarf_repo/web/obj/cube.stl';
const TABLE = JSON.parse(readFileSync('web/kiri/swarf-materials.json', 'utf8'));
const MR1 = JSON.parse(readFileSync('src/kiri/dev/cam/Langmuir.MR-1.json', 'utf8'));
const SHOPBOT = JSON.parse(readFileSync('src/kiri/dev/cam/ShopBot.Basic.json', 'utf8'));

// the same derive() the app runs, so the expectation is the app's own arithmetic
const win = { localStorage: { getItem() { return null; }, setItem() {} } };
win.window = win;
win.document = { readyState: 'loading', addEventListener() {} };
win.fetch = () => new Promise(() => {});
win.console = console;
vm.runInNewContext(readFileSync('web/kiri/swarf-material.js', 'utf8'), win);
const derive = win.__swarfDerive;
const limits = (dev, camFastFeedZ) => ({
    spindleMin: dev.spindleMin || 0, spindleMax: dev.spindleMax || 0, feedMax: dev.feedMax || 0,
    feedMaxZ: Math.min(...[dev.feedMaxZ, camFastFeedZ].filter(v => v > 0)),
});

const stlB64 = readFileSync(STL).toString('base64');
const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    defaultViewport: { width: 1600, height: 1000 },
    args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const out = { errors: [], dropdown: null, tools: null, perMaterial: [], edit: null, retool: null, gcode: {}, verdict: 'unknown' };
const wait = ms => new Promise(r => setTimeout(r, ms));

try {
    const page = await browser.newPage();
    page.on('pageerror', e => out.errors.push(e.message));

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // swarf's profile migration reloads the page once on a fresh browser
    // profile. A handle grabbed before that is torn out from under us, and
    // the failure reads as "kiri.api is undefined" long after boot.
    await wait(5000);
    await page.waitForFunction(
        () => !!(window.kiri?.api?.event && window.kiri.api.new && window.kiri.api.platform),
        { timeout: 60000, polling: 200 });
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
    out.dropdown = await page.evaluate(() =>
        Array.from(document.getElementById('swarf-material-select').options).map(o => o.value));
    out.tools = await page.evaluate(() => (window.kiri.api.conf.get().tools || []).map(t => ({
        id: t.id, number: t.number, name: t.name, metric: t.metric,
        mm: +((t.flute_diam || 0) * (t.metric ? 1 : 25.4)).toFixed(4),
    })));

    const setMaterial = async mid => {
        await page.evaluate(m => {
            const sel = document.getElementById('swarf-material-select');
            sel.value = m;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }, mid);
        await wait(350);
    };
    const readOps = () => page.evaluate(() => {
        const s = window.kiri.api.conf.get();
        const tools = s.tools || [];
        return {
            device: s.device.deviceName,
            camFastFeedZ: s.process.camFastFeedZ,
            ease: s.process.camEaseDown,
            angle: s.process.camEaseAngle,
            ops: (s.process.ops || []).filter(o => o && o.type && o.type !== '|').map(o => {
                const t = tools.find(t => t.id == o.tool);
                return {
                    type: o.type, tool: o.tool, toolName: t?.name,
                    toolMM: t ? +((t.flute_diam || 0) * (t.metric ? 1 : 25.4)).toFixed(4) : null,
                    rate: o.rate, plunge: o.plunge, spindle: o.spindle, down: o.down, step: o.step,
                };
            }),
        };
    });
    const addOp = async label => {
        await page.evaluate(lbl => {
            const list = document.getElementById('op-add-list');
            const el = Array.from(list.children).find(c => c.innerText.trim().toLowerCase() === lbl);
            el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }, label);
        await wait(400);
    };
    const exportGcode = async () => {
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
        return {
            preview,
            bytes: gcode.length,
            feeds: [...new Set((gcode.match(/F[\d.]+/g) || []).map(f => +f.slice(1)))].sort((a, b) => a - b),
            spindles: [...new Set((gcode.match(/\bS\d+/g) || []).map(s => +s.slice(1)))].sort((a, b) => a - b),
            tr: [...new Set((gcode.match(/^TR,\d+/gm) || []).map(s => +s.slice(3)))].sort((a, b) => a - b),
            toolLines: (gcode.match(/^(M00|M6|&Tool ?=\d+).*$/gm) || []),
            head: gcode.split('\n').slice(0, 12),
        };
    };

    // rough + contour through the real "add a step" grid
    await addOp('rough');
    await addOp('contour');

    for (const id of out.dropdown) {
        await setMaterial(id);
        out.perMaterial.push({ id, ...(await readOps()) });
    }

    // EDITED FIXTURE: a student slows the rough feed through swarf's own
    // drawer input, previews, and the program must carry the edit
    await setMaterial('hardwood');
    const edited = await page.evaluate(() => {
        const inp = document.querySelector('[data-swarf-field="rate"]');
        if (!inp) return null;
        inp.value = '333';
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return 333;
    });
    const afterEdit = await readOps();
    const editGcode = await exportGcode();
    const afterPreview = await readOps();
    out.edit = { edited, afterEdit: afterEdit.ops[0], afterPreview: afterPreview.ops[0], feeds: editGcode.feeds };

    // RETOOL: the contour op moves from its default tool to the 1/16 endmill
    // through the drawer's tool select — the numbers must re-derive
    const before = (await readOps()).ops[1];
    const retoolId = out.tools.find(t => t.name === 'end 1/16')?.id;
    await page.evaluate(id => {
        const sel = document.querySelectorAll('[data-swarf-field="tool"]')[1];
        sel.value = String(id);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, retoolId);
    await wait(300);
    const after = (await readOps()).ops[1];
    out.retool = { before, after };

    // G-CODE on the MR-1: two materials that disagree on every number, and a
    // second tool so a tool change has to appear
    for (const mid of ['mild_steel', 'aluminum_6061']) {
        await setMaterial(mid);
        out.gcode[`mr1:${mid}`] = { ...(await exportGcode()), ops: (await readOps()).ops };
    }
    // G-CODE on the ShopBot: same program, SBP dialect
    await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
    await wait(800);
    await setMaterial('hardwood');
    out.gcode['shopbot:hardwood'] = { ...(await exportGcode()), ops: (await readOps()).ops, device: (await readOps()).device };
    await page.evaluate(() => window.kiri.api.devices.select('Langmuir.MR-1'));
    await wait(500);
} catch (e) {
    out.errors.push('host: ' + e.message);
} finally {
    await browser.close();
}

// ---- verdict -----------------------------------------------------------
const table = Object.fromEntries(TABLE.materials.map(m => [m.id, m]));
const problems = [];
if (out.dropdown?.length !== TABLE.materials.length) {
    problems.push(`dropdown lists ${out.dropdown?.length} of ${TABLE.materials.length} materials`);
}
const vee = out.tools?.find(t => t.name === 'vee 1/8');
if (!vee || Math.abs(vee.mm - 3.175) > 0.01) problems.push(`vee 1/8 is ${vee?.mm} mm in the live library`);
if ((out.tools?.length || 0) < 20) problems.push(`live library has ${out.tools?.length} tools, expected the 20 defaults`);

const expect = (row, op, dev) => {
    const lim = limits(dev, row.camFastFeedZ);
    const p = derive(table[row.id], op.toolMM, lim);
    if (op.type === 'drill') return { rate: p.plunge, spindle: p.spindle, down: p.stepdown };
    if (op.type === 'contour') return { rate: p.feed, spindle: p.spindle, step: p.stepover };
    return { rate: p.feed, plunge: p.plunge, spindle: p.spindle, down: p.stepdown, step: p.stepover };
};
for (const row of out.perMaterial) {
    const m = table[row.id];
    if (!m) { problems.push(`${row.id}: not in the table`); continue; }
    if (row.ease !== (m.ramp.ease !== false)) problems.push(`${row.id}: camEaseDown ${row.ease} != ${m.ramp.ease}`);
    if (row.angle !== m.ramp.angle) problems.push(`${row.id}: camEaseAngle ${row.angle} != ${m.ramp.angle}`);
    if (!row.ops.length) problems.push(`${row.id}: no ops to check`);
    for (const op of row.ops) {
        if (!op.toolMM) { problems.push(`${row.id}/${op.type}: tool ${op.tool} not found in the library`); continue; }
        for (const [k, v] of Object.entries(expect(row, op, MR1))) {
            if (op[k] !== v) problems.push(`${row.id}/${op.type} (${op.toolMM}mm): ${k}=${op[k]}, expected ${v}`);
        }
    }
}
const sig = new Set(out.perMaterial.map(r => JSON.stringify([r.angle, r.ops.map(o => o.rate)])));
if (out.perMaterial.length > 1 && sig.size === 1) problems.push('every material produced identical numbers — nothing is being applied');

// the edit survives the preview and reaches the program
if (!out.edit || out.edit.edited !== 333) problems.push('edit: the drawer feed input was not found');
else {
    if (out.edit.afterEdit?.rate !== 333) problems.push(`edit: rate ${out.edit.afterEdit?.rate} right after the edit — something overwrote it`);
    if (out.edit.afterPreview?.rate !== 333) problems.push(`edit: rate ${out.edit.afterPreview?.rate} after preview — the preset overwrote the student's edit`);
    if (!out.edit.feeds.includes(333)) problems.push(`edit: F333 missing from the program (F words: ${out.edit.feeds})`);
}
// the retool re-derives
if (!out.retool?.after?.toolMM) problems.push('retool: contour op lost its tool');
else {
    const row = { id: 'hardwood', camFastFeedZ: out.perMaterial[0]?.camFastFeedZ };
    const want = expect(row, out.retool.after, MR1);
    if (Math.abs(out.retool.after.toolMM - 1.5875) > 0.01) problems.push(`retool: contour tool is ${out.retool.after.toolMM} mm, wanted 1.5875`);
    for (const [k, v] of Object.entries(want)) {
        if (out.retool.after[k] !== v) problems.push(`retool: contour ${k}=${out.retool.after[k]}, expected ${v} for the 1/16`);
    }
    if (out.retool.after.rate === out.retool.before.rate && out.retool.after.spindle === out.retool.before.spindle) {
        problems.push('retool: contour numbers did not change with the tool');
    }
}
// MR-1 programs
for (const mid of ['mild_steel', 'aluminum_6061']) {
    const g = out.gcode[`mr1:${mid}`];
    if (!g) { problems.push(`${mid}: no MR-1 export`); continue; }
    if (g.preview !== 'preview.end') problems.push(`${mid}: toolpaths did not finish (${g.preview})`);
    const spins = g.ops.map(o => o.spindle);
    if (!g.spindles.some(s => spins.includes(s))) problems.push(`${mid}: no op spindle (${spins}) in the S words: ${g.spindles}`);
    if (g.spindles.some(s => s > MR1.spindleMax)) problems.push(`${mid}: S words ${g.spindles} exceed ${MR1.spindleMax}`);
    // two tools in the program (rough on the 1/4, contour on the 1/16) need a pause
    if (!g.toolLines.some(l => l.startsWith('M00'))) problems.push(`${mid}: no M00 tool-change pause between two tools (${g.toolLines})`);
}
const a = out.gcode['mr1:mild_steel'], b = out.gcode['mr1:aluminum_6061'];
if (a && b && JSON.stringify(a.spindles) === JSON.stringify(b.spindles)) problems.push(`both MR-1 materials exported the same spindles (${a.spindles})`);
if (a && b && JSON.stringify(a.feeds) === JSON.stringify(b.feeds)) problems.push(`both MR-1 materials exported the same feeds (${a.feeds})`);
// ShopBot program
const sb = out.gcode['shopbot:hardwood'];
if (!sb) problems.push('shopbot: no export');
else {
    if (sb.device !== 'ShopBot.Basic') problems.push(`shopbot: device is ${sb.device}`);
    if (sb.preview !== 'preview.end') problems.push(`shopbot: toolpaths did not finish (${sb.preview})`);
    const spins = sb.ops.map(o => o.spindle);
    if (!sb.tr.some(s => spins.includes(s))) problems.push(`shopbot: no op spindle (${spins}) in the TR words: ${sb.tr}`);
    if (sb.tr.some(s => s < SHOPBOT.spindleMin || s > SHOPBOT.spindleMax)) problems.push(`shopbot: TR words ${sb.tr} outside ${SHOPBOT.spindleMin}–${SHOPBOT.spindleMax}`);
    if (sb.toolLines.some(l => l.startsWith('M6'))) problems.push(`shopbot: M6 in an SBP program (${sb.toolLines})`);
    if (!sb.toolLines.some(l => l.startsWith('&Tool'))) problems.push(`shopbot: no &Tool line (${sb.toolLines})`);
    if (sb.head.some(l => /TR,4000/.test(l))) problems.push('shopbot: header still fixes TR,4000');
}

out.verdict = problems.length ? 'FAIL' : 'PASS';
out.problems = problems;
console.log(JSON.stringify(out, null, 2));
process.exit(problems.length ? 1 : 0);
