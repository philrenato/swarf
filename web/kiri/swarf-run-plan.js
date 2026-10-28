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
 *   plan.id         a fingerprint: arming one plan never arms another
 */
(function (root) {
  'use strict';
  (typeof window !== 'undefined' ? window : globalThis).SWARF_BUILDS = Object.assign((typeof window !== 'undefined' ? window : globalThis).SWARF_BUILDS || {}, { 'swarf-run-plan.js': '__SWARF_BUILD__' });

  function build(prog, { pos, live, cfg }) {
    const P = root.SwarfRunParse;
    const S = cfg.safeZ;
    const steps = [], problems = [];
    const events = (prog.events || (prog.sbp && P ? P.parse(prog.sbp).events : [])).slice().sort((a, b) => a.line - b.line);
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
      const T = cfg.tickHz / 65536, u = cfg.unit;
      let from = { ...pos };
      for (const s of steps) {
        if (!s.move) continue;
        const w = { x0: from.x, y0: from.y, z0: from.z, ...s.move };
        const L = Math.hypot(w.x - w.x0, w.y - w.y0, w.z - w.z0), st = Math.max(Math.abs(w.x - w.x0) * u.x, Math.abs(w.y - w.y0) * u.y, Math.abs(w.z - w.z0) * u.z);
        const floor = st >= 1 ? T * L / st : 0;
        if (s.feed < floor * 1.02 && !(s.work && s.work.rapid)) { problems.push(`line ${s.line} is slower than the card can step (${Math.round(s.feed * 60)} mm/min)`); break; }
        from = s.move;
      }
    }
    // the moves as segments, for the preview: what will run, from where the bit is
    const segs = [];
    let p = { ...pos };
    for (const s of steps) if (s.move) { segs.push({ x0: p.x, y0: p.y, z0: p.z, ...s.move, rapid: s.phase !== 'program' || !!(s.work && s.work.rapid), feed: s.feed, line: s.line, phase: s.phase }); p = s.move; }
    const id = fingerprint(prog.name || '', pos, live, segs);
    return Object.freeze({ id, kind: prog.kind || (live ? 'cut' : 'test'), name: prog.name, live, from: { ...pos }, steps: Object.freeze(steps), hold, moves: segs, problems, armed: false, requireArm: !!prog.requireArm });
  }

  // a short fingerprint of what a plan does: its start, its moves, its router
  function fingerprint(name, pos, live, segs) {
    let h = 2166136261 >>> 0;
    const add = v => { const s = typeof v === 'number' ? v.toFixed(3) : String(v); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } };
    add(name); add(live); add(pos.x); add(pos.y); add(pos.z);
    for (const s of segs) { add(s.x); add(s.y); add(s.z); add(s.feed); }
    return h.toString(36) + ':' + segs.length;
  }

  // the student's checklist arms exactly this plan (a frozen plan cannot be changed, so a copy)
  function arm(plan) { return Object.freeze({ ...plan, armed: true }); }

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

  const api = { build, arm, entryWords, fingerprint };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SwarfRunPlan = api;
})(typeof window !== 'undefined' ? window : globalThis);
