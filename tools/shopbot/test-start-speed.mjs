// Moves from rest start, and moves to rest end, at the start speed (2.54 mm/s on the shop machine),
// not at the ramp speed: a jump straight to 10.16 mm/s knocked the gantry, which then rang
// (measured 11-17: X ringing after a stop about halved). Corners keep the ramp speed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { Planner, TICK_HZ } = createRequire(import.meta.url)('../../web/kiri/swarf-shopbot-card.js');
const unit = { x: 72.183661, y: 72.183661, z: 90.229567 };
function speeds(p, moves, stopAtMm) {
  const out = []; let r = null, need = 0, kind = null, buf = [], x = 0, y = 0;
  for (const b of p.items(moves, { x: 0, y: 0, z: 0 })) {
    if (need) { buf.push(b); if (--need === 0) { if (kind === 0x40) r = buf[3] << 8 | buf[4]; else r = 0xF000 | (kind & 0x0F) << 8 | buf[0]; } continue; }
    if (b === 0x78) break;
    if (b === 0x40) { kind = b; need = 5; buf = []; continue; }
    if ((b & 0xF0) === 0x60) { kind = b; need = 1; buf = []; continue; }
    if (b < 0x40 && (b & 3)) {
      if (b & 2) x++; if (b & 4) y++;
      const mm = Math.max(x, y) / unit.x;
      out.push({ mm, x: x / unit.x, y: y / unit.y, v: TICK_HZ / (0x10000 - r) / unit.x });
      if (stopAtMm != null && mm >= stopAtMm && !p.halt) p.stop();
    }
  }
  return out;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// a jog from rest: starts and ends near 2.54, full speed mid-move, same distance
{
  const p = new Planner({ unit, rampSpeed: 10.16, startSpeed: 2.54, rampRate: 5.08 });
  const sp = speeds(p, [{ x: 250, y: 0, z: 0, feed: 100, line: 1 }]);
  assert.ok(near(sp[0].v, 2.54, 0.2), `starts at the start speed (${sp[0].v.toFixed(2)})`);
  assert.ok(near(sp[sp.length - 1].v, 2.54, 0.4), `ends at the start speed (${sp[sp.length - 1].v.toFixed(2)})`);
  assert.ok(near(sp.find(s => s.mm >= 125).v, 100, 0.5), 'full speed mid-move');
  assert.ok(near(sp[sp.length - 1].mm, 250, 0.02), 'ends where it should');
}
// without a start speed: today's behaviour (starts at the ramp speed)
{
  const p = new Planner({ unit, rampSpeed: 10.16, rampRate: 5.08 });
  const sp = speeds(p, [{ x: 100, y: 0, z: 0, feed: 100, line: 1 }]);
  assert.ok(near(sp[0].v, 10.16, 0.3), `no start speed: starts at the ramp speed (${sp[0].v.toFixed(2)})`);
}
// a right-angle corner mid-run keeps the ramp speed, not the start speed
{
  const p = new Planner({ unit, rampSpeed: 10.16, startSpeed: 2.54, rampRate: 5.08 });
  const sp = speeds(p, [{ x: 100, y: 0, z: 0, feed: 100, line: 1 }, { x: 100, y: 100, z: 0, feed: 100, line: 2 }]);
  const around = sp.filter(s => s.x > 99 && s.y < 1);
  const slowest = Math.min(...around.map(s => s.v));
  assert.ok(slowest >= 9.5, `the corner slows to the ramp speed, not lower (${slowest.toFixed(2)})`);
}
// a stop still comes down quickly, now to the start speed
{
  const p = new Planner({ unit, rampSpeed: 10.16, startSpeed: 2.54, rampRate: 5.08 });
  const sp = speeds(p, [{ x: 2000, y: 0, z: 0, feed: 100, line: 1 }], 1000);
  const coast = sp[sp.length - 1].mm - 1000;
  assert.ok(coast < 12, `a stop ramps down within about 10 mm (${coast.toFixed(1)})`);
  assert.ok(sp[sp.length - 1].v <= 2.8, `and ends at the start speed (${sp[sp.length - 1].v.toFixed(2)})`);
}
// the extra time per jog stays small: about a second for a 250 mm jog
{
  const t = s => { let tt = 0; for (let i = 1; i < s.length; i++) tt += (s[i].mm - s[i - 1].mm) / s[i].v; return tt; };
  const a = t(speeds(new Planner({ unit, rampSpeed: 10.16, rampRate: 5.08 }), [{ x: 250, y: 0, z: 0, feed: 100, line: 1 }]));
  const b = t(speeds(new Planner({ unit, rampSpeed: 10.16, startSpeed: 2.54, rampRate: 5.08 }), [{ x: 250, y: 0, z: 0, feed: 100, line: 1 }]));
  console.log('250 mm jog:', a.toFixed(2), 's before,', b.toFixed(2), 's with the start speed');
  assert.ok(b - a < 1.2, `costs under 1.2 s (${(b - a).toFixed(2)})`);
}
console.log('start speed: ok');
