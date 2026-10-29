// The ramps as ShopBot 3 runs them on the shop's machine (10-29, measured from recordings: its
// jog reaches 38 mm/s in about 0.4 s): 3 mm/s gained per mm with Ramp Rate 5.08. A stop still
// ramps down quickly.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { Planner, TICK_HZ } = createRequire(import.meta.url)('../../web/kiri/swarf-shopbot-card.js');
const unit = { x: 72.183661, y: 72.183661, z: 90.229567 };
// the speed (mm/s) at each X step of the item stream
function speeds(p, moves) {
  const out = []; let r = null, need = 0, kind = null, buf = [], x = 0;
  for (const b of p.items(moves, { x: 0, y: 0, z: 0 })) {
    if (need) { buf.push(b); if (--need === 0) { if (kind === 0x40) r = buf[3] << 8 | buf[4]; else r = 0xF000 | (kind & 0x0F) << 8 | buf[0]; } continue; }
    if (b === 0x78) break;
    if (b === 0x40) { kind = b; need = 5; buf = []; continue; }
    if ((b & 0xF0) === 0x60) { kind = b; need = 1; buf = []; continue; }
    if (b < 0x40 && (b >> 1) & 1) { x++; out.push({ mm: x / unit.x, v: TICK_HZ / (0x10000 - r) / unit.x }); }
  }
  return out;
}
const p = new Planner({ unit, rampSpeed: 10.16, rampRate: 5.08 });
const sp = speeds(p, [{ x: 300, y: 0, z: 0, feed: 100, line: 1 }]);
const at = mm => sp.find(s => s.mm >= mm).v;
console.log('speed at 10 mm', at(10).toFixed(1), 'at 100 mm', at(100).toFixed(1), 'at 150 mm', at(150).toFixed(1), 'mm/s');
const K = 15.24 / 5.08;
assert.ok(Math.abs(at(5) - (10.16 + K * 5)) < 1, `5 mm in: about 25 mm/s (${at(5).toFixed(2)})`);
assert.ok(Math.abs(at(20) - (10.16 + K * 20)) < 1.5, `20 mm in: about 70 mm/s (${at(20).toFixed(2)})`);
assert.ok(Math.abs(at(150) - 100) < 0.5, 'full speed by 30 mm, held mid-move');
// to ShopBot 3's 38 mm/s jog in about 0.4 s, as measured
const p2 = new Planner({ unit, rampSpeed: 10.16, rampRate: 5.08 });
let tt = 0; for (const s of speeds(p2, [{ x: 100, y: 0, z: 0, feed: 38.5, line: 1 }])) { if (s.v >= 38) break; tt += 1 / (s.v * unit.x); }
console.log('time to 38 mm/s', tt.toFixed(2), 's');
assert.ok(tt > 0.3 && tt < 0.6, `about 0.4 s to 38 mm/s (${tt.toFixed(2)})`);
// a stop at full speed: down within about 10 mm
const q = new Planner({ unit, rampSpeed: 10.16, rampRate: 5.08 });
let n = 0, stopAt = null; const it = q.items([{ x: 2000, y: 0, z: 0, feed: 100, line: 1 }], { x: 0, y: 0, z: 0 });
for (const b of it) { if (b < 0x40 && (b >> 1) & 1) { n++; if (n === Math.round(1000 * unit.x)) { q.stop(); stopAt = n; } } if (b === 0x78) break; }
const coast = (n - stopAt) / unit.x;
console.log('stop from', (2 / 5.08 * 990 + 10.16 > 100 ? 100 : 0), 'mm/s: coasts', coast.toFixed(1), 'mm');
assert.ok(coast < 12, `a stop ramps down within about 10 mm (${coast.toFixed(1)})`);
// the ramp's speed steps stay small (0.5%)
let worst = 0;
for (let i = 1; i < sp.length; i++) if (sp[i].v !== sp[i - 1].v) worst = Math.max(worst, Math.abs(sp[i].v / sp[i - 1].v - 1));
console.log('largest speed step', (worst * 100).toFixed(3), '%');
assert.ok(worst < 0.01, `speed steps under 1% (a steep start changes more than 0.5% a tick at low speed) (${(worst * 100).toFixed(3)}%)`);
// the feed override (10-29): a cut at 20 mm/s runs at 21 mm/s at 105 %, travel does not change
const po = new Planner({ unit, rampSpeed: 10.16, rampRate: 5.08, maxFeed: 254 });
po.override = 1.05;
const cutv = speeds(po, [{ x: 200, y: 0, z: 0, feed: 20, line: 1, cut: true }]);
const cmid = cutv.find(s => s.mm >= 100).v;
po.override = 1.05;
const rapv = speeds(new Planner({ unit, rampSpeed: 10.16, rampRate: 5.08 }), [{ x: 200, y: 0, z: 0, feed: 20, line: 1 }]);
console.log('override 105%: cut mid-move', cmid.toFixed(2), 'mm/s');
assert.ok(Math.abs(cmid - 21) < 0.2, `105 % of 20 mm/s (${cmid.toFixed(2)})`);
assert.ok(Math.abs(rapv.find(s => s.mm >= 100).v - 20) < 0.2, 'no override, no change');
const pt = new Planner({ unit, rampSpeed: 10.16, rampRate: 5.08, maxFeed: 254 }); pt.override = 1.5;
const top = speeds(pt, [{ x: 600, y: 0, z: 0, feed: 240, line: 1, cut: true }]);
assert.ok(Math.max(...top.map(s => s.v)) <= 254.5, 'never past the machine top speed');
console.log('ramp: ok');
