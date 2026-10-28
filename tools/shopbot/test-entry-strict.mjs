// The design review of 10-28, as regression tests (no USB, no browser): every run enters the
// same way from wherever the bit is (straight up, over at safe height, slowly down), the reader
// refuses what it cannot carry out exactly, and the card's slowest step is never undercut.
//   node tools/shopbot/test-entry-strict.mjs
import fs from 'fs'; import vm from 'vm'; import assert from 'assert/strict';
const root = new URL('../../web/kiri/', import.meta.url).pathname;
const w = { console, performance, localStorage: { getItem: () => null, setItem: () => {} }, navigator: {} };
w.window = w; vm.createContext(w);
for (const f of ['swarf-run-parse.js', 'swarf-run-plan.js', 'swarf-run-machine.js', 'swarf-shopbot-card.js', 'swarf-shopbot-direct.js']) vm.runInContext(fs.readFileSync(root + f, 'utf8'), w);
const P = w.SwarfRunParse;

// the reader: an allowlist
const refuses = (t, what) => { const p = P.parse(t, { machineUnits: 'mm' }); assert.ok(p.unsupported.length > 0, what); };
refuses('G21\nG90\nG92 X100\nG1 X110 F600', 'G92 offsets are refused');
refuses('G21\nG18\nG2 X10 Z10 I5 K5 F600', 'G18 planes are refused');
refuses('G21\nG41 D1\nG1 X10 F600', 'cutter compensation is refused');
refuses('G21\nG81 X0 Y0 Z-3 R2 F100', 'canned cycles are refused');
refuses('G21\nG2 X10 Y0 R5 F600', 'R arcs are refused');
refuses("'UNITS:MM\nSA\nMX,&missing\nMY,10", 'unresolved variables are refused');
refuses("'UNITS:MM\nSA\nCG,,10,0,5,0,T,1,-1,3", 'CG plunge/repetitions are refused');
refuses("'UNITS:MM\nSA\nGOSUB DRILL", 'subroutines are refused');
{ const p = P.parse('G21\nG1 X10 F600\nM30\nG1 X20', { machineUnits: 'mm' }); assert.equal(p.moves.length, 1, 'M30 ends the program'); }
refuses('G21\nG1 X10 F600\nM8\nG1 X20', 'coolant the driver does not run is refused');
// follow-up review 10-28: the whole line must be read
refuses('G21\nG1 X10 F600\nG1 Xbad Y20', 'a malformed value is refused');
refuses('G21\nG1 X10 F600\nG1 X20 Q999', 'an unknown word is refused');
refuses("'UNITS:MM\nSA\nC123\nMX,10", 'an unknown macro is refused');
refuses("'UNITS:MM\nSA\nMS,abc,2\nM3,1,1,1", 'a speed that is not a number is refused');
refuses('G21\nM4 S9000\nG1 X10 F600', 'reverse spindle is refused');

// a bare DirectMachine whose runs are planned and armed like the page's (third review #2)
const src = () => ({ units: 'mm', unsupported: [], moves: [], events: [] });   // a stand-in file: these tests are about the moves
function mk() { const m = new w.SwarfRunMachine.DirectMachine(); m.exec = prog => m.run(w.SwarfRunPlan.arm(m.plan(prog.sbp || prog.source ? prog : { ...prog, source: src(prog.moves) }))); return m; }
// the way in, from a low bit at (0,0,0)
function capture(prog, pos) { const m = mk(); m.card = { streaming: false }; m.state.pos = pos; m.state.inputs = { lo: 0x0F, hi: 0 }; m.go = ops => { m.captured = ops; }; m.exec(prog); return m.captured; }
const parsed = P.parse("'UNITS:MM\nSA\nJ3,10,20,5\nM3,40,20,-2\nM3,40,50,-2", { machineUnits: 'mm' });
for (const [name, prog] of [['trace', P.traceProgram(parsed, 25.4, 't')], ['air', P.airProgram(parsed, 5, 't', 25.4)], ['cut', { name: 'c', moves: parsed.moves, spindle: true }]]) {
  const ops = capture(prog, { x: 0, y: 0, z: 0 }).filter(o => o.x !== undefined);
  const a = ops[0], b = ops[1];
  assert.ok(Math.abs(a.x) < 1e-9 && Math.abs(a.y) < 1e-9 && a.z >= 25.4 - 1e-9, `${name}: first straight up (${JSON.stringify(a)})`);
  assert.ok(Math.abs(b.z - a.z) < 1e-9, `${name}: then over at that height (${JSON.stringify(b)})`);
  const firstDown = ops.findIndex((o, i) => i > 0 && o.z < ops[i - 1].z - 1e-9);
  if (firstDown > 0) { const o = ops[firstDown], q = ops[firstDown - 1]; assert.ok(Math.hypot(o.x - q.x, o.y - q.y) < 1e-9 || firstDown > 2, `${name}: comes down only over the start`); }
  console.log(`${name} entry ok:`, ops.slice(0, 3).map(o => `(${o.x.toFixed(1)},${o.y.toFixed(1)},${o.z.toFixed(1)})`).join(' → '));
}
// the router starts only once the bit is up
{ const ops = capture({ name: 'c', moves: parsed.moves, spindle: true }, { x: 0, y: 0, z: 0 });
  const on = ops.findIndex(o => o.out !== undefined && (o.out & 1)), up = ops.findIndex(o => o.z >= 25.4 - 1e-9);
  assert.ok(up >= 0 && on > up, 'router on only after the lift'); }

