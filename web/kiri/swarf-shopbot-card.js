/**
 * swarf shopbot — the control card's wire protocol, and the motion planner
 * that feeds it. Talks to any byte link with write(bytes) / onData (the USB
 * link in swarf-shopbot-usb.js, or the card emulator in tests).
 *
 * The card (ShopBot V20x, C8051F12x) does not interpret OpenSBP. It plays
 * back time slices: the host decides, tick by tick, which axes step and how
 * long each tick lasts. Recovered from the V204 firmware (application
 * 0x1000-0x2C00) and Sb3.exe 3.8.4; checked against the firmware in an
 * 8051 emulator (shopbot_probe/re/emu).
 *
 * Commands: 6 bytes, first byte >= 0x80, sent between blocks.
 *   E0 FF FF FF FF FF   status -> 50-byte report
 *   F9 n hi lo FF FF    block payload size (hi:lo), n = card window
 *   90 04 / 90 0C ...   motors on / off (P3.0-1)
 *   80 len ...          card identity -> len bytes
 * Blocks: `size` payload bytes + 1 byte sum mod 256. The card holds `n`
 * (F9) blocks; past that, a block's ack waits until one has played. The card answers each
 * with a 6-byte ack: [window, blocks, inputs P6, inputs P2, ticks lo, hi];
 * ticks = ticks run since the previous ack (FW 0x2530 clears the count).
 * A reply starting FE/FF asks for the last block again.
 * Items inside the block stream (they may straddle blocks):
 *   0b00aaaaa0          one tick; bit n+1 steps axis n (X Y Z A B)
 *   40 dirs lineHi lineLo periodHi periodLo
 *                       direction bits (1 = count up), the line shown in
 *                       reports, and the Timer0 reload for later ticks
 *   6p q                reload = 0xF000 | p<<8 | q  (ticks <= 4096 counts)
 *   70 out p3           outputs: P7, then P3 high nibble
 *   78                  end of stack -> ack, then the 50-byte report
 * Tick length = (0x10000 - reload) counts of SYSCLK/12 = 6.125 MHz.
 * Report (50): [0] D4/D5, [1] P6, [2] P2, [3-4] tick ctr, [5] blocks,
 *   [6] lineLo, [7] lineHi, [8-15] ADC, [16-17] FF FF,
 *   [18-41] six int32 BE axis positions (steps), [42-45] ticks, [46-49] I/O.
 */
