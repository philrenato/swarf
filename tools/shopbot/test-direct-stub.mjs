// DirectMachine's program handling against the stand-in card (fast): the
// file's events in order, outputs only when the spindle is allowed, a tool
// change after cutting starts ends the job with the spindle off and Z up.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { FakeCP210x, fakeUSB } from './fake-cp210x.mjs';
const StubCard = createRequire(import.meta.url)('./stub-card.cjs');

async function machine() {
  const card = StubCard();
  const dev = new FakeCP210x(card);
  const store = {};
  const win = { navigator: { usb: fakeUSB(dev) }, setTimeout, clearTimeout, setInterval, clearInterval, console, performance,
    requestAnimationFrame: f => setTimeout(() => f(performance.now()), 16),
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
  win.window = win;
  vm.createContext(win);
  for (const f of ['swarf-run-parse.js', 'swarf-run-plan.js', 'swarf-run-machine.js', 'swarf-shopbot-usb.js', 'swarf-shopbot-card.js', 'swarf-shopbot-direct.js'])
    vm.runInContext(fs.readFileSync(new URL(`../../web/kiri/${f}`, import.meta.url), 'utf8'), win, { filename: f });
  const m = new win.SwarfRunMachine.DirectMachine({ spinUp: 0.02 });
  assert.ok(await m.connect(false));
  const outs = [];
  const w = card.write;
  card.write = b => { const r = w(b); outs.push(card.state.outs); return r; };
  // every run is a plan swarf made and the student armed (third review #2): a bare program is refused
  const R = win.SwarfRunPlan;
  m.exec = prog => m.run(R.arm(m.plan(prog.sbp || prog.source ? prog : { ...prog, source: { units: 'mm', unsupported: [], moves: [], events: [] } })));
  return { m, card, outs, P: win.SwarfRunParse, R };
}
const done = m => new Promise(r => { const t = setInterval(() => { if (!m.state.running) { clearInterval(t); r(); } }, 20); });

const sbp = ["SA", "C9", "C6", "PAUSE 0.05", "J3,0,0,5", "M3,10,0,-1", "M3,10,10,-1", "C9", "M3,0,10,-1", "J3,0,0,5", "C7", "END"].join('\n');
{ // cut: tool change at line 8 ends the job after line 7
  const { m, card, outs, P } = await machine();
  card.state.noAckOnEnd = true;
  const parsed = P.parse(sbp);
  m.zero('xyz');
  m.exec({ name: 't', moves: parsed.moves, sbp, spindle: true });
  await done(m);
  console.log('cut:', m.state.note, '| pos', m.state.pos, '| outputs history', [...new Set(outs)]);
  assert.equal(m.state.resumeLine, 9);
  assert.ok(m.state.stopHit);
  assert.match(m.state.note, /tool change at line 8/);
  assert.ok(Math.abs(m.state.pos.x - 10) < 0.02 && Math.abs(m.state.pos.y - 10) < 0.02, 'stopped over the last cut point');
  assert.ok(Math.abs(m.state.pos.z - 50) < 0.02, 'Z up 50 mm at a tool change, room for a wrench');
  assert.ok(outs.includes(9), 'router went on: outputs 1 and 4 (the shop\'s router-on, 10-29)');
  assert.equal(card.state.outs & 1, 0, 'spindle off at the end');
}
{ // trace: never touches outputs, runs through the tool change
  const { m, card, outs, P } = await machine();
  const parsed = P.parse(sbp);
  const tr = P.traceProgram(parsed, 25.4, 't');
  m.exec({ ...tr, preview: false });
  await done(m);
  console.log('trace:', m.state.note, '| outputs history', [...new Set(outs)]);
  assert.equal(m.state.note, 'program finished');
  assert.ok(!outs.some(o => o & 1));
}
{ // pause mid-move, resume, finish where the file ends; then stop
  const { m, card, R } = await machine();
  const moves = [{ x0: 0, y0: 0, z0: 0, x: 200, y: 0, z: 0, feed: 76.2, line: 3 }, { x0: 200, y0: 0, z0: 0, x: 200, y: 50, z: 0, feed: 76.2, line: 4 }];
  // the stub answers at once, so slow the link down to give pause a chance
  const w = card.write;
  card.write = b => new Promise(r => setTimeout(() => r(w(b)), 3));
  m.exec({ name: 'p', moves, spindle: true });
  // 10-28: a job that starts low lifts, starts the router, comes back down, then cuts: pause in the cut
  await new Promise(r => { const t = setInterval(() => { if (m.state.pos.x > 5 && Math.abs(m.state.pos.z) < 0.05) { clearInterval(t); r(); } }, 5); });
  m.pause();
  await new Promise(r => { const t = setInterval(() => { if (m.state.paused) { clearInterval(t); r(); } }, 10); });
  const at = { ...m.state.pos };
  console.log('paused at', at, 'spindle', m.state.spindle, 'outputs', card.state.outs);
  assert.ok(at.x > 0 && at.x < 200 && at.y === 0);
  assert.equal(card.state.outs & 1, 0, 'spindle off while paused');
  await m.resume(R.arm(m.resumePlan()));
  await done(m);
  console.log('resumed:', m.state.note, m.state.pos);
  assert.equal(m.state.note, 'program finished');
  assert.ok(Math.abs(m.state.pos.x - 200) < 0.02 && Math.abs(m.state.pos.y - 50) < 0.02);
  m.exec({ name: 's', moves: [{ x0: 200, y0: 50, z0: 0, x: 0, y: 50, z: 0, feed: 76.2, line: 5 }], spindle: true });
  // it lifts, starts the router, comes down, then cuts: stop in the cut
  await new Promise(r => { const t = setInterval(() => { if (m.state.pos.x < 195 && Math.abs(m.state.pos.z) < 0.05) { clearInterval(t); r(); } }, 5); });
  m.stop();
  await done(m);
  console.log('stopped:', m.state.note, m.state.pos, 'outputs', card.state.outs);
  assert.equal(m.state.note, 'stopped');
  assert.ok(m.state.pos.x > 0 && m.state.pos.x < 200);
  assert.equal(card.state.outs & 1, 0);
}
{ // 10-28: the e-stop changing mid-job stops it, router off (10-29: the shop's is input 8, momentary)
  const { m, card } = await machine();
  const w = card.write;
  card.write = b => new Promise(r => setTimeout(() => r(w(b)), 3));
  m.exec({ name: 'rs', moves: [{ x0: 0, y0: 0, z0: 30, x: 300, y: 0, z: 30, feed: 76.2, line: 2 }], spindle: true });
  await new Promise(r => { const t = setInterval(() => { if (m.state.pos.x > 5) { clearInterval(t); r(); } }, 5); });
  card.state.inputs[0] ^= 0x80;                         // input 8 = bit 7: pressed for a tenth of a second
  setTimeout(() => { card.state.inputs[0] ^= 0x80; }, 100);   // and let go: a momentary button
  await done(m);
  console.log('e-stop:', m.state.note, m.state.pos.x.toFixed(1), 'outputs', card.state.outs);
  assert.match(m.state.note, /stopped by the e-stop \(input 8\)/);
  assert.ok(m.state.pos.x < 290);
  assert.equal(card.state.outs & 1, 0);
  // 10-29 (Phil): after the e-stop swarf lets go of the machine (outputs off first); connecting again clears it
  await new Promise(r => { const t = setInterval(() => { if (!m.state.connected) { clearInterval(t); r(); } }, 10); setTimeout(() => { clearInterval(t); r(); }, 3000); });
  assert.ok(!m.state.connected && m.state.estopped, `disconnected after the e-stop (${m.state.note})`);
  assert.ok(await m.connect(false), 'connects again');
  assert.ok(m.state.connected && !m.state.estopped && !m.state.routerUnknown, 'and the e-stop is cleared');
}
{ // a momentary e-stop during a jog: the jog stops, nothing moves again (the button let go), then swarf lets go
  const { m, card } = await machine();
  const w = card.write;
  card.write = b => new Promise(r => setTimeout(() => r(w(b)), 3));
  m.jog('x', 200);
  await new Promise(r => { const t = setInterval(() => { if (m.state.pos.x > 5) { clearInterval(t); r(); } }, 5); });
  card.state.inputs[0] ^= 0x80; setTimeout(() => { card.state.inputs[0] ^= 0x80; }, 100);
  await new Promise(r => { const t = setInterval(() => { if (!m.state.moving) { clearInterval(t); r(); } }, 10); });
  const at = m.state.pos.x;
  assert.ok(at < 190, `the jog stopped (${at.toFixed(1)})`);
  await new Promise(r => setTimeout(r, 150));
  m.jog('x', 10);                                       // the button is up again: still no move
  await new Promise(r => setTimeout(r, 200));
  assert.ok(Math.abs(m.state.pos.x - at) < 0.05, `no move after the stop (${m.state.pos.x.toFixed(2)} vs ${at.toFixed(2)})`);
  await new Promise(r => { const t = setInterval(() => { if (!m.state.connected) { clearInterval(t); r(); } }, 20); });
  assert.ok(m.state.estopped && card.state.outs % 2 === 0, `let go after a jog's e-stop (${m.state.note})`);
  console.log('e-stop in a jog:', m.state.note);
  const ok = await m.connect(false);
  console.log('reconnect after a jog e-stop:', ok, m.state.note, 'stub need', card.state.need, 'buf', card.state.buf.length);
  assert.ok(ok, `connects again after a jog's e-stop (${m.state.note})`);
}
{ // the router by hand (10-29): on, nothing moves, off; and the e-stop turns it off and lets go
  const { m, card } = await machine();
  m.cfg.routerWarnMs = 60;
  const cues = []; m.onCue = n => cues.push([n, card.state.outs & 1]);
  assert.ok(await m.routerTest(true));
  assert.deepEqual(cues[0], ['router', 0], 'the warning sounds while the router is still off');
  assert.equal(card.state.outs & 9, 9, 'router on: outputs 1 and 4');
  assert.ok(m.state.routerTest && m.busy(), 'busy while it runs');
  const x0 = m.state.pos.x; m.jog('x', 10); await new Promise(r => setTimeout(r, 150));
  assert.ok(Math.abs(m.state.pos.x - x0) < 1e-6, 'no jog while the router runs');
  assert.ok(await m.routerTest(false));
  assert.equal(card.state.outs & 1, 0, 'router off');
  assert.ok(!m.state.routerTest && !m.busy());
  assert.ok(await m.routerTest(true));
  card.state.inputs[0] ^= 0x80; setTimeout(() => { card.state.inputs[0] ^= 0x80; }, 150);
  await new Promise(r => { const t = setInterval(() => { if (!m.state.connected) { clearInterval(t); r(); } }, 10); setTimeout(() => { clearInterval(t); r(); }, 3000); });
  assert.ok(m.state.estopped && (card.state.outs & 1) === 0, `e-stop with the router on: off and let go (${m.state.note}, outputs ${card.state.outs})`);
  console.log('router test:', m.state.note);
}
{ // a slow jog choice never slows a program's rapids (10-27: they shared cfg.jog)
  const { m } = await machine();
  const shop = { ...m.cfg.rapid };
  m.cfg.jog = { xy: 250 / 60, z: 250 / 60 };          // the student picked 250 mm/min
  m.exec({ name: 'r', moves: [{ x0: 0, y0: 0, z0: 0, x: 0, y: 0, z: 20, rapid: true, line: 1 }, { x0: 0, y0: 0, z0: 20, x: 100, y: 0, z: 20, rapid: true, line: 2 }], spindle: false });
  const feeds = m.job.ops.filter(o => o.work).map(o => o.feed);
  await done(m);
  console.log('rapids at', feeds, 'shop', shop);
  // 10-28: a first rapid is the entry's own (up, over), at the shop's speeds too; the rest are the file's
  assert.ok(feeds.every(f => f === shop.xy || f === shop.z), `rapids at the shop speeds (${JSON.stringify(feeds)})`);   // arrays from the vm context
}
{ // continue from line N (review 10-27): up first, over, router on, down; the original
  // file's events keep their places (a later tool change still holds at its own line)
  const { m, P } = await machine();
  const text = ["SA", "C6", "J3,0,0,5", "M3,0,0,-2", "M3,30,0,-2", "M3,30,30,-2", "M3,0,30,-2", "C9", "M3,0,0,-2", "J3,0,0,5", "C7", "END"].join('\n');
  const parsed = P.parse(text);
  m.zero('xyz');
  m.state.pos = { x: 30, y: 0, z: -2 };      // the bit is down in the cut (after a drop, say)
  const fr = P.fromLineProgram(parsed, 6, 25.4, 't');
  m.exec({ ...fr, spindle: true });
  const ops = m.job.ops, u = m.cfg.unit;
  const z = o => o.z, kinds = ops.map(o => o.out !== undefined ? (o.out & 1 ? 'ON' : 'off') : o.dwell !== undefined ? 'wait' : o.hold ? 'HOLD' : `move z${(o.z).toFixed(1)}`);
  console.log('continue ops:', kinds.slice(0, 7).join(' | '));
  const firstOn = ops.findIndex(o => o.out !== undefined && (o.out & 1));
  assert.ok(Math.abs(ops[0].z - 25.4) < 0.01 && Math.abs(ops[0].x - 30) < 0.01, 'first: straight up where the bit is');
  assert.ok(firstOn > 0 && ops.slice(0, firstOn).every(o => o.out !== undefined || o.dwell !== undefined || o.z >= 25.39), 'router on only up at safe Z');
  assert.ok(ops.slice(firstOn).some(o => o.work && o.z < 0), 'then down into the cut');
  assert.equal(m.holdAt && m.holdAt.line, 8, 'the C9 on line 8 still holds');
  await done(m);
}
{ // pause inside an arc (one line, many moves): the rest starts at the move it was in
  const { m, card } = await machine();
  card.state.realtime = true;
  const mv = [];
  let px = 0, py = 0;
  for (let i = 1; i <= 40; i++) { const a = i / 40 * Math.PI, x = 50 - 50 * Math.cos(a), y = 50 * Math.sin(a); mv.push({ x0: px, y0: py, z0: 0, x, y, z: 0, feed: 20, line: 7 }); px = x; py = y; }
  m.zero('xyz');
  m.exec({ name: 'arc', moves: mv, spindle: false });
  // 10-28: every run lifts and comes back down first; pause once the bit is in the arc
  await new Promise(r => { const t = setInterval(() => { if (m.state.pos.x > 8 && Math.abs(m.state.pos.z) < 0.05) { clearInterval(t); r(); } }, 20); });
  m.pause();
  await new Promise(r => { const t = setInterval(() => { if (m.state.paused) { clearInterval(t); r(); } }, 20); });
  const first = m.job.rest[0], at = m.job.haltAt;
  const k = m.job.ops.indexOf(first);
  console.log(`paused in the arc at op ${k} of ${m.job.ops.length}, bit at`, at);
  assert.ok(k > 1, 'resumes from the move it was in, not the line\'s first');
  const tgt = { x: first.x, y: first.y }, d = Math.hypot(tgt.x - at.x, tgt.y - at.y);
  assert.ok(d < 50 * Math.PI / 40 + 0.5, `next target is the end of that move (${d.toFixed(2)} mm away)`);
  m.stop(); await done(m);
}
console.log('direct stub: ok');
process.exit(0);
