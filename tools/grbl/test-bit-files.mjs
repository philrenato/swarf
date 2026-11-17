// A two-bit MR-1 job in control: cam's per-bit files joined (SwarfRunParse.joinBitFiles) hold at the bit
// change with the spindle off and the bit up; the continue runs the second bit at its own speed. Also:
// a file with two speeds sends both, a cut with no feed is refused, and a damaged status report is
// ignored. Node only: real cam_export, the stub GRBL board.   node tools/grbl/test-bit-files.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { runFiles, MR1, tool, level } from '../cam/harness.mjs';
const require = createRequire(import.meta.url);
globalThis.SwarfRunParse = require('../../web/kiri/swarf-run-parse.js');
globalThis.SwarfRunPlan = require('../../web/kiri/swarf-run-plan.js');
const { GrblMachine } = require('../../web/kiri/swarf-grbl.js');
const StubGrbl = require('./stub-grbl.cjs');
const P = globalThis.SwarfRunParse, R = globalThis.SwarfRunPlan;

class FakePort {
  constructor(stub) { this.stub = stub; }
  async open() { this.stub.onData = b => this.onData && this.onData(b); this.stub.onClose = e => this.onClose && this.onClose(e); this.stub.open(); }
  async write(b) { this.stub.write(b); return b.length; }
  async close() { this.stub.close(); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000, what = 'condition') { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return; await sleep(5); } throw new Error(`timed out waiting for ${what}`); }
async function rest(m) { await until(() => !m.busy() && !m.state.moving, 8000, 'rest'); await m.waitStatus(s => s.state === 'Idle', 3000); }
const stubs = [], machines = [];
async function ready() {
  const stub = StubGrbl({ timeFactor: 60, phys: { x: 300, y: -250, z: -60 } });
  const m = new GrblMachine({ transport: new FakePort(stub), bannerMs: 1500, resetMs: 1500 });
  stubs.push(stub); machines.push(m);
  assert.ok(await m.connect(true), m.state.note);
  assert.ok(await m.home(), m.state.note);
  assert.ok(await m.goTo({ x: 200, y: -200, z: -60 })); await rest(m);
  assert.ok(await m.zero('xyz')); await rest(m); await m.fresh();
  return { m, stub };
}
const said = (stub, from) => stub.state.received.slice(from).map(l => l.trim()).filter(Boolean);

// ---- the joined two-bit job: a bit change control can hold at
const T1 = tool(1, 1, '1/4 flat'), T2 = tool(2, 2, '1/8 flat');
const proc = { camFastFeed: 6000, camFastFeedZ: 300, camFirstZMax: true, camOriginTop: true, camToolInit: true };
const job = runFiles(MR1, proc, { x: 100, y: 100, z: 19.05 }, { x: -50, y: 50, z: 19.06 }, [
  level([[0, 0, 25, 0, 0], [10, 10, 25, 0, 0], [10, 10, 15, 1, 300], [40, 10, 15, 1, 1000]], T1, 6000, 0),
  level([[40, 10, 25, 0, 0], [30, 30, 25, 0, 0], [30, 30, 10, 1, 300], [60, 30, 10, 1, 800]], T2, 7500, 1),
]);
assert.equal(job.files && job.files.length, 2, 'cam makes one file per bit');
const text = P.joinBitFiles(job.files);
const parsed = P.parse(text, { machineUnits: 'mm' });
assert.deepEqual(parsed.unsupported, [], 'every line of the joined job is understood');
const changes = parsed.events.filter(e => e.kind === 'tool-change');
assert.equal(changes.length, 1, 'one bit change');
assert.deepEqual(parsed.events.filter(e => e.kind === 'tool-name').map(e => e.value), ['1/4 flat', '1/8 flat'], 'each bit named');
{
  const { m, stub } = await ready();
  const plan = m.plan({ name: 'two bits', moves: parsed.moves, sbp: text, source: parsed, spindle: true, kind: 'cut' });
  assert.deepEqual([...plan.problems], []);
  assert.equal(plan.hold && plan.hold.hold, 'tool-change', 'the cut holds at the bit change');
  const from = stub.state.received.length;
  assert.ok(m.run(R.arm(plan)), m.state.note);
  await until(() => !m.state.running, 30000, 'the first bit');
  assert.equal(m.state.toolChange, true, m.state.note);
  assert.equal(stub.state.spindle.on, false, 'spindle off at the change');
  const first = said(stub, from);
  assert.ok(first.includes('M3S6000'), `the first bit at its speed: ${first.filter(l => /^M3|^S\d/.test(l))}`);
  assert.ok(!first.some(l => /S7500/.test(l)), 'nothing of the second bit ran');
  const lastCut = Math.max(...parsed.moves.filter(mv => mv.line < changes[0].line).map(mv => mv.line));
  assert.ok(m.state.resumeLine > lastCut, 'continue picks up after the change');
  await m.fresh();
  assert.ok(m.state.pos.z >= 25, `the bit is up for the change (Z ${m.state.pos.z.toFixed(1)})`);
  console.log('two bits: held at line', changes[0].line, '|', m.state.note);

  // the new bit: zero Z, then continue from the line after the change
  assert.ok(await m.goTo({ z: -1 })); await rest(m);       // the new bit, a little longer, down on the board
  await m.zero('z'); await rest(m); await m.fresh();
  const fr = P.fromLineProgram(parsed, m.state.resumeLine, 25.4, 'two bits');
  const p2 = m.plan({ ...fr, kind: 'from', preview: false });
  assert.deepEqual([...p2.problems], [], 'the continue plans clean');
  assert.equal(p2.live, true, 'a continue is a cut');
  const at = stub.state.received.length;
  assert.ok(m.run(R.arm(p2)), m.state.note);
  await until(() => !m.state.running, 30000, 'the second bit');
  assert.equal(m.state.done, true, m.state.note);
  const second = said(stub, at);
  const on = second.findIndex(l => /^M3/.test(l)), cut = second.findIndex(l => /^G1.*Z-/.test(l));
  assert.ok(on >= 0 && second[on] === 'M3S7500', `the second bit at its own speed (${second[on]})`);
  assert.ok(cut > on, 'the router is on before the second bit cuts');
  console.log('two bits: second bit', second[on], 'then', second[cut]);
}