(function (root) {
  'use strict';

  const TICK_HZ = 73500000 / 12;
  const AXES = ['x', 'y', 'z', 'a', 'b'];
  const END = 0x78;

  // ------------------------------------------------------------------ card
  class ShopBotCard {
    constructor(link, { size = 149, window = 1, timeoutMs = 5000 } = {}) {
      this.link = link;
      this.size = size;
      this.window = window;
      this.timeoutMs = timeoutMs;
      this.rx = [];
      this.want = null;           // { n, resolve, reject, timer }
      this.streaming = false;
      this.queue = Promise.resolve();
      link.onData = b => { for (const x of b) this.rx.push(x); this.drain(); };
    }

    drain() {
      const w = this.want;
      if (!w || this.rx.length < w.n) return;
      const out = Uint8Array.from(this.rx.splice(0, w.n));
      clearTimeout(w.timer);
      this.want = null;
      w.resolve(out);
    }

    expect(n) {
      if (this.want) return Promise.reject(new Error('card: a reply is already pending'));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.want = null;
          reject(new Error(`card: no reply (${this.rx.length} of ${n} bytes)`));
        }, this.timeoutMs);
        this.want = { n, resolve, reject, timer };
        this.drain();
      });
    }

    // Commands queue: each waits for the one before to be answered.
    cmd(bytes, reply = 50) {
      const go = async () => {
        if (this.streaming) throw new Error('card: busy moving');
        const p = reply ? this.expect(reply) : null;
        await this.link.write(Uint8Array.from(bytes));
        return p ? p : new Uint8Array(0);
      };
      const r = this.queue.then(go, go);
      this.queue = r.catch(() => {});
      return r;
    }

    async status() { return parseReport(await this.cmd([0xE0, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])); }
    async identity(n = 20) { return this.cmd([0x80, n, 0xFF, 0xFF, 0xFF, 0xFF], n); }
    async motors(on) { return parseReport(await this.cmd([0x90, on ? 0x04 : 0x0C, 0xFF, 0xFF, 0xFF, 0xFF])); }
    async setBlocks(window = 3, size = this.size) {
      this.size = size;
      return parseReport(await this.cmd([0xF9, window, (this.size >> 8) & 0xFF, this.size & 0xFF, 0xFF, 0xFF]));
    }

    block(payload) {
      const b = new Uint8Array(this.size + 1);
      b.set(payload);
      let s = 0;
      for (let i = 0; i < this.size; i++) s += b[i];
      b[this.size] = s & 0xFF;
      return b;
    }

    /**
     * Send an item stream as one stack. `items` yields bytes (any iterable,
     * read lazily, so a planner can react to stop/pause between blocks) and
     * should end with END; one is added if missing. Resolves with the end
     * report. onAck(ack, blockIndex) after every block.
     */
    async run(items, { onAck } = {}) {
      if (this.streaming) throw new Error('card: busy moving');
      this.streaming = true;
      await this.queue;
      const it = items[Symbol.iterator]();
      let ended = false, k = 0, data = 0;
      try {
        while (!ended) {
          const pay = [];
          while (pay.length < this.size) {
            const r = it.next();
            if (r.done) { if (!data) pay.push(END); ended = true; break; }
            pay.push(r.value);
            if (data) { data--; continue; }
            if (r.value === END) { ended = true; break; }
            data = itemData(r.value);
          }
          const blk = this.block(pay);
          for (let tries = 0; ; tries++) {
            const wait = this.expect(6);
            await this.link.write(blk);
            const ack = await wait;
            // A report (D4/D5) where an ack belongs. After the END block it is
            // the normal end: with the card's window full the ack waits for a
            // block to drain (FW 0x263A), and END stops the stack first.
            // Anywhere else the card ended the stack itself.
            if (ack[0] === 0xD4 || ack[0] === 0xD5) {
              const rest = await this.expect(44);
              const r = new Uint8Array(50); r.set(ack); r.set(rest, 6);
              if (ended) return parseReport(r);
              const err = new Error('card: the move ended early (the card ran out of data)');
              err.report = parseReport(r);
              throw err;
            }
            if (ack[0] < 0xFE) { if (onAck) onAck(parseAck(ack), k); break; }
            if (tries >= 3) throw new Error('card: block refused 4 times');
          }
          k++;
        }
        return parseReport(await this.expect(50));
      } finally {
        this.streaming = false;
      }
    }
  }

  // Data bytes that follow an item byte; END (0x78) only ends a stack where an item starts.
  function itemData(b) {
    if (!(b & 0x40)) return (b & 1) ? 1 : 0;       // tick; bit 0 = an extra sub-tick byte
    if (b < 0x60) return 5;
    if (b < 0x70) return 1;
    if (b < 0x74) return 2;
    if (b < 0x78) return 1;
    if (b & 2) return 1;
    return 0;
  }

  function i32(b, o) { return (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) | 0; }

  function parseReport(b) {
    const pos = {};
    AXES.forEach((a, i) => { pos[a] = i32(b, 18 + 4 * i); });
    return {
      raw: b, flag: b[0], inputs: b[1], inputs2: b[2], blocks: b[5],
      line: b[6] | b[7] << 8, adc: [0, 1, 2, 3].map(i => b[8 + 2 * i] << 8 | b[9 + 2 * i]),
      steps: pos, ticks: i32(b, 42) >>> 0, io: i32(b, 46) >>> 0
    };
  }

  function parseAck(b) {
    return { raw: b, window: b[0], blocks: b[1], inputs: b[2], inputs2: b[3], ticks: b[4] | b[5] << 8 };
  }

  // ------------------------------------------------------------------ planner
  /**
   * Turns straight moves into card items, with ShopBot-style ramps: speed
   * rises with distance, v = v0 + k*s (VR "ramp rate": 2 in/s gained per
   * `rate` of travel), from the ramp speed v0 up to the move's feed.
   * Corners slow toward v0 by angle; a straight continuation keeps speed.
   *
   *   const p = new Planner(machine)
   *   p.items(moves, startSteps)   -> iterator of item bytes
   *   p.stop() / p.hold()          -> ramp down at the next tick it plans
   * machine: { unit: {x,y,z} steps/mm, rampSpeed mm/s, rampRate mm,
   *            maxTickHz, minTickHz, invert: direction bits to flip (X 1, Y 2, Z 4) }
   */
  class Planner {
    constructor(m) {
      this.m = Object.assign({ rampSpeed: 10.16, rampRate: 5.08, maxTickHz: 25000, minTickHz: 20, invert: 0 }, m);
      this.k = 50.8 / this.m.rampRate;             // (mm/s) per mm
      this.halt = null;                             // 'stop' | null
      this.at = null;                               // { steps, line, v } as planned so far
    }

    stop() { this.halt = 'stop'; }

    toSteps(p) {
      const u = this.m.unit, s = {};
      for (const a of ['x', 'y', 'z']) s[a] = Math.round(p[a] * u[a]);
      return s;
    }

    // Junction speed limits between consecutive moves, then forward/backward
    // passes so no move needs more than k per mm of change.
    profile(moves, from) {
      const v0 = this.m.rampSpeed, k = this.k;
      const segs = [];
      let prev = from;
      for (const mv of moves) {
        const d = { x: mv.x - prev.x, y: mv.y - prev.y, z: mv.z - prev.z };
        const len = Math.hypot(d.x, d.y, d.z);
        if (len < 1e-9) { prev = mv; continue; }
        segs.push({ mv, from: prev, len, dir: { x: d.x / len, y: d.y / len, z: d.z / len }, feed: Math.max(v0, mv.feed || v0) });
        prev = mv;
      }
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i], n = segs[i + 1];
        if (!n) { s.vEnd = v0; continue; }
        const cos = s.dir.x * n.dir.x + s.dir.y * n.dir.y + s.dir.z * n.dir.z;
        const f = cos >= 0.999 ? 1 : cos <= 0 ? 0 : cos * 0.65;   // VR slow-corner 65%
        s.vEnd = Math.max(v0, Math.min(s.feed, n.feed) * f);
      }
      let vIn = v0;
      for (const s of segs) { s.vStart = Math.min(vIn, s.feed); s.vEnd = Math.min(s.vEnd, s.vStart + k * s.len); vIn = s.vEnd; }
      for (let i = segs.length - 1; i >= 0; i--) {
        const s = segs[i];
        const next = i + 1 < segs.length ? segs[i + 1].vStart : v0;
        s.vEnd = Math.min(s.vEnd, next);
        s.vStart = Math.min(s.vStart, s.vEnd + k * s.len);
      }
      return segs;
    }

    reloadFor(stepHz) {
      const hz = Math.min(this.m.maxTickHz, Math.max(this.m.minTickHz, stepHz));
      const counts = Math.max(1, Math.min(0xFFFF, Math.round(TICK_HZ / hz)));
      return 0x10000 - counts;
    }

    /**
     * Item bytes for `ops` from `start` (mm). An op is a move {x,y,z mm, feed
     * mm/s, line}, an output change {out: 12-bit word, line}, or a dwell
     * {dwell: seconds, line}. Motion comes to the ramp speed at every
     * non-move op.
     */
    *items(ops, start) {
      this.halt = null;
      this.st = { cur: this.toSteps(start), dirs: -1, line: -1, reload: -1 };
      let run = [], from = start;
      for (const op of ops) {
        if (op.out === undefined && op.dwell === undefined) { run.push(op); continue; }
        if (run.length) { if (yield* this.moveRun(run, from)) return; from = run[run.length - 1]; run = []; }
        if (this.halt) break;
        if (op.out !== undefined) { yield 0x70; yield op.out & 0xFF; yield (op.out >> 8) & 0x0F; }
        else yield* this.dwell(op.dwell, op.line);
      }
      if (run.length && (yield* this.moveRun(run, from))) return;
      this.at = { steps: this.st.cur, line: this.st.line };
      yield END;
    }

    // Empty ticks at the longest tick (65535 counts, 10.7 ms).
    *dwell(seconds, ln) {
      const st = this.st;
      const n = Math.ceil(Math.max(0, seconds) * TICK_HZ / 0xFFFF);
      if (!n) return;
      st.reload = 1; st.line = (ln || 0) & 0xFFFF;
      yield 0x40; yield Math.max(0, st.dirs) ^ this.m.invert; yield st.line >> 8; yield st.line & 0xFF; yield 0x00; yield 0x01;
      for (let i = 0; i < n && !this.halt; i++) yield 0x00;
    }

    // One run of moves with a shared ramp profile. Returns true when a stop
    // ended the stack.
    *moveRun(moves, start) {
      const segs = this.profile(moves, start);
      const u = this.m.unit, v0 = this.m.rampSpeed, k = this.k;
      const st = this.st;
      let cur = st.cur;
      let dirs = st.dirs, line = st.line, reload = st.reload;
      for (const s of segs) {
        const tgt = this.toSteps(s.mv);
        const d = { x: tgt.x - cur.x, y: tgt.y - cur.y, z: tgt.z - cur.z };
        const n = Math.max(Math.abs(d.x), Math.abs(d.y), Math.abs(d.z));
        if (!n) continue;
        const nd = (d.x >= 0 ? 1 : 0) | (d.y >= 0 ? 2 : 0) | (d.z >= 0 ? 4 : 0);
        const mmPerTick = s.len / n;
        const err = { x: n >> 1, y: n >> 1, z: n >> 1 };
        const ad = { x: Math.abs(d.x), y: Math.abs(d.y), z: Math.abs(d.z) };
        const ln = (s.mv.line || 0) & 0xFFFF;
        let vHalt = null;
        for (let i = 0; i < n; i++) {
          const sDone = i * mmPerTick;
          let v = Math.min(s.feed, s.vStart + k * sDone, s.vEnd + k * (s.len - sDone));
          if (this.halt) {
            if (vHalt === null) vHalt = v;
            vHalt = Math.max(0, vHalt - k * mmPerTick);
            v = vHalt;
            if (v <= v0) { this.at = { steps: cur, line: ln }; yield END; return true; }
          }
          let r = this.reloadFor(v / mmPerTick);
          if (reload >= 0 && Math.abs(r - reload) <= (0x10000 - reload) * 0.005) r = reload;   // ramp in 0.5% steps
          if (nd !== dirs || ln !== line || (r !== reload && r < 0xF000)) {
            dirs = nd; line = st.line = ln; reload = r;
            yield 0x40; yield dirs ^ this.m.invert; yield ln >> 8; yield ln & 0xFF; yield r >> 8; yield r & 0xFF;
          } else if (r !== reload) {
            reload = r;
            yield 0x60 | ((r >> 8) & 0x0F); yield r & 0xFF;
          }
          let bits = 0;
          for (const [a, bit] of [['x', 1], ['y', 2], ['z', 4]]) {
            err[a] += ad[a];
            if (err[a] >= n) { err[a] -= n; bits |= bit; cur[a] += d[a] > 0 ? 1 : -1; }
          }
          yield bits << 1;
        }
        cur = st.cur = tgt;
      }
      Object.assign(st, { cur, dirs, line, reload });
      return false;
    }
  }

  const api = { ShopBotCard, Planner, parseReport, parseAck, itemData, TICK_HZ, END };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShopBotCard = api;
})(typeof window !== 'undefined' ? window : globalThis);
