// Inch files (Phil 10-29: VCarve's ShopBot post writes inches): the reader turns every length,
// speed and arc into millimeters, the plan checks pass, and the card runs the same moves as the
// file's millimeter twin. A file VCarve zeroed on the table is still refused, by its own words.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { FakeCP210x, fakeUSB } from './fake-cp210x.mjs';
const StubCard = createRequire(import.meta.url)('./stub-card.cjs');

function page() {
  const card = StubCard();
  const dev = new FakeCP210x(card);
  const store = {};
  const win = { navigator: { platform: 'MacIntel', usb: fakeUSB(dev) }, setTimeout, clearTimeout, setInterval, clearInterval, console, performance,
    requestAnimationFrame: f => setTimeout(() => f(performance.now()), 16),
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
  win.window = win;
  vm.createContext(win);
  for (const f of ['swarf-run-parse.js', 'swarf-run-plan.js', 'swarf-run-machine.js', 'swarf-shopbot-usb.js', 'swarf-shopbot-card.js', 'swarf-shopbot-direct.js'])
    vm.runInContext(fs.readFileSync(new URL(`../../web/kiri/${f}`, import.meta.url), 'utf8'), win, { filename: f });
  return { win, card };
}
const done = m => new Promise(r => { const t = setInterval(() => { if (!m.state.running) { clearInterval(t); r(); } }, 20); });

// the shape of VCarve's ShopBot inch output: header comments, the unit check, CN 90, the PW
// variables, a tool, the router, MS/JS, jogs, cuts and a CG arc, the unit-error tail
const vcarve = (u, zo = 'Material Surface') => {
  const k = u === 'in' ? 1 : 25.4, f = v => (v * k).toFixed(6);
  return [
    `'SHOPBOT ROUTER FILE IN ${u === 'in' ? 'INCHES' : 'MM'}`,
    `'A VCARVE-STYLE FILE WRITTEN BY HAND FOR SWARF'S TESTS`,
    `'UNITS:${u === 'in' ? 'INCHES' : 'MM'}`,
    `'`,
    `IF %(25)=${u === 'in' ? 1 : 0} THEN GOTO UNIT_ERROR\t'check to see software is set to standard`,
    `SA                             \t'Set program to absolute coordinate mode`,
    `CN, 90`,
    `'New Path`,
    `'Toolpath Name = Profile 1`,
    `'Tool Name   = End Mill (0.25 inch)`,
    `&PWSafeZ = ${f(0.2)}`,
    `&PWZorigin = ${zo}`,
    `&PWMaterial = ${f(0.75)}`,
    `&Tool = 1                               \t'Jog Z axis to safe height`,
    `C9`,
    `TR,18000`,
    `C6`,
    `PAUSE 2`,
    `MS,${f(1.0)},${f(0.5)}`,
    `JS,${f(2.0)},${f(1.0)}`,
    `JZ,&PWSafeZ`,
    `J2,${f(0)},${f(0)}`,
    `J3,${f(1)},${f(1)},${f(0.2)}`,
    `M3,${f(1)},${f(1)},${f(-0.125)}`,
    `M3,${f(3)},${f(1)},${f(-0.125)}`,
    `CG,,${f(3)},${f(3)},${f(0)},${f(1)},T,-1`,
    `M3,${f(1)},${f(3)},${f(-0.125)}`,
    `M3,${f(1)},${f(1)},${f(-0.125)}`,
    `JZ,${f(0.2)}`,
    `J2,${f(0)},${f(0)}`,
    `'Turning router OFF`,
    `C7`,
    `END`,
    `'`,
    `UNIT_ERROR:`,
    `CN, 91                            'Run file explaining unit error`,
    `END`
  ].join('\r\n');
};

const { win } = page();
const P = win.SwarfRunParse, R = win.SwarfRunPlan;
const pin = P.parse(vcarve('in')), pmm = P.parse(vcarve('mm'));
assert.equal(pin.units, 'in');
assert.equal(pmm.units, 'mm');
assert.equal(JSON.stringify(pin.unsupported), '[]');
assert.equal(JSON.stringify(R.validate(pin)), '[]', 'an inch file from VCarve passes the plan checks');
assert.equal(pin.moves.length, pmm.moves.length, 'same moves');
for (let i = 0; i < pin.moves.length; i++) {
  const a = pin.moves[i], b = pmm.moves[i];
  for (const k of ['x0', 'y0', 'z0', 'x', 'y', 'z', 'feed']) assert.ok(Math.abs(a[k] - b[k]) < 1e-6, `move ${i} ${k}: ${a[k]} vs ${b[k]}`);
}
const cut = pin.moves.find(m => !m.rapid && m.z0 === m.z);
assert.ok(Math.abs(cut.feed - 25.4) < 1e-9, `MS 1.0 in/s reads 25.4 mm/s (${cut.feed})`);
const b = pin.bounds;
assert.ok(Math.abs(b.max.x - 4 * 25.4) < 1e-6 && Math.abs(b.min.z + 0.125 * 25.4) < 1e-6, 'bounds in mm');
// the arc: 3,1 → 3,3 about 3,2, counterclockwise (out to X 4 in), every point 1 in (25.4 mm) from its center
const arc = pin.moves.filter(m => m.line === pin.moves.find(x => x.x === 3 * 25.4 && x.y > 25.4 + 1).line);
assert.ok(arc.length >= 4 && arc.every(m => Math.abs(Math.hypot(m.x - 76.2, m.y - 50.8) - 25.4) < 1e-6), 'the CG arc is 1 in around its center');
console.log(`inch file: ${pin.moves.length} moves, ${(b.max.x - b.min.x).toFixed(1)} × ${(b.max.y - b.min.y).toFixed(1)} mm, ${(-b.min.z).toFixed(3)} mm deep`);

// VCarve's own words for a table zero refuse it, even with cuts below Z 0
const pt = P.parse(vcarve('in', 'Table Surface'));
assert.ok(R.validate(pt).some(v => v.k === 'table-zero'), 'Table Surface is refused');

// the card runs the inch file to the same place as its mm twin
async function run(sbp) {
  const { win, card } = page();
  const m = new win.SwarfRunMachine.DirectMachine({ spinUp: 0.02 });
  assert.ok(await m.connect(false));
  m.zero('xyz');
  const parsed = win.SwarfRunParse.parse(sbp);
  const plan = m.plan({ name: 'v', moves: parsed.moves, sbp, spindle: true });
  assert.equal(JSON.stringify(plan.problems), '[]', 'the plan has no problems');
  m.run(win.SwarfRunPlan.arm(plan));
  await done(m);
  assert.equal(m.state.note, 'program finished');
  return { pos: m.state.pos, steps: { ...m.steps },  outs: card.state.outs };
}
const ri = await run(vcarve('in')), rm = await run(vcarve('mm'));
assert.equal(JSON.stringify(ri.steps), JSON.stringify(rm.steps), 'the card ends on the same step count');
assert.equal(ri.outs & 1, 0, 'router off at the end');
console.log('inch files: ok');
process.exit(0);
