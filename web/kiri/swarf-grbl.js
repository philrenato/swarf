/**
 * swarf grbl — Run mode's back end for a GRBL 1.1 controller (the MR-1), over Web Serial.
 * Same interface as SimMachine in swarf-run-machine.js and DirectMachine in
 * swarf-shopbot-direct.js, so the control panel drives either one.
 *
 *   const m = new SwarfGrbl.GrblMachine({ transport })   // transport: a link or async (ask) => link; omitted: Web Serial
 *   await m.connect(ask)       restart banner, lock, $$ read, $# read, status every 200 ms
 *   await m.home()             $H, required once per connection
 *   m.jog(axis, mm) / m.jogHold(axis, dir) / m.jogRelease() / m.goTo({x, y, z})
 *   await m.zero('xy' | 'z' | 'xyz')     G10 L20 P1 (G54), sent alone
 *   const plan = m.plan(prog); m.run(SwarfRunPlan.arm(plan))
 *   m.pause() / m.resume() / m.stop()
 *
 * Positions: state.pos is work mm (G54), state.mpos is machine mm. The board's own reports may be
 * in inches ($13=1); every position, probe result, offset and feed read from it is turned into
 * millimeters here, and every command that carries numbers says G21 itself.
 *
 * Machine coordinates after homing (the MR-1's signs): X runs 0..+travel, Y -travel..0,
 * Z -travel..0. With soft limits off the board checks nothing, so every target swarf sends is
 * clamped to that box less a 2 mm margin.
 *
 * A link is anything with open({ baud }) / write(Uint8Array) / close() and the callbacks
 * onData(Uint8Array) / onClose(err); GrblSerial below is the Web Serial one. Tests pass a fake.
 */
