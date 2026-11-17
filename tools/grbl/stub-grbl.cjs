// A stand-in GRBL 1.1 board for tests with no machine, written from GRBL's public interface
// documents. It behaves the way a host sees the board: bytes in, lines out. The real board is the
// authority; this stub is only as good as the documents and the capture it is checked against.
//
//   const stub = StubGrbl({ timeFactor: 20, settings: { 13: 0 }, phys: { x: 200, y: -200, z: -40 } })
//   stub.onData = bytes => ...       what the board sends (Uint8Array)
//   stub.open()                      the port opens: the board restarts (banner, lock message)
//   stub.write(bytes)                what the host sends
//   stub.close() / stub.halt()       the port closes (the board keeps running) / the stub stops
//   stub.fault.*                     drop the link, a late ok, a restart, a stuck probe, an error on a line
//
// Machine coordinates follow the MR-1: after homing X runs 0..+$130, Y -$131..0, Z -$132..0, and
// the home switches sit just past 0 on X-, Y+ and Z+. Before homing the board counts from wherever
// it powered up (0, 0, 0 there); `phys` is where the axes really are, in homed coordinates.
(function () {
  'use strict';
  const IN = 25.4;
  const RX_SIZE = 127;          // a 128-byte ring holds 127
  const PLANNER = 15;
  const LINE_MAX = 80;
  const BANNER = 'Grbl 1.1h [\'$\' for help]';
  // the MR-1's own table (mm, mm/min, mm/s²): WPos reports with a WCO now and then ($10=0), inches
  // ($13=1), X homes toward minus and Y, Z toward plus ($23=1)
  const FACTORY = {
    0: 10, 1: 255, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 10: 0, 11: 0.010, 12: 0.002, 13: 1, 20: 0, 21: 1, 22: 1, 23: 1, 24: 100, 25: 762, 26: 250, 27: 1.5,
    30: 9000, 31: 0, 32: 0, 100: 320, 101: 320, 102: 533.333, 110: 2540, 111: 2540, 112: 1016, 120: 300, 121: 300, 122: 50, 130: 580, 131: 550, 132: 150
  };
  const SWITCH = 1.5;           // a home switch closes this far past machine 0

  function StubGrbl(opts = {}) {
    const ee = {                // the board's memory: kept across restarts
      settings: Object.assign({}, FACTORY, opts.settings || {}),
      coords: { 54: [0, 0, 0], 55: [0, 0, 0], 56: [0, 0, 0], 57: [0, 0, 0], 58: [0, 0, 0], 59: [0, 0, 0], 28: [0, 0, 0], 30: [0, 0, 0] }
    };
    const S = ee.settings;
    const s = {
      tf: opts.timeFactor || 1, banner: opts.banner || BANNER, q: opts.q,
      phys: [0, 0, 0], off: [0, 0, 0],                 // machine position = phys - off
      state: 'Alarm', sub: null, rx: [], planner: [], cur: null, pending: null,
      modal: null, g92: [0, 0, 0], prb: [0, 0, 0], prbOk: 0, spindle: { on: false, ccw: false, S: 0 }, flood: false,
      ov: [100, 100, 100], critical: false, check: false, homeEnd: 0, holdEnd: 0, cancelEnd: 0, m0: false,
      reports: 0, lastWco: '', lastOv: '', simT: 0, linesIn: 0, dropped: 0, rxMax: 0, received: [],
      probeAt: opts.probeAt || null, stuckProbe: false, unplugged: false, open: false, okDelay: 0, failLine: 0, failCode: 0, homeFail: 0
    };
    if (opts.phys) s.phys = [opts.phys.x || 0, opts.phys.y || 0, opts.phys.z || 0];
    const stub = { onData: null, onClose: null, state: s, eeprom: ee, settings: S };
    const outq = [];
    let holdOut = 0, timer = null, last = 0;

    // ------------------------------------------------------------ output
    function out(line) { outq.push(line + '\r\n'); }
    function flushOut() {
      if (!outq.length || Date.now() < holdOut || s.unplugged) return;
      const text = outq.splice(0).join('');
      const bytes = Uint8Array.from(text, c => c.charCodeAt(0));
      if (stub.onData) stub.onData(bytes);
    }
    function ok() {
      if (s.okDelay) { flushOut(); holdOut = Date.now() + s.okDelay; s.okDelay = 0; }
      out('ok');
    }
    function err(n) { out(`error:${n}`); }

    // ------------------------------------------------------------ positions
    const mpos = () => s.phys.map((v, i) => v - s.off[i]);
    const wco = () => { const c = ee.coords[s.modal.coord]; return [0, 1, 2].map(i => c[i] + s.g92[i]); };
    const inch = () => S[13] === 1;
    const num = (v, inchy) => inchy ? (v / IN).toFixed(4) : v.toFixed(3);
    const vec = v => v.map(x => num(x, inch())).join(',');
    function resetModal() { s.modal = { motion: 0, coord: 54, units: 21, dist: 90, feed: 0 }; s.g92 = [0, 0, 0]; }
    resetModal();
    const travelOk = m => m[0] >= 0 && m[0] <= S[130] && m[1] <= 0 && m[1] >= -S[131] && m[2] <= 0 && m[2] >= -S[132];
    const probeHit = () => s.stuckProbe || !!(s.probeAt && s.probeAt(s.phys.slice()));
    const pins = () => {
      let p = '';
      if (s.phys[0] <= -SWITCH) p += 'X';
      if (s.phys[1] >= SWITCH) p += 'Y';
      if (s.phys[2] >= SWITCH) p += 'Z';
      if (probeHit()) p += 'P';
      return p;
    };

    // ------------------------------------------------------------ restart and reset
    function restart(power) {
      const moving = !power && (s.state === 'Run' || s.state === 'Jog' || s.state === 'Home' || (s.state === 'Hold' && s.sub === 1));
      const wasAlarm = s.state === 'Alarm';
      if (moving) out(s.state === 'Home' ? 'ALARM:6' : 'ALARM:3');
      if (power) s.off = s.phys.slice();           // the count starts again from 0 where the axes are
      s.rx = []; s.planner = []; s.cur = null; s.pending = null; s.m0 = false; s.critical = false;
      s.spindle = { on: false, ccw: false, S: 0 }; s.flood = false; s.ov = [100, 100, 100]; s.check = false;
      resetModal();
      s.reports = 0; s.lastWco = ''; s.lastOv = '';
      s.state = (power || moving || wasAlarm) && S[22] === 1 ? 'Alarm' : 'Idle';
      s.sub = null;
      out('');
      out(s.banner);
      if (s.state === 'Alarm') out('[MSG:\'$H\'|\'$X\' to unlock]');
    }
    function alarm(n, critical) {
      out(`ALARM:${n}`);
      s.planner = []; s.cur = null; s.pending = null; s.rx = [];
      s.spindle.on = false; s.flood = false;
      s.state = 'Alarm'; s.sub = null;
      if (critical) { s.critical = true; out('[MSG:Reset to continue]'); }
    }

    // ------------------------------------------------------------ real-time bytes
    function realtime(b) {
      if (b === 0x18) { restart(false); return; }
      if (s.critical) return;
      if (b === 0x3F) { report(); return; }
      if (b === 0x21) { feedHold(); return; }
      if (b === 0x7E) { cycleStart(); return; }
      if (b === 0x85) { if (s.state === 'Jog' && !s.cancelEnd) s.cancelEnd = s.simT + decel(); return; }
      if (b >= 0x90 && b <= 0x94) { const f = s.ov[0]; s.ov[0] = Math.max(10, Math.min(200, b === 0x90 ? 100 : b === 0x91 ? f + 10 : b === 0x92 ? f - 10 : b === 0x93 ? f + 1 : f - 1)); return; }
      if (b >= 0x95 && b <= 0x97) { s.ov[1] = b === 0x95 ? 100 : b === 0x96 ? 50 : 25; return; }
      if (b >= 0x99 && b <= 0x9D) { const v = s.ov[2]; s.ov[2] = Math.max(10, Math.min(200, b === 0x99 ? 100 : b === 0x9A ? v + 10 : b === 0x9B ? v - 10 : b === 0x9C ? v + 1 : v - 1)); return; }
      if (b === 0xA0) { s.flood = !s.flood; return; }
      // anything else of 0x80 and above is taken out of the stream and ignored
    }
    function rate() { const c = s.cur; return c ? c.rate : 0; }
    function decel() {
      const v = rate() / 60;
      return Math.min(0.5, v / Math.min(S[120], S[121], S[122]));
    }
    function feedHold() {
      if (s.state === 'Jog') { if (!s.cancelEnd) s.cancelEnd = s.simT + decel(); return; }
      if (s.state === 'Run') { s.state = 'Hold'; s.sub = 1; s.holdEnd = s.simT + decel(); return; }
      if (s.state === 'Idle' && !s.planner.length && !s.cur) { s.state = 'Hold'; s.sub = 0; }
    }
    // a cycle start acts only once a hold has come to rest (Hold:0); one sent while it slows is lost
    function cycleStart() {
      if (s.state !== 'Hold' || s.sub !== 0) return;
      if (s.m0) { s.m0 = false; s.state = s.cur || s.planner.length ? 'Run' : 'Idle'; s.sub = null; ok(); return; }
      s.state = s.cur || s.planner.length ? 'Run' : 'Idle'; s.sub = null;
    }

    // ------------------------------------------------------------ status
    function report() {
      if (s.state === 'Home' || s.critical) return;      // the board answers no status during homing
      const st = s.state === 'Hold' ? `Hold:${s.sub}` : s.state;
      const m = mpos(), w = wco();
      let r = `<${st}|`;
      r += (S[10] & 1) ? `MPos:${vec(m)}` : `WPos:${vec(m.map((v, i) => v - w[i]))}`;
      if (S[10] & 2) r += `|Bf:${PLANNER - s.planner.length},${RX_SIZE - s.rx.length}`;
      const feed = (s.state === 'Run' || s.state === 'Jog') ? rate() : 0;
      r += `|FS:${inch() ? (feed / IN).toFixed(1) : feed.toFixed(0)},${s.spindle.on ? s.spindle.S : 0}`;
      const p = pins();
      if (p) r += `|Pn:${p}`;
      const moving = s.state === 'Run' || s.state === 'Jog';
      const wv = vec(w);
      if (s.reports % (moving ? 30 : 10) === 0 || wv !== s.lastWco) { r += `|WCO:${wv}`; s.lastWco = wv; }
      const ov = s.ov.join(','), a = (s.spindle.on ? (s.spindle.ccw ? 'C' : 'S') : '') + (s.flood ? 'F' : '');
      const ova = ov + a;
      if (s.reports % (moving ? 20 : 10) === 1 || ova !== s.lastOv) { r += `|Ov:${ov}`; if (a) r += `|A:${a}`; s.lastOv = ova; }
      if (s.q !== undefined) r += `|Q:${s.q}`;
      s.reports++;
      if (s.garble) { s.garble = false; r = r.includes('WCO:') ? r.replace(/WCO:([-\d.]+),/, 'WCO:$1') : r.replace(/Pos:([-\d.]+),/, 'Pos:$1'); }
      out(r + '>');
    }

    // ------------------------------------------------------------ lines
    function busy() { return !(s.state === 'Idle' || s.state === 'Alarm' || s.state === 'Check'); }
    function exec(raw) {
      s.linesIn++;
      s.received.push(raw);
      if (s.received.length > 5000) s.received.shift();
      // the board's own reading: spaces and comments gone, upper case, counted against its 80-byte buffer
      let t = '', paren = false;
      for (const ch of raw) {
        if (paren) { if (ch === ')') paren = false; continue; }
        if (ch === '(') { paren = true; continue; }
        if (ch === ';') break;
        if (ch <= ' ') continue;
        t += ch.toUpperCase();
      }
      if (t.length >= LINE_MAX) return err(11);
      if (s.failLine && s.linesIn === s.failLine) { s.failLine = 0; return err(s.failCode || 20); }
      if (!t) return ok();
      if (t[0] === '$') return system(t);
      if (s.state === 'Alarm' || s.state === 'Jog') return err(9);
      return gcode(t);
    }

    function system(t) {
      if (t === '$') { out('[HLP:$$ $# $G $I $N $x=val $Nx=line $J=line $SLP $C $X $H ~ ! ? ctrl-x]'); return ok(); }
      if (t === '$$') {
        if (busy()) return err(8);
        for (const k of Object.keys(S).map(Number).sort((a, b) => a - b)) out(`$${k}=${Number.isInteger(S[k]) ? S[k] : S[k].toFixed(3)}`);
        return ok();
      }
      if (t === '$#') {
        for (const n of [54, 55, 56, 57, 58, 59]) out(`[G${n}:${vec(ee.coords[n])}]`);
        out(`[G28:${vec(ee.coords[28])}]`); out(`[G30:${vec(ee.coords[30])}]`); out(`[G92:${vec(s.g92)}]`);
        out(`[TLO:${num(0, inch())}]`); out(`[PRB:${vec(s.prb)}:${s.prbOk}]`);
        return ok();
      }
      if (t === '$G') {
        const m = s.modal;
        out(`[GC:G${m.motion} G${m.coord} G17 G${m.units} G${m.dist} G94 M${s.spindle.on ? (s.spindle.ccw ? 4 : 3) : 5} M${s.flood ? 8 : 9} T0 F${m.feed / (m.units === 20 ? IN : 1)} S${s.spindle.S}]`);
        return ok();
      }
      if (t === '$I') { out('[VER:1.1h.20190825:]'); out('[OPT:V,15,128]'); return ok(); }
      if (t === '$N') { out('$N0='); out('$N1='); return ok(); }
      if (t === '$X') { if (s.state === 'Alarm') { s.state = 'Idle'; out('[MSG:Caution: Unlocked]'); } return ok(); }
      if (t === '$H') {
        if (S[22] !== 1) return err(5);
        if (!(s.state === 'Idle' || s.state === 'Alarm')) return err(8);
        s.state = 'Home'; s.sub = null;
        s.homeEnd = s.simT + (opts.homeSecs || 6);
        return;     // its ok comes when homing ends
      }
      if (t === '$C') {
        if (s.state === 'Check') { out('[MSG:Disabled]'); ok(); restart(false); return; }
        if (s.state !== 'Idle') return err(8);
        s.state = 'Check'; out('[MSG:Enabled]'); return ok();
      }
      if (t.startsWith('$J=')) return jog(t.slice(3));
      const m = /^\$(\d+)=([-\d.]+)$/.exec(t);
      if (m) { if (busy()) return err(8); S[+m[1]] = +m[2]; return ok(); }
      return err(3);
    }

    // words of a line: [['G', 1], ['X', 10], ...]; null when something is not a word
    function words(t) {
      const out = [], re = /([A-Z])([-+]?(?:\d+\.?\d*|\.\d+))/gy;
      let m, at = 0;
      while (at < t.length) {
        re.lastIndex = at;
        m = re.exec(t);
        if (!m) return null;
        out.push([m[1], +m[2]]);
        at = re.lastIndex;
      }
      return out;
    }

    function plannedEnd() {
      const b = s.planner[s.planner.length - 1] || s.cur;
      return b ? b.to.slice() : mpos();
    }

    // a block's speed (mm/min) and length: the feed, or the rapid, capped so no axis runs past its own rate
    function block(from, to, feed, kind) {
      const d = to.map((v, i) => v - from[i]);
      const len = Math.hypot(...d);
      let cap = Infinity;
      [S[110], S[111], S[112]].forEach((r, i) => { if (Math.abs(d[i]) > 1e-9) cap = Math.min(cap, r * len / Math.abs(d[i])); });
      let r = kind === 'rapid' ? cap * s.ov[1] / 100 : Math.min(cap, feed * (kind === 'jog' ? 1 : s.ov[0] / 100));
      return { from: from.slice(), to: to.slice(), len, rate: r, kind, t: 0, dur: len > 0 ? len / (r / 60) : 0 };
    }

    function jog(body) {
      if (!(s.state === 'Idle' || s.state === 'Jog')) return err(8);
      const w = words(body);
      if (!w) return err(16);
      let units = s.modal.units, dist = s.modal.dist, mach = false, f = null;
      const ax = {};
      for (const [k, v] of w) {
        if (k === 'G') { if (v === 20 || v === 21) units = v; else if (v === 90 || v === 91) dist = v; else if (v === 53) mach = true; else return err(16); }
        else if (k === 'X' || k === 'Y' || k === 'Z') ax['XYZ'.indexOf(k)] = v;
        else if (k === 'F') f = v;
        else if (k === 'N') continue;
        else return err(16);
      }
      if (f === null) return err(22);
      if (!Object.keys(ax).length) return err(16);
      const u = units === 20 ? IN : 1, base = plannedEnd(), w0 = wco(), to = base.slice();
      for (const [i, v] of Object.entries(ax)) to[i] = mach ? v * u : dist === 91 ? base[i] + v * u : v * u + w0[i];
      if (S[20] === 1 && !travelOk(to)) return err(15);
      if (s.planner.length >= PLANNER) return err(16);
      s.planner.push(block(base, to, f * u, 'jog'));
      s.state = 'Jog';
      return ok();
    }

    const G_OK = new Set([0, 1, 2, 3, 4, 10, 17, 20, 21, 38.2, 38.3, 38.4, 38.5, 53, 54, 55, 56, 57, 58, 59, 80, 90, 91, 92, 94]);
    const M_OK = new Set([0, 1, 2, 3, 4, 5, 8, 9, 30]);
    function gcode(t) {
      const w = words(t);
      if (!w) return err(1);
      const g = [], m = [], v = {};
      for (const [k, n] of w) {
        if (k === 'G') { const c = Math.round(n * 10) / 10; if (!G_OK.has(c)) return err(20); g.push(c); }
        else if (k === 'M') { if (!M_OK.has(n)) return err(20); m.push(n); }
        else if ('XYZFSPLIJKRNT'.includes(k)) { if (k in v) return err(25); v[k] = n; }
        else return err(20);
      }
      const M = s.modal;
      // modal words first, as the board orders them
      for (const c of g) {
        if (c === 20 || c === 21) M.units = c;
        else if (c === 90 || c === 91) M.dist = c;
        else if (c >= 54 && c <= 59) M.coord = c;
      }
      const u = M.units === 20 ? IN : 1;
      if ('F' in v) M.feed = v.F * u;
      const axes = ['X', 'Y', 'Z'].filter(k => k in v);
      const motion = g.find(c => c === 0 || c === 1 || c === 2 || c === 3 || c >= 38.2 && c <= 38.5);
      const steps = [];
      if ('S' in v) steps.push({ sync: s.spindle.on, run: () => { s.spindle.S = v.S; } });
      if (m.includes(3) || m.includes(4)) steps.push({ sync: true, run: () => { s.spindle.on = true; s.spindle.ccw = m.includes(4); } });
      if (m.includes(5)) steps.push({ sync: true, run: () => { s.spindle.on = false; } });
      if (m.includes(8)) steps.push({ sync: true, run: () => { s.flood = true; } });
      if (m.includes(9)) steps.push({ sync: true, run: () => { s.flood = false; } });
      if (g.includes(4)) {
        if (!('P' in v)) return err(28);
        const secs = v.P;
        steps.push({ sync: true, run: () => { if (!s.check) s.pending = { until: s.simT + secs, then: null }; } });
      }
      if (g.includes(10)) {
        const L = v.L, P = v.P === 0 ? s.modal.coord - 53 : v.P;
        if (!(L === 2 || L === 20) || !(P >= 1 && P <= 6)) return err(28);
        steps.push({ sync: true, run: () => {
          const c = ee.coords[53 + P], mp = mpos();
          ['X', 'Y', 'Z'].forEach((k, i) => { if (k in v) c[i] = L === 2 ? v[k] * u : mp[i] - s.g92[i] - v[k] * u; });
        } });
      }
      if (g.includes(92)) steps.push({ sync: true, run: () => { const mp = mpos(), c = ee.coords[s.modal.coord]; ['X', 'Y', 'Z'].forEach((k, i) => { if (k in v) s.g92[i] = mp[i] - c[i] - v[k] * u; }); } });
      if (motion !== undefined && !g.includes(10) && !g.includes(92)) {
        if (motion < 38 && motion !== M.motion) M.motion = motion;
      } else if (motion === undefined && axes.length && !g.includes(10) && !g.includes(92)) {
        // axis words with no motion word: the modal motion
      }
      const mo = motion !== undefined ? motion : M.motion;
      if (axes.length && !g.includes(10) && !g.includes(92)) {
        if (mo !== 0 && !(M.feed > 0)) return err(22);
        const base = plannedEnd(), w0 = wco(), to = base.slice(), mach = g.includes(53);
        ['X', 'Y', 'Z'].forEach((k, i) => { if (k in v) to[i] = mach ? v[k] * u : M.dist === 91 ? base[i] + v[k] * u : v[k] * u + w0[i]; });
        if (mo === 2 || mo === 3) {
          // the arc's end must lie on its circle; the stub moves along the chord
          const I = (v.I || 0) * u, J = (v.J || 0) * u;
          if (!('I' in v) && !('J' in v)) return err(35);
          const r0 = Math.hypot(I, J), r1 = Math.hypot(base[0] + I - to[0], base[1] + J - to[1]);
          if (Math.abs(r0 - r1) > 0.005 && Math.abs(r0 - r1) > 0.001 * r0) return err(33);
        }
        if (mo >= 38.2) {
          steps.push({ sync: true, run: () => probe(mo, to) });
        } else {
          steps.push({ sync: false, run: () => {
            if (s.check) return;
            if (S[20] === 1 && !travelOk(to)) { alarm(2, true); return 'alarm'; }
            s.planner.push(block(plannedEnd(), to, M.feed, mo === 0 ? 'rapid' : 'feed'));
            if (s.state === 'Idle') s.state = 'Run';
          } });
        }
      }
      if (m.includes(0)) steps.push({ sync: true, run: () => { if (!s.check) { s.m0 = true; s.state = 'Hold'; s.sub = 0; return 'm0'; } } });
      if (m.includes(2) || m.includes(30)) steps.push({ sync: true, run: () => { resetModal(); s.spindle.on = false; s.flood = false; out('[MSG:Pgm End]'); } });
      s.pending = { steps, i: 0 };
      advance();
    }

    // a line's steps run in order; a step that needs the planner empty waits for it, and the line's
    // ok goes only when every step has run (so G4, M0, M3 and G10 wait for motion before their ok)
    function advance() {
      const p = s.pending;
      if (!p) return;
      if (p.until !== undefined) { if (s.simT < p.until) return; s.pending = p.then; return advance(); }
      if (p.probe) return;
      while (p.i < p.steps.length) {
        const st = p.steps[p.i];
        if (st.sync && !s.check && (s.cur || s.planner.length || s.state === 'Hold')) return;
        p.i++;
        const r = st.run();
        if (r === 'alarm') return;
        if (r === 'm0') { s.pending = null; return; }   // its ok waits for ~
        if (s.pending !== p) { s.pending.then = p; return; }   // a dwell or a probe took over
      }
      s.pending = null;
      ok();
    }

    function probe(mo, to) {
      if (s.check) return;
      const towards = mo === 38.2 || mo === 38.3;
      if (probeHit() === towards) { alarm(4, false); return 'alarm'; }
      const b = block(mpos(), to, s.modal.feed, 'feed');
      b.probe = { towards, fail: mo === 38.2 || mo === 38.4 };
      s.planner.push(b);
      s.state = 'Run';
      s.pending = { probe: true, then: null };
    }
    function probeDone(found) {
      s.prb = mpos(); s.prbOk = found ? 1 : 0;
      const p = s.pending; s.pending = null;
      const failAlarm = !found && s.cur && s.cur.probe.fail;
      s.cur = null; s.planner = [];
      s.state = 'Idle';
      out(`[PRB:${vec(s.prb)}:${s.prbOk}]`);
      if (failAlarm) { alarm(5, false); return; }
      if (p && p.then) { s.pending = p.then; advance(); } else ok();
    }

    // ------------------------------------------------------------ the main loop
    function mainLoop() {
      for (let guard = 0; guard < 1000; guard++) {
        if (s.critical || s.state === 'Home' || s.cancelEnd) return;
        if (s.pending) { advance(); if (s.pending) return; }
        if (s.planner.length >= PLANNER) return;
        const nl = s.rx.findIndex(b => b === 10 || b === 13);
        if (nl < 0) return;
        const bytes = s.rx.splice(0, nl + 1);
        exec(String.fromCharCode(...bytes.slice(0, -1)));
      }
    }

    function motion(dt) {
      if (s.state === 'Home') {
        if (s.simT >= s.homeEnd) {
          // a failed home resets the board: the alarm, then its banner and the lock message, unasked
          if (s.homeFail) { const n = s.homeFail; s.homeFail = 0; s.state = 'Idle'; alarm(n, false); restart(false); return; }
          s.phys = [0, 0, 0]; s.off = [0, 0, 0];
          s.state = 'Idle';
          ok();
        }
        return;
      }
      if (s.state === 'Hold' && s.sub === 1 && s.simT >= s.holdEnd) s.sub = 0;
      if (s.state === 'Hold' && s.sub === 0) return;
      let budget = dt * (s.state === 'Hold' || s.cancelEnd ? 0.5 : 1);
      if (s.cancelEnd && s.simT >= s.cancelEnd) { s.cancelEnd = 0; s.planner = []; s.cur = null; s.state = 'Idle'; return; }
      while (budget > 0) {
        if (!s.cur) { s.cur = s.planner.shift() || null; if (!s.cur) break; }
        const c = s.cur;
        const step = Math.min(budget, c.dur - c.t);
        c.t += step; budget -= step;
        const f = c.dur > 0 ? c.t / c.dur : 1;
        const p = c.from.map((v, i) => v + (c.to[i] - v) * f);
        s.phys = p.map((v, i) => v + s.off[i]);
        if (c.probe && probeHit() === c.probe.towards) { probeDone(true); return; }
        // the home switches are the only limit switches: past one, the board stops dead
        if (S[21] === 1 && (s.phys[0] <= -SWITCH - 0.2 || s.phys[1] >= SWITCH + 0.2 || s.phys[2] >= SWITCH + 0.2)) { alarm(1, true); return; }
        if (c.t >= c.dur) { if (c.probe) { probeDone(false); return; } s.cur = null; }
      }
      if (!s.cur && !s.planner.length && (s.state === 'Run' || s.state === 'Jog')) { s.state = 'Idle'; }
    }

    function tick() {
      const t = Date.now(), dt = Math.min(0.1, (t - last) / 1000) * s.tf;
      last = t;
      s.simT += dt;
      motion(dt);
      mainLoop();
      flushOut();
    }

    // ------------------------------------------------------------ the port
    stub.open = () => {
      s.unplugged = false; s.open = true;
      if (!timer) { last = Date.now(); timer = setInterval(tick, 2); }
      restart(true);
      setTimeout(flushOut, 0);
    };
    stub.write = bytes => {
      if (s.unplugged) throw new Error('the device has been lost');
      for (const b of bytes) {
        if (b === 0x18 || b === 0x3F || b === 0x21 || b === 0x7E || b >= 0x80) { realtime(b); continue; }
        if (s.critical) continue;
        if (s.rx.length < RX_SIZE) s.rx.push(b); else s.dropped++;
        s.rxMax = Math.max(s.rxMax, s.rx.length);
      }
      mainLoop();
      setTimeout(flushOut, 0);
      return bytes.length;
    };
    // the port closes; the board itself keeps running whatever it holds
    stub.close = () => { s.open = false; };
    stub.halt = () => { clearInterval(timer); timer = null; };
    stub.mpos = mpos;
    stub.wco = wco;

    stub.fault = {
      // the cable comes out: writes fail, the host hears the port close; the board runs on
      drop() { s.unplugged = true; if (stub.onClose) stub.onClose(new Error('the device has been lost')); },
      // the next ok (and everything after it) arrives ms late
      lateOk(ms) { s.okDelay = ms; },
      // the board restarts by itself (power, the e-stop): banner, lock, position from 0
      restart() { restart(true); },
      // the probe input reads contact whatever happens
      stuckProbe(on = true) { s.stuckProbe = !!on; },
      // the nth line from now answers error:code
      errorOnLine(n, code = 20) { s.failLine = s.linesIn + n; s.failCode = code; },
      // the next homing fails with alarm n
      homeFail(n = 9) { s.homeFail = n; },
      // the next status report arrives damaged: a byte of its WCO (or position) field changed
      garble() { s.garble = true; },
      // the board's own hold and cycle start inputs (a button, or an e-stop wired as a hold)
      hold() { feedHold(); },
      cycleStart() { cycleStart(); }
    };
    return stub;
  }

  // node: require it; a page (the browser gate): a global
  if (typeof module !== 'undefined' && module.exports) module.exports = StubGrbl;
  else globalThis.StubGrbl = StubGrbl;
})();
