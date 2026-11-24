// The Z plate on a browser new to the shop's ShopBot: the shop's plate is input 5, reading 0 on
// contact and 1 at rest. Input 1 reading 1 matches the box at rest, so touch off with it refuses
// ("the plate already reads contact") before any motion; a saved input 1 / 1 takes the shop's plate.
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict'; import { createRequire } from 'node:module';
import { FakeCP210x, fakeUSB } from './fake-cp210x.mjs';
const StubCard = createRequire(import.meta.url)('./stub-card.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function machine(saved) {
  const card = StubCard();
  // the shop's box at rest: inputs 1-4 read 1 (P6 0x0F, 10-27), input 5 (the plate) 1, the e-stop (8) 0
  card.state.inputs = [0x1F, 0x0F];
  const dev = new FakeCP210x(card), store = { ...saved };
  const win = { navigator: { usb: fakeUSB(dev) }, setTimeout, clearTimeout, setInterval, clearInterval, console, performance,
    requestAnimationFrame: f => setTimeout(() => f(performance.now()), 16),
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
  win.window = win; vm.createContext(win);
  for (const f of ['swarf-run-parse.js', 'swarf-run-plan.js', 'swarf-run-machine.js', 'swarf-shopbot-usb.js', 'swarf-shopbot-card.js', 'swarf-shopbot-direct.js'])
    vm.runInContext(fs.readFileSync(new URL(`../../web/kiri/${f}`, import.meta.url), 'utf8'), win, { filename: f });
  return { m: new win.SwarfRunMachine.DirectMachine({ spinUp: 0.02 }), card, store };
}
// a new browser: the shop's plate, known
{
  const { m } = machine({});
  assert.deepEqual([m.plateCfg.input, m.plateCfg.hit, m.plateCfg.confirmed], [5, 0, true], 'a new browser knows the shop plate: input 5, contact 0');
}
// the old guess saved by an earlier build: replaced
{
  const { m } = machine({ 'swarf-shopbot-plate': JSON.stringify({ input: 1, hit: 1, confirmed: true, thickness: 3.0734, travel: 60 }) });
  assert.deepEqual([m.plateCfg.input, m.plateCfg.hit, m.plateCfg.confirmed], [5, 0, true], 'saved input 1 / 1 takes the shop plate');
}
// a plate set by the touch (Phil's Mac): kept, its search distance too
{
  const { m } = machine({ 'swarf-shopbot-plate': JSON.stringify({ input: 5, hit: 0, confirmed: true, thickness: 3.0734, travel: 150 }) });
  assert.deepEqual([m.plateCfg.input, m.plateCfg.hit, m.plateCfg.travel], [5, 0, 150], 'a touched plate is kept');
}
// touch off on the box as it really reads: the bit comes down and zeroes on contact
{
  const { m, card } = machine({});
  assert.ok(await m.connect(false));
  const z0 = card.state.pos[2];
  card.state.switches = [{ port: 0, bit: 4, axis: 2, at: z0 - 300, hit: 0 }];
  const ok = await m.zZero();
  assert.equal(ok, true, `touch off zeroes Z on a new browser (${m.state.note})`);
  assert.ok(card.state.pos[2] !== z0, 'the bit moved');
  assert.match(m.state.note, /Z zeroed on the plate/);
  await m.disconnect?.();
}
// the old default against the same box: refused before any motion (what students saw)
{
  const { m, card } = machine({});
  Object.assign(m.plateCfg, { input: 1, hit: 1 });
  assert.ok(await m.connect(false));
  const z0 = card.state.pos[2];
  assert.equal(await m.zZero(), false);
  assert.equal(card.state.pos[2], z0, 'no motion');
  assert.match(m.state.note, /already reads contact/);
  await m.disconnect?.();
}
console.log('plate default: ok');
process.exit(0);
