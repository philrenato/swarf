// The r093 code review's control bugs, as regression tests (no USB, no browser):
//   A6  a poll already waiting on the card when the link is lost, or the poll restarted, stops there
//   A7  a USB write that throws takes its reply wait with it: the next command says the real cause
//   A18 saved settings read back broken take their defaults (a corrupt origin made every jog NaN);
//       good saved settings come back exactly as they were
//   node tools/shopbot/test-r093-control.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const DIR = process.env.KIRI_DIR || new URL('../../web/kiri/', import.meta.url).pathname;
const FILES = ['swarf-run-parse.js', 'swarf-run-plan.js', 'swarf-run-machine.js', 'swarf-shopbot-usb.js', 'swarf-shopbot-card.js', 'swarf-shopbot-direct.js'];
function context(saved = {}) {
  const store = { ...saved };
  const win = { navigator: { usb: {} }, setTimeout, clearTimeout, setInterval, clearInterval, console, performance,
    requestAnimationFrame: f => setTimeout(() => f(performance.now()), 16),
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
  win.window = win;
  vm.createContext(win);
  for (const f of FILES) vm.runInContext(fs.readFileSync(DIR + f, 'utf8'), win, { filename: f });
  return win;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const unhandled = [];
process.on('unhandledRejection', e => unhandled.push(e));

// A18 ------------------------------------------------------------------------------------
{ // broken: an origin axis that is an object, a string, a null; a flip that is a word; a home
  // sensor with a string input; a plate that searches 9999 mm with a negative thickness
  const W = context({
    'swarf-shopbot-origin': JSON.stringify({ x: {}, y: 'abc', z: null }),
    'swarf-shopbot-flip': JSON.stringify({ x: 'false', y: true }),
    'swarf-shopbot-home': JSON.stringify({ x: { input: '2', hit: 0 }, y: { input: 3, hit: 0 }, set: { x: true, y: true }, confirmed: true }),
    'swarf-shopbot-plate': JSON.stringify({ input: 1, hit: 1, confirmed: true, thickness: -1, travel: 9999 })
  });
  const m = new W.SwarfRunMachine.DirectMachine();
  for (const a of ['x', 'y', 'z']) assert.ok(Number.isFinite(m.origin[a]), `origin ${a} finite (${m.origin[a]})`);
  assert.equal(m.originRepaired, true, 'a repaired origin is said, so control retires its zero');
  const p = m.work({ x: 1000, y: 2000, z: 3000 });
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), 'positions are numbers');
  assert.equal(m.flip.x, false, 'a flip that is a word is not on');
  assert.equal(m.flip.y, true);
  assert.equal(m.homeCfg.x.input, 2, 'a sensor not read back takes the default');
  assert.equal(m.homeCfg.confirmed, false, '...and home asks for it again');
  assert.equal(m.plateCfg.travel, 60);
  assert.equal(m.plateCfg.thickness, 3.0734);
  assert.equal(m.plateCfg.confirmed, true, 'the plate input itself was fine');
  console.log('A18 broken saved settings: defaults, origin repaired and said');
}
{ // good: everything comes back as saved, and nothing is said repaired
  const home = { x: { input: 4, hit: 1 }, y: { input: 5, hit: 0 }, set: { x: true, y: true }, confirmed: true };
  const W = context({
    'swarf-shopbot-origin': JSON.stringify({ x: 12345, y: -678, z: 91011 }),
    'swarf-shopbot-flip': JSON.stringify({ x: false, y: true, z: false }),
    'swarf-shopbot-home': JSON.stringify(home),
    'swarf-shopbot-plate': JSON.stringify({ input: 2, hit: 0, confirmed: true, thickness: 3.2, travel: 80 })
  });
  const m = new W.SwarfRunMachine.DirectMachine();
  assert.deepEqual({ ...m.origin }, { x: 12345, y: -678, z: 91011 });
  assert.deepEqual({ ...m.flip }, { x: false, y: true, z: false });
  assert.ok(!m.originRepaired);
  assert.deepEqual(JSON.parse(JSON.stringify({ x: m.homeCfg.x, y: m.homeCfg.y, set: m.homeCfg.set, confirmed: m.homeCfg.confirmed })), home);
  assert.equal(m.homeCfg.fast, 88.9);
  const P = m.plateCfg;
  assert.deepEqual([P.input, P.hit, P.confirmed, P.thickness, P.travel], [2, 0, true, 3.2, 80]);
  const fresh = new (context().SwarfRunMachine.DirectMachine)();
  assert.ok(!fresh.originRepaired, 'nothing saved is not a repair');
  console.log('A18 good saved settings: kept exactly');
}

// A7 -------------------------------------------------------------------------------------
{
  const W = context();
  const { ShopBotCard } = W.ShopBotCard;
  assert.ok(ShopBotCard, 'ShopBotCard loaded');
  let fail = true;
  const link = { write: async b => { if (fail) throw new Error('USB: the box is gone'); setTimeout(() => link.onData(new Uint8Array(50)), 5); } };
  const card = new ShopBotCard(link, { timeoutMs: 60 });
  await assert.rejects(card.cmd([0xE0, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]), /the box is gone/);
  assert.equal(card.want, null, 'no reply left waiting');
  fail = false;
  const r = await card.cmd([0xE0, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
  assert.equal(r.length, 50, 'the next command is answered, not "a reply is already pending"');
  await wait(120);      // past the old wait's timeout
  assert.deepEqual(unhandled, [], `no unhandled rejection (${unhandled.map(e => e && e.message)})`);
  console.log('A7 a failed write: its own error, the next command answered, nothing unhandled');
}

// A6 -------------------------------------------------------------------------------------
{
  const W = context();
  const m = new W.SwarfRunMachine.DirectMachine();
  let calls = 0, inflight = false;
  m.card = { streaming: false, status: async () => { calls++; inflight = true; await wait(60); inflight = false; return { steps: { x: 0, y: 0, z: 0 }, inputs: 0x0F, inputs2: 0 }; } };
  m.link = { close: async () => {} };
  m.poll();
  while (!calls) await wait(5);
  m.poll();                     // restarted while the first loop waits on the card (routerTest does this)
  const c0 = calls;
  await wait(2000);
  const rate = calls - c0;      // one loop: about 2000 / 460 = 4; two stacked loops: 8 or more
  assert.ok(rate <= 6, `one loop after a restart (${rate} reads in 2 s)`);
  while (!inflight) await wait(2);
  m.lost();                     // the link drops while a read is in flight
  const c1 = calls;
  await wait(1200);
  assert.equal(calls, c1, `no read after the link was lost (${calls - c1} more)`);
  console.log(`A6 poll: one loop after a restart (${rate} reads in 2 s), none after the link was lost`);
}
assert.deepEqual(unhandled, []);
console.log('r093 control: ok');
process.exit(0);
