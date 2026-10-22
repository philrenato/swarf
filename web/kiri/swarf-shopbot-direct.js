/**
 * swarf shopbot — Run mode's third back end: the ShopBot control box driven
 * straight from this page over WebUSB (Chrome/Edge) or the COM port (Windows).
 * Same interface as SimMachine in swarf-run-machine.js.
 *
 * Coordinates: the card counts steps from its own power-up. Work zero is an
 * origin in steps kept here (and in localStorage for a reload while the box
 * stays on); pos = (steps - origin) / unit.
 *
 * Settings default to the shop machine's own (metric): VU, VS, VR, VL.
 */
(function (root) {
  'use strict';
  // the deploy stamps every machine-control file; connect refuses a page that mixes two builds
  (typeof window !== 'undefined' ? window : globalThis).SWARF_BUILDS = Object.assign((typeof window !== 'undefined' ? window : globalThis).SWARF_BUILDS || {}, { 'swarf-shopbot-direct.js': '__SWARF_BUILD__' });

  const M = root.SwarfRunMachine;
  const { ShopBotCard, Planner } = root.ShopBotCard;
  const ShopBotLink = root.ShopBotLink;

  const SHOP = {
    unit: { x: 72.183661, y: 72.183661, z: 90.229567 },        // [VU] steps/mm
    move: { xy: 76.2, z: 25.4 }, jog: { xy: 100, z: 100 },      // [VS] mm/s
    rampSpeed: 10.16, rampRate: 5.08,                           // [VR]
    spinUp: 3,                                                  // s after the spindle starts
    safeZ: 25.4                                                 // work mm, Run mode's SAFE_Z
  };
  // the router: outputs 1 and 4 (Phil 10-29 at the machine: output 1 alone did not start it; the shop's
  // own router-on sets output 4, then output 1). Off clears both.
  const SPINDLE = 0x009;
  const ORIGIN_KEY = 'swarf-shopbot-origin';
  const FLIP_KEY = 'swarf-shopbot-flip';
  const LOG_MAX = 20000;
  const BIT = { x: 1, y: 2, z: 4 };
  const HOME_KEY = 'swarf-shopbot-home';
  // homing on the shop machine: normally-closed proximity sensors, X on input 2,
  // Y on input 3, reading 0 when covered; offset -0.5 in; fast seek <= 88.9 mm/s, back off 25.4 mm, slow seek <= 25.4 mm/s.
  const HOME = { x: { input: 2, hit: 0 }, y: { input: 3, hit: 0 }, offset: { x: -12.7, y: -12.7 },
    fast: 88.9, slow: 25.4, backOff: 25.4, travel: { x: 2600, y: 1400 }, block: 15, confirmed: false };
  const PLATE_KEY = 'swarf-shopbot-plate';
  const UNKNOWN = 'not now: swarf can\'t tell whether the router is on. Press the red e-stop on the floor, then all clear';
  // a pressed e-stop and an e-stop swarf could not read are two different things (third review #1)
  const STOP_KEY = 'swarf-shopbot-stop', STOP_DEFAULT = { input: 8, rest: 0 };
  const STOP_WORDS = {
    pressed: 'the e-stop reads pressed: release the red e-stop on the floor first',
    unread: 'swarf could not read the e-stop just now: check the USB cable and that the box is on, then try again'
  };
  // the Z plate on the shop machine: clip on input 1, reading 1 on contact;
  // plate 0.121 in; first plunge 0.5 in/s, second 0.25 in/s, lift 1.0 in
  // between and after.
  // travel: swarf stops after 60 mm (search down on the plate card raises it). The guide
  // starts the bit 25-50 mm over the board and proves the clip circuit first, so a seek
  // that still misses contact ends at most ~35 mm below the board's top, not 230.
  const PLATE = { input: 1, hit: 1, thickness: 3.0734, fast: 12.7, slow: 6.35, lift: 25.4, travel: 60, confirmed: false };

  class DirectMachine extends M.Base {
    constructor(cfg = {}) {
      super();
      this.cfg = Object.assign({}, SHOP, cfg);
      // a program's rapids keep the shop speed; the jog row only changes cfg.jog,
      // and a jog never moves Z faster than 1000 mm/min, from the first connect on
      this.cfg.rapid = { ...this.cfg.jog };
      this.cfg.zJogMax = this.cfg.zJogMax || 1000 / 60;
      this.cfg.jog = { xy: this.cfg.jog.xy, z: Math.min(this.cfg.jog.z, this.cfg.zJogMax) };
      this.state.kind = 'shopbot';
      this.state.note = 'not connected';
      this.planner = new Planner({ unit: this.cfg.unit, rampSpeed: this.cfg.rampSpeed, rampRate: this.cfg.rampRate, maxFeed: 254 });   // 15240 mm/min, the machine's top
      this.origin = { x: 0, y: 0, z: 0 };
      this.steps = { x: 0, y: 0, z: 0 };
      this.outputs = 0;
      this.job = null;        // { ops, resumeAt } while a program runs
      this.flip = { x: false, y: false, z: false };
      this.traffic = [];
      try { Object.assign(this.origin, JSON.parse(localStorage.getItem(ORIGIN_KEY)) || {}); } catch (e) { /* none saved */ }
      try { Object.assign(this.flip, JSON.parse(localStorage.getItem(FLIP_KEY)) || {}); } catch (e) { /* none saved */ }
      this.homeCfg = JSON.parse(JSON.stringify(HOME));
      try { Object.assign(this.homeCfg, JSON.parse(localStorage.getItem(HOME_KEY)) || {}); } catch (e) { /* none saved */ }
      this.plateCfg = Object.assign({}, PLATE);
      try { Object.assign(this.plateCfg, JSON.parse(localStorage.getItem(PLATE_KEY)) || {}); } catch (e) { /* none saved */ }
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
    // An off that did not land latches the router as unknown (third review #3): nothing moves
    // or starts until an off reaches the card (recover) or the box is connected again.
    // The feed override (Phil 10-29, like the MR-1's): cuts only, 50 to 150 % in 5 % steps, never
    // past the machine's top speed; a raise ramps in, a cut slows at once.
    setOverride(pct) {
      const v = Math.max(50, Math.min(150, Math.round(pct / 5) * 5));
      this.planner.override = v / 100;
      this.set({ override: v });
      return v;
    }

    // The router on by hand, to test it (Phil 10-29, a button in the jog pad): on until the button,
    // any key, the e-stop or 60 s turns it off. Nothing moves while it runs (busy), and the e-stop
    // is read ten times a second (a momentary press is short).
    async routerTest(on) {
      const word = w => [0xF0, w & 0xFF, (w >> 8) & 0x0F, 0xFF, 0xFF, 0xFF];
      if (on) {
        if (this.busy() || this.routerTesting || this.routerWarning) return false;
        if (this.state.routerUnknown) throw new Error(UNKNOWN);
        // the warning sound first, then a moment, then the router (Phil 10-29: a reminder before it starts)
        this.routerWarning = true;
        try {
          this.set({ note: 'the router is about to start' });
          this.cue('router');
          await new Promise(r => setTimeout(r, this.cfg.routerWarnMs ?? 1200));
        } finally { this.routerWarning = false; }
        if (!this.card || this.busy()) return false;
        const stop = await this.freshStop();
        if (stop !== 'clear') throw new Error(STOP_WORDS[stop]);
        await this.card.cmd(word(this.outputs | SPINDLE));
        this.routerTesting = true;
        clearTimeout(this.routerTimer);
        this.routerTimer = setTimeout(() => this.routerTest(false), 60000);
        this.set({ spindle: true, routerTest: true, note: 'the router is on (a test): press the router button or any key to stop it' });
        this.poll();
        return true;
      }
      if (!this.routerTesting) return true;
      clearTimeout(this.routerTimer);
      let off = this.card ? await this.card.cmd(word(this.outputs)).then(() => true, () => false) : false;
      if (!off) off = await this.outputsOff();
      this.routerTesting = false;
      this.set({ spindle: false, routerTest: false, routerUnknown: !off || this.state.routerUnknown,
        note: off ? 'the router is switched off; the bit coasts to a stop' : 'the router may still be on: the off did not reach the card. Press the red e-stop on the floor' });
      return off;
    }

    async testOutput(n, ms = 2000) {
      if (this.busy()) return false;
      if (this.state.routerUnknown) throw new Error(UNKNOWN);
      const stop = await this.freshStop();
      if (stop !== 'clear') throw new Error(STOP_WORDS[stop]);
      const on = this.outputs | (n === 1 ? SPINDLE : 1 << (n - 1));
      const word = w => [0xF0, w & 0xFF, (w >> 8) & 0x0F, 0xFF, 0xFF, 0xFF];
      this.testing = true;
      let off = false;
      try {
        await this.card.cmd(word(on));
        this.set({ spindle: n === 1, note: `output ${n} on` });
        await new Promise(r => setTimeout(r, ms));
      } finally {
        off = await this.card.cmd(word(this.outputs)).then(() => true, () => false);
        if (!off) off = await this.outputsOff();
        this.testing = false;
        // the card took the off; a router still coasts down for a few seconds after it
        this.set({ spindle: false, routerUnknown: !off || this.state.routerUnknown,
          note: !off ? `output ${n} may still be on: the off did not reach the card. Press the red e-stop on the floor` : n === 1 ? 'the router is switched off; the bit coasts to a stop' : `output ${n} switched off` });
      }
      return off;
    }

    // every output off; when the card takes it, the router's state is known again (all clear)
    async recover() {
      if (!this.card || this.state.running) return false;
      const off = await this.outputsOff();
      if (off) this.set({ routerUnknown: false, spindle: false });
      return off;
    }

    // A fresh reading of the e-stop (its input, stopCfg) before anything moves or switches on (third review
    // #1): 'clear', 'pressed', or 'unread' when no reading came. An old reading never stands in.
    async freshStop() {
      // a momentary e-stop let go is still a stop: nothing moves again on this link (Phil 10-29)
      if (this.estopPending) return 'pressed';
      if (this.card && !this.card.streaming) {
        let st = null;
        try { st = await this.card.status(); } catch (e) { return 'unread'; }
        if (!st) return 'unread';
        this.read(st);
        return this.stopClear() ? 'clear' : 'pressed';
      }
      // while the card streams, its acks carry the inputs: they must be this second's
      const fresh = this.inputsAt && performance.now() - this.inputsAt < 1000;
      return !fresh ? 'unread' : this.stopClear() ? 'clear' : 'pressed';
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

    static supported() { return ShopBotLink.supported(); }
    static async known() { return DirectMachine.supported() && !!(await ShopBotLink.known().catch(() => null)); }

    // ask: true from a click (Chrome shows its device chooser once).
    async connect(ask) {
      let link = await ShopBotLink.known().catch(() => null);
      if (!link && ask) link = await ShopBotLink.request();
      if (!link) { this.set({ note: 'no ShopBot on USB' }); return false; }
      try {
        await link.open();
      } catch (e) {
        await link.close();
        this.set({ note: /COM port is in use/.test(e.message)
          ? 'ShopBot 3 or another program has the COM port open: quit it and connect again'
          : /claim|busy|access|in use/i.test(e.message)
          ? 'another tab or program has the box open: close it and connect again'
          : `the USB link would not open (${e.message})` });
        return false;
      }
      link.onClose = () => this.lost();
      const m = await link.modem().catch(() => null);
      this.link = link;
      this.card = new ShopBotCard(link, { size: 149, timeoutMs: this.cfg.timeoutMs || 5000 });
      const write = link.write.bind(link), recv = link.onData;
      link.write = b => { this.record('>', b); return write(b); };
      link.onData = b => { this.record('<', b); recv(b); };
      try {
        const st = await this.card.status();
        await this.card.setBlocks(2);
        await this.card.cmd([0xF0, 0, 0, 0xFF, 0xFF, 0xFF]);
        await this.card.motors(true);
        // Real box 10-27: the first move straight after motors-on was counted but never moved (X, then Z); the drives need a moment.
        await new Promise(r => setTimeout(r, this.cfg.motorWakeMs ?? 500));
        this.read(st);
      } catch (e) {
        link.onClose = null;
        this.link = null;
        await link.close();
        // CTS/DSR read 0 on the real box even while it answers (10-27), so they say nothing here
        this.set({ connected: false, note: `the box did not answer: switch it on, pull the red stop buttons out, press the blue reset (${e.message})` });
        return false;
      }
      if (ShopBotLink.worked) ShopBotLink.worked(link);
      this.linkNo = (this.linkNo || 0) + 1;     // a plan made on an earlier link will not run on this one
      this.set({ connected: true, routerUnknown: false, estopped: false, note: 'ShopBot connected over USB' });   // every output was sent off above
      this.poll();
      return true;
    }

    // The e-stop was pressed (Phil 10-29): when the machine is at rest, every output off and swarf lets
    // go of it. Connecting again is the student's say-so that the machine is safe, and clears it.
    async estopped() {
      if (!this.link || this.estopping) return;
      this.estopping = true;
      clearTimeout(this.timer);
      this.quiet();
      const off = await this.outputsOff().catch(() => false);
      const link = this.link;
      link.onClose = null;
      this.link = null; this.card = null;
      try { await link.close(); } catch (e) { /* unplugged already */ }
      this.estopPending = false; this.remoteStop = false; this.estopping = false;
      this.set({ connected: false, running: false, moving: false, spindle: false, routerUnknown: !off, estopped: true,
        note: `stopped by the e-stop (input ${this.stopCfg().input}): swarf let go of the machine` });
    }

    // Let go of the box (Windows 10-29: the COM port takes one program at a time, so going back to
    // ShopBot 3 needs swarf to close it). Only at rest; every output is switched off first, and an
    // off that did not land keeps the link (the router's state would be unknown).
    async disconnect() {
      if (!this.link) return true;
      if (this.busy() || this.state.moving) { this.set({ note: 'stop the job before you disconnect' }); return false; }
      if (!(await this.outputsOff())) { this.set({ routerUnknown: true, note: 'the off did not reach the card: press the red e-stop on the floor' }); return false; }
      clearTimeout(this.timer);
      this.quiet();
      const link = this.link;
      link.onClose = null;
      this.link = null; this.card = null;
      try { await link.close(); } catch (e) { /* unplugged already */ }
      this.set({ connected: false, spindle: false, routerUnknown: false, note: 'disconnected: the box is free for another program' });
      return true;
    }

    // A dropped link mid-job is never a finish (Fable review 10-27): the UI keeps
    // the line and asks for a reconnect. Whether the card stops the spindle on
    // its own after a drop is not yet proven on the box.
    lost() {
      clearTimeout(this.timer);
      this.quiet();
      const mid = this.state.running;
      // best known position: what the planner had sent (the card is at most the queued blocks behind)
      if (this.card && this.card.streaming && this.planner.st) this.steps = { ...this.planner.st.cur };
      this.job = null; this.holdAt = null;
      // swarf cannot know what the router does now (review #5): never show it as simply off
      const unknown = mid || this.state.spindle || this.state.routerUnknown;
      this.set({ connected: false, running: false, moving: false, spindle: false, routerUnknown: !!unknown, done: false,
        stopHit: mid || this.state.stopHit, lostMid: mid, note: 'USB link lost' });
    }

    read(st) {
      const f = this.flip;
      this.steps = { x: f.x ? -st.steps.x : st.steps.x, y: f.y ? -st.steps.y : st.steps.y, z: f.z ? -st.steps.z : st.steps.z };
      const u = this.cfg.unit;
      this.set({ pos: this.work(this.steps), mpos: { x: this.steps.x / u.x, y: this.steps.y / u.y, z: this.steps.z / u.z },
        inputs: { lo: st.inputs, hi: st.inputs2 }, flip: { ...f } });
      this.inputsAt = performance.now();
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
        if (this.estopPending && this.link && !this.busy() && !this.state.moving) { this.estopped(); return; }
        // the router on by hand and the e-stop pressed: off at once, then swarf lets go
        if (this.routerTesting && this.state.inputs && !this.stopClear()) {
          clearTimeout(this.routerTimer); this.routerTesting = false; this.estopPending = true;
          this.set({ routerTest: false, note: `stopped by the e-stop (input ${this.stopCfg().input})` });
          this.estopped(); return;
        }
        if (this.card && !this.card.streaming && !this.state.running && !this.testing && !this.homing) {
          try { this.read(await this.card.status()); } catch (e) { /* busy or gone; onClose reports loss */ }
        }
        this.timer = setTimeout(loop, this.routerTesting ? 100 : 400);
      };
      this.timer = setTimeout(loop, this.routerTesting ? 100 : 400);
    }

    busy() { return !this.card || this.card.streaming || this.state.running || !!this.testing || !!this.homing || !!this.routerTesting; }

    // Run ops (machine mm) as one stack; resolves with the end report.
    // the e-stop's input and its released level. The shop's box (Phil 10-29, at the machine): the
    // red floor button is momentary on input 8, off at rest; ShopBot's usual input 4 is not it.
    // Machine setup's "that's the e-stop" sets another box's.
    stopCfg() {
      try { const v = JSON.parse(localStorage.getItem(STOP_KEY)); if (v && v.input >= 1 && v.input <= 12 && (v.rest === 0 || v.rest === 1)) return v; } catch (e) { /* none saved */ }
      return { ...STOP_DEFAULT };
    }
    setStop(input, rest) {
      try { localStorage.setItem(STOP_KEY, JSON.stringify({ input, rest })); } catch (e) { /* private window */ }
      this.set({ stopInput: input });
    }
    stopRest() { return this.stopCfg().rest; }
    // no reading is not "released" (follow-up review #6): fail closed
    stopClear(inputs) { const i = inputs || this.state.inputs, c = this.stopCfg(); return !!i && this.level(i, c.input) === c.rest; }

    async stack(ops, hook) {
      // a fresh reading of the e-stop before anything moves (follow-up review #6), not the last poll's
      const stop = await this.freshStop();
      if (stop !== 'clear') { const e = new Error(STOP_WORDS[stop]); e.refused = true; throw e; }
      if (!this.state.running) this.remoteStop = false;
      const from = this.work(this.steps);
      const start = this.machine(from);
      // every motion, a jog, a seek or a job, meets the same move check before the card sees it (third review #5)
      for (let i = 0, a = start; i < ops.length; i++) {
        const o = ops[i];
        if (o.out !== undefined || o.dwell !== undefined) continue;
        const why = root.SwarfRunPlan.segProblem(a, o, o.feed, this.planCfg(), o.work && o.work.rapid);
        if (why) { const e = new Error(`not moved: a move ${why}`); e.refused = true; throw e; }
        a = o;
      }
      this.set({ moving: true });
      const p = this.planner;
      let end;
      try {
        end = await this.card.run(p.items(ops, start), {
          onAck: ack => {
            const inputs = { lo: ack.inputs, hi: ack.inputs2 };
            this.inputsAt = performance.now();
            // every motion, a jog or a seek as much as a cut, stops on the remote stop
            if (!this.stopClear(inputs) && !this.remoteStop) { this.remoteStop = true; this.estopPending = true; if (this.state.running) this.halted = 'stop'; this.planner.stop(); this.set({ note: `stopped by the e-stop (input ${this.stopCfg().input})` }); }
            if (hook) hook(inputs, ack);
            if (p.st) this.set({ pos: this.work(p.st.cur), line: p.st.line > 0 ? p.st.line : this.state.line, inputs });
          }
        });
      } catch (e) {
        if (e.report) this.read(e.report);
        this.set({ moving: false });
        throw e;
      }
      this.read(end);
      this.set({ moving: false });
      return end;
    }

    move(targets, speed) {
      if (this.busy()) return;
      if (this.state.routerUnknown) { this.set({ note: UNKNOWN }); return; }
      for (let i = 0, a = this.state.pos; i < targets.length; a = targets[i++]) { const why = root.SwarfRunPlan.segProblem(a, targets[i], speed(targets[i]), this.planCfg()); if (why) { this.set({ note: `not moved: that move ${why}` }); return; } }
      const ops = targets.map(t => Object.assign(this.machine(t), { feed: speed(t), line: 0 }));
      this.stack(ops).catch(e => this.set({ moving: false, note: e.message })).finally(() => { if (!this.state.running) this.halted = null; });
    }

    jog(axis, dist) {
      if (this.busy()) return;
      const t = { ...this.state.pos };
      t[axis] = this.clamp(axis, t[axis] + dist);
      this.move([t], () => axis === 'z' ? this.cfg.jog.z : this.cfg.jog.xy);
    }

    // Travel limits mean something only once the machine has homed on its switches.
    // The shop machine has none (10-27): no clamp, and a held jog runs until release.
    limitsKnown() { const s = this.homeCfg && this.homeCfg.set; return !!(s && s.x && s.y); }
    clamp(axis, v) { return this.limitsKnown() ? super.clamp(axis, v) : v; }

    // the machine's own position: the card's step count since power-up, in mm
    mabs() { const u = this.cfg.unit; return { x: this.steps.x / u.x, y: this.steps.y / u.y, z: this.steps.z / u.z }; }

    // Type a work position: this spot becomes `v` on `axis`.
    setWork(axis, v) {
      if (this.busy() || !isFinite(v)) return;
      this.origin[axis] = this.steps[axis] - v * this.cfg.unit[axis];
      try { localStorage.setItem(ORIGIN_KEY, JSON.stringify(this.origin)); } catch (e) { /* private window */ }
      this.set({ pos: this.work(this.steps), note: `${axis.toUpperCase()} set to ${v}` });
    }

    jogHold(axis, dir) {
      if (this.busy()) return;
      const t = { ...this.state.pos };
      t[axis] = this.limitsKnown() ? M.LIMITS[axis][dir > 0 ? 1 : 0] : t[axis] + dir * 5000;
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

    // Input n (1-12): 1-8 = the first input byte's bits 0-7 (lo), 9-12 = the second's bits 0-3 (hi).
    level(inputs, n) { return n <= 8 ? (inputs.lo >> (n - 1)) & 1 : (inputs.hi >> (n - 9)) & 1; }

    // Which input a home sensor is on, and the level it reads when covered.
    setHomeSensor(axis, input, hit) {
      this.homeCfg[axis] = { input, hit };
      this.homeCfg.set = Object.assign({}, this.homeCfg.set, { [axis]: true });
      this.homeCfg.confirmed = !!(this.homeCfg.set.x && this.homeCfg.set.y);
      const { x, y, set, confirmed } = this.homeCfg;
      try { localStorage.setItem(HOME_KEY, JSON.stringify({ x, y, set, confirmed })); } catch (e) { /* private window */ }
      this.set({ homeCfg: { ...this.homeCfg } });
    }

    // Home (ShopBot's C3): spindle off, Z to safe height, then for X
    // and Y a fast seek toward the sensor, back off, a slow seek; the slow
    // contact becomes the offset (table -12.7 mm), then park at 0, 0.
    async home() {
      if (this.busy()) return;
      if (this.state.routerUnknown) { this.set({ note: UNKNOWN }); return; }
      const H = this.homeCfg;
      if (!H.confirmed) { this.set({ note: 'set the home sensors in "check the machine" first' }); return; }
      this.read(await this.card.status());
      const covered = ['x', 'y'].filter(a => this.level(this.state.inputs, H[a].input) === H[a].hit);
      if (covered.length) { this.set({ note: `the ${covered.join(' and ').toUpperCase()} home sensor is already covered: jog away from the corner, then home again` }); return; }
      this.homing = true;
      this.homeAbort = false;
      this.homeFail = null;
      this.set({ moving: true, note: 'homing' });
      const u = this.cfg.unit;
      try {
        await this.card.cmd([0xF0, 0, 0, 0xFF, 0xFF, 0xFF]);
        if (this.state.pos.z < this.cfg.safeZ) await this.stack([Object.assign(this.machine({ ...this.state.pos, z: this.cfg.safeZ }), { feed: this.cfg.jog.z, line: 0 })]);
        const fast = Math.min(this.cfg.jog.xy, H.fast), slow = Math.min(this.cfg.move.xy, H.slow);
        for (const a of ['x', 'y']) {
          if (this.homeAbort || this.homeFail) break;
          if (await this.seek(a, fast, H.travel[a]) === null || this.homeAbort) break;
          // back off until the sensor reads clear (the fast seek overshoots by its ramp)
          for (let tries = 0; ; tries++) {
            const back = { ...this.state.pos };
            back[a] += H.backOff;
            await this.stack([Object.assign(this.machine(back), { feed: fast, line: 0 })]);
            if (this.homeAbort) break;
            this.read(await this.card.status());
            if (this.level(this.state.inputs, H[a].input) !== H[a].hit) break;
            if (tries === 2) { this.homeFail = `the ${a.toUpperCase()} home sensor stays covered`; break; }
          }
          if (this.homeAbort || this.homeFail) break;
          // slow pass in short blocks: an ack every few steps places the contact
          await this.card.setBlocks(2, H.block);
          const c = await this.seek(a, slow, H.backOff * 2);
          await this.card.setBlocks(2, 149);
          if (c === null) break;
          this.origin[a] = Math.round(c - H.offset[a] * u[a]);
        }
        if (!this.homeAbort && !this.homeFail) {
          try { localStorage.setItem(ORIGIN_KEY, JSON.stringify(this.origin)); } catch (e) { /* private window */ }
          this.set({ pos: this.work(this.steps) });
          await this.stack([Object.assign(this.machine({ x: 0, y: 0, z: this.state.pos.z }), { feed: this.cfg.jog.xy, line: 0 })]);
        }
      } catch (e) {
        this.homeFail = e.message;
      } finally {
        await this.card.setBlocks(2, 149).catch(() => {});
        const note = this.homeAbort ? 'homing stopped' : this.homeFail ? `homing failed: ${this.homeFail}` : 'homed: X 0, Y 0 is the table corner';
        this.homing = false;
        this.homeFail = null;
        this.set({ moving: false, note });
      }
    }

    // Which input the Z plate is on, and the level it reads on contact.
    setPlate(input, hit) {
      Object.assign(this.plateCfg, { input, hit, confirmed: true });
      this.savePlate();
    }
    // what is kept of the plate: its input, its thickness and how far the bit searches down for it
    savePlate() {
      const { input, hit, confirmed, thickness, travel } = this.plateCfg;
      try { localStorage.setItem(PLATE_KEY, JSON.stringify({ input, hit, confirmed, thickness, travel })); } catch (e) { /* private window */ }
      this.set({ plateCfg: { ...this.plateCfg } });
    }
    // how far the bit comes down looking for the plate, mm (Phil 10-29: 60 by default, more by hand)
    setPlateTravel(t) {
      if (!(t >= 10 && t <= 150)) return false;
      this.plateCfg.travel = t;
      this.savePlate();
      return true;
    }

    // The plate's own thickness, mm (measure it: plates differ). Kept with its input.
    setPlateThickness(t) {
      if (!(t > 0 && t < 50)) return false;
      this.plateCfg.thickness = t;
      this.savePlate();
      return true;
    }

    // Z zero on the plate (ShopBot's C2): outputs off, plunge until the bit touches the
    // plate, Z = plate thickness there, lift, plunge again slower, Z again,
    // lift to safe height. Short blocks on both plunges: an ack every few
    // steps stops the bit soon after contact. Resolves true when zeroed.
    async zZero() {
      if (this.busy()) return false;
      if (this.state.routerUnknown) { this.set({ note: UNKNOWN }); return false; }
      const P = this.plateCfg, u = this.cfg.unit.z;
      if (!P.confirmed) { this.set({ note: 'set the Z plate in "check the machine" first' }); return false; }
      this.read(await this.card.status());
      if (this.level(this.state.inputs, P.input) === P.hit) { this.set({ note: 'the plate already reads contact: lift the bit off the plate, then zero again' }); return false; }
      this.homing = true;
      this.homeAbort = false;
      this.homeFail = null;
      this.set({ moving: true, note: 'zeroing Z on the plate' });
      const sensor = { input: P.input, hit: P.hit }, what = 'Z plate contact';
      let done = false;
      try {
        await this.card.cmd([0xF0, 0, 0, 0xFF, 0xFF, 0xFF]);
        await this.card.setBlocks(2, this.homeCfg.block);
        let travel = P.travel;
        for (const speed of [P.fast, P.slow]) {
          const c = await this.seek('z', Math.min(speed, this.cfg.jog.z), travel, sensor, what);
          if (c === null || this.homeAbort) break;
          this.origin.z = Math.round(c - P.thickness * u);
          this.set({ pos: this.work(this.steps) });
          await this.card.setBlocks(2, 149);
          await this.stack([Object.assign(this.machine({ ...this.state.pos, z: P.lift }), { feed: this.cfg.jog.z, line: 0 })]);
          if (this.homeAbort) break;
          this.read(await this.card.status());
          if (this.level(this.state.inputs, P.input) === P.hit) { this.homeFail = 'the plate still reads contact with the bit lifted: check the clip and the plate'; break; }
          await this.card.setBlocks(2, this.homeCfg.block);
          travel = P.lift - P.thickness + 12.7;
          if (speed === P.slow) done = true;
        }
        if (done) { try { localStorage.setItem(ORIGIN_KEY, JSON.stringify(this.origin)); } catch (e) { /* private window */ } }
      } catch (e) {
        this.homeFail = e.message;
      } finally {
        await this.card.setBlocks(2, 149).catch(() => {});
        done = done && !this.homeAbort && !this.homeFail;
        const far = /^no Z plate contact within/.test(this.homeFail || '') ? ': bring the bit closer to the plate, or raise "search down" on the plate card' : '';
        const note = this.homeAbort ? 'Z zero stopped' : this.homeFail ? `Z zero failed: ${this.homeFail}${far}` : 'Z zeroed on the plate: put the plate away';
        this.homing = false;
        this.homeFail = null;
        this.set({ moving: false, note });
      }
      return done;
    }

    // Move toward -axis until the sensor reads its hit level; the contact is
    // the middle of the ack window it first showed in (one step per tick on
    // a one-axis move). Returns the contact in steps, or null.
    async seek(a, speed, travel, sensor = this.homeCfg[a], what = `${a.toUpperCase()} home sensor`) {
      const start = this.steps[a];
      const t = { ...this.state.pos };
      t[a] -= travel;
      let ran = 0, contact = null;
      await this.stack([Object.assign(this.machine(t), { feed: speed, line: 0 })], (inputs, ack) => {
        const was = ran;
        ran += ack.ticks;
        if (contact === null && this.level(inputs, sensor.input) === sensor.hit) {
          contact = start - (was + ran) / 2;
          this.planner.stop();
        }
      });
      if (contact === null && !this.homeAbort) this.homeFail = `no ${what} within ${Math.round(travel)} mm`;
      return contact;
    }

    // prog.moves are work mm; rapids at jog speed. With the spindle allowed
    // (not trace/air), output 1 comes on at the start with a spin-up dwell
    // and goes off at the end, and the file's own SO / C6 / C7 / timed PAUSE
    // run in order with the motion. A tool change or an untimed PAUSE after
    // the first move ends the job there: spindle off, Z up to safe height,
    // and resumeLine says where "cut from line" picks up.
    // The job plan (swarf-run-plan.js) holds every move and switch; the driver only turns it into
    // the card's machine millimeters and output words. A plan that asks to be armed runs only armed.
    planCfg() { return { safeZ: this.cfg.safeZ, rapid: this.cfg.rapid, move: this.cfg.move, jog: this.cfg.jog, spinUp: this.cfg.spinUp, changeZ: this.cfg.changeZ, unit: this.cfg.unit, tickHz: root.ShopBotCard.TICK_HZ }; }
    // what a plan is for: this zero, on this link (a reconnect or a new zero makes a new plan)
    planCtx() { const o = this.origin; return { machine: 'shopbot', link: this.linkNo || 0, origin: [Math.round(o.x), Math.round(o.y), Math.round(o.z)] }; }
    plan(prog) {
      return root.SwarfRunPlan.build(prog, { pos: this.state.pos, live: prog.spindle !== false && !prog.preview, cfg: this.planCfg(), ctx: this.planCtx() });
    }

    // Only a plan swarf made, the student confirmed, and nothing changed since runs (third review
    // #2, #4): a bare program, an unconfirmed plan, a plan whose fingerprint no longer matches, or
    // one made for another zero or link is refused, and so is any plan while the router's state
    // is unknown. Returns why not, or ''.
    refuse(plan) {
      const R = root.SwarfRunPlan;
      if (!plan || !plan.steps) return 'not run: swarf runs only a plan it has checked and you have confirmed';
      if (!R.verify(plan)) return 'not run: this plan changed after it was made';
      if (!plan.armed) return 'not run: this plan was not confirmed';
      if (JSON.stringify(plan.ctx) !== JSON.stringify(this.planCtx())) return 'not run: the zero or the connection changed since this plan was made';
      if (this.state.routerUnknown) return UNKNOWN;
      // a plan made from where the bit was must start from there
      const p = this.state.pos;
      if (plan.from && Math.hypot(p.x - plan.from.x, p.y - plan.from.y, p.z - plan.from.z) > 0.05) return 'not run: the bit has moved since this plan was made';
      if (plan.problems.length) return `${plan.problems[0]}: not run`;
      // the e-stop as last read; stack() reads it fresh before anything is sent
      if (!this.stopClear()) return STOP_WORDS[this.state.inputs ? 'pressed' : 'unread'];
      return '';
    }

    // the plan's steps as the card's ops: machine millimeters and whole output words. `out` is the
    // word the card has now. The router's cue rides on the move just before the router starts.
    opsOf(plan, out) {
      const ops = [];
      const word = w => { if (w !== out) { const on = (w & 1) && !(out & 1); out = w; const op = { out: w, line: 0 }; if (on) { const prev = ops[ops.length - 1]; (prev && prev.out === undefined && prev.dwell === undefined ? prev : op).cue = () => this.cue('router'); } ops.push(op); } };
      plan.steps.forEach((s, si) => {
        // cut: a program move that is not a rapid, the moves the feed override scales
        if (s.move) ops.push(Object.assign(this.machine(s.move), { feed: s.feed, line: s.line, si, cut: s.phase === 'program' && !(s.work && s.work.rapid), ...(s.work ? { work: s.work } : {}) }));
        else if (s.router !== undefined) word(s.router ? out | SPINDLE : out & ~SPINDLE);
        else if (s.out) word(s.on ? out | (1 << (s.out - 1)) : out & ~(1 << (s.out - 1)));
        else if (s.dwell) ops.push({ dwell: s.dwell, line: s.line, si });
        else if (s.restore) word(this.outputs);
      });
      return ops;
    }

    run(plan) {
      if (this.busy()) return;
      const why = this.refuse(plan);
      if (why) { this.set({ note: why }); return; }
      const ops = this.opsOf(plan, this.outputs);
      this.holdAt = plan.hold;
      this.job = { ops, spindle: plan.live, plan };
      this.halted = null;   // a stop pressed during an earlier jog must not end this job
      this.set({ running: true, paused: false, preview: false, line: 0, spindle: plan.live, stopHit: false, resumeLine: 0, done: false, lostMid: false, toolChange: false, coasting: false, note: 'running' });
      this.go(ops);
    }

    // a sound for the people near the machine (swarf-sound.js through the page); pending ones
    // go when the job stops
    cue(name, ms) {
      if (!this.onCue) return;
      if (ms) { this.cueT = setTimeout(() => { this.cueT = 0; this.set({ coasting: false }); this.onCue(name); }, ms); return; }
      this.onCue(name);
    }
    quiet() { clearTimeout(this.cueT); this.cueT = 0; if (this.state.coasting) this.set({ coasting: false }); }

    async go(ops) {
      this.remoteStop = false;
      this.quiet();
      this.cue('move');
      try {
        await this.stack(ops);
      } catch (e) {
        if (e.refused) {
          // refused before anything was sent (the e-stop read): nothing moved, nothing switched
          this.job = null; this.holdAt = null;
          this.set({ running: false, moving: false, spindle: false, done: false, note: e.message });
          return;
        }
        this.quiet();
        // the stream ended without its end: switch every output off on the card itself
        let off = false;
        if (this.card) off = await this.card.cmd([0xF0, 0, 0, 0xFF, 0xFF, 0xFF]).then(() => true, () => false);
        this.set({ running: false, moving: false, spindle: false, routerUnknown: !off, done: false, stopHit: true, lostMid: true,
          note: off ? e.message : `${e.message}; the router may still be on: press the floor e-stop` });
        return;
      }
      const at = this.planner.at;
      if (this.halted === 'pause') {
        // continue later from the move it stopped in (by the op itself: an arc is many
        // moves on one line, and resuming from the line's first would cut a chord)
        const i = at && at.op ? ops.indexOf(at.op) : ops.findIndex(o => o.line === at.line && o.out === undefined && o.dwell === undefined);
        this.job.rest = i >= 0 ? ops.slice(i) : [];
        this.job.restStep = i >= 0 && ops[i].si !== undefined ? ops[i].si : this.job.plan.steps.length;
        this.job.haltAt = { ...this.state.pos };
        this.halted = null;
        // the router off has to land, or its state is unknown (follow-up review #3)
        const off = await this.outputsOff();
        this.set({ paused: true, spindle: false, routerUnknown: !off, note: off ? 'paused' : 'paused; the router off did not reach the card' });
        return;
      }
      const stopped = this.halted === 'stop';
      this.halted = null;
      if (stopped) this.quiet();
      if (stopped && !(await this.outputsOff())) this.set({ routerUnknown: true });
      const live = this.job && this.job.spindle;
      this.job = null;
      const hold = !stopped && this.holdAt;
      this.holdAt = null;
      if (hold) {
        const next = hold.line + 1;
        this.set({ running: false, paused: false, spindle: false, stopHit: true, resumeLine: next, toolChange: hold.hold === 'tool-change',
          note: hold.hold === 'tool-change'
            ? `tool change at line ${hold.line}: change the bit, zero Z, then cut from line ${next}`
            : `the file pauses at line ${hold.line}: cut from line ${next} to go on` });
        return;
      }
      const remote = this.remoteStop; this.remoteStop = false;
      // finished: a cut's router was switched off, and its bit coasts down before anyone reaches in;
      // the chime waits for that (third review #6)
      const coast = !stopped && live ? this.coastMs() : 0;
      this.set({ running: false, paused: false, spindle: false, done: !stopped, coasting: !!coast, note: remote ? `stopped by the e-stop (input ${this.stopCfg().input})` : stopped ? 'stopped' : 'program finished' });
      if (!stopped) this.cue('done', coast);
      if (remote) await this.estopped();
    }

    pause() {
      if (!this.state.running || this.state.paused) return;
      this.halted = 'pause';
      this.planner.stop();
    }

    // every output off, and whether the card said so
    outputsOff() { return this.card ? this.card.cmd([0xF0, 0, 0, 0xFF, 0xFF, 0xFF]).then(() => true, () => false) : Promise.resolve(false); }

    // Resume is a plan of its own (third review #5): straight up where the bit stopped, the router
    // on up there, the file's outputs as they were, slowly back down, then the rest of the job.
    // The page shows it and arms it like any other; never the router with the bit in the cut.
    resumePlan() {
      if (!this.state.paused || !this.job || !this.job.rest) return null;
      return root.SwarfRunPlan.resumeFrom(this.job.plan, this.job.restStep, this.job.haltAt, this.planCfg());
    }
    async resume(plan) {
      if (!this.state.paused || !this.job || !this.job.rest) return;
      if (this.state.routerUnknown) { this.set({ note: 'not resumed: the router\'s state is unknown. Press the red e-stop on the floor, then end the job' }); return; }
      const why = this.refuse(plan) || (plan.resumes !== this.job.plan.id ? 'not resumed: that plan does not continue this job' : '');
      if (why) { this.set({ note: why }); return; }
      // the e-stop read fresh before the job is touched: a refusal leaves it paused, ready to resume
      const stop = await this.freshStop();
      if (stop !== 'clear') { this.set({ note: STOP_WORDS[stop] }); return; }
      if (!this.state.paused || !this.job || !this.job.rest) return;
      // everything was switched off at the pause: the card's word is 0
      const ops = this.opsOf(plan, 0);
      this.job = { ops, spindle: plan.live, plan };
      this.holdAt = plan.hold;
      this.set({ paused: false, spindle: plan.live, note: 'running' });
      this.go(ops);
    }

    // how long the router coasts after its off: 30 s (Phil 10-29); swarf-shopbot-coast, s, overrides it
    coastMs() { try { const v = +localStorage.getItem('swarf-shopbot-coast'); return (v > 0 && v < 120 ? v : 30) * 1000; } catch (e) { return 30000; } }

    stop() {
      if (this.state.paused) {
        this.job = null;
        this.set({ running: false, paused: false, spindle: false, note: 'stopped' });
        return;
      }
      if (this.homing) this.homeAbort = true;
      if (this.card && this.card.streaming) { if (!this.homing) this.halted = 'stop'; this.planner.stop(); }
    }

    answer(v) { if (v === 1) this.resume(); else this.stop(); }
  }

  M.DirectMachine = DirectMachine;
})(window);
