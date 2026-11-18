// A zero (or a typed position) pressed while the machine still moves sets nothing and says so:
// zero() and setWork() return false, the origin is unchanged, and the note says why. At rest they
// set and return true. The page marks an axis zeroed only on true.
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict'; import { createRequire } from 'node:module';
import { FakeCP210x, fakeUSB } from './fake-cp210x.mjs';
const StubCard = createRequire(import.meta.url)('./stub-card.cjs');
const card = StubCard(); card.state.realtime = true;
const dev = new FakeCP210x(card); const store = {};
const win = { navigator: { usb: fakeUSB(dev) }, setTimeout, clearTimeout, setInterval, clearInterval, console, performance,
  requestAnimationFrame: f => setTimeout(() => f(performance.now()), 16),
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
win.window = win; vm.createContext(win);
for (const f of ['swarf-run-parse.js', 'swarf-run-plan.js', 'swarf-run-machine.js', 'swarf-shopbot-usb.js', 'swarf-shopbot-card.js', 'swarf-shopbot-direct.js'])
  vm.runInContext(fs.readFileSync(new URL(`../../web/kiri/${f}`, import.meta.url), 'utf8'), win, { filename: f });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const m = new win.SwarfRunMachine.DirectMachine({ spinUp: 0.02 });
assert.ok(await m.connect(false));
m.cfg.jog.xy = 2500 / 60;
m.jog('x', 10);
await sleep(150);
assert.ok(m.busy(), 'the jog is still running');
const before = JSON.stringify(m.origin);
assert.equal(m.zero('xy'), false, 'zero while moving returns false');
assert.equal(m.setWork('x', 0), false, 'a typed position while moving returns false');
assert.equal(JSON.stringify(m.origin), before, 'the origin is unchanged');
assert.match(m.state.note, /still moving/);
while (m.busy()) await sleep(20);
assert.equal(m.zero('xy'), true, 'at rest zero returns true');
assert.ok(Math.abs(m.state.pos.x) < 1e-9, 'and X reads 0');
assert.equal(m.setWork('y', 5), true, 'at rest a typed position returns true');
// the practice machine says the same
const sim = new win.SwarfRunMachine.SimMachine();
sim.busy = () => true;
assert.equal(sim.zero('z'), false, 'the simulator refuses a zero while moving too');
sim.busy = () => false;
assert.equal(sim.zero('z'), true);
console.log('zero while moving: refused and said; at rest: set');
process.exit(0);
