/*
 * swarf run plan — one job plan for every way a program runs (design review 10-28: "source
 * file → strict parse → immutable job plan → validation → operator authorization →
 * execution"). The plan holds every move the machine will make, the entry and the exits
 * included, and every output switch, dwell and hold, in work millimeters. The preview draws
 * it, the simulator plays it and the ShopBot driver sends it; nothing adds a move afterwards.
 *
 *   const plan = SwarfRunPlan.build(prog, { pos, live, cfg })
 *     prog   { name, moves, events?, sbp?, spindle, kind }   (a program from swarf-run-parse)
 *     pos    where the bit is now (work mm)
 *     live   the router may run (a cut or a continue)
 *     cfg    { safeZ, rapid: {xy, z}, move: {xy, z}, jog: {z}, spinUp, changeZ, unit, tickHz }
 *   plan.steps      [{ move: {x, y, z}, feed, line, work?, phase }, { router: true|false, line },
 *                    { out: n, on, line }, { dwell: s, line }]   in order
 *   plan.hold       the tool change or pause that ends it early, or null
 *   plan.moves      the moves as segments (x0..z) for the preview
 *   plan.problems   why it must not run ([] when it may)
 *   plan.armed      set by the student's checklist; the driver refuses a plan that needs it and lacks it
 *   plan.id         a fingerprint of everything it does: arming one plan never arms another
 *   plan.ctx        what it was made for (the machine's zero and link); a plan for another zero will not run
 *
 * Third review 10-28: the file behind the moves (prog.source, or prog.sbp read again) is checked
 * here too, so a line the reader refused stops the plan whoever calls it; a plan is frozen all the
 * way down and checks its own fingerprint before it runs (verify); a resume after a pause is a
 * plan of its own (resumeFrom); the card's slowest step is counted in whole steps (segProblem),
 * and jogs and seeks use the same check.
 */
