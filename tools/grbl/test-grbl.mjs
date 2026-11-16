// GrblMachine (web/kiri/swarf-grbl.js) against the stub GRBL (stub-grbl.cjs) through a fake port:
// no browser, no serial device. node tools/grbl/test-grbl.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.SwarfRunParse = require('../../web/kiri/swarf-run-parse.js');
globalThis.SwarfRunPlan = require('../../web/kiri/swarf-run-plan.js');
const { GrblMachine, clean, PREAMBLE, END } = require('../../web/kiri/swarf-grbl.js');
const StubGrbl = require('./stub-grbl.cjs');
const P = globalThis.SwarfRunParse, R = globalThis.SwarfRunPlan;

// the port: what the driver writes goes into the stub, what the stub sends comes back
class FakePort {
  constructor(stub) { this.stub = stub; this.onData = null; this.onClose = null; }
  async open() { this.stub.onData = b => this.onData && this.onData(b); this.stub.onClose = e => this.onClose && this.onClose(e); this.stub.open(); }
  async write(b) { this.stub.write(b); return b.length; }
  async close() { this.stub.close(); }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await sleep(5); }
  throw new Error(`timed out waiting for ${what}`);
}
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tol ${tol})`);
// the board at rest and nothing of swarf's in flight
async function rest(m) { await until(() => !m.busy() && !m.state.moving, 8000, 'rest'); await m.waitStatus(s => s.state === 'Idle', 3000); await until(() => !m.busy(), 3000, 'rest'); }

const stubs = [], machines = [];
async function machine(opts = {}) {
  const stub = StubGrbl({ timeFactor: 40, phys: { x: 300, y: -250, z: -60 }, ...opts });
  stubs.push(stub);
  const m = new GrblMachine({ transport: new FakePort(stub), bannerMs: 1500, resetMs: 1500 });
  machines.push(m);
  return { m, stub };
}
// a cut as Run mode makes it: parse the file, plan from where the bit is, arm, run
function job(m, text, kind = 'cut') {
  const parsed = P.parse(text, { machineUnits: 'mm' });
  const prog = kind === 'air' ? P.airProgram(parsed, 5, 't', 25.4) : { name: 't', moves: parsed.moves, sbp: text, source: parsed, spindle: true };
  const plan = m.plan({ ...prog, kind, preview: false });
  return plan;
}
function zigzag(n, step = 0.5, feed = 1200) {
  const l = ['G21', 'G90', 'M3 S6000', 'G0 Z5', 'G0 X0 Y0', 'G1 Z-1 F300'];
  for (let i = 1; i <= n; i++) l.push(`G1 X${(i * step).toFixed(3)} Y${(i % 2 ? step : 0).toFixed(3)}${i === 1 ? ` F${feed}` : ''}`);
  l.push('G0 Z5', 'M5', 'M30');
  return l.join('\n');
}
const tail = (stub, from) => stub.state.received.slice(from).map(l => l.trim()).filter(Boolean);

const log = (...a) => console.log('  ', ...a);

// ------------------------------------------------------------------ the main session
{
  console.log('connect, home, jog, zero, cut');
  const { m, stub } = await machine();
  assert.ok(await m.connect(true), m.state.note);
  assert.equal(m.state.connected, true);
  assert.equal(m.state.locked, true, 'every connect is a restart into the lock');
  assert.equal(m.state.grbl, 'Alarm');
  assert.equal(m.settings[13], 1, '$$ read');
  assert.equal(m.state.refused, '');
  assert.deepEqual(m.travel(), { x: 580, y: 550, z: 150 });
  log('connected:', m.state.note, '| version', m.version);

  // nothing moves before homing
  assert.equal(await m.jog('x', 10), false);
  assert.match(m.state.note, /home the machine first/);
  assert.equal(await m.zero('xy'), false);

  assert.ok(await m.home(), m.state.note);
  assert.equal(m.state.homed, true);
  for (const a of ['x', 'y', 'z']) near(m.state.mpos[a], 0, 1e-9, `homed ${a}`);
  log('homed:', m.state.note);

  // steps, clamped at the travel less 2 mm, never turned around
  assert.ok(await m.jog('x', 10)); await rest(m);
  near(m.state.mpos.x, 10, 0.003, 'jog x +10');
  assert.ok(await m.jog('x', -50)); await rest(m);
  near(m.state.mpos.x, 2, 0.003, 'jog x -50 stops 2 mm from the X- end');
  assert.equal(await m.jog('y', 5), false, 'Y+ from machine 0: past the end, nothing sent');
  assert.match(m.state.note, /end of its travel/);
  near(stub.mpos()[1], 0, 1e-9, 'Y never moved toward its switch');
  assert.ok(await m.jog('x', 1000)); await rest(m);
  near(m.state.mpos.x, 578, 0.003, 'jog x +1000 stops at 578');
  assert.ok(await m.jog('z', -1000)); await rest(m);
  near(m.state.mpos.z, -148, 0.003, 'jog z -1000 stops at -148');
  log('jogs clamped: x', m.state.mpos.x.toFixed(3), 'z', m.state.mpos.z.toFixed(3));

  // hold to move: increments while held, the cancel and G4 P0 on release
  await m.jogRelease();
  const x0 = m.state.mpos.x, sent0 = stub.state.received.length;
  m.jogHold('x', -1);
  await sleep(150);
  await m.jogRelease();
  await rest(m);
  const holdLines = tail(stub, sent0);
  assert.ok(holdLines.filter(l => l.startsWith('$J=')).length >= 2, 'several increments while held');
  assert.equal(holdLines[holdLines.length - 1], 'G4P0', 'release ends with G4 P0');
  assert.ok(m.state.mpos.x < x0 - 1, 'it moved while held');
  assert.equal(stub.state.planner.length + (stub.state.cur ? 1 : 0), 0, 'the cancel emptied the planner');
  log('hold to move:', (x0 - m.state.mpos.x).toFixed(2), 'mm in', holdLines.length - 1, 'increments');

  // zero x y, then zero z
  assert.ok(await m.goTo({ x: 100, y: -100, z: -50 })); await rest(m);
  assert.ok(await m.zero('xy')); await rest(m);
  assert.ok(await m.zero('z')); await rest(m);
  const zeroLines = stub.state.received.filter(l => /G10/.test(l));
  assert.deepEqual(zeroLines.slice(-2), ['G21G10L20P1X0Y0', 'G21G10L20P1Z0']);
  for (const [i, v] of [100, -100, -50].entries()) near(stub.eeprom.coords[54][i], v, 0.003, `G54 ${'xyz'[i]}`);
  for (const a of ['x', 'y', 'z']) near(m.state.pos[a], 0, 0.003, `work ${a} at 0`);
  near(m.offsets.G54.x, 100, 0.003, '$# G54 x read back');
  const kept = { ...m.offsets.G54 };
  assert.equal((await m.zeroHolds(kept)).same, true);
  log('zeroed: G54', JSON.stringify(m.offsets.G54));

  // a program of several hundred short lines, counted under 128 bytes
  await m.fresh();
  let plan = job(m, zigzag(400));
  assert.deepEqual([...plan.problems], [], 'the plan has no problems');
  assert.equal(plan.rpm, 6000);
  const lines = m.linesOf(plan);
  const from = stub.state.received.length, before = stub.state.linesIn;
  assert.ok(m.run(R.arm(plan)), m.state.note);
  await until(() => !m.state.running, 30000, 'the cut to finish');
  assert.equal(m.state.done, true, m.state.note);
  assert.equal(m.state.note, 'program finished');
  const got = tail(stub, from);
  assert.equal(stub.state.linesIn - before, lines.length, 'every line reached the board once');
  assert.deepEqual(got.slice(0, 5), PREAMBLE, 'the preamble first');
  const m3 = got.indexOf('M3S6000');
  assert.ok(m3 > 0 && got[m3 + 1] === 'G4P2', 'the spindle on, then two seconds');
  assert.deepEqual(got.slice(-4), END, 'the end: G4 P0, S0, G4 P1, M5');
  assert.ok(m.maxInflight <= 127, `bytes in flight never past 127 (most: ${m.maxInflight})`);
  assert.equal(stub.state.dropped, 0, 'the board dropped no byte');
  assert.ok(stub.state.rxMax <= 127);
  assert.equal(stub.state.spindle.on, false, 'spindle off at the end');
  log(`cut: ${lines.length} lines, most in flight ${m.maxInflight} bytes, board buffer peak ${stub.state.rxMax}`);

  // the plan refuses a job past the travel
  {
    const far = 'G21\nG90\nM3 S6000\nG0 Z5\nG1 Z-1 F300\nG1 X600 F1200\nM5\n';
    await m.fresh();
    const p = job(m, far);
    assert.ok(p.problems.some(t => /X travel/.test(t)), `envelope: ${p.problems}`);
    assert.equal(m.run(R.arm(p)), false);
    log('envelope:', p.problems[p.problems.length - 1]);
  }

  // pause and resume
  {
    await m.fresh();
    const p = job(m, zigzag(60, 5, 600));
    assert.ok(m.run(R.arm(p)));
    await until(() => stub.mpos()[0] > 130 && stub.state.state === 'Run', 10000, 'cutting');
    m.pause();
    await until(() => stub.state.state === 'Hold' && stub.state.sub === 0, 5000, 'Hold:0');
    const at = stub.mpos();
    await sleep(120);
    assert.deepEqual(stub.mpos(), at, 'nothing moves in Hold:0');
    assert.equal(m.state.paused, true);
    m.resume();
    await until(() => !m.state.running, 30000, 'resumed job to finish');
    assert.equal(m.state.done, true, m.state.note);
    log('pause/resume: held at', at.map(v => v.toFixed(2)).join(','), '→', m.state.note);
  }

  // stop keeps position: hold, rest, reset, the preamble again
  {
    await m.fresh();
    const p = job(m, zigzag(60, 5, 600));
    assert.ok(m.run(R.arm(p)));
    await until(() => stub.mpos()[0] > 130 && stub.state.state === 'Run', 10000, 'cutting');
    const mark = stub.state.received.length;
    await m.stop();
    await until(() => !m.state.running && !m.stopping, 8000, 'stopped');
    assert.equal(m.state.alarm, 0, 'no alarm: the reset came at rest');
    assert.equal(m.homed, true, 'still homed');
    assert.equal(stub.state.state, 'Idle');
    assert.equal(stub.state.spindle.on, false, 'the reset stopped the spindle');
    const after = tail(stub, mark);
    assert.deepEqual(after.slice(-5), PREAMBLE, 'the preamble resent after the reset');
    await m.fresh();
    for (const [i, a] of ['x', 'y', 'z'].entries()) near(m.state.mpos[a], stub.mpos()[i], 0.0013, `position kept ${a}`);
    assert.match(m.state.note, /^stopped/);
    log('stop:', m.state.note, '| at', JSON.stringify(m.state.pos));
  }

  // an error in the middle of a job: the same stop, and the line and code said
  {
    await m.fresh();
    const p = job(m, zigzag(200, 0.5, 600));
    stub.fault.errorOnLine(60, 20);
    assert.ok(m.run(R.arm(p)));
    await until(() => !m.state.running && !m.stopping, 15000, 'stopped on the error');
    assert.match(m.state.note, /stopped at line \d+: the board refused ".*" \(error 20: a G-code or M-code it does not support\)/);
    assert.equal(m.state.alarm, 0);
    assert.equal(m.homed, true);
    assert.equal(m.state.done, false);
    assert.equal(m.state.stopHit, true);
    log('error:', m.state.note);
  }

  // hard limit: alarm 1, the reset swarf sends, not homed
  {
    await m.fresh();
    const r = await m.cmd('G21G53G0Y5');   // a raw move past the Y+ switch: swarf itself never sends one
    assert.equal(r.ok, true);
    await until(() => m.state.alarm === 1, 5000, 'alarm 1');
    await until(() => stub.state.state === 'Alarm' && !stub.state.critical, 5000, 'reset after the alarm');
    assert.equal(m.homed, false);
    assert.match(m.state.note, /limit switch was hit.*Home again/);
    log('alarm 1:', m.state.note);
    assert.equal(await m.jog('x', 5), false, 'locked: no jog');
    assert.ok(await m.home(), m.state.note);
  }

  // the board restarts by itself mid-job
  {
    await m.fresh();
    const g54 = m.offsets.G54;
    assert.ok(Math.abs(g54.x - 100) < 0.01, 'G54 kept across the alarm and reset');
    const p = job(m, zigzag(60, 5, 600));
    assert.ok(m.run(R.arm(p)));
    await until(() => m.state.line > 10, 10000, 'cutting');
    stub.fault.restart();
    await until(() => !m.state.running, 5000, 'job ended');
    assert.equal(m.homed, false);
    assert.match(m.state.note, /the board restarted at line \d+.*not homed and its zero is unknown/);
    assert.equal(m.state.stopHit, true);
    assert.equal(m.state.lostMid, true);
    log('restart:', m.state.note);
    assert.ok(await m.home(), m.state.note);
    near(stub.eeprom.coords[54][0], 100, 0.003, 'G54 kept across a restart');
  }

  // the cable comes out mid-job
  {
    await m.fresh();
    const p = job(m, zigzag(60, 5, 600));
    assert.ok(m.run(R.arm(p)));
    await until(() => m.state.line > 10, 10000, 'cutting');
    stub.fault.drop();
    await until(() => !m.state.connected, 3000, 'link lost');
    assert.equal(m.state.running, false);
    assert.equal(m.state.routerUnknown, true);
    assert.match(m.state.note, /may finish the moves it already has, with the spindle on\. The e-stop is the stop/);
    log('unplug:', m.state.note);
  }
}

// ------------------------------------------------------------------ inches
{
  console.log('inches ($13=1) against millimeters ($13=0)');
  const read = async (inch) => {
    const probeAt = p => p[2] <= -30.48;
    const { m, stub } = await machine({ settings: { 13: inch ? 1 : 0 }, probeAt });
    assert.ok(await m.connect(true));
    assert.ok(await m.home());
    assert.ok(await m.goTo({ x: 254, y: -127, z: -2.54 })); await rest(m);
    const exact = { ...m.state.mpos };
    assert.ok(await m.goTo({ x: 33.333, y: -77.777, z: -11.111 })); await rest(m);
    const odd = { ...m.state.mpos }, oddStub = stub.mpos();
    await m.zero('xyz'); await rest(m);
    const g54 = { ...m.offsets.G54 };
    // a probe search down: [PRB:] in the board's units
    const r = await m.cmd('G21G91G38.2Z-40F300');
    assert.ok(r.ok, JSON.stringify(r));
    await m.cmd('G90');
    const prb = { ...m.probe }, prbStub = stub.state.prb.slice();
    // the feed in the status, mid-move
    const moving = m.cmd('G21G90G1X200F1000');
    await until(() => m.state.grbl === 'Run' && m.state.feed > 0, 5000, 'a feed in the status');
    const feed = m.state.feed;
    await moving; await rest(m);
    return { exact, odd, oddStub, g54, g54Stub: stub.eeprom.coords[54].slice(), prb, prbStub, feed };
  };
  const a = await read(true), b = await read(false);
  for (const [i, k] of ['x', 'y', 'z'].entries()) {
    near(a.exact[k], [254, -127, -2.54][i], 0.001, `inches exact ${k}`);
    near(b.exact[k], [254, -127, -2.54][i], 0.001, `mm exact ${k}`);
    // four inch decimals are 0.00254 mm apart: the reading is the board's position to half of that
    near(a.odd[k], a.oddStub[i], 0.00127 + 1e-9, `inches odd ${k}`);
    near(a.g54[k], a.g54Stub[i], 0.00127 + 1e-9, `inches G54 ${k}`);
    near(a.prb[k], a.prbStub[i], 0.00127 + 1e-9, `inches probe ${k}`);
    near(b.prb[k], b.prbStub[i], 0.0005 + 1e-9, `mm probe ${k}`);
  }
  near(a.feed, 1000, 1.3, 'inches feed (in/min, one decimal) in mm/min');
  near(b.feed, 1000, 0.5, 'mm feed');
  log('inches: exact', JSON.stringify(a.exact), 'probe', JSON.stringify(a.prb), 'feed', a.feed.toFixed(2));
}

// ------------------------------------------------------------------ refusals
{
  console.log('refusals');
  for (const [k, word] of [[22, /homing is off \(\$22=0\)/], [21, /limit switches are off \(\$21=0\)/]]) {
    const { m, stub } = await machine({ settings: { [k]: 0 } });
    assert.ok(await m.connect(true), 'connects to read');
    assert.match(m.state.refused, word);
    assert.equal(await m.home(), false);
    assert.match(m.state.note, word);
    assert.equal(await m.jog('x', 1), false);
    assert.ok(!stub.state.received.some(l => /^\$\d+=/.test(l)), 'no setting written');
    log(`$${k}=0:`, m.state.note);
    await m.disconnect();
  }
  // lines the board would refuse never leave
  const { m } = await machine();
  assert.ok(await m.connect(true));
  const r = await m.enqueue('G1X' + '1'.repeat(80));
  assert.ok(r.refused && !r.ok);
  assert.equal(clean('g1 x1.5 (tool ⌀6 mm!) ; note'), 'G1X1.5');
  assert.equal(clean('G1 X1  Y2?'), 'G1X1Y2');
  await m.disconnect();
}

// ------------------------------------------------------------------ stop during homing; a long pause at the end of a job
{
  console.log('stop during homing; a long pause');
  const { m, stub } = await machine({ homeSecs: 200 });
  assert.ok(await m.connect(true));
  const homing = m.home();
  await until(() => stub.state.state === 'Home', 3000, 'homing');
  await sleep(3500);
  assert.equal(m.state.connected, true, 'no status during homing is not a lost link');
  assert.ok(!m.state.silent, 'nor a silent board');
  await m.stop();
  assert.equal(await homing, false);
  assert.equal(m.homed, false);
  assert.equal(m.state.alarm, 6);
  assert.match(m.state.note, /homing stopped/);
  log('stop in homing:', m.state.note);
  stub.state.homeEnd = 0;
}
{
  const { m, stub } = await machine();
  assert.ok(await m.connect(true));
  assert.ok(await m.home());
  assert.ok(await m.goTo({ x: 100, y: -100, z: -50 })); await rest(m);
  assert.ok(await m.zero('xyz')); await rest(m);
  await m.fresh();
  const p = job(m, zigzag(20, 5, 600));
  assert.ok(m.run(R.arm(p)));
  await until(() => m.waiting.length === 0 && stub.mpos()[0] > 30 && stub.state.state === 'Run', 10000, 'every line sent');
  m.pause();
  await sleep(2500);
  assert.equal(m.state.running, true, 'still the job, paused');
  m.resume();
  await until(() => !m.state.running, 20000, 'finish');
  assert.equal(m.state.done, true, m.state.note);
  log('long pause:', m.state.note);
}

// ------------------------------------------------------------------ the stub on its own
{
  console.log('the stub, line by line');
  const stub = StubGrbl({ timeFactor: 40 });
  stubs.push(stub);
  let text = '';
  stub.onData = b => { for (const x of b) text += String.fromCharCode(x); };
  const lines = () => text.split(/\r\n/).filter(Boolean);
  const say = async (s, ms = 30) => { const n = lines().length; stub.write(Uint8Array.from(s, c => c.charCodeAt(0))); await sleep(ms); return lines().slice(n); };
  stub.open(); await sleep(20);
  assert.deepEqual(lines(), ['Grbl 1.1h [\'$\' for help]', '[MSG:\'$H\'|\'$X\' to unlock]']);
  assert.deepEqual(await say('G0X1\n'), ['error:9'], 'locked');
  assert.deepEqual(await say('\n'), ['ok'], 'an empty line');
  assert.deepEqual(await say('$H\n', 400), ['ok'], 'homing ends with ok');
  assert.deepEqual(await say('G1X' + '1'.repeat(80) + '\n'), ['error:11']);
  assert.deepEqual(await say('M6\n'), ['error:20']);
  assert.deepEqual(await say('G1X1\n'), ['error:22'], 'no feed yet');
  assert.deepEqual(await say('G2X10Y0I3J0F100\n'), ['error:33'], 'an arc whose end is off its circle');
  const r = await say('?');
  assert.match(r[0], /^<Idle\|MPos:0\.0000,0\.0000,0\.0000\|FS:0\.0,0\|WCO:/, 'inches, four decimals, WCO');
  await say('G1X100F600\n', 5);
  assert.deepEqual(await say('$$\n', 5), ['error:8'], '$$ while moving');
  await say('(a comment with a ! in it)\n', 100);
  assert.match((await say('?'))[0], /^<Hold:[01]/, 'the ! inside a comment held the machine');
  await say('~', 400);
  await say('M0\n', 20);
  const m0 = await say('?', 200);
  assert.match(m0[0], /^<Hold:0/, 'M0 holds');
  assert.deepEqual(await say('~'), ['ok'], 'its ok waits for ~');
  // more than the buffer at once: the overflow is dropped, and the board shows it
  const before = stub.state.dropped;
  await say('G1X1F100\n'.repeat(30), 50);
  assert.ok(stub.state.dropped > before, 'overflow dropped');
  log('stub: locked, empty line, errors 9/11/20/22/33/8, ! in a comment, M0 and ~, overflow dropped', stub.state.dropped - before, 'bytes');
}

for (const m of machines) await m.letGo();
for (const s of stubs) s.halt();
console.log('test-grbl: all passed');
