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
  for (const f of ['swarf-run-parse.js', 'swarf-run-machine.js', 'swarf-shopbot-usb.js', 'swarf-shopbot-card.js', 'swarf-shopbot-direct.js'])
    vm.runInContext(fs.readFileSync(new URL(`../../web/kiri/${f}`, import.meta.url), 'utf8'), win, { filename: f });
  const m = new win.SwarfRunMachine.DirectMachine({ spinUp: 0.02 });
  assert.ok(await m.connect(false));
  const outs = [];
  const w = card.write;
  card.write = b => { const r = w(b); outs.push(card.state.p7); return r; };
  return { m, card, outs, P: win.SwarfRunParse };
}
const done = m => new Promise(r => { const t = setInterval(() => { if (!m.state.running) { clearInterval(t); r(); } }, 20); });

const sbp = ["SA", "C9", "C6", "PAUSE 0.05", "J3,0,0,5", "M3,10,0,-1", "M3,10,10,-1", "C9", "M3,0,10,-1", "J3,0,0,5", "C7", "END"].join('\n');
{ // cut: tool change at line 8 ends the job after line 7
  const { m, card, outs, P } = await machine();
  const parsed = P.parse(sbp);
  m.zero('xyz');
  m.run({ name: 't', moves: parsed.moves, sbp, spindle: true });
  await done(m);
  console.log('cut:', m.state.note, '| pos', m.state.pos, '| P7 history', [...new Set(outs)]);
  assert.equal(m.state.resumeLine, 9);
  assert.ok(m.state.stopHit);
  assert.match(m.state.note, /tool change at line 8/);
  assert.ok(Math.abs(m.state.pos.x - 10) < 0.02 && Math.abs(m.state.pos.y - 10) < 0.02, 'stopped over the last cut point');
  assert.ok(Math.abs(m.state.pos.z - 25.4) < 0.02, 'Z up at safe height');
  assert.ok(outs.includes(1), 'spindle went on');
  assert.equal(card.state.p7 & 1, 0, 'spindle off at the end');
}
{ // trace: never touches outputs, runs through the tool change
  const { m, card, outs, P } = await machine();
  const parsed = P.parse(sbp);
  const tr = P.traceProgram(parsed, 25.4, 't');
  m.run({ ...tr, preview: false });
  await done(m);
  console.log('trace:', m.state.note, '| P7 history', [...new Set(outs)]);
  assert.equal(m.state.note, 'program finished');
  assert.ok(!outs.includes(1));
}
{ // pause mid-move, resume, finish where the file ends; then stop
  const { m, card } = await machine();
  const moves = [{ x0: 0, y0: 0, z0: 0, x: 200, y: 0, z: 0, feed: 76.2, line: 3 }, { x0: 200, y0: 0, z0: 0, x: 200, y: 50, z: 0, feed: 76.2, line: 4 }];
  // the stub answers at once, so slow the link down to give pause a chance
  const w = card.write;
  card.write = b => new Promise(r => setTimeout(() => r(w(b)), 3));
  m.run({ name: 'p', moves, spindle: true });
  await new Promise(r => setTimeout(r, 120));
  m.pause();
  await new Promise(r => { const t = setInterval(() => { if (m.state.paused) { clearInterval(t); r(); } }, 10); });
  const at = { ...m.state.pos };
  console.log('paused at', at, 'spindle', m.state.spindle, 'P7', card.state.p7);
  assert.ok(at.x > 0 && at.x < 200 && at.y === 0);
  assert.equal(card.state.p7 & 1, 0, 'spindle off while paused');
  m.resume();
  await done(m);
  console.log('resumed:', m.state.note, m.state.pos);
  assert.equal(m.state.note, 'program finished');
  assert.ok(Math.abs(m.state.pos.x - 200) < 0.02 && Math.abs(m.state.pos.y - 50) < 0.02);
  m.run({ name: 's', moves: [{ x0: 200, y0: 50, z0: 0, x: 0, y: 50, z: 0, feed: 76.2, line: 5 }], spindle: true });
  await new Promise(r => setTimeout(r, 100));
  m.stop();
  await done(m);
  console.log('stopped:', m.state.note, m.state.pos, 'P7', card.state.p7);
  assert.equal(m.state.note, 'stopped');
  assert.ok(m.state.pos.x > 0 && m.state.pos.x < 200);
  assert.equal(card.state.p7 & 1, 0);
}
console.log('direct stub: ok');
process.exit(0);
