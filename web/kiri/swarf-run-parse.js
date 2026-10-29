/**
 * swarf run — part-file reader for Run mode.
 *
 * Turns an OpenSBP (.sbp) or G-code (.nc/.tap/.gcode) program into a list of
 * straight segments the Run viewer draws and the simulator replays. ShopBot 3
 * runs both languages, mixed in one file, so one reader handles both.
 *
 * Output (all lengths in mm, speeds in mm/s):
 *   { units, moves:[{x0,y0,z0,x,y,z,rapid,feed,line}], events:[{line,kind,value}],
 *     warnings:[{line,text}], unsupported:[{line,text}], bounds, seconds, lines }
 *
 * What it does not run: SBP control flow (IF/GOTO/GOSUB other than VCarve's
 * unit check), loops, variables in motion parameters it cannot resolve. Those
 * lines land in `unsupported`, so the preview can say what it skipped.
 */
(function (root) {
  'use strict';
  // the deploy stamps every machine-control file; connect refuses a page that mixes two builds
  (typeof window !== 'undefined' ? window : globalThis).SWARF_BUILDS = Object.assign((typeof window !== 'undefined' ? window : globalThis).SWARF_BUILDS || {}, { 'swarf-run-parse.js': '__SWARF_BUILD__' });

  const IN = 25.4;

  function parse(text, opts = {}) {
    const machineUnits = opts.machineUnits || 'mm';
    const lines = String(text).split(/\r\n|\r|\n/);
    const out = {
      units: null, moves: [], events: [], warnings: [], unsupported: [],
      bounds: null, seconds: 0, lines: lines.length
    };
    const st = {
      x: opts.start ? opts.start.x : 0,
      y: opts.start ? opts.start.y : 0,
      z: opts.start ? opts.start.z : 0,
      abs: true, scale: 1,
      moveXY: 76.2, moveZ: 25.4, jogXY: 100, jogZ: 100,   // ShopBot defaults (mm/s); the file's MS/JS win
      gfeed: null, gmode: 0, I: 0, J: 0,
      vars: Object.create(null)
    };

    function setUnits(u, line) {
      if (out.units && out.units !== u) out.warnings.push({ line, text: `units change to ${u}` });
      out.units = u;
      st.scale = u === 'in' ? IN : 1;
    }

    function val(tok) {
      if (tok === undefined) return undefined;
      tok = tok.trim();
      if (tok === '') return undefined;
      if (tok[0] === '&') {
        const v = st.vars[tok.slice(1).toLowerCase()];
        return v === undefined ? NaN : v;
      }
      const n = Number(tok);
      return Number.isFinite(n) ? n : NaN;
    }

    function target(cur, tok) {
      const v = val(tok);
      if (v === undefined) return cur;
      if (Number.isNaN(v)) return NaN;
      return st.abs ? v * st.scale : cur + v * st.scale;
    }

    function seg(x, y, z, rapid, feed, line) {
      if ([x, y, z].some(Number.isNaN)) {
        out.unsupported.push({ line, text: lines[line - 1].trim() });
        return;
      }
      if (x === st.x && y === st.y && z === st.z) return;
      out.moves.push({ x0: st.x, y0: st.y, z0: st.z, x, y, z, rapid, feed, line });
      const d = Math.hypot(x - st.x, y - st.y, z - st.z);
      if (feed > 0) out.seconds += d / feed;
      st.x = x; st.y = y; st.z = z;
    }

    // Speed for an SBP move: XY speed, unless the move is Z only.
    function sbpFeed(x, y, jog) {
      const zOnly = x === st.x && y === st.y;
      if (jog) return zOnly ? st.jogZ : st.jogXY;
      return zOnly ? st.moveZ : st.moveXY;
    }

    function arc(x, y, z, i, j, cw, feed, rapid, line) {
      const cx = st.x + i, cy = st.y + j;
      const r = Math.hypot(st.x - cx, st.y - cy);
      if (!(r > 0)) { seg(x, y, z, rapid, feed, line); return; }
      let a0 = Math.atan2(st.y - cy, st.x - cx);
      let a1 = Math.atan2(y - cy, x - cx);
      let sweep = a1 - a0;
      if (cw) { if (sweep >= 0) sweep -= 2 * Math.PI; }
      else { if (sweep <= 0) sweep += 2 * Math.PI; }
      const n = Math.max(4, Math.ceil(Math.abs(sweep) * r / 1.0));   // ~1 mm chords
      const z0 = st.z;
      for (let k = 1; k <= n; k++) {
        const a = a0 + sweep * k / n;
        const px = k === n ? x : cx + r * Math.cos(a);
        const py = k === n ? y : cy + r * Math.sin(a);
        seg(px, py, z0 + (z - z0) * k / n, rapid, feed, line);
      }
    }

    function event(line, kind, value) { out.events.push({ line, kind, value }); }

    for (let n = 1; n <= lines.length; n++) {
      let raw = lines[n - 1];
      const uc = raw.match(/^\s*'\s*UNITS\s*:\s*(MM|INCH|IN)/i);
      if (uc) { setUnits(/^MM$/i.test(uc[1]) ? 'mm' : 'in', n); continue; }
      // strip comments: SBP ' to end, G-code ( ) and ;
      let s = raw.replace(/'.*$/, '').replace(/(?<!%)\([^)]*\)/g, '').replace(/;.*$/, '').trim();
      if (!s) continue;
      const U = s.toUpperCase();

      // VCarve's unit check: %(25) is ShopBot's unit flag, 0 = inch, 1 = mm.
      // "IF %(25)=0 THEN GOTO UNIT_ERROR" means this file needs mm.
      const uchk = U.match(/^IF\s+%\(25\)\s*=\s*([01])\s+THEN\s+GOTO\s+UNIT_ERROR/);
      if (uchk) { setUnits(uchk[1] === '0' ? 'mm' : 'in', n); continue; }
      if (/^END\b/.test(U)) break;
      if (/^[A-Z_][A-Z0-9_]*:\s*$/.test(U)) continue;                       // label
      const asg = s.match(/^&([A-Za-z_][\w]*)\s*=\s*(.+)$/);
      if (asg) {
        const v = Number(asg[2].trim());
        if (Number.isFinite(v)) st.vars[asg[1].toLowerCase()] = v;
        else st.vars[asg[1].toLowerCase()] = asg[2].trim();
        if (asg[1].toLowerCase() === 'tool') {
          event(n, 'tool', asg[2].trim());
          // swarf's post names the bit in the comment: &Tool =3   'Load 6 mm flat end mill
          const nm = raw.match(/'\s*Load\s+(.+?)\s*$/i);
          if (nm) event(n, 'tool-name', nm[1]);
        }
        continue;
      }

      // G-code: a line that starts with G/M/T/S/F/N or bare axis words. A comma
      // after the first token makes it SBP: "M3,1,2,0" is a move, "M3 S9000" a spindle.
      if (!/^[A-Z][A-Z0-9]*\s*,/.test(U) && /^(N\d+\s*)?[GMTSFXYZIJ][-+.\d]/.test(U)) {
        gcodeLine(U, n);
        if (st.ended) break;          // M2 / M30: the program ends here
        continue;
      }

      // "MX, 3" and "PAUSE 2" both occur: the command ends at the first comma or space
      const cmdm = s.match(/^([A-Za-z][A-Za-z0-9]*)\s*,?\s*(.*)$/);
      const cmd = cmdm[1].toUpperCase();
      const p = cmdm[2] === '' ? [] : cmdm[2].split(',');
      const NUMERIC = /^(M[23XYZ]|J[23XYZ]|MS|JS|TR|TS|SO|VS|PAUSE)$/;
      if (NUMERIC.test(cmd) && p.some(t => t.trim() !== '' && Number.isNaN(val(t)))) { out.unsupported.push({ line: n, text: s }); continue; }
      switch (cmd) {
        case 'MX': seg(target(st.x, p[0]), st.y, st.z, false, sbpFeed(NaN, st.y, false), n); break;
        case 'MY': seg(st.x, target(st.y, p[0]), st.z, false, sbpFeed(st.x, NaN, false), n); break;
        case 'MZ': seg(st.x, st.y, target(st.z, p[0]), false, st.moveZ, n); break;
        case 'JX': seg(target(st.x, p[0]), st.y, st.z, true, st.jogXY, n); break;
        case 'JY': seg(st.x, target(st.y, p[0]), st.z, true, st.jogXY, n); break;
        case 'JZ': seg(st.x, st.y, target(st.z, p[0]), true, st.jogZ, n); break;
        case 'M2': case 'J2': case 'M3': case 'J3': {
          const jog = cmd[0] === 'J';
          const x = target(st.x, p[0]), y = target(st.y, p[1]);
          const z = cmd[1] === '3' ? target(st.z, p[2]) : st.z;
          seg(x, y, z, jog, sbpFeed(x, y, jog), n);
          break;
        }
        case 'CG': {
          // CG, diameter, xEnd, yEnd, I, J, O/I/T, dir(1 cw, -1 ccw), plunge, reps
          if (val(p[0]) !== undefined) { out.unsupported.push({ line: n, text: s }); break; }
          const x = target(st.x, p[1]), y = target(st.y, p[2]);
          const iv = val(p[3]), jv = val(p[4]);
          if (iv !== undefined) st.I = iv * st.scale;
          if (jv !== undefined) st.J = jv * st.scale;
          const dir = val(p[6]);
          const plunge = val(p[7]), reps = val(p[8]);
          if ((plunge && plunge !== 0) || (reps && reps > 1)) { out.unsupported.push({ line: n, text: s }); break; }
          arc(x, y, st.z, st.I, st.J, dir !== -1, st.moveXY, false, n);
          break;
        }
        case 'MS': {
          const a = val(p[0]), b = val(p[1]);
          if (a > 0) st.moveXY = a * st.scale;
          if (b > 0) st.moveZ = b * st.scale;
          break;
        }
        case 'JS': {
          const a = val(p[0]), b = val(p[1]);
          if (a > 0) st.jogXY = a * st.scale;
          if (b > 0) st.jogZ = b * st.scale;
          break;
        }
        case 'SA': st.abs = true; break;
        case 'SR': st.abs = false; break;
        case 'TR': event(n, 'rpm', val(p[0])); break;
        case 'PAUSE': event(n, 'pause', val(p[0])); break;
        case 'SO': event(n, 'output', [val(p[0]), val(p[1])]); break;
        case 'TS': event(n, 'rpm', val(p[0])); break;
        case 'VS': {
          // VS move XY, move Z, …, jog XY, jog Z: the speeds a file sets for itself
          const a = val(p[0]), b = val(p[1]), c = val(p[4]), d = val(p[5]);
          if (a > 0) st.moveXY = a * st.scale; if (b > 0) st.moveZ = b * st.scale;
          if (c > 0) st.jogXY = c * st.scale; if (d > 0) st.jogZ = d * st.scale;
          event(n, 'setting', cmd); break;
        }
        case 'VD': case 'VU': case 'VR': case 'VC': case 'VL': case 'VN': case 'VI':
          event(n, 'setting', cmd); break;
        case 'CN': {
          const c = val(p[0]);
          if (c === 90) break;                                  // absolute-mode macro
          out.unsupported.push({ line: n, text: s }); break;     // any other: swarf does not run it
        }
        default: {
          const cm = cmd.match(/^C(\d+)$/);
          if (cm) {
            const k = Number(cm[1]);
            const kind = { 6: 'spindle-on', 7: 'spindle-off', 9: 'tool-change', 2: 'zero-z', 3: 'home' }[k];
            if (!kind) { out.unsupported.push({ line: n, text: s }); break; }   // a macro swarf does not run (follow-up review #1)
            event(n, kind, 'C' + k);
            if (k === 3) out.warnings.push({ line: n, text: 'C3 homes the machine; the preview cannot place it' });
          } else if (/^(PAUSE|MSG|GOSUB|GOTO|IF|RETURN|ON|INPUT)\b/.test(cmd)) {
            out.unsupported.push({ line: n, text: s });
          } else {
            out.unsupported.push({ line: n, text: s });
          }
        }
      }
    }

    function gcodeLine(U, n) {
      // the whole line must be words swarf knows, each with a number (follow-up review #1:
      // "Xbad" or a stray Q999 were silently dropped)
      const rest = U.replace(/^N\d+\s*/, '').replace(/[GMXYZIJFSTN]\s*[-+]?(\d+\.?\d*|\.\d+)/g, '').trim();
      if (rest) { out.unsupported.push({ line: n, text: U.trim() }); return; }
      const words = {};
      const re = /([A-Z])\s*([-+]?\d*\.?\d+)/g;
      let m, gs = [], ms = [];
      while ((m = re.exec(U))) {
        if (m[1] === 'G') gs.push(Number(m[2]));
        else if (m[1] === 'M') ms.push(Number(m[2]));
        else words[m[1]] = Number(m[2]);
      }
      // an allowlist, not a blacklist (design review 10-28 #2): a G or M code swarf does not
      // carry out exactly (G92 offsets, G18/G19 planes, G41/42 compensation, canned cycles,
      // G93 feed modes …) makes the whole line unreadable, which blocks the run
      // G17 XY plane, G20/21 units, G40/49/80 cancels, G54 the one work offset, G90/91, G94: all
      // what swarf does anyway. M3 router on, M5 off, M6 tool change, M0/M1 pause. Nothing else.
      const G_OK = new Set([0, 1, 2, 3, 17, 20, 21, 40, 49, 54, 80, 90, 91, 94]);
      const M_OK = { 3: 'spindle-on', 5: 'spindle-off', 6: 'tool-change', 0: 'pause', 1: 'pause' };
      if (gs.some(g => !G_OK.has(g)) || ms.some(c => !(c in M_OK) && c !== 2 && c !== 30)) { out.unsupported.push({ line: n, text: U.trim() }); return; }
      for (const c of ms) {
        if (c === 2 || c === 30) { st.ended = true; return; }
        event(n, M_OK[c], c === 0 || c === 1 ? 0 : 'M' + c);
      }
      for (const g of gs) {
        if (g === 20) setUnits('in', n);
        else if (g === 21) setUnits('mm', n);
        else if (g === 90) st.abs = true;
        else if (g === 91) st.abs = false;
        else if (g === 0 || g === 1 || g === 2 || g === 3) st.gmode = g;
      }
      if (words.T !== undefined) event(n, 'tool', words.T);
      if (words.S !== undefined) event(n, 'rpm', words.S);
      if (words.F !== undefined) st.gfeed = words.F * st.scale / 60;
      const has = 'X' in words || 'Y' in words || 'Z' in words;
      if (!has) return;
      const ax = (cur, k) => k in words ? (st.abs ? words[k] * st.scale : cur + words[k] * st.scale) : cur;
      const x = ax(st.x, 'X'), y = ax(st.y, 'Y'), z = ax(st.z, 'Z');
      const rapid = st.gmode === 0;
      const feed = rapid ? st.jogXY : (st.gfeed || st.moveXY);
      if ((st.gmode === 2 || st.gmode === 3) && words.R !== undefined && words.I === undefined && words.J === undefined) {
        out.unsupported.push({ line: n, text: U.trim() }); st.x = x; st.y = y; st.z = z; return;
      }
      if (st.gmode === 2 || st.gmode === 3) {
        const i = (words.I || 0) * st.scale, j = (words.J || 0) * st.scale;
        arc(x, y, z, i, j, st.gmode === 2, feed, false, n);
      } else {
        seg(x, y, z, rapid, feed, n);
      }
    }

    if (!out.units) {
      out.units = machineUnits;
      out.warnings.push({ line: 0, text: `file names no units; read as ${machineUnits}` });
    }
    if (out.units !== machineUnits) {
      out.warnings.unshift({ line: 0, text: `written in ${out.units === 'in' ? 'inches' : 'millimeters'}; this machine is set to ${machineUnits === 'in' ? 'inches' : 'millimeters'}` });
    }
    out.bounds = boundsOf(out.moves);
    return out;
  }

  function boundsOf(moves) {
    if (!moves.length) return null;
    const b = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
    for (const m of moves) {
      for (const [x, y, z] of [[m.x0, m.y0, m.z0], [m.x, m.y, m.z]]) {
        if (x < b.min.x) b.min.x = x; if (y < b.min.y) b.min.y = y; if (z < b.min.z) b.min.z = z;
        if (x > b.max.x) b.max.x = x; if (y > b.max.y) b.max.y = y; if (z > b.max.z) b.max.z = z;
      }
    }
    return b;
  }

  // Bounds of the cutting moves only (what the job occupies on the table).
  function cutBounds(parsed) {
    return boundsOf(parsed.moves.filter(m => !m.rapid));
  }

  // ---- programs Run mode writes for the machine ------------------------
  // Always millimeters, absolute, VCarve's unit guard so ShopBot refuses the
  // file if it is set to inches instead of scaling it 25.4x.
  const f3 = v => (Math.round(v * 1000) / 1000).toString();
  function header(name) {
    return [
      `'${name} - written by swarf Run`,
      "'UNITS:MM",
      'IF %(25)=0 THEN GOTO UNIT_ERROR',
      'SA'
    ];
  }
  function footer() {
    return ['END', "'", 'UNIT_ERROR:', 'CN, 91', 'END'];
  }

  // moves -> SBP, one J3/M3 per segment, MS/JS whenever the speed changes.
  function movesToSbp(moves, o = {}) {
    const dz = o.dz || 0;
    const out = header(o.name || 'program');
    // Lead-in: straight up to safe Z, over at that height, then down. Never a
    // diagonal from wherever the tool happens to be.
    if (moves.length && o.safeZ !== undefined) {
      const m0 = moves[0], top = Math.max(o.safeZ, m0.z0 + dz);
      out.push(`JZ,${f3(top)}`, `J2,${f3(m0.x0)},${f3(m0.y0)}`);
    }
    if (o.spindle) { if (o.rpm) out.push(`TR,${Math.round(o.rpm)}`); out.push('C6', 'PAUSE 2'); }
    let ms = null, js = null, last = null;
    for (const m of moves) {
      if (!last || Math.hypot(last.x - m.x0, last.y - m.y0, last.z - m.z0) > 1e-6) {
        out.push(`J3,${f3(m.x0)},${f3(m.y0)},${f3(m.z0 + dz)}`);
      }
      const sp = Math.round((m.feed || 25) * 100) / 100;
      if (m.rapid) {
        if (js !== sp) { out.push(`JS,${sp},${sp}`); js = sp; }
        out.push(`J3,${f3(m.x)},${f3(m.y)},${f3(m.z + dz)}`);
      } else {
        if (ms !== sp) { out.push(`MS,${sp},${sp}`); ms = sp; }
        out.push(`M3,${f3(m.x)},${f3(m.y)},${f3(m.z + dz)}`);
      }
      last = m;
    }
    if (o.spindle) out.push('C7');
    return out.concat(footer()).join('\r\n');
  }

  // The way into any run from where the bit is (design review 10-28 #1), shared by the real
  // machine and the simulator: up to safe Z (or the first move's own height, if higher), the
  // router may start there, over to the first move's start at that height, slowly down to it.
  // Steps: { move: {x,y,z,kind:'up'|'over'|'down',line} } and one { routerHere: true }.
  // A first move that is a rapid starts from where the reader assumed the bit was, not from
  // anywhere real: the entry goes to that rapid's END instead, and the rapid is skipped.
  function entryMoves(pos, m0, safeZ) {
    const out = [], line = m0.line || 0;
    const t = m0.rapid ? { x: m0.x, y: m0.y, z: m0.z } : { x: m0.x0, y: m0.y0, z: m0.z0 };
    let z = pos.z;
    const up = Math.max(safeZ, t.z);
    if (z < up - 1e-6) { out.push({ move: { x: pos.x, y: pos.y, z: up, kind: 'up', line } }); z = up; }
    out.push({ routerHere: true });
    if (Math.hypot(pos.x - t.x, pos.y - t.y) > 0.01) out.push({ move: { x: t.x, y: t.y, z, kind: 'over', line } });
    if (t.z < z - 1e-6) out.push({ move: { x: t.x, y: t.y, z: t.z, kind: 'down', line } });
    if (m0.rapid) out.skipFirst = true;
    return out;
  }

  // Trace: the cut footprint's rectangle at safe Z, spindle off.
  function traceProgram(parsed, safeZ, name) {
    const b = cutBounds(parsed);
    if (!b) return null;
    const c = [[b.min.x, b.min.y], [b.max.x, b.min.y], [b.max.x, b.max.y], [b.min.x, b.max.y], [b.min.x, b.min.y]];
    const moves = [];
    let p = { x: c[0][0], y: c[0][1], z: safeZ };
    for (let k = 1; k < c.length; k++) {
      const q = { x: c[k][0], y: c[k][1], z: safeZ };
      moves.push({ x0: p.x, y0: p.y, z0: p.z, x: q.x, y: q.y, z: q.z, rapid: false, feed: 50, line: 0 });
      p = q;
    }
    return { name: name + ' (trace)', moves, sbp: movesToSbp(moves, { name: name + ' trace', safeZ }), source: parsed, spindle: false };
  }

  // Air cut: the whole program lifted so its deepest point sits `clear` mm
  // above zero, spindle never started.
  function airProgram(parsed, clear, name, safeZ) {
    const b = boundsOf(parsed.moves);
    if (!b) return null;
    const dz = Math.max(0, clear - b.min.z);
    const moves = parsed.moves.map(m => ({ ...m, z0: m.z0 + dz, z: m.z + dz }));
    return { name: name + ' (air)', moves, dz, sbp: movesToSbp(parsed.moves, { name: name + ' air cut', dz, safeZ }), source: parsed, spindle: false };
  }

  // Run from line: up to safe Z, over to where that line starts, down, then
  // the rest of the program; spindle started if the program had it on there.
  function fromLineProgram(parsed, line, safeZ, name) {
    const rest = parsed.moves.filter(m => m.line >= line);
    if (!rest.length) return null;
    const first = rest[0];
    const on = parsed.events.filter(e => e.line < line && (e.kind === 'spindle-on' || e.kind === 'spindle-off' || (e.kind === 'output' && e.value[0] === 1)))
      .map(e => e.kind === 'output' ? { ...e, kind: e.value[1] === 1 ? 'spindle-on' : 'spindle-off' } : e).pop();
    const rpm = parsed.events.filter(e => e.line < line && e.kind === 'rpm').pop();
    // up to safe Z where the bit is (liftFirst: the machine adds that move from its own
    // position), over at safe Z, then down slowly to where line N starts
    const lead = [
      { x0: first.x0, y0: first.y0, z0: safeZ, x: first.x0, y: first.y0, z: safeZ, rapid: true, line, liftFirst: true },
      { x0: first.x0, y0: first.y0, z0: safeZ, x: first.x0, y: first.y0, z: first.z0, rapid: false, feed: 10, line, lead: true }
    ];
    const moves = lead.concat(rest);
    const sbp = movesToSbp(moves, { name: `${name} from line ${line}`, spindle: on && on.kind === 'spindle-on', rpm: rpm && rpm.value, safeZ });
    // the original file's own events from line N on: the written file numbers its lines
    // afresh, the moves keep the original numbers (review 10-27)
    // the machine as the file left it at that line (the follow-up review: reconstruct the modal
    // state or refuse): every other output's last switch before the line is made again on the way in
    const outs = new Map();
    for (const e of parsed.events) if (e.line < line && e.kind === 'output' && e.value[0] >= 2) outs.set(e.value[0], e);
    const events = [...[...outs.values()].map(e => ({ ...e, line: line - 0.5 })), ...parsed.events.filter(e => e.line >= line)];
    return { name: `${name} (from line ${line})`, moves, sbp, events, source: parsed, spindle: !!(on && on.kind === 'spindle-on') };
  }

  const api = { parse, boundsOf, cutBounds, movesToSbp, traceProgram, airProgram, fromLineProgram, entryMoves };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SwarfRunParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
