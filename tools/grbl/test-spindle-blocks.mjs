// One block's spindle words against its motion, S0 against no S, and lines against the board's
// receive buffer, read from the lines the GRBL driver would send (their order, not only their
// presence). No board, no port. node tools/grbl/test-spindle-blocks.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.SwarfRunParse = require('../../web/kiri/swarf-run-parse.js');
globalThis.SwarfRunPlan = require('../../web/kiri/swarf-run-plan.js');
const { GrblMachine } = require('../../web/kiri/swarf-grbl.js');
const P = globalThis.SwarfRunParse, R = globalThis.SwarfRunPlan;

function machine() {
  const m = new GrblMachine();
  m.settings = { 130: 580, 131: 550, 132: 150, 110: 6000, 111: 6000, 112: 2000 };
  m.wco = { x: 100, y: -100, z: -60 };
  m.state.pos = { x: 0, y: 0, z: 5 };
  return m;
}
// the whole file, planned as a cut; its lines as the board gets them
function cut(text) {
  const m = machine(), p = P.parse(text, { machineUnits: 'mm' });
  const q = m.plan({ name: 't', moves: p.moves, sbp: text, source: p, spindle: true, kind: 'cut' });
  return { parsed: p, plan: q, lines: m.linesOf(q).map(x => x.text) };
}
// a continue from line n of the file, planned as Run mode makes it
function from(text, n) {
  const m = machine(), p = P.parse(text, { machineUnits: 'mm' });
  const prog = P.fromLineProgram(p, n, 5, 't');
  const q = m.plan(prog);
  return { plan: q, lines: m.linesOf(q).map(x => x.text) };
}
const at = (lines, t) => { const i = lines.indexOf(t); assert.ok(i >= 0, `"${t}" is sent (${lines.join(' ')})`); return i; };
const before = (lines, a, b, what) => assert.ok(at(lines, a) < at(lines, b), `${what}: ${a} before ${b} (${lines.join(' ')})`);
// the last S/M3S word sent before line t
const speedAt = (lines, t) => { const i = at(lines, t); for (let k = i - 1; k >= 0; k--) { const s = /^(?:M3)?S(\d+)$/.exec(lines[k]); if (s) return +s[1]; } return null; };
const head = 'G21\nG90\nM3 S6000\nG0 Z5\nG1 Z-1 F300\nG1 X5 F600\n';   // lines 1-6
const tail = '\nG0 Z5\nM5\nM30';
const X10 = 'G1X10Y0Z-1F600';
let n = 0;
const ok = (c, what) => { assert.ok(c, what); n++; };

// ---- F1: a block's speed acts before its motion, and never holds up its own switches
{
  const split = cut(head + 'S3000\nG1 X10' + tail), one = cut(head + 'G1 X10 S3000' + tail);
  ok(!one.plan.problems.length && !one.parsed.unsupported.length, 'G1 X10 S3000 runs');
  before(one.lines, 'S3000', X10, 'G1 X10 S3000');
  ok(speedAt(one.lines, X10) === 3000, 'X10 runs at 3000');
  // the same machine state before the motion as the file that splits it in two
  const rest = l => l.slice(l.indexOf('G1X5Y0Z-1F600'));
  assert.deepEqual(rest(one.lines), rest(split.lines), 'G1 X10 S3000 sends what S3000 then G1 X10 sends'); n++;
}
{
  // the router off before it: M3 and S on the move's own line start it at that speed, then the wait, then the move
  const t = cut(head + 'G0 Z5\nM5\nG1 X10 Z-1 F300 M3 S3000' + tail);
  ok(!t.plan.problems.length, `G1 … M3 S3000 runs (${t.plan.problems})`);
  const mv = 'G1X10Y0Z-1F300';
  const on = at(t.lines, 'M3S3000');
  ok(t.lines[on + 1] === 'G4P2' && on + 1 < at(t.lines, mv), `M3S3000, the spin-up wait, then the move (${t.lines.join(' ')})`);
  // the router already on: M3 with a new S on a move changes the speed before it
  const u = cut(head + 'G1 X10 M3 S3000' + tail);
  ok(!u.plan.problems.length, 'G1 X10 M3 S3000 runs');
  before(u.lines, 'S3000', X10, 'G1 X10 M3 S3000');
}
{
  // M5 S0 on a cut: the stop acts before the move, and the move is then a cut with the router off
  const t = cut(head + 'G1 X10 M5 S0' + tail);
  before(t.lines, 'M5', X10, 'G1 X10 M5 S0');
  const s0 = t.lines.indexOf('S0'), m5 = t.lines.indexOf('M5');
  ok(s0 >= 0 && s0 < m5, 'S0 before M5');
  ok(t.plan.problems.some(p => /line 7 feeds into the board with the router off/.test(p)), `G1 X10 M5 S0 is refused (${t.plan.problems})`);
  // the same words with the move up out of the board: allowed, stopped before it rises
  const u = cut(head + 'G0 Z5 M5 S0\nM30');
  ok(!u.plan.problems.length, `G0 Z5 M5 S0 runs (${u.plan.problems})`);
  before(u.lines, 'M5', 'G0X5Y0Z5', 'G0 Z5 M5 S0');
  before(u.lines, 'S0', 'G0X5Y0Z5', 'G0 Z5 M5 S0');
}

