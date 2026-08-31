#!/usr/bin/env node
// Invariant check for web/kiri/swarf-materials.json.
// Every entry must be survivable on a hobby mill by a student who never
// touches a number: conservative feeds, a plunge slower than the feed, a
// stepdown the flutes can clear, and a ramp angle the engine accepts.
// Run: node tools/check_materials.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'web/kiri/swarf-materials.json'), 'utf8'));

// the three endmills in the default tool library (src/kiri/app/conf/defaults.js)
const TOOL_DIAMS = ['1.5875', '3.175', '6.35'];
const MAX_FEED = 2540;      // MR-1 ceiling, mm/min
const MAX_SPINDLE = 8000;   // MR-1 ceiling, rpm
const EASE_MIN = 0.1, EASE_MAX = 85;  // camEaseAngle bound in init-menu.js

const fail = [];
const flag = (id, msg) => fail.push(`${id}: ${msg}`);

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

    const bt = m.by_tool || {};
    for (const d of TOOL_DIAMS) {
        if (!bt[d]) { flag(id, `no preset for the ${d} mm tool`); continue; }
        const p = bt[d], diam = Number(d);
        for (const k of ['feed', 'plunge', 'spindle', 'stepdown', 'stepover']) {
            if (typeof p[k] !== 'number') flag(id, `${d}: ${k} missing or not a number`);
        }
        if (p.feed > MAX_FEED) flag(id, `${d}: feed ${p.feed} over the ${MAX_FEED} mm/min ceiling`);
        if (p.spindle > MAX_SPINDLE) flag(id, `${d}: spindle ${p.spindle} over the ${MAX_SPINDLE} rpm ceiling`);
        const ratio = p.plunge / p.feed;
        if (ratio < 0.30 || ratio > 0.40) {
            flag(id, `${d}: plunge is ${(ratio * 100).toFixed(0)}% of feed — wanted 30–40%`);
        }
        if (p.stepdown > diam / 2) {
            flag(id, `${d}: stepdown ${p.stepdown} mm is over half the ${diam} mm tool diameter`);
        }
        if (!(p.stepover > 0 && p.stepover <= 0.5)) {
            flag(id, `${d}: stepover ${p.stepover} outside (0, 0.5]`);
        }
    }
    // A bigger tool takes a bigger feed unless the spindle slowed to hold
    // cutting speed — which is the whole reason HSS numbers look the way
    // they do. A feed that drops while the RPM held steady is a typo.
    const steps = TOOL_DIAMS.map(d => bt[d]).filter(Boolean);
    for (let i = 1; i < steps.length; i++) {
        if (steps[i].feed < steps[i - 1].feed * 0.9 && steps[i].spindle >= steps[i - 1].spindle) {
            flag(id, `feed falls from ${steps[i - 1].feed} to ${steps[i].feed} at unchanged spindle`);
        }
    }
}

if (fail.length) {
    console.error(`materials check FAILED — ${fail.length} problem(s):`);
    for (const f of fail) console.error('  ' + f);
    process.exit(1);
}
console.log(`materials check passed — ${mats.length} materials x ${TOOL_DIAMS.length} tools`);
