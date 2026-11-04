// An air cut's speed slider (Phil 11-04: "real speed is fine. Maybe with an accelerator slider"): the
// rate is planned in, so a square corner still comes down to the ramp speed at 400 % (multiplied on,
// it took 40 mm/s); it can change partway down a move, speed following along the ramp both ways, and
// the bit still ends on the exact step; moves not marked rehearse (a real cut's) never notice it.
//   node tools/shopbot/test-air-rate.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Planner, TICK_HZ, END } = require('../../web/kiri/swarf-shopbot-card.js');
const unit = { x: 72.183661, y: 72.183661, z: 90.229567 };
const planner = () => new Planner({ unit, rampSpeed: 10.16, rampRate: 5.08, maxFeed: 254 });
const start = { x: 0, y: 0, z: 0 };

// the stream decoded: each tick's speed (mm/s, X or Y moves) and where the steps end
function ticks(bytes) {
  let reload = -1, dirs = 0;
  const pos = { x: 0, y: 0, z: 0 }, v = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === END) break;
    if (b >= 0x40 && b < 0x60) { dirs = bytes[i + 1]; reload = bytes[i + 4] << 8 | bytes[i + 5]; i += 5; continue; }
    if (b >= 0x60 && b < 0x70) { reload = 0xF000 | ((b & 0xF) << 8) | bytes[i + 1]; i++; continue; }
    if (b >= 0x70 && b < 0x74) { i += 2; continue; }
    const bits = b >> 1;
    if (bits & 1) pos.x += dirs & 1 ? 1 : -1;
    if (bits & 2) pos.y += dirs & 2 ? 1 : -1;
    if (bits & 4) pos.z += dirs & 4 ? 1 : -1;
    v.push({ v: TICK_HZ / (0x10000 - reload) / unit.x, x: pos.x / unit.x, y: pos.y / unit.y });
  }
  return { v, pos };
}
const mv = (x, y, z, feed, extra = {}) => ({ x, y, z, feed, line: 1, ...extra });
const air = { rehearse: true, vmax: 76.2 };
const square = o => [mv(200, 0, 0, 20, o), mv(200, 200, 0, 20, o), mv(0, 200, 0, 20, o)];
const stepsAt = (x, y) => ({ x: Math.round(x * unit.x), y: Math.round(y * unit.y), z: 0 });

// marked or not, 100 % is the same stream; unmarked moves ignore the rate
const plain = [...planner().items(square({}), start)];
const pl1 = planner();
assert.deepEqual([...pl1.items(square(air), start)], plain, 'rehearse at 100 % is the same stream');
const pl4u = planner(); pl4u.rate = 4;
assert.deepEqual([...pl4u.items(square({}), start)], plain, 'a real cut never notices the rate');

// 400 %: held at the machine's speed, and the corner still slows to the ramp speed
const p4 = planner(); p4.rate = 4;
const t4 = ticks([...p4.items(square(air), start)]);
const top = Math.max(...t4.v.map(t => t.v));
assert.ok(Math.abs(top - 76.2) < 1.5, `400 % of 20 mm/s is held at the machine's 76.2 (${top.toFixed(1)})`);
assert.ok(p4.limited, 'and it says so');
const corner = t4.v.filter(t => Math.hypot(t.x - 200, t.y) < 0.5);
assert.ok(corner.length && Math.max(...corner.map(t => t.v)) < 13, `a square corner at 400 % is near the ramp speed (${Math.max(...corner.map(t => t.v)).toFixed(1)} mm/s)`);
assert.deepEqual(t4.pos, stepsAt(0, 200), 'and it ends on the exact step');
assert.ok(t4.v.length === ticks(plain).v.length, 'the same steps as at 100 %');

// slower: 50 %
const p5 = planner(); p5.rate = 0.5;
assert.ok(Math.abs(Math.max(...ticks([...p5.items(square(air), start)]).v.map(t => t.v)) - 10.16) < 0.5, '50 % of 20 mm/s runs at 10');

// changed partway: up, then down, in the middle of moves
const pl = planner(), bytes = [];
let n = 0;
for (const b of pl.items(square(air), start)) {
  bytes.push(b);
  n++;
  if (n === 6000) pl.rate = 4;
  if (n === 22000) pl.rate = 1;
}
const live = ticks(bytes);
assert.deepEqual(live.pos, stepsAt(0, 200), 'a rate changed partway still ends on the exact step');
const peak = Math.max(...live.v.map(t => t.v));
assert.ok(peak > 60, `it sped up (${peak.toFixed(1)} mm/s)`);
// tick to tick the speed follows the ramp: 3 mm/s per mm, plus the 0.5 % the stream rounds to
let worst = 0;
for (let i = 1; i < live.v.length; i++) {
  const a = live.v[i - 1], b = live.v[i], mm = Math.hypot(b.x - a.x, b.y - a.y);
  worst = Math.max(worst, Math.abs(b.v - a.v) - (15.24 / 5.08) * mm - a.v * 0.006);
}
assert.ok(worst < 0.05, `no jump in speed when the rate changes (worst ${worst.toFixed(3)} mm/s past the ramp)`);
assert.ok(Math.abs(live.v[live.v.length - 1].v - 10.16) < 1, 'and it ends at the ramp speed');
console.log(`air rate: ok (top ${top.toFixed(1)} mm/s, corner ${Math.max(...corner.map(t => t.v)).toFixed(1)}, live peak ${peak.toFixed(1)})`);
