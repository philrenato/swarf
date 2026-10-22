// Stop in the middle of a long move: the planner ramps down and ends the
// stack; the card's position matches where the planner says it stopped.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { emuLink } from './emu-link.mjs';
const { ShopBotCard, Planner } = createRequire(import.meta.url)('../../web/kiri/swarf-shopbot-card.js');
const unit = { x: 72.183661, y: 72.183661, z: 90.229567 };
const link = emuLink();
const card = new ShopBotCard(link, { size: 149, timeoutMs: 600000 });
await card.setBlocks(3);
const plan = new Planner({ unit });
let acks = 0;
const end = await card.run(plan.items([{ x: 40, y: 0, z: 0, feed: 76.2, line: 9 }], { x: 0, y: 0, z: 0 }),
  { onAck: () => { if (++acks === 3) plan.stop(); } });
console.log('stopped at', end.steps.x, 'steps of', Math.round(40 * unit.x), '; planner says', plan.at.steps.x, '; blocks', acks);
assert.equal(end.steps.x, plan.at.steps.x);
assert.ok(end.steps.x < 40 * unit.x);
const rep = await link.close();
const t = []; let prev = 0;
for (const [cy, port, v] of rep.ports) if (port === 'P5') { if ((v & 1) && !(prev & 1)) t.push(cy); prev = v; }
const hz = t.slice(1).map((c, i) => Math.round(73.5e6 / (c - t[i])));
console.log('step rate first 5', hz.slice(0, 5), 'peak', Math.max(...hz), 'last 5', hz.slice(-5));
console.log('stop emu: ok');
process.exit(0);
