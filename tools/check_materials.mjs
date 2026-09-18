#!/usr/bin/env node
// Invariant check for web/kiri/swarf-materials.json, run through the app's
// own derive function (window.__swarfDerive in web/kiri/swarf-material.js)
// over every tool in the default library on both devices. Every number a
// student can land on must be survivable on a hobby mill without touching
// a field: conservative feeds, a plunge slower than the feed, a stepdown
// the flutes can clear, a spindle inside the machine, a ramp the engine
// accepts.
// Run: node tools/check_materials.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const data = JSON.parse(read('web/kiri/swarf-materials.json'));

// the app's derive(): run swarf-material.js with just enough window to load
const win = { localStorage: { getItem() { return null; }, setItem() {} } };
win.window = win;
win.document = { readyState: 'loading', addEventListener() {} };
win.fetch = () => new Promise(() => {});
win.console = console;
vm.runInNewContext(read('web/kiri/swarf-material.js'), win);
const derive = win.__swarfDerive;
if (typeof derive !== 'function') {
    console.error('window.__swarfDerive is not exposed by swarf-material.js');
    process.exit(1);
}

// the default tool library, lifted from defaults.js's settings template
const defaults = read('src/kiri/app/conf/defaults.js');
const toolsSrc = defaults.slice(defaults.indexOf('tools:[', defaults.indexOf('template:')));
const tools = new Function(`return [${toolsSrc.slice(7, toolsSrc.indexOf('\n        ],'))}]`)();
const toolMm = t => (t.flute_diam || t.shaft_diam || 0) * (t.metric ? 1 : 25.4);

// device limits, as the app reads them (deviceLimits in swarf-material.js)
const CAM_FAST_FEED_Z = Number(defaults.match(/camFastFeedZ:\s*([\d.]+)/)[1]);
const devDir = 'src/kiri/dev/cam';
const devices = readdirSync(join(root, devDir)).filter(f => f.endsWith('.json')).map(f => {
    const d = JSON.parse(read(join(devDir, f)));
    const zcaps = [d.feedMaxZ, CAM_FAST_FEED_Z].filter(v => v > 0);
    return {
        name: d.deviceName || f,
        spindleMin: d.spindleMin || 0,
        spindleMax: d.spindleMax || 0,
        feedMax: d.feedMax || 0,
        feedMaxZ: zcaps.length ? Math.min(...zcaps) : 0,
    };
});
const EASE_MIN = 0.1, EASE_MAX = 85;  // camEaseAngle bound in init-menu.js

const fail = [];
const flag = (id, msg) => fail.push(`${id}: ${msg}`);

if (tools.length < 7) flag('<tools>', `only ${tools.length} default tools parsed from defaults.js`);
for (const t of tools) {
    const mm = toolMm(t);
    // ER-20 / ER-25 collets hold 1–13 mm; a 0.125 mm "1/8" is the unit flag lying
    if (!(mm >= 0.5 && mm <= 13)) flag(`tool ${t.name}`, `${mm.toFixed(3)} mm diameter is outside the collet range — check metric:${t.metric}`);
    if (!(t.flute_len > 0 && t.shaft_len > 0)) flag(`tool ${t.name}`, 'flute_len / shaft_len must be positive');
    if (t.shaft_diam < t.flute_diam) flag(`tool ${t.name}`, 'shank narrower than the flute');
}
const nums = tools.map(t => t.number);
if (new Set(nums).size !== nums.length) flag('<tools>', 'duplicate tool numbers');
const ids = tools.map(t => t.id);
if (new Set(ids).size !== ids.length) flag('<tools>', 'duplicate tool ids');
if (!devices.length) flag('<devices>', `no device profiles in ${devDir}`);
for (const d of devices) {
    if (!(d.spindleMax > 0)) flag(d.name, 'spindleMax is 0 — no spindle word is ever emitted (export.js:227) and the op field is hidden (cl-ops.js hasSpindle)');
    if (!(d.feedMax > 0)) flag(d.name, 'no feedMax — the palette has no ceiling on this machine');
}

const mats = data.materials || [];
if (mats.length < 2) flag('<file>', `only ${mats.length} material(s) defined`);
if (data.default && !mats.some(m => m.id === data.default)) {
    flag('<file>', `default "${data.default}" names no material`);
}

