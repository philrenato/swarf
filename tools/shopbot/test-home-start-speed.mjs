// Homing with the start speed on (2.54 mm/s): the seeks keep the plain ramps, since the contact is
// placed by counting the card's ticks, so home lands where it does with the ramp speed alone.
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict'; import { createRequire } from 'node:module';
import { FakeCP210x, fakeUSB } from './fake-cp210x.mjs';
const StubCard = createRequire(import.meta.url)('./stub-card.cjs');
const U = 72.183661;
async function homeWith(startSpeed) {
  const card = StubCard(); const dev = new FakeCP210x(card); const store = { 'swarf-shopbot-checked': '1' };
  const win = { navigator: { usb: fakeUSB(dev) }, setTimeout, clearTimeout, setInterval, clearInterval, console, performance,
    requestAnimationFrame: f => setTimeout(() => f(performance.now()), 16), localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
  win.window = win; vm.createContext(win);
  for (const f of ['swarf-run-parse.js', 'swarf-run-plan.js', 'swarf-run-machine.js', 'swarf-shopbot-usb.js', 'swarf-shopbot-card.js', 'swarf-shopbot-direct.js'])
    vm.runInContext(fs.readFileSync(new URL(`../../web/kiri/${f}`, import.meta.url), 'utf8'), win, { filename: f });
  const m = new win.SwarfRunMachine.DirectMachine({ spinUp: 0.02, startSpeed });
  assert.ok(await m.connect(false));
  card.state.switches = [{ port: 0, bit: 1, axis: 0, at: card.state.pos[0] - 500, hit: 0 }, { port: 0, bit: 2, axis: 1, at: card.state.pos[1] - 400, hit: 0 }];
  const want = [card.state.pos[0] - 500 + 12.7 * U, card.state.pos[1] - 400 + 12.7 * U];
  m.homeCfg = Object.assign(m.homeCfg || {}, { confirmed: true });
  await m.home();
  assert.match(m.state.note, /^homed/);
  const got = card.state.pos.slice(0, 2);
  await m.stack([Object.assign(m.machine({ ...m.state.pos, x: m.state.pos.x + 5 }), { feed: 20, line: 0 })]);
  return { got, want, startAfter: m.planner.m.startSpeed };
}
for (const ss of [undefined, 2.54]) {
  const r = await homeWith(ss);
  console.log('start speed', ss ?? 'off', 'homed at', r.got, 'expected about', r.want.map(Math.round));
  assert.ok(Math.abs(r.got[0] - r.want[0]) <= 20 && Math.abs(r.got[1] - r.want[1]) <= 20, `homes on the corner (start speed ${ss ?? 'off'})`);
  if (ss) assert.equal(r.startAfter, ss, 'jogs after homing start slow again');
}
console.log('home with the start speed: ok');
process.exit(0);
