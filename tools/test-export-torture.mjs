// Cut file torture: random jobs (several bits, odd feeds and spindle speeds, plunges, rapids, dwells,
// arcs, a work zero off the corner, the top or the table as Z 0, saved files with odd values) written by
// cam's own export for the ShopBot and the MR-1, then read back by control's reader:
//   every line reads (nothing swarf can't carry out), millimeters, no NaN; the same job makes the same file
//   the moves read back are the job's moves, in order, at the decimals written
//   every feed move carries a feed above zero, the job's feed (held to the fast-feed limits); no plunge at
//   rapid speed into the board; the router on before any cut, at the bit's speed
//   the file ends lifted clear and the router off
// and then the way control runs it, from the reader's moves:
//   a plan enters from wherever the bit is: up to safe Z, over, slowly down; the router on before the
//   bit goes below the top
//   cut from line N: up first, over at that height, the router on at the speed in force at line N,
//   slowly down to where line N starts; never a rapid down into the board
//   a resume after a pause (the ShopBot): up where it stopped, the router on up there, slowly back down
//   node tools/test-export-torture.mjs [jobs=600] [seed=1]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.THREE = await import(join(ROOT, 'node_modules/three/build/three.module.js'));
await import(join(ROOT, 'src/add/array.js'));
const { cam_export } = await import(join(ROOT, 'src/kiri/mode/cam/work/export.js'));
const P = require('../web/kiri/swarf-run-parse.js');
globalThis.SwarfRunParse = P;
const R = require('../web/kiri/swarf-run-plan.js');

const N = +(process.argv[2] || 600), SEED = +(process.argv[3] || 1);
const t0 = Date.now();
let pass = 0, fail = 0;
const seen = { files: 0, plans: 0, fromLine: 0, resumes: 0 };
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } return c; };
let rs = SEED >>> 0 || 1;
const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + (b - a) * rnd();

const DEV = {
  shopbot: JSON.parse(readFileSync(join(ROOT, 'src/kiri/dev/cam/ShopBot.Basic.json'), 'utf8')),
  mr1: JSON.parse(readFileSync(join(ROOT, 'src/kiri/dev/cam/Langmuir.MR-1.json'), 'utf8')),
};
// the shop's bits, as cam keeps them
const BITS = [
  { id: 1000, number: 21, name: '1/4 in flat end mill', flute_diam: 0.25, flute_len: 1, metric: false },
  { id: 1001, number: 22, name: '1/8 in "flat" end mill', flute_diam: 0.125, flute_len: 0.5, metric: false },
  { id: 1105, number: 26, name: '90° V-bit', flute_diam: 0.5, flute_len: 0.5, metric: false },
  { id: 7, number: 3, name: 'Fräser 6 mm', flute_diam: 6, flute_len: 20, metric: true },
];
const toolOf = (b) => ({ getID: () => b.id, getNumber: () => b.number, getName: () => b.name, tool: b });

// cam's macro text: {expression} in the device's lines, worked out over the constants
function constReplace(str, consts) {
  return String(str).replace(/\{([^{}]+)\}/g, (all, tok) => {
    try { return String(new Function(...Object.keys(consts), `return (${tok});`)(...Object.values(consts))); }
    catch { return all; }
  });
}

