/**
 * Probe: a returning browser carries the r21 tool library (seven tools, the
 * vee 1/8 at 0.125 mm) plus a tool the student added and an op that uses
 * it. After one boot the library must hold every default, the vee must be
 * 3.175 mm, the student's tool must survive with a T number no default
 * claims, and the op must still point at its tool and take the palette's
 * numbers for it once.
 *
 * Usage: node tools/probe_tool_migration.mjs [url]
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.argv[2] || 'http://localhost:8099/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));

const R21_TOOLS = [
    { id: 1000, number: 1, type: 'endmill',   name: 'end 1/4',   metric: false, shaft_diam: 0.25,   shaft_len: 1, flute_diam: 0.25,   flute_len: 0.5, taper_tip: 0 },
    { id: 1001, number: 2, type: 'endmill',   name: 'end 1/8',   metric: false, shaft_diam: 0.125,  shaft_len: 1, flute_diam: 0.125,  flute_len: 0.5, taper_tip: 0 },
    { id: 1002, number: 3, type: 'endmill',   name: 'end 1/16',  metric: false, shaft_diam: 0.0625, shaft_len: 1, flute_diam: 0.0625, flute_len: 0.5, taper_tip: 0 },
    { id: 1003, number: 4, type: 'tapermill', name: 'vee 1/8',   metric: true,  shaft_diam: 0.125,  shaft_len: 1, flute_diam: 0.125,  flute_len: 1.5, taper_angle: 5.3, taper_tip: 0 },
    { id: 1004, number: 5, type: 'ballmill',  name: 'ball 1/8',  metric: false, shaft_diam: 0.125,  shaft_len: 1, flute_diam: 0.125,  flute_len: 0.5, taper_tip: 0 },
    { id: 1005, number: 6, type: 'drill',     name: 'drill 1/8', metric: false, shaft_diam: 0.125,  shaft_len: 1, flute_diam: 0.125,  flute_len: 1.5, taper_tip: 0 },
    { id: 1006, number: 7, type: 'drill',     name: 'drill 1/4', metric: false, shaft_diam: 0.25,   shaft_len: 1, flute_diam: 0.25,   flute_len: 2,   taper_tip: 0 },
    // a student's own tool, numbered where "end 3mm" now sits
    { id: 1725000000000, number: 8, type: 'endmill', name: 'my 7/32', metric: false, shaft_diam: 0.25, shaft_len: 1, flute_diam: 0.21875, flute_len: 0.5, taper_tip: 0 },
];

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const out = { errors: [], before: null, after: null, verdict: 'unknown', problems: [] };
try {
    const page = await browser.newPage();
    page.on('pageerror', e => out.errors.push(e.message));
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await wait(5000);
    await page.waitForFunction(() => !!(window.kiri?.api?.conf), { timeout: 60000, polling: 200 });
    await wait(1000);

    // plant the r21 profile: old tools, and a rough op on the student's tool
    out.before = await page.evaluate(tools => {
        const s = JSON.parse(localStorage.getItem('ws-settings'));
        s.tools = tools;
        s.process.ops = [{ type: 'rough', tool: 1725000000000, rate: 500, plunge: 175, spindle: 8000, down: 1, step: 0.3 }];
        localStorage.setItem('ws-settings', JSON.stringify(s));
        return { tools: s.tools.length, op: s.process.ops[0].tool };
    }, R21_TOOLS);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await wait(3000);
    await page.waitForFunction(() => !!(window.kiri?.api?.conf), { timeout: 60000, polling: 200 });
    await wait(1500);
    out.after = await page.evaluate(() => {
        const s = window.kiri.api.conf.get();
        return {
            tools: s.tools.map(t => ({ id: t.id, number: t.number, name: t.name, mm: +((t.flute_diam || 0) * (t.metric ? 1 : 25.4)).toFixed(4) })),
            op: (s.process.ops || [])[0],
            stored: JSON.parse(localStorage.getItem('ws-settings')).tools.length,
        };
    });
} catch (e) {
    out.errors.push('host: ' + e.message);
} finally {
    await browser.close();
}

const p = out.problems;
const tools = out.after?.tools || [];
if (tools.length !== 21) p.push(`${tools.length} tools after migration, wanted 20 defaults + the student's`);
const vee = tools.find(t => t.id === 1003);
if (!vee || Math.abs(vee.mm - 3.175) > 0.01) p.push(`vee 1/8 is ${vee?.mm} mm after migration`);
const mine = tools.find(t => t.id === 1725000000000);
if (!mine) p.push("the student's tool was dropped");
else if (tools.some(t => t !== mine && t.number === mine.number)) p.push(`the student's tool shares T${mine.number} with a default`);
const nums = tools.map(t => t.number);
if (new Set(nums).size !== nums.length) p.push(`duplicate T numbers: ${nums}`);
if (out.after?.op?.tool !== 1725000000000) p.push(`the op's tool is ${out.after?.op?.tool}, it was the student's`);
// an r21 op carries no preset stamp, so it takes the material's numbers once
// (r21 overwrote it on every slice anyway); from then on edits stick
if (out.after?.op?.rate === 500 || !out.after?.op?.preset) p.push(`the op was not re-derived on first boot (rate ${out.after?.op?.rate}, preset ${out.after?.op?.preset})`);
if (out.after?.stored !== tools.length) p.push(`localStorage holds ${out.after?.stored} tools, the app ${tools.length} — the migration did not save`);
if (out.errors.length) p.push(`page errors: ${out.errors.join(' | ')}`);
out.verdict = p.length ? 'FAIL' : 'PASS';
console.log(JSON.stringify(out, null, 2));
process.exit(p.length ? 1 : 0);
