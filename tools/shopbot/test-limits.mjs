// Travel limits on the ShopBot: held to the table's travel in machine mm from the homed corner,
// whatever zero the student sets afterwards; nothing clamps before homing on this link; a
// reconnect forgets the home. The moves themselves are captured, not played (a held jog is metres).
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict'; import { createRequire } from 'node:module';
import { FakeCP210x, fakeUSB } from './fake-cp210x.mjs';
const StubCard = createRequire(import.meta.url)('./stub-card.cjs');
const U = 72.183661;

const card = StubCard(); const dev = new FakeCP210x(card);
const store = { 'swarf-shopbot-checked': '1',
  'swarf-shopbot-home': JSON.stringify({ x: { input: 2, hit: 0 }, y: { input: 3, hit: 0 }, set: { x: true, y: true }, confirmed: true }) };
const win = { navigator: { usb: fakeUSB(dev) }, setTimeout, clearTimeout, setInterval, clearInterval, console, performance,
  requestAnimationFrame: f => setTimeout(() => f(performance.now()), 16), localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
win.window = win; vm.createContext(win);
for (const f of ['swarf-run-parse.js', 'swarf-run-plan.js', 'swarf-run-machine.js', 'swarf-shopbot-usb.js', 'swarf-shopbot-card.js', 'swarf-shopbot-direct.js'])
  vm.runInContext(fs.readFileSync(new URL(`../../web/kiri/${f}`, import.meta.url), 'utf8'), win, { filename: f });
const { LIMITS } = win.SwarfRunMachine;
const m = new win.SwarfRunMachine.DirectMachine({ spinUp: 0.02 });
assert.ok(await m.connect(false));

// every move's targets, in work mm, instead of sending them
let sent = null;
const realMove = m.move.bind(m);
m.move = targets => { sent = targets.map(t => ({ ...t })); };
const last = () => sent[sent.length - 1];
const mach = (a, w) => (w * U + m.origin[a] - m.homeOrigin[a]) / U;   // work mm -> machine mm from the homed corner
const near = (a, b, why) => assert.ok(Math.abs(a - b) < 0.01, `${why}: ${a.toFixed(2)} vs ${b.toFixed(2)}`);

// before homing: sensors set, but nothing clamps and the hint stays
assert.equal(m.limitsKnown(), false, 'sensors set but not homed: limits unknown');
m.jogHold('x', 1); near(last().x, m.state.pos.x + 5000, 'held +X before homing runs on');
m.jogHold('y', -1); near(last().y, m.state.pos.y - 5000, 'held -Y before homing runs on');
m.jog('x', 4000); near(last().x, m.state.pos.x + 4000, 'a jog before homing is not clamped');
m.goTo({ x: 9000, y: -9000 }); near(last().x, 9000, 'a go-to before homing is not clamped'); near(last().y, -9000, 'go-to Y');

// home on the stub's sensors
m.move = realMove;
card.state.switches = [{ port: 0, bit: 1, axis: 0, at: card.state.pos[0] - 500, hit: 0 }, { port: 0, bit: 2, axis: 1, at: card.state.pos[1] - 400, hit: 0 }];
await m.home();
assert.match(m.state.note, /^homed/, m.state.note);
assert.ok(m.homeOrigin && m.limitsKnown(), 'homed: limits known');
m.move = targets => { sent = targets.map(t => ({ ...t })); };

// out to machine X 600, Y 400, and zero there
card.state.pos[0] = Math.round(m.homeOrigin.x + 600 * U); card.state.pos[1] = Math.round(m.homeOrigin.y + 400 * U);
m.read(await m.card.status());
assert.ok(m.zero('xy'));
near(m.state.pos.x, 0, 'work X 0 after the zero'); near(mach('x', 0), 600, 'machine X 600'); near(mach('y', 0), 400, 'machine Y 400');

const result = {};
m.jogHold('x', 1); result['+X'] = mach('x', last().x); near(result['+X'], LIMITS.x[1], 'held +X stops at the machine end');
m.jogHold('x', -1); result['-X'] = mach('x', last().x); near(result['-X'], LIMITS.x[0], 'held -X stops at the machine start');
m.jogHold('y', 1); result['+Y'] = mach('y', last().y); near(result['+Y'], LIMITS.y[1], 'held +Y stops at the machine end');
m.jogHold('y', -1); result['-Y'] = mach('y', last().y); near(result['-Y'], LIMITS.y[0], 'held -Y stops at the machine start');
m.jog('x', 5000); near(mach('x', last().x), LIMITS.x[1], 'a +X jog stops at the end');
m.jog('y', -5000); near(mach('y', last().y), LIMITS.y[0], 'a -Y jog stops at the start');
m.goTo({ x: 3000, y: 2000 }); result['go-to'] = [mach('x', last().x), mach('y', last().y)];
near(result['go-to'][0], LIMITS.x[1], 'go-to past the X end'); near(result['go-to'][1], LIMITS.y[1], 'go-to past the Y end');
m.goTo({ x: -900, y: -900 }); near(mach('x', last().x), LIMITS.x[0], 'go-to past the X start'); near(mach('y', last().y), LIMITS.y[0], 'go-to past the Y start');
m.goTo({ x: 100, y: 50 }); near(last().x, 100, 'a go-to inside the travel is left alone'); near(last().y, 50, 'go-to Y inside');
m.jog('x', 10); near(last().x, 10, 'a short jog is left alone');
console.log('zeroed at machine X 600 Y 400; held/go-to ends in machine mm:', JSON.stringify(result, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v));

// a reconnect forgets the home: the box may have restarted and counts from zero again
m.move = realMove;
assert.ok(await m.disconnect(), m.state.note);
assert.equal(m.limitsKnown(), false, 'disconnected: limits unknown');
assert.ok(await m.connect(false));
assert.equal(m.homeOrigin, null, 'reconnected: no home');
assert.equal(m.limitsKnown(), false, 'reconnected: limits unknown until homed again');
m.move = targets => { sent = targets.map(t => ({ ...t })); };
m.jogHold('x', 1); near(last().x, m.state.pos.x + 5000, 'held +X after a reconnect runs on (not clamped)');

// a dropped link forgets it too
m.homeOrigin = { x: 0, y: 0 }; assert.ok(m.limitsKnown());
m.lost(); assert.equal(m.limitsKnown(), false, 'a lost link forgets the home');

// the simulator holds its work positions to the same machine travel through its work offset
const sim = new win.SwarfRunMachine.SimMachine();
sim.state.pos = { x: 600, y: 400, z: 25.4 };
sim.zero('xy');
const sp = []; sim.moveTo = p => sp.push({ ...p });
sim.jogHold('x', 1); near(sp.at(-1).x + 600, LIMITS.x[1], 'sim held +X stops at the machine end');
sim.jogHold('y', -1); near(sp.at(-1).y + 400, LIMITS.y[0], 'sim held -Y stops at the machine start');
sim.jog('x', -5000); near(sp.at(-1).x + 600, LIMITS.x[0], 'sim jog -X stops at the machine start');
sim.goTo({ x: 5000, y: 5000 }); near(sp.at(-1).x + 600, LIMITS.x[1], 'sim go-to X'); near(sp.at(-1).y + 400, LIMITS.y[1], 'sim go-to Y');

console.log('limits: ok');
process.exit(0);