(function (root) {
  'use strict';
  (typeof window !== 'undefined' ? window : globalThis).SWARF_BUILDS = Object.assign((typeof window !== 'undefined' ? window : globalThis).SWARF_BUILDS || {}, { 'swarf-run-plan.js': '__SWARF_BUILD__' });

  function build(prog, { pos, live, cfg, ctx }) {
    const P = root.SwarfRunParse;
    const S = cfg.safeZ;
    const steps = [], problems = [];
    // the file these moves came from, checked here as well as on the page (third review #2)
    const src = prog.source || (prog.sbp && P ? P.parse(prog.sbp, { machineUnits: 'mm' }) : null);
    if (!src) problems.push('there is no checked file behind these moves');
    else for (const v of validate(src)) problems.push(v.text);
    // the events are the program's own (a trace or an air cut writes its own file); the source is only checked
    const events = (prog.events || (prog.sbp && P ? (prog.source ? P.parse(prog.sbp, { machineUnits: 'mm' }) : src).events : src ? src.events : [])).slice().sort((a, b) => a.line - b.line);
    let router = false, e = 0, moved = false, hold = null;
    const say = (on, line) => { if (on !== router) { router = on; steps.push({ router: on, line: line || 0 }); if (on) steps.push({ dwell: cfg.spinUp, line: line || 0 }); } };
    const move = (t, feed, line, phase, work) => steps.push({ move: { x: t.x, y: t.y, z: t.z }, feed, line: line || 0, phase, ...(work ? { work } : {}) });
    const event = ev => {
      const k = ev.kind;
      if (live && k === 'spindle-on') say(true, ev.line);
      else if (live && k === 'spindle-off') say(false, ev.line);
      else if (live && k === 'output' && ev.value[0] === 1) say(ev.value[1] === 1, ev.line);
      else if (live && k === 'output' && ev.value[0] >= 2 && ev.value[0] <= 12) steps.push({ out: ev.value[0], on: ev.value[1] === 1, line: ev.line });
      else if (k === 'pause' && ev.value > 0) steps.push({ dwell: ev.value, line: ev.line });
      else if (moved && !hold && (k === 'tool-change' || k === 'pause' || k === 'zero-z' || k === 'home')) hold = { hold: k === 'tool-change' ? k : 'pause', line: ev.line };
    };
    let moves = prog.moves;
    const lifting = moves.length && moves[0].liftFirst;
    if (!moves.length) problems.push('there are no moves to run');
    else if (!lifting) {
      // every run enters the same way from wherever the bit is (design review #1)
      const E = P.entryMoves(pos, moves[0], S);
      if (E.skipFirst) moves = moves.slice(1);
      for (const x of E) {
        if (x.routerHere && live) say(true, 0);
        if (x.move) move(x.move, x.move.kind === 'down' ? Math.min(10, cfg.move.z) : x.move.kind === 'up' ? cfg.rapid.z : cfg.rapid.xy, x.move.line, 'entry');
      }
    }
    let started = !lifting;
    let at = { ...pos };
    for (const m of moves) {
      if (hold) break;
      // a continue starts by going straight up from wherever the bit is, then over at that height
      // (the lift-first move itself), the router on there, then slowly down to the line's start
      if (m.liftFirst) {
        move({ x: at.x, y: at.y, z: Math.max(at.z, m.z) }, cfg.rapid.z, m.line, 'entry');
        move({ x: m.x, y: m.y, z: Math.max(at.z, m.z) }, cfg.rapid.xy, m.line, 'entry');
        at = { x: m.x, y: m.y, z: Math.max(at.z, m.z) };
        continue;
      }
      if (!started) { if (live) say(true, m.line); started = true; }
      while (e < events.length && events[e].line < m.line) event(events[e++]);
      if (hold) break;
      let feed = m.rapid ? (m.z !== m.z0 && m.x === m.x0 && m.y === m.y0 ? cfg.rapid.z : cfg.rapid.xy) : (m.feed || cfg.move.xy);
      if (!m.rapid) {
        // never faster than the machine's own move speeds ([VS]): XY, and Z along the move
        const L = Math.hypot(m.x - m.x0, m.y - m.y0, m.z - m.z0), dz = Math.abs(m.z - m.z0);
        feed = Math.min(feed, cfg.move.xy);
        if (dz > 1e-9 && L > 0) feed = Math.min(feed, cfg.move.z * L / dz);
      }
      move(m, feed, m.line, m.lead ? 'entry' : 'program', m);
      at = { x: m.x, y: m.y, z: m.z };
      moved = true;
    }
    if (!hold) while (e < events.length) event(events[e++]);
    // the end: the router off; a hold lifts clear over the same spot (a tool change high enough for a wrench)
    say(false, hold ? hold.line : 0);
    steps.push({ restore: true, line: hold ? hold.line : 0 });   // every other output back as it was
    if (hold) {
      const up = hold.hold === 'tool-change' ? Math.max(S, cfg.changeZ || 50) : S;
      if (at.z < up) move({ x: at.x, y: at.y, z: up }, Math.min(cfg.jog.z, cfg.move.z), hold.line, 'exit');
    }
    // the card's slowest step, per move from its own steps (reviews #3, follow-up #2)
    if (cfg.unit && cfg.tickHz) {
      let from = { ...pos };
      for (const s of steps) {
        if (!s.move) continue;
        const why = segProblem(from, s.move, s.feed, cfg, s.work && s.work.rapid);
        if (why) { problems.push(`line ${s.line} ${why}`); break; }
        from = s.move;
      }
    }
    // the moves as segments, for the preview: what will run, from where the bit is
    const segs = [];
    let p = { ...pos };
    for (const s of steps) if (s.move) { segs.push({ x0: p.x, y0: p.y, z0: p.z, ...s.move, rapid: s.phase !== 'program' || !!(s.work && s.work.rapid), feed: s.feed, line: s.line, phase: s.phase }); p = s.move; }
    return seal({ kind: prog.kind || (live ? 'cut' : 'test'), name: prog.name, live, from: { ...pos }, steps, hold, moves: segs, problems, ctx: ctx || null, armed: false });
  }

  // a copy of the plan's data (no shared objects with whoever made it), frozen all the way down,
  // with its fingerprint (third review #4)
  function seal(plan) {
    const p = deepFreeze(JSON.parse(JSON.stringify(plan)));
    return Object.freeze(Object.assign({}, p, { id: fingerprint(p) }));
  }
  function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; }

  // a fingerprint of everything a plan does: where it starts, what it is for, every move, feed,
  // switch, dwell and hold, in order. A consistency check (a changed plan no longer matches its
  // id), not a credential.
  function fingerprint(plan) {
    let h = 2166136261 >>> 0;
    const add = v => { const s = typeof v === 'number' ? v.toFixed(4) : JSON.stringify(v === undefined ? null : v); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } };
    add(plan.kind); add(plan.name); add(plan.live); add(plan.from.x); add(plan.from.y); add(plan.from.z); add(plan.ctx); add(plan.hold);
    for (const s of plan.steps) {
      if (s.move) { add('m'); add(s.move.x); add(s.move.y); add(s.move.z); add(s.feed); add(s.line); add(s.phase); add(!!(s.work && s.work.rapid)); }
      else { add(s.router); add(s.out); add(s.on); add(s.dwell); add(s.restore); add(s.line); }
    }
    return h.toString(36) + ':' + plan.steps.length;
  }

  // the student's checklist arms exactly this plan: a sealed copy marked armed, its id unchanged
  function arm(plan) {
    if (!plan || !verify(plan)) return null;
    return Object.freeze(Object.assign({}, plan, { armed: true }));
  }
  // a plan still is what its fingerprint says (nothing changed it after it was made)
  function verify(plan) { return !!(plan && plan.steps && plan.id && Object.isFrozen(plan.steps) && fingerprint(plan) === plan.id); }

  // What swarf can carry out exactly, checked on the file itself (the page, the plan and the
  // driver all use this one list): every line understood, Z zero on the board's top. An inch file
  // runs (Phil 10-29, VCarve's ShopBot post writes inches): the reader turns every length and speed
  // into millimeters before any plan is made, so the plan, its fingerprint and the card only ever
  // see millimeters, and the checklist has the student confirm the size in both.
  function validate(src) {
    const out = [];
    if (!src) return [{ k: 'none', text: 'there is no file' }];
    if (src.units && src.units !== 'mm' && src.units !== 'in') out.push({ k: 'units', text: `the file's units (${src.units}) are not inches or millimeters` });
    for (const u of src.unsupported || []) out.push({ k: 'unsupported', line: u.line, text: `line ${u.line} is something swarf can't carry out exactly ("${String(u.text).slice(0, 40)}")` });
    // swarf zeros Z on the board's top: a file whose cuts all sit above Z 0 was zeroed on the table
    // (or on a spoil board), and every safe height in it would sit inside the board (third review #5)
    const cuts = (src.moves || []).filter(m => !m.rapid);
    // VCarve says where it put Z zero: &PWZorigin = Table Surface
    const zo = (src.events || []).filter(e => e.kind === 'z-origin').pop();
    if (zo && /table/i.test(zo.value)) out.push({ k: 'table-zero', text: 'the file says Z zero is on the table surface, not on the board\'s top' });
    else if (cuts.length && cuts.every(m => m.z > -0.01 && m.z0 > -0.01) && cuts.some(m => m.z > 0.5)) out.push({ k: 'table-zero', text: 'every cut in this file is above Z 0: it looks made with Z zero on the table, not on the board\'s top. swarf runs only files zeroed on the board\'s top' });
    return out;
  }

  // One move the card can make as asked, counted in the whole steps it will send (third review
  // #5): a feed under the card's slowest step for that move would run faster than asked. A move
  // of no whole steps does nothing and is fine. Returns why not, or ''.
  function segProblem(a, b, feed, cfg, rapid) {
    if (![b.x, b.y, b.z, feed].every(Number.isFinite)) return 'has a position or speed that is not a number';
    if (rapid || !cfg.unit || !cfg.tickHz) return '';
    const u = cfg.unit, T = cfg.tickHz / 65536;
    const d = k => Math.abs(Math.round(b[k] * u[k]) - Math.round(a[k] * u[k]));
    const st = Math.max(d('x'), d('y'), d('z'));
    if (!st) return '';
    const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    return feed < (T * L / st) * 1.02 ? `is slower than the card can step (${Math.round(feed * 60)} mm/min)` : '';
  }

  // A resume after a pause, as a plan of its own (third review #5): up where the bit stopped,
  // the router on up there (a cut), the outputs the file had on at that point, slowly down to
  // where it stopped, then the rest of the original plan from the step it was in.
  function resumeFrom(plan, k, at, cfg) {
    const steps = [];
    const S = cfg.safeZ, up = Math.max(at.z, S);
    // the outputs as the file had them when it paused
    const outs = new Map();
    let router = false;
    for (let i = 0; i < k; i++) { const s = plan.steps[i]; if (s.out) outs.set(s.out, s.on); if (s.router !== undefined) router = s.router; if (s.restore) { outs.clear(); } }
    // nothing to switch back on (a pause on the way in, or a test run): carry straight on
    const restart = (plan.live && router) || [...outs.values()].some(Boolean);
    const lift = restart && at.z < up - 1e-6, ln = plan.steps[k] ? plan.steps[k].line : 0;
    if (lift) steps.push({ move: { x: at.x, y: at.y, z: up }, feed: cfg.rapid.z, line: ln, phase: 'entry' });
    if (plan.live && router) { steps.push({ router: true, line: 0 }); steps.push({ dwell: cfg.spinUp, line: 0 }); }
    for (const [n, on] of outs) if (on) steps.push({ out: n, on: true, line: 0 });
    if (lift) steps.push({ move: { x: at.x, y: at.y, z: at.z }, feed: Math.min(10, cfg.move.z), line: ln, phase: 'entry' });
    for (let i = k; i < plan.steps.length; i++) steps.push(plan.steps[i]);
    const problems = [];
    let from = { ...at };
    for (const s of steps) if (s.move) { const why = segProblem(from, s.move, s.feed, cfg, s.work && s.work.rapid); if (why) { problems.push(`line ${s.line} ${why}`); break; } from = s.move; }
    const segs = [];
    let p = { ...at };
    for (const s of steps) if (s.move) { segs.push({ x0: p.x, y0: p.y, z0: p.z, ...s.move, rapid: s.phase !== 'program' || !!(s.work && s.work.rapid), feed: s.feed, line: s.line, phase: s.phase }); p = s.move; }
    return seal({ kind: 'resume', name: plan.name, live: plan.live, from: { ...at }, steps, hold: plan.hold, moves: segs, problems, ctx: plan.ctx, armed: false, resumes: plan.id });
  }

  // the way in, in words, for the cards: "up to 25 mm, the router on, over to X 12, Y 40, down to Z -1.5"
  function entryWords(plan) {
    const out = [];
    let p = plan.from || { x: 0, y: 0, z: 0 };
    for (const s of plan.steps) {
      if (s.router === true) { out.push('the router on'); continue; }
      if (!s.move) continue;
      if (s.phase !== 'entry') break;
      const m = s.move;
      if (m.z > p.z + 1e-6 && Math.hypot(m.x - p.x, m.y - p.y) < 1e-6) out.push(`up to ${m.z.toFixed(0)} mm`);
      else if (m.z < p.z - 1e-6) out.push(`slowly down to Z ${m.z.toFixed(1)}`);
      else out.push(`over to X ${m.x.toFixed(0)}, Y ${m.y.toFixed(0)}`);
      p = m;
    }
    return out.join(', ');
  }

  const api = { build, arm, verify, validate, segProblem, resumeFrom, entryWords, fingerprint };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SwarfRunPlan = api;
})(typeof window !== 'undefined' ? window : globalThis);
