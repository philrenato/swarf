// A stop on a curve made of short segments must come down within the slow-down
// distance (review 10-27: the slow-down restarted at every segment and ran on).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../../web/kiri/swarf-shopbot-card.js');
const unit = { x: 72.183661, y: 72.183661, z: 90.229567 };
for (const segLen of [0.5, 1, 2, 5]) {
  const p = new C.Planner({ unit, rampSpeed: 10.16, rampRate: 5.08 });
  const ops = [], r = 200;
  for (let a = 0; a < 2 * Math.PI; a += segLen / r) ops.push({ x: r * Math.cos(a) - r, y: r * Math.sin(a), z: 0, feed: 50, line: ops.length + 1 });
  const it = p.items(ops, { x: 0, y: 0, z: 0 })[Symbol.iterator]();
  let ticks = 0, after = 0, data = 0, stopped = false;
  for (let r2 = it.next(); !r2.done; r2 = it.next()) {
    const b = r2.value;
    if (data) { data--; continue; }
    if (b === C.END) break;
    data = C.itemData(b);
    if (!(b & 0x40)) { ticks++; if (stopped) after++; }
    if (ticks === 20000 && !stopped) { p.stop(); stopped = true; }
  }
  const mm = after / unit.x;             // about one step per tick on this path
  console.log(`segments ${segLen} mm: ran ${mm.toFixed(1)} mm after stop`);
  assert.ok(mm < 15, `stop on ${segLen} mm segments ran ${mm.toFixed(1)} mm`);
}
// stop pressed between items() and the first read is kept
{
  const p = new C.Planner({ unit, rampSpeed: 10.16, rampRate: 5.08 });
  const it = p.items([{ x: 500, y: 0, z: 0, feed: 50, line: 1 }], { x: 0, y: 0, z: 0 });
  p.stop();
  let ticks = 0, data = 0;
  for (const b of it) { if (data) { data--; continue; } if (b === C.END) break; data = C.itemData(b); if (!(b & 0x40)) ticks++; }
  console.log(`stop before the first read: ${(ticks / unit.x).toFixed(1)} mm`);
  assert.ok(ticks / unit.x < 15);
}
console.log('stop curve: ok');