// a random job: ops, each with a bit and a spindle speed, its layers of rapids and cuts at safe Z
// Z as cam hands it to the export: 0 at the board's top (top), else 0 on the table
function randomJob(dev, top) {
  const D = DEV[dev], stockZ = pick([19.05, 12, 6, 3.2, 40]), zTop = top ? 0 : stockZ;
  const safe = zTop + pick([5, 2.54, 10]);
  const ops = [], layers = [];
  const nOps = 1 + Math.floor(rnd() * 3);
  const want = [];   // the points as cam made them (work frame)
  for (let o = 0; o < nOps; o++) {
    const bit = toolOf(pick(BITS)), mode = { type: pick(['outline', 'rough', 'pocket', 'contour', 'texture']), _swarfStep: 's' + o };
    const spindle = pick([18000, 12000, 8000, 21000, 0, undefined, 30000, 250]);
    const feed = pick([1500, 2540, 600, 15240, 50, 0.5, 9000]), plunge = pick([300, 600, 50, 2540]);
    ops.push({ mode, bit, spindle, feed, plunge });
    const nLayers = 1 + Math.floor(rnd() * 4);
    let x = between(0, 120), y = between(0, 80);
    for (let l = 0; l < nLayers; l++) {
      const L = []; L.mode = mode; L.spindle = spindle;
      const push = (p, emit, speed, extra = {}) => { L.push({ point: p, emit, speed, tool: bit, ...extra }); if (p) want.push({ ...p }); };
      // over at safe Z, down at the plunge feed, cut a run, up
      push({ x, y, z: safe }, 0, 0);
      const zc = zTop - between(0.1, stockZ + 0.3);
      push({ x, y, z: zTop + 1 }, 0, 0);
      push({ x, y, z: zc }, 1, plunge);
      const n = 2 + Math.floor(rnd() * 12);
      for (let i = 0; i < n; i++) {
        const k = rnd();
        if (k < 0.08) { L.push({ point: null, emit: 0, speed: pick([500, 2000]), tool: bit }); continue; }   // a dwell (ms)
        x = Math.max(0, Math.min(150, x + between(-20, 20))); y = Math.max(0, Math.min(100, y + between(-20, 20)));
        const z = k < 0.2 ? zc - between(0, 1) : zc;
        if (k > 0.94) {
          // an arc: the centre half way, the end on its circle
          const last = L[L.length - 1].point || want[want.length - 1], cx = (last.x + x) / 2, cy = (last.y + y) / 2;
          push({ x, y, z: last.z }, pick([2, 3]), feed, { center: { x: cx - last.x, y: cy - last.y } });
        } else push({ x, y, z }, 1, feed);
      }
      push({ x, y, z: safe }, 0, 0);
      layers.push(L);
    }
  }
  return { dev, D, stockZ, safe, layers, want, ops };
}

function exportJob(job, proc) {
  const out = [], events = [];
  const print = {
    widgets: [{}],
    settings: { device: JSON.parse(JSON.stringify(job.D)), process: proc, stock: { x: 200, y: 150, z: job.stockZ }, origin: job.origin || { x: 0, y: 0, z: 0 }, filter: { CAM: job.D.deviceName }, mode: 'CAM' },
    output: job.layers,
    constReplace,
  };
  cam_export(print, (o) => { if (typeof o === 'string') out.push(o); else events.push(o); });
  return { text: out.filter(Boolean).join('\r\n'), events, time: print.time };
}

const near = (a, b, t = 0.0011) => Math.abs(a - b) <= t;