// the card's slowest step: a slower feed refuses the run
{ const m = mk(); m.card = { streaming: false }; m.state.inputs = { lo: 0x0F, hi: 0 }; m.state.pos = { x: 0, y: 0, z: 30 }; m.go = ops => { m.captured = ops; };
  m.exec({ name: 's', moves: [{ x0: 0, y0: 0, z0: 30, x: 50, y: 0, z: 30, feed: 0.5, line: 4 }], spindle: false });
  assert.ok(!m.captured && /slower than the card can step/.test(m.state.note), `0.5 mm/s refused (${m.state.note})`); }
// a diagonal's floor is higher than an axis's (follow-up review #2): 1.8 mm/s on a 45° move is refused
{ const m = mk(); m.card = { streaming: false }; m.state.inputs = { lo: 0x0F, hi: 0 }; m.state.pos = { x: 0, y: 0, z: 30 }; m.go = ops => { m.captured = ops; };
  m.exec({ name: 'd', moves: [{ x0: 0, y0: 0, z0: 30, x: 50, y: 50, z: 30, feed: 1.8, line: 4 }], spindle: false });
  assert.ok(!m.captured && /slower than the card can step/.test(m.state.note), `1.8 mm/s at 45° refused (${m.state.note})`);
  m.state.note = ''; m.exec({ name: 'a', moves: [{ x0: 0, y0: 0, z0: 30, x: 50, y: 0, z: 30, feed: 1.8, line: 4 }], spindle: false });
  assert.ok(m.captured, '1.8 mm/s along X runs'); }
// the e-stop fails closed: no reading, no run
{ const m = mk(); m.card = { streaming: false }; m.state.pos = { x: 0, y: 0, z: 30 }; m.go = ops => { m.captured = ops; };
  m.exec({ name: 'n', moves: [{ x0: 0, y0: 0, z0: 30, x: 50, y: 0, z: 30, feed: 20, line: 4 }], spindle: false });
  assert.ok(!m.captured && /e-stop/.test(m.state.note), `no input reading: refused (${m.state.note})`); }
// continue from a line: straight up, over at safe height, the router on, then down; never a diagonal descent
{ const p = P.parse("'UNITS:MM\nSA\nJ3,0,0,5\nM3,0,0,-2\nM3,40,0,-2\nM3,40,40,-2\nM3,0,40,-2\nEND", { machineUnits: 'mm' });
  const prog = P.fromLineProgram(p, 6, 25.4, 't');
  const plan = w.SwarfRunPlan.build(prog, { pos: { x: 10, y: 3, z: -2 }, live: true, cfg: { safeZ: 25.4, rapid: { xy: 100, z: 100 }, move: { xy: 76.2, z: 25.4 }, jog: { z: 16 }, spinUp: 3, changeZ: 50 } });
  const mv = plan.moves;
  assert.ok(Math.abs(mv[0].x - 10) < 1e-9 && Math.abs(mv[0].y - 3) < 1e-9 && mv[0].z >= 25.4 - 1e-9, `continue: first straight up (${JSON.stringify(mv[0])})`);
  assert.ok(Math.abs(mv[1].z - mv[0].z) < 1e-9 && Math.abs(mv[1].x - 40) < 1e-9 && Math.abs(mv[1].y - 0) < 1e-9, `continue: then over at height to the line's start (${JSON.stringify(mv[1])})`);
  assert.ok(Math.abs(mv[2].x - 40) < 1e-9 && Math.abs(mv[2].y - 0) < 1e-9 && mv[2].z < 0, `continue: then straight down (${JSON.stringify(mv[2])})`);
  const on = plan.steps.findIndex(s => s.router === true), down = plan.steps.findIndex(s => s.move && s.move.z < 0);
  assert.ok(on > 0 && on < down, 'continue: the router on up there, before the bit comes down');
  console.log('continue entry ok:', mv.slice(0, 3).map(o => `(${o.x.toFixed(0)},${o.y.toFixed(0)},${o.z.toFixed(1)})`).join(' → ')); }
console.log('entry + strict: ok');
