// The time estimate (swarf-estimate.js) against the card's own clock: the same file planned the way
// control plans it (swarf-run-plan.js), streamed by the card planner, every tick's length summed.
// (Phil 11-02: a machining time estimate in simulate, and an accurate one in export.)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Parse = require('../../web/kiri/swarf-run-parse.js');
globalThis.SwarfRunParse = Parse;
const Card = require('../../web/kiri/swarf-shopbot-card.js');
const Plan = require('../../web/kiri/swarf-run-plan.js');
const Est = require('../../web/kiri/swarf-estimate.js');
const { Planner, TICK_HZ } = Card;
const S = Est.SHOP;

// a file like swarf's ShopBot export: router on, a contour with plunges, a circle in 1 mm chords,
// a texture's raster (0.5 mm stepover, short moves up and down), rapids between
function file({ change = false } = {}) {
  const L = ["'UNITS:MM", 'CN, 90', 'TR,18000', 'C6', 'PAUSE 2', 'MS,25,10', 'J3,10,10,10'];
  L.push('M3,10,10,-3', 'MS,40,10', 'M3,110,10,-3', 'M3,110,70,-3', 'M3,10,70,-3', 'M3,10,10,-3', 'J3,10,10,10');
  L.push('J3,200,50,5');
  for (let i = 0; i <= 120; i++) { const a = i / 120 * 2 * Math.PI; L.push(`M3,${(160 + 40 * Math.cos(a)).toFixed(3)},${(50 + 40 * Math.sin(a)).toFixed(3)},-2`); }
  L.push('J3,160,50,10');
  if (change) L.push('C7', '&Tool =2', 'C9', 'C6', 'PAUSE 2');
  L.push('MS,41.5,5', 'J3,20,100,5');
  for (let r = 0; r < 60; r++) {
    const y = 100 + r * 0.5, xs = r % 2 ? [80, 20] : [20, 80];
    for (let j = 0; j <= 30; j++) { const x = xs[0] + (xs[1] - xs[0]) * j / 30; L.push(`M3,${x.toFixed(3)},${y.toFixed(3)},${(-1 - 0.8 * Math.sin(x / 3)).toFixed(3)}`); }
  }
  L.push('J3,80,130,25', 'C7', 'END');
  return L.join('\r\n');
}

// what the card takes: the control plan's steps as ops, streamed; each tick's length summed
function cardSeconds(text) {
  const src = Parse.parse(text, { machineUnits: 'mm' });
  const m0 = src.moves[0], pos = { x: m0.x0, y: m0.y0, z: m0.z0 };
  const cfg = { safeZ: 25.4, rapid: S.rapid, move: S.move, jog: { xy: 100, z: 100 }, spinUp: S.spinUp, changeZ: 50, unit: S.unit, tickHz: TICK_HZ };
  const plan = Plan.build({ name: 't', moves: src.moves, events: src.events, source: src, spindle: true }, { pos, live: true, cfg });
  assert.deepEqual(plan.problems, [], 'the test file plans cleanly');
  const ops = [];
  for (const s of plan.steps) {
    if (s.move) ops.push({ ...s.move, feed: s.feed, line: s.line });
    else if (s.router !== undefined) ops.push({ out: s.router ? 9 : 0, line: s.line });
    else if (s.dwell) ops.push({ dwell: s.dwell, line: s.line });
  }
  const p = new Planner({ unit: S.unit, rampSpeed: S.rampSpeed, rampRate: S.rampRate });
  let t = 0, r = 0, need = 0, kind = 0, buf = [];
  for (const b of p.items(ops, pos)) {
    if (need) { buf.push(b); if (--need === 0) { if (kind === 0x40) r = buf[3] << 8 | buf[4]; else if ((kind & 0xF0) === 0x60) r = 0xF000 | (kind & 0x0F) << 8 | buf[0]; } continue; }
    if (b === 0x78) break;
    if (b === 0x40) { kind = b; need = 5; buf = []; continue; }
    if ((b & 0xF0) === 0x60) { kind = b; need = 1; buf = []; continue; }
    if (b === 0x70) { kind = b; need = 2; buf = []; continue; }
    t += (0x10000 - r) / TICK_HZ;
  }
  return t;
}

const text = file();
const truth = cardSeconds(text);
const e = Est.of(text);
const naive = Parse.parse(text, { machineUnits: 'mm' }).seconds;
console.log(`card ${truth.toFixed(1)} s · estimate ${e.seconds.toFixed(1)} s (cut ${e.cut.toFixed(1)}, air ${e.air.toFixed(1)}, router ${e.dwell.toFixed(1)}) · distance over feed ${naive.toFixed(1)} s`);
assert.ok(Math.abs(e.seconds - truth) / truth < 0.02, `the estimate is within 2 % of the card's own clock (${e.seconds.toFixed(1)} vs ${truth.toFixed(1)})`);
assert.ok(truth > naive * 1.1, 'distance over feed alone is short on this file (why the estimate uses the card profile)');
assert.equal(Math.round(e.dwell), 5, "the router's spin-up (3 s) and the file's PAUSE 2");

// a bit change is counted, not timed; the time after it still counts
const c = Est.of(file({ change: true }));
assert.equal(c.changes, 1, 'one bit change');
assert.ok(c.seconds > e.seconds + 4, 'the second spin-up after the change counts');

// the first bit's load at the top of a file (swarf's export starts with one) is not a change
const first = Est.of(text.replace('CN, 90', 'CN, 90\r\n&Tool =1\r\nC9'));
assert.equal(first.changes, 0, 'loading the first bit is not a change');

// each step's share, from where the export said each starts; the shares add up to the whole
const lines = text.split('\r\n');
const at = lines.findIndex(l => l.startsWith('MS,41.5')) + 1;
const s = Est.of(text, { sections: [{ step: 0, line: 1 }, { step: 3, line: at }] });
assert.ok(Math.abs(s.steps[0] + s.steps[3] - s.seconds) < 1e-6, 'step shares add up');
assert.ok(s.steps[3] > s.steps[0], 'the raster takes longer than the outline and circle');

assert.equal(Est.words(30), 'under a minute');
assert.equal(Est.words(14 * 60 + 10), 'about 14 min');
assert.equal(Est.words(3900), 'about 1 h 05 min');
assert.equal(Est.short(3900), '1 h 05');
console.log('estimate: ok');