for (let n = 0; n < N; n++) {
  const dev = pick(['shopbot', 'mr1']);
  const proc = {
    camFastFeed: pick([6000, 6000, 15240, 0, undefined, 500]),
    camFastFeedZ: pick([300, 300, 2540, 0, undefined]),
    camFirstZMax: pick([true, true, false]),
    camOriginTop: pick([true, true, false]),
    camToolInit: pick([true, false]),
  };
  const job = randomJob(dev, proc.camOriginTop);
  const name = `job#${n} ${dev} ${job.ops.map((o) => `${o.mode.type}/${o.bit.getName()}/S${o.spindle}/F${o.feed}`).join(' + ')} ${JSON.stringify(proc)}`;
  let r, r2;
  try { r = exportJob(job, proc); r2 = exportJob(job, proc); }
  catch (e) { ok(false, `${name}: export threw ${e.message}`); continue; }
  ok(r.text === r2.text, `${name}: the same job writes the same file`);
  ok(!/NaN|undefined|Infinity|null/.test(r.text), `${name}: no NaN or undefined in the file ${(r.text.match(/.*(NaN|undefined|Infinity|null).*/) || [''])[0]}`);
  ok(!/[^\x09\x0a\x0d\x20-\x7e]/.test(r.text), `${name}: the file is plain ASCII ${(r.text.match(/.*[^\x09\x0a\x0d\x20-\x7e].*/) || [''])[0]}`);
  if (process.env.SHOW && +process.env.SHOW === n) { console.log(r.text); console.log(JSON.stringify(job.want)); }
  const p = P.parse(r.text, { machineUnits: 'mm' });
  seen.files++;
  // no fast feed set (a saved file's 0): cam writes its moves with no feed, and control refuses the file
  // for it rather than run a move at a speed nobody chose
  if (!(proc.camFastFeed > 0)) { ok(p.unsupported.every((u) => /no feed rate/.test(u.why || '')), `${name}: with no fast feed, only feedless lines are refused ${JSON.stringify(p.unsupported.slice(0, 2))}`); continue; }
  ok(p.units === 'mm' && !p.unitsGuessed, `${name}: the file says millimeters (${p.units})`);
  ok(!p.unsupported.length, `${name}: every line reads ${JSON.stringify(p.unsupported.slice(0, 2))}`);
  // the moves read back are the job's, in order (Z from the top when the top is zero)
  // a point cam made twice in a row (a layer that starts where the last ended) reads once
  const want = job.want.filter((q, i, a) => !i || !(near(q.x, a[i - 1].x) && near(q.y, a[i - 1].y) && near(q.z, a[i - 1].z)));
  let w = 0, extra = [];
  for (const m of p.moves) {
    if (w < want.length && near(m.x, want[w].x) && near(m.y, want[w].y) && near(m.z, want[w].z)) { w++; continue; }
    // an arc's chords end on the way; the way in after a bit change goes over, then down
    if (m.line && /^G[23]\b/.test(r.text.split(/\r\n/)[m.line - 1] || '')) continue;
    extra.push(m);
  }
  ok(w === want.length, `${name}: the file's moves are the job's moves (${w} of ${want.length} found, first missing ${JSON.stringify(want[w])})`);
  // the extras: the way in to each bit (over at its height, then down) and the lift at the end
  const lift = extra.filter((m) => !(m.rapid && (Math.hypot(m.x - m.x0, m.y - m.y0) < 1e-6 || Math.abs(m.z - m.z0) < 1e-6)));
  ok(lift.length === 0, `${name}: nothing but the way in and the lift added ${JSON.stringify(lift.slice(0, 2))}`);
  // feeds: every cut has one above zero; no plunge at rapid speed into the board
  const zTop = proc.camOriginTop ? 0 : job.stockZ;
  // (the first move starts where the reader supposes the bit is, which nobody knows: control goes up first)
  ok(!P.rapidAcross({ moves: p.moves.slice(1).map((m) => ({ ...m, z: m.z - zTop, z0: m.z0 - zTop })) }), `${name}: no rapid sideways in the board`);
  const dive = p.moves.find((m) => m.rapid && m.z < m.z0 - 1e-6 && m.z < zTop - 0.05);
  ok(!dive, `${name}: no rapid down into the board ${JSON.stringify(dive)}`);
  const maxXY = proc.camFastFeed || Infinity, maxZ = proc.camFastFeedZ || Infinity;
  let slow = null, fast = null;
  for (const m of p.moves) {
    if (m.rapid) continue;
    if (!(m.feed > 0)) { slow = m; break; }
    const L = Math.hypot(m.x - m.x0, m.y - m.y0, m.z - m.z0), down = m.z0 - m.z;
    let lim = maxXY;
    if (down > 1e-9 && L > 0 && proc.camFastFeedZ) lim = Math.min(lim, maxZ * L / down);
    if (m.feed * 60 > lim * 1.002 + 0.01) { fast = { m, lim }; break; }
  }
  ok(!slow, `${name}: every cut has a feed above zero ${JSON.stringify(slow)}`);
  ok(!fast, `${name}: no cut faster than the fast-feed limits ${JSON.stringify(fast)}`);
  // the router: on before any cut below the top, at the bit's speed
  const off = P.routerOffCut({ ...p, moves: p.moves.map((m) => ({ ...m, z: m.z - zTop, z0: m.z0 - zTop })) });
  const anySpeed = job.ops.some((o) => o.spindle);
  if (anySpeed) ok(!off, `${name}: the router is on whenever the bit is in the board ${JSON.stringify(off)}`);
  const rpms = p.events.filter((e) => e.kind === 'rpm').map((e) => e.value);
  const bad = rpms.find((v) => !(v >= 0) || !Number.isFinite(v));
  ok(bad === undefined, `${name}: every spindle speed a number of 0 or more (${rpms.join(',')})`);
  for (const o of job.ops) if (o.spindle > 0) ok(rpms.includes(o.spindle), `${name}: the ${o.mode.type} step's speed ${o.spindle} is in the file (${rpms.join(',')})`);
  // the end: router off and lifted clear of the board
  const last = p.moves[p.moves.length - 1];
  ok(last && last.z >= zTop + 9.99, `${name}: ends lifted clear (${last && last.z.toFixed(2)})`);
  const offs = p.events.filter((e) => e.kind === 'spindle-off');
  const lastCut = p.moves.filter((m) => !m.rapid && Math.min(m.z, m.z0) < zTop).pop();
  ok(offs.length && (!lastCut || offs[offs.length - 1].line > lastCut.line), `${name}: the router goes off after the last cut`);
  // MR-1: one file per bit, never a bit change inside
  if (dev === 'mr1') ok(!/^M0?6\b/m.test(r.text), `${name}: no bit change inside an MR-1 file`);

  // ---- control: plans from the moves ----
  // a file zeroed on the table is refused by control's own check (validate): no plan of it runs
  if (!proceedPlan(p)) continue;
  if (zTop > 0) { if (p.moves.every((m) => m.rapid || m.z > -0.01)) ok(R.validate(p).some((v) => v.k === 'table-zero'), `${name}: a file zeroed on the table is refused`); continue; }
  const S = 25, cfg = { safeZ: S + zTop, rapid: { xy: 100, z: 50 }, move: { xy: 100, z: 50 }, jog: { z: 50 }, spinUp: 2, changeZ: 50, spindleSpeed: dev === 'mr1' };
  // a file zeroed on the board's top runs; one zeroed on the table is refused by its own check
  const pos = { x: between(-5, 150), y: between(-5, 100), z: zTop + between(-3, 30) };
  const prog = { name: 'job', moves: p.moves, events: p.events, source: p, spindle: true, cut: true };
  const plan = R.build(prog, { pos, live: true, cfg });
  entryCheck(name, plan, pos, cfg, zTop, 'the whole file');
  // cut from a random line with moves after it
  const lines = [...new Set(p.moves.map((m) => m.line))];
  const N0 = pick(lines);
  const fl = P.fromLineProgram(p, N0, cfg.safeZ, 'job');
  if (fl) {
    const at = { x: between(0, 150), y: between(0, 100), z: zTop - between(0, 3) };
    const fp = R.build({ ...fl, source: p }, { pos: at, live: true, cfg });
    entryCheck(`${name} from line ${N0}`, fp, at, cfg, zTop, `line ${N0}`);
    // the router comes on at the speed the file had at line N
    const want = p.events.filter((e) => e.kind === 'rpm' && e.line < N0).pop();
    const on = fp.steps.find((s) => s.router === true);
    if (want && on) ok(on.rpm === want.value, `${name} from line ${N0}: the router comes on at the speed in force there (${on.rpm} vs ${want.value})`);
    // the file control writes for it reads back the same way in (ShopBot)
    const again = P.parse(fl.sbp, { machineUnits: 'mm' });
    ok(!again.unsupported.length, `${name} from line ${N0}: its file reads ${JSON.stringify(again.unsupported.slice(0, 2))}`);
    const adive = again.moves.find((m) => m.rapid && m.z < m.z0 - 1e-6 && m.z < zTop - 0.05);
    ok(!adive, `${name} from line ${N0}: its file never rapids down into the board ${JSON.stringify(adive)}`);
  }
  // a pause partway along a program move, then resume (the ShopBot's way)
  const ks = plan.steps.map((s, i) => (s.move && s.phase === 'program' ? i : -1)).filter((i) => i > 0);
  if (ks.length) {
    const k = pick(ks), s = plan.steps[k];
    const prev = plan.steps.slice(0, k).reverse().find((q) => q.move);
    const a = prev ? prev.move : pos, t = rnd();
    const at = { x: a.x + (s.move.x - a.x) * t, y: a.y + (s.move.y - a.y) * t, z: a.z + (s.move.z - a.z) * t };
    const rp = R.resumeFrom(plan, k, at, cfg);
    resumeCheck(`${name} resume at step ${k}`, rp, plan, k, at, cfg, zTop);
  }
}