for (const m of mats) {
    const id = m.id || '<unnamed>';
    if (!m.name) flag(id, 'no display name');
    if (!m.note) flag(id, 'no note — students read it to know what they are cutting');
    if (!m.appearance) flag(id, 'no appearance block — bootstrap filters it out of the dropdown');

    const r = m.ramp;
    if (!r || typeof r.angle !== 'number') {
        flag(id, 'no ramp.angle — no ease-down preset');
    } else if (r.angle < EASE_MIN || r.angle > EASE_MAX) {
        flag(id, `ramp.angle ${r.angle}° outside the camEaseAngle bound ${EASE_MIN}–${EASE_MAX}`);
    }
    if (r && typeof r.ease !== 'boolean') flag(id, 'ramp.ease is not a boolean');

    const c = m.cut;
    if (!c) { flag(id, 'no cut record — nothing to derive from'); continue; }
    for (const k of ['vc', 'flutes', 'chip', 'down', 'downMax', 'stepover']) {
        if (typeof c[k] !== 'number') flag(id, `cut.${k} missing or not a number`);
    }
    if (!(c.down > 0 && c.down < 0.5)) flag(id, `cut.down ${c.down} must sit in (0, 0.5) so stepdown stays under half the diameter`);
    if (!(c.stepover > 0 && c.stepover <= 0.5)) flag(id, `cut.stepover ${c.stepover} outside (0, 0.5]`);

    for (const dev of devices) {
        let lastFeed = 0, lastMm = 0;
        const byMm = tools.slice().sort((a, b) => toolMm(a) - toolMm(b));
        for (const t of byMm) {
            const mm = toolMm(t);
            const where = `${dev.name} ${t.name}`;
            const p = derive(m, mm, dev);
            if (!p) { flag(id, `${where}: derive returned nothing`); continue; }
            for (const k of ['feed', 'plunge', 'spindle', 'stepdown', 'stepover']) {
                if (!(p[k] > 0)) flag(id, `${where}: ${k} is ${p[k]}`);
            }
            if (p.spindle > dev.spindleMax) flag(id, `${where}: spindle ${p.spindle} over the ${dev.spindleMax} rpm ceiling`);
            if (dev.spindleMin && p.spindle < dev.spindleMin) flag(id, `${where}: spindle ${p.spindle} under the ${dev.spindleMin} rpm floor`);
            if (p.feed > dev.feedMax) flag(id, `${where}: feed ${p.feed} over the ${dev.feedMax} mm/min ceiling`);
            if (dev.feedMaxZ && p.plunge > dev.feedMaxZ) flag(id, `${where}: plunge ${p.plunge} over the ${dev.feedMaxZ} mm/min Z ceiling`);
            const ratio = p.plunge / p.feed;
            const capped = dev.feedMaxZ && p.plunge === dev.feedMaxZ;
            if (!capped && (ratio < 0.30 || ratio > 0.40)) {
                flag(id, `${where}: plunge is ${(ratio * 100).toFixed(0)}% of feed — wanted 30–40%`);
            }
            if (p.stepdown > mm / 2) flag(id, `${where}: stepdown ${p.stepdown} mm is over half the ${mm.toFixed(3)} mm tool diameter`);
            // on a machine with no spindle floor the clamp only ever slows the
            // tool, so the cutting speed can never exceed the material's figure
            if (!dev.spindleMin && p.vc > c.vc) flag(id, `${where}: ${p.vc} m/min exceeds the material's ${c.vc}`);
            // a bigger tool never gets a smaller feed (rpm floors to 50, feed to 10)
            if (t.type === 'endmill' && mm > lastMm && p.feed < lastFeed - 10) {
                flag(id, `${where}: feed falls from ${lastFeed} to ${p.feed} as the tool grows`);
            }
            if (t.type === 'endmill') { lastFeed = p.feed; lastMm = mm; }
        }
    }
}

if (fail.length) {
    console.error(`materials check FAILED — ${fail.length} problem(s):`);
    for (const f of fail) console.error('  ' + f);
    process.exit(1);
}
console.log(`materials check passed — ${mats.length} materials x ${tools.length} tools x ${devices.length} devices`);