// ---- F2: S0 is a speed of 0, not no speed
{
  const t = cut(head + 'S0\nG1 X10' + tail);
  before(t.lines, 'S0', X10, 'S0 then G1 X10');
  ok(t.plan.problems.some(p => /line 8 feeds into the board with the spindle stopped \(S0\)/.test(p)), `S0 then a cut is refused (${t.plan.problems})`);
  const u = cut(head + 'G1 X10 S0' + tail);
  before(u.lines, 'S0', X10, 'G1 X10 S0');
  ok(u.plan.problems.some(p => /spindle stopped/.test(p)), 'G1 X10 S0 is refused');
}
{
  // S0, up out of the board, a positive S: speed back, the spin-up wait, then the next move down
  const t = cut(head + 'G0 Z5\nS0\nG0 X20\nS3000\nG1 Z-1 F300\nG1 X30 F600' + tail);
  ok(!t.plan.problems.length, `S0 then S3000 runs (${t.plan.problems})`);
  const l = t.lines, s0 = at(l, 'S0'), s3 = at(l, 'S3000'), dz = at(l, 'G1X20Y0Z-1F300');
  ok(at(l, 'G0X5Y0Z5') < s0 && s0 < at(l, 'G0X20Y0Z5') && at(l, 'G0X20Y0Z5') < s3, 'S0 between the lift and the move over');
  ok(s3 < dz && l.slice(s3, dz).includes('G4P2'), 'the spin-up wait after S3000, before the move down');
  ok(speedAt(l, 'G1X30Y0Z-1F600') === 3000, 'the cut after runs at 3000');
}
{
  // no S at all against S0
  const none = cut('G21\nG90\nM3\nG0 Z5\nG1 Z-1 F300\nG1 X5 F600' + tail);
  ok(none.plan.problems.includes('the file names no spindle speed (an S word)'), 'no S: names no speed');
  const zero = cut('G21\nG90\nM3 S0\nG0 Z5\nG1 Z-1 F300\nG1 X5 F600' + tail);
  ok(!zero.plan.problems.includes('the file names no spindle speed (an S word)'), 'S0 is a speed named');
  ok(zero.plan.rpm === 0 && zero.plan.problems.some(p => /spindle stopped/.test(p)), 'M3 S0 then a cut is refused');
  ok(!zero.lines.includes('M3S6000'), 'S0 is never replaced by another speed');
}
{
  // a speed below 0 is refused in plain words, alone or on a move
  for (const w of ['S-100\nG1 X10', 'G1 X10 S-100']) {
    const t = cut(head + w + tail);
    ok(t.parsed.unsupported.some(u => u.why === 'a spindle speed below zero'), `${JSON.stringify(w)}: read as unsupported`);
    ok(t.plan.problems.some(p => /a spindle speed below zero/.test(p)), `${JSON.stringify(w)}: refused (${t.plan.problems[0]})`);
  }
  // a tool change with motion on one line is refused, not run in another order
  const t = cut(head + 'G1 X10 M6' + tail);
  ok(t.parsed.unsupported.some(u => u.why === 'a tool change and a move on one line'), 'G1 X10 M6 refused');
}
{
  // a router with no speed (the ShopBot's): S0 changes nothing there
  const text = head + 'S0\nG1 X10' + tail, p = P.parse(text, { machineUnits: 'mm' });
  const cfg = { safeZ: 5, rapid: { xy: 50, z: 20 }, move: { xy: 50, z: 20 }, jog: { z: 20 }, spinUp: 2 };
  const q = R.build({ name: 't', moves: p.moves, sbp: text, source: p, spindle: true, kind: 'cut' }, { pos: { x: 0, y: 0, z: 5 }, live: true, cfg });
  ok(!q.problems.length, `no spindle speed: S0 is not a stop (${q.problems})`);
}