function proceedPlan(p) { return p.moves.length > 0 && !p.unsupported.length; }

// the way in of a plan: nothing goes below the top before the router is on; the first move from the
// bit's place is up (or over, already high); a move down to the work is slow
function entryCheck(name, plan, pos, cfg, zTop, what) {
  seen[what === 'the whole file' ? 'plans' : 'fromLine']++;
  let router = false, from = pos, bad = null;
  for (const s of plan.steps) {
    if (s.router !== undefined) router = s.router;
    if (!s.move) continue;
    const m = s.move, sideways = Math.hypot(m.x - from.x, m.y - from.y) > 1e-6;
    if (s.phase === 'entry') {
      if (sideways && Math.min(m.z, from.z) < cfg.safeZ - 1e-6 && Math.min(m.z, from.z) < zTop + 0.5) { bad = { why: 'over below safe Z', s, from }; break; }
      if (m.z < from.z - 1e-6 && s.feed > 10 + 1e-9) { bad = { why: 'down fast', s }; break; }
    }
    if (m.z < zTop - 0.05 && !router && !(s.work && s.work.rapid)) { bad = { why: 'in the board, router off', s }; break; }
    if (s.work && s.work.rapid && m.z < from.z - 1e-6 && m.z < zTop - 0.05) { bad = { why: 'rapid down into the board', s }; break; }
    from = m;
  }
  ok(!bad, `${name}: ${what}: the way in is up, over, slowly down, the router on before the board ${JSON.stringify(bad)}`);
}
function resumeCheck(name, rp, plan, k, at, cfg, zTop) {
  seen.resumes++;
  let router = false, from = at, bad = null, i = 0;
  for (const s of rp.steps) {
    if (s.router !== undefined) router = s.router;
    if (s.move) {
      const m = s.move, sideways = Math.hypot(m.x - from.x, m.y - from.y) > 1e-6;
      if (i === 0 && at.z < zTop - 0.05 && !(m.z >= cfg.safeZ - 1e-6 && !sideways)) { bad = { why: 'first move is not straight up', s }; break; }
      if (s.phase === 'entry' && m.z < from.z - 1e-6 && s.feed > 10 + 1e-9) { bad = { why: 'down fast', s }; break; }
      if (m.z < zTop - 0.05 && !router) { bad = { why: 'in the board, router off', s }; break; }
      from = m; i++;
    }
  }
  ok(!bad, `${name}: up where it stopped, the router on, slowly down ${JSON.stringify(bad)}`);
  ok(rp.steps.slice(-(plan.steps.length - k)).every((s, j) => s === plan.steps[k + j] || JSON.stringify(s) === JSON.stringify(plan.steps[k + j])), `${name}: then the rest of the plan from where it stopped`);
}

console.log(`\nexport torture: ${N} jobs (${JSON.stringify(seen)}), ${pass} checks passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s, seed ${SEED})`);
process.exit(fail ? 1 : 0);
