/**
 * swarf run — the machine behind Run mode.
 *
 * Two back ends with one interface:
 *   SimMachine     — a ShopBot in the page; moves at the program's speeds
 *   BridgeMachine  — the real ShopBot through the shop-laptop helper
 *                    (tools/shopbot-helper), which drives ShopBot 3 via its
 *                    registry interface at HKCU\...\ShopBot\UserData
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

  const HELPER = 'http://localhost:8139';
  // Table travel from the shop machine's shopbot.ini [VL] (mm).
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
      this.jogSpeed = { xy: 100, z: 100 };   // mm/s, ShopBot [VS] jog defaults on the shop machine
      this.zeroOffset = { x: 0, y: 0, z: 0 };
      this.raf = 0;
      this.queue = [];
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
          if (this.state.running) this.set({ running: false, spindle: false, note: this.stopped ? 'stopped' : 'program finished' });
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
    zero(axes) {
      if (this.busy()) return;
      const pos = { ...this.state.pos };
      for (const a of axes) pos[a] = 0;
      this.set({ pos, note: `zeroed ${axes.toUpperCase()}` });
    }
    home() {
      if (this.busy()) return;
      // XYzero.sbp seeks the proximity switches at the -X/-Y corner
      this.goTo({ z: this.state.pos.z });
      this.moveTo({ x: 0, y: 0, z: this.state.pos.z }, this.jogSpeed.xy);
      this.set({ note: 'homing' });
    }
    run(prog) {
      if (this.busy() || !prog.moves.length) return;
      this.queue = [];
      this.set({ running: true, paused: false, preview: !!prog.preview, spindle: !prog.preview && prog.spindle !== false, line: 0, note: prog.preview ? 'previewing' : 'running' });
      for (const m of prog.moves) this.moveTo({ x: m.x, y: m.y, z: m.z }, m.feed || 50, m.line);
    }
    pause() { if (this.state.running) this.set({ paused: true, note: 'paused' }); }
    resume() { if (this.state.paused) this.set({ paused: false, note: 'running' }); }
    stop() {
      this.queue = [];
      this.stopped = true;
      this.set({ paused: false, running: false, spindle: false, moving: false, note: 'stopped' });
    }
    answer() { this.set({ dialog: null }); }
  }

  // ---------------------------------------------------------------- bridge
  // The helper owns the registry handshake: it writes one command to uCommand,
  // waits for ShopBot to clear it, then writes the next. This side only says
  // what to do and polls /status.
  class BridgeMachine extends Base {
    constructor() {
      super();
      this.state.kind = 'shopbot';
      this.state.note = 'looking for the shop laptop helper';
      this.pollMs = 150;
      this.fails = 0;
      this.hold = null;
    }

    async req(path, body) {
      const r = await fetch(HELPER + path, body === undefined ? { cache: 'no-store' } : {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'text/plain' },   // a "simple" request: no CORS preflight
        body: JSON.stringify(body)
      });
      if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
      return r.json();
    }

    static async available() {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 600);
        const r = await fetch(HELPER + '/status', { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        return r.ok;
      } catch (e) { return false; }
    }

    start() {
      const loop = async () => {
        try {
          const s = await this.req('/status');
          this.fails = 0;
          this.set({
            connected: s.sb3, pos: s.pos, running: s.running, paused: s.paused,
            preview: s.preview, moving: s.moving || s.queued > 0, queued: s.queued, spindle: s.spindle, stopHit: (s.status & 16) !== 0,
            dialog: s.dialog, note: s.note || (s.sb3 ? 'ShopBot connected' : 'ShopBot 3 is not open')
          });
        } catch (e) {
          if (++this.fails === 3) this.set({ connected: false, note: 'helper not answering' });
        }
        this.timer = setTimeout(loop, this.pollMs);
      };
      loop();
      return this;
    }

    // First contact proof, in preview so nothing moves: ShopBot must take a
    // file from us and show it running. Then back to move mode, where jogs
    // move the machine. Resolves true / false.
    async verify() {
      const sbp = ["'swarf connection check (preview only)", 'SA', 'J2,0,0', 'END'].join('\r\n');
      await this.req('/run', { name: 'swarf-check', sbp, preview: true });
      const t0 = Date.now();
      let saw = false;
      while (Date.now() - t0 < 10000) {
        await new Promise(r => setTimeout(r, 200));
        if (this.state.preview && this.state.running) { saw = true; break; }
      }
      // let the test file finish before handing the machine back
      while (saw && this.state.running && Date.now() - t0 < 20000) await new Promise(r => setTimeout(r, 200));
      await this.send(['SM']);
      while (this.state.queued && Date.now() - t0 < 25000) await new Promise(r => setTimeout(r, 150));
      return saw;
    }

    send(cmds) { return this.req('/cmd', { cmds }).catch(e => this.set({ note: e.message })); }
    fmt(v) { return (Math.round(v * 1000) / 1000).toString(); }

    jog(axis, dist) {
      if (this.state.running) return;
      const t = this.clamp(axis, this.state.pos[axis] + dist);
      this.send(['SA', `J${axis.toUpperCase()},${this.fmt(t)}`]);
    }
    // Held jog: a bounded segment toward the limit, extended while held, so a
    // lost release can overrun by one segment at most.
    jogHold(axis, dir) {
      if (this.state.running) return;
      const SEG = 40;
      const go = () => {
        const t = this.clamp(axis, this.state.pos[axis] + dir * SEG);
        this.send(['SA', `J${axis.toUpperCase()},${this.fmt(t)}`]);
        this.hold = { axis, dir, target: t };
      };
      go();
      this.holdTimer = setInterval(() => {
        if (!this.hold) return;
        if (Math.abs(this.state.pos[axis] - this.hold.target) < SEG * 0.3 && !this.state.moving) go();
      }, 120);
    }
    jogRelease() {
      if (!this.hold) return;
      clearInterval(this.holdTimer);
      this.hold = null;
      this.req('/stop', {}).catch(() => {});
    }
    goTo(t) {
      if (this.state.running) return;
      const c = ['SA'];
      const p = this.state.pos;
      if (t.z !== undefined && t.z > p.z) c.push(`JZ,${this.fmt(t.z)}`);
      if (t.x !== undefined || t.y !== undefined) c.push(`J2,${t.x !== undefined ? this.fmt(t.x) : ''},${t.y !== undefined ? this.fmt(t.y) : ''}`);
      if (t.z !== undefined && t.z <= p.z) c.push(`JZ,${this.fmt(t.z)}`);
      this.send(c);
    }
    zero(axes) {
      if (this.state.running) return;
      this.send([{ x: 'ZX', y: 'ZY', xy: 'Z2', z: 'ZZ', xyz: 'Z3' }[axes]]);
    }
    home() { if (!this.state.running) this.send(['C3']); }
    run(prog) {
      if (this.state.running) return;
      this.req('/run', { name: prog.name, sbp: prog.sbp, preview: !!prog.preview })
        .catch(e => this.set({ note: e.message }));
    }
    pause() { this.req('/stop', {}).catch(() => {}); }          // ShopBot's stop is a pause with a continue/quit dialog
    resume() { this.answer(1); }
    stop() { this.req('/stop', { quit: true }).catch(() => {}); }
    answer(v) { this.req('/answer', { value: v }).catch(() => {}); }
  }

  root.SwarfRunMachine = { Base, SimMachine, BridgeMachine, LIMITS, HELPER };
})(window);
