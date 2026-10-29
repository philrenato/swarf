#!/usr/bin/env node
// Auto tabs, without a browser: the rule's defaults for the two shop cases (3/4 in plywood on the
// ShopBot, 1 in aluminum on the MR-1) and the placement on sliced parts (a plate, a ring with a
// big hole, a small part, an L, a plate with a small hole): every tab on the outline, clear of
// corners, facing away from the material, spread by length.
// Run: node tools/test-autotabs.mjs
import { tabRule, planTabs, sliceLoops, tabRecord, area, inside } from '../src/kiri/mode/cam/app/autotab-rule.js';

const bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const IN = 25.4;

// ---- the rule -----------------------------------------------------------------------------
const ply = tabRule({ materialId: 'plywood', bitMm: IN / 4, thicknessMm: 0.75 * IN, deviceName: 'ShopBot.Basic' });
const alu = tabRule({ materialId: 'aluminum_6061', metal: true, bitMm: IN / 4, thicknessMm: IN, deviceName: 'Langmuir MR-1' });
const alu8 = tabRule({ materialId: 'aluminum_6061', metal: true, bitMm: IN / 8, thicknessMm: IN / 4, deviceName: 'Langmuir MR-1' });
const acr = tabRule({ materialId: 'acrylic', bitMm: IN / 8, thicknessMm: 6, deviceName: 'Langmuir MR-1' });
const thinPly = tabRule({ materialId: 'plywood', bitMm: IN / 8, thicknessMm: IN / 8, deviceName: 'ShopBot.Basic' });
const foam = tabRule({ materialId: 'foam', bitMm: IN / 4, thicknessMm: 2 * IN, deviceName: 'ShopBot.Basic' });
console.log('\nrule (mm)              width  height depth spacing min');
for (const [n, r] of [['3/4 ply, 1/4 bit, SB', ply], ['1 alu, 1/4 bit, MR-1', alu], ['1/4 alu, 1/8 bit, MR-1', alu8], ['6 mm acrylic, 1/8, MR-1', acr], ['1/8 ply, 1/8 bit, SB', thinPly], ['2 in foam, 1/4, SB', foam]])
    console.log(n.padEnd(24), String(r.width).padEnd(6), String(r.height).padEnd(6), String(r.depth).padEnd(5), String(r.spacing).padEnd(7), r.minTabs);
console.log('');
check(Math.abs(ply.width - 12.7) < 0.01 && Math.abs(ply.height - 4.76) < 0.01 && ply.spacing === 250 && ply.minTabs === 4,
    `3/4 in plywood on the ShopBot: 1/2 in wide, 3/16 in tall, every 250 mm, at least 4 (${JSON.stringify([ply.width, ply.height, ply.spacing, ply.minTabs])})`);
check(Math.abs(alu.width - 6.35) < 0.01 && Math.abs(alu.height - 2.54) < 0.01 && alu.spacing === 250 && alu.minTabs === 3,
    `1 in aluminum on the MR-1: 1/4 in wide, 0.1 in tall, every 250 mm, at least 3 (${JSON.stringify([alu.width, alu.height, alu.spacing, alu.minTabs])})`);
check(alu.height / alu.thickness < ply.height / ply.thickness && alu.width < ply.width, 'aluminum tabs are thinner for the board and narrower than plywood tabs');
check(alu8.height === 1 && alu8.width === 3.18 && thinPly.height === 1.59, `floors and the half-board cap: 1/4 in alu ${alu8.height} mm (floor 1), 1/8 in ply ${thinPly.height} mm (half of 3.175, under the 2.5 floor)`);
check(thinPly.spacing < ply.spacing, `thin plywood gets tabs closer (${thinPly.spacing} < ${ply.spacing})`);
const more = tabRule({ materialId: 'plywood', bitMm: IN / 4, thicknessMm: 0.75 * IN, deviceName: 'ShopBot.Basic', density: 2, scale: 2 });
const fewer = tabRule({ materialId: 'plywood', bitMm: IN / 4, thicknessMm: 0.75 * IN, deviceName: 'ShopBot.Basic', density: -2, scale: -2 });
check(more.spacing === 125 && fewer.spacing === 500 && more.width > ply.width && fewer.width < ply.width && fewer.height >= 2.5 && more.height <= 0.5 * more.thickness,
    `sliders: more = every ${more.spacing}, fewer = every ${fewer.spacing}; larger ${more.width}x${more.height}, smaller ${fewer.width}x${fewer.height} (floor holds)`);

// ---- placement on sliced parts ------------------------------------------------------------
// walls of an extruded part (outer loop and holes), as the triangle soup a widget gives
function extrude(loops, T) {
    const out = [];
    for (const lp of loops) for (let i = 0; i < lp.length; i++) {
        const a = lp[i], b = lp[(i + 1) % lp.length];
        out.push(a.x, a.y, 0, b.x, b.y, 0, b.x, b.y, T, a.x, a.y, 0, b.x, b.y, T, a.x, a.y, T);
    }
    return new Float32Array(out);
}
const rect = (x0, y0, w, h) => [{ x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h }];
const circle = (cx, cy, r, n = 96) => Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos(i * 2 * Math.PI / n), y: cy + r * Math.sin(i * 2 * Math.PI / n) }));
const distToLoop = (p, lp) => {
    let d = Infinity;
    for (let i = 0; i < lp.length; i++) {
        const a = lp[i], b = lp[(i + 1) % lp.length], dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
        d = Math.min(d, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t));
    }
    return d;
};
const cornerClear = (p, lp) => Math.min(...lp.map(c => Math.hypot(p.x - c.x, p.y - c.y)));

