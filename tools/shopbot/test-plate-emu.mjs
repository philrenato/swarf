// Z zero on the plate, V204 firmware in the emulator: the plate on input 1
// (P6.0) reads 1 at or below Z -300 steps. Both plunges must place the
// contact within a few steps, Z there = plate thickness, bit lifted after.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { FakeCP210x, fakeUSB } from './fake-cp210x.mjs';
import { emuLink } from './emu-link.mjs';

const link = emuLink({ args: ['--switch', 'P6,0,2,-300,1'] });
const dev = new FakeCP210x(link);
const store = {};
const win = { navigator: { usb: fakeUSB(dev) }, setTimeout, clearTimeout, setInterval, clearInterval, console, performance,
  requestAnimationFrame: f => setTimeout(() => f(performance.now()), 16),
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
win.window = win;
vm.createContext(win);
for (const f of ['swarf-run-machine.js', 'swarf-shopbot-usb.js', 'swarf-shopbot-card.js', 'swarf-shopbot-direct.js'])
  vm.runInContext(fs.readFileSync(new URL(`../../web/kiri/${f}`, import.meta.url), 'utf8'), win, { filename: f });
const m = new win.SwarfRunMachine.DirectMachine({ timeoutMs: 600000 });
Object.assign(m.plateCfg, { lift: 4, travel: 10 });
assert.ok(await m.connect(false));
assert.equal(await m.zZero(), false);
assert.match(m.state.note, /set the Z plate/);
m.setPlate(1, 1);
assert.ok(JSON.parse(store['swarf-shopbot-plate']).confirmed);
m.zero('xyz');
const t0 = Date.now();
assert.equal(await m.zZero(), true, m.state.note);
const u = m.cfg.unit.z, exp = Math.round(-300 - m.plateCfg.thickness * u);
console.log(m.state.note, '| origin z', m.origin.z, 'expected', exp, '| pos z', m.state.pos.z, '| card z', m.steps.z, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
assert.match(m.state.note, /Z zeroed on the plate/);
assert.ok(Math.abs(m.origin.z - exp) <= 8, 'contact within 8 steps (0.09 mm)');
assert.ok(Math.abs(m.state.pos.z - 4) < 0.02, 'lifted to the lift height');
assert.equal(m.card.size, 149, 'block size restored');
assert.equal(JSON.parse(store['swarf-shopbot-origin']).z, m.origin.z, 'origin saved');
// plate touching: refuse, nothing moves
m.goTo({ z: -m.plateCfg.thickness - 1 });
await new Promise(r => { const t = setInterval(() => { if (!m.state.moving) { clearInterval(t); r(); } }, 50); });
const at = m.steps.z;
assert.equal(await m.zZero(), false);
assert.match(m.state.note, /already reads contact/);
assert.equal(m.steps.z, at);
await link.close();
console.log('plate emu: ok');
process.exit(0);
