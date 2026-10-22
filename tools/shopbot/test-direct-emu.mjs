// Run mode's DirectMachine end to end against the V204 firmware in the
// emulator: the page's own scripts in a bare window, navigator.usb = a fake
// CP210x whose UART is the emulated card.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { FakeCP210x, fakeUSB } from './fake-cp210x.mjs';
import { emuLink } from './emu-link.mjs';

const link = emuLink();
const dev = new FakeCP210x(link);
const store = {};
const win = {
  navigator: { usb: fakeUSB(dev) }, setTimeout, clearTimeout, setInterval, clearInterval, console, performance,
  requestAnimationFrame: f => setTimeout(() => f(performance.now()), 16),
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } }
};
win.window = win;
vm.createContext(win);
for (const f of ['swarf-run-machine.js', 'swarf-shopbot-usb.js', 'swarf-shopbot-card.js', 'swarf-shopbot-direct.js'])
  vm.runInContext(fs.readFileSync(new URL(`../../web/kiri/${f}`, import.meta.url), 'utf8'), win, { filename: f });

const D = win.SwarfRunMachine.DirectMachine;
const m = new D({ timeoutMs: 600000, spinUp: 0.05 });
const ok = await m.connect(false);
assert.ok(ok, m.state.note);
assert.equal(dev.uart.baud, 921600);
console.log('connected:', m.state.note, m.state.pos);
const idle = () => new Promise(r => { const t = setInterval(() => { if (!m.busy() && !m.state.moving) { clearInterval(t); r(); } }, 50); });
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;

m.jog('x', 1); await idle();
console.log('after jog x+1:', m.state.pos); assert.ok(near(m.state.pos.x, 1));
m.zero('xyz'); assert.ok(near(m.state.pos.x, 0));
m.goTo({ x: 0.5, y: 0.5 }); await idle();
console.log('after goTo .5,.5:', m.state.pos); assert.ok(near(m.state.pos.x, 0.5) && near(m.state.pos.y, 0.5));

const moves = [
  { x0: 0.5, y0: 0.5, z0: 0, x: 0.5, y: 0.5, z: -0.5, feed: 10, line: 5 },
  { x0: 0.5, y0: 0.5, z0: -0.5, x: 2.5, y: 0.5, z: -0.5, feed: 40, line: 6 },
  { x0: 2.5, y0: 0.5, z0: -0.5, x: 2.5, y: 0.5, z: 1, rapid: true, line: 7 }];
const t0 = Date.now();
let sawSpindle = false;
const un = m.on(s => { if (s.spindle) sawSpindle = true; });
m.run({ name: 't', moves, spindle: true, preview: false });
await new Promise(r => { const t = setInterval(() => { if (!m.state.running) { clearInterval(t); r(); } }, 100); });
un();
console.log('program:', m.state.note, m.state.pos, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
assert.equal(m.state.note, 'program finished');
assert.ok(near(m.state.pos.x, 2.5) && near(m.state.pos.z, 1));
assert.ok(sawSpindle);
const rep = await link.close();
const p7 = rep.ports.filter(([, p]) => p === 'P7').map(([, , v]) => v);
console.log('P7 writes (outputs):', p7.map(v => v.toString(16)));
assert.ok(p7.includes(1) && p7[p7.length - 1] === 0, 'spindle output went on and back off');
console.log('direct emu: ok');
process.exit(0);