// ---- two speeds on one bit: both reach the board
{
  const { m, stub } = await ready();
  const t = ['G21 G90', 'M3 S5000', 'G0 Z5', 'G0 X0 Y0', 'G1 Z-1 F300', 'G1 X20 F600', 'S8000', 'G1 Y20', 'M3 S7000', 'G1 X0', 'G0 Z5', 'M5', 'M30'].join('\n');
  const pp = P.parse(t, { machineUnits: 'mm' });
  const plan = m.plan({ name: 's', moves: pp.moves, sbp: t, source: pp, spindle: true, kind: 'cut' });
  assert.deepEqual([...plan.problems], []);
  const lines = m.linesOf(plan).map(l => l.text);
  assert.ok(lines.includes('M3S5000') && lines.includes('S8000') && lines.includes('S7000'), `every speed sent: ${lines.filter(l => /S\d/.test(l))}`);
  const tf = t.replace('S8000', 'S9000'), fast = P.parse(tf, { machineUnits: 'mm' });
  const pf = m.plan({ name: 'f', moves: fast.moves, sbp: tf, source: fast, spindle: true, kind: 'cut' });
  assert.ok(pf.problems.some(x => /9000/.test(x)), `a later speed over the top is refused: ${pf.problems}`);
  console.log('two speeds:', lines.filter(l => /S\d/.test(l)).join(' '));

  // a damaged report never turns the travel check off
  stub.fault.garble();
  await m.fresh(); await m.fresh();
  assert.ok(Number.isFinite(m.wco.x) && Number.isFinite(m.state.pos.x), 'the damaged report was ignored');
  const far = P.parse('G21 G90\nM3 S6000\nG0 Z5\nG1 Z-1 F300\nG1 X900 F600\nM5\n', { machineUnits: 'mm' });
  const pfar = m.plan({ name: 'far', moves: far.moves, source: far, spindle: true, kind: 'cut' });
  assert.ok(pfar.problems.some(x => /travel/.test(x)), 'past the travel still refused');
  console.log('garbled report ignored:', m.badReports || 0);
}

// ---- the reader: what it refuses and why
{
  const why = t => { const p = P.parse(t, { machineUnits: 'mm' }); return p.unsupported.map(u => u.why || u.text); };
  assert.ok(why('G21 G90\nG0 Z5\nG1 Z-2\nG1 X60\n').some(w => /no feed/.test(w)), 'a cut with no F');
  assert.ok(why('G21 G90\nG0 Z5\nG1 Z-2 F0\n').some(w => /zero or less/.test(w)), 'F0');
  assert.ok(why('G21 G90\nG1 Z-2 F-300\n').some(w => /zero or less/.test(w)), 'F-300');
  assert.ok(why('G21 G90\nG1 X10 Y0 F600\nG2 X0 Y5 I-10 J0\n').some(w => /off its own circle/.test(w)), 'an arc ending off its circle');
  assert.ok(why('G21 G90\nG1 X10 Y0 F600\nG2 X10 Y0 I10000000 J0\n').some(w => /bigger than any table/.test(w)), 'a huge arc');
  assert.ok(why('G21 G90\nG1 X10 Y0 F600\nG2 I-5 J0\n').some(w => /no end point/.test(w)), 'an arc with no end');
  assert.ok(why(`G21 G90\nG1 X1${'0'.repeat(320)} F600\n`).length > 0, 'a number too big');
  assert.ok(why("'UNITS:MM\n&a = 1e400\nJ3,&a,0,5\n").length > 0, 'a variable too big');
  assert.deepEqual(why('G21 G90\nG 1 X1 F100\nX 2\nN 10 G1 X3\nN20\n'), [], 'spacing GRBL accepts');
  assert.deepEqual(why('%\nG21 G90\n(Phil\'s sign)\nG0 Z5\nG1 Z-1 F300 M3 S12000\nG1 X10 (bit\'s edge) Y20\nM30\n%\n'), [], '% lines and apostrophes in comments');
  const z2 = P.parse("'UNITS:MM\nSA\nJ3,10,10,5\nZ2\nM3,20,10,-1\n", { machineUnits: 'mm' });
  assert.ok(z2.unsupported.some(u => /zeroes the machine/.test(u.why || '')), 'SBP Z2 refused with its reason');
  const same = P.parse('G21 G90\nG0 Z5\nG0 X0 Y0\nG1 Z-1 F300 M3 S12000\nG1 X10\nM5\nM30\n', { machineUnits: 'mm' });
  assert.equal(P.routerOffCut(same), null, 'M3 on the plunge line counts');
  const pl = R.build({ name: 'p', moves: same.moves, source: same, spindle: false, cut: true }, { pos: { x: 0, y: 0, z: 30 }, live: true, cfg: { safeZ: 25.4, rapid: { xy: 40, z: 15 }, move: { xy: 40, z: 15 }, jog: { z: 15 }, spinUp: 1 } });
  assert.deepEqual([...pl.problems], [], 'and the plan turns the router on before that plunge');
  console.log('reader: refusals and spacing ok');
}

for (const m of machines) await m.letGo();
for (const s of stubs) s.halt();
console.log('bit files: ok');
process.exit(0);
