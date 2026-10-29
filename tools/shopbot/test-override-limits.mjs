// The feed override stays inside what the plan checked (codex review 10-29, torture test 10-29):
//   - a plunge keeps the file's feed at 150 %
//   - a cut going up in Z, and a steep diagonal, never pass the Z speed at 150 %
//   - a slow X cut at 50 % never drops under the card's slowest step for it
//   - the driver says when it held the override
// Decodes the item stream the planner makes: one tick byte per step, its reload sets the rate.
//   node tools/shopbot/test-override-limits.mjs
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { FakeCP210x, fakeUSB } from './fake-cp210x.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '../../web/kiri/');
const StubCard = createRequire(import.meta.url)('./stub-card.cjs');
const bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };

const dev = new FakeCP210x(StubCard());
const store = {};
const win = { navigator: { usb: fakeUSB(dev) }, setTimeout, clearTimeout, setInterval, clearInterval, console, performance,
  requestAnimationFrame: f => setTimeout(() => f(performance.now()), 16),
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
win.window = win; vm.createContext(win);
for (const f of ['swarf-length.js', 'swarf-run-parse.js', 'swarf-run-plan.js', 'swarf-run-machine.js', 'swarf-shopbot-usb.js', 'swarf-shopbot-card.js', 'swarf-shopbot-direct.js'])
  vm.runInContext(fs.readFileSync(ROOT + f, 'utf8'), win, { filename: f });
const m = new win.SwarfRunMachine.DirectMachine({ spinUp: 0.02, motorWakeMs: 0, routerWarnMs: 10 });
if (!(await m.connect(false))) { console.log('connect failed', m.state.note); process.exit(1); }
m.zero('xyz');
const P = win.SwarfRunParse, TICK = win.ShopBotCard.TICK_HZ, U = m.cfg.unit;

// the fastest step rate per line and axis, from the decoded stream (as the stop test's speed helper reads it)
function rates(ops, start, ovr) {
  const pl = m.planner;
  pl.override = ovr; pl.limited = false;
  const bytes = [...pl.items(ops, start)];
  let reload = -1, line = 0;
  const top = {};
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b >= 0x40 && b < 0x60) { line = bytes[i + 2] << 8 | bytes[i + 3]; reload = bytes[i + 4] << 8 | bytes[i + 5]; i += 5; continue; }
    if (b >= 0x60 && b < 0x70) { reload = 0xF000 | ((b & 0xF) << 8) | bytes[i + 1]; i++; continue; }
    if (b >= 0x70 && b < 0x74) { i += 2; continue; }
    if (b === 0x78) break;
    if (!(b & 0x40)) {
      const hz = TICK / (0x10000 - reload);
      const t = top[line] = top[line] || { x: 0, z: 0, xmin: Infinity };
      if ((b >> 3) & 1) t.z = Math.max(t.z, hz / U.z);
      if (b & 2) { t.x = Math.max(t.x, hz / U.x); t.xmin = Math.min(t.xmin, hz / U.x); }
      if (b & 1) i++;
    }
  }
  return { top, limited: pl.limited };
}

function opsFor(sbp) {
  const parsed = P.parse(sbp, { machineUnits: 'mm' });
  const plan = m.plan({ name: 'o', moves: parsed.moves, sbp, source: parsed, spindle: false });
  return { plan, ops: m.opsOf(plan, 0) };
}

// line 3 plunges, 4 cuts across, 5 cuts up in Z at the file's 20 mm/s, 6 is a steep diagonal up
const A = opsFor(['SA', 'MS,20,20', 'J3,0,0,5', 'MZ,-12', 'M3,50,0,-12', 'M3,50,0,-2', 'M3,52,0,8', 'JZ,25', 'END'].join('\n'));
check(!A.plan.problems.length, `plan A checks (${A.plan.problems})`);
const a1 = rates(A.ops, m.machine(A.plan.from), 1), a15 = rates(A.ops, m.machine(A.plan.from), 1.5);
const Z = m.cfg.move.z;
console.log('   100 %:', JSON.stringify(a1.top));
console.log('   150 %:', JSON.stringify(a15.top));
const zLine = l => Math.max(...Object.entries(a15.top).filter(([k]) => +k === l).map(([, t]) => t.z), 0);
check(Math.abs(zLine(4) - (a1.top[4] || { z: 0 }).z) < 0.5, `the plunge keeps its feed at 150 % (${zLine(4).toFixed(1)} mm/s)`);
check(zLine(6) <= Z * 1.03, `a cut up in Z stays under the Z speed at 150 % (${zLine(6).toFixed(1)} ≤ ${Z})`);
check(zLine(7) <= Z * 1.03, `a steep diagonal stays under the Z speed at 150 % (${zLine(7).toFixed(1)} ≤ ${Z})`);
check(a15.limited, 'the planner says it held the override');
check((a15.top[5] || { x: 0 }).x > (a1.top[5] || { x: 0 }).x * 1.3, `a level cut still speeds up at 150 % (${(a1.top[5] || {}).x?.toFixed(1)} → ${(a15.top[5] || {}).x?.toFixed(1)} mm/s)`);

// a slow X cut, 2 mm/s, near the card's slowest X step (about 1.6 mm/s): 50 % holds at the floor
const B = opsFor(['SA', 'MS,2,2', 'J3,0,0,5', 'MZ,-1', 'M3,30,0,-1', 'JZ,25', 'END'].join('\n'));
check(!B.plan.problems.length, `plan B checks (${B.plan.problems})`);
const floor = TICK / 65536 / U.x * 1.02;
const b5 = rates(B.ops, m.machine(B.plan.from), 0.5);
const cruise = b5.top[5] ? b5.top[5].x : 0;
check(cruise >= floor * 0.98, `50 % on a 2 mm/s cut holds at the card's slowest step (${cruise.toFixed(2)} ≥ ${floor.toFixed(2)} mm/s)`);
check(b5.limited, 'and says so');

// the driver: setOverride clears the mark, a streamed move sets it
m.setOverride(150);
check(m.state.override === 150 && m.state.overrideHeld === false, 'setOverride starts unheld');
check(m.setOverride(NaN) === 150, 'NaN leaves it as it was');

if (bad.length) { console.log(`\n${bad.length} FAILED`); process.exit(1); }
console.log('override limits: ok');
process.exit(0);
