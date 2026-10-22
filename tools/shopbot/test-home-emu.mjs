// Homing on the V204 firmware in the emulator: X sensor on input 2 (P6.1)
// covered at or below -500 steps, Y on input 3 (P6.2) at -400, both read 0
// when covered (PRS). Home must find each contact within a few steps, make it
// table -12.7 mm, and park at 0, 0.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { FakeCP210x, fakeUSB } from './fake-cp210x.mjs';
import { emuLink } from './emu-link.mjs';

const link = emuLink({ args: ['--switch', 'P6,1,0,-500,0', '--switch', 'P6,2,1,-400,0'] });
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
Object.assign(m.homeCfg, { fast: 30, backOff: 4, travel: { x: 30, y: 30 } });
m.cfg.safeZ = 0.5;
assert.ok(await m.connect(false));
await m.home();
assert.match(m.state.note, /set the home sensors/);
m.setHomeSensor('x', 2, 0);
m.setHomeSensor('y', 3, 0);
m.zero('xyz');
const t0 = Date.now();
await m.home();
const u = m.cfg.unit;
const exp = { x: Math.round(-500 + 12.7 * u.x), y: Math.round(-400 + 12.7 * u.y) };
console.log(m.state.note, '| origin', m.origin, 'expected', exp, '| pos', m.state.pos, '| card steps', m.steps, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
assert.equal(m.state.note, 'homed: X 0, Y 0 is the table corner');
assert.ok(Math.abs(m.origin.x - exp.x) <= 8 && Math.abs(m.origin.y - exp.y) <= 8, 'contact within 8 steps (0.11 mm)');
assert.ok(Math.abs(m.state.pos.x) < 0.02 && Math.abs(m.state.pos.y) < 0.02, 'parked at 0, 0');
assert.ok(m.state.pos.z >= 0.49, 'Z went up to safe height first');
assert.equal(m.card.size, 149, 'block size restored');
await link.close();
console.log('home emu: ok');
process.exit(0);
