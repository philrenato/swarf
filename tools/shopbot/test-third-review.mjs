// The third review's acceptance tests (10-28): under uncertainty swarf sends the card nothing.
//   1 a failed fresh e-stop read never falls back to an old "released" reading
//   2 a line the reader refused stops the plan, whoever builds it
//   3 an output test whose off fails latches the router as unknown; nothing moves until an off lands
//   4 a plan is frozen all the way down; its fingerprint covers switches and dwells, not only geometry
//   5 a resume is a plan of its own and puts back the file's outputs; a move of no whole steps is fine
//   6 the sound cues come from the run itself: the router cue before the router starts, done after the coast
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { FakeCP210x, fakeUSB } from './fake-cp210x.mjs';
const StubCard = createRequire(import.meta.url)('./stub-card.cjs');

const FILES = ['swarf-run-parse.js', 'swarf-run-plan.js', 'swarf-run-machine.js', 'swarf-shopbot-usb.js', 'swarf-shopbot-card.js', 'swarf-shopbot-direct.js'];
function context(usb) {
  const store = {};
  const win = { navigator: { usb }, setTimeout, clearTimeout, setInterval, clearInterval, console, performance,
    requestAnimationFrame: f => setTimeout(() => f(performance.now()), 16),
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
  win.window = win;
  vm.createContext(win);
  for (const f of FILES) vm.runInContext(fs.readFileSync(new URL(`../../web/kiri/${f}`, import.meta.url), 'utf8'), win, { filename: f });
  return win;
}
const W = context({});
const P = W.SwarfRunParse, R = W.SwarfRunPlan;
const SBP = "'UNITS:MM\nSA\nJ3,10,20,5\nM3,40,20,-2\nM3,40,50,-2\nJ3,40,50,5\nEND";

// a bare machine on a hand-made card: every call it would send to the box is counted
function bare(card) {
  const m = new W.SwarfRunMachine.DirectMachine();
  const sent = [];
  m.card = Object.assign({ streaming: false,
    status: () => Promise.reject(new Error('no answer')),
    run: () => { sent.push('run'); return Promise.resolve({ steps: { x: 0, y: 0, z: 0 }, inputs: 0x0F, inputs2: 0 }); },
    cmd: () => { sent.push('cmd'); return Promise.resolve(); } }, card || {});
  m.state.pos = { x: 0, y: 0, z: 30 };
  return { m, sent };
}
const armed = (m, prog) => R.arm(m.plan(prog));
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = (f, ms = 5000) => new Promise((res, rej) => { const t0 = Date.now(), t = setInterval(() => { if (f()) { clearInterval(t); res(); } else if (Date.now() - t0 > ms) { clearInterval(t); rej(new Error('timed out')); } }, 5); });

// 1 ---------------------------------------------------------------------------------------
{ // a released reading in the cache, the fresh read fails: nothing is sent, and it says why
  const { m, sent } = bare();
  m.state.inputs = { lo: 0x0F, hi: 0 };          // released, from an earlier poll
  const plan = armed(m, { name: 'c', moves: P.parse(SBP).moves, sbp: SBP, spindle: true });
  assert.equal(plan.problems.length, 0, `a clean plan (${plan.problems})`);
  m.run(plan);
  await until(() => !m.state.running);
  assert.deepEqual(sent, [], 'no stream, no output word');
  assert.match(m.state.note, /could not read the e-stop/, m.state.note);
  await assert.rejects(m.testOutput(1, 10), /could not read the e-stop/);
  assert.deepEqual(sent, [], 'no output test either');
  console.log('1a stale released + failed read: refused,', m.state.note);
}
{ // no reading at all: refused before the plan runs
  const { m, sent } = bare();
  m.run(armed(m, { name: 'c', moves: P.parse(SBP).moves, sbp: SBP, spindle: true }));
  assert.deepEqual(sent, []);
  assert.match(m.state.note, /could not read the e-stop/);
  console.log('1b no reading: refused');
}
{ // a fresh reading that says pressed: refused, and it says pressed
  const { m, sent } = bare({ status: () => Promise.resolve({ steps: { x: 0, y: 0, z: 0 }, inputs: 0x8F, inputs2: 0 }) });   // input 8 (the shop's e-stop) held down
  m.state.inputs = { lo: 0x0F, hi: 0 };
  m.run(armed(m, { name: 'c', moves: P.parse(SBP).moves, sbp: SBP, spindle: true }));
  await until(() => !m.state.running);
  assert.deepEqual(sent, []);
  assert.match(m.state.note, /reads pressed/);
  console.log('1c fresh pressed: refused');
}

// 2 ---------------------------------------------------------------------------------------
{ const text = 'SA\nC123\nMX,10';
  const parsed = P.parse(text, { machineUnits: 'mm' });
  assert.ok(parsed.unsupported.some(u => /C123/.test(u.text)), 'the reader refuses C123');
  const { m, sent } = bare({ status: () => Promise.resolve({ steps: { x: 0, y: 0, z: 0 }, inputs: 0x0F, inputs2: 0 }) });
  m.state.inputs = { lo: 0x0F, hi: 0 };
  const plan = m.plan({ name: 'x', moves: parsed.moves, sbp: text, spindle: true });
  assert.ok(plan.problems.some(p => /line 2/.test(p)), `the plan carries it (${plan.problems})`);
  m.run(R.arm(plan));
  assert.deepEqual(sent, [], 'the driver refuses it');
  // a bare program, or a plan never confirmed, is refused too
  m.run({ name: 'x', moves: P.parse(SBP).moves, sbp: SBP, spindle: true });
  assert.match(m.state.note, /only a plan it has checked/);
  m.run(m.plan({ name: 'c', moves: P.parse(SBP).moves, sbp: SBP, spindle: true }));
  assert.match(m.state.note, /not confirmed/);
  // a file zeroed on the table
  const table = "'UNITS:MM\nSA\nJ3,0,0,30\nM3,10,0,18\nM3,10,10,0.5\nM3,0,10,0.5\nJ3,0,0,30";
  const tp = m.plan({ name: 't', moves: P.parse(table).moves, sbp: table, spindle: true });
  assert.ok(tp.problems.some(p => /Z zero on the table/.test(p)), `table zero refused (${tp.problems})`);
  assert.deepEqual(sent, []);
  console.log('2 refused lines, bare programs, unconfirmed plans and table zeros never reach the card');
}

// 3 ---------------------------------------------------------------------------------------
{ // the off fails: router unknown, every motion refused, all clear needs an off that lands
  let calls = 0, fail = true;
  const { m, sent } = bare({ status: () => Promise.resolve({ steps: { x: 0, y: 0, z: 0 }, inputs: 0x0F, inputs2: 0 }),
    cmd: () => { calls++; sent.push('cmd'); return calls === 1 || !fail ? Promise.resolve() : Promise.reject(new Error('gone')); } });
  const off = await m.testOutput(1, 5);
  assert.equal(off, false);
  assert.equal(m.state.routerUnknown, true, 'latched unknown');
  assert.match(m.state.note, /may still be on/);
  const n = sent.length;
  m.run(armed(m, { name: 'c', moves: P.parse(SBP).moves, sbp: SBP, spindle: true }));
  m.jog('x', 10);
  await m.home(); await m.zZero();
  await assert.rejects(m.testOutput(1, 5), /can't tell whether the router is on/);
  assert.equal(sent.length, n, 'nothing sent while unknown');
  assert.equal(await m.recover(), false, 'an off that fails keeps it unknown');
  fail = false;
  assert.equal(await m.recover(), true, 'an off that lands clears it');
  assert.equal(m.state.routerUnknown, false);
  console.log('3a failed off: latched, motion refused, cleared only by an off that lands');
}
{ // the on fails: the off still goes, and lands, so the state is known
  let calls = 0;
  const { m } = bare({ status: () => Promise.resolve({ steps: { x: 0, y: 0, z: 0 }, inputs: 0x0F, inputs2: 0 }),
    cmd: () => { calls++; return calls === 1 ? Promise.reject(new Error('busy')) : Promise.resolve(); } });
  await assert.rejects(m.testOutput(2, 5), /busy/);
  assert.ok(!m.state.routerUnknown, 'known: the off landed');
  assert.equal(calls, 2, 'the off was sent after the failed on');
  console.log('3b failed on: the off is sent and lands');
}

// 4 ---------------------------------------------------------------------------------------
{ const { m } = bare();
  const plan = armed(m, { name: 'c', moves: P.parse(SBP).moves, sbp: SBP, spindle: true });
  const mv = plan.steps.find(s => s.move);
  assert.throws(() => { 'use strict'; mv.move.x = 999; });
  assert.throws(() => { 'use strict'; plan.problems.push('x'); });
  assert.ok(R.verify(plan));
  // a copy with one step changed no longer matches its fingerprint, and the driver refuses it
  const forged = Object.freeze({ ...plan, steps: Object.freeze(plan.steps.map(s => s.move ? { ...s, move: { ...s.move, z: s.move.z - 5 } } : s)) });
  assert.equal(R.verify(forged), false);
  assert.match(m.refuse(forged), /changed after it was made/);
  // the same moves, one switching output 2 on: two different plans
  const withOut = SBP.replace('SA\n', 'SA\nSO,2,1\n');
  const a = m.plan({ name: 'c', moves: P.parse(SBP).moves, sbp: SBP, spindle: true }), b = m.plan({ name: 'c', moves: P.parse(withOut).moves, sbp: withOut, spindle: true });
  assert.notEqual(a.id, b.id, 'outputs are in the fingerprint');
  const withDwell = SBP.replace('SA\n', 'SA\nPAUSE 2\n');
  assert.notEqual(a.id, m.plan({ name: 'c', moves: P.parse(withDwell).moves, sbp: withDwell, spindle: true }).id, 'dwells are in the fingerprint');
  // a plan made for one zero will not run after the zero moves
  m.origin.x += 7218;
  assert.match(m.refuse(plan), /zero or the connection changed/);
  console.log('4 frozen all the way down; switches, dwells and the zero are in what it is');
}

// 5 ---------------------------------------------------------------------------------------
{ const text = "'UNITS:MM\nSA\nSO,2,1\nJ3,0,0,5\nM3,0,0,-2\nM3,40,0,-2\nM3,40,40,-2\nJ3,40,40,5\nEND";
  const { m } = bare();
  const plan = m.plan({ name: 'r', moves: P.parse(text).moves, sbp: text, spindle: true });
  const k = plan.steps.findIndex(s => s.move && s.move.x === 40 && s.move.y === 40);
  const rp = R.resumeFrom(plan, k, { x: 40, y: 12, z: -2 }, m.planCfg());
  const i = (pred) => rp.steps.findIndex(pred);
  const up = i(s => s.move && s.move.z >= 25.4 - 1e-9), on = i(s => s.router === true), out2 = i(s => s.out === 2 && s.on), down = i(s => s.move && s.move.z < 0);
  assert.ok(up === 0 && on > up && out2 > up && down > on && down > out2, `up, the router and output 2 on, then down (${JSON.stringify(rp.steps.slice(0, 5))})`);
  assert.equal(rp.resumes, plan.id);
  assert.ok(R.verify(rp));
  assert.match(R.entryWords(rp), /^up to 25 mm, the router on, slowly down to Z -2\.0/);
  console.log('5a resume plan:', R.entryWords(rp));
  // a move of no whole steps is fine; one slower than the card's slowest step is not
  const cfg = m.planCfg();
  assert.equal(R.segProblem({ x: 0, y: 0, z: 0 }, { x: 0.001, y: 0, z: 0 }, 0.01, cfg), '');
  assert.match(R.segProblem({ x: 0, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }, 0.5, cfg), /slower than the card can step/);
  assert.match(R.segProblem({ x: 0, y: 0, z: 0 }, { x: NaN, y: 0, z: 0 }, 10, cfg), /not a number/);
  // the card's own stream: a run with a zero-step move in it ends
  const pl = new W.ShopBotCard.Planner({ unit: cfg.unit, rampSpeed: 10.16, rampRate: 5.08 });
  let n = 0;
  for (const b of pl.items([{ x: 0.001, y: 0, z: 0, feed: 10, line: 1 }, { x: 0.001, y: 0, z: 0, feed: 10, line: 2 }, { x: 5, y: 0, z: 0, feed: 10, line: 3 }], { x: 0, y: 0, z: 0 })) if (++n > 1e6) break;
  assert.ok(n < 1e6 && n > 0, `the stream ends (${n} bytes)`);
  console.log('5b no-step moves pass and the stream ends; slow and not-a-number moves are refused');
}

// 6 ---------------------------------------------------------------------------------------
{ const card = StubCard();
  const dev = new FakeCP210x(card);
  const win = context(fakeUSB(dev));
  win.localStorage.setItem('swarf-shopbot-coast', '0.3');
  const m = new win.SwarfRunMachine.DirectMachine({ spinUp: 0.02 });
  assert.ok(await m.connect(false));
  const cues = [];
  let p7AtRouterCue = null;
  m.onCue = name => { cues.push([name, performance.now()]); if (name === 'router') p7AtRouterCue = card.state.outs; };
  m.zero('xyz');
  const plan = win.SwarfRunPlan.arm(m.plan({ name: 'c', moves: win.SwarfRunParse.parse(SBP).moves, sbp: SBP, spindle: true }));
  m.run(plan);
  await until(() => !m.state.running);
  const tEnd = performance.now();
  assert.deepEqual(cues.map(c => c[0]), ['move', 'router'], `no done yet: the bit is coasting (${cues.map(c => c[0])})`);
  assert.equal(p7AtRouterCue & 1, 0, 'the router cue sounds before the router is switched on');
  assert.ok(m.state.coasting);
  await wait(450);
  assert.deepEqual(cues.map(c => c[0]), ['move', 'router', 'done']);
  assert.ok(cues[2][1] - tEnd >= 250, 'done waits for the coast');
  // a stopped job never chimes
  cues.length = 0;
  card.state.realtime = true;
  const long = "'UNITS:MM\nSA\nJ3,0,0,5\nM3,0,0,-1\nM3,300,0,-1\nJ3,300,0,5\nEND";
  m.run(win.SwarfRunPlan.arm(m.plan({ name: 'l', moves: win.SwarfRunParse.parse(long).moves, sbp: long, spindle: true })));
  await until(() => m.state.pos.x > 5 && m.state.running, 20000);
  const streaming = m.card.streaming;
  m.stop();
  await until(() => !m.state.running);
  console.log('   stop while streaming:', streaming, '| note:', m.state.note, '| x', m.state.pos.x.toFixed(1));
  await wait(450);
  assert.ok(!cues.some(c => c[0] === 'done'), `a stop: no done (${cues.map(c => c[0])})`);
  console.log('6 cues: move, router before the switch, done after the coast; none after a stop');
}
console.log('third review: ok');
process.exit(0);