(function (root) {
  'use strict';
  const G = typeof window !== 'undefined' ? window : globalThis;
  // the deploy stamps every machine-control file; connect refuses a page that mixes two builds
  G.SWARF_BUILDS = Object.assign(G.SWARF_BUILDS || {}, { 'swarf-grbl.js': '__SWARF_BUILD__' });

  const VID = 0x16D0, PID = 0x103E, BAUD = 115200;
  const RX = 128;            // the board's receive buffer: bytes in flight stay under this, or under the
                             // smaller size $I reports
  const LINE_MAX = 80;       // the board's line buffer: a line this long or longer is refused (error 11)
  const IN = 25.4;
  const PREAMBLE = ['G21', 'G90', 'G94', 'G17', 'G54'];
  // the end of every job: wait for the planner to empty, then the spindle down to zero, a moment, off
  const END = ['G4P0', 'S0', 'G4P1', 'M5'];
  const RT = { status: 0x3F, hold: 0x21, start: 0x7E, reset: 0x18, jogCancel: 0x85, feed100: 0x90, feedUp10: 0x91, feedDown10: 0x92, feedUp1: 0x93, feedDown1: 0x94 };

  // what the board's alarms mean, in swarf's words
  const ALARMS = {
    1: 'a limit switch was hit: the machine\'s position is lost. Home again before anything else',
    2: 'a move went past the travel the board allows: the position is kept. Check the file, then unlock',
    3: 'the board was reset while it was moving: the position is lost. Home again',
    4: 'the probe already read contact before the search began: check the probe and its wire, then try again',
    5: 'the probe search found nothing within its distance: bring it closer, then try again',
    6: 'homing stopped: the board was reset during homing. Home again',
    7: 'homing stopped: the safety door opened. Home again',
    8: 'homing failed: a switch stayed pressed after pulling off. Check the switches, then home again',
    9: 'homing failed: a switch was not found within the travel. Check the switches and their wires, then home again',
    10: 'homing failed: the second switch on a two-motor axis was not found. Home again'
  };
  // alarms after which the machine's position cannot be trusted
  const LOSES_POSITION = new Set([1, 3, 6, 7, 8, 9, 10]);
  const ERRORS = {
    1: 'a letter with no number', 2: 'a number it could not read', 3: 'a $ command it does not know', 4: 'a negative value where none is allowed',
    5: 'homing is not enabled', 8: 'a $ command while the machine was busy', 9: 'a command while the machine was locked or jogging',
    10: 'soft limits need homing', 11: 'a line too long', 15: 'a jog past the travel', 16: 'a jog command it could not read',
    20: 'a G-code or M-code it does not support', 21: 'two commands from the same group on one line', 22: 'a move with no feed rate',
    23: 'a number that must be whole', 24: 'two commands on one line that both need axis words', 25: 'a word repeated on one line',
    26: 'a command with no axis words', 27: 'a line number out of range', 28: 'a command missing a value', 31: 'axis words nothing uses',
    32: 'an arc with no axis words in its plane', 33: 'an arc or move whose target does not work out', 34: 'an arc whose radius does not work out',
    35: 'an arc with no centre offset in its plane', 36: 'words nothing uses', 38: 'a tool number over 255'
  };
  const errorWords = n => ERRORS[n] || 'a line it refused';

  // A line as the board will read it: comments, spaces, control bytes, anything outside 7-bit ASCII
  // and the real-time characters taken out (the board acts on ! ~ ? and every byte of 0x80 and
  // above the moment it arrives, even inside a comment), upper case.
  function clean(s) {
    let out = '', paren = false;
    for (const ch of String(s)) {
      const c = ch.charCodeAt(0);
      if (paren) { if (ch === ')') paren = false; continue; }
      if (ch === '(') { paren = true; continue; }
      if (ch === ';') break;
      if (c <= 32 || c >= 127) continue;
      if (ch === '?' || ch === '!' || ch === '~') continue;
      out += ch;
    }
    return out.toUpperCase();
  }

  // a number as a short G-code word: three decimals at most, never -0 or an exponent
  function fmt(v, dp = 3) { const n = +(+v).toFixed(dp); return (Object.is(n, -0) ? 0 : n).toString(); }

  // '<Idle|MPos:1.000,2.000,3.000|FS:0,0|Pn:XP|Ov:100,100,100|A:S|WCO:...|Q:1>' as its fields (board units)
  function parseStatus(line) {
    const body = String(line).trim().replace(/^</, '').replace(/>$/, '');
    const parts = body.split('|');
    const [state, sub] = parts[0].split(':');
    const r = { state, sub: sub === undefined ? null : +sub, raw: line };
    const vec = v => { const n = v.split(',').map(Number); return { x: n[0], y: n[1], z: n[2] }; };
    for (const p of parts.slice(1)) {
      const i = p.indexOf(':');
      const k = i < 0 ? p : p.slice(0, i), v = i < 0 ? '' : p.slice(i + 1);
      if (k === 'MPos') r.mpos = vec(v);
      else if (k === 'WPos') r.wpos = vec(v);
      else if (k === 'WCO') r.wco = vec(v);
      else if (k === 'FS') { const n = v.split(',').map(Number); r.feed = n[0]; r.speed = n[1]; }
      else if (k === 'F') r.feed = +v;
      else if (k === 'Pn') r.pn = v;
      else if (k === 'Ov') r.ov = v.split(',').map(Number);
      else if (k === 'A') r.a = v;
      else if (k === 'Bf') r.bf = v.split(',').map(Number);
      else if (k === 'Ln') r.ln = +v;
      else if (k === 'Q') r.q = v;               // an optional field some boards add (an input selection); kept as text
      else (r.other || (r.other = {}))[k] = v;
    }
    return r;
  }

  // which inputs read active, from the Pn letters: X Y Z limits, P probe, D door, H hold, R reset, S start
  function pinsOf(pn) {
    const s = pn || '';
    return { raw: s, x: /X/.test(s), y: /Y/.test(s), z: /Z/.test(s), p: /P/.test(s), d: /D/.test(s), h: /H/.test(s), r: /R/.test(s), s: /S/.test(s) };
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const now = () => Date.now();

  // ------------------------------------------------------------------ Web Serial link
  // The MR-1's board shows up as a USB serial port; Chrome and Edge open it with navigator.serial.
  // Opening it restarts the board (the port raises DTR), which every connect expects.
  class GrblSerial {
    constructor(port) { this.port = port; this.onData = null; this.onClose = null; this.reading = false; this.reader = null; this.writer = null; }
    static serial() {
      if (root.navigator && root.navigator.serial) return root.navigator.serial;
      throw new Error('this browser has no Web Serial; use Chrome or Edge');
    }
    static supported() { return !!(root.navigator && root.navigator.serial); }
    static isBoard(port) { const i = port.getInfo ? port.getInfo() : {}; return i.usbVendorId === VID && i.usbProductId === PID; }
    // the board's own USB ids first; any port the person picks from the full list is also allowed
    static async request(serial = GrblSerial.serial()) {
      try { return new GrblSerial(await serial.requestPort({ filters: [{ usbVendorId: VID, usbProductId: PID }] })); }
      catch (e) { if (e && e.name === 'NotFoundError') return null; throw e; }
    }
    static async requestAny(serial = GrblSerial.serial()) { return new GrblSerial(await serial.requestPort()); }
    static async known(serial = GrblSerial.serial()) {
      const ports = await serial.getPorts();
      const p = ports.find(GrblSerial.isBoard);
      return p ? new GrblSerial(p) : null;
    }
    async open({ baud = BAUD } = {}) {
      try {
        await this.port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize: 4096 });
      } catch (e) {
        if (/failed to open|in use|access/i.test(e.message || '')) throw new Error('the serial port is in use (is CutControl or another tab open?)');
        throw e;
      }
      this.opened = true;
      this.writer = this.port.writable.getWriter();
      this.readLoop();
      return this;
    }
    async readLoop() {
      if (this.reading) return;
      this.reading = true;
      while (this.reading && this.port.readable) {
        this.reader = this.port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (value && value.byteLength && this.onData) this.onData(value.slice());
          }
        } catch (e) {
          // a framing error leaves the port readable and the loop takes a new reader; an unplug ends it
          if (this.reading && !this.port.readable) { this.reading = false; if (this.onClose) this.onClose(e); return; }
        } finally {
          try { this.reader.releaseLock(); } catch (e) { /* already released */ }
        }
      }
      if (this.reading) { this.reading = false; if (this.onClose) this.onClose(new Error('the serial port closed')); }
    }
    async write(bytes) { await this.writer.write(bytes); return bytes.length; }
    async close() {
      this.reading = false;
      try { if (this.reader) await this.reader.cancel(); } catch (e) { /* unplugged */ }
      try { if (this.writer) { this.writer.releaseLock(); this.writer = null; } } catch (e) { /* released */ }
      try { if (this.opened) await this.port.close(); } catch (e) { /* already closed */ }
      this.opened = false;
    }
  }

  // ------------------------------------------------------------------ the machine
  // the page's Base (swarf-run-machine.js) when it is loaded; the same two methods otherwise (node tests)
  const Base = (root.SwarfRunMachine && root.SwarfRunMachine.Base) || class {
    constructor() {
      this.subs = new Set();
      this.state = { kind: 'sim', connected: false, pos: { x: 0, y: 0, z: 0 }, running: false, paused: false, preview: false, moving: false, spindle: false, line: 0, dialog: null, note: '' };
    }
    on(fn) { this.subs.add(fn); fn(this.state); return () => this.subs.delete(fn); }
    set(patch) { Object.assign(this.state, patch); for (const fn of this.subs) fn(this.state); }
  };

  const DEFAULTS = {
    bannerMs: 5000,          // the restart banner after opening the port
    cmdMs: 10000,            // an answer to an ordinary command
    homeMs: 600000,          // $H: a full homing pass on every axis
    holdMs: 15000,           // a feed hold coming to rest
    resetMs: 5000,           // the banner after a soft reset
    alarmBannerMs: 1500,     // a banner this soon after an alarm is the alarm's own reset
    resumeTries: 5,          // cycle starts sent before a resume gives up
    pollMs: 200,             // status
    silentMs: 3000,          // no status this long (outside homing) is said
    margin: 2,               // mm kept from each end of travel
    jog: { xy: 1000 / 60, z: 500 / 60 },   // mm/s; CONTROL's speed row sets it, as on the ShopBot
    safeZ: 25.4, changeZ: 50,
    spinUp: 2,               // s after M3 before the first move
    rpmMax: 8000,
    jogDt: 0.025             // s of motion per hold-to-move increment, at least
  };

  class GrblMachine extends Base {
    constructor(opts = {}) {
      super();
      const { transport, ...cfg } = opts;
      this.transport = transport || null;
      this.cfg = Object.assign({}, DEFAULTS, cfg);
      this.cfg.jog = { ...this.cfg.jog };
      this.cfg.rapid = { ...this.cfg.jog };
      this.state.kind = 'grbl';
      this.state.note = 'not connected';
      Object.assign(this.state, { homed: false, locked: true, grbl: null, mpos: null, wco: null, pins: pinsOf(''), override: 100, overrideHeld: false,
        done: false, stopHit: false, lostMid: false, resumeLine: 0, toolChange: false, routerUnknown: false, coasting: false, alarm: 0, refused: '' });
      this.link = null;
      this.buf = '';
      this.tx = [];          // lines sent and not yet answered: { text, len, resolve, collect, meta }
      this.waiting = [];     // lines queued behind them
      this.inflight = 0;     // bytes of tx
      this.maxInflight = 0;  // the most ever in flight on this machine (tests read it)
      this.waiters = new Set();
      this.traffic = [];
      this.settings = null;
      this.offsets = null;
      this.wco = null;
      this.linkNo = 0;
      this.homed = false;
      this.raw = { banner: '', settings: [], offsets: [], info: [], messages: [] };
      this.rx = RX;
      this.alarmAt = 0;
    }

    static supported() { return GrblSerial.supported(); }
    static async known() { return GrblMachine.supported() && !!(await GrblSerial.known().catch(() => null)); }

    // ---------------------------------------------------------------- the link
    record(dir, data) {
      this.traffic.push([now(), dir, typeof data === 'string' ? data : Array.from(data, b => b >= 32 && b < 127 ? String.fromCharCode(b) : b === 10 ? '\\n' : `<${b.toString(16).padStart(2, '0')}>`).join('')]);
      if (this.traffic.length > 20000) this.traffic.splice(0, this.traffic.length - 20000);
    }
    // the traffic as text: ms since the first entry, > to the board, < from it
    logText() {
      const t0 = this.traffic.length ? this.traffic[0][0] : 0;
      const head = [`swarf ${root.SWARF_VERSION || ''} GRBL log ${new Date().toISOString()}`, `banner ${this.raw.banner}`];
      return head.concat(this.traffic.map(([t, d, s]) => `${t - t0} ${d} ${s}`)).join('\n') + '\n';
    }
    // what a read-only machine check saves: the banner, $$, $#, $I and the last status, as the board sent them
    // the USB ids of the port in use, as Chrome reports them ('16d0:103e'), or ''
    portInfo() {
      const port = this.link && this.link.port, i = port && port.getInfo ? port.getInfo() : {};
      const hex = v => Number(v).toString(16).padStart(4, '0');
      return i.usbVendorId !== undefined ? `${hex(i.usbVendorId)}:${hex(i.usbProductId)}` : '';
    }
    capture() {
      return [`port: ${this.portInfo() || 'no USB ids reported'}`, `banner: ${this.raw.banner}`, '$$:', ...this.raw.settings, '$#:', ...this.raw.offsets, '$I:', ...this.raw.info,
        `status: ${this.lastStatus ? this.lastStatus.raw : ''}`, ...this.raw.messages.map(m => `message: ${m}`)].join('\n') + '\n';
    }

    attach(link) {
      this.link = link;
      link.onData = b => { this.record('<', b); let s = ''; for (const x of b) s += String.fromCharCode(x); this.recv(s); };
      link.onClose = e => { if (this.link === link) this.lost(e && e.message); };
    }

    async send(text) {
      const link = this.link;
      if (!link) throw new Error('not connected');
      const bytes = typeof text === 'string' ? Uint8Array.from(text, c => c.charCodeAt(0)) : text;
      this.record('>', bytes);
      try { await link.write(bytes); } catch (e) { if (this.link === link) this.lost('a write to the board failed'); throw e; }
    }
    // a real-time byte: acts at once, takes no room in the board's buffer
    rt(byte) { return this.link ? this.send(Uint8Array.of(byte)).then(() => true, () => false) : Promise.resolve(false); }

    recv(s) {
      this.buf += s;
      const parts = this.buf.split(/\r\n|\n|\r/);
      this.buf = parts.pop();
      for (const l of parts) if (l.trim()) this.line(l.trim());
    }

    line(l) {
      if (l[0] === '<') return this.status(parseStatus(l));
      let m;
      if ((m = /^Grbl\s+(\S+)/.exec(l))) return this.banner(m[1], l);
      if (l === 'ok') return this.retire(null);
      if ((m = /^error:(\d+)/.exec(l))) return this.retire(+m[1]);
      if ((m = /^ALARM:(\d+)/.exec(l))) return this.alarm(+m[1]);
      if ((m = /^\[MSG:(.*)\]$/.exec(l))) return this.message(m[1]);
      if ((m = /^\[PRB:([-\d.]+),([-\d.]+),([-\d.]+):(\d)\]$/.exec(l))) {
        const f = this.toMm();
        this.probe = { x: +m[1] * f, y: +m[2] * f, z: +m[3] * f, ok: m[4] === '1' };
      }
      // $$ lines, [G54:...], [GC:...], [VER:...]: the answer to the oldest line still waiting
      if (this.tx.length) this.tx[0].collect.push(l);
    }

    message(text) {
      this.raw.messages.push(text);
      if (this.raw.messages.length > 50) this.raw.messages.shift();
      if (/unlock/i.test(text)) this.set({ locked: true });
      else if (/Caution: Unlocked/i.test(text)) this.set({ locked: false });
      else if (/Check Limits/i.test(text)) this.set({ note: 'a limit switch is pressed: move the machine off it by hand, or unlock and jog off it slowly' });
      // a critical alarm waits for a reset; the reset is safe now because nothing moves
      else if (/Reset to continue/i.test(text)) this.reset();
      if (this.tx.length) this.tx[0].collect.push(`[MSG:${text}]`);
    }

    // ---------------------------------------------------------------- lines in flight
    // A line queued for the board; resolves { ok, error, lines } when its ok or error comes back,
    // or { flushed } when a reset, an alarm or a lost link drops it. Lines are counted against the
    // board's 128-byte buffer: one goes out only while the bytes in flight plus it stay under 128.
    enqueue(raw, meta) {
      const text = clean(raw);
      if (text.length >= LINE_MAX) return Promise.resolve({ ok: false, refused: `a line of ${text.length} characters (the board takes at most ${LINE_MAX - 1})` });
      return new Promise(resolve => { this.waiting.push({ text, len: text.length + 1, resolve, collect: [], meta }); this.pump(); });
    }
    pump() {
      while (this.link && this.waiting.length && this.inflight + this.waiting[0].len < this.rx) {
        const e = this.waiting.shift();
        this.inflight += e.len;
        this.maxInflight = Math.max(this.maxInflight, this.inflight);
        this.tx.push(e);
        this.send(e.text + '\n').catch(() => { /* lost() has flushed it */ });
      }
    }
    retire(code) {
      const e = this.tx.shift();
      if (!e) return;                // an answer to a line sent before a reset
      this.inflight -= e.len;
      e.resolve({ ok: code === null, error: code, lines: e.collect });
      this.pump();
    }
    flush(why) {
      const all = this.tx.concat(this.waiting);
      this.tx = []; this.waiting = []; this.inflight = 0;
      for (const e of all) e.resolve({ ok: false, flushed: why, lines: e.collect });
    }
    // one command and its answer; ms: how long before it counts as unanswered
    cmd(raw, ms = this.cfg.cmdMs) {
      let t;
      const timeout = new Promise(r => { t = setTimeout(() => r({ ok: false, timeout: true, lines: [] }), ms); });
      return Promise.race([this.enqueue(raw), timeout]).finally(() => clearTimeout(t));
    }
    // a command sent alone: nothing else in flight before it (settings and offsets the board writes to its memory)
    async alone(raw, ms) {
      while (this.tx.length || this.waiting.length) await sleep(5);
      return this.cmd(raw, ms);
    }

    // ---------------------------------------------------------------- what the board reports
    toMm() { return this.settings && this.settings[13] === 1 ? IN : 1; }

    status(r) {
      // a report damaged on the wire (a lost comma, a flipped byte) is ignored whole: one bad offset
      // would turn every travel check off
      const finite = v => !v || [v.x, v.y, v.z].every(Number.isFinite);
      if (!finite(r.mpos) || !finite(r.wpos) || !finite(r.wco) || (r.feed !== undefined && !Number.isFinite(r.feed))) { this.badReports = (this.badReports || 0) + 1; return; }
      const f = this.toMm();
      const scale = v => ({ x: v.x * f, y: v.y * f, z: v.z * f });
      if (r.wco) this.wco = scale(r.wco);
      const wco = this.wco || { x: 0, y: 0, z: 0 };
      let mpos, pos;
      if (r.mpos) { mpos = scale(r.mpos); pos = { x: mpos.x - wco.x, y: mpos.y - wco.y, z: mpos.z - wco.z }; }
      else if (r.wpos) { pos = scale(r.wpos); mpos = { x: pos.x + wco.x, y: pos.y + wco.y, z: pos.z + wco.z }; }
      r.mm = { mpos, pos, feed: r.feed !== undefined ? r.feed * f : undefined };
      this.lastStatus = r;
      this.statusAt = now();
      const patch = { grbl: r.sub === null ? r.state : `${r.state}:${r.sub}`, moving: /^(Run|Jog|Home)$/.test(r.state) || (r.state === 'Hold' && r.sub === 1),
        pins: pinsOf(r.pn), wco: { ...wco }, silent: false };
      if (mpos) { patch.mpos = mpos; patch.pos = pos; patch.limits = this.workLimits(); }
      if (r.mm.feed !== undefined) patch.feed = r.mm.feed;
      if (r.speed !== undefined) patch.rpm = r.speed;
      if (r.q !== undefined) patch.q = r.q;
      if (r.ov) { patch.ov = r.ov; patch.override = r.ov[0]; patch.spindle = /[SC]/.test(r.a || ''); patch.flood = /F/.test(r.a || ''); }
      if (r.state === 'Alarm') patch.locked = true;
      else if (r.state === 'Idle' || r.state === 'Run' || r.state === 'Jog') patch.locked = false;
      // a jog chain is over once the board rests with no jog line waiting
      if (r.state === 'Idle' && !this.jogging && !this.held) this.jogAt = null;
      // in a job, paused is the board's own Hold: a hold from its button or input pauses swarf too, and a
      // cycle start on the board resumes it. Right after swarf's own pause the board may still say Run
      if (this.job && this.state.running && !this.stopping) {
        if (r.state === 'Hold') {
          this.pauseSent = false;
          if (!this.state.paused) { patch.paused = true; patch.note = 'paused by the machine: the spindle keeps turning. Resume, or stop'; }
        } else if (r.state === 'Run' && this.state.paused && !this.pauseSent) {
          patch.paused = false; patch.note = 'running';
        }
      }
      this.set(patch);
      for (const w of [...this.waiters]) if (w.pred(r)) { this.waiters.delete(w); w.resolve(r); }
    }

    // the next status that passes pred, or null after ms
    waitStatus(pred, ms) {
      return new Promise(resolve => {
        const w = { pred, resolve: r => { clearTimeout(w.t); resolve(r); } };
        w.t = setTimeout(() => { this.waiters.delete(w); resolve(null); }, ms);
        this.waiters.add(w);
        this.rt(RT.status);
      });
    }
    fresh(ms = 2000) { return this.waitStatus(() => true, ms); }

    banner(ver, l) {
      this.version = ver;
      this.raw.banner = l;
      if (this.expectBanner) {
        this.expectBanner = false;
        const w = this.bannerWait; this.bannerWait = null;
        if (w) w(ver);
        return;
      }
      if (!this.state.connected) return;
      // a banner nobody asked for: the board restarted (power, the e-stop, the cable). Everything it
      // held is gone: the lines in flight, the homing, the machine position; the work offset in its
      // memory survives, but against a machine position that is no longer known.
      this.flush('the board restarted');
      // a restarted board with homing on sits locked until it homes; the last report before it is stale
      if (this.lastStatus) this.lastStatus = { ...this.lastStatus, state: 'Alarm', sub: null };
      // an alarm that resets the board (a failed home, a limit hit) sends its banner straight after:
      // the alarm's words say why, not a restart
      const afterAlarm = this.state.alarm && now() - this.alarmAt < this.cfg.alarmBannerMs;
      const mid = this.state.running;
      this.homed = false; this.jogAt = null; this.held = null;
      if (this.job) this.job.ended = true;
      this.job = null;
      if (afterAlarm) { this.set({ homed: false, locked: true, running: false, paused: false, moving: false, spindle: false, stopHit: mid || this.state.stopHit, done: false }); return; }
      this.set({ homed: false, locked: true, running: false, paused: false, moving: false, spindle: false, stopHit: mid || this.state.stopHit, done: false, lostMid: mid,
        note: `the board restarted${mid ? ` at line ${this.state.line}` : ''} (power, the e-stop or the cable): it is not homed and its zero is unknown. Home again, then zero` });
    }
    waitBanner(ms) {
      return new Promise(resolve => {
        const t = setTimeout(() => { if (this.bannerWait === done) this.bannerWait = null; resolve(null); }, ms);
        const done = v => { clearTimeout(t); resolve(v); };
        this.bannerWait = done;
      });
    }

    alarm(n) {
      // the board drops its buffers with an alarm: nothing in flight will be answered
      this.flush(`alarm ${n}`);
      this.alarmAt = now();
      if (LOSES_POSITION.has(n)) { this.homed = false; this.jogAt = null; }
      this.held = null;
      const job = this.job, line = this.state.line;
      if (job) { job.ended = true; this.job = null; }
      const words = ALARMS[n] || `the board raised alarm ${n}`;
      this.set({ alarm: n, locked: true, homed: this.homed, moving: false,
        ...(job ? { running: false, paused: false, spindle: false, stopHit: true, done: false } : {}),
        note: job ? `stopped at line ${line}: ${words}` : words });
    }

    // a soft reset with nothing moving: the board keeps its position and comes back with its banner
    async reset() {
      this.expectBanner = true;
      const b = this.waitBanner(this.cfg.resetMs);
      this.flush('reset');
      await this.rt(RT.reset);
      return b;
    }

    // ---------------------------------------------------------------- connect
    // ask: true from a click (Chrome shows its port chooser once).
    async connect(ask) {
      if (this.state.connected && this.link) return true;
      let link = null;
      try {
        if (this.transport) link = typeof this.transport === 'function' ? await this.transport(ask) : this.transport;
        else { link = await GrblSerial.known().catch(() => null); if (!link && ask) link = await GrblSerial.request(); }
      } catch (e) { this.set({ note: `no serial port: ${e.message}` }); return false; }
      if (!link) { this.set({ note: 'no MR-1 on USB' }); return false; }
      this.attach(link);
      this.buf = '';
      this.expectBanner = true;
      let banner = this.waitBanner(this.cfg.bannerMs);
      try { await link.open({ baud: BAUD }); }
      catch (e) { this.link = null; this.expectBanner = false; this.set({ note: /in use/.test(e.message) ? 'another program has the port open: quit CutControl (or close the other tab) and connect again' : `the port would not open (${e.message})` }); return false; }
      let ver = await banner;
      if (!ver) {
        // no banner: a board that did not restart on open says it after a reset
        this.expectBanner = true;
        banner = this.waitBanner(this.cfg.bannerMs);
        await this.rt(RT.reset);
        ver = await banner;
      }
      if (!ver) { await this.letGo(); this.set({ note: 'no GRBL board answered on that port: pick the MR-1\'s port' }); return false; }
      this.linkNo++;
      this.homed = false; this.jogAt = null; this.held = null;
      this.set({ connected: true, homed: false, locked: true, version: ver, routerUnknown: false, lostMid: false, alarm: 0, note: 'connected: reading the settings' });
      // the settings first: they say whether the reports are in inches
      const s = await this.readSettings();
      if (!s) { await this.letGo(); this.set({ connected: false, note: 'the board did not send its settings ($$): check the cable and connect again' }); return false; }
      await this.readOffsets();
      const info = await this.cmd('$I');
      this.raw.info = info.lines || [];
      // [OPT:codes,blocks,rx]: a board with a smaller receive buffer gets fewer bytes in flight
      this.rx = RX;
      for (const l of this.raw.info) {
        const o = /^\[OPT:[^,\]]*,(\d+),(\d+)\]$/.exec(l);
        if (o && +o[2] > 0) this.rx = Math.min(RX, +o[2]);
      }
      const refused = this.refusal();
      this.poll();
      await this.fresh(2000);
      this.set({ refused, note: refused || 'connected: home the machine first (each time it connects)' });
      return true;
    }

    // $$ as numbers; the travel, rates and accelerations swarf uses come from here
    async readSettings() {
      const r = await this.cmd('$$');
      if (!r.ok) return null;
      const s = {};
      for (const l of r.lines) { const m = /^\$(\d+)=([-\d.]+)/.exec(l); if (m) s[+m[1]] = +m[2]; }
      if (!Object.keys(s).length) return null;
      this.settings = s;
      this.raw.settings = r.lines.slice();
      const rate = { xy: Math.min(s[110] || 0, s[111] || 0) / 60, z: (s[112] || 0) / 60 };
      if (rate.xy > 0 && rate.z > 0) this.cfg.rapid = rate;
      this.set({ settings: { ...s }, inches: s[13] === 1, travel: this.travel() });
      return s;
    }
    // why swarf will not drive this board, or ''
    refusal() {
      const s = this.settings || {};
      if (s[22] !== 1) return 'swarf will not drive this board: homing is off ($22=0). swarf changes no settings; turn homing back on in the machine\'s own software';
      if (s[21] !== 1) return 'swarf will not drive this board: the limit switches are off ($21=0). swarf changes no settings; turn them back on in the machine\'s own software';
      // the travel box (box below) is X 0..+, Y and Z -..0: homing X toward minus, Y and Z toward plus
      if (s[23] !== 1) return `swarf will not drive this board: its homing directions are $23=${s[23]}, not the MR-1's $23=1. swarf changes no settings; set it back in the machine's own software`;
      const t = this.travel();
      if (!(t.x > 0 && t.y > 0 && t.z > 0)) return 'swarf will not drive this board: it did not report its travel ($130-$132)';
      return '';
    }
    travel() { const s = this.settings || {}; return { x: s[130], y: s[131], z: s[132] }; }

    // $#: the work offsets (G54 is the zero swarf sets), G92, the tool length offset and the last probe, in mm
    async readOffsets() {
      const r = await this.cmd('$#');
      if (!r.ok) return null;
      const f = this.toMm(), o = {};
      for (const l of r.lines) {
        const m = /^\[(G5[4-9]|G28|G30|G92|TLO|PRB):([^\]]+)\]$/.exec(l);
        if (!m) continue;
        const n = m[2].split(':')[0].split(',').map(v => +v * f);
        o[m[1]] = m[1] === 'TLO' ? n[0] : { x: n[0], y: n[1], z: n[2] };
        if (m[1] === 'PRB') o.PRB.ok = /:1$/.test(m[2]);
      }
      this.offsets = o;
      this.raw.offsets = r.lines.slice();
      if (o.G54) {
        const g92 = o.G92 || { x: 0, y: 0, z: 0 };
        this.wco = { x: o.G54.x + g92.x, y: o.G54.y + g92.y, z: o.G54.z + g92.z + (o.TLO || 0) };
        this.set({ g54: { ...o.G54 }, wco: { ...this.wco } });
      }
      return o;
    }
    // the G54 zero as the board holds it now, and whether it is the one swarf remembered (to tol mm)
    async zeroHolds(saved, tol = 0.01) {
      const o = await this.readOffsets();
      if (!o || !o.G54 || !saved) return { same: false, g54: o && o.G54 };
      return { same: ['x', 'y', 'z'].every(a => Math.abs(o.G54[a] - saved[a]) <= tol), g54: o.G54 };
    }

    // status every 200 ms; it takes no room in the board's buffer. A board in homing answers no
    // status, and that is not a lost link.
    stopPoll() { clearTimeout(this.timer); this.pollGen = (this.pollGen || 0) + 1; }
    poll() {
      this.stopPoll();
      const gen = this.pollGen;
      this.statusAt = now();
      const loop = () => {
        if (gen !== this.pollGen || !this.link) return;
        this.rt(RT.status);
        const quiet = now() - this.statusAt;
        if (quiet > this.cfg.silentMs && !this.homing && !this.expectBanner && !this.state.silent)
          this.set({ silent: true, note: `the board has not answered for ${Math.round(quiet / 1000)} s: check the cable. If it is running, the e-stop is the stop` });
        this.timer = setTimeout(loop, this.cfg.pollMs);
      };
      this.timer = setTimeout(loop, this.cfg.pollMs);
    }

    async letGo() {
      this.stopPoll();
      const link = this.link;
      this.link = null;
      this.flush('closed');
      if (link) { link.onClose = null; try { await link.close(); } catch (e) { /* unplugged already */ } }
    }

    async disconnect() {
      if (!this.link) return true;
      if (this.busy() || this.state.moving) { this.set({ note: 'stop the job before you disconnect' }); return false; }
      await this.letGo();
      this.homed = false;
      this.set({ connected: false, homed: false, spindle: false, note: 'disconnected: the board is free for another program' });
      return true;
    }

    // The link went (unplugged, the tab's port closed, a write failed). The board keeps what it
    // was given: it may finish the moves already in its buffer, with the spindle on.
    lost(why) {
      if (!this.link && !this.state.connected) return;
      this.stopPoll();
      const link = this.link;
      this.link = null;
      if (link) link.onClose = null;
      this.flush('the link was lost');
      const mid = this.state.running || this.state.moving || this.state.spindle;
      const running = this.state.running;
      if (this.job) this.job.ended = true;
      this.job = null; this.held = null; this.jogAt = null; this.homed = false;
      this.set({ connected: false, running: false, paused: false, moving: false, homed: false, routerUnknown: !!mid, lostMid: running, done: false,
        stopHit: running || this.state.stopHit,
        note: mid ? `the link to the board was lost${why ? ` (${why})` : ''}: the machine may finish the moves it already has, with the spindle on. The e-stop is the stop`
          : `the link to the board was lost${why ? ` (${why})` : ''}` });
    }

    // ---------------------------------------------------------------- limits
    // the travel in machine mm, less the margin: X 0..+, Y -..0, Z -..0
    box() {
      const t = this.travel(), m = this.cfg.margin;
      return { x: [m, t.x - m], y: [-t.y + m, -m], z: [-t.z + m, -m] };
    }
    // the same box in work mm, for the page
    workLimits() {
      if (!this.settings) return null;
      const b = this.box(), w = this.wco || { x: 0, y: 0, z: 0 };
      return { x: [b.x[0] - w.x, b.x[1] - w.x], y: [b.y[0] - w.y, b.y[1] - w.y], z: [b.z[0] - w.z, b.z[1] - w.z] };
    }
    // a machine target on one axis kept inside the box; a machine already outside it (just homed,
    // at 0) may move back in but never further out, and a clamp never turns a move around
    clampAxis(axis, from, to) {
      const [lo, hi] = this.box()[axis];
      return Math.min(Math.max(hi, from), Math.max(Math.min(lo, from), to));
    }
    clamp(axis, v) {
      // work mm in and out, as Base.clamp
      const w = this.wco || { x: 0, y: 0, z: 0 }, m = this.state.mpos || { x: 0, y: 0, z: 0 };
      return this.clampAxis(axis, m[axis], v + w[axis]) - w[axis];
    }
    limitsKnown() { return !!this.homed; }
    mabs() { return { ...(this.state.mpos || { x: 0, y: 0, z: 0 }) }; }

    // why the machine will not do `what` now, or ''
    whyNot(what) {
      if (!this.link || !this.state.connected) return 'not connected';
      if (this.state.refused) return this.state.refused;
      if (this.state.running || this.homing || this.stopping) return 'not now: the machine is busy';
      if (this.state.routerUnknown) return 'not now: swarf can\'t tell whether the spindle is on. Press the e-stop, then connect again';
      const st = this.lastStatus ? this.lastStatus.state : '';
      if (what === 'home') return st === 'Idle' || st === 'Alarm' ? '' : `not now: the machine is ${this.state.grbl || 'not ready'}`;
      if (!this.homed && !(what === 'jog' && this.unlocked)) return 'home the machine first (each time it connects)';
      if (st === 'Alarm') return 'the machine is locked: home it first';
      if (what === 'jog' ? !(st === 'Idle' || st === 'Jog') : st !== 'Idle') return `not now: the machine is ${this.state.grbl || 'not ready'}`;
      return '';
    }
    busy() { return !this.link || this.state.running || !!this.homing || !!this.stopping || !!this.held || this.tx.length > 0 || this.waiting.length > 0; }

    // ---------------------------------------------------------------- home and unlock
    async home() {
      const why = this.whyNot('home');
      if (why) { this.set({ note: why }); return false; }
      this.homing = true;
      this.set({ moving: true, note: 'homing: the machine finds its switches' });
      // no status comes while the board homes; the poll keeps asking and the board ignores it
      const r = await this.cmd('$H', this.cfg.homeMs);
      this.homing = false;
      if (!r.ok) {
        if (r.error) this.set({ moving: false, note: `homing refused: ${errorWords(r.error)} (error ${r.error})` });
        else if (r.timeout) this.set({ moving: false, note: 'homing did not finish: check the machine' });
        else this.set({ moving: false });          // an alarm said why
        return false;
      }
      // where it ended, read fresh: machine 0, 0, 0 within the pull-off
      const st = await this.waitStatus(s => s.state === 'Idle' && !!(s.mpos || s.wpos), 3000);
      const m = this.state.mpos, tol = ((this.settings && this.settings[27]) || 1.5) + 1;
      if (!st || !m || ['x', 'y', 'z'].some(a => Math.abs(m[a]) > tol)) {
        this.set({ moving: false, note: 'homing ended away from machine 0, 0, 0: check the switches before going on' });
        return false;
      }
      this.homed = true; this.unlocked = false;
      this.set({ homed: true, locked: false, alarm: 0, moving: false, note: 'homed: machine 0, 0, 0 is the home corner' });
      return true;
    }
    // jog without knowing where the machine is (no zero, no cut until it is homed)
    async unlock() {
      if (!this.link || this.state.refused || this.busy()) return false;
      const r = await this.cmd('$X');
      if (!r.ok) return false;
      this.unlocked = true;
      this.set({ locked: false, note: 'unlocked without homing: jog only. swarf will not zero or cut until the machine is homed' });
      return true;
    }

    // ---------------------------------------------------------------- jog
    // the jog speed on an axis, mm/s, never past the board's own rate for it
    jogRate(axis) {
      const s = this.settings || {}, v = axis === 'z' ? this.cfg.jog.z : this.cfg.jog.xy;
      const max = (s[{ x: 110, y: 111, z: 112 }[axis]] || 1000) / 60;
      return Math.max(0.1, Math.min(v, max));
    }
    jogLine(axis, target, rate) {
      // absolute machine coordinates: a target clamped here stays inside the travel whatever ran before it
      return `$J=G21G53G90${axis.toUpperCase()}${fmt(target)}F${fmt(rate * 60, 1)}`;
    }
    // a step: from where the last jog ends (or the machine is), dist mm along axis
    jog(axis, dist) {
      this.jogChain = (this.jogChain || Promise.resolve()).then(() => this.jogStep(axis, dist));
      return this.jogChain;
    }
    async jogStep(axis, dist) {
      const why = this.whyNot('jog');
      if (why) { this.set({ note: why }); return false; }
      const from = this.jogAt || this.state.mpos;
      if (!from) return false;
      const t = this.clampAxis(axis, from[axis], from[axis] + dist);
      if (Math.abs(t - from[axis]) < 0.0005) { this.set({ note: `${axis.toUpperCase()} is at the end of its travel (swarf keeps ${this.cfg.margin} mm from each end)` }); return false; }
      this.jogging = (this.jogging || 0) + 1;
      const r = await this.cmd(this.jogLine(axis, t, this.jogRate(axis)));
      this.jogging--;
      if (!r.ok) { if (r.error) this.set({ note: `jog refused: ${errorWords(r.error)} (error ${r.error})` }); return false; }
      this.jogAt = { ...from, [axis]: t };
      if (Math.abs(t - (from[axis] + dist)) > 0.0005) this.set({ note: `${axis.toUpperCase()} stops short: swarf keeps ${this.cfg.margin} mm from the end of travel` });
      return true;
    }
    // Hold to move: short increments while held, each sent once the one before is queued, as
    // GRBL's jogging notes describe (dt long enough for the feed to be reached, s = v dt). Release
    // cancels whatever is queued (0x85) and waits for the board to come to rest (G4 P0).
    jogHold(axis, dir) {
      const why = this.whyNot('jog');
      if (why) { this.set({ note: why }); return; }
      if (this.held) return;
      const hold = this.held = { axis, dir };
      const s = this.settings || {};
      const v = this.jogRate(axis);
      const a = (s[{ x: 120, y: 121, z: 122 }[axis]] || 50);         // mm/s²
      const dt = Math.max(this.cfg.jogDt, v * v / (2 * a * 14));        // 15 planner blocks
      const step = v * dt;
      this.holdLoop = (async () => {
        let at = this.jogAt || this.state.mpos;
        if (!at) return;
        while (this.held === hold && this.link) {
          const t = this.clampAxis(axis, at[axis], at[axis] + dir * step);
          if (Math.abs(t - at[axis]) < 0.0005) { this.set({ note: `${axis.toUpperCase()} is at the end of its travel (swarf keeps ${this.cfg.margin} mm from each end)` }); break; }
          this.jogging = (this.jogging || 0) + 1;
          const r = await this.cmd(this.jogLine(axis, t, v));
          this.jogging--;
          if (!r.ok) break;
          at = { ...at, [axis]: t };
          this.jogAt = at;
        }
      })();
    }
    async jogRelease() {
      const hold = this.held;
      this.held = null;
      if (!hold) return;
      // the last increment is queued before the cancel goes, so the cancel takes it too
      if (this.holdLoop) await this.holdLoop;
      if (!this.link) return;
      await this.rt(RT.jogCancel);
      await this.cmd('G4P0');
      this.jogAt = null;
    }

    // absolute, in work mm: up first, then across, then down; refused whole if any part leaves the travel
    async goTo(t) {
      const why = this.whyNot('goto');
      if (why) { this.set({ note: why }); return false; }
      const w = this.wco || { x: 0, y: 0, z: 0 }, p = { ...this.state.pos }, path = [];
      // a lift asked past the top of travel stops at the top (less the margin): up is never the danger
      if (t.z !== undefined && t.z > p.z) { p.z = Math.max(p.z, Math.min(t.z, this.box().z[1] - w.z)); path.push({ ...p }); }
      if (t.x !== undefined) p.x = t.x;
      if (t.y !== undefined) p.y = t.y;
      path.push({ ...p });
      if (t.z !== undefined && t.z < p.z) { p.z = t.z; path.push({ ...p }); }
      let from = { ...this.state.mpos };
      const lines = [];
      for (const q of path) {
        const mt = { x: q.x + w.x, y: q.y + w.y, z: q.z + w.z }, words = [];
        for (const a of ['x', 'y', 'z']) {
          if (Math.abs(mt[a] - from[a]) < 0.0005) continue;
          if (Math.abs(this.clampAxis(a, from[a], mt[a]) - mt[a]) > 0.0005) { this.set({ note: `not moved: that goes past the ${a.toUpperCase()} travel` }); return false; }
          words.push(a.toUpperCase() + fmt(mt[a]));
        }
        if (!words.length) continue;
        const z = words.length === 1 && words[0][0] === 'Z';
        lines.push(`$J=G21G53G90${words.join('')}F${fmt((z ? this.jogRate('z') : this.jogRate('x')) * 60, 1)}`);
        from = mt;
      }
      for (const l of lines) { const r = await this.cmd(l); if (!r.ok) { if (r.error) this.set({ note: `not moved: ${errorWords(r.error)} (error ${r.error})` }); return false; } }
      return true;
    }

    // ---------------------------------------------------------------- zero
    // here becomes 0 on these axes, in G54 (the board keeps it in its memory, so it goes alone)
    async zero(axes) {
      const why = this.whyNot('zero');
      if (why) { this.set({ note: why }); return false; }
      const words = String(axes).toUpperCase().split('').filter(a => 'XYZ'.includes(a)).map(a => `${a}0`).join('');
      return this.setOffset(words, `zeroed ${String(axes).toUpperCase()}`);
    }
    // type a work position: this spot becomes v on axis
    async setWork(axis, v) {
      if (!Number.isFinite(+v)) return false;
      const why = this.whyNot('zero');
      if (why) { this.set({ note: why }); return false; }
      return this.setOffset(`${axis.toUpperCase()}${fmt(v)}`, `${axis.toUpperCase()} set to ${fmt(v)}`);
    }
    async setOffset(words, note) {
      const r = await this.alone(`G21G10L20P1${words}`);
      if (!r.ok) { this.set({ note: r.error ? `zero refused: ${errorWords(r.error)} (error ${r.error})` : 'zero not set: the board did not answer' }); return false; }
      await this.readOffsets();
      const m = this.state.mpos, w = this.wco;
      if (m && w) this.set({ pos: { x: m.x - w.x, y: m.y - w.y, z: m.z - w.z }, limits: this.workLimits() });
      this.set({ note });
      return true;
    }

    // ---------------------------------------------------------------- feed override
    // 50 to 150 % of the file's feeds (the board scales feeds, never rapids): back to 100, then up or down in tens and ones
    setOverride(pct) {
      if (!Number.isFinite(+pct)) return this.state.override || 100;
      const v = Math.max(50, Math.min(150, Math.round(+pct)));
      if (!this.link) return this.state.override || 100;
      const bytes = [RT.feed100];
      let d = v - 100;
      while (d >= 10) { bytes.push(RT.feedUp10); d -= 10; }
      while (d <= -10) { bytes.push(RT.feedDown10); d += 10; }
      while (d > 0) { bytes.push(RT.feedUp1); d--; }
      while (d < 0) { bytes.push(RT.feedDown1); d++; }
      this.send(Uint8Array.from(bytes)).catch(() => {});
      this.set({ override: v, overrideHeld: false });
      return v;
    }

    // ---------------------------------------------------------------- plans and jobs
    // the lift heights come down to just under the top of Z travel when the work zero sits high: on
    // a short Z the usual 25.4 mm lift over the board can pass the top, and the envelope would refuse
    // every run. A lift that then no longer clears the file's own moves still fails the envelope check.
    planCfg() {
      const r = this.cfg.rapid;
      const top = this.settings && this.wco ? this.box().z[1] - this.wco.z - 0.01 : Infinity;
      return { safeZ: Math.min(this.cfg.safeZ, top), rapid: { ...r }, move: { ...r }, jog: { ...this.cfg.jog }, spinUp: this.cfg.spinUp, changeZ: Math.min(this.cfg.changeZ, top) };
    }
    // what a plan is for: this zero, on this link (a reconnect or a new zero makes a new plan)
    planCtx() {
      const g = (this.offsets && this.offsets.G54) || { x: 0, y: 0, z: 0 };
      return { machine: 'grbl', link: this.linkNo, g54: [fmt(g.x, 2), fmt(g.y, 2), fmt(g.z, 2)] };
    }
    // the spindle speed the job runs at: the whole file's last S before the job's first move (a
    // continue from line N starts mid-file), else its first S
    rpmOf(prog) {
      const P = root.SwarfRunParse;
      const src = prog.source || (prog.sbp && P ? P.parse(prog.sbp, { machineUnits: 'mm' }) : null);
      const ev = ((src && src.events) || prog.events || []).filter(e => e.kind === 'rpm' && e.value > 0);
      const first = (prog.moves || []).find(m => !m.liftFirst);
      const before = first ? ev.filter(e => e.line <= first.line).pop() : null;
      return (before || ev[0] || {}).value || 0;
    }
    plan(prog) {
      const R = root.SwarfRunPlan;
      const p = R.build(prog, { pos: this.state.pos, live: (prog.cut || prog.spindle !== false) && !prog.preview, cfg: this.planCfg(), ctx: this.planCtx() });
      const rpm = this.rpmOf(prog);
      const extra = [];
      const env = this.envelope(p);
      if (env) extra.push(env);
      if (p.steps.some(s => s.router === true)) {
        if (!(rpm > 0)) extra.push('the file names no spindle speed (an S word)');
        else if (rpm > this.cfg.rpmMax) extra.push(`the file's spindle speed (${rpm}) is over this machine's ${this.cfg.rpmMax}`);
      }
      const fast = p.steps.find(s => s.rpm > this.cfg.rpmMax);
      if (fast) extra.push(`line ${fast.line}'s spindle speed (${fast.rpm}) is over this machine's ${this.cfg.rpmMax}`);
      const outs = p.steps.find(s => s.out);
      if (outs) extra.push(`line ${outs.line} switches output ${outs.out}, which this machine does not have`);
      // the fingerprint covers the steps; the speed and these problems ride beside them
      return Object.freeze(Object.assign({}, p, { rpm, problems: Object.freeze(p.problems.concat(extra)) }));
    }
    // every move of a plan inside the travel (less the margin), with the work offset as it is now
    envelope(plan) {
      if (!this.settings || !this.wco) return 'swarf does not know the travel or the work offset yet';
      const w = this.wco, from = plan.from || this.state.pos;
      const f = { x: from.x + w.x, y: from.y + w.y, z: from.z + w.z };
      for (const s of plan.steps) {
        if (!s.move) continue;
        for (const a of ['x', 'y', 'z']) {
          const v = s.move[a] + w[a];
          // a number that is not one fails too (a damaged report's offset)
          if (!(Math.abs(this.clampAxis(a, f[a], v) - v) <= 0.0005))
            return `line ${s.line || 0} goes past the machine's ${a.toUpperCase()} travel (${fmt(s.move[a], 1)} mm in work, ${fmt(v, 1)} on the machine)`;
        }
      }
      return '';
    }
    // only a plan swarf made, the person confirmed, and nothing changed since; why not, or ''
    refuse(plan) {
      const R = root.SwarfRunPlan;
      if (!plan || !plan.steps) return 'not run: swarf runs only a plan it has checked and you have confirmed';
      if (!R.verify(plan)) return 'not run: this plan changed after it was made';
      if (!plan.armed) return 'not run: this plan was not confirmed';
      if (JSON.stringify(plan.ctx) !== JSON.stringify(this.planCtx())) return 'not run: the zero or the connection changed since this plan was made';
      const why = this.whyNot('run');
      if (why) return `not run: ${why}`;
      const p = this.state.pos;
      if (plan.from && Math.hypot(p.x - plan.from.x, p.y - plan.from.y, p.z - plan.from.z) > 0.05) return 'not run: the bit has moved since this plan was made';
      if (plan.problems.length) return `${plan.problems[0]}: not run`;
      const env = this.envelope(plan);
      if (env) return `${env}: not run`;
      if (plan.rpm > this.cfg.rpmMax) return `the spindle speed (${plan.rpm}) is over ${this.cfg.rpmMax}: not run`;
      return '';
    }
    // the plan as the lines the board gets, each with the file line it came from
    linesOf(plan) {
      const out = PREAMBLE.map(text => ({ text, line: 0 }));
      // each start runs at the speed the file set there; a new S while it runs is sent as it comes
      const speed = v => Math.min(this.cfg.rpmMax, Math.round(v || plan.rpm || 0));
      for (const s of plan.steps) {
        if (s.move) {
          const m = s.move, xyz = `X${fmt(m.x)}Y${fmt(m.y)}Z${fmt(m.z)}`;
          if (s.work && s.work.rapid) out.push({ text: `G0${xyz}`, line: s.line });
          else out.push({ text: `G1${xyz}F${fmt(s.feed * 60, 1)}`, line: s.line });
        } else if (s.router === true) out.push({ text: `M3S${speed(s.rpm)}`, line: s.line });
        else if (s.rpm > 0) out.push({ text: `S${speed(s.rpm)}`, line: s.line });
        else if (s.router === false) { out.push({ text: 'S0', line: s.line }, { text: 'G4P1', line: s.line }, { text: 'M5', line: s.line }); }
        else if (s.dwell > 0) out.push({ text: `G4P${fmt(s.dwell)}`, line: s.line });
      }
      for (const text of END) out.push({ text, line: 0 });
      return out;
    }

    run(plan) {
      const why = this.refuse(plan);
      if (why) { this.set({ note: why }); return false; }
      const lines = this.linesOf(plan);
      const long = lines.find(l => clean(l.text).length >= LINE_MAX);
      if (long) { this.set({ note: `not run: line ${long.line} is longer than the board takes` }); return false; }
      const job = this.job = { plan, lines, acked: 0, ended: false };
      this.set({ running: true, paused: false, preview: false, line: 0, spindle: false, stopHit: false, resumeLine: 0, done: false, lostMid: false, toolChange: false, coasting: false, alarm: 0, note: 'running' });
      this.cue('move');
      this.go(job);
      return true;
    }

    async go(job) {
      const results = job.lines.map(l => this.enqueue(l.text, { line: l.line }).then(r => {
        if (job.ended) return r;
        if (r.ok) { job.acked++; if (l.line > 0 && this.job === job) this.set({ line: l.line }); }
        else if (r.error) this.failed(job, l, r.error);
        return r;
      }));
      const all = await Promise.all(results);
      if (job.ended || this.job !== job) return;
      if (!all.every(r => r.ok)) return;
      // every line answered, G4 P0 among them: the planner is empty. Idle confirms it (a pause
      // here holds it as long as it lasts; a lost link or a stop ends the job instead)
      let st = null;
      while (!st && !job.ended && this.job === job && this.link) st = await this.waitStatus(s => s.state === 'Idle', 1000);
      if (job.ended || this.job !== job) return;
      this.job = null;
      const hold = job.plan.hold;
      if (!st) { this.set({ running: false, spindle: false, stopHit: true, done: false, note: 'the job\'s lines were all taken, but the machine did not come to rest: check it' }); return; }
      if (hold) {
        const next = hold.line + 1;
        this.set({ running: false, paused: false, spindle: false, stopHit: true, resumeLine: next, toolChange: hold.hold === 'tool-change',
          note: hold.hold === 'tool-change' ? `tool change at line ${hold.line}: change the bit, zero Z, then cut from line ${next}` : `the file pauses at line ${hold.line}: cut from line ${next} to go on` });
        return;
      }
      this.set({ running: false, paused: false, spindle: false, done: true, note: 'program finished' });
      this.cue('done');
    }

    // an error in the middle of a job: the board goes on with what it already holds, so hold, then reset
    failed(job, l, code) {
      if (job.ended) return;
      job.ended = true;
      this.stopNow(`stopped at line ${l.line || this.state.line}: the board refused "${l.text}" (error ${code}: ${errorWords(code)})`);
    }

    pause() {
      if (!this.state.running || this.state.paused) return;
      this.pauseSent = true;
      this.rt(RT.hold);
      this.set({ paused: true, note: 'paused: the spindle keeps turning. Resume, or stop' });
    }
    // the board keeps its own queue through a hold: no plan to make again
    resumePlan() { return null; }
    // The board takes a cycle start only once its hold has come to rest (Hold:0): wait for that, send it,
    // and send it again until the board says Run
    async resume() {
      if (!this.state.running || !this.state.paused || this.resuming) return;
      const job = this.job;
      this.resuming = true;
      this.set({ note: 'resuming' });
      try {
        for (let i = 0; i < this.cfg.resumeTries; i++) {
          if (!this.state.running || this.job !== job || this.stopping) return;
          const st = await this.waitStatus(r => !(r.state === 'Hold' && r.sub !== 0), this.cfg.holdMs);
          if (!this.state.running || this.job !== job || this.stopping) return;
          if (!st) continue;
          if (st.state === 'Run' || st.state === 'Idle') break;
          await this.rt(RT.start);
          const go = await this.waitStatus(r => r.state === 'Run' || r.state === 'Idle', 500);
          if (go) break;
        }
        const st = this.lastStatus ? this.lastStatus.state : '';
        if (this.state.running && this.job === job && !this.stopping) {
          if (st === 'Run' || st === 'Idle') this.set({ paused: false, note: 'running' });
          else this.set({ note: 'the machine did not resume: resume again, or stop' });
        }
      } finally { this.resuming = false; }
    }

    stop() {
      if (this.held) return this.jogRelease();
      if (this.homing) {
        // a reset during homing ends it (the board raises alarm 6); the position is unknown either way
        this.homing = false;
        this.homed = false;
        return this.reset();
      }
      if (this.state.running || this.tx.length || this.waiting.length || this.state.moving) return this.stopNow('stopped');
    }

    // Stop that keeps the position: hold, wait until the machine is at rest, then reset. The reset
    // empties the board's buffers and puts its parser back to defaults; swarf's preamble goes
    // again before anything else.
    async stopNow(note) {
      if (this.stopping) return;
      this.stopping = true;
      const job = this.job;
      if (job) job.ended = true;
      const st = this.lastStatus ? this.lastStatus.state : '';
      if (st === 'Jog' && !job) await this.rt(RT.jogCancel);
      else await this.rt(RT.hold);
      const rest = await this.waitStatus(s => (s.state === 'Hold' && s.sub === 0) || s.state === 'Idle', this.cfg.holdMs);
      const ver = await this.reset();
      this.job = null;
      this.held = null; this.jogAt = null;
      let words = note;
      if (!rest) { this.homed = false; words = `${note}: the machine had not come to rest, so its position is lost. Home again`; }
      if (ver && this.homed) for (const t of PREAMBLE) await this.cmd(t);
      this.stopping = false;
      this.set({ running: false, paused: false, moving: false, spindle: false, stopHit: !!job || this.state.stopHit, done: false, homed: this.homed, note: words });
    }

    // the spindle off after a lost link, once connected again (the reconnect itself resets the board)
    async recover() {
      if (!this.link || this.state.running) return false;
      const a = await this.cmd('S0'), b = await this.cmd('M5');
      const ok = a.ok && b.ok;
      if (ok) this.set({ routerUnknown: false, spindle: false });
      return ok;
    }

    cue(name) { if (this.onCue) this.onCue(name); }
    answer(v) { if (v === 1) this.resume(); else this.stop(); }
  }

  const api = { GrblMachine, GrblSerial, parseStatus, pinsOf, clean, fmt, ALARMS, ERRORS, PREAMBLE, END, RX, LINE_MAX, VID, PID, BAUD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SwarfGrbl = api;
  if (root.SwarfRunMachine) root.SwarfRunMachine.GrblMachine = GrblMachine;
})(typeof window !== 'undefined' ? window : globalThis);
