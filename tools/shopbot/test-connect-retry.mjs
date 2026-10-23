// The first connect finds the box off; it is switched on and connect is
// pressed again. One reader on the link afterwards, and the card answers.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { FakeCP210x, fakeUSB } from './fake-cp210x.mjs';
const StubCard = createRequire(import.meta.url)('./stub-card.cjs');

const card = StubCard();
const dev = new FakeCP210x(card, { powered: false });
const store = {};
const win = { navigator: { usb: fakeUSB(dev) }, setTimeout, clearTimeout, setInterval, clearInterval, console, performance,
  requestAnimationFrame: f => setTimeout(() => f(performance.now()), 16),
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
win.window = win;
vm.createContext(win);
for (const f of ['swarf-run-parse.js', 'swarf-run-machine.js', 'swarf-shopbot-usb.js', 'swarf-shopbot-card.js', 'swarf-shopbot-direct.js'])
  vm.runInContext(fs.readFileSync(new URL(`../../web/kiri/${f}`, import.meta.url), 'utf8'), win, { filename: f });
const D = win.SwarfRunMachine.DirectMachine;

const off = new D({ timeoutMs: 300 });
assert.equal(await off.connect(true), false);
console.log('box off:', off.state.note);
assert.match(off.state.note, /not powered/);
assert.equal(dev.opened, false, 'a failed connect closes the link');

dev.powered = true;
const on = new D({ timeoutMs: 300 });
assert.ok(await on.connect(true), 'second connect answers');
await new Promise(r => setTimeout(r, 50));
assert.equal(dev.waiters.length, 1, 'one reader on the link');
on.jog('x', 1);
await new Promise(r => { const t = setInterval(() => { if (!on.state.moving) { clearInterval(t); r(); } }, 20); });
console.log('after retry, jog x+1:', on.state.pos, on.state.note);
assert.ok(Math.abs(on.state.pos.x - 1) < 0.01);
console.log('connect retry: ok');
process.exit(0);
