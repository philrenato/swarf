// Jogs, go-tos and the moves into a job never hold X steady in its rough band (16-30 mm/s on the
// shop machine, docs/shopbot-motion.md). A slanted go-to at 2500 mm/min put X at about 30 mm/s; now
// it runs a little faster, or slower when faster would pass the rapid speed. Cuts, air cuts and
// moves with Z in them keep their own speed.
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict'; import { createRequire } from 'node:module';
import { FakeCP210x, fakeUSB } from './fake-cp210x.mjs';
const StubCard = createRequire(import.meta.url)('./stub-card.cjs');
const card = StubCard();
const dev = new FakeCP210x(card); const store = {};
const win = { navigator: { usb: fakeUSB(dev) }, setTimeout, clearTimeout, setInterval, clearInterval, console, performance,
  requestAnimationFrame: f => setTimeout(() => f(performance.now()), 16),
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
win.window = win; vm.createContext(win);
for (const f of ['swarf-run-parse.js', 'swarf-run-plan.js', 'swarf-run-machine.js', 'swarf-shopbot-usb.js', 'swarf-shopbot-card.js', 'swarf-shopbot-direct.js'])
  vm.runInContext(fs.readFileSync(new URL(`../../web/kiri/${f}`, import.meta.url), 'utf8'), win, { filename: f });
const m = new win.SwarfRunMachine.DirectMachine({ spinUp: 0.02 });
const LO = 16, HI = 30, TOP = m.cfg.rapid.xy;
const inBand = v => v > LO + 1e-9 && v < HI - 1e-9;
// the speed row, mm/min (mm and inch rows), and the rapid
const IN = 25.4;
const rows = [250, 500, 700, 2500, 5000, ...[10, 20, 28, 100, 200].map(v => v * IN), TOP * 60];
for (const r of rows) assert.ok(!inBand(r / 60), `a straight X jog at ${r} mm/min is outside the band`);
let raised = 0, lowered = 0;
for (const r of rows) for (let deg = 0; deg <= 90; deg += 0.25) {
  const v = r / 60, t = deg * Math.PI / 180;
  const a = { x: 0, y: 0, z: 5 }, b = { x: 500 * Math.cos(t), y: 500 * Math.sin(t), z: 5 };
  const s = m.smooth(a, b, v), fx = Math.abs(Math.cos(t));
  assert.ok(!inBand(s * fx), `${r} mm/min at ${deg}°: X at ${(s * fx).toFixed(2)} mm/s`);
  assert.ok(s <= Math.max(v, TOP) + 1e-9, `${r} mm/min at ${deg}°: no faster than the rapid (${s})`);
  if (!inBand(v * fx)) assert.equal(s, v, `${r} mm/min at ${deg}°: a speed outside the band is kept`);
  else { const other = (s > v ? LO : HI) / fx; assert.ok(other > Math.max(v, TOP) + 1e-9 || Math.abs(s - v) <= Math.abs(other - v) + 1e-9, `${r} mm/min at ${deg}°: the nearer edge (${s.toFixed(1)} from ${v.toFixed(1)})`); if (s > v) raised++; else lowered++; }
}
assert.ok(raised > 0 && lowered > 0, `both ways used (${raised} faster, ${lowered} slower)`);
// Z in the move: kept
assert.equal(m.smooth({ x: 0, y: 0, z: 0 }, { x: 100, y: 100, z: 10 }, 2500 / 60), 2500 / 60, 'a move with Z keeps its speed');

assert.ok(await m.connect(false));
const sent = [];
const real = m.stack.bind(m);
m.stack = (ops, ...rest) => { sent.push(ops.filter(o => o.feed !== undefined).map(o => o.feed)); return real(ops, ...rest); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const idle = async () => { await sleep(30); while (m.busy()) await sleep(20); };
// a go-to over a slant at the default 2500 mm/min (X share 0.707: 29.5 mm/s before)
m.cfg.jog = { xy: 2500 / 60, z: 1000 / 60 };
m.setWork && m.setWork('x', 0); m.setWork && m.setWork('y', 0);
m.goTo({ x: 300, y: 300 }); await idle();
const f = sent.at(-1)[0];
assert.ok(!inBand(f * Math.SQRT1_2), `go to x y on a 45° slant: X at ${(f * Math.SQRT1_2).toFixed(2)} mm/s`);
// a job: the way in and its rapids are smoothed, its cuts are not
const P = win.SwarfRunParse, prog = P.parse(["'UNITS:MM", 'C9', 'TR,12000', 'C6', 'MS,20,10', 'J3,260,100,5', 'M3,260,100,-1', 'M3,310,0,-1', 'J3,250,400,5', 'J3,250,40,5', 'C7', 'END'].join('\n'), { machineUnits: 'mm' });
const plan = m.plan({ ...prog, name: 't', sbp: '' });
const ops = m.opsOf(plan, 0).filter(o => o.x !== undefined);
let at = m.machine(m.state.pos);
for (const o of ops) {
  const L = Math.hypot(o.x - at.x, o.y - at.y, o.z - at.z), fx = L ? Math.abs(o.x - at.x) / L : 0;
  if (!o.cut && Math.abs(o.z - at.z) < 1e-6 && L) assert.ok(!inBand(o.feed * fx), `a rapid or entry move: X at ${(o.feed * fx).toFixed(2)} mm/s`);
  if (o.cut) assert.equal(o.feed, 20, 'a cut keeps the file\'s feed');
  at = o;
}
// the lead-in goes over at the jog row's speed: 2500 mm/min floor, the rapid ceiling
const lead = ops[1];
assert.ok(lead && !lead.cut && Math.abs(lead.z - 25.4) < 1e-6, 'the second op is the lead-in over');
assert.ok(lead.feed <= 2500 / 60 * 1.06 && lead.feed >= 16, `lead-in at ${(lead.feed * 60).toFixed(0)} mm/min, not the 6000 rapid`);
m.cfg.jog = { xy: 250 / 60, z: 250 / 60 };
assert.ok(Math.abs(m.leadXY() - 2500 / 60) < 1e-9, 'a 250 mm/min jog row still leads in at 2500');
m.cfg.jog = { xy: 5000 / 60, z: 1000 / 60 };
assert.ok(Math.abs(m.leadXY() - 5000 / 60) < 1e-9, 'a 5000 row leads in at 5000');
m.cfg.jog = { xy: 9000 / 60, z: 1000 / 60 };
assert.ok(Math.abs(m.leadXY() - m.cfg.rapid.xy) < 1e-9, 'never past the rapid');
const mid = m.opsOf(m.plan({ ...prog, name: 't', sbp: '' }), 0).filter(o => o.x !== undefined);
assert.ok(mid.some(o => !o.cut && o.feed > 99), 'the program\'s own rapids keep the rapid speed');
await m.disconnect?.();
console.log(`rough band: ok (${raised} slants run faster, ${lowered} slower; go-to ${(f * 60).toFixed(0)} mm/min)`);
process.exit(0);
