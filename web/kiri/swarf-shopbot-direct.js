/**
 * swarf shopbot — Run mode's third back end: the ShopBot control box driven
 * straight from this page over WebUSB (Chrome/Edge), no ShopBot 3 and no
 * helper. Same interface as SimMachine / BridgeMachine in swarf-run-machine.js.
 *
 * Coordinates: the card counts steps from its own power-up. Work zero is an
 * origin in steps kept here (and in localStorage for a reload while the box
 * stays on); pos = (steps - origin) / unit.
 *
 * Settings default to the shop machine's shopbot.ini (ShopBot 3.8.4,
 * metric): VU, VS, VR, VL.
 */
(function (root) {
  'use strict';

  const M = root.SwarfRunMachine;
  const { ShopBotCard, Planner } = root.ShopBotCard;
  const ShopBotUSB = root.ShopBotUSB;

  const SHOP = {
    unit: { x: 72.183661, y: 72.183661, z: 90.229567 },        // [VU] steps/mm
    move: { xy: 76.2, z: 25.4 }, jog: { xy: 100, z: 100 },      // [VS] mm/s
    rampSpeed: 10.16, rampRate: 5.08,                           // [VR]
    spinUp: 3,                                                  // s after the spindle starts
    safeZ: 25.4                                                 // work mm, Run mode's SAFE_Z
  };
  const SPINDLE = 0x001;                                        // output 1 ([1 & 2 enable Router/Spindles])
  const ORIGIN_KEY = 'swarf-shopbot-origin';
  const FLIP_KEY = 'swarf-shopbot-flip';
  const LOG_MAX = 20000;
  const BIT = { x: 1, y: 2, z: 4 };

  class DirectMachine extends M.Base {
    constructor(cfg = {}) {
      super();
      this.cfg = Object.assign({}, SHOP, cfg);
      this.state.kind = 'shopbot';
      this.state.note = 'not connected';
      this.planner = new Planner({ unit: this.cfg.unit, rampSpeed: this.cfg.rampSpeed, rampRate: this.cfg.rampRate });
      this.origin = { x: 0, y: 0, z: 0 };
      this.steps = { x: 0, y: 0, z: 0 };
      this.outputs = 0;
      this.job = null;        // { ops, resumeAt } while a program runs
      this.flip = { x: false, y: false, z: false };
      this.traffic = [];
      try { Object.assign(this.origin, JSON.parse(localStorage.getItem(ORIGIN_KEY)) || {}); } catch (e) { /* none saved */ }
      try { Object.assign(this.flip, JSON.parse(localStorage.getItem(FLIP_KEY)) || {}); } catch (e) { /* none saved */ }
      this.planner.m.invert = this.invertMask();
    }

    invertMask() { return (this.flip.x ? 1 : 0) | (this.flip.y ? 2 : 0) | (this.flip.z ? 4 : 0); }

    // A motor that runs backwards: the card's count for that axis is negated
    // from here on, and the axis is zeroed where it stands.
    setFlip(axis, on) {
      if (this.busy() || this.flip[axis] === !!on) return;
      this.flip[axis] = !!on;
      this.planner.m.invert = this.invertMask();
      this.steps[axis] = -this.steps[axis];
      this.origin[axis] = this.steps[axis];
      try { localStorage.setItem(FLIP_KEY, JSON.stringify(this.flip)); localStorage.setItem(ORIGIN_KEY, JSON.stringify(this.origin)); } catch (e) { /* private window */ }
      this.set({ pos: this.work(this.steps), flip: { ...this.flip }, note: `${axis.toUpperCase()} runs the other way now; ${axis.toUpperCase()} is zero here` });
    }

    // Output n (1-12) on for `ms`, then back as it was. Idle only.
    async testOutput(n, ms = 2000) {
      if (this.busy()) return false;
      const on = this.outputs | (1 << (n - 1));
      const word = w => [0xF0, w & 0xFF, (w >> 8) & 0x0F, 0xFF, 0xFF, 0xFF];
      this.testing = true;
      try {
        await this.card.cmd(word(on));
        this.set({ spindle: n === 1, note: `output ${n} on` });
        await new Promise(r => setTimeout(r, ms));
      } finally {
        await this.card.cmd(word(this.outputs)).catch(() => {});
        this.testing = false;
        this.set({ spindle: false, note: `output ${n} off` });
      }
      return true;
    }

    record(dir, b) {
      this.traffic.push([performance.now(), dir, b]);
      if (this.traffic.length > LOG_MAX) this.traffic.splice(0, this.traffic.length - LOG_MAX);
    }

    // The card traffic as text: ms since connect, > to the card / < from it, hex.
    logText() {
      const t0 = this.traffic.length ? this.traffic[0][0] : 0;
      const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join(' ');
      const head = [`swarf ${root.SWARF_VERSION || ''} ShopBot USB log ${new Date().toISOString()}`,
        `flip ${JSON.stringify(this.flip)} origin ${JSON.stringify(this.origin)} steps ${JSON.stringify(this.steps)}`];
      return head.concat(this.traffic.map(([t, d, b]) => `${(t - t0).toFixed(1)} ${d} ${hex(b)}`)).join('\n') + '\n';
    }

    static supported() { return !!(root.navigator && root.navigator.usb); }
    static async known() { return DirectMachine.supported() && !!(await ShopBotUSB.known().catch(() => null)); }

    // ask: true from a click (Chrome shows its device chooser once).
    async connect(ask) {
      let link = await ShopBotUSB.known().catch(() => null);
      if (!link && ask) link = await ShopBotUSB.request();
      if (!link) { this.set({ note: 'no ShopBot on USB' }); return false; }
      await link.open();
      link.onClose = () => this.lost();
      const m = await link.modem().catch(() => null);
      this.link = link;
      this.card = new ShopBotCard(link, { size: 149, timeoutMs: this.cfg.timeoutMs || 2000 });
      const write = link.write.bind(link), recv = link.onData;
      link.write = b => { this.record('>', b); return write(b); };
      link.onData = b => { this.record('<', b); recv(b); };
      try {
        const st = await this.card.status();
        await this.card.setBlocks(3);
        await this.card.cmd([0xF0, 0, 0, 0xFF, 0xFF, 0xFF]);
        await this.card.motors(true);
        this.read(st);
      } catch (e) {
        this.set({ connected: false, note: m && !m.cts && !m.dsr
          ? 'the box is not powered: switch it on, release the E-stops, press the blue reset'
          : `the box did not answer (${e.message})` });
        return false;
      }
      this.set({ connected: true, note: 'ShopBot connected over USB' });
      this.poll();
      return true;
    }

    lost() {
      clearTimeout(this.timer);
      this.set({ connected: false, running: false, moving: false, spindle: false, note: 'USB link lost: the box stops its spindle by itself' });
    }

    read(st) {
      const f = this.flip;
      this.steps = { x: f.x ? -st.steps.x : st.steps.x, y: f.y ? -st.steps.y : st.steps.y, z: f.z ? -st.steps.z : st.steps.z };
      this.set({ pos: this.work(this.steps), inputs: { p6: st.inputs, p2: st.inputs2 }, flip: { ...f } });
    }

    work(s) {
      const u = this.cfg.unit, o = this.origin;
      return { x: (s.x - o.x) / u.x, y: (s.y - o.y) / u.y, z: (s.z - o.z) / u.z };
    }

    machine(p) {
      const u = this.cfg.unit, o = this.origin;
      return { x: p.x + o.x / u.x, y: p.y + o.y / u.y, z: p.z + o.z / u.z };
    }

    poll() {
      clearTimeout(this.timer);
      const loop = async () => {
        if (this.card && !this.card.streaming && !this.state.running && !this.testing) {
          try { this.read(await this.card.status()); } catch (e) { /* busy or gone; onClose reports loss */ }
        }
        this.timer = setTimeout(loop, 400);
      };
      this.timer = setTimeout(loop, 400);
    }

    busy() { return !this.card || this.card.streaming || this.state.running || !!this.testing; }

    // Run ops (machine mm) as one stack; resolves with the end report.
    async stack(ops) {
      const from = this.work(this.steps);
      const start = this.machine(from);
      this.set({ moving: true });
      const p = this.planner;
      const end = await this.card.run(p.items(ops, start), {
        onAck: ack => { if (p.st) this.set({ pos: this.work(p.st.cur), line: p.st.line > 0 ? p.st.line : this.state.line, inputs: { p6: ack.inputs, p2: ack.inputs2 } }); }
      });
      this.read(end);
      this.set({ moving: false });
      return end;
    }

    move(targets, speed) {
      if (this.busy()) return;
      const ops = targets.map(t => Object.assign(this.machine(t), { feed: speed(t), line: 0 }));
      this.stack(ops).catch(e => this.set({ moving: false, note: e.message }));
    }

    jog(axis, dist) {
      if (this.busy()) return;
      const t = { ...this.state.pos };
      t[axis] = this.clamp(axis, t[axis] + dist);
      this.move([t], () => axis === 'z' ? this.cfg.jog.z : this.cfg.jog.xy);
    }

    jogHold(axis, dir) {
      if (this.busy()) return;
      const t = { ...this.state.pos };
      t[axis] = M.LIMITS[axis][dir > 0 ? 1 : 0];
      this.move([t], () => axis === 'z' ? this.cfg.jog.z : this.cfg.jog.xy);
    }

    jogRelease() { if (!this.state.running) this.planner.stop(); }

    goTo(t) {
      if (this.busy()) return;
      const p = { ...this.state.pos }, path = [];
      if (t.z !== undefined && t.z > p.z) { p.z = t.z; path.push({ ...p }); }
      if (t.x !== undefined) p.x = t.x;
      if (t.y !== undefined) p.y = t.y;
      path.push({ ...p });
      if (t.z !== undefined && t.z < p.z) { p.z = t.z; path.push({ ...p }); }
      let last = this.state.pos;
      this.move(path, q => { const z = q.z !== last.z && q.x === last.x && q.y === last.y; last = q; return z ? this.cfg.jog.z : this.cfg.jog.xy; });
    }

    zero(axes) {
      if (this.busy()) return;
      for (const a of axes) this.origin[a] = this.steps[a];
      try { localStorage.setItem(ORIGIN_KEY, JSON.stringify(this.origin)); } catch (e) { /* private window */ }
      this.set({ pos: this.work(this.steps), note: `zeroed ${axes.toUpperCase()}` });
    }

    home() { this.set({ note: 'home over USB is not built yet: zero X and Y by jogging to the corner' }); }

    // prog.moves are work mm; rapids at jog speed. With the spindle allowed
    // (not trace/air), output 1 comes on at the start with a spin-up dwell
    // and goes off at the end, and the file's own SO / C6 / C7 / timed PAUSE
    // run in order with the motion. A tool change or an untimed PAUSE after
    // the first move ends the job there: spindle off, Z up to safe height,
    // and resumeLine says where "cut from line" picks up.
    run(prog) {
      if (this.busy() || !prog.moves.length) return;
      const live = prog.spindle !== false && !prog.preview;
      const parsed = prog.sbp && root.SwarfRunParse ? root.SwarfRunParse.parse(prog.sbp) : null;
      const events = (parsed ? parsed.events : []).slice().sort((a, b) => a.line - b.line);
      const ops = [];
      let out = this.outputs, e = 0, moved = false;
      const set = (bit, on) => { const w = on ? out | bit : out & ~bit; if (w !== out) { out = w; ops.push({ out, line: 0 }); if (on && bit & SPINDLE) ops.push({ dwell: this.cfg.spinUp, line: 0 }); } };
      const event = ev => {
        const k = ev.kind;
        if (live && k === 'spindle-on') set(SPINDLE, true);
        else if (live && k === 'spindle-off') set(SPINDLE, false);
        else if (live && k === 'output' && ev.value[0] >= 1 && ev.value[0] <= 12) set(1 << (ev.value[0] - 1), ev.value[1] === 1);
        else if (k === 'pause' && ev.value > 0) ops.push({ dwell: ev.value, line: ev.line });
        else if (moved && (k === 'tool-change' || k === 'pause')) ops.push({ hold: k, line: ev.line });
      };
      if (live) set(SPINDLE, true);
      for (const m of prog.moves) {
        while (e < events.length && events[e].line < m.line) event(events[e++]);
        const feed = m.rapid ? (m.z !== m.z0 && m.x === m.x0 && m.y === m.y0 ? this.cfg.jog.z : this.cfg.jog.xy) : (m.feed || this.cfg.move.xy);
        ops.push(Object.assign(this.machine(m), { feed, line: m.line || 0, work: m }));
        moved = true;
      }
      while (e < events.length) event(events[e++]);
      set(SPINDLE, false);
      if (out !== this.outputs) ops.push({ out: this.outputs, line: 0 });
      // a hold ends the job: spindle off, then up to safe Z over the same spot
      const h = ops.findIndex(o => o.hold);
      if (h >= 0) {
        const hold = ops[h];
        const last = [...ops.slice(0, h)].reverse().find(o => o.work);
        ops.length = h;
        ops.push({ out: this.outputs, line: hold.line });
        if (last && last.work.z < this.cfg.safeZ) ops.push(Object.assign(this.machine({ ...last.work, z: this.cfg.safeZ }), { feed: this.cfg.jog.z, line: hold.line }));
        this.holdAt = hold;
      } else this.holdAt = null;
      this.job = { ops, spindle: live };
      this.set({ running: true, paused: false, preview: false, line: 0, spindle: live, stopHit: false, resumeLine: 0, note: 'running' });
      this.go(ops);
    }

    async go(ops) {
      try {
        await this.stack(ops);
      } catch (e) {
        this.set({ running: false, moving: false, spindle: false, note: e.message });
        return;
      }
      const at = this.planner.at;
      if (this.halted === 'pause') {
        // continue later from the move it stopped in: the tool is on that line
        const i = ops.findIndex(o => o.line === at.line && o.out === undefined && o.dwell === undefined);
        this.job.rest = i >= 0 ? ops.slice(i) : [];
        this.halted = null;
        await this.card.cmd([0xF0, 0, 0, 0xFF, 0xFF, 0xFF]).catch(() => {});
        this.set({ paused: true, spindle: false, note: 'paused' });
        return;
      }
      const stopped = this.halted === 'stop';
      this.halted = null;
      if (stopped) await this.card.cmd([0xF0, 0, 0, 0xFF, 0xFF, 0xFF]).catch(() => {});
      this.job = null;
      const hold = !stopped && this.holdAt;
      this.holdAt = null;
      if (hold) {
        const next = hold.line + 1;
        this.set({ running: false, paused: false, spindle: false, stopHit: true, resumeLine: next,
          note: hold.hold === 'tool-change'
            ? `tool change at line ${hold.line}: change the bit, zero Z, then cut from line ${next}`
            : `the file pauses at line ${hold.line}: cut from line ${next} to go on` });
        return;
      }
      this.set({ running: false, paused: false, spindle: false, note: stopped ? 'stopped' : 'program finished' });
    }

    pause() {
      if (!this.state.running || this.state.paused) return;
      this.halted = 'pause';
      this.planner.stop();
    }

    resume() {
      if (!this.state.paused || !this.job || !this.job.rest) return;
      const rest = this.job.rest;
      const ops = this.job.spindle ? [{ out: this.outputs | SPINDLE, line: 0 }, { dwell: this.cfg.spinUp, line: 0 }, ...rest] : rest;
      this.job.rest = null;
      this.set({ paused: false, spindle: this.job.spindle, note: 'running' });
      this.go(ops);
    }

    stop() {
      if (this.state.paused) {
        this.job = null;
        this.set({ running: false, paused: false, spindle: false, note: 'stopped' });
        return;
      }
      if (this.card && this.card.streaming) { this.halted = 'stop'; this.planner.stop(); }
    }

    answer(v) { if (v === 1) this.resume(); else this.stop(); }
  }

  M.DirectMachine = DirectMachine;
})(window);
