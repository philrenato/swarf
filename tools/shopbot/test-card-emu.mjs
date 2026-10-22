// The card protocol + planner against the real V204 firmware in the emulator:
// a square with ramps, positions read back from the card, step pulses counted.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { emuLink } from './emu-link.mjs';
const { ShopBotCard, Planner } = createRequire(import.meta.url)('../../web/kiri/swarf-shopbot-card.js');

const unit = { x: 72.183661, y: 72.183661, z: 90.229567 };      // the shop machine's [VU]
const link = emuLink();
const card = new ShopBotCard(link, { size: 149, timeoutMs: 600000 });
let st = await card.status();
assert.equal(st.raw.length, 50);
console.log('status ok; flag', st.flag.toString(16), 'steps', st.steps);
await card.setBlocks(3);
await card.motors(true);

const plan = new Planner({ unit });
const moves = [
  { x: 2, y: 0, z: 0, feed: 50, line: 1 },
  { x: 2, y: 2, z: 0, feed: 50, line: 2 },
  { x: 0, y: 2, z: -1, feed: 30, line: 3 },
  { x: 0, y: 0, z: 0, feed: 50, line: 4 }];
let acks = 0;
const t0 = Date.now();
let end = await card.run(plan.items(moves.slice(0, 2), { x: 0, y: 0, z: 0 }), { onAck: () => acks++ });
console.log('stack 1:', acks, 'blocks, end line', end.line, 'steps', end.steps, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
assert.deepEqual([end.steps.x, end.steps.y, end.steps.z], [144, 144, 0]);
assert.equal(end.line, 2);
end = await card.run(plan.items(moves.slice(2), { x: 2, y: 2, z: 0 }));
console.log('stack 2: end line', end.line, 'steps', end.steps);
assert.deepEqual([end.steps.x, end.steps.y, end.steps.z], [0, 0, 0]);
st = await card.status();
assert.deepEqual([st.steps.x, st.steps.y, st.steps.z], [0, 0, 0]);
const rep = await link.close();
// pulse count per axis from the emulator's P5 log (rising edges)
const rise = [0, 0, 0]; let prev = 0;
for (const [, port, v] of rep.ports) if (port === 'P5') { for (let a = 0; a < 3; a++) if ((v >> a & 1) && !(prev >> a & 1)) rise[a]++; prev = v; }
console.log('P5 rising edges x y z:', rise, `(log holds last ${rep.ports.length} of ${rep.nports} writes)`);
console.log('card emu: ok');
process.exit(0);