function run(name, src, T, rule, expect) {
    const loops = sliceLoops(extrude(src, T), rule.height / 2);
    const plan = planTabs(loops, rule);
    const outerTabs = plan.tabs.filter(t => !t.hole), holeTabs = plan.tabs.filter(t => t.hole);
    check(loops.length === src.length, `${name}: sliced ${loops.length} loop(s)`);
    const onEdge = plan.tabs.every(t => Math.min(...loops.map(l => distToLoop(t, l))) < 1e-3);
    // away from material: half a tab depth along the normal is outside the part (or in the hole)
    const solid = p => { let c = 0; for (const l of loops) if (inside(p, l)) c++; return c % 2 === 1; };
    const away = plan.tabs.every(t => !solid({ x: t.x + t.nx * rule.depth / 2, y: t.y + t.ny * rule.depth / 2 }) && solid({ x: t.x - t.nx * 0.5, y: t.y - t.ny * 0.5 }));
    // corners: no tab nearer a sharp corner than half its width and a bit
    const sharp = src.filter(l => l.length <= 12);
    const clear = sharp.length ? plan.tabs.every(t => sharp.every(l => cornerClear(t, l) >= rule.width / 2 + rule.bit - 1e-6)) : true;
    // spread: on each loop, gaps along the outline within 35% of even
    let even = true;
    for (const li of new Set(plan.tabs.map(t => t.loop))) {
        const at = plan.tabs.filter(t => t.loop === li).map(t => t.at).sort((a, b) => a - b), L = plan.tabs.find(t => t.loop === li).of;
        const gaps = at.map((a, i) => (i + 1 < at.length ? at[i + 1] : at[0] + L) - a), mean = L / at.length;
        if (at.length > 1 && gaps.some(g => Math.abs(g - mean) > 0.35 * mean)) even = false;
    }
    check(onEdge && away && clear && even, `${name}: ${outerTabs.length} outside + ${holeTabs.length} hole tab(s), on the edge ${onEdge}, facing out ${away}, clear of corners ${clear}, evenly spread ${even}`);
    if (expect) check(expect(outerTabs, holeTabs, plan), `${name}: ${expect.toString().replace(/\s+/g, ' ').slice(0, 110)}`);
    return { loops, plan };
}

// a 600 x 400 mm plate of 3/4 ply on the ShopBot: 2000 mm around / 250 = 8
const plate = run('600x400 ply plate', [rect(0, 0, 600, 400)], 19.05, ply, (o, h) => o.length === 8 && h.length === 0);
// a 300 x 200 part: 4, one on each side, at the side's middle
run('300x200 ply part', [rect(0, 0, 300, 200)], 19.05, ply, (o) => o.length === 4 && o.every(t => Math.abs(t.x - 150) < 0.5 || Math.abs(t.y - 100) < 0.5));
// a ring with a 200 mm hole: the hole's cut-out piece is big, it gets tabs; the outside 4+
run('ring 400 / hole 200', [circle(0, 0, 200), circle(0, 0, 100).reverse()], 19.05, ply, (o, h) => o.length >= 5 && h.length >= 2);
// a plate with a 40 mm hole: the hole gets none
run('plate with small hole', [rect(0, 0, 300, 200), circle(150, 100, 20).reverse()], 19.05, ply, (o, h) => o.length === 4 && h.length === 0);
// a small 60 x 30 part: fewer, still more than one
run('60x30 small part', [rect(0, 0, 60, 30)], 19.05, ply, (o) => o.length >= 2 && o.length <= 3);
// an L: tabs keep off its six corners
run('L bracket', [[{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 60 }, { x: 60, y: 60 }, { x: 60, y: 300 }, { x: 0, y: 300 }]], 19.05, ply, (o) => o.length === 5);
// 1 in aluminum on the MR-1, a 150 x 100 part: 500 mm around would be 2, a rectangle gets one a side
run('150x100 alu part', [rect(0, 0, 150, 100)], 25.4, alu, (o) => o.length === 4);
// a 120 mm aluminum disc: no sides, the MR-1's 3
run('120 alu disc', [circle(0, 0, 60)], 25.4, alu, (o) => o.length === 3);
// at "fewer" the rectangle may drop to 3
run('150x100 alu, fewer', [rect(0, 0, 150, 100)], 25.4, tabRule({ materialId: 'aluminum_6061', metal: true, bitMm: IN / 4, thicknessMm: IN, deviceName: 'Langmuir MR-1', density: -2 }), (o) => o.length === 3);
// 1 in aluminum, a 300 x 200 part: 1000 / 250 = 4
run('300x200 alu part', [rect(0, 0, 300, 200)], 25.4, alu, (o) => o.length === 4);
// more density: the 600 x 400 plate gets twice as many
run('600x400 ply, more', [rect(0, 0, 600, 400)], 19.05, more, (o) => o.length === 16);

// ---- the record is an ordinary tab ---------------------------------------------------------
const t0 = plate.plan.tabs[0];
const rec = tabRecord(t0, ply, ply.height / 2, 1);
const ang = 2 * Math.atan2(rec.rot[2], rec.rot[3]);
check(rec.auto === true && rec.dim.y === ply.width && rec.dim.z === ply.height && rec.dim.x === ply.depth
    && Math.abs(Math.cos(ang) - t0.nx) < 1e-9 && Math.abs(Math.sin(ang) - t0.ny) < 1e-9
    && Math.abs(Math.hypot(rec.pos.x - t0.x, rec.pos.y - t0.y) - ply.depth / 2) < 1e-9,
    'a record is { pos, dim {depth, width, height}, rot about Z to the edge normal, id, auto }, half a depth out');
check(area(rect(0, 0, 1, 1)) > 0, 'area sign');

if (bad.length) { console.log(`\n${bad.length} FAILED`); process.exit(1); }
console.log('\nall auto-tab checks passed');