// ---- continuing from each such block: the same state before its motion as the whole file
{
  const c = from(head + 'G1 X10 S3000' + tail, 7);
  ok(!c.plan.problems.length, `from G1 X10 S3000 runs (${c.plan.problems})`);
  ok(speedAt(c.lines, X10) === 3000, 'from G1 X10 S3000: X10 at 3000');
  ok(c.lines.findIndex(l => /^M3S/.test(l)) < at(c.lines, X10), 'from G1 X10 S3000: started before X10');

  const d = from(head + 'G0 Z5\nM5\nG1 X10 Z-1 F300 M3 S3000' + tail, 9);
  ok(!d.plan.problems.length, `from G1 … M3 S3000 runs (${d.plan.problems})`);
  ok(speedAt(d.lines, 'G1X10Y0Z-1F300') === 3000, 'from G1 … M3 S3000: at 3000');

  const e = from(head + 'G1 X10 M5 S0' + tail, 7);
  ok(e.plan.problems.some(p => /router off/.test(p)), `from G1 X10 M5 S0 is refused (${e.plan.problems})`);
  ok(e.lines.lastIndexOf('M5') > -1 && e.lines.indexOf('M5') < at(e.lines, X10), 'from G1 X10 M5 S0: M5 before X10');

  const f = from(head + 'S0\nG1 X10' + tail, 8);
  ok(f.plan.problems.some(p => /spindle stopped/.test(p)), `from after S0 is refused (${f.plan.problems})`);
  ok(speedAt(f.lines, X10) === 0, 'from after S0: the start is at 0, never the earlier 6000');

  const g = from(head + 'G0 Z5\nS0\nG0 X20\nS3000\nG1 Z-1 F300\nG1 X30 F600' + tail, 11);
  ok(!g.plan.problems.length, `from after S0 then S3000 runs (${g.plan.problems})`);
  ok(speedAt(g.lines, 'G1X20Y0Z-1F300') === 3000, 'from after S0 then S3000: at 3000');
}

// ---- F5: every line against the receive buffer the board reports
function linked(rx) {
  const b = new GrblMachine();
  b.rx = rx; b.link = {};
  const sent = [];
  b.send = async s => { sent.push(s); };
  return { b, sent };
}
const line = len => 'G1X' + '1'.repeat(len - 3);
for (const rx of [32, 64, 128]) {
  const max = Math.min(79, rx - 2);
  const { b, sent } = linked(rx);
  ok(b.lineMax() === max, `rx ${rx}: ${max} characters at most`);
  const below = b.enqueue(line(max - 1)), atCap = b.enqueue(line(max));
  const above = await b.enqueue(line(max + 1));
  ok(above.ok === false && /the board takes at most/.test(above.refused), `rx ${rx}: ${max + 1} characters refused at once`);
  const after = b.enqueue(line(max - 2));
  // every accepted line goes out, in order, as the board answers
  for (let i = 0; i < 3 && b.tx.length; i++) b.retire(null);
  const r = await Promise.all([below, atCap, after]);
  ok(r.every(x => x.ok), `rx ${rx}: every line that fits is answered`);
  assert.deepEqual(sent, [line(max - 1), line(max), line(max - 2)].map(t => t + '\n'), `rx ${rx}: sent in order`); n++;
  ok(!b.waiting.length && !b.inflight, `rx ${rx}: nothing left queued`);
  ok(Math.max(...sent.map(s => s.length)) < rx, `rx ${rx}: no line with its newline at or over the buffer`);
}
{
  // a buffer that shrinks under a queued line: the line is refused, the next one still goes
  const { b, sent } = linked(128);
  b.link = null;
  const big = b.enqueue(line(60)), small = b.enqueue(line(20));
  b.rx = 32; b.link = {};
  b.pump();
  const rb = await big;
  ok(rb.ok === false && /at most 30/.test(rb.refused), 'a queued line that no longer fits is refused');
  ok(sent.length === 1 && sent[0] === line(20) + '\n', 'the line behind it goes out');
  b.retire(null);
  ok((await small).ok, 'and is answered');
}
{
  // a plan whose lines do not fit is refused before it can be confirmed
  const m = machine();
  const text = 'G21\nG90\nM3 S6000\nG0 Z5\nG1 Z-1.123 F300.5\nG1 X123.456 Y-123.456 F600.5\nG0 Z5\nM5\nM30';
  const p = P.parse(text, { machineUnits: 'mm' });
  const prog = { name: 't', moves: p.moves, sbp: text, source: p, spindle: true, kind: 'cut' };
  ok(!m.plan(prog).problems.some(x => /too long/.test(x)), 'rx 128: the lines fit');
  m.rx = 32;
  const q = m.plan(prog);
  ok(q.problems.some(x => /^line 6 is too long for the board: a line of \d+ characters \(the board takes at most 30\)$/.test(x)), `rx 32: refused (${q.problems})`);
  ok(m.tooLong(m.linesOf(q)) !== '', 'run checks the same lines');
}

// ---- U2: the way in names what turns the bit on this machine
{
  const t = cut(head + 'G1 X10' + tail);
  ok(/the spindle on/.test(R.entryWords(t.plan, { tool: 'spindle' })) && !/router/.test(R.entryWords(t.plan, { tool: 'spindle' })), 'MR-1: the spindle on');
  ok(/the router on/.test(R.entryWords(t.plan)), 'ShopBot: the router on');
  const c = from(head + 'G1 X10' + tail, 7);
  ok(/the spindle on/.test(R.entryWords(c.plan, { tool: 'spindle' })), 'a continue: the spindle on');
}

console.log(`spindle blocks: ok (${n} checks)`);
