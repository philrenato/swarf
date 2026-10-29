/**
 * swarf run — the machine behind Run mode.
 *
 * Two back ends with one interface:
 *   SimMachine     — a ShopBot in the page; moves at the program's speeds
 *   DirectMachine  — the real box over USB (swarf-shopbot-direct.js); swarf
 *                    is the whole controller, no ShopBot software
 *
 * Interface (both):
 *   state            { kind, connected, pos:{x,y,z}, running, paused, preview,
 *                      moving, spindle, line, dialog, note }
 *   on(fn)           fn(state) on every change
 *   jog(axis, dist)  relative jog at jog speed;  jogHold(axis, dir) / jogRelease()
 *   goTo({x,y,z})    absolute jog, axes left out stay put
 *   zero(axes)       'xy' | 'z' | 'xyz' — current location becomes 0
 *   home()           ShopBot C3
 *   run(prog)        prog = { sbp, moves, name, preview }
 *   pause() resume() stop()
 *
 * Positions are ShopBot locations (work coordinates), mm.
 */
(function (root) {
  'use strict';
  // the deploy stamps every machine-control file; connect refuses a page that mixes two builds
  (typeof window !== 'undefined' ? window : globalThis).SWARF_BUILDS = Object.assign((typeof window !== 'undefined' ? window : globalThis).SWARF_BUILDS || {}, { 'swarf-run-machine.js': '__SWARF_BUILD__' });

  // Table travel of the shop machine (mm).
  const LIMITS = { x: [-12.7, 2451.1], y: [-12.7, 1231.9], z: [-50.8, 203.2] };

  class Base {
    constructor() {
      this.subs = new Set();
      this.state = {
        kind: 'sim', connected: false, pos: { x: 0, y: 0, z: 25.4 },
        running: false, paused: false, preview: false, moving: false,
        spindle: false, line: 0, dialog: null, note: '', limits: LIMITS
      };
    }
    on(fn) { this.subs.add(fn); fn(this.state); return () => this.subs.delete(fn); }
    set(patch) {
      Object.assign(this.state, patch);
      for (const fn of this.subs) fn(this.state);
    }
    clamp(axis, v) {
      const [lo, hi] = LIMITS[axis];
      return Math.min(hi, Math.max(lo, v));
    }
  }

  // ---------------------------------------------------------------- sim
  class SimMachine extends Base {
    constructor() {
      super();
      this.state.connected = true;
      this.state.note = 'simulator';
      // mm/s, ShopBot [VS] jog defaults on the shop machine. cfg.jog as on the real
      // driver, so CONTROL's speed row (setJogSpeed) reaches the simulator too: the
      // simulator jogged at 6000 mm/min whatever the row said (review 10-28)
      this.cfg = { jog: { xy: 100, z: 100 } };
      this.zeroOffset = { x: 0, y: 0, z: 0 };
      this.raf = 0;
      this.queue = [];
      // the Z plate, simulated: a board whose top is at work Z boardZ, and a plate on it
      this.boardZ = 0;
      this.plateCfg = { thickness: 3.0734, fast: 12.7, slow: 6.35, lift: 25.4, travel: 60, confirmed: true, sim: true };
      try { const t = parseFloat(localStorage.getItem('swarf-plate-thickness')); if (t > 0) this.plateCfg.thickness = t; } catch (e) { /* private window */ }
      this.homing = false;
    }

    setPlateThickness(t) {
      if (!(t > 0 && t < 50)) return false;
      this.plateCfg.thickness = t;
      try { localStorage.setItem('swarf-plate-thickness', String(t)); } catch (e) { /* private window */ }
      this.set({ plateCfg: { ...this.plateCfg } });
      return true;
    }
    get jogSpeed() { return this.cfg.jog; }
    idle() {
      return new Promise(res => { const un = this.on(st => { if (!this.queue.length && !st.moving) { setTimeout(() => un(), 0); res(); } }); });
    }
    // ShopBot C2 on the simulator: down to the plate fast, Z = plate thickness there,
    // lift, down again slowly, Z again, lift. Too far above the plate (more than its
    // travel) and it goes the whole travel and fails, as the machine would.
    async zZero() {
      if (this.busy() || this.homing) return false;
      const P = this.plateCfg, plateTop = () => this.boardZ + P.thickness;   // in work Z, which each touch re-zeroes
      if (this.state.pos.z <= plateTop() + 0.01) { this.set({ note: 'the plate already reads contact: lift the bit off the plate, then zero again' }); return false; }
      this.homing = true; this.homeAbort = false;
      this.set({ moving: true, note: 'zeroing Z on the plate' });
      let ok = true;
      for (const speed of [P.fast, P.slow]) {
        const top = plateTop(), far = this.state.pos.z - top > P.travel;
        this.moveTo({ ...this.state.pos, z: far ? this.state.pos.z - P.travel : top }, speed);
        await this.idle();
        if (this.homeAbort) { ok = false; break; }
        if (far) { ok = false; this.set({ note: `Z zero failed: no Z plate contact within ${P.travel} mm` }); break; }
        // contact: this height is the plate's thickness above the board
        const shift = this.state.pos.z - P.thickness;
        this.boardZ -= shift;
        this.set({ pos: { ...this.state.pos, z: P.thickness } });
        this.moveTo({ ...this.state.pos, z: P.lift }, this.jogSpeed.z);
        await this.idle();
        if (this.homeAbort) { ok = false; break; }
      }
      this.homing = false;
      if (ok) this.set({ moving: false, note: 'Z zeroed on the plate: put the plate away' });
      else if (this.homeAbort) this.set({ moving: false, note: 'Z zero stopped' });
      return ok;
    }

    // A straight move from the current position, at speed mm/s.
    moveTo(p, speed, line) {
      this.queue.push({ x: p.x, y: p.y, z: p.z, speed, line });
      if (!this.raf) this.tick(performance.now());
    }

    tick(t0) {
      let last = t0;
      const step = (t) => {
        const dt = Math.min(0.1, (t - last) / 1000);
        last = t;
        if (this.state.paused) { this.raf = requestAnimationFrame(step); return; }
        let budget = dt * (this.timeScale || 1);
        const pos = { ...this.state.pos };
        let line = this.state.line;
        while (budget > 0 && this.queue.length) {
          const q = this.queue[0];
          const d = Math.hypot(q.x - pos.x, q.y - pos.y, q.z - pos.z);
          const can = q.speed * budget;
          if (can >= d) {
            pos.x = q.x; pos.y = q.y; pos.z = q.z;
            budget -= d / q.speed;
            line = q.line || line;
            this.queue.shift();
          } else {
            const f = can / d;
            pos.x += (q.x - pos.x) * f; pos.y += (q.y - pos.y) * f; pos.z += (q.z - pos.z) * f;
            line = q.line || line;
            budget = 0;
          }
        }
        const done = !this.queue.length;
        this.set({ pos, line, moving: !done });
        if (done) {
          this.raf = 0;
          const h = !this.stopped && this.planHold;
          this.planHold = null;
          if (this.state.running && h) this.set({ running: false, spindle: false, stopHit: true, toolChange: h.hold === 'tool-change', resumeLine: h.line + 1,
            note: h.hold === 'tool-change' ? `tool change at line ${h.line}: change the bit, zero Z, then cut from line ${h.line + 1}` : `the file pauses at line ${h.line}: cut from line ${h.line + 1} to go on` });
          else if (this.state.running) this.set({ running: false, spindle: false, note: this.stopped ? 'stopped' : 'program finished' });
          this.stopped = false;
          return;
        }
        this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    }

    busy() { return this.state.running || this.queue.length > 0; }

    jog(axis, dist) {
      if (this.state.running) return;
      const p = { ...this.target() };
      p[axis] = this.clamp(axis, p[axis] + dist);
      this.moveTo(p, axis === 'z' ? this.jogSpeed.z : this.jogSpeed.xy);
    }
    target() { const q = this.queue[this.queue.length - 1]; return q ? { x: q.x, y: q.y, z: q.z } : this.state.pos; }
    jogHold(axis, dir) {
      if (this.state.running) return;
      this.queue = [];
      const p = { ...this.state.pos };
      p[axis] = LIMITS[axis][dir > 0 ? 1 : 0];
      this.moveTo(p, axis === 'z' ? this.jogSpeed.z : this.jogSpeed.xy);
    }
    jogRelease() { if (!this.state.running) this.queue = []; }
    goTo(t) {
      if (this.state.running) return;
      const p = { ...this.target() };
      if (t.z !== undefined && t.z > p.z) { p.z = t.z; this.moveTo({ ...p }, this.jogSpeed.z); }
      if (t.x !== undefined) p.x = t.x;
      if (t.y !== undefined) p.y = t.y;
      this.moveTo({ ...p }, this.jogSpeed.xy);
      if (t.z !== undefined && t.z < p.z) { p.z = t.z; this.moveTo({ ...p }, this.jogSpeed.z); }
    }
    // the machine's own position (the real box's step count, in mm): work position + this offset
    mabs() { const o = this.wOff || (this.wOff = { x: 0, y: 0, z: 0 }), p = this.state.pos; return { x: p.x + o.x, y: p.y + o.y, z: p.z + o.z }; }
    zero(axes) {
      if (this.busy()) return;
      const pos = { ...this.state.pos };
      if (axes.includes('z')) this.boardZ -= pos.z;          // the board stays where it is; its Z number moves
      this.mabs();
      for (const a of axes) { this.wOff[a] += pos[a]; pos[a] = 0; }
      this.set({ pos, note: `zeroed ${axes.toUpperCase()}` });
    }
    // type a position: here becomes v on that axis (the real driver's VA, review 10-28b #23)
    setWork(axis, v) {
      if (this.busy() || !isFinite(v)) return;
      const pos = { ...this.state.pos };
      if (axis === 'z') this.boardZ += v - pos.z;
      this.mabs(); this.wOff[axis] += pos[axis] - v;
      pos[axis] = v;
      this.set({ pos, note: `${axis.toUpperCase()} set to ${v}` });
    }
    home() {
      if (this.busy()) return;
      // homing seeks the proximity switches at the -X/-Y corner
      this.goTo({ z: this.state.pos.z });
      this.moveTo({ x: 0, y: 0, z: this.state.pos.z }, this.jogSpeed.xy);
      this.set({ note: 'homing' });
    }
    // the simulator plays the same job plan the ShopBot runs (swarf-run-plan.js): its entry, its
    // moves, its hold at a tool change
    plan(prog) {
      return root.SwarfRunPlan.build(prog, { pos: this.state.pos, live: prog.spindle !== false && !prog.preview,
        cfg: { safeZ: 25.4, rapid: { xy: this.jogSpeed.xy, z: this.jogSpeed.z }, move: { xy: 76.2, z: 25.4 }, jog: { z: this.jogSpeed.z }, spinUp: 0, changeZ: 50 } });
    }
    run(progOrPlan) {
      if (this.busy()) return;
      // the simulator holds itself to the ShopBot's rule: only a checked, confirmed, unchanged plan
      const plan = progOrPlan;
      if (!plan || !plan.steps) { this.set({ note: 'not run: swarf runs only a plan it has checked and you have confirmed' }); return; }
      if (!root.SwarfRunPlan.verify(plan)) { this.set({ note: 'not run: this plan changed after it was made' }); return; }
      if (!plan.armed) { this.set({ note: 'not run: this plan was not confirmed' }); return; }
      if (plan.problems.length) { this.set({ note: `${plan.problems[0]}: not run` }); return; }
      // as the ShopBot refuses it (torture test 10-29: the simulator ran a plan from wherever the bit had gone)
      const p = this.state.pos;
      if (plan.from && Math.hypot(p.x - plan.from.x, p.y - plan.from.y, p.z - plan.from.z) > 0.05) { this.set({ note: 'not run: the bit has moved since this plan was made' }); return; }
      this.queue = [];
      this.planHold = plan.hold;
      this.set({ running: true, paused: false, preview: false, spindle: plan.live, line: 0, toolChange: false, resumeLine: 0, note: 'running' });
      for (const st of plan.steps) if (st.move) this.moveTo(st.move, st.feed || 50, st.line);
    }
    pause() { if (this.state.running) this.set({ paused: true, note: 'paused' }); }
    // the simulator keeps its queue through a pause: nothing to plan again
    resumePlan() { return null; }
    resume() { if (this.state.paused) this.set({ paused: false, note: 'running' }); }
    stop() {
      if (this.homing) this.homeAbort = true;
      this.queue = [];
      this.stopped = true;
      this.set({ paused: false, running: false, spindle: false, moving: false, note: 'stopped' });
    }
    answer() { this.set({ dialog: null }); }
  }

  root.SwarfRunMachine = { Base, SimMachine, LIMITS };
})(window);
