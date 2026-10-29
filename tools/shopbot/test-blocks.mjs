// No item straddles two blocks (10-29: after a USB drop mid-job the card waited for the rest of a
// half-sent item and answered nothing). The blocks the card is sent must carry exactly the motion
// the planner made: every tick's steps, tick length, directions and outputs, in order.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ShopBotCard, Planner, itemData, END } = require('../../web/kiri/swarf-shopbot-card.js');
const StubCard = require('./stub-card.cjs');
const unit = { x: 72.183661, y: 72.183661, z: 90.229567 };
// the card's state at every tick of a byte stream that starts at an item boundary
function ticks(bytes) {
  const st = { dirs: null, reload: null, outs: null }, out = []; let i = 0;
  while (i < bytes.length) {
    const b = bytes[i], n = itemData(b), it = bytes.slice(i, i + 1 + n);
    if (b === END) break;
    if (b === 0x40) { st.dirs = it[1]; st.reload = it[4] << 8 | it[5]; }
    else if ((b & 0xF0) === 0x60) st.reload = 0xF000 | (b & 0x0F) << 8 | it[1];
    else if (b >= 0x70 && b < 0x74) st.outs = it[1] | it[2] << 8;
    else if (!(b & 0x40)) out.push(`${b}|${st.dirs}|${st.reload}|${st.outs}`);
    i += 1 + n;
  }
  return out;
}
const jobs = {
  'slow then fast X': [{ x: 30, y: 0, z: 0, feed: 5 }, { x: 330, y: 0, z: 0, feed: 100 }],
  'a ramp over many blocks': [{ x: 200, y: 0, z: 0, feed: 60 }],
  'diagonals and Z': [{ x: 40, y: 30, z: -3, feed: 20 }, { x: 0, y: 60, z: -3, feed: 40 }, { x: 0, y: 60, z: 10, feed: 15 }],
  'outputs in the stream': [{ out: 9 }, { x: 50, y: 0, z: 0, feed: 30 }, { out: 0 }, { x: 0, y: 0, z: 0, feed: 30 }],
  'an arc of short moves': Array.from({ length: 90 }, (_, i) => ({ x: 40 * Math.cos(i / 14), y: 40 * Math.sin(i / 14), z: 0, feed: 35 }))
};
for (const [name, moves] of Object.entries(jobs)) {
  const ops = moves.map((m, i) => (m.out !== undefined ? { out: m.out, line: i + 1 } : { ...m, line: i + 1 }));
  const p1 = new Planner({ unit }), ref = [...p1.items(ops, { x: 0, y: 0, z: 0 })];
  const stub = StubCard();
  const sent = [];
  const link = { write: b => { if (b.length === 150) sent.push([...b.slice(0, 149)]); return stub.write(b); }, set onData(f) { stub.onData = f; } };
  const card = new ShopBotCard(link, { size: 149, timeoutMs: 3000 });
  await card.setBlocks(2);   // the block size, as connect sets it
  const p2 = new Planner({ unit });
  await card.run(p2.items(ops, { x: 0, y: 0, z: 0 }));
  // each block, parsed on its own from an item boundary, ends on one
  for (const [k, blk] of sent.entries()) {
    let i = 0; while (i < blk.length) { if (blk[i] === END) break; i += 1 + itemData(blk[i]); }
    assert.ok(i <= blk.length, `${name}: block ${k} ends partway through an item (${i} > ${blk.length})`);
  }
  const got = ticks(sent.flat()), want = ticks(ref);
  assert.equal(got.length, want.length, `${name}: tick count`);
  for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) assert.fail(`${name}: tick ${i} differs: ${got[i]} vs ${want[i]}`);
  console.log(`${name}: ${sent.length} blocks, ${want.length} ticks, no item split, motion identical`);
}
console.log('blocks: ok');
process.exit(0);
