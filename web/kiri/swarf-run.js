/**
 * swarf run — Run mode: drive the ShopBot (or the MR-1, over its GRBL board) from swarf.
 *
 * Layout: preview upper left, blank until a program loads; jog
 * upper right, always there, locked while a program runs. Program and its
 * steps lower left; machine status lower right.
 *
 * The student line is fixed and shown as five steps:
 *   load -> check -> zero -> trace -> cut
 * Each step opens only when the one before is done, one sentence under the
 * steps always says what is happening and what to do next, and cut asks for
 * a short checklist every time.
 *
 * Depends on swarf-run-parse.js and swarf-run-machine.js, window.THREE from
 * the kiri bundle, and window.kiri.api for the CAM hand-off.
 */
(function () {
  'use strict';
  // the deploy stamps every machine-control file; connect refuses a page that mixes two builds
  (typeof window !== 'undefined' ? window : globalThis).SWARF_BUILDS = Object.assign((typeof window !== 'undefined' ? window : globalThis).SWARF_BUILDS || {}, { 'swarf-run.js': '__SWARF_BUILD__' });
  if (window.__swarfRunLoaded) return;
  window.__swarfRunLoaded = true;

  const P = window.SwarfRunParse, M = window.SwarfRunMachine;
  const SAFE_Z = 25.4;          // shop machine [VC] safe Z
  const AIR_CLEAR = 5;          // air cut: deepest point this far above zero
  const STEPS = ['load', 'check', 'zero', 'trace', 'cut'];
  const STEP_SAYS = {
    load: 'Load: the toolpaths from cam (press control with a part and a step on the bed), or a file from other software.',
    check: 'Check: swarf reads the file: millimeters, small enough for the machine, every line it can run. Where it lands on the table is checked once X Y is zeroed and the table corner is known.',
    zero: 'Zero: jog the bit to your board\'s X 0, Y 0 and press zero x y; then zero z, or use the z plate.',
    get trace() { return `Trace: the bit runs the rectangle the cut fills, ${up()} up, ${spindleWord()} off. An air cut runs the whole file above the board. Both need a program and the zero.`; },
    get cut() { return `Cut: a short checklist, then the ${spindleWord()} starts. A trace first is your choice.`; }
  };
  const CHANGE_Z = 50;          // a tool change lifts this far over the work, room for a wrench
  const Z_JOG_MAX = 1000;       // mm/min: Z jogs never faster, whatever the speed row says
  // The bit and spindle speed the file asks for, in the student's words.
  function fileTools() {
    const ev = S.prog ? S.prog.parsed.events : [];
    const names = [...new Set(ev.filter(e => e.kind === 'tool-name').map(e => e.value))];
    const rpm = [...new Set(ev.filter(e => e.kind === 'rpm').map(e => e.value).filter(v => v > 0))];
    return { names, rpm };
  }
  // The shop router is a Porter-Cable 7518 with its own five-step dial.
  // Its five settings, from Porter-Cable's listings for the 7518; its selector is marked in rpm.
  const DIAL = [[1, 10000], [2, 13000], [3, 16000], [4, 19000], [5, 21000]];
  function dialFor(rpm) {
    const d = DIAL.reduce((a, b) => Math.abs(b[1] - rpm) < Math.abs(a[1] - rpm) ? b : a);
    // a speed past the dial's ends says so plainly, never as two numbers that disagree
    if (rpm < DIAL[0][1]) return `setting 1, its slowest (${DIAL[0][1].toLocaleString()} rpm; the file asked ${rpm.toLocaleString()})`;
    if (rpm > DIAL[4][1]) return `setting 5, its fastest (${DIAL[4][1].toLocaleString()} rpm; the file asked ${rpm.toLocaleString()})`;
    return `setting ${d[0]} (${d[1].toLocaleString()} rpm${d[1] !== rpm ? `; the file asked ${rpm.toLocaleString()}` : ''})`;
  }
  // line: a continue from that line names the bit and speed in effect there, not the file's first
  // an inch file: the student confirms its size in both units before it moves
  function inchItem() {
    const p = S.prog && S.prog.parsed;
    if (!p || p.units !== 'in') return null;
    const b = P.cutBounds(p);
    if (!b) return null;
    const w = b.max.x - b.min.x, d = b.max.y - b.min.y, z = -b.min.z;
    const i = v => +(v / 25.4).toFixed(3);
    return `this file is in inches: its cut is ${i(w)} × ${i(d)} in (${w.toFixed(1)} × ${d.toFixed(1)} mm), ${i(z)} in (${z.toFixed(1)} mm) deep, and that is your part`;
  }
  // the bit the file names, as it writes it: at a continue's line, the one in effect there
  function bitNamed(line) {
    const ev = S.prog ? S.prog.parsed.events : [];
    const at = line ? ev.filter(e => e.kind === 'tool-name' && e.line < line).pop() : null;
    return (at || {}).value || fileTools().names[0];
  }
  function checklist(line) {
    const t = fileTools(), o = originText();
    const ev = S.prog ? S.prog.parsed.events : [];
    // the speed in force at the line, S0 included (a stopped spindle is named, not an earlier speed)
    const at = k => line ? ev.filter(e => e.kind === k && e.line < line && (k !== 'rpm' || e.value >= 0)).pop() : null;
    const bit = bitNamed(line), rpm = at('rpm') ? at('rpm').value : t.rpm[0];
    return [
      'your board is flat and held down; the bit clears every screw and clamp',
      inchItem(),
      bit ? `the bit in the ${spindleWord()} is the ${bit} this file ${line ? `uses at line ${line}` : 'was made for'}` : `the bit in the ${spindleWord()} is the one this file was made for`,
      rpm === 0 && isMR1() ? 'the spindle speed at this line is 0 (S0): it does not turn' : rpm ? (isMR1() ? `the spindle will run at ${rpm.toLocaleString()} rpm: swarf sets it from the file` : `the router dial is on ${dialFor(rpm)}: swarf only turns it on and off`) : null,
      S.plateUsed ? 'the Z plate and its clip are put away' : null,
      /^the /.test(o.z) ? `Z zero is on ${o.z}` : `Z zero is ${o.z}`,
      isMR1() ? 'safety glasses on' : 'safety glasses on, dust collection on',
      'the laptop is plugged in and stays open',
      'I stay at the machine until it ends'
    ].filter(Boolean);
  }

  // ------------------------------------------------------------ state
  const S = {
    open: false, machine: null, unsub: null,
    prog: null,          // { name, text, parsed, source }
    zeroXY: false, zeroZ: false, traced: false,
    job: null,           // what is running: 'trace' | 'air' | 'cut' | 'from' | 'preview'
    lastRunning: false, jogStep: 'cont', jogSpeed: 2500, contHeld: null, simRate: 10   // hold to move at 2500 mm/min: above the X axis's rough band (about 16-30 mm/s steady, see docs/shopbot-motion.md)
  };  // a zero from before a reload: offered back once connected, if the card's count has not jumped
  try { const z = JSON.parse(localStorage.getItem('swarf-run-zero')); if (z && z.had && z.at && z.steps && zeroFresh(z.at)) { S.zeroHad = z.had; S.zeroSetAt = z.at; S.lastSteps = z.steps; S.zeroAt = z.where; S.zBit = z.bit || undefined; } } catch (e) { /* none */ }

  const el = {};
  // the playhead's preview: how fast ▶ plays (× the program's own speed), and its clock
  const PV_RATES = [10, 50, 200];
  const PV = { rate: 50, raf: 0, t: 0, last: 0, cum: null };

  // ------------------------------------------------------------ style
  // swarf's index.css makes every div a flex row and restyles every button, so
  // each rule below is scoped under #swarf-run (see scoped()) to outrank those.
  const CSS = `
#swarf-run div { display: block; }
#swarf-run button { display: inline-flex; align-items: center; justify-content: center; text-transform: none; letter-spacing: normal;
  font-size: inherit; margin: 0; white-space: normal; transition: border-color .12s, background .12s; color: var(--swarf-text, #d8d2c6); }
#swarf-run button:hover, #swarf-run button:active { background: var(--swarf-bg-3, #1c1817); color: var(--swarf-text, #d8d2c6); }
#swarf-run { position: fixed; inset: 0; z-index: 60; display: none; flex-direction: column;
  background: var(--swarf-bg, #0a0808); color: var(--swarf-text, #d8d2c6);
  font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 13px; }
#swarf-run.open { display: flex; }
#swarf-run button { font: inherit; color: inherit; cursor: pointer; }
#swarf-run button:disabled { cursor: not-allowed; opacity: .32; }
.sr-head { display: flex; align-items: center; gap: 14px; padding: 10px 16px; border-bottom: 1px solid var(--swarf-line, #2a1612); }
.sr-back { background: none; border: 1px solid var(--swarf-line-2, #3a1e18); border-radius: 999px; padding: 5px 12px; }
.sr-back:hover { border-color: var(--swarf-accent, #d02020); }
.sr-title { letter-spacing: 0.02em; color: var(--swarf-text-2, #8a857c); }
.sr-title b { color: var(--swarf-text, #d8d2c6); font-weight: 600; }
.sr-conn { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.sr-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--swarf-text-3, #58534a); }
.sr-conn.live .sr-dot { background: #3fbf6a; box-shadow: 0 0 8px #3fbf6a88; }
.sr-conn.sim .sr-dot { background: var(--swarf-amber, #c08a3a); }
.sr-conn button { background: none; border: 1px solid var(--swarf-line-2, #3a1e18); border-radius: 999px; padding: 4px 10px; }
.sr-steps { display: flex; gap: 6px; padding: 10px 16px 0; }
.sr-step { flex: 1; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px;
  background: var(--swarf-bg-2, #13100f); border: 1px solid var(--swarf-line, #2a1612); color: var(--swarf-text-3, #58534a); }
.sr-step .n { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-size: 11px;
  border: 1px solid currentColor; flex: none; }
.sr-step.done { color: var(--swarf-text-2, #8a857c); }
.sr-step.done .n { background: var(--swarf-text-2, #8a857c); color: var(--swarf-bg, #0a0808); border-color: transparent; }
.sr-step.now { color: var(--swarf-text, #d8d2c6); border-color: var(--swarf-accent, #d02020); box-shadow: 0 0 14px var(--swarf-glow, rgba(224,40,30,.32)); }
.sr-step.now .n { background: var(--swarf-accent, #d02020); color: #fff; border-color: transparent; }
.sr-step.blocked { color: var(--swarf-amber, #c08a3a); border-color: var(--swarf-amber, #c08a3a); }
.sr-say { padding: 10px 16px 10px; font-size: 20px; line-height: 1.35; min-height: 28px; }
.sr-strip { height: 2px; margin: 0 16px 10px; background: transparent; }
.sr-strip.on { background: linear-gradient(90deg, transparent 0%, var(--swarf-accent, #d02020) 50%, transparent 100%) no-repeat; background-size: 50% 100%; animation: srbusy 1.1s linear infinite; }
@keyframes srbusy { from { background-position: -100% 0; } to { background-position: 200% 0; } }
.sr-say.warn { color: var(--swarf-amber, #c08a3a); }
.sr-say.bad { color: var(--swarf-accent-hi, #ff3a2a); }
.sr-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 10px; padding: 0 16px 16px; }
.sr-col { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.sr-col > .sr-view { flex: 62 1 0; }
.sr-col > .sr-prog { flex: 38 1 0; }
.sr-col > .sr-jog { flex: 1 1 auto; }
.sr-col > .sr-mach { flex: none; }
.sr-box { background: var(--swarf-bg-2, #13100f); border: 1px solid var(--swarf-line, #2a1612); border-radius: 12px; min-height: 0; position: relative; overflow: hidden; }
.sr-box h3 { margin: 0; font-size: 11px; font-weight: 500; letter-spacing: 0.02em; color: var(--swarf-text-3, #58534a); padding: 10px 12px 6px; text-transform: none; }
.sr-view canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.sr-empty { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; color: var(--swarf-text-3, #58534a); pointer-events: none; line-height: 1.7; }
.sr-empty b { color: var(--swarf-text-2, #8a857c); font-weight: 500; }
.sr-view.drag { outline: 2px dashed var(--swarf-accent, #d02020); outline-offset: -8px; }
.sr-vtools { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; }
.sr-vtools button, .sr-chip { background: var(--swarf-bg-3, #1c1817); border: 1px solid var(--swarf-line-2, #3a1e18); border-radius: 999px; padding: 4px 10px; }
.sr-vtools button:hover { border-color: var(--swarf-accent, #d02020); }
.sr-facts { position: absolute; left: 10px; bottom: 34px; color: var(--swarf-text-2, #8a857c); font-size: 12px; pointer-events: none; }
.sr-scrub { position: absolute; left: 10px; right: 10px; bottom: 8px; display: flex; gap: 10px; align-items: center; color: var(--swarf-text-3, #58534a); font-size: 11px; }
.sr-scrub input { flex: 1; accent-color: var(--swarf-accent, #d02020); }
.sr-scrub .sr-play, .sr-scrub .sr-rate { min-width: 34px; height: 26px; padding: 0 8px; border-radius: 6px; border: 1px solid #4f4642; background: #2a2523; font-size: 12px; cursor: pointer; }
.sr-scrub .sr-play.on { border-color: #a39a90; }
.sr-jog { padding-bottom: 10px; overflow-y: auto; transition: opacity .2s; }
.sr-jog.locked > :not(.sr-lock):not(.sr-dro):not(.sr-jh):not(.sr-pin) { opacity: .85; pointer-events: none; }   /* readable while locked; the lock line says why */
.sr-jog.locked .sr-dro { pointer-events: none; }
.sr-jog.offline > :not(.sr-lock):not(.sr-jh):not(.sr-pin) { opacity: .4; pointer-events: none; filter: grayscale(1); }   /* not connected: nothing here can reach the machine */
.sr-keyrow { display: flex; align-items: center; gap: 10px; margin: 8px 12px 0; }
#swarf-run .sr-ovr { display: flex; align-items: center; gap: 8px; margin: 6px 0 2px; }
#swarf-run .sr-ovr .lbl { font-size: 12px; }
#swarf-run .sr-ovr b { min-width: 48px; text-align: center; font-variant-numeric: tabular-nums; }
#swarf-run .sr-ovr button { padding: 4px 12px; }
#swarf-run .sr-airspeed { padding: 0 12px; }
#swarf-run .sr-airspeed input { flex: 1; min-width: 120px; accent-color: var(--swarf-accent, #d02020); }
#swarf-run .sr-bedmap { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; pointer-events: auto; }
#swarf-run .sr-bedmap svg { width: 64px; height: auto; display: block; }
#swarf-run .sr-bedmap rect { fill: none; stroke: currentColor; stroke-width: 1.6; opacity: .75; }
#swarf-run .sr-bedmap circle { fill: currentColor; }
#swarf-run .sr-bedmap path { fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; opacity: .8; }
#swarf-run .sr-bedmap text { font: 600 8px system-ui, sans-serif; fill: currentColor; }
#swarf-run .sr-bedmap small { font-size: 11px; line-height: 1; }
.sr-keyrow .sr-keys { flex: 1; }
#swarf-run .sr-keyrow button.sr-router { flex: none; min-width: 0; padding: 3px 10px; border-radius: 999px; font-size: 11px; line-height: 1.1; display: flex; flex-direction: column; align-items: center; }
#swarf-run .sr-keyrow button.sr-router b { font-size: 12px; }
#swarf-run .sr-keyrow button.sr-router small { font-size: 11px; }
.sr-lock { display: none; position: static; margin: 2px 14px 0; text-align: right; color: var(--swarf-text-2, #8a857c); font-size: 11px; }
.sr-jog.locked .sr-lock { display: block; }
.sr-dro { margin: 0 12px; display: grid; gap: 4px; }
.sr-axis { display: grid; grid-template-columns: 28px 1fr 64px; align-items: center; background: var(--swarf-bg, #0a0808);
  border: 1px solid var(--swarf-line, #2a1612); border-radius: 8px; padding: 2px 2px 2px 10px; }
.sr-axis .a { color: var(--swarf-text-2, #8a857c); }
.sr-axis .v { font-size: 22px; text-align: right; padding-right: 12px; font-variant-numeric: tabular-nums; }
.sr-axis button, .sr-zrow button { background: var(--swarf-bg-3, #1c1817); border: 1px solid var(--swarf-line-2, #3a1e18); border-radius: 6px; padding: 6px 0; }
.sr-axis button:hover, .sr-zrow button:hover { border-color: var(--swarf-accent, #d02020); }
.sr-zrow { margin: 6px 12px 0; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 6px; }
.sr-zrow .keep { color: var(--swarf-text-2, #8a857c); }
.sr-modes { margin: 10px 12px 0; display: flex; gap: 4px; align-items: center; }
.sr-modes span { flex: 0 0 74px; }
.sr-modes input { width: 58px; background: var(--swarf-bg, #0a0808); border: 1px solid var(--swarf-line-2, #3a1e18); border-radius: 6px; padding: 6px 4px; color: inherit; font: inherit; }
.sr-modes input.on { border-color: var(--swarf-accent, #d02020); }
.sr-keys { margin: 8px 12px 0; text-align: center; font-size: 11px; color: var(--swarf-text-3, #58534a); }
.sr-mpos { margin: 4px 12px 0; font-size: 11px; color: var(--swarf-text-3, #58534a); font-variant-numeric: tabular-nums; }
.sr-axis .v { cursor: text; }
.sr-axis input.v { width: 100%; box-sizing: border-box; background: transparent; border: 0; color: inherit; font: inherit; font-size: 22px; text-align: right; padding-right: 12px; }
.sr-modes span { color: var(--swarf-text-3, #58534a); font-size: 11px; margin-right: 6px; }
.sr-modes button { flex: 1; background: var(--swarf-bg, #0a0808); border: 1px solid var(--swarf-line-2, #3a1e18); border-radius: 6px; padding: 6px 0; }
.sr-modes button.on { background: var(--swarf-accent, #d02020); border-color: var(--swarf-accent, #d02020); color: #fff; }
.sr-pad { margin: 10px 12px 0; display: grid; grid-template-columns: repeat(3, 54px) 18px 54px; grid-template-rows: repeat(3, 54px); gap: 6px; justify-content: center; }
.sr-pad button { background: var(--swarf-bg-3, #1c1817); border: 1px solid var(--swarf-line-2, #3a1e18); border-radius: 10px; font-size: 14px; font-weight: 600; user-select: none; touch-action: none; }
.sr-pad button:hover { border-color: var(--swarf-accent, #d02020); }
.sr-pad button:active, .sr-pad button.held { background: var(--swarf-accent, #d02020); color: #fff; }
.sr-goto { margin: 10px 12px 0; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
.sr-goto button { background: var(--swarf-bg, #0a0808); border: 1px solid var(--swarf-line-2, #3a1e18); border-radius: 6px; padding: 8px 0; }
.sr-prog { display: flex; flex-direction: column; }
.sr-file { display: flex; gap: 6px; align-items: center; padding: 0 12px; }
.sr-file .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--swarf-text-2, #8a857c); }
.sr-file button { background: var(--swarf-bg-3, #1c1817); border: 1px solid var(--swarf-line-2, #3a1e18); border-radius: 999px; padding: 6px 12px; }
.sr-actions { display: grid; grid-template-columns: 1fr 1fr 1.4fr 1fr 1fr; gap: 8px; padding: 10px 12px 0; }
.sr-actions button { border-radius: 10px; padding: 11px 0; /* 40 px: one-word labels */ font-size: 14px; font-weight: 600; letter-spacing: .06em;
  background: var(--swarf-bg-3, #1c1817); border: 1px solid var(--swarf-line-2, #3a1e18); }
.sr-actions .cut { background: var(--swarf-accent, #d02020); border-color: var(--swarf-accent, #d02020); color: #fff; }
.sr-actions .cut:not(:disabled):hover { background: var(--swarf-accent-hi, #ff3a2a); box-shadow: 0 0 18px var(--swarf-glow, rgba(224,40,30,.32)); }
.sr-actions .stop { background: #3a0c0a; border-color: var(--swarf-accent-hi, #ff3a2a); color: #fff; padding: 14px 0; /* stop keeps its full height */ }
.sr-actions .trace.next, .sr-actions .air.next { border-color: var(--swarf-accent, #d02020); box-shadow: 0 0 12px var(--swarf-glow, rgba(224,40,30,.32)); }
.sr-plan { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px; color: var(--swarf-text-2, #8a857c); font-size: 12px; line-height: 1.6; }
.sr-plan .w { color: var(--swarf-amber, #c08a3a); }
.sr-plan .b { color: var(--swarf-accent-hi, #ff3a2a); }
.sr-plan .sr-kept button { margin: 2px 6px 2px 0; padding: 1px 8px; font-size: 11px; }
.sr-from { display: flex; gap: 6px; align-items: center; padding: 6px 12px 0; color: var(--swarf-text-3, #58534a); font-size: 12px; }
.sr-from input { width: 80px; background: var(--swarf-bg, #0a0808); color: inherit; border: 1px solid var(--swarf-line-2, #3a1e18); border-radius: 6px; padding: 4px 6px; font: inherit; }
.sr-from button { background: none; border: 1px solid var(--swarf-line-2, #3a1e18); border-radius: 999px; padding: 3px 10px; }
.sr-stat { padding: 0 12px 12px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
.sr-big { font-size: 22px; letter-spacing: .04em; }
.sr-row { display: flex; justify-content: space-between; color: var(--swarf-text-2, #8a857c); }
.sr-ask { border: 1px solid var(--swarf-amber, #c08a3a); border-radius: 10px; padding: 10px; display: none; }
.sr-ask.on { display: block; }
.sr-ask p { margin: 0 0 8px; line-height: 1.45; }
.sr-ask button { margin-right: 6px; background: var(--swarf-bg-3, #1c1817); border: 1px solid var(--swarf-line-2, #3a1e18); border-radius: 999px; padding: 6px 12px; }
.sr-note { color: var(--swarf-text-3, #58534a); font-size: 12px; line-height: 1.5; }
.sr-sim { display: flex; gap: 4px; align-items: center; color: var(--swarf-text-3, #58534a); font-size: 12px; }
.sr-sim button { background: none; border: 1px solid var(--swarf-line-2, #3a1e18); border-radius: 999px; padding: 2px 8px; }
.sr-sim button.on { border-color: var(--swarf-amber, #c08a3a); color: var(--swarf-amber, #c08a3a); }
.sr-sheet { position: absolute; inset: 0; background: rgba(0,0,0,.6); display: none; place-items: center; z-index: 5; }
.sr-sheet.on { display: grid; }
.sr-card { width: min(520px, 92vw); background: var(--swarf-bg-2, #13100f); border: 1px solid var(--swarf-accent, #d02020); border-radius: 14px; padding: 18px 20px; box-sizing: border-box; max-height: calc(100% - 24px); overflow-y: auto; overscroll-behavior: contain; scroll-padding-bottom: 60px; }
/* a card taller than the window scrolls; its last row of buttons stays in view at the bottom */
/* sticky insets count from inside the card's padding: a card ending in its button row drops its bottom padding, so the row sits on the card's edge with nothing showing under it */
.sr-card:has(> .row:last-child) { padding-bottom: 0; }
.sr-card > .row:last-child { position: sticky; bottom: 0; z-index: 1; margin: 10px -20px 0; padding: 8px 20px 12px; background: var(--swarf-bg-2, #13100f); }
.sr-card.swarf-more > .row:last-child { box-shadow: 0 -10px 12px -6px rgba(0,0,0,.35); }
.sr-card.swarf-more > .row:last-child::before { content: 'scroll: more below \\25BE'; margin-right: auto; align-self: center; font-size: 12px; color: var(--swarf-warn, #d9a441); white-space: nowrap; }
.sr-card .sr-mach { font-size: 12px; margin: 0 0 2px; color: var(--swarf-text-2, #8a857c); }
.sr-card:focus { outline: none; }
.sr-card h2 { margin: 0 0 6px; font-size: 18px; }
.sr-card p.sr-sum { margin: 0 0 10px; overflow-wrap: anywhere; }
.sr-card p { margin: 0 0 12px; color: var(--swarf-text-2, #8a857c); line-height: 1.5; }
.sr-card label { display: flex; gap: 10px; align-items: flex-start; padding: 7px 0; cursor: pointer; line-height: 1.4; }
.sr-card input { accent-color: var(--swarf-accent, #d02020); width: 18px; height: 18px; margin: 0; flex: none; }
.sr-card .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
.sr-card .row button { border-radius: 10px; padding: 7px 14px; background: var(--swarf-bg-3, #1c1817); border: 1px solid var(--swarf-line-2, #3a1e18); }
.sr-card .row .go { background: var(--swarf-accent, #d02020); border-color: var(--swarf-accent, #d02020); color: #fff; font-weight: 600; }
.sr-card .row .go:disabled { opacity: .4; cursor: default; }
.sr-plate .sr-plate-t { display: flex; align-items: center; gap: 8px; margin: 4px 0 10px; color: var(--swarf-text-2, #8a857c); font-size: 13px; }
.sr-plate .sr-plate-t input { width: 84px; height: auto; text-align: right; padding: 5px 8px; border-radius: 6px; border: 1px solid #4f4642; background: #322c29; color: #fff; font: inherit; accent-color: auto; }
.sr-card label span { flex: 1; min-width: 0; white-space: normal; overflow-wrap: anywhere; }
.sr-plate .sr-circuit { margin: 2px 0 4px 28px; color: var(--swarf-text-2, #8a857c); font-size: 13px; }
.sr-plate .sr-circuit.ok { color: var(--swarf-text, #d8d2c6); }
.sr-card .sr-why { margin: 8px 0 0; color: var(--swarf-warn, #d9a441); font-size: 13px; line-height: 1.35; }
.sr-plate > button { margin: 0 0 6px 28px; border-radius: 8px; padding: 6px 10px; background: var(--swarf-bg-3, #1c1817); border: 1px solid #4f4642; }
.sr-zrow button.next { border-color: #f2ede4; color: #fff; }
.sr-chk { display: grid; grid-template-columns: 28px auto 1fr auto auto; gap: 8px; align-items: center; padding: 5px 0; }
.sr-chk b { font-size: 15px; }
.sr-chk span { color: var(--swarf-text-2, #8a857c); font-size: 12px; }
.sr-chk button, .sr-card .sr-out { border-radius: 8px; padding: 6px 10px; background: var(--swarf-bg-3, #1c1817); border: 1px solid var(--swarf-line-2, #3a1e18); }
.sr-pair { display: flex; gap: 8px; margin: 4px 0; }
.sr-pair button { border-radius: 8px; padding: 6px 10px; background: var(--swarf-bg-3, #1c1817); border: 1px solid var(--swarf-line-2, #3a1e18); }
.sr-chk button.ok { border-color: #2f9e5a; color: #6fd39a; }
.sr-card h3 { margin: 14px 0 4px; font-size: 12px; letter-spacing: 0.02em; text-transform: none; color: var(--swarf-text-2, #8a857c); }
.sr-dots { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0 8px; }
.sr-dots i { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font: 600 11px "IBM Plex Mono", ui-monospace, monospace; font-style: normal; border: 1px solid var(--swarf-line-2, #3a1e18); color: var(--swarf-text-2, #8a857c); }
.sr-dots i.on { background: var(--swarf-accent, #d02020); border-color: var(--swarf-accent, #d02020); color: #fff; }
.sr-mr1chk { margin: 4px 0 8px; }
.sr-mr1raw { max-height: 180px; overflow: auto; font-size: 11px; white-space: pre-wrap; margin: 4px 0; }
.sr-card .sr-out.armed { border-color: var(--swarf-accent, #d02020); color: #fff; }
body.swarf-run-open { filter: none !important; }
.sr-pad button { flex-direction: column; gap: 1px; line-height: 1.05; }
.sr-pad button b { font-size: 15px; }
.sr-pad button small { font-size: 11px; font-weight: 500; letter-spacing: .04em; color: #d8d2c6; text-transform: none; }
.sr-jog .sr-pad { grid-template-columns: repeat(3, 56px) 14px 56px; grid-template-rows: repeat(3, 44px); gap: 5px; margin-top: 8px; }
.sr-jog .sr-axis .v, .sr-jog .sr-axis input.v { font-size: 23px; }
.sr-jog .sr-dro { gap: 3px; }
.sr-jog .sr-modes { margin-top: 6px; }
.sr-jog h3 { margin-bottom: 6px; }
.sr-jog .sr-goto { grid-template-columns: 1fr 1fr 1fr; margin-top: 6px; }
.sr-mach .sr-note { font-size: 11px; }
.sr-jog .sr-modes button.on { background: rgb(31,48,66) !important; border-color: #8fb0d0 !important; }
.sr-modes button.held { flex: 1.6; }
.sr-goto .stop { background: #5a0e0a !important; border-color: var(--swarf-accent-hi, #ff3a2a) !important; font-weight: 700; }
.sr-keepzero { margin: 6px 12px 0; width: calc(100% - 24px); background: rgb(31,48,66); border: 1px solid #6f8fb0; color: #fff; border-radius: 3px; padding: 6px 0; }
.sr-plan .ok { color: #8fd3a8; }
.sr-card details { margin: 10px 0; color: var(--swarf-text, #d8d2c6); }
.sr-card summary { cursor: pointer; color: var(--swarf-text-2, #8a857c); text-transform: none; letter-spacing: 0.02em; font-size: 12px; }
.sr-stat .sr-hold.arming { background: var(--swarf-accent, #d02020) !important; transition: background 1.5s linear; }
/* ---- inside swarf: no header row; steps + sentence share a line ---- */
.sr-top { display: flex; align-items: center; gap: 14px; padding: 0 16px 6px; }
.sr-target { margin-left: auto; flex: none; padding: 4px 12px; border-radius: 999px; font-size: 13px; border: 1px solid var(--swarf-line, #2a1612); white-space: nowrap; }
.sr-target.sim { color: #8fb0d0; border-color: #4f6f8f; }
.sr-target.live { color: #8fd3a8; border-color: #4f8f68; }
.sr-target.off { color: var(--swarf-text-2, #8a857c); }
.sr-target:empty { display: none; }
.sr-pin { position: sticky; top: 0; z-index: 2; background: var(--swarf-bg-2, #13100f); }
.sr-next { padding: 0 12px 6px; font-size: 12px; color: var(--swarf-amber, #c08a3a); }
.sr-top .sr-steps { flex: none; padding: 0; gap: 4px; }
.sr-top .sr-step { flex: none; padding: 5px 9px; font-size: 11px; gap: 6px; }
.sr-top .sr-step .n { width: 18px; height: 18px; font-size: 11px; }
.sr-top .sr-say { flex: 1; padding: 0; min-height: 2.7em; font-size: 14px; line-height: 1.35; }  /* two lines kept: a long sentence never moves the page */
.sr-jog h3.sr-jh { display: flex; align-items: center; gap: 10px; }
.sr-jh .sr-conn { margin-left: auto; text-transform: none; letter-spacing: .02em; font-weight: 400; font-size: 12px; }
.sr-jh .sr-conn button { padding: 2px 10px; font-size: 12px; }
.sr-vtools button.on { background: rgb(31,48,66) !important; border-color: #8fb0d0 !important; }
.sr-veil { position: absolute; inset: 0; z-index: 9; display: none; place-items: center; background: rgba(20,18,17,.72); backdrop-filter: grayscale(1) blur(1px); }
.sr-veil.on { display: grid; }
#swarf-run.sr-veiled .sr-actions { visibility: hidden !important; }   /* a direct rule: scoped() would make it a descendant rule that never matches */
.sr-veilcard { width: min(520px, 92vw); background: #13100f; border: 1px solid var(--swarf-amber, #c08a3a); border-left: 3px solid var(--swarf-amber, #c08a3a); padding: 20px 22px; }
.sr-veilcard h2 { margin: 0 0 8px; font-size: 24px; color: #fff; }
.sr-veilcard p { margin: 0 0 16px; line-height: 1.5; color: var(--swarf-text, #d8d2c6); }
.sr-veilcard .row { display: flex; gap: 10px; justify-content: flex-end; }
.sr-veilcard button { padding: 12px 18px; border-radius: 3px; background: #3a3532; border: 1px solid #5e5550; color: #fff; font-size: 14px; text-transform: none; letter-spacing: 0.02em; }
.sr-veilcard .go { background: var(--swarf-accent, #d02020); border-color: var(--swarf-accent-hi, #ff3a2a); }
.sr-other { display: inline-block; margin: 6px 12px 0; font-size: 12px; color: var(--swarf-text-2, #8a857c); text-decoration: underline; }
.sr-other:hover { color: var(--swarf-text, #d8d2c6); }
/* ---- jog panel ---- */
.sr-col > .sr-jog { flex: none; padding-bottom: 12px; }
.sr-col > .sr-mach { flex: 1 1 auto; }
/* on a short screen (1280×720, 1366×768) the right column scrolls:
   the simulated speed pills and the sounds chip stay reachable, never under the window's edge */
.sr-grid > .sr-col:last-child { overflow-y: auto; overscroll-behavior: contain; }
/* an opaque band across the foot, faded at its top, as the rail's: never see-through words over words */
.sr-col.swarf-more::after, .sr-plan.swarf-more::after {
  content: 'more below \\25BE'; text-transform: none; position: sticky; bottom: 0; display: block; flex-shrink: 0; align-self: stretch;
  box-sizing: border-box; height: 30px; margin-top: -30px; padding: 12px 0 0; text-align: center; pointer-events: none; z-index: 3;
  font-size: 11px; line-height: 16px; color: var(--swarf-text-2);
  background: linear-gradient(to bottom, transparent, var(--swarf-more-bg, var(--swarf-bg-2)) 12px);
}
.sr-plan.swarf-more::after { bottom: -10px; margin: -30px -12px 0; }
.sr-grid > .sr-col:last-child > .sr-box { flex-shrink: 0; }
.sr-jog .sr-dro { margin: 0 12px; gap: 4px; }
.sr-jog .sr-axis { grid-template-columns: 30px 1fr; padding: 4px 14px 4px 12px; }
.sr-jog .sr-axis .v, .sr-jog .sr-axis input.v { padding-right: 0; }
.sr-jog .sr-mpos { margin: 5px 12px 0; }
.sr-jog .sr-zrow { display: flex; gap: 6px; margin: 8px 12px 0; }
.sr-jog .sr-zrow > button { flex: 1; padding: 7px 0; }
.sr-jog .sr-modes { display: grid; grid-template-columns: 70px repeat(6, 1fr); gap: 5px; margin: 8px 12px 0; align-items: center; }
.sr-jog .sr-modes.sr-steprow { grid-template-columns: 62px repeat(4, 1fr) 1.2fr 2.4fr; }
.sr-jog .sr-modes { grid-template-columns: 62px repeat(6, 1fr) !important; }
.sr-jog .sr-modes.sr-steprow { grid-template-columns: 62px repeat(4, 1fr) 1.2fr 2.4fr !important; }
.sr-jog .sr-modes input { background: #2a2623 !important; border: 1px solid #5e5550 !important; color: #fff !important; }
.sr-jog .sr-modes input::placeholder { color: #a89f97; }
.sr-jog .sr-modes button { font-size: 12px; letter-spacing: .02em; }
.sr-mach .sr-row.note { display: block; color: var(--swarf-text-2, #8a857c); font-size: 12px; }
#swarf-run.open { bottom: 0; }
.sr-grid { padding-bottom: 34px !important; }
.sr-jog .sr-modes .lbl { display: flex; flex-direction: column; line-height: 1.15; }
.sr-jog .sr-modes .lbl small { color: var(--swarf-text-2, #8a857c); font-size: 11px; font-weight: 400; letter-spacing: .04em; text-transform: none; }
.sr-jog .sr-modes button, .sr-jog .sr-modes input { width: 100%; min-width: 0; height: 32px; padding: 0; box-sizing: border-box; text-align: center; font-size: 13px; flex: none; }
.sr-jog .sr-modes button.held { flex: none; }
.sr-jog .sr-pad { display: grid; grid-template-columns: repeat(3, 60px) 22px 60px; grid-template-rows: repeat(3, 50px); gap: 6px; justify-content: center; margin: 12px 12px 0; }
.sr-jog .sr-pad button small { font-size: 11px; letter-spacing: .04em; }
.sr-jog .sr-keys { margin: 8px 12px 0; white-space: normal; font-size: 11px; }
.sr-jog .sr-keyrow .sr-keys { margin: 0; }
.sr-faultbar { display: flex; align-items: center; gap: 10px; margin: 6px 0 8px; padding: 8px 10px; border-radius: 8px; background: #b3261e; color: #fff; font-size: 13px; font-weight: 600; }
.sr-faultbar .sr-faulttext { flex: 1; }
.sr-faultbar button { flex: none; font-size: 13px; padding: 6px 14px; }   /* never cut a safety line short */
.sr-jog .sr-goto { display: flex; gap: 6px; margin: 10px 12px 0; }
.sr-jog .sr-goto > button { flex: 1 1 0; min-width: 0; padding: 8px 6px; line-height: 1.15; }
@media (max-width: 900px) { .sr-grid { grid-template-columns: 1fr; overflow-y: auto; } .sr-col > .sr-view { flex: none; height: 360px; } }
/* ---- swarf skin ----
   swarf's own panel language: the scene glows through, plates with a red edge
   stripe and a slate header bar, bone text, red section labels, lighter controls. */
#swarf-run { background: rgba(10,8,8,.62); backdrop-filter: blur(2px) saturate(1.1); font-size: 14px; }
.sr-head { background: #13100f; border-bottom: 1px solid var(--swarf-line-2, #3a1e18); padding: 8px 16px; }
.sr-title { color: var(--swarf-text, #d8d2c6); text-transform: none; letter-spacing: 0.02em; font-size: 12px; }
.sr-title b { color: var(--swarf-accent-hi, #ff3a2a); }
.sr-back, .sr-conn button { background: #555; border: 1px solid #777; color: #fff; border-radius: 3px; }
.sr-back:hover, .sr-conn button:hover { background: #666 !important; border-color: #999; color: #fff !important; }
.sr-step { background: rgba(19,16,15,.92); border: 1px solid var(--swarf-line-2, #3a1e18); border-radius: 0; color: var(--swarf-text-2, #8a857c);
  text-transform: none; letter-spacing: 0.02em; font-size: 12px; }
.sr-step.done { color: var(--swarf-text, #d8d2c6); }
.sr-say { color: #fff; text-shadow: 0 1px 2px #000; }
.sr-box { background: linear-gradient(180deg, rgba(42,16,14,.22), rgba(0,0,0,0) 60%), rgba(19,16,15,.94);
  border: 1px solid var(--swarf-line-2, #3a1e18); border-left: 3px solid var(--swarf-accent, #d02020); border-radius: 0;
  clip-path: polygon(10px 0, 100% 0, 100% 100%, 0 100%, 0 10px); box-shadow: 0 6px 24px rgba(0,0,0,.6), -1px 0 0 0 var(--swarf-glow, rgba(224,40,30,.32)); }
.sr-view { background: linear-gradient(180deg, #0f0b12 0%, #1d1226 40%, #3a1628 75%, #6a2a24 100%); }
.sr-jog h3 { margin-bottom: 6px; }
.sr-pad { grid-template-columns: repeat(3, 50px) 16px 50px; grid-template-rows: repeat(3, 50px); margin-top: 8px; }
.sr-modes { margin-top: 7px; }
.sr-goto { margin-top: 8px; }
.sr-keys { margin-top: 6px; }
.sr-box h3 { background: linear-gradient(180deg, rgba(255,255,255,.024), rgba(255,255,255,0) 40%), rgb(31,48,66); color: var(--swarf-text, #d8d2c6);
  font-size: 13px; font-weight: 600; letter-spacing: 0.02em; padding: 8px 12px 7px 14px; margin-bottom: 10px; border-bottom: 1px solid #000; }
.sr-empty { color: var(--swarf-text-2, #8a857c); }
.sr-empty b { color: var(--swarf-text, #d8d2c6); }
.sr-vtools button, .sr-chip, .sr-file button, .sr-from button, .sr-ask button, .sr-sim button { background: #555; border: 1px solid #777; color: #fff; border-radius: 3px; }
.sr-axis { background: rgba(0,0,0,.55); border: 1px solid var(--swarf-line-2, #3a1e18); border-radius: 2px; }
.sr-axis .a { color: var(--swarf-accent-hi, #ff3a2a); font-weight: 700; font-size: 15px; }
.sr-axis .v, .sr-axis input.v { color: #fff; font-size: 26px; }
.sr-axis button, .sr-zrow button, .sr-goto button { background: #3a3532; border: 1px solid #5e5550; color: #fff; border-radius: 3px; text-transform: none; letter-spacing: .08em; font-size: 12px; }
.sr-axis button:hover, .sr-zrow button:hover, .sr-goto button:hover { background: #4a4440 !important; border-color: var(--swarf-accent, #d02020); }
.sr-zrow .keep { color: var(--swarf-text-2, #8a857c); }
.sr-mpos, .sr-keys { color: var(--swarf-text-2, #8a857c); font-size: 12px; }
.sr-modes span { color: var(--swarf-accent-hi, #ff3a2a); text-transform: none; letter-spacing: 0.02em; font-size: 11px; font-weight: 600; }
.sr-modes button, .sr-modes input { background: #2a2623; border: 1px solid #5e5550; color: #fff; border-radius: 3px; font-size: 13px; }
.sr-modes button:hover { background: #3a3532 !important; }
.sr-modes button.on { background: var(--swarf-accent, #d02020) !important; border-color: var(--swarf-accent-hi, #ff3a2a); }
.sr-pad button { background: #3a3532; border: 1px solid #6e645e; color: #fff; border-radius: 4px; font-size: 16px; }
.sr-pad button:hover { background: #4a4440 !important; border-color: var(--swarf-accent, #d02020); }
.sr-pad button:active, .sr-pad button.held { background: var(--swarf-accent, #d02020) !important; }
.sr-actions button { border-radius: 3px; background: #3a3532; border: 1px solid #5e5550; color: #fff; text-transform: none; letter-spacing: 0.02em; }
.sr-actions .cut { background: var(--swarf-accent, #d02020); border-color: var(--swarf-accent-hi, #ff3a2a); }
.sr-actions .stop { background: #5a0e0a; border-color: var(--swarf-accent-hi, #ff3a2a); }
.sr-plan, .sr-row, .sr-from, .sr-sim, .sr-scrub, .sr-facts { color: var(--swarf-text, #d8d2c6); }
.sr-note { color: var(--swarf-text-2, #8a857c); font-size: 12px; }
.sr-big { color: #fff; font-size: 24px; text-transform: none; letter-spacing: 0.02em; }
.sr-from input { background: rgba(0,0,0,.55); border-color: var(--swarf-accent, #d02020); color: #fff; border-radius: 2px; }
#swarf-run .sr-sr-out, .sr-stat .sr-out { background: #555; border: 1px solid #777; color: #fff; border-radius: 3px; padding: 6px 0; text-transform: none; letter-spacing: 0.02em; font-size: 12px; }
.sr-card { border-radius: 0; border-left: 3px solid var(--swarf-accent, #d02020); clip-path: polygon(10px 0, 100% 0, 100% 100%, 0 100%, 0 10px); }
.sr-card p, .sr-chk span { color: var(--swarf-text, #d8d2c6); }

#swarf-run { --c-surf: rgba(27,23,21,.95); --c-line: #3a3230; --c-btn: #322c29; --c-btn2: #3f3835; --c-bline: #4f4642; --c-text: #e8e2d8; --c-dim: #998f85; --c-red: #d02020; }
/* ---- calm ----
   quiet surfaces, small gray labels, lowercase like swarf's own tiles; red only for
   the current step, cut and stop; one border weight; no stripes, bars or chamfers. */
#swarf-run .sr-box { background: var(--c-surf) !important; border: 1px solid var(--c-line) !important; border-radius: 8px !important; clip-path: none !important; box-shadow: 0 8px 28px rgba(0,0,0,.45) !important; }
#swarf-run .sr-box h3 { background: none !important; border: 0 !important; color: var(--c-dim) !important; font-size: 11px !important; font-weight: 500 !important; letter-spacing: 0.02em !important; padding: 12px 14px 4px !important; margin: 0 0 4px !important; }
#swarf-run button { text-transform: none !important; letter-spacing: .02em !important; }
#swarf-run .sr-top .sr-step { background: none !important; border: 1px solid transparent !important; color: var(--c-dim) !important; text-transform: none !important; letter-spacing: .02em !important; padding: 4px 8px !important; border-radius: 999px !important; }
#swarf-run .sr-top .sr-step.done { color: var(--c-text) !important; }
#swarf-run .sr-top .sr-step.now { border-color: var(--c-red) !important; color: #fff !important; box-shadow: none !important; }
#swarf-run .sr-top .sr-step.blocked { border-color: var(--swarf-amber, #c08a3a) !important; }
#swarf-run .sr-say { color: var(--c-text) !important; text-shadow: none !important; }
#swarf-run .sr-axis { background: transparent !important; border: 0 !important; border-bottom: 1px solid var(--c-line) !important; border-radius: 0 !important; }
#swarf-run .sr-axis .a { color: var(--c-dim) !important; font-weight: 500 !important; }
#swarf-run .sr-axis .v, #swarf-run .sr-axis input.v { color: #fff !important; font-size: 24px !important; font-weight: 400 !important; }
#swarf-run .sr-mpos { display: none !important; }
#swarf-run .sr-modes span, #swarf-run .sr-modes .lbl { color: var(--c-dim) !important; text-transform: none !important; letter-spacing: .02em !important; font-weight: 400 !important; font-size: 12px !important; }
#swarf-run .sr-zrow button, #swarf-run .sr-goto button, #swarf-run .sr-modes button, #swarf-run .sr-modes input, #swarf-run .sr-pad button,
#swarf-run .sr-actions button, #swarf-run .sr-vtools button, #swarf-run .sr-from button, #swarf-run .sr-file button, #swarf-run .sr-conn button {
  background: var(--c-btn) !important; border: 1px solid var(--c-bline) !important; color: var(--c-text) !important; border-radius: 6px !important; box-shadow: none !important; font-weight: 400 !important; }
#swarf-run .sr-zrow button:hover, #swarf-run .sr-goto button:hover, #swarf-run .sr-modes button:hover, #swarf-run .sr-pad button:hover,
#swarf-run .sr-actions button:not(:disabled):hover, #swarf-run .sr-vtools button:hover, #swarf-run .sr-conn button:hover { background: var(--c-btn2) !important; border-color: #5a514c !important; }
#swarf-run .sr-modes button.on, #swarf-run .sr-vtools button.on { background: #3a3431 !important; border-color: #a39a90 !important; color: #fff !important; }
#swarf-run .sr-pad button b { font-weight: 500 !important; }
#swarf-run .sr-pad button small { color: var(--c-dim) !important; text-transform: none !important; }
#swarf-run .sr-pad button:active, #swarf-run .sr-pad button.held { background: var(--c-red) !important; border-color: var(--c-red) !important; }
#swarf-run .sr-pad button.held small, #swarf-run .sr-pad button:active small { color: #fff !important; }
#swarf-run .sr-actions { grid-template-columns: repeat(3, 1fr) !important; }
#swarf-run .sr-board-say { min-height: 1.4em; margin: 6px 0 0; font-size: 12px; line-height: 1.4; }
#swarf-run .sr-board-say.warn { color: var(--swarf-amber, #d09020); font-weight: 600; }
#swarf-run .sr-actions .stop { grid-column: span 2; }   /* while a job runs, stop is the biggest target */
#swarf-run .sr-actions button { padding: 14px 0 !important; font-size: 14px !important; }
#swarf-run .sr-actions .cut:not(:disabled) { background: var(--c-red) !important; border-color: var(--c-red) !important; color: #fff !important; }
#swarf-run .sr-actions .cut:disabled, #swarf-run .sr-actions .cut.wait { background: var(--c-btn) !important; border-color: var(--c-bline) !important; }
#swarf-run .sr-actions .cut.wait { color: var(--c-text) !important; }
#swarf-run .sr-actions .stop { background: var(--c-red) !important; border-color: var(--c-red) !important; color: #fff !important; font-weight: 600 !important; }
#swarf-run .sr-actions .trace.next { border-color: #a39a90 !important; box-shadow: none !important; }
#swarf-run .sr-actions .pause, #swarf-run .sr-actions .stop { grid-column: span 1; }
#swarf-run .sr-link { background: none !important; border: 0 !important; color: var(--c-dim) !important; text-decoration: underline; padding: 0 !important; font-size: 12px !important; }
#swarf-run .sr-link:hover { color: var(--c-text) !important; background: none !important; }
#swarf-run .sr-other { color: var(--c-dim) !important; }
#swarf-run .sr-plan { color: var(--c-text) !important; }
#swarf-run .sr-plan .ok { color: #9fcfae !important; }
#swarf-run .sr-mach { padding: 8px 4px 0; display: flex; flex-direction: column; gap: 6px; }
#swarf-run .sr-mach .sr-big, #swarf-run .sr-mach .sr-row:not(.note) { display: none !important; }
#swarf-run .sr-mach .sr-out { background: none !important; border: 0 !important; color: var(--c-dim) !important; text-decoration: underline; text-align: left; padding: 0 !important; font-size: 12px !important; letter-spacing: .02em !important; text-transform: none !important; }
#swarf-run .sr-mach .sr-note { color: var(--c-dim) !important; }
#swarf-run .sr-jh .sr-conn span { color: var(--c-text); }
#swarf-run .sr-keys { color: var(--c-dim) !important; }
#swarf-run .sr-view { border-radius: 8px !important; }
#swarf-run .sr-col > .sr-box { border: 1px solid var(--c-line) !important; box-shadow: 0 8px 28px rgba(0,0,0,.45) !important; }
#swarf-run .sr-jog .sr-modes button.on, #swarf-run .sr-jog .sr-modes.sr-steprow button.on { background: #45403c !important; border-color: #b3aaa0 !important; color: #fff !important; }
/* one look for "on" in control: the sim speed chip, the view chips and the keep-zero offer match the jog chips */
#swarf-run .sr-sim button.on, #swarf-run .sr-vtools button.on { background: #45403c !important; border-color: #b3aaa0 !important; color: #fff !important; }
#swarf-run .sr-keepzero { background: #2a2523; border-color: #4f4642; color: #f2ede4; border-radius: 6px; }
#swarf-run .sr-keepzero:hover { border-color: #a39a90; }
/* a button waiting on a step is pressable: it says what it needs */
#swarf-run .sr-actions .cut.quiet { background: var(--swarf-bg-3, #1c1817) !important; color: inherit !important; border-color: var(--swarf-line-2, #3a1e18) !important; box-shadow: none !important; }
#swarf-run .sr-actions button.wait { opacity: .78; cursor: help; box-shadow: none !important; }
#swarf-run .sr-need { padding: 8px 12px 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: 11px; line-height: 16px; color: var(--c-dim, #8a857c); }
#swarf-run .sr-need span { /* each need a small pill, so the line reads as a row of checks */ padding: 0 7px; border: 1px solid var(--swarf-line-2, #3a1e18); border-radius: 999px; white-space: nowrap; }
#swarf-run .sr-need:empty { display: none; }
#swarf-run .sr-need b { font-weight: 500; color: var(--c-text, #d8d2c6); margin-right: 2px; }
#swarf-run .sr-need .ok { color: var(--c-dim, #8a857c); }
#swarf-run .sr-need .no { color: var(--c-text, #d8d2c6); text-decoration: underline; cursor: pointer; }
#swarf-run .sr-start { display: flex; gap: 8px; padding: 10px 12px 0; flex-wrap: wrap; }
#swarf-run .sr-start button { border-radius: 999px; padding: 7px 14px; background: var(--swarf-bg-3, #1c1817); border: 1px solid var(--swarf-line-2, #3a1e18); }
#swarf-run .sr-step { cursor: pointer; }
#swarf-run .sr-card p.sr-way { font-size: 12px; color: var(--c-dim, #8a857c); margin: -4px 0 10px; }
#swarf-run .sr-card p.sr-way.bad { color: var(--swarf-accent-hi, #b0221a); }
#swarf-run .sr-board-size { display: flex; align-items: flex-start; gap: 8px; margin: 6px 0 10px; }
#swarf-run .sr-board-size label { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 0; cursor: default; }
#swarf-run .sr-board-size input { width: 76px; text-align: right; }
#swarf-run .sr-board-size small { font-size: 11px; color: var(--c-dim, #8a857c); }
#swarf-run .sr-board-size > span { padding-top: 6px; color: var(--c-dim, #8a857c); }
#swarf-run .sr-plate-view { position: relative; width: min(100%, 52vh); aspect-ratio: 460 / 200; margin: 0 auto 8px; }
#swarf-run .sr-plate-view canvas { width: 100%; height: 100%; display: block; }
#swarf-run .sr-plate-view span { position: absolute; transform: translate(-50%, -130%); font-size: 11px; white-space: nowrap; pointer-events: none;
  color: var(--c-text, #d8d2c6); background: var(--swarf-bg-2, rgba(19,16,15,.8)); padding: 1px 6px; border-radius: 6px; }
#swarf-run .sr-plate-view .sr-plate-note { position: absolute; right: 6px; bottom: 4px; font-size: 11px; font-style: normal; color: var(--c-dim, #8a857c); }
#swarf-run .sr-plate-view span.l { transform: translate(-140%, -50%); }
#swarf-run .sr-plate-view span.r { transform: translate(30%, -50%); }
#swarf-run .sr-plate-view span.b { transform: translate(-50%, 60%); }
#swarf-run .sr-needrow { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--c-line, #3a1e18); }
#swarf-run .sr-needrow b { width: 18px; text-align: center; flex: none; }
#swarf-run .sr-needrow > span { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.35; }
#swarf-run .sr-needrow small { color: var(--c-dim, #8a857c); font-size: 12px; }
#swarf-run .sr-needrow.ok { opacity: .8; }
#swarf-run .sr-needrow button, #swarf-run .sr-card .row button { flex: none; }
#swarf-run .sr-needrow button { border-radius: 8px; padding: 6px 10px; background: var(--swarf-bg-3, #1c1817); border: 1px solid var(--swarf-line-2, #3a1e18); }
#swarf-run .sr-jog .sr-zrow button.next, #swarf-run .sr-conn button.next { border-color: #f2ede4 !important; color: #fff; box-shadow: 0 0 0 2px rgba(242,237,228,.25); }
html[data-skin] #swarf-run .sr-jog .sr-zrow button.next, html[data-skin] #swarf-run .sr-conn button.next { border-color: rgb(var(--sk-acc)) !important; box-shadow: 0 0 0 3px rgb(var(--sk-acc) / .25) !important; }
`;

  // ------------------------------------------------------------ dom
  // No orphans: a sentence's last two words are
  // tied with a no-break space, so its last line is never one word ("clamp", "one:"). Short
  // labels (three words or fewer) and anything without a space are left alone.
  // no widow: the last two words held together; not in classic, whose Geneva draws that space double
  const tie = t => typeof t === 'string' && t.trim().split(/\s+/).length > 3 && document.documentElement.dataset.skin !== 'classic' ? t.replace(/ (\S+)\s*$/, '\u00a0$1') : t;
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'class') e.className = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'text') e.textContent = /^(p|span|label|h2|h3|small|strong)$/.test(tag) ? tie(attrs[k]) : attrs[k];   // prose ties; data lines (the plan's divs) and buttons stay as written
      else e.setAttribute(k, attrs[k]);
    }
    for (const c of kids) if (c != null) e.append(c);
    return e;
  }

  // Prefix every selector with #swarf-run (rules naming #swarf-run itself, the
  // menubar entry, or body are left as written).
  function scoped(css) {
    return css.replace(/(?<=^|[{}])([^{}]+)\{/g, (m, sel) => {
      if (/^\s*(@|from\b|to\b|\d+%)/.test(sel)) return m;
      return sel.split(',').map(x => {
        const t = x.trim();
        return !t || t.startsWith('#swarf-run') || t.startsWith('body') ? x : ' #swarf-run ' + t;
      }).join(',') + '{';
    });
  }

  // Step and speed rows (findable, plain), in cam's
  // units; inside, steps stay mm and speeds mm/min
  function inch() { return !!window.SwarfLength && SwarfLength.unit() === 'in'; }
  // a length in words, in cam's units: "19.1 mm", or "3/4 in" / "0.75 in"
  function len(mm, dp) {
    if (!inch()) return `${+(+mm).toFixed(dp == null ? 1 : dp)} mm`;
    const v = mm / 25.4, f = Math.round(v * 16);
    return `${Math.abs(v * 16 - f) < 1e-6 && window.SwarfLength ? SwarfLength.say(mm).replace(/ in$/, '') : +v.toFixed(2)} in`;
  }
  // a length in a sentence, in cam's units: the nearest 16th in inches
  const prose = (mm, dp) => window.SwarfLength ? SwarfLength.prose(mm, inch() ? 'in' : 'mm', dp) : `${+(+mm).toFixed(dp == null ? 1 : dp)} mm`;
  // the lift before any move over the work (SAFE_Z): "25 mm" (with "(1 in)" where the line said it), or "1 in"
  const up = paren => inch() ? '1 in' : paren ? '25 mm (1 in)' : '25 mm';
  // the way in, in the student's units: "up to 1 in, over to X 0.47, Y 1.57"
  // (the router or the spindle, named as this machine names it)
  const wayWords = plan => window.SwarfRunPlan.entryWords(plan, inch() ? { len: v => prose(v, 0), at: v => +(v / 25.4).toFixed(2), tool: spindleWord() } : { len: v => prose(v, 0), tool: spindleWord() });
  const lens = (a, dp) => inch() ? a.map(v => len(v, dp).replace(/ in$/, '')).join(' × ') + ' in' : a.map(v => +(+v).toFixed(dp == null ? 1 : dp)).join(' × ') + ' mm';
  // a feed in words, in cam's units: "1200 mm/min" or "47 in/min"
  const rateWords = mmMin => inch() ? `${+(mmMin / 25.4).toFixed(1)} in/min` : `${Math.round(mmMin)} mm/min`;
  // a span of two numbers in cam's units, no unit word: "0 to 120" or "0 to 4.72"
  const spanWords = (a, b) => inch() ? `${+(a / 25.4).toFixed(2)} to ${+(b / 25.4).toFixed(2)}` : `${a.toFixed(0)} to ${b.toFixed(0)}`;
  const unitWord = () => inch() ? 'in' : 'mm';
  // the "go to … above z 0" height: 5 mm, or 0.2 in
  const goZmm = () => inch() ? 5.08 : 5;
  const goZword = () => inch() ? '0.2 in' : '5 mm';
  function rateRows() {
    const IN = 25.4, ui = inch(), u = ui ? 'in' : 'mm';
    S.rowsUnit = u;
    const same = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-6;
    el.modes.replaceChildren(h('span', { class: 'lbl' }, 'step', h('small', { text: u })));
    const stepIn = h('input', { type: 'text', inputmode: 'decimal', placeholder: `${u}…`, title: ui ? 'Type any step, then Enter: 1/2, 0.25 in or 5 mm' : 'Type any step in mm, then Enter (1/2 in works too)' });
    const steps = (ui ? [0.01, 0.1, 1, 2] : [0.1, 1, 10, 50]).map(v => ui ? v * IN : v);
    // a step from the other units' buttons (the 1 mm default, then "in" pressed) becomes the button
    // in the same place on this row, as the speed row does (never a lit "0.0394" in inches);
    // a step typed in the field stays as typed
    const others = (ui ? [0.1, 1, 10, 50] : [0.01, 0.1, 1, 2].map(v => v * IN));
    if (S.jogStep !== 'cont' && !S.jogTyped && !steps.some(x => same(x, S.jogStep))) { const i = others.findIndex(x => same(x, S.jogStep)); if (i >= 0) S.jogStep = steps[i]; }
    const pickStep = (v, b) => { S.jogStep = v; S.jogTyped = !b && v !== 'cont'; for (const c of el.modes.querySelectorAll('button')) c.classList.toggle('on', c === b); stepIn.classList.toggle('on', !b); };
    for (const v of [...steps, 'cont']) {
      const label = v === 'cont' ? 'continuous' : String(ui ? +(v / IN).toFixed(4) : v);
      const b = h('button', { class: v === 'cont' ? 'held' : '', text: label, title: v === 'cont' ? 'Moves while held, as on the MR-1; let go in time' : `Each press moves ${label} ${u}` });
      b.onclick = () => pickStep(v, b);
      if (v === S.jogStep || same(v, S.jogStep)) b.classList.add('on');
      el.modes.append(b);
    }
    // a step that is none of the buttons (typed, or from the other units) shows in the field
    if (S.jogStep !== 'cont' && !steps.some(x => same(x, S.jogStep))) { stepIn.value = window.SwarfLength ? SwarfLength.show(S.jogStep) : String(S.jogStep); stepIn.classList.add('on'); }
    // a typed step stays within half the bed's width, the most one press should move
    stepIn.addEventListener('change', () => {
      const v = mmOf(stepIn.value);
      if (v > 600) { stepIn.value = ''; tell(`A jog step goes up to ${ui ? 'about 24 in (600 mm)' : '600 mm (about 24 in)'}. For longer moves use continuous, or go to.`, 'warn'); return; }
      if (v > 0) { pickStep(v, null); return; }
      // not a step (abc, 0, -5, empty): the row shows the step a press will really move
      const typed = stepIn.value.trim();
      rateRows();
      if (typed) tell(`swarf could not read "${typed}" as a step above 0: each press still moves ${S.jogStep === 'cont' ? 'for as long as you hold it' : window.SwarfLength ? window.SwarfLength.say(S.jogStep) : S.jogStep + ' mm'}.`, 'warn');
    });
    stepIn.addEventListener('keydown', e => { if (e.key === 'Enter') stepIn.blur(); });
    el.modes.insertBefore(stepIn, el.modes.querySelector('button.held'));
    const su = ui ? 'in/min' : 'mm/min', zMax = ui ? `${Math.round(Z_JOG_MAX / IN)} in/min` : `${Z_JOG_MAX}`;
    el.speeds.replaceChildren(h('span', { class: 'lbl' }, 'speed', h('small', { text: su })));
    // none inside the X axis's rough band (about 960-1800 mm/min steady): the slow ones under it, the rest over
    const speeds = ui ? [10, 20, 28, 100, 200].map(v => v * IN) : [250, 500, 700, 2500, 5000];
    // the speed lit is the one nearest what is set, so a switch of units keeps a button lit
    const lit = S.jogSpeed === 'rapid' ? 'rapid' : speeds.reduce((a, b) => Math.abs(b - S.jogSpeed) < Math.abs(a - S.jogSpeed) ? b : a);
    if (lit !== S.jogSpeed) { S.jogSpeed = lit; if (S.machine) setJogSpeed(); }
    for (const v of [...speeds, 'rapid']) {
      const label = v === 'rapid' ? 'max' : String(ui ? Math.round(v / IN) : v);
      const b = h('button', { text: label, title: (v === 'rapid' ? (ui ? 'The shop jog speed, about 236 in/min' : 'The shop jog speed, 6000 mm/min') : `Jog at ${label} ${su}`) + `; Z never above ${zMax}` });
      b.onclick = () => { S.jogSpeed = v; setJogSpeed(); for (const c of el.speeds.querySelectorAll('button')) c.classList.toggle('on', c === b); };
      if (v === lit) b.classList.add('on');
      el.speeds.append(b);
    }
  }
  // a position on the readout, in cam's units
  function posText(mm) { return inch() ? (mm / 25.4).toFixed(4) : mm.toFixed(3); }
  function build() {
    document.head.append(h('style', { text: scoped(CSS) }));
    const root = el.root = h('div', { id: 'swarf-run' });

    // Control sits inside swarf: swarf's
    // menubar and step row stay; the connection lives in the jog header; the five
    // steps and the sentence share one line.
    el.conn = h('div', { class: 'sr-conn' }, h('span', { class: 'sr-dot' }), el.connText = h('span', { text: '' }),
      el.discBtn = h('button', { text: 'disconnect', title: 'Let go of the box, so another program can use it', onclick: () => disconnect() }),
      el.connBtn = h('button', { text: 'connect', title: onWindows() ? 'Connect over USB; quit ShopBot 3 first: one program at a time' : 'Connect to the ShopBot over its USB cable', onclick: () => connect(true) }));
    el.steps = h('div', { class: 'sr-steps' });
    STEPS.forEach((s, i) => el.steps.append(h('div', { class: 'sr-step', 'data-step': s, title: STEP_SAYS[s], onclick: () => tell(STEP_SAYS[s]) }, h('span', { class: 'n', text: String(i + 1) }), h('span', { text: s }))));
    el.say = h('div', { class: 'sr-say' });
    el.strip = h('div', { class: 'sr-strip' });   // MASQ's working strip: on while the machine runs
    // which machine this is, in one place: in the top row, not a new line
    el.target = h('div', { class: 'sr-target', title: 'What the buttons below move' });
    root.append(h('div', { class: 'sr-top' }, el.steps, el.say, el.target), el.strip);
    // the mm | in switch with control open: its sentence and the steps' words follow
    try {
      const u = window.kiri.api.ui.units;
      if (u) u.addEventListener('change', () => setTimeout(() => {
        for (const n of el.steps.children) n.title = STEP_SAYS[n.dataset.step];
        if (S.open) refresh();
      }, 0));
    } catch (e) { /* no units control */ }

    // grid
    const grid = h('div', { class: 'sr-grid' });
    root.append(grid);

    // preview (upper left)
    el.view = h('div', { class: 'sr-box sr-view' });
    el.canvas = h('canvas');
    el.empty = h('div', { class: 'sr-empty' });   // the box below says what to do, in one place
    el.facts = h('div', { class: 'sr-facts' });
    el.scrubLabel = h('span', { text: '' });
    el.scrub = h('input', { type: 'range', min: '0', max: '0', value: '0', title: 'Show the program up to a line' });
    // scrub: the path up to a line, and the bit (and the ghost machine) where that line ends.
    // ▶ plays the program through like cam's simulate,
    // and the bed moves with the playhead. The numbers stay the machine's.
    el.scrub.addEventListener('input', () => { playStop(); previewAt(+el.scrub.value); });
    el.play = h('button', { class: 'sr-play', text: '▶', title: 'Play the program through (space pauses)', onclick: () => (PV.raf ? playStop() : playStart()) });
    el.playRate = h('button', { class: 'sr-rate', text: `preview ${PV.rate}×`, title: 'How fast it plays, against the machine\'s own speed', onclick: () => { PV.rate = PV_RATES[(PV_RATES.indexOf(PV.rate) + 1) % PV_RATES.length]; el.playRate.textContent = `preview ${PV.rate}×`; } });
    el.view.append(el.canvas, el.empty, el.facts,
      h('div', { class: 'sr-vtools' },
        h('button', { text: 'top', onclick: () => view.camTop(), title: 'Look straight down' }),
        h('button', { text: '3d', onclick: () => view.camIso(), title: 'Angled view' }),
        h('button', { text: 'fit', onclick: () => view.fit(), title: 'Fit the program in view' }),
        el.ghostBtn = h('button', { text: 'machine', title: 'Show the ShopBot: its bed slides under the gantry', onclick: () => { view.setGhost(!view.ghost.visible); el.ghostBtn.classList.toggle('on', view.ghost.visible); } })),
      h('div', { class: 'sr-scrub' }, el.play, el.playRate, el.scrub, el.scrubLabel));
    el.view.addEventListener('dragover', e => { e.preventDefault(); el.view.classList.add('drag'); });
    el.view.addEventListener('dragleave', () => el.view.classList.remove('drag'));
    // a file dropped anywhere on control is control's: cam's own window drop never sees it
    el.root.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
    el.root.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation(); el.view.classList.remove('drag');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readFile(f);
    });

    // jog (upper right)
    el.jog = h('div', { class: 'sr-box sr-jog' }, h('div', { class: 'sr-pin' }, h('h3', { class: 'sr-jh' }, h('span', { text: 'jog' }), el.conn), el.next = h('div', { class: 'sr-next' })), h('div', { class: 'sr-lock', text: 'locked while the program runs' }));
    el.dro = {};
    const dro = h('div', { class: 'sr-dro' });
    for (const a of ['x', 'y', 'z']) {
      el.dro[a] = h('span', { class: 'v', text: '0.000', title: `Click to type a ${a.toUpperCase()} position for this spot` });
      el.dro[a].addEventListener('click', () => typeWork(a));
      dro.append(h('div', { class: 'sr-axis' }, h('span', { class: 'a', text: a.toUpperCase() }), el.dro[a]));
    }
    el.mpos = h('div', { class: 'sr-mpos' });
    el.jog.append(dro, el.mpos,
      h('div', { class: 'sr-zrow' },
        el.zxyBtn = h('button', { text: 'zero x y', title: 'This spot becomes X 0, Y 0', onclick: () => doZero('xy') }),
        el.zzBtn = h('button', { text: 'zero z', title: 'This height becomes Z 0', onclick: () => doZero('z') }),
        el.plateBtn = h('button', { text: 'z plate', title: 'Zero Z with the touch plate: a short guide', onclick: plateWizard })),
      el.keepZero = h('button', { class: 'sr-keepzero', text: '', onclick: keepZero }));
    el.modes = h('div', { class: 'sr-modes sr-steprow' });
    el.speeds = h('div', { class: 'sr-modes' });
    rateRows();
    // the mm | in switch pressed with control open: rows, plan and readout follow
    try {
      const u = window.kiri.api.ui.units;
      if (u) u.addEventListener('change', () => {
        if (S.rowsUnit === (inch() ? 'in' : 'mm')) return;
        rateRows(); renderPlan(); refresh();
        if (S.machine) for (const a of ['x', 'y', 'z']) el.dro[a].textContent = posText(S.machine.state.pos[a] || 0);
      });
    } catch (e) { /* no units control */ }
    el.jog.append(el.modes, el.speeds);
    const pad = h('div', { class: 'sr-pad' });
    const WORDS = { '+Y': 'away', '−Y': 'toward', '−X': 'left', '+X': 'right', '+Z': 'up', '−Z': 'down' };
    const cell = (label, axis, dir, col, row) => {
      const b = h('button', { title: `Jog ${label} (${WORDS[label]})`, 'data-axis': label }, h('b', { text: label }), h('small', { text: WORDS[label] }));
      b.style.gridColumn = col; b.style.gridRow = row;
      b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); jogDown(axis, dir, b); });
      b.addEventListener('pointerup', () => jogUp(b));
      b.addEventListener('pointercancel', () => jogUp(b));
      b.addEventListener('lostpointercapture', () => jogUp(b));
      pad.append(b);
    };
    cell('+Y', 'y', 1, 2, 1); cell('−X', 'x', -1, 1, 2); cell('+X', 'x', 1, 3, 2); cell('−Y', 'y', -1, 2, 3);
    cell('+Z', 'z', 1, 5, 1); cell('−Z', 'z', -1, 5, 3);
    // the router by hand, to test it: asks before it starts, red while on, one press stops it
    // the bed seen from the front, 8 x 4 like the ShopBot's: which way X and Y run
    const bed = h('div', { class: 'sr-bedmap', title: 'The bed from the front; the dot is the front-left corner' });
    bed.innerHTML = '<svg viewBox="0 0 84 46" aria-hidden="true"><rect x="2" y="2" width="80" height="40" rx="3"/><circle cx="6" cy="38" r="2.6"/><path d="M14 38H34M30 35l4 3-4 3M6 30V12M3 16l3-4 3 4"/><text x="38" y="41">X</text><text x="9" y="11">Y</text></svg><small>front</small>';
    bed.style.gridColumn = 2; bed.style.gridRow = 2;
    pad.append(bed);
    // (out of the jog grid, small, in the corner, so a jog press never lands on it)
    el.routerBtn = h('button', { class: 'sr-router', title: 'Test the router: switch it on, then off', onclick: () => routerButton() }, h('b', { text: 'router' }), h('small', { text: 'test' }));
    el.jog.append(pad,
      h('div', { class: 'sr-keyrow' }, el.routerBtn,
        el.keys = h('div', { class: 'sr-keys', text: '← → ↑ ↓  X Y   ·   fn ↑ ↓  Z   ·   space stops' })),
      h('div', { class: 'sr-goto' },
        el.homeBtn = h('button', { text: 'home', title: 'Run to the home sensors', onclick: () => isGrbl()
          ? aboutToMove({ title: 'The MR-1 is about to home', text: 'It runs to its switches by itself: up first, then to its home corner. It can take a minute. Nothing else moves until it is done.', go: 'home', run: homeGrbl })
          : aboutToMove({ title: 'The machine is about to home', text: 'It lifts, then runs to the home sensors in the -X, -Y corner.', go: 'home', run: () => S.machine.home() }) }),
        el.mr1CheckBtn = h('button', { text: 'machine check', title: 'What the MR-1 reports: its settings, its switches. Nothing moves', onclick: () => mr1Check() }),
        el.goXY = h('button', { text: 'go to x y 0', title: 'Up, then over to X 0, Y 0', onclick: () => aboutToMove({ title: 'The bit is about to move',
          // before Z is zeroed there is no Z 0 to name: it lifts from where it is
          text: S.zeroZ ? `Up to ${up(1)} over Z 0 (if it is lower), then over to X 0, Y 0.` : `Up ${up(1)} from where it is, then over to X 0, Y 0.`,
          go: 'move', run: () => { const z = S.machine.state.pos.z; S.machine.goTo({ z: S.zeroZ ? Math.max(z, SAFE_Z) : z + 25.4, x: 0, y: 0 }); } }) }),
        el.goZ = h('button', { text: `go to ${goZword()} above z 0`, title: `Down to ${goZword()} above Z 0, slowly`, onclick: () => aboutToMove({ title: 'The bit is about to come down', text: `Down to ${goZword()} above Z 0, slowly. Check nothing is under the bit but the board.`, go: 'move', run: () => { setJogSpeed(); S.machine.goTo({ z: goZmm() }); } }) }),
        el.cornersBtn = h('button', { text: 'table corners', title: 'Zero at, or go to, the table\'s front-left or front-right corner', onclick: cornersCard })));

    // program (lower left)
    el.prog = h('div', { class: 'sr-box sr-prog' }, h('h3', { text: 'program' }));
    el.fileInput = h('input', { type: 'file', accept: '.sbp,.nc,.tap,.gcode,.txt', style: 'display:none' });
    el.fileInput.addEventListener('change', () => { if (el.fileInput.files[0]) readFile(el.fileInput.files[0]); el.fileInput.value = ''; });
    el.fileName = h('span', { class: 'name', text: 'no program' });
    el.fromCam = h('button', { text: 'bring the toolpaths again', title: 'Make the toolpaths again and bring them here', onclick: fromCam });
    el.otherFile = h('a', { class: 'sr-other', text: 'open a file from other software', href: '#', title: 'A ShopBot (.sbp) or G-code (.nc) file made somewhere else' });
    el.otherFile.addEventListener('click', e => { e.preventDefault(); el.fileInput.click(); });
    el.start = h('div', { class: 'sr-start' },
      h('button', { text: 'make a part', title: 'Back to cam to make a part and add a step', onclick: () => { close(); const b = document.getElementById('swarf-step-shape'); if (b) b.click(); } }),
      h('button', { text: 'open a file', title: 'A ShopBot (.sbp) or G-code (.nc) file made somewhere else', onclick: () => el.fileInput.click() }),
      h('button', { text: 'a test cut', title: 'Learn the machine on a scrap of plywood', onclick: () => window.__swarfLessons && window.__swarfLessons.choose() }),
      el.measure = h('button', { text: 'measure it', title: 'Type in what your calipers read', onclick: () => window.__swarfLessons && window.__swarfLessons.measure() }));
    el.lessonLink = h('a', { class: 'sr-other', text: 'a test cut', href: '#', title: 'Learn the machine on a scrap of plywood' });
    el.lessonLink.addEventListener('click', e => { e.preventDefault(); if (window.__swarfLessons) window.__swarfLessons.choose(); });
    // a latched fault: a red bar over the program, its button the way out, not a small
    // underlined "all clear" in the to-run line
    el.faultText = h('span', { class: 'sr-faulttext' });
    el.faultBar = h('div', { class: 'sr-faultbar', style: 'display:none' }, el.faultText, h('button', { class: 'go', text: 'all clear…', onclick: () => faultCard() }));
    el.prog.append(el.faultBar, el.fileInput, h('div', { class: 'sr-file' }, el.fileName, el.fromCam), el.start, h('div', {}, el.otherFile, el.lessonLink));
    el.btn = {
      trace: h('button', { class: 'trace', text: 'trace', title: `Run the rectangle the cut fills, ${up()} up, router off`, onclick: () => askCut('trace') }),
      air: h('button', { class: 'air', text: 'air cut', title: 'Run the whole file above your board, router off', onclick: () => askCut('air') }),
      cut: h('button', { class: 'cut', text: 'cut', title: 'Cut the file: the router starts', onclick: askCut }),
      pause: h('button', { class: 'pause', text: 'pause', title: 'Pause: the router stops, the bit stays put', onclick: pauseResume }),
      stop: h('button', { class: 'stop', text: 'stop', title: 'Stop all motion', onclick: () => { S.userStopped = true; S.machine.stop(); } })
    };
    el.prog.append(h('div', { class: 'sr-actions' }, el.btn.trace, el.btn.air, el.btn.cut, el.btn.pause, el.btn.stop));
    // the feed override while a job runs (like the MR-1's): cuts only, 50 to 150 % in 5 % steps
    const ovr = d => { const m = S.machine; if (m && m.setOverride) { m.setOverride(((m.state.override || 100) + d)); refresh(); } };
    el.ovr = h('div', { class: 'sr-ovr' }, h('span', { class: 'lbl', text: 'feed' }),
      el.ovrDn = h('button', { text: '−5%', title: 'Cut 5 % slower (down to 50 %)', onclick: () => ovr(-5) }),
      el.ovrVal = h('b', { text: '100%' }),
      el.ovrUp = h('button', { text: '+5%', title: 'Cut 5 % faster, up to 150 %', onclick: () => ovr(5) }),
      h('button', { text: '100%', title: 'Back to the file\'s own feeds', onclick: () => { const m = S.machine; if (m && m.setOverride) { m.setOverride(100); refresh(); } } }));
    el.prog.append(el.ovr);
    // an air cut's speed: nothing is cutting, so a slider and a wider range. Dragged, it
    // sets the speed a few times a second: each change plans the rest of the job again
    let rateT = 0;
    const rateNow = () => { rateT = 0; const m = S.machine; if (m && m.setRate) { m.setRate(+el.rateIn.value); refresh(); } };
    el.rate = h('div', { class: 'sr-ovr sr-airspeed' }, h('span', { class: 'lbl', text: 'air run, % of the file\'s feed' }),
      el.rateIn = h('input', { type: 'range', min: '50', max: '400', step: '5', value: '100', title: 'Air cut speed: starts at 75 %; 100 % is cutting speed' }),
      el.rateVal = h('b', { text: '100%' }),
      h('button', { text: '100%', title: 'Back to the speed it will cut at', onclick: () => { el.rateIn.value = 100; rateNow(); } }));
    el.rateIn.addEventListener('input', () => { el.rateVal.textContent = `${el.rateIn.value}%`; if (!rateT) rateT = setTimeout(rateNow, 150); });
    el.prog.append(el.rate);
    el.need = h('div', { class: 'sr-need' });
    el.prog.append(el.need);
    // a waiting button still takes the press, and says what it waits for
    for (const k of ['trace', 'air', 'cut']) el.btn[k].addEventListener('click', e => {
      if (!el.btn[k].classList.contains('wait')) return;
      e.stopImmediatePropagation(); needsCard(k);
    }, true);
    el.fromLine = h('input', { type: 'number', min: '1', value: '1' });
    el.fromBtn = h('button', { text: 'continue from line', title: `Up to ${up()}, over, then cut from this line on`, onclick: () => askCut('from') });
    el.fromRow = h('div', { class: 'sr-from' }, 'continue after a stop:', el.fromLine, el.fromBtn);
    el.prog.append(el.fromRow);
    el.plan = h('div', { class: 'sr-plan' });
    el.prog.append(el.plan);

    // status (lower right)
    el.stat = h('div', { class: 'sr-mach' });
    el.big = h('div', { class: 'sr-big', text: '—' });
    el.rows = h('div', {});
    el.ask = h('div', { class: 'sr-ask' }, el.askText = h('p'),
      h('button', { text: 'continue', onclick: () => S.machine.answer(1) }),
      h('button', { text: 'quit the file', onclick: () => S.machine.answer(-1) }));
    // sounds: on the real machine only; one chip turns them off and on
    const soundWord = () => window.SwarfSound && SwarfSound.level() ? 'sounds on' : 'sounds off';
    el.soundBtn = h('button', { class: 'sr-out', text: soundWord(), title: 'Short sounds on the ShopBot, for moves, the router and errors', onclick: () => { if (!window.SwarfSound) return; SwarfSound.set(SwarfSound.level() ? 0 : 0.6); el.soundBtn.textContent = soundWord(); if (SwarfSound.level()) SwarfSound.play('done'); } });
    el.simCtl = h('div', { class: 'sr-sim' }, 'simulated machine speed');
    for (const r of [1, 10, 50]) {
      const b = h('button', { text: `${r}×`, onclick: () => { S.simRate = r; if (S.machine.timeScale !== undefined || S.machine instanceof M.SimMachine) S.machine.timeScale = r; for (const c of el.simCtl.querySelectorAll('button')) c.classList.toggle('on', c === b); } });
      if (r === S.simRate) b.classList.add('on');
      el.simCtl.append(b);
    }
    el.note = h('div', { class: 'sr-note', text: '' });
    // machine setup is for the teacher: press and hold 1.5 s (one of its buttons starts the router)
    el.checkBtn = h('button', { class: 'sr-out sr-hold', text: 'machine setup (hold)', title: 'For the teacher: press and hold' });
    let holdT = null;
    const holdOff = () => { clearTimeout(holdT); el.checkBtn.classList.remove('arming'); };
    el.checkBtn.addEventListener('pointerdown', () => { el.checkBtn.classList.add('arming'); holdT = setTimeout(() => { holdOff(); openCheck(); }, 1500); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.checkBtn.addEventListener(ev, holdOff);
    el.stat.append(h('div', { class: 'sr-stat' }, el.big, el.rows, el.ask, el.simCtl, el.soundBtn, el.checkBtn, el.note));

    grid.append(h('div', { class: 'sr-col' }, el.view, el.prog), el.rightCol = h('div', { class: 'sr-col' }, el.jog, el.stat));
    // a box that scrolls says so while there is more below (at 1280×720 the go-to row,
    // the speed and the simulator note sit under the window), as the rail does
    for (const box of [el.rightCol, el.plan]) {
      let rq = 0;
      const more = () => { rq = 0; box.classList.toggle('swarf-more', box.scrollHeight - box.clientHeight - box.scrollTop > 6); };
      const soon = () => { if (!rq) rq = requestAnimationFrame(more); };
      box.addEventListener('scroll', soon, { passive: true });
      window.addEventListener('resize', soon);
      if (window.ResizeObserver) new ResizeObserver(soon).observe(box);
      new MutationObserver(soon).observe(box, { childList: true, subtree: true, characterData: true });
    }
    el.fromCam.classList.add('sr-link'); el.fromCam.textContent = 'make the toolpaths again';

    // cut checklist sheet
    el.veil = h('div', { class: 'sr-veil' }, h('div', { class: 'sr-veilcard' },
      h('h2', { text: 'Paused. The router is switched off.' }),
      h('p', { text: 'It slows for a few seconds before it stops turning. Resume starts the router and carries on from here.' }),
      h('div', { class: 'row' },
        h('button', { text: 'end the job', title: 'Stops here and keeps the line, so you can continue from it later', onclick: () => { S.userStopped = true; S.machine.stop(); } }),
        el.resumeBtn = h('button', { class: 'go', text: 'start the router and resume', onclick: () => resumeNow() }))));
    el.veilWay = h('p', { class: 'sr-way' });
    el.veil.querySelector('.sr-veilcard p').after(el.veilWay);
    root.append(el.veil);
    el.sheet = h('div', { class: 'sr-sheet' });
    el.card = h('div', { class: 'sr-card', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' });
    el.sheet.append(el.card);
    root.append(el.sheet);
    // a card taller than the window says so in its button row while there is more below (a ticked
    // list under the buttons on a small screen)
    {
      let rq = 0;
      const more = () => { rq = 0; el.card.classList.toggle('swarf-more', el.card.scrollHeight - el.card.clientHeight - el.card.scrollTop > 6); };
      const soon = () => { if (!rq) rq = requestAnimationFrame(more); };
      el.card.addEventListener('scroll', soon, { passive: true });
      window.addEventListener('resize', soon);
      if (window.ResizeObserver) new ResizeObserver(soon).observe(el.card);
      new MutationObserver(soon).observe(el.card, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['open'] });
    }
    sheetModal();

    // inside #app (position: fixed makes it a stacking context): out here, control covered the menus whatever their z-index
    (document.getElementById("app") || document.body).append(root);
    view.init(el.canvas, el.view);
    el.ghostBtn.classList.toggle('on', view.ghost.visible);
  }

  // ------------------------------------------------------------ viewer
  const view = {
    init(canvas, box) {
      const THREE = window.THREE;
      this.THREE = THREE;
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.renderer.setClearColor(0x000000, 0);   // swarf's scene gradient shows from .sr-view
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(40, 1, 1, 50000);
      this.camera.up.set(0, 0, 1);
      this.target = new THREE.Vector3(0, 0, 0);
      this.sph = { r: 800, th: -Math.PI / 2 + 0.5, ph: 0.9 };
      this.paths = null;
      this.done = -1;
      // the work: the board's paths, its grid, the origin and the ghost bed. On the
      // shop's ShopBot the BED moves in X under a fixed gantry, so
      // with the machine shown this whole group slides in X.
      this.work = new THREE.Group();
      this.scene.add(this.work);
      // origin axes
      const ax = new THREE.Group();
      const axis = (x, y, z, c) => {
        const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(x, y, z)]);
        return new THREE.Line(g, new THREE.LineBasicMaterial({ color: c }));
      };
      ax.add(axis(40, 0, 0, 0xd02020), axis(0, 40, 0, 0x3fbf6a), axis(0, 0, 40, 0x4a7fd0));
      this.axes = ax;
      this.work.add(ax);
      // tool
      // a cone with its tip at the group origin (the bit's tip), widening upward
      const tool = new THREE.Mesh(new THREE.ConeGeometry(4, 18, 20), new THREE.MeshBasicMaterial({ color: 0xd8d2c6 }));
      this.toolMesh = tool;
      tool.geometry.translate(0, -9, 0);
      tool.rotation.x = -Math.PI / 2;
      this.tool = new THREE.Group();
      this.tool.add(tool);
      this.scene.add(this.tool);
      this.grid = null;
      this.ghost = this.buildGhost();
      this.scene.add(this.ghost);
      this.work.add(this.ghostParts.bed);
      this.ghostParts.bed.visible = this.ghost.visible;
      this.bindOrbit(canvas);
      this.reskin();
      window.addEventListener('swarf.skin', () => { this.reskin(); if (this.gridAt) this.makeGrid(this.gridAt); this.paint(this.upTo === undefined ? Infinity : this.upTo, this.doneLine || 0); });
      new ResizeObserver(() => this.resize(box)).observe(box);
      this.resize(box);
      const loop = () => {
        // nothing to draw while control is shut; open() wakes it
        if (!S.open) { this.raf = 0; return; }
        // close in on the job the gantry would fill the view: only the bed shows until you zoom out
        if (this.ghostParts) this.ghostParts.gantry.visible = this.sph.r > 1800;
        this.renderer.render(this.scene, this.camera); this.raf = requestAnimationFrame(loop);
      };
      this.loop = loop;
      this.raf = 0;
      this.wake();
    },
    wake() { if (!this.raf && this.loop) this.raf = requestAnimationFrame(this.loop); },
    resize(box) {
      const w = box.clientWidth, hh = box.clientHeight;
      if (!w || !hh) return;
      this.renderer.setSize(w, hh, false);
      this.camera.aspect = w / hh;
      this.camera.updateProjectionMatrix();
    },
    place() {
      const { r, th, ph } = this.sph;
      const t = this.target;
      this.camera.position.set(t.x + r * Math.sin(ph) * Math.cos(th), t.y + r * Math.sin(ph) * Math.sin(th), t.z + r * Math.cos(ph));
      this.camera.lookAt(t);
    },
    bindOrbit(c) {
      let drag = null;
      c.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, b: e.button }; c.setPointerCapture(e.pointerId); });
      c.addEventListener('pointerup', () => { drag = null; });
      c.addEventListener('pointermove', e => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY;
        if (drag.b === 0) {
          this.sph.th -= dx * 0.008;
          this.sph.ph = Math.min(Math.PI / 2 - 0.02, Math.max(0.001, this.sph.ph - dy * 0.008));
        } else {
          const s = this.sph.r / 600;
          const right = new this.THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
          const up = new this.THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
          this.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
        }
        this.place();
      });
      c.addEventListener('contextmenu', e => e.preventDefault());
      c.addEventListener('wheel', e => { e.preventDefault(); this.sph.r = Math.min(6000, Math.max(60, this.sph.r * Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * 0.0015))); this.place(); }, { passive: false });
      this.place();
    },
    load(parsed) {
      const THREE = this.THREE;
      if (this.paths) { this.work.remove(this.paths); this.paths.geometry.dispose(); }
      if (this.grid) { this.work.remove(this.grid); }
      const n = parsed.moves.length;
      const pos = new Float32Array(n * 6), col = new Float32Array(n * 6);
      this.lineOf = new Int32Array(n);
      this.rapid = new Uint8Array(n);
      parsed.moves.forEach((m, i) => {
        pos.set([m.x0, m.y0, m.z0, m.x, m.y, m.z], i * 6);
        this.lineOf[i] = m.line; this.rapid[i] = m.rapid ? 1 : 0;
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      this.paths = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
      this.work.add(this.paths);
      this.bounds = parsed.bounds;
      const b = P.cutBounds(parsed) || parsed.bounds;
      if (b) this.makeGrid(b);
      this.done = -1;
      this.placeGhost(b);
      // tool marker sized to the job: about a tenth of its span, 6-40 mm tall
      const span = b ? Math.max(b.max.x - b.min.x, b.max.y - b.min.y) : 200;
      this.tool.scale.setScalar(Math.min(40, Math.max(6, span / 10)) / 18);
      this.paint(Infinity, Infinity);
      this.fit();
    },
    // the job's grid, in the skin's colors (swarf-skin.js)
    makeGrid(b) {
      const THREE = this.THREE, S = window.SwarfSkin;
      if (this.grid) { this.work.remove(this.grid); this.grid.geometry.dispose(); }
      this.gridAt = b;
      const sx = Math.max(50, b.max.x - b.min.x), sy = Math.max(50, b.max.y - b.min.y);
      const size = Math.ceil(Math.max(sx, sy) * 1.4 / 50) * 50;
      this.grid = new THREE.GridHelper(size, size / 10, S ? S.color('c-grid-axis', 0xd02020) : 0xd02020, S ? S.color('c-grid', 0x5a4a66) : 0x5a4a66);
      this.grid.rotation.x = Math.PI / 2;
      this.grid.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, Math.min(0, b.min.z) - 0.2);
      this.grid.visible = !this.ghost.visible;
      this.work.add(this.grid);
    },
    // the tool marker and the path colors, from the skin (as 0..1 rgb triples for paint)
    reskin() {
      const S = window.SwarfSkin;
      const rgb = (k, d) => { const n = S ? S.color(k, d) : d; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
      this.pc = { hidden: rgb('c-path-hidden', 0x0f0f0f), rapid: rgb('c-path-rapid', 0x57544a), done: rgb('c-path-done', 0xff4029), todo: rgb('c-path-todo', 0x9e231c) };
      if (this.toolMesh) this.toolMesh.material.color.setHex(S ? S.color('c-tool', 0xd8d2c6) : 0xd8d2c6);
    },
    clear() {
      if (this.paths) { this.work.remove(this.paths); this.paths = null; }
      if (this.grid) { this.work.remove(this.grid); this.grid = null; }
    },
    // upTo: lines shown at all; doneLine: lines already run (brighter)
    paint(upTo, doneLine) {
      if (!this.paths) return;
      const col = this.paths.geometry.attributes.color;
      const a = col.array;
      for (let i = 0; i < this.lineOf.length; i++) {
        const ln = this.lineOf[i];
        const c = this.pc;
        const [r, g, b] = ln > upTo ? c.hidden : this.rapid[i] ? c.rapid : ln <= doneLine ? c.done : c.todo;
        a[i * 6] = a[i * 6 + 3] = r; a[i * 6 + 1] = a[i * 6 + 4] = g; a[i * 6 + 2] = a[i * 6 + 5] = b;
      }
      col.needsUpdate = true;
    },
    showUpTo(line) { this.upTo = line; this.paint(line, this.doneLine || 0); },
    progress(line) { this.doneLine = line; this.paint(this.upTo === undefined ? Infinity : this.upTo, line); },
    // The shop's ShopBot, ghosted for scale: a 4 x 8 ft bed that slides
    // along X under a fixed gantry; the carriage rides the beam in Y and the router
    // rides the carriage in Z. The bed lives in this.work and slides with the job.
    // With no home switches the board's place on the bed is unknown: the job sits
    // near the bed's front-left corner. Turned off with the "machine" chip.
    buildGhost() {
      const THREE = this.THREE, G = new THREE.Group();
      // one model for CONTROL and SIMULATE: swarf-shopbot-model.js (from photos)
      const m = window.SwarfShopBotModel.build(THREE);
      const { bed, gantry } = m;
      G.add(bed, gantry);
      // foot marks every foot along the bed's edges, so the size reads at a glance
      const edge = new THREE.LineBasicMaterial({ color: 0xb8c8da, transparent: true, opacity: 0.16 });
      const ticks = [];
      for (let f = 0; f <= 8; f++) { const x = f * 304.8; ticks.push(new THREE.Vector3(x, -10, 0.5), new THREE.Vector3(x, -40, 0.5)); }
      for (let f = 0; f <= 4; f++) { const y = f * 304.8; ticks.push(new THREE.Vector3(-10, y, 0.5), new THREE.Vector3(-40, y, 0.5)); }
      bed.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(ticks), edge));
      this.ghostParts = { bed, gantry, model: m };
      this.bedAt = { x: 0, y: 0 };
      let on = true;
      try { on = localStorage.getItem('swarf-run-ghost') !== '0'; } catch (e) { /* private window */ }
      G.visible = on;
      return G;
    },
    placeGhost(b) {
      // the job's lower-left corner 50 mm in from the bed's front-left corner
      const x0 = b ? Math.min(0, b.min.x) - 50 : -50, y0 = b ? Math.min(0, b.min.y) - 50 : -50;
      this.bedAt = { x: x0, y: y0 };
      this.ghostParts.bed.position.set(x0, y0, 0);
    },
    setTool(p) {
      this.at = { x: p.x, y: p.y, z: p.z };
      // machine shown: the gantry stands still at the bit's X and the work slides under it
      const slide = this.ghost.visible;
      this.work.position.x = slide ? -p.x : 0;
      this.tool.position.set(slide ? 0 : p.x, p.y, p.z);
      if (this.ghostParts) {
        // the beam's center sits OFFSET mm behind the bit in X (the router hangs off the beam's face)
        const m = this.ghostParts.model;
        this.ghostParts.gantry.position.set((slide ? 0 : p.x) + m.OFFSET, this.bedAt.y, 0);
        m.set(p.y - this.bedAt.y, p.z);
      }
      if (slide) this.follow();
    },
    // machine shown: the camera stays put until the job slides out of view, then pans
    // (and backs off if it must) so the bit and the job are both in frame
    follow() {
      const b = this.bounds;
      if (!b) return;
      const job = new THREE.Vector3((b.min.x + b.max.x) / 2 + this.work.position.x, (b.min.y + b.max.y) / 2, 0);
      const bit = new THREE.Vector3(0, this.at.y, this.at.z);
      const seen = v => { const q = v.clone().project(this.camera); return Math.abs(q.x) < 0.8 && Math.abs(q.y) < 0.8 && q.z < 1; };
      this.camera.updateMatrixWorld();
      if (seen(job)) return;
      this.target.x = (job.x + bit.x) / 2;
      for (let i = 0; i < 8; i++) {
        this.place(); this.camera.updateMatrixWorld();
        if (seen(job) && seen(bit)) break;
        this.sph.r *= 1.25;
      }
    },
    setGhost(on) {
      this.ghost.visible = on;
      this.ghostParts.bed.visible = on;
      if (this.at) this.setTool(this.at);
      if (this.grid) this.grid.visible = !on;   // the bed is the grid when the machine shows (never two grids)
      try { localStorage.setItem('swarf-run-ghost', on ? '1' : '0'); } catch (e) { /* private window */ }
      if (on) this.fitBed(); else this.fit();
    },
    // with the machine shown the camera stands at the gantry and the bed slides through
    fitBed() {
      const c = { x: this.bedAt.x + 1219.2, y: this.bedAt.y + 609.6 };
      this.target.set(this.ghost.visible ? 0 : c.x, c.y, 0);
      this.sph.r = 3000 / Math.tan(this.camera.fov * Math.PI / 360) / 2;
      this.place();
    },
    fit() {
      const b = this.bounds;
      if (!b) { this.target.set(0, 0, 0); this.sph.r = 600; this.place(); return; }
      this.target.set(this.ghost.visible ? 0 : (b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
      const span = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z, 40);
      this.sph.r = span * 1.6 / Math.tan(this.camera.fov * Math.PI / 360) / 2 + 40;
      this.place();
    },
    camTop() { this.sph.ph = 0.001; this.sph.th = -Math.PI / 2; this.fit(); },
    camIso() { this.sph.ph = 0.9; this.sph.th = -Math.PI / 2 + 0.5; this.fit(); }
  };

  // ------------------------------------------------------------ program
  // a job running, paused or stopped partway keeps its program: a new one would change what continue runs
  function jobHeld() { const st = S.machine && S.machine.state; return !!(st && (st.running || st.paused)) || !!S.stoppedAt || !!S.toolChange; }
  // a job stopped partway (not running, paused or in a bit change) may be given up for another file,
  // once the student says so: its continue from line goes
  function refuseLoad(name, again) {
    if (!jobHeld()) return false;
    const st = S.machine && S.machine.state;
    // not while another card is open (a zero step would be wiped), the machine moves or homes, or the
    // link is still down after dropping mid-job (the e-stop advice stays until the machine is back)
    const still = !(st && (st.running || st.paused || st.moving)) && !(S.machine && S.machine.homing) && !S.contHeld;
    const cardOpen = el.sheet && el.sheet.classList.contains('on');
    const linkDown = !!S.lostAt && !(st && st.connected);
    if (again && S.stoppedAt && !S.toolChange && !linkDown && still && !cardOpen) {
      el.card.innerHTML = '';
      const no = h('button', { text: 'not yet', onclick: () => { S.plateWatch = null; S.mr1Watch = null; S.afterZero = null; el.sheet.classList.remove('on'); refresh(); } });
      const go = h('button', { text: `open ${name} instead`, onclick: () => { S.plateWatch = null; S.mr1Watch = null; S.afterZero = null; el.sheet.classList.remove('on'); again(true); } });
      el.card.append(h('h2', { text: `This job stopped at line ${S.stoppedAt}` }),
        h('p', { text: `Open ${name} instead? Continue from line ${S.stoppedAt} goes, and the new file starts from its first line.` }),
        h('div', { class: 'row' }, no, go));
      el.sheet.classList.add('on');
      return true;
    }
    tell('Finish or end this job first: a new file now would change what continue runs.', 'warn');
    return true;
  }
  // given: the student chose to give up the stopped job; its continue line goes once the new file is read
  function readFile(f, given) {
    if (!given && refuseLoad(f.name, ok => readFile(f, ok))) return;
    const r = new FileReader();
    r.onload = () => { if (given) { S.stoppedAt = 0; S.lostAt = 0; } loadProgram(f.name, String(r.result), 'file'); };
    r.onerror = () => tell(`Could not read ${f.name}.`, 'warn');
    r.readAsText(f);
  }

  // The cam toolpaths, made fresh every time (moved parts or changed steps must
  // never reach the machine as old paths). Errors from cam land in the sentence.
  function fromCam() {
    const api = window.kiri && window.kiri.api;
    if (!api || !api.function || !api.function.export) { say('Cam is not ready yet.', 'warn'); return; }
    if (S.machine && S.machine.state.running) return;
    if (S.camBusy) return;
    if (!api.widgets.all().length) { S.camError = 'Nothing to run yet. Make a part, open a file, or try a test cut. Jog and zero work without one.'; refresh(); return; }
    if (!api.widgets.all().some(w => !w.meta.disabled)) { S.camError = 'Every part is left out of this run. Tick the parts to cut in objects.'; refresh(); return; }
    S.camError = ''; S.camBusy = true; refresh();
    const done = msg => { S.camBusy = false; S.camDone = null; if (msg) S.camError = msg; clearTimeout(S.camTimer); refresh(); };
    // cam's event bus has no off(): one listener for good, pointed at the current request
    S.camDone = done;
    if (!S.camErrHooked) {
      S.camErrHooked = true;
      for (const ev of ['preview.error', 'export.error']) api.event.on(ev, e => { if (S.camDone) S.camDone(`The toolpaths could not be made: ${e && e.message ? e.message : e || 'check the steps'}.`); });
    }
    S.camTimer = setTimeout(() => done('The toolpaths took too long to make. Press toolpaths in the step row to see why.'), 120000);
    try {
      if (api.function.clear_progress) api.function.clear_progress();
      api.function.export((text, out) => {
        if (!S.camBusy) return;
        // a failed export says why
        if (text === null && out) { done(`The toolpaths could not be made: ${out.message || out}.`); return; }
        done('');
        if (!text || !/\S/.test(text)) { S.camError = 'No toolpaths were made. Check the steps, then press control.'; refresh(); return; }
        const names = api.widgets.all().filter(w => !w.meta.disabled).map(w => w.meta && w.meta.file).filter(Boolean);
        const base = (names[0] || 'part').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').slice(0, 40);
        // one file per bit (the MR-1): run as one program that stops at each bit change
        const bits = out && out.swarfBitFiles;
        if (bits && bits.length > 1) { loadProgram(base + '.nc', P.joinBitFiles(bits), 'cam'); return; }
        loadProgram(base + (isMR1() ? '.nc' : '.sbp'), text, 'cam');
      });
    } catch (e) {
      done('There are no toolpaths yet. Press toolpaths and add a step, then press control.');
    }
  }

  // ---- preview: the playhead's position, and playing it ----
  // seconds into the program at the end of each move, at the program's own speeds
  function moveTimes() {
    const M = S.prog ? S.prog.parsed.moves : [];
    if (PV.cum && PV.cum.moves === M) return PV.cum;
    const cum = new Float64Array(M.length);
    let t = 0;
    M.forEach((m, i) => { t += Math.hypot(m.x - m.x0, m.y - m.y0, m.z - m.z0) / (m.feed > 0 ? m.feed : 50); cum[i] = t; });
    PV.cum = { moves: M, cum };
    return PV.cum;
  }
  const busy = () => S.machine && (S.machine.state.running || S.machine.state.moving);
  function previewAt(line) {
    view.showUpTo(line);
    el.scrubLabel.textContent = `line ${line}`;
    const M = S.prog ? S.prog.parsed.moves : [];
    if (!M.length || busy()) return;
    let i = M.length - 1;
    while (i > 0 && M[i].line > line) i--;
    const m = M[i];
    view.setTool(m.line > line ? { x: m.x0, y: m.y0, z: m.z0 } : { x: m.x, y: m.y, z: m.z });
  }
  function playStart() {
    const { moves: M, cum } = moveTimes();
    if (!M.length || busy()) return;
    const total = cum[cum.length - 1];
    // from the playhead, or from the top when it is at the end
    const line = +el.scrub.value;
    let i = M.findIndex(m => m.line >= line);
    PV.t = i <= 0 || line >= M[M.length - 1].line ? 0 : cum[i - 1];
    if (PV.t >= total) PV.t = 0;
    PV.last = performance.now();
    el.play.textContent = '❚❚'; el.play.classList.add('on');
    const step = now => {
      if (!S.open || busy()) return playStop();
      PV.t += (now - PV.last) / 1000 * PV.rate; PV.last = now;
      if (PV.t >= total) { PV.t = total; playStop(); }
      // the move under the playhead, and where along it the bit is
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < PV.t) lo = mid + 1; else hi = mid; }
      const m = M[lo], t0 = lo ? cum[lo - 1] : 0, f = cum[lo] > t0 ? Math.min(1, (PV.t - t0) / (cum[lo] - t0)) : 1;
      view.setTool({ x: m.x0 + (m.x - m.x0) * f, y: m.y0 + (m.y - m.y0) * f, z: m.z0 + (m.z - m.z0) * f });
      view.showUpTo(m.line);
      el.scrub.value = String(m.line);
      el.scrubLabel.textContent = `line ${m.line}`;
      if (PV.raf) PV.raf = requestAnimationFrame(step);
    };
    PV.raf = requestAnimationFrame(step);
  }
  function playStop() {
    if (PV.raf) cancelAnimationFrame(PV.raf);
    PV.raf = 0;
    if (el.play) { el.play.textContent = '▶'; el.play.classList.remove('on'); }
  }

  function loadProgram(name, text, source, extra) {
    if (source !== 'cam' && refuseLoad(name, () => { S.stoppedAt = 0; S.lostAt = 0; loadProgram(name, text, source, extra); })) return false;
    // a file or a test cut chosen while cam still makes toolpaths: that request is over
    if (source !== 'cam' && S.camBusy) { S.camBusy = false; S.camDone = null; clearTimeout(S.camTimer); }
    playStop();
    const before = S.prog ? { at: spotOf(), atz: originText().z, bit: S.zBit, src: S.prog.source } : null;
    // cam made the very same toolpaths again: keep the job where it is (a stop, a tool
    // change, the zero), just say so (a round trip to cam keeps the line)
    if (S.prog && source === 'cam' && S.prog.source === 'cam' && S.prog.text === text) { refresh(); return; }
    const parsed = P.parse(text, { machineUnits: 'mm' });
    S.prog = { name, text, parsed, source, ...(extra || {}) };
    // a round trip to cam does not ask for a new zero. The zero is the board's,
    // so a new program keeps it when it zeroes at the same place (corner or center) and the machine
    // has not lost where it is; Z only when the program starts on the bit Z was set with.
    const wasAt = before ? before.at : null, wasBit = before ? before.bit : undefined;
    // only toolpaths made again (cam to cam) keep it with no press; a test cut is often a fresh piece of
    // scrap and another file another job, so those get the one-press button
    const roundTrip = !!(before && before.src === 'cam' && source === 'cam');
    const keepXY = roundTrip && S.zeroXY && !S.zeroLost && !S.lostAt;
    const keepZ = roundTrip && S.zeroZ && !S.zStale && !S.toolChange && !S.zeroLost && !S.lostAt;
    S.hold = null;   // a new program's own first step says what to do, not the last answer
    rememberZero();  // the zero is the board's, not the file's: one press keeps it
    S.zeroXY = S.zeroZ = S.traced = false;
    S.zx = S.zy = false; S.stoppedAt = 0; S.lastDone = null; S.toolChange = null; S.lostAt = 0;
    if (S.zeroAt === undefined && keepXY) S.zeroAt = wasAt;
    const sameAt = !!before && knownSameSpot();
    const kept = [];
    if (sameAt && keepXY) { S.zeroXY = S.zx = S.zy = true; kept.push('X Y'); }
    if (before && originText().z === before.atz && keepZ && cmpBit(wasBit, bitAt(parsed, 1)) === 'same') { S.zeroZ = true; S.zBit = bitAt(parsed, 1); kept.push('Z'); }
    // a kept zero is an assumption about the shop, not a measurement: said as one,
    // and it stays on the plan with a way to drop the half that is no longer true
    S.keptZero = kept.length ? { xy: kept.includes('X Y'), z: kept.includes('Z') } : null;
    if (kept.length && el.say) tell(`Using the earlier zero (${kept.join(' and ')}): right only if the board and the bit have not moved. Trace this file once before you cut.`);
    el.fileName.textContent = source === 'cam' ? `from toolpaths: ${name}` : source === 'lesson' ? `test cut: ${name}` : `${name} (from other software)`;
    el.empty.style.display = parsed.moves.length ? 'none' : '';
    view.load(parsed);
    view.upTo = undefined; view.doneLine = 0;
    const maxLine = parsed.moves.length ? parsed.moves[parsed.moves.length - 1].line : 0;
    el.scrub.max = String(maxLine); el.scrub.value = String(maxLine);
    el.scrubLabel.textContent = maxLine ? `line ${maxLine}` : '';
    el.fromLine.max = String(maxLine);
    renderPlan();
    refresh();
  }

  // What the program asks of the student, in their terms.
  function originText() {
    const b = S.prog && P.cutBounds(S.prog.parsed);
    if (S.prog && S.prog.origin) return S.prog.origin;     // a test cut names its own (swarf-lessons.js)
    if (!b) return { xy: 'X 0, Y 0', z: 'Z 0' };
    // a board size set in cam (or written in the file's head): X 0, Y 0 is on that board, wherever the cut sits in it
    const board = boardOf();
    if (board) return { xy: board.center ? 'the center of your board' : 'the front-left corner of your board', z: 'the top of your board' };
    const near = (v, w) => Math.abs(v) <= Math.max(10, w * 0.03);   // an outline's path sits a bit's radius outside the stock
    const w = b.max.x - b.min.x, d = b.max.y - b.min.y;
    let xy;
    if (near(b.min.x, w) && near(b.min.y, d)) xy = 'the front-left corner of your board';   // the poster's words
    else if (near((b.min.x + b.max.x) / 2, w) && near((b.min.y + b.max.y) / 2, d)) xy = 'the center of your board';
    else xy = `the point your file calls X 0, Y 0 (the cut spans X ${spanWords(b.min.x, b.max.x)}, Y ${spanWords(b.min.y, b.max.y)} ${unitWord()})`;
    // cuts reaching below zero from no higher than a safe height start on the board's top (plunges
    // start at the 5 mm z clearance)
    const z = b.max.z <= 26 && b.min.z < 0 ? 'the top of your board' : b.min.z >= -0.5 ? 'the table under your board' : 'where your file puts Z 0';
    return { xy, z };
  }

  // what cam's parts leave loose when the outline cuts through: the same rule as cam's concerns
  function looseWords() {
    const out = [];
    try {
      const a = window.kiri && window.kiri.api, audit = window.__swarfAutoTabs && window.__swarfAutoTabs.audit;
      if (!a || !audit) return out;
      const proc = a.conf.get().process || {};
      const outl = (proc.ops || []).filter(o => o && (o.type === 'outline' || o.type === 'rough') && !o.disabled);
      if (!outl.length || proc.camZBottom > 0 || proc.camStockIndexed) return out;
      // a rough down to the part's bottom frees it as an outline does (a rough-only circle)
      const outer = outl.some(o => !o.inside), holes = outl.some(o => !o.omitthru && !o.omitvoid);
      for (const w of a.widgets.all()) {
        if (w.track.synth || w.meta.disabled) continue;
        const name = a.platform.part_name ? a.platform.part_name(w) : (w.meta && w.meta.file || 'a part').replace(/\.[^.]+$/, '');
        const r = audit(w);
        if (outer && r.outerTabs === 0) out.push(`${name} is cut free with no tabs: the bit can throw it on the last pass. Add tabs in cam (tabs › auto tabs) or screw it down clear of the bit.`);
        const loose = holes ? r.loose.filter(h => h.tabs === 0).length : 0;
        if (loose) out.push(`${loose} piece${loose === 1 ? '' : 's'} inside ${name} ${loose === 1 ? 'is' : 'are'} cut free with no tab and can fly. Add tabs in cam, or screw ${loose === 1 ? 'it' : 'each one'} to the spoilboard where the bit does not go. Never reach in while the router turns.`);
      }
    } catch (e) { /* cam not ready */ }
    return out;
  }

  function problems() {
    if (S.prMemo) return S.prMemo;     // inside one refresh
    const out = { block: [], warn: [] };
    if (!S.prog) return out;
    const p = S.prog.parsed;
    if (!p.moves.length) out.block.push('The file has no moves swarf can read.');
    // a file that never says (no G20/G21, no IN/MM): read as millimeters, and said so, with its size
    // (an inch file read as millimeters would cut 25.4 times too small)
    if (p.unitsGuessed) {
      const gb = P.cutBounds(p);
      out.warn.push(`This file does not say inches or millimeters, so swarf reads it as millimeters${gb ? `: ${(gb.max.x - gb.min.x).toFixed(0)} × ${(gb.max.y - gb.min.y).toFixed(0)} mm` : ''}. If it was made in inches it would cut 25.4 times too small: check the size before you cut.`);
    }
    if (p.units === 'in') out.warn.push('Written in inches: swarf turns every move into millimeters (1 in = 25.4 mm). The checklist shows the size in both.');
    else if (p.units !== 'mm') out.block.push(`This file's units (${p.units}) are not inches or millimeters.`);
    // from cam: a part, or a piece inside a hole, the outline cuts free with no tab
    if (S.prog.source === 'cam') for (const line of looseWords()) out.warn.push(line);
    // a file opened on its own: cam's parts are not here to ask, so read what swarf
    // wrote into the file when it was saved; with no such lines, say what swarf cannot know
    else if (S.prog.source !== 'lesson') {
      const notes = fileNotes(S.prog.text);
      if (notes.saved) for (const c of notes.concerns) out.warn.push(`When this file was saved, swarf said: ${c}`);
      else out.warn.push('This file comes from outside swarf\'s toolpaths, so swarf cannot see what holds each part down. Before you cut, find out how every part that comes free is held: tabs, screws, or a fixture.');
    }
    const b = P.cutBounds(p);
    const L = isMR1() ? mr1Limits() : M.LIMITS;
    // Z: the file's whole rise and fall within the axis' travel, and a word on deep cuts and on
    // rapids into the board (a rapid crossing into the board blocks)
    const all = P.boundsOf(p.moves);
    if (all) {
      const span = all.max.z - all.min.z, travel = L.z[1] - L.z[0];
      if (span > travel - 25) out.block.push(`The file moves Z over ${prose(span, 0)}, more than the Z axis travels (${prose(travel - 25, 0)} to work with). Check the file's Z numbers.`);
      else if (all.max.z > 150) out.warn.push(`The file lifts the bit ${prose(all.max.z, 0)} above zero: check it clears the top of the Z axis.`);
    }
    if (b && b.min.z < -38.1) out.warn.push(`The cut goes ${prose(-b.min.z)} deep, more than most router bits reach (${inch() ? '1 1/2 in' : '38 mm, 1 1/2 in'}). Check the file and that the bit is long enough.`);
    if (b && b.min.z < 0) {
      const dive = P.rapidAcross(p), down = P.rapidDown(p);
      if (dive) out.block.push(`Line ${dive.line}: a rapid move goes across below the top of the board (Z ${Math.min(dive.z, dive.z0).toFixed(1)}): at rapid speed through the wood. Make the toolpaths again and export a new file.`);
      if (down) out.warn.push(`Line ${down.line}: a rapid move comes straight down to Z ${down.z.toFixed(1)}, below the top of the board. That is fine over a thinner part on the bed, not over the board: check the file.`);
    }
    // a bit fed into the board with the router off breaks: the file's own switches, read in order
    const dead = P.routerOffCut(p);
    if (dead) out.block.push(`Line ${dead.line}: this file feeds the bit into the board with the router off${dead.afterChange ? ', after a bit change that never turns it back on' : ''}. Make the toolpaths again and export a new file.`);
    // the table's corner known (table corners card): the job must sit on the table from this zero
    const c = S.machine && S.machine.mabs && corner();
    if (b && c && S.zeroXY) {
      const T = tableSize(), ma = S.machine.mabs(), pos = S.machine.state.pos;
      const x0 = b.min.x + ma.x - pos.x - c.x, y0 = b.min.y + ma.y - pos.y - c.y, x1 = x0 + b.max.x - b.min.x, y1 = y0 + b.max.y - b.min.y;
      if (x0 < -2 || y0 < -2 || x1 > T.x + 2 || y1 > T.y + 2) out.block.push(`From this zero the cut runs off the table (X ${spanWords(x0, x1)}, Y ${spanWords(y0, y1)} ${unitWord()} from its front-left corner). Zero somewhere else.`);
    }
    // Z zero on the table, not the board: every safe height would sit in the board
    if (window.SwarfRunPlan && window.SwarfRunPlan.validate(p).some(v => v.k === 'table-zero')) out.block.push('Every cut in this file is above Z 0, so it was made with Z zero on the table. swarf zeros Z on the top of your board: make the file again with Z zero on the top of the material (in VCarve: Job Setup, Z Zero, Material Surface).');
    // any line swarf can't carry out exactly blocks the run: skipping
    // one can start every move after it from the wrong place
    const mover = p.unsupported[0];
    if (mover) out.block.push(`Line ${mover.line} is something swarf can't carry out exactly ("${mover.text.slice(0, 40)}"${mover.why ? `: ${mover.why}` : ''})${p.unsupported.length > 1 ? `, and ${p.unsupported.length - 1} more` : ''}. Skipping it could start the moves after it from the wrong place, so swarf won't run this file. Make it again from swarf's toolpaths, or without that line.`);
    // the card cannot step slower than this (a 16-bit tick at its clock): a slower feed would run faster
    // per move, from its own steps: a diagonal's floor is higher than an axis's
    const T = 7372800 / 65536, U = { x: 72.183661, y: 72.183661, z: 90.229567 };
    const floorOf = m => { const L = Math.hypot(m.x - m.x0, m.y - m.y0, m.z - m.z0), st = Math.max(Math.abs(m.x - m.x0) * U.x, Math.abs(m.y - m.y0) * U.y, Math.abs(m.z - m.z0) * U.z); return st >= 1 ? T * L / st : 0; };
    const slow = !isMR1() && p.moves.find(m => !m.rapid && m.feed > 0 && m.feed < floorOf(m) * 1.02);
    if (slow) out.block.push(`Line ${slow.line} asks for ${rateWords(slow.feed * 60)}, slower than the machine can step smoothly in that direction (${rateWords(Math.ceil(floorOf(slow) * 60 * 1.02))}). It would run faster than asked. Raise that feed and make the toolpaths again.`);
    if (b) {
      const w = b.max.x - b.min.x, d = b.max.y - b.min.y;
      if (w > L.x[1] - L.x[0] || d > L.y[1] - L.y[0]) out.block.push(`The cut is ${lens([w, d], inch() ? 2 : 0)}, bigger than the table.`);
    }
    for (const w of p.warnings) if (!/units|inches|millimeters/.test(w.text)) out.warn.push((w.line ? `line ${w.line}: ` : '') + w.text);
    return out;
  }

  // the student says what moved: that half of the kept zero goes, and is not offered back
  function dropKept(which) {
    if (!S.keptZero || (S.machine && S.machine.state.running)) return;
    if (which === 'xy') { S.zeroXY = S.zx = S.zy = false; S.keptZero.xy = false; S.zeroAt = undefined; }
    else { S.zeroZ = false; S.keptZero.z = false; S.zBit = undefined; }
    S.traced = false;
    if (S.zeroHad) S.zeroHad = { ...S.zeroHad, [which]: false };
    S.zeroSavedAt = 0; saveZero();
    tell(which === 'xy' ? 'X Y forgotten: zero X Y on the board as it is now.' : 'Z forgotten: zero Z on the top of the board with this bit.', 'warn');
    renderPlan(); refresh();
  }

  // the setup lines the export writes at the top of a file (export.js swarfFileNote): whether swarf
  // saved it, and the concerns still open then
  // the board the file was made for: cam's board size for toolpaths from cam, else the file's own head line
  function boardOf() {
    if (!S.prog) return null;
    if (S.prog.source === 'cam') {
      try {
        const p = window.kiri.api.conf.get().process;
        return p.swarfBoardOn && p.swarfBoardX > 0 && p.swarfBoardY > 0 && p.swarfBoardZ > 0 ? { x: p.swarfBoardX, y: p.swarfBoardY, z: p.swarfBoardZ, center: !!p.camOriginCenter } : null;
      } catch (e) { return null; }
    }
    return fileNotes(S.prog.text).board || null;
  }
  function fileNotes(text) {
    const head = String(text || '').split(/\r?\n/, 120);
    const out = { saved: false, concerns: [] };
    let more = false;
    for (const l of head) {
      const bm = l.match(/^\s*(?:'|;|\()\s*swarf board:\s*([\d.]+) x ([\d.]+) x ([\d.]+) mm, X 0 Y 0 at its (center|front-left corner)/i);
      if (bm) { out.board = { x: +bm[1], y: +bm[2], z: +bm[3], center: /center/i.test(bm[4]) }; continue; }
      // a concern's title, then its hint (swarf hint:), each wrapped onto swarf more: lines
      const m = l.match(/^\s*(?:'|;|\()\s*swarf (saved|concern|hint|more):\s*(.*?)\)?\s*$/i);
      if (!m) continue;
      const key = m[1].toLowerCase(), last = out.concerns.length - 1;
      if (key === 'saved') { out.saved = true; more = false; continue; }
      if (key === 'concern') { out.saved = true; more = true; if (m[2]) out.concerns.push(m[2]); else more = false; continue; }
      if (!more || last < 0 || !m[2]) continue;
      out.concerns[last] += key === 'hint' ? ` - ${m[2]}` : ` ${m[2]}`;
    }
    return out;
  }

  function renderPlan() {
    el.plan.innerHTML = '';
    if (!S.prog) return;
    const p = S.prog.parsed, b = P.cutBounds(p);
    const add = (t, cls) => el.plan.append(h('div', { class: cls || '', text: t }));
    // the bit's path, not the part: an outline runs a bit's radius outside it, so a 100 mm disc reads
    // about 106 here, and that is right (never resize the part to get back to 100)
    el.facts.textContent = b ? `bit's path ${lens([b.max.x - b.min.x, b.max.y - b.min.y], 0)} · ${len(-Math.min(0, b.min.z))} deep · about ${mins(p.seconds)}` : '';
    el.facts.title = 'Where the bit\'s center goes: half a bit outside an outline';
    const pr = problems();
    if (!pr.block.length) add(`${p.unitsGuessed ? '? units not named, read as millimeters' : p.units === 'in' ? '✓ inches, turned into millimeters' : '✓ millimeters'} · ✓ small enough for the machine · ✓ ${p.moves.length} moves read`, 'ok');
    if (b && S.prog.source === 'cam') add('the size above is the bit\'s path: an outline runs half a bit outside the part, so leave the part as it is.');
    // where it lands is a second check, and it needs the table's corner and an X Y zero
    if (b && !pr.block.some(x => /runs off the table|bigger than the table/.test(x))) {
      const known = !!(S.machine && S.machine.mabs && corner());
      if (!S.zeroXY) add('where it lands on the table: not checked until X Y is zeroed');
      else if (isGrbl()) add('where it lands: every move is checked against the MR-1\'s travel before it runs');
      else if (!known) add('where it lands on the table: not checked (swarf does not know the table\'s corner: table corners)');
      else add('✓ on the table from this zero', 'ok');
    }
    // the kept zero, until it is zeroed again
    const kz = S.keptZero, kxy = !!(kz && kz.xy && S.zeroXY), kzz = !!(kz && kz.z && S.zeroZ);
    if (kxy || kzz) {
      el.plan.append(h('div', { class: 'w sr-kept' }, `using the earlier zero (${kxy && kzz ? 'X Y and Z' : kxy ? 'X Y' : 'Z'}${zeroWords(kxy, kzz)}): right only if nothing moved `,
        kxy ? h('button', { text: 'the board moved', title: 'Forget the X Y zero, then zero it again here', onclick: () => dropKept('xy') }) : null,
        kzz ? h('button', { text: 'the bit was changed or reseated', title: 'Forget the Z zero, then zero it with this bit', onclick: () => dropKept('z') }) : null));
    }
    const t = fileTools();
    if (t.names.length) add(`bit  ${t.names.join(', then ')}`);
    if (t.rpm.length) add(isMR1() ? `spindle  ${t.rpm.map(r => `${r.toLocaleString()} rpm`).join(', then ')}` : `router  ${t.rpm.map(dialFor).join(', then ')}`);
    const changes = p.events.filter(e => e.kind === 'tool-change');
    if (changes.length > 1) add(`${changes.length} tool changes: at each one the bit stops ${len(CHANGE_Z, 0)} up with the router off; change it, zero Z again, then continue`, 'w');
    for (const x of pr.block) add(x, 'b');
    for (const x of pr.warn) add(x, 'w');
  }

  // seconds left in the running program, from its moves at their feeds (rapids at the jog speed)
  function timeLeft() {
    const mv = S.runMoves;
    if (!mv || !mv.length || !S.machine) return 0;
    if (S.runTimes !== mv) {
      const c = S.machine.cfg || {}, jog = (c.rapid && c.rapid.xy) || (c.jog && c.jog.xy) || 100;
      let t = 0; S.runCum = mv.map(m => (t += Math.hypot(m.x - m.x0, m.y - m.y0, m.z - m.z0) / ((m.rapid ? jog : m.feed) || jog)));
      S.runTimes = mv;
    }
    const total = S.runCum[S.runCum.length - 1], done = S.runCum[Math.max(0, (S.runIdx || 0) - 1)] || 0;
    return Math.max(0, total - done) / (((S.machine.state && S.machine.state.rate) || 100) / 100);
  }

  function mins(s) {
    if (!s) return '—';
    if (s < 90) return `${Math.round(s)} s`;
    const m = Math.round(s / 60);
    return m < 90 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  }

  // ------------------------------------------------------------ steps
  // the job from cam is out of date while its toolpaths are made again, or when that failed: it stays on
  // the screen but nothing runs it (for those seconds it must not read as ready)
  function stale() { return S.camBusy || !!(S.camError && S.prog && S.prog.source === 'cam'); }
  function stepNow() {
    if (!S.prog || !S.prog.parsed.moves.length || stale()) return 'load';
    if (problems().block.length) return 'check';
    if (!S.zeroXY || !S.zeroZ) return 'zero';
    if (!S.traced) return 'trace';
    return 'cut';
  }

  // what a run waits for, in order: each with its plain words and the control that does it
  function needs(st, ready) {
    const real = st && st.kind !== 'sim';
    return [
      { k: 'conn', label: real || !st ? 'connected' : 'connected (simulator)', ok: !!(st && st.connected), todo: isMR1() ? 'plug in the MR-1\'s USB cable and press connect' : 'plug in the ShopBot and press connect' },
      // the MR-1 restarts on every connect and knows nothing of where it is until it homes
      ...(isGrbl() ? [{ k: 'home', label: 'homed', ok: !!(st && st.homed), todo: st && st.refused ? st.refused : 'press home: the MR-1 finds its corner after every connect' }] : []),
      { k: 'fault', label: 'all clear', ok: !S.fault, todo: S.fault ? `${S.fault}: check the machine, then press all clear` : '' },
      { k: 'busy', label: 'machine still', ok: !st || !st.connected || ready, todo: 'wait for the machine to stop moving' },
      { k: 'prog', label: 'a program', ok: !!(S.prog && S.prog.parsed.moves.length) && !stale(), todo: S.camBusy ? 'wait for the toolpaths to finish' : S.camError && S.prog ? S.camError : 'make a part in cam and press control, or open a file' },
      { k: 'file', label: 'file checked', ok: !!S.prog && !problems().block.length, todo: (S.prog ? problems().block[0] || 'fix the file' : 'load a file, or bring the toolpaths from cam').replace(/\.$/, '') },
      // the zero never stops trace, air cut or cut:
      // it is shown here as a step to do, and the cut card says when it is not set
      { k: 'xy', label: 'X Y zeroed', opt: true, ok: !!S.zeroXY, todo: S.zeroHad && S.zeroHad.xy && zeroFresh(S.zeroSetAt) && !S.zx && sameSpot() ? 'press "use the zero from" if the board has not moved, or jog over your X 0, Y 0 and press zero x y' : 'jog the bit over your X 0, Y 0 and press zero x y' },
      { k: 'z', label: 'Z zeroed', opt: true, ok: !!S.zeroZ, todo: S.zeroHad && S.zeroHad.z && zeroFresh(S.zeroSetAt) && sameBit() ? 'press "use the zero from", or zero Z again' : isGrbl() ? 'lower the bit onto paper and press zero z' : 'press z plate, or lower the bit onto paper and press zero z' },
      // the trace is the protocol, not physics: cut
      // goes ahead without it, after one more tick on its card (askCut); the rest above never skip
      { k: 'trace', label: 'traced', opt: true, ok: !!S.traced, todo: 'press trace and watch it clear the clamps, or cut without it' }
    ].filter(n => n.k !== 'busy' || !n.ok);
  }
  function flashNeed(k) {
    const first = k || ((needs(S.machine && S.machine.state, true).find(n => !n.ok)) || {}).k;
    const b = { conn: el.connBtn, home: el.homeBtn, xy: el.zxyBtn, z: el.plateBtn && el.plateBtn.style.display !== 'none' ? el.plateBtn : el.zzBtn, prog: el.start, trace: el.btn.trace }[first];
    if (!b || !b.animate) return;
    b.animate([{ boxShadow: '0 0 0 0 rgba(242,237,228,0)' }, { boxShadow: '0 0 0 6px rgba(242,237,228,.6)' }, { boxShadow: '0 0 0 0 rgba(242,237,228,0)' }], { duration: 700, iterations: 2 });
  }

  // problems() rescans every move and every widget: worked out once a refresh, not 4-6 times.
  // Nothing a refresh runs changes the file, the zero or the position, and the memo ends with it.
  function refresh() {
    S.prMemo = null;
    S.prMemo = problems();
    try { return refreshOnce(); } finally { S.prMemo = null; }
  }
  function refreshOnce() {
    const st = S.machine ? S.machine.state : null;
    const now = stepNow();
    const idx = STEPS.indexOf(now);
    for (const node of el.steps.children) {
      const i = STEPS.indexOf(node.dataset.step);
      node.className = 'sr-step' + (i < idx ? ' done' : i === idx ? (now === 'check' ? ' blocked' : ' now') : '');
    }
    const running = st && st.running;
    // commands still on their way to the machine count as busy: nothing new starts until they land
    const ready = st && st.connected && !st.queued && !(st.kind === 'sim' && st.moving);
    el.jog.classList.toggle('locked', !!running);
    // the ShopBot not connected: everything that needs it greys out; the simulator keeps them
    const offline = isReal() && !(st && st.connected);
    el.jog.classList.toggle('offline', offline);
    for (const b of [el.btn.trace, el.btn.air, el.btn.cut]) if (b) b.classList.toggle('offline', offline);
    // a job on the machine (running or paused) keeps control: cam's steps look asleep
    document.body.classList.toggle('swarf-run-busy', !!running && S.open);
    window.__swarfRunBusy = !!running || !!(st && st.paused) || !!S.stoppedAt || !!S.toolChange;
    // what trace, in the air and cut wait for, each one named; a waiting button still takes the
    // press and says why it waits
    const need = needs(st, ready);
    const testWhy = need.filter(n => !n.ok && !n.opt).map(n => n.todo);
    const cutWhy = need.filter(n => !n.ok && !n.opt).map(n => n.todo);
    const wait = (b, list, word, title) => {
      b.disabled = !!running || offline;
      b.classList.toggle('wait', !running && list.length > 0);
      b.dataset.why = list.length ? `${word} needs: ${list.join(', then ')}.` : '';
      b.title = list.length ? b.dataset.why : title;
    };
    wait(el.btn.trace, testWhy, 'Trace', `Run the rectangle the cut fills, ${up()} up, ${spindleWord()} off`);
    wait(el.btn.air, testWhy, 'An air cut', `Run the whole file above your board, ${spindleWord()} off`);
    wait(el.btn.cut, cutWhy, 'Cut', `Cut the file: the ${spindleWord()} starts`);
    el.fromBtn.disabled = running || cutWhy.length > 0;
    el.fromBtn.title = cutWhy.length ? `Continue needs: ${cutWhy.join(', then ')}.` : `Up to ${up()}, over, then cut from this line on`;
    el.need.innerHTML = '';
    // the next thing to do and why, pinned above each panel that scrolls
    const nextNeed = !running && need.find(n => !n.ok);
    el.next.textContent = nextNeed ? `next: ${nextNeed.todo}` : '';
    el.next.style.display = nextNeed ? '' : 'none';
    if (!running && need.some(n => !n.ok)) {
      el.need.append(h('b', { text: 'to run:' }));
      for (const n of need) el.need.append(h('span', { class: n.ok ? 'ok' : 'no', text: (n.ok ? '✓ ' : '○ ') + n.label + (n.opt && !n.ok ? ' (or skip it)' : ''), title: n.ok ? '' : n.todo, onclick: n.ok ? null : () => { tell(`${n.todo[0].toUpperCase()}${n.todo.slice(1)}.`, 'warn'); flashNeed(n.k); } }));
    }
    // a finished cut: the steps read done, cut goes quiet, and the box offers what comes next
    const finished = !running && (S.lastDone === 'cut' || S.lastDone === 'from') && !S.stoppedAt;
    if (finished) for (const node of el.steps.children) node.className = 'sr-step done';
    el.btn.cut.classList.toggle('quiet', finished);
    el.start.style.display = !S.prog || finished ? '' : 'none';
    // after a test cut, "measure it" waits where the student looks
    if (el.measure) el.measure.style.display = finished && S.prog && S.prog.source === 'lesson' ? '' : 'none';
    // Z's keys as the keyboard names them: fn + arrows on a Mac, Page Up / Page Down elsewhere
    const zKeys = /Mac/i.test(navigator.platform || navigator.userAgent) ? 'fn ↑ ↓  Z' : 'PgUp PgDn  Z';
    if (el.keys) el.keys.textContent = running ? 'any key pauses   ·   emergency: the red e-stop on the floor' : `← → ↑ ↓  X Y   ·   ${zKeys}   ·   space stops${S.jogStep === 'cont' && !(S.machine && S.machine.limitsKnown && S.machine.limitsKnown()) ? '   ·   continuous: no end stops, let go in time' : ''}`;
    // the links stand in for the button row, never beside it (never two "a test cut" after a finish)
    const startShown = !S.prog || finished;
    el.otherFile.style.display = S.prog && !startShown && !jobHeld() ? '' : 'none';
    el.lessonLink.style.display = S.prog && !startShown && !jobHeld() ? '' : 'none';
    el.fromCam.style.display = S.prog && S.prog.source === 'cam' ? '' : 'none';
    // the control that does the next thing is lit
    const first = need.find(n => !n.ok);
    el.connBtn.classList.toggle('next', !!(first && first.k === 'conn'));
    el.zxyBtn.classList.toggle('next', !!(first && first.k === 'xy') && !running);
    el.fromRow.style.display = S.stoppedAt ? '' : 'none';
    el.fromBtn.textContent = `continue from line ${el.fromLine.value}`;
    // go-to buttons always there, greyed until that zero is set;
    // a saved zero only counts once kept ("use the zero you set")
    const okXY = !!(S.zeroXY && S.zeroSetAt), okZ = !!(S.zeroZ && S.zeroSetAt);
    el.goXY.disabled = !okXY || !!running; el.goZ.disabled = !okZ || !!running;
    el.goXY.title = okXY ? 'Up, then over to X 0, Y 0' : 'Zero X Y first (or press "use the zero from")';
    el.goZ.title = okZ ? `Down to ${goZword()} above Z 0, slowly` : 'Zero Z first (z plate, or zero z)';
    el.goZ.textContent = `go to ${goZword()} above z 0`;
    el.strip.classList.toggle('on', !!running && !(st && st.paused));
    el.btn.trace.classList.toggle('next', now === 'trace' && !running);
    el.btn.pause.disabled = !running;
    // stop shows whenever anything moves (a jog, a go-to, homing, a plate seek), not only a job
    const moving = !running && !!((st && st.moving) || (S.machine && S.machine.homing) || S.contHeld);
    for (const k of ['trace', 'air', 'cut']) el.btn[k].style.display = running || moving ? 'none' : '';
    el.btn.pause.style.display = running ? '' : 'none';
    el.btn.stop.style.display = running || moving ? '' : 'none';
    el.btn.pause.textContent = st && st.paused ? 'resume' : 'pause';
    el.btn.stop.disabled = !st;
    el.fromCam.disabled = !!running;
    el.fromCam.title = running ? 'Not while the job runs: stop it first' : 'Make the toolpaths again and bring them here';
    // "same zero as last time": only a zero set in this session, offered when a new file needs one
    // never after a bit change: the saved Z belongs to the old bit
    // and only before either zero is set again: never in the middle of setting them
    // after a reconnect the offer stands with no file loaded too: the zero was the machine's, not the file's
    // a zero once set is offered back: any file, a test cut, after a reload;
    // never after a bit change (its Z is the old bit's) or a count that jumped (the box restarted)
    // one plain way to confirm the zero from almost any situation: the
    // button stands whenever some of the saved zero can come back (X Y, or Z unless a bit change made
    // it the old bit's); never halfway through zeroing X and Y by hand, never while a job runs
    const backXY = !!(S.zeroHad && S.zeroHad.xy && !S.zeroXY && sameSpot()), backZ = !!(S.zeroHad && S.zeroHad.z && !S.zeroZ && sameBit());
    const offer = zeroFresh(S.zeroSetAt) && (backXY || backZ) && S.zx === S.zy && !running
      && (!isDirect() || (S.machine.state && S.machine.state.connected))
      // the MR-1: only once homed on this connection, and only the half whose G54 the board still holds
      && (!isGrbl() || !!(st && st.connected && st.homed && S.g54ok && ((backXY && S.g54ok.xy) || (backZ && S.g54ok.z))));
    el.keepZero.style.display = offer ? '' : 'none';
    if (offer && S.zeroReconnect) el.keepZero.textContent = `use the zero from ${zeroWhen(S.zeroSetAt)}? Only if the board and the machine have not moved since ${S.discWhy || (S.discAt ? 'you disconnected' : 'the link dropped')}${S.discAt ? '' : ', then trace to check it'}`;
    else if (offer) el.keepZero.textContent = `use the zero from ${zeroWhen(S.zeroSetAt)} (${backXY && backZ ? 'X Y and Z' : backXY ? 'X Y' : 'Z'})? Only if this board has not moved since then${zeroWords(backXY, backZ)}`;
    // the plan's checks follow the zero (never "fits the table" when it no longer does)
    const sig = S.prog ? problems().block.join('|') + `|${!!S.zeroXY}${!!S.zeroZ}${!!(S.keptZero && S.keptZero.xy)}${!!(S.keptZero && S.keptZero.z)}|${S.zeroAt}|${S.zBit ? (S.zBit.name || S.zBit.num) : ''}${!!(S.machine && S.machine.mabs && corner())}` : '';
    if (sig !== S.planSig) { S.planSig = sig; renderPlan(); }
    // a latched fault sounds, softly and again every few seconds, until all clear (real machine only)
    if (window.SwarfSound) { const want = !!S.fault && isReal(); if (want !== SwarfSound.faulting()) SwarfSound.fault(want); }
    coach(now, st);
  }

  function coach(now, st) {
    // an answer to a press stays a few seconds: the machine's state updates would wipe it at once
    if (S.hold && Date.now() < S.hold.until && (S.hold.running || !(st && st.running))) return say(S.hold.text, S.hold.cls);
    if (S.fault && !(st && (st.running || st.routerUnknown))) return say(`${S.fault[0].toUpperCase()}${S.fault.slice(1)}. Check the machine, then press all clear in the line under the buttons. Jogs still work, to lift the bit clear.`, 'bad');
    if (st && st.routerUnknown) return say(`${S.lostAt ? `The USB link dropped at line ${S.lostAt}. ` : ''}swarf can't tell whether the router is still on: press the red e-stop on the floor and wait until the bit has stopped turning. Then plug in and press connect${S.lostAt ? `; continue from line ${S.lostAt} after` : ''}.`, 'bad');
    if (S.connMsg && (!st || st.kind === 'sim' || !st.connected)) return say(S.connMsg, 'bad');
    if (isGrbl() && st.connected && st.refused) return say(`${st.refused}.`, 'bad');
    if (st && st.dialog) return say(`The file asks: ${st.dialog.caption || st.dialog.message}`, 'warn');
    if (st && st.running) {
      const total = S.prog ? S.prog.parsed.lines : 0;
      const what = { trace: `Tracing the rectangle the cut fills, ${up()} up, ${spindleWord()} off`, air: `Running an air cut, ${spindleWord()} off`, cut: 'Cutting', from: 'Cutting', preview: 'Previewing' }[S.job] || 'Running';
      const left = timeLeft();
      const where = left ? `, about ${mins(left)} left` : '';
      if (isGrbl()) {
        // the MR-1's own pause stops the spindle; a hold from the machine's button leaves it turning
        if (st.paused) return say(`${what}: paused, ${({ off: 'spindle off', idle: 'spindle off', unsure: 'the spindle may still be turning', starting: 'the spindle starting', turning: 'the spindle still turning' })[st.spin] || 'spindle stopping'}.`, 'warn');
        return say(`${what}${where}. Stay at the machine. Any key pauses it while swarf is in front (the bit held, then the spindle stopped); that is not an emergency stop. In an emergency, press the MR-1's e-stop.`);
      }
      if (st.paused) return say(`${what}: paused, router off. Press resume to go on, or end the job.`, 'warn');
      return say(`${what}${where}. Stay at the machine. Any key pauses it while swarf is in front (router off, bit held); that is not an emergency stop. ${(window.SwarfSafetyWords || {}).emergency || 'In an emergency, step on the red e-stop on the floor.'}`);
    }
    if (st && !st.connected && st.estopped) return say(`The e-stop stopped the machine${S.stoppedAt ? ` at line ${S.stoppedAt}` : ''}, and swarf let go of it. When everything has stopped and the machine is safe, press connect.`, 'bad');
    if (st && !st.connected && S.lostAt) return say(isGrbl() ? `The USB link dropped at line ${S.lostAt}. The MR-1 may finish the moves it already has, with the spindle on: press its e-stop. Plug in, press connect, home, then continue from line ${S.lostAt}.` : `The USB link dropped at line ${S.lostAt}. If the machine is still moving or the router still turns, press the floor e-stop. Plug in, press connect, then continue from line ${S.lostAt}.`, 'bad');
    if (st && !st.connected && isGrbl()) return say(`Not connected: ${st.note}. Plug the MR-1's USB cable into this computer and press connect.`, 'bad');
    if (st && !st.connected && isMR1()) return say('Not connected. Plug the MR-1 into this computer and press connect.', 'bad');
    // connected and not homed: nothing on the MR-1 moves or zeroes before it finds its corner
    if (isGrbl() && st.connected && !st.homed) return say(st.homing || S.machine.homing ? 'Homing: the MR-1 runs to its switches. Any key stops it.' : 'Press home: the MR-1 finds its corner after every connect. Machine check shows what it reports first; nothing moves there.');
    const win = onWindows() ? ` ${WIN_ONE}` : '';
    if (st && !st.connected && M.DirectMachine && S.machine instanceof M.DirectMachine) return say(`Not connected: ${st.note}. Plug the box's USB cable into this computer and press connect.${win}`, 'bad');
    if (st && !st.connected) return say(`Not connected. Plug the ShopBot into this computer and press connect.${win}`, 'bad');
    const o = originText();
    switch (now) {
      case 'load': return say(S.camBusy ? 'Making the toolpaths…' : S.camError || 'No toolpaths yet. Add a step to your part (rough, contour, outline, pocket), then press control.');
      case 'check': return say(problems().block[0], 'bad');
      case 'zero':
        // two lines at 1280 in every skin: the status never pushes the page down
        if (S.toolChange) return say(`${S.toolChange} The router is off (leave its own switch on), the bit ${len(CHANGE_Z, 0)} up. Once it has stopped turning, change it, zero Z, then continue from line ${S.stoppedAt}.`, 'warn');
        if (S.zeroLost) return say('The box lost its position while it was unplugged. Zero X Y and Z again before you go on.', 'warn');
        // the step names follow the units: the jog's steps are 0.01 / 0.1 / 1 / 2 in, or 0.1 / 1 / 10 mm
        const [stepNear, stepFine] = inch() ? ['0.1', '0.01'] : ['1', '0.1'];
        if (!S.zeroXY) return say(`Jog the bit over ${o.xy}, then press zero x y. Hold an arrow to get close, then use step ${stepNear}.`);
        if (/top/.test(o.z) && isGrbl()) return say(`Now Z, on ${o.z}: lower the bit (step ${stepNear}, then ${stepFine}) onto paper until it just drags, then press zero z.`);
        if (/top/.test(o.z)) return say(`Now Z, on ${o.z}: press z plate. Or lower the bit (step ${stepFine}) onto paper until it just drags, then press zero z.`);
        return say(`Lower the bit to ${o.z} (step 1, then 0.1) onto paper until it just drags, then press zero z.`);
      case 'trace': return say(`Press trace: the bit runs around your cut, ${up()} up, ${spindleWord()} off. Watch it clear every screw and clamp.`);
      case 'cut':
        if (S.lostAt) return say(`The USB link dropped at line ${S.lostAt}. If the machine is still moving or the router still turns, press the floor e-stop. Plug in, press connect, then continue from line ${S.lostAt}.`, 'bad');
        if (S.stoppedAt && st && st.resumeLine === S.stoppedAt) return say(`${st.note[0].toUpperCase()}${st.note.slice(1)}. The router is off and the bit is up.`, 'warn');
        if (S.stoppedAt) return say(`Stopped at line ${S.stoppedAt}. To finish, press continue from line ${S.stoppedAt}; to start over, press cut.`, 'warn');
        if ((S.lastDone === 'cut' || S.lastDone === 'from') && st && st.coasting) return say((window.SwarfSafetyWords || {}).coasting || 'Finished. Keep your hands clear until the bit has stopped turning.', 'warn');
        return say(S.lastDone === 'cut' || S.lastDone === 'from' ? ((window.SwarfSafetyWords || {}).finished || 'Finished. Wait until the bit has stopped turning.') : 'Ready. Press cut; a short checklist comes first.');
    }
  }

  // running: true keeps the line over a running job's status (a refused press must be seen)
  function tell(text, cls, running) {
    S.hold = { text, cls, until: Date.now() + 5000, running: !!running };
    say(text, cls);
    clearTimeout(S.holdT); S.holdT = setTimeout(() => { S.hold = null; refresh(); }, 5100);
  }
  function say(text, cls) {
    el.say.textContent = tie(text || '');
    el.say.className = 'sr-say' + (cls ? ' ' + cls : '');
  }

  // ------------------------------------------------------------ actions
  async function doZero(axes) {
    if (!S.machine || S.machine.state.running) return;
    if (isGrbl()) {
      if (!(await S.machine.zero(axes))) { tell(`Not zeroed: ${S.machine.state.note}.`, 'warn'); refresh(); return; }
      freshZero(axes);
    } else {
      // a zero pressed while the machine still moves sets nothing: say so, and mark nothing zeroed
      if (S.machine.zero(axes) === false) { tell(`Not zeroed: ${S.machine.state.note}.`, 'warn'); refresh(); return; }
      freshZero(axes);
    }
    if (axes.includes('x') && axes.includes('y')) S.zeroXY = true;
    else if (axes === 'x') S.zx = true;
    else if (axes === 'y') S.zy = true;
    if (S.zx && S.zy) S.zeroXY = true;
    if (S.zeroXY && /[xy]/.test(axes)) markXYAt();
    if (axes.includes('z')) { S.zeroZ = true; S.zStale = false; markZBit(); }
    S.zeroSetAt = Date.now(); S.zeroFor = progKey();
    S.zeroLost = false;
    // a new bit after a tool change keeps the trace: only Z moved
    if (S.toolChange && axes === 'z') S.toolChange = null;
    else S.traced = false;
    if (isGrbl()) { S.g54ok = { xy: true, z: true }; rememberZero(); saveG54(); }
    refresh();
  }

  // Z plate (the auto Z depth with the touch-off tool, as the SB
  // software has it, more tightly integrated): one card, not five. The plate's
  // thickness; three checks (bit over the board, clip on, plate under the bit); the
  // circuit proved by touching the plate to the bit, which also tells swarf which
  // input the plate is on; then touch off (C2: two touches, Z = the plate's
  // thickness, lift). After it, the card asks for the plate and clip back.
  // The simulator does all of it, with a button standing in for the touch.
  function plateWizard() {
    const m = S.machine;
    if (!m || !m.zZero || m.state.running || (isDirect() && !m.state.connected)) return;
    playStop();
    const sim = !isDirect();
    // no touch step, ever: the shop's plate is known from the start, and
    // machine setup sets another box's. The plate already reading contact is still refused before the
    // bit moves, and the descent stops after its travel. A saved plate input that is the e-stop's (or a
    // home sensor's) is no plate: the card sends the teacher to machine setup.
    if (!sim && m.plateClash && m.plateClash() && m.plateCfg.confirmed) { m.plateCfg.confirmed = false; m.savePlate(); }
    const proved = sim || !!(m.plateCfg && m.plateCfg.confirmed);
    let zeroed = false;
    const checks = [
      ['over', `The bit is over your board, less than ${len((m.plateCfg && m.plateCfg.travel) || 60, 0)} above the plate.`],
      ['clip', 'The ground clip is on the black Allen screw on the router\'s side, its wire clear of the bit.'],
      ['under', 'The plate lies flat on the board, right under the bit. Hands clear.']
    ];
    const boxes = {};
    const body = h('div', { class: 'sr-plate' });
    // the plate's numbers in cam's units; a bare number typed is in them too
    const plateShow = mm => window.SwarfLength ? SwarfLength.show(mm) : String(+(+mm).toFixed(3));
    const thick = h('input', { type: 'text', inputmode: 'decimal', value: plateShow(m.plateCfg.thickness), title: `Your plate's thickness, from calipers: Z zero is this far below` });
    // why touch off is shut, in words on the card (a shut button with only a tooltip read as
    // "touch off does nothing" on a first use)
    const why = h('p', { class: 'sr-why' });
    const go = h('button', { class: 'go' });
    const back = h('button', { text: 'cancel', onclick: () => { S.plateWatch = null; S.afterZero = null; el.sheet.classList.remove('on'); refresh(); } });
    const put = h('input', { type: 'checkbox' });
    const pic = plateView();
    // the board as measured, against the job (optional): the machine knows the top of the board and
    // not the spoilboard, so only calipers can tell
    const measured = h('input', { type: 'text', inputmode: 'decimal', class: 'sr-board-in', title: `Optional: your board's calipered thickness, to compare with the job` });
    const boardSay = h('p', { class: 'sr-board-say' });
    measured.addEventListener('keydown', e => e.stopPropagation());
    measured.addEventListener('input', () => {
      const r = boardCheck(mmOf(measured.value));
      boardSay.textContent = r ? r.text : '';
      boardSay.classList.toggle('warn', !!(r && r.warn));
      S.boardWarn = r && r.warn ? r.text : '';
    });
    const show = () => {
      const all = checks.every(([k]) => boxes[k].checked);
      if (pic) pic.pose(zeroed ? 'away' : 'flat');
      if (zeroed) {
        why.textContent = ''; why.style.display = 'none';
        body.innerHTML = '';
        body.append(h('h2', { text: 'Z is zero on top of your board' }),
          h('p', { text: 'Put the plate back where it lives and unclip the ground clip, so neither is near the bit when it cuts.' }),
          h('label', {}, put, h('span', { text: 'the plate and the clip are put away' })),
          h('div', { class: 'sr-plate-t' }, h('span', { text: 'your board, measured' }), measured, h('span', { text: `${inch() ? 'in' : 'mm'}: optional, with calipers` })),
          boardSay);
        go.textContent = 'done'; go.disabled = !put.checked;
        go.title = go.disabled ? "Tick 'the plate and the clip are put away' first" : 'Close the card: Z is set';
        return;
      }
      go.textContent = 'touch off';
      go.disabled = !(all && proved);
      why.textContent = !go.disabled ? ''
        : !proved ? 'The Z plate isn\'t set on this computer: a teacher sets it in machine setup (hold the button).'
        : 'Touch off opens once the three boxes are ticked.';
      why.style.display = why.textContent ? '' : 'none';
      go.title = go.disabled ? why.textContent : `The bit comes down slowly, touches, lifts, touches again and lifts ${up()}. Any key stops it.`;
    };
    thick.addEventListener('keydown', e => e.stopPropagation());
    // how far the bit searches down for the plate (60 mm by default, raise it by hand)
    // shown as every length field is (SwarfLength.show), so the number read back is the
    // one stored: 10 mm showed as 0.39 in, which read back as 9.9 mm and was refused
    const reachShow = () => plateShow((m.plateCfg && m.plateCfg.travel) || 60);
    const reach = h('input', { type: 'text', inputmode: 'decimal', value: reachShow(), title: 'How far the bit comes down looking for the plate' });
    reach.addEventListener('keydown', e => e.stopPropagation());
    reach.addEventListener('change', () => {
      const t = mmOf(reach.value);
      if (!(t >= 10 && t <= 150) || !m.setPlateTravel || !m.setPlateTravel(t)) { reach.value = reachShow(); say(inch() ? `Search down is ${plateShow(10)} to ${plateShow(150)} in (10 to 150 mm).` : 'Search down is 10 to 150 mm.', 'warn'); return; }
      reach.value = plateShow(t);
      const over = boxes.over && boxes.over.nextElementSibling;
      if (over) over.textContent = `The bit is over your board, less than ${len(t, 0)} above the plate (its search distance).`;
    });
    thick.addEventListener('change', () => {
      const t = mmOf(thick.value);
      if (!(t > 0 && t < 50) || !m.setPlateThickness || !m.setPlateThickness(t)) { thick.value = plateShow(m.plateCfg.thickness); say(inch() ? `A plate is under ${plateShow(50)} in (50 mm) thick: measure yours with calipers.` : 'A plate is between 0 and 50 mm thick: measure yours with calipers.', 'warn'); }
      else thick.value = plateShow(t);
    });
    put.addEventListener('change', show);
    go.onclick = async () => {
      if (zeroed) {
        S.plateUsed = false; el.sheet.classList.remove('on'); refresh(); if (S.boardWarn) { say(S.boardWarn, 'warn'); S.boardWarn = ''; }
        if (S.afterZero) { const k = S.afterZero; S.afterZero = null; askCut(k); }
        return;
      }
      go.disabled = true; go.textContent = 'touching off…';
      S.plateWatch = null;
      el.sheet.classList.remove('on');
      // no movement within 5 s of the press: say so on the card and stop, rather than wait silently
      const z0 = m.steps ? m.steps.z : null;
      let stuck = false;
      const guard = z0 == null ? null : setTimeout(() => {
        if (m.steps.z !== z0 || zeroed) return;
        stuck = true;
        try { m.stop && m.stop(); } catch (e) { /* not moving */ }
      }, 5000);
      let ok = false;
      try { ok = await m.zZero(); } catch (e) { m.state.note = `Z zero failed: ${e.message || e}`; }
      clearTimeout(guard);
      if (stuck && !ok) m.state.note = `touch off sent the move, but Z did not move in 5 s (${m.state.note || 'no answer from the machine'}). Check the e-stop is released and the USB cable, then try again.`;
      if (!ok) {
        // the reason on the card itself, not only in the log behind it (a first use read a refusal as
        // "touch off does nothing")
        show(); why.textContent = m.state.note || 'Z was not zeroed.'; why.style.display = '';
        tell(why.textContent, 'warn');
        el.sheet.classList.add('on'); refresh(); return;
      }
      freshZero('z'); S.zeroZ = true; S.zStale = false; markZBit(); S.zeroSetAt = Date.now(); S.zeroFor = progKey(); S.plateUsed = true;
      if (S.toolChange) S.toolChange = null; else S.traced = false;
      zeroed = true;
      el.sheet.classList.add('on'); show(); refresh();
    };
    body.append(h('h2', { text: 'Zero Z with the plate' }),
      h('div', { class: 'sr-plate-t' }, h('span', { text: 'plate thickness' }), thick, h('span', { text: `${inch() ? 'in' : 'mm'}, from calipers` })),
      h('div', { class: 'sr-plate-t' }, h('span', { text: 'search down' }), reach, h('span', { text: `${inch() ? 'in' : 'mm'}: how far down it looks` })));
    for (const [k, t] of checks) {
      boxes[k] = h('input', { type: 'checkbox' });
      boxes[k].addEventListener('change', show);
      body.append(h('label', {}, boxes[k], h('span', { text: t })));
    }
    el.card.innerHTML = '';
    el.card.append(...(pic ? [pic.el] : []), body, why, h('div', { class: 'row' }, back, go));
    show();
    el.sheet.classList.add('on');
  }

  // A measured board against this job (optional, on the plate card). The job's thickness is known for
  // cam's own toolpaths (its tallest part being cut); a file brought in says only how deep it cuts.
  // More than 1 mm apart is one sentence, what would follow. Null when nothing was typed.
  function boardCheck(mm) {
    if (!(mm > 0)) return null;
    const P = S.prog;
    let job = null;
    if (P && P.source === 'cam') {
      try {
        for (const w of window.kiri.api.widgets.all()) {
          if (w.meta && w.meta.disabled) continue;
          const g = w.mesh.geometry; g.computeBoundingBox();
          job = Math.max(job || 0, g.boundingBox.max.z - g.boundingBox.min.z);
        }
      } catch (e) { job = null; }
    }
    const moves = (P && P.parsed && P.parsed.moves) || [];
    const deep = moves.reduce((d, m) => Math.max(d, -m.z), 0);
    const mine = `Your board measures ${len(mm, 2)}`;
    if (job) {
      const off = mm - job, made = `the job was made for ${len(job, 2)}`;
      if (Math.abs(off) <= 1) return { warn: false, text: `${mine}, within 1 mm of the job's ${len(job, 2)}.` };
      if (off > 0) return { warn: true, text: deep >= job - 0.5 ? `${mine}; ${made}. The cut would stop ${len(mm - deep, 2)} short of going through.` : `${mine}; ${made}. Its deepest cut is ${len(deep, 2)} from the top, so it stays in the board: check this is the board you meant.` };
      return { warn: true, text: deep > mm ? `${mine}; ${made}. The cut goes ${len(deep, 2)} down from the top, so it would go ${len(deep - mm, 2)} into the spoilboard.` : `${mine}; ${made}. Its deepest cut is ${len(deep, 2)} from the top, so it stays in the board: check this is the board you meant.` };
    }
    if (deep > mm + 1) return { warn: true, text: `${mine}; this file cuts ${len(deep, 2)} down from the top, so it would go ${len(deep - mm, 2)} into the spoilboard.` };
    return { warn: false, text: `${mine}; this file cuts ${len(deep, 2)} down from the top, which stays in the board.` };
  }

  // The plate card's picture (the plate model, swarf-plate-model.js): the bit, the
  // ground clip on the router's clamp ring and the plate, posed for the card's step: 'test' (held
  // up against the bit, the circuit check), 'flat' (on the board, the bit coming down to it) and
  // 'away' (put back). Ink on the light skins, the faint ghost on the dark one. It renders only
  // while the card is open.
  // One renderer for every plate card (a WebGL context per card would never be let go,
  // and Chrome drops the oldest past ~16, the control viewer's); its canvas moves into each card.
  let plateGL = null;
  function plateView() {
    const THREE = window.THREE, PM = window.SwarfPlateModel;
    if (!THREE || !PM) return null;
    const W = 460, H = 200;
    if (!plateGL) {
      const canvas = h('canvas');
      const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); r.setSize(W, H, false); r.setClearColor(0, 0);
      const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, W / H, 1, 5000);
      cam.up.set(0, 0, 1); cam.position.set(200, -340, 150); cam.lookAt(-10, 0, 46);   // the bit, the plate, and the clip on its screw up the housing
      plateGL = { canvas, r, scene, cam, models: {} };
    }
    const { canvas, r, scene, cam } = plateGL;
    const mine = plateGL.owner = {};     // a card opened after this one takes the canvas, and this one's loop ends
    const wrap = h('div', { class: 'sr-plate-view' });
    const labels = { bit: h('span', { text: 'bit', class: 'l' }), clip: h('span', { text: 'ground clip', class: 'r' }), plate: h('span', { text: 'plate', class: 'b' }) };
    // a picture of the steps, not the machine's live position
    wrap.append(canvas, ...Object.values(labels), h('em', { class: 'sr-plate-note', text: 'a picture, not the live machine' }));
    const dark = !document.documentElement.getAttribute('data-skin');
    const style = dark ? 'ghost' : 'ink';
    const model = plateGL.models[style] || (plateGL.models[style] = PM.build(THREE, { style }));
    for (const k of Object.keys(plateGL.models)) scene.remove(plateGL.models[k].group);
    scene.add(model.group);
    let pose = 'test', t0 = performance.now(), raf = 0;
    const place = () => {
      const a = model.anchors();
      for (const k of Object.keys(labels)) {
        const v = a[k].clone().project(cam);
        labels[k].style.left = ((v.x + 1) / 2 * 100).toFixed(1) + '%';
        labels[k].style.top = ((1 - v.y) / 2 * 100).toFixed(1) + '%';
        labels[k].style.display = k === 'plate' && pose === 'away' ? 'none' : '';
      }
    };
    // rests while the sheet is off (touch off hides it); pose() wakes it for the card's next step
    // (a loop that ended there would leave "Z is zero" showing the bit halfway down)
    const frame = now => {
      if (plateGL.owner !== mine || !document.contains(canvas) || !el.sheet.classList.contains('on')) { raf = 0; return; }
      // flat: the bit comes down to the plate, touches, lifts, as touch off will do
      const k = ((now - t0) / 3200) % 1, still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const bitZ = pose === 'flat' ? (still ? 12 : 3 + 32 * Math.abs(Math.cos(k * Math.PI))) : pose === 'test' ? 30 : 60;
      model.set({ bitZ, plate: pose });
      r.render(scene, cam); place();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return { el: wrap, pose(p) {
      if (p !== pose) { pose = p; t0 = performance.now(); }
      if (!raf && plateGL.owner === mine) raf = requestAnimationFrame(frame);
    } };
  }

  // which program a zero was set for: a new program with other origin words retires it
  // the zero, kept across files and reloads: what was zeroed, when, and the card's count then
  const ZERO_KEY = 'swarf-run-zero';
  function rememberZero() { if (S.zeroXY || S.zeroZ) S.zeroHad = { xy: !!S.zeroXY, z: !!S.zeroZ }; saveZero(); }
  function saveZero() {
    const t = Date.now(); if (t - (S.zeroSavedAt || 0) < 500 && S.zeroHad) return; S.zeroSavedAt = t;
    try { localStorage.setItem(ZERO_KEY, JSON.stringify({ had: S.zeroHad || null, at: S.zeroSetAt || 0, steps: S.lastSteps || null, where: S.zeroAt === undefined ? null : S.zeroAt, bit: S.zBit || null })); } catch (e) { /* private window */ }
  }
  // a typed length in control: mm unless it says otherwise ("6in" is 6 inches)
  // a bare number is in cam's units (the plate's fields too: their numbers are shown in them)
  function mmOf(t, def) { return window.SwarfLength ? SwarfLength.parse(t, def) : parseFloat(t); }
  // the bit a program has in at a line: the last tool named at or before it, else the first named
  // (a file with no tool lines has one bit, '')
  function bitAt(parsed, line) {
    const ev = (parsed && parsed.events) || [];
    const pick = kind => { const k = ev.filter(e => e.kind === kind); const at = k.filter(e => e.line <= line).pop() || k[0]; return at ? String(at.value).trim().toLowerCase() : ''; };
    return { name: pick('tool-name'), num: pick('tool') };
  }
  // two bits: 'same', 'diff', or 'unknown' when they cannot be told apart (a name against a number,
  // a file with no tool lines, a Z set with no file open)
  function cmpBit(a, b) {
    if (!a || !b) return 'unknown';
    if (a.name && b.name) return a.name === b.name ? 'same' : 'diff';
    if (!a.name && !b.name && a.num && b.num) return a.num === b.num ? 'same' : 'diff';
    return 'unknown';
  }
  // Z was just set: remember the bit it was set with (undefined with no program: the next file adopts it)
  function markZBit() { S.zBit = S.prog ? bitAt(S.prog.parsed, S.stoppedAt || 1) : undefined; }
  // the place a program zeroes X Y, coarsely: 'corner', 'center', or null when the file only says its
  // own X 0, Y 0 (a corner zero is never offered to a center file)
  function spotOf() {
    if (!S.prog) return null;
    if (S.prog.origin) { const t = S.prog.origin.xy || ''; return /front-left corner/.test(t) ? 'corner' : /center/.test(t) ? 'center' : null; }
    const b = P.cutBounds(S.prog.parsed); if (!b) return null;
    const near = (v, w) => Math.abs(v) <= Math.max(10, w * 0.03), w = b.max.x - b.min.x, d = b.max.y - b.min.y;
    const corner = near(b.min.x, w) && near(b.min.y, d), center = near((b.min.x + b.max.x) / 2, w) && near((b.min.y + b.max.y) / 2, d);
    // a part small enough to read as both (under about 20 mm) is not known: offered, never kept by itself
    return corner && center ? null : corner ? 'corner' : center ? 'center' : null;
  }
  // what the saved zero was, in words, so a press is a choice made knowing it
  // a saved zero is offered back for 12 hours; after that the board may be anyone's
  function zeroFresh(at) { return !!at && Date.now() - at < 12 * 3600e3; }
  // when a zero was set, with its day: the box may have been left on for the next student
  function zeroWhen(at) {
    return new Date(at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  }
  function zeroWords(xy, z) {
    const w = [];
    if (xy && S.zeroAt) w.push(`X Y at the ${S.zeroAt === 'corner' ? 'front-left corner' : 'center'} of the board`);
    if (z && S.zBit && (S.zBit.name || S.zBit.num)) w.push(`Z with the ${S.zBit.name || 'bit ' + S.zBit.num}`);
    return w.length ? `; ${w.join(', ')}` : '';
  }
  // X Y was just set: remember the place
  function markXYAt() { S.zeroAt = S.prog ? spotOf() : undefined; }
  // a zero measured now replaces that half of a kept one: its note and its drop button go (the z
  // plate, a typed position and the corners card too: a note left up would keep a button that
  // drops the zero just measured). Every path that sets a zero calls it.
  function freshZero(axes) {
    if (!S.keptZero) return;
    if (/[xy]/.test(axes)) S.keptZero.xy = false;
    if (/z/.test(axes)) S.keptZero.z = false;
  }
  // offered back (one press) unless both places are known and differ; kept with no press only when both are known and equal
  function sameSpot() { const now = spotOf(); return S.zeroAt == null || !S.prog || now == null || S.zeroAt === now; }
  function knownSameSpot() { const now = spotOf(); return S.zeroAt != null && now != null && S.zeroAt === now; }
  // Z set earlier still fits: no bit change since, and the program has in the bit Z was set with
  // (offered back unless it is known to be another bit; kept with no press only when known the same)
  function sameBit() { return !S.toolChange && !S.zStale && (!S.prog || cmpBit(S.zBit, bitAt(S.prog.parsed, S.stoppedAt || 1)) !== 'diff'); }
  function progKey() { return S.prog ? `${S.prog.source}|${S.prog.name}|${originText().xy}` : ''; }
  function keepZero() {
    const had = S.zeroHad || { xy: true, z: true };
    // the board still clamped is not the machine still knowing where it is: after
    // the link dropped, or a job stopped short, the zero comes back but the trace does not. Tracing
    // again shows the bit going round the board where it should, before any cut.
    // Read before the flags below are cleared (read after, it never fires)
    const unsure = !!(S.lostAt || S.stoppedAt || (S.zeroReconnect && !S.discAt));
    // what is set stays set; Z comes back only for the bit it was set with (not after a bit change)
    const back = { xy: false, z: false };
    if (had.xy && sameSpot()) { S.zeroXY = S.zx = S.zy = true; back.xy = true; if (S.zeroAt == null && S.prog) S.zeroAt = spotOf(); }
    if (had.z && sameBit()) { S.zeroZ = true; back.z = true; if (!S.zBit && S.prog) markZBit(); }
    // brought back, not measured: the same note and drop buttons as a zero kept across cam
    if (back.xy || back.z) S.keptZero = { xy: back.xy || !!(S.keptZero && S.keptZero.xy), z: back.z || !!(S.keptZero && S.keptZero.z) };
    saveZero();
    S.zeroReconnect = false; S.discAt = 0; S.discWhy = '';
    if (unsure) { S.traced = false; tell('Zero kept. Trace once before you cut: it shows the machine still knows where your board is.', 'warn'); }
    refresh();
  }

  // jog speed in mm/min -> the machine's jog mm/s (rapid = the shop's [VS] jog)
  function setJogSpeed() {
    const m = S.machine;
    if (!m || !m.cfg || !m.cfg.jog) return;
    if (!S.rapidJog) S.rapidJog = { ...m.cfg.jog };
    const xy = S.jogSpeed === 'rapid' ? S.rapidJog.xy : S.jogSpeed / 60;
    m.cfg.jog = { xy, z: Math.min(xy, Z_JOG_MAX / 60) };
  }
  function typeWork(a) {
    const m = S.machine;
    if (!m || !m.setWork || m.state.running) return;
    const span = el.dro[a], inp = h('input', { type: 'text', inputmode: 'decimal', class: 'v', value: posText(m.state.pos[a] || 0), title: inch() ? 'A position in inches; 1 1/2 or 38 mm work too' : 'A position in mm; 1 1/2 in or 38 mm work too' });
    span.replaceWith(inp); inp.focus(); inp.select();
    const opened = inp.value;
    let done = false;
    const finish = async ok => {
      if (done) return; done = true;
      const v = mmOf(inp.value);
      inp.replaceWith(span);
      // only a typed value sets the axis: opening the field and leaving it unchanged sets nothing
      if (ok && isFinite(v) && inp.value.trim() !== opened.trim()) {
        if (isGrbl()) { if (!(await m.setWork(a, v))) { tell(`Not set: ${m.state.note}.`, 'warn'); refresh(); return; } }
        else if (m.setWork(a, v) === false) { tell(`Not set: ${m.state.note}.`, 'warn'); refresh(); return; }
        // a typed position sets that axis like zero does (and a new trace, unless it is Z after a tool change)
        freshZero(a);
        if (a === 'x') S.zx = true; else if (a === 'y') S.zy = true; else { S.zeroZ = true; S.zStale = false; markZBit(); }
        if (S.zx && S.zy) { S.zeroXY = true; if (a !== 'z') markXYAt(); }
        S.zeroSetAt = Date.now(); S.zeroFor = progKey(); S.zeroLost = false;
        if (S.toolChange && a === 'z') S.toolChange = null; else S.traced = false;
        if (isGrbl()) { S.g54ok = { xy: true, z: true }; rememberZero(); saveG54(); }
        refresh();
      }
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); });
    inp.addEventListener('blur', () => finish(true));
  }

  function jogDown(axis, dir, b) {
    setJogSpeed();
    if (!S.machine || S.machine.state.running) return;
    b.classList.add('held');
    if (S.jogStep === 'cont') { S.contHeld = b; S.machine.jogHold(axis, dir); }
    else S.machine.jog(axis, dir * S.jogStep);
  }
  function jogUp(b) {
    b.classList.remove('held');
    if (S.contHeld === b) { S.contHeld = null; S.machine.jogRelease(); }
  }

  // The sheet is a modal dialog: named by its heading (with the machine), described by its paragraphs,
  // focus on its safe button when it opens, Tab kept inside, the page behind it inert, and focus back
  // where it was when it closes.
  const SAFE_WORDS = /^(not yet|cancel|back|close|done|got it)$/i;
  let sheetWas = null, sheetInert = [];
  const shown = x => !x.disabled && x.getClientRects().length > 0;
  function sheetFocusables() { return [...el.card.querySelectorAll('button, input, select, textarea, summary, a[href], [tabindex]:not([tabindex="-1"])')].filter(shown); }
  function sheetSafe() {
    const bs = [...el.card.querySelectorAll('button')].filter(shown);
    return bs.find(b => SAFE_WORDS.test(b.textContent.trim())) || bs.find(b => !b.classList.contains('go')) || null;
  }
  function sheetLabel() {
    const h2 = el.card.querySelector('h2');
    let mach = el.card.querySelector('.sr-mach');
    if (!mach) { mach = h('div', { class: 'sr-mach', id: 'sr-sheet-mach' }); el.card.prepend(mach); }
    mach.textContent = machineName();
    if (h2) h2.id = 'sr-sheet-title';
    el.card.setAttribute('aria-labelledby', h2 ? `${mach.id} ${h2.id}` : mach.id);
    const ps = [...el.card.querySelectorAll('p')];
    ps.forEach((p, i) => { p.id = `sr-sheet-p${i}`; });
    if (ps.length) el.card.setAttribute('aria-describedby', ps.map(p => p.id).join(' ')); else el.card.removeAttribute('aria-describedby');
  }
  function sheetFocus() {
    if (el.card.contains(document.activeElement)) return;
    (sheetSafe() || el.card).focus({ preventScroll: true });
  }
  function sheetOpen() {
    sheetWas = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    sheetInert = [];
    for (let n = el.sheet; n && n.parentElement && n !== document.body; n = n.parentElement)
      for (const sib of n.parentElement.children) if (sib !== n && !sib.inert && sib.tagName !== 'DIALOG' && sib.tagName !== 'SCRIPT') { sib.inert = true; sheetInert.push(sib); }
    sheetLabel();
    sheetFocus();
  }
  function sheetClose() {
    for (const n of sheetInert) n.inert = false;
    sheetInert = [];
    const back = sheetWas;
    sheetWas = null;
    if (back && back.isConnected && !back.disabled && back.getClientRects().length) back.focus({ preventScroll: true });
  }
  function sheetModal() {
    let open = false;
    new MutationObserver(() => {
      const on = el.sheet.classList.contains('on');
      if (on && !open) { open = true; sheetOpen(); }
      else if (!on && open) { open = false; sheetClose(); }
    }).observe(el.sheet, { attributes: true, attributeFilter: ['class'] });
    // a card that changes while open (the zero steps, a plate step): named again, focus kept inside
    new MutationObserver(() => { if (open) { sheetLabel(); sheetFocus(); } }).observe(el.card, { childList: true });
  }
  // Tab and Shift-Tab go round the card's own controls
  function sheetTab(e) {
    const f = sheetFocusables();
    if (!f.length) { e.preventDefault(); el.card.focus(); return; }
    const i = f.indexOf(document.activeElement);
    const next = e.shiftKey ? (i <= 0 ? f[f.length - 1] : f[i - 1]) : (i < 0 || i === f.length - 1 ? f[0] : f[i + 1]);
    e.preventDefault();
    next.focus();
  }

  // Keys (ShopBot keypad layout): arrows X/Y, Page Up/Down Z, by the step setting
  // ('hold' moves while the key is down). Space or Esc stops, always.
  const JOG_KEYS = { ArrowRight: ['x', 1, '+X'], ArrowLeft: ['x', -1, '−X'], ArrowUp: ['y', 1, '+Y'], ArrowDown: ['y', -1, '−Y'], PageUp: ['z', 1, '+Z'], PageDown: ['z', -1, '−Z'] };
  function padButton(label) { return el.jog.querySelector(`.sr-pad button[data-axis="${label}"]`); }
  function onKey(e) {
    // a card on the sheet: Tab stays in it, Enter or Space presses the focused button (a motion
    // button stays disabled until its ticks are done), Esc closes it (nothing is moving yet)
    if (S.open && el.sheet && el.sheet.classList.contains('on') && e.type === 'keydown' && e.key === 'Tab') { sheetTab(e); return; }
    if (S.open && el.sheet && el.sheet.classList.contains('on') && e.type === 'keydown' && !(S.machine && (S.machine.state.running || S.machine.homing))) {
      if (e.key === 'Escape') { e.preventDefault(); S.plateWatch = null; S.mr1Watch = null; S.afterZero = null; el.sheet.classList.remove('on'); if (S.prog) showPlan(null); refresh(); return; }
      const t = e.target;
      // a jog under way (the zero steps' pad): Space stops it, as everywhere
      if ((e.key === ' ' || e.key === 'Enter') && t && el.card.contains(t) && !(e.key === ' ' && S.machine && (S.machine.state.moving || S.contHeld))) { e.stopPropagation(); return; }
      if (t && t.tagName === 'INPUT') return;
      // no jogging under a card: the plan it shows was made from where the bit is
      if (JOG_KEYS[e.key]) { e.preventDefault(); e.stopPropagation(); return; }
    }
    // a running job: any key at all pauses it, router off
    if (S.open && PV.raf && e.type === 'keydown' && e.key === ' ' && !(S.machine && S.machine.state.running)) { e.preventDefault(); playStop(); return; }
    if (S.open && S.machine && e.type === 'keydown' && S.machine.state.running && !S.machine.state.paused) {
      e.preventDefault(); e.stopPropagation();
      S.machine.pause();
      return;
    }
    if (S.open && S.machine && S.machine.state.paused) { e.preventDefault(); e.stopPropagation(); return; }   // no key (down or up) resumes
    // the router on by hand: any key switches it off
    if (S.open && e.type === 'keydown' && S.machine && S.machine.state.routerTest) { e.preventDefault(); e.stopPropagation(); S.machine.routerTest(false); return; }
    if (S.open && e.type === 'keydown' && S.machine && S.machine.homing) { e.preventDefault(); S.machine.stop(); return; }   // a plate or home seek: any key stops it
    if (!S.open || !S.machine || e.metaKey || e.ctrlKey || e.altKey) return;
    // Space or Esc stops motion even with the cursor in a text field (typing a space only counts at rest)
    if (e.type === 'keydown' && (e.key === ' ' || e.key === 'Escape') && (S.machine.state.running || S.machine.state.moving || S.contHeld)) {
      e.preventDefault(); S.userStopped = true; S.contHeld = null; S.machine.stop(); return;
    }
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.type === 'keydown' && (e.key === ' ' || e.key === 'Escape')) {
      if (S.machine.state.running || S.machine.state.moving || S.contHeld) { e.preventDefault(); S.userStopped = true; S.contHeld = null; S.machine.stop(); }
      return;
    }
    const k = JOG_KEYS[e.key];
    if (!k) return;
    e.preventDefault();
    const b = padButton(k[2]);
    if (!b) return;
    if (e.type === 'keyup') { jogUp(b); return; }
    if (e.repeat) return;
    jogDown(k[0], k[1], b);
    if (S.jogStep !== 'cont') setTimeout(() => b.classList.remove('held'), 150);
  }
  document.addEventListener('keydown', onKey);
  // cam's letter keys (keypress: p prepares, x exports, r opens files) stay out of control
  window.addEventListener('keypress', e => { if (S.open) e.stopPropagation(); }, true);
  document.addEventListener('keyup', onKey);
  // a held jog whose release can't arrive (window loses focus, tab hidden) stops now
  const dropHold = () => { if (S.contHeld) jogUp(S.contHeld); };
  window.addEventListener('blur', dropHold);
  document.addEventListener('visibilitychange', () => { if (document.hidden) dropHold(); });

  // The job plan (swarf-run-plan.js): the program as the machine will run it, from where the bit
  // is now, the way in and out included. The card shows it and arms it; the machine runs only it.
  function makePlan(kind, extra) {
    if (!S.prog || !S.machine || !S.machine.plan) return null;
    const p = S.prog.parsed, name = S.prog.name.replace(/\.[^.]+$/, '');
    let prog;
    if (kind === 'trace') prog = P.traceProgram(p, SAFE_Z, name);
    else if (kind === 'air') prog = P.airProgram(p, airClear(), name, SAFE_Z);
    else if (kind === 'from') prog = P.fromLineProgram(p, extra, SAFE_Z, name);
    else prog = { name, moves: p.moves, sbp: S.prog.text, source: p, spindle: true };
    if (!prog) return null;
    return S.machine.plan({ ...prog, kind, preview: false });
  }
  // the preview shows what will run: the plan's own moves, the way in drawn as travel
  function showPlan(plan) {
    const p = S.prog.parsed;
    if (plan) view.load({ ...p, moves: plan.moves, bounds: P.boundsOf(plan.moves) });
    else if (view.bounds !== p.bounds) view.load(p);
  }
  // the screen (and with it the computer) stays awake while a job runs
  async function keepAwake(on) {
    try {
      if (on && !S.wake && navigator.wakeLock) { S.wake = await navigator.wakeLock.request('screen'); S.wake.addEventListener('release', () => { S.wake = null; }); }
      else if (!on && S.wake) { const w = S.wake; S.wake = null; await w.release(); }
    } catch (e) { /* not allowed here: the checklist asks for a plugged-in, open laptop */ }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.machine && S.machine.state.running) keepAwake(true); });
  // leaving the page mid-job asks first; leaving anyway stops the MR-1 (a hold, then a reset)
  window.addEventListener('beforeunload', e => {
    const st = S.machine && S.machine.state;
    if (st && (st.running || st.spindle)) { e.preventDefault(); e.returnValue = ''; return ''; }
  });
  window.addEventListener('pagehide', () => {
    const m = S.machine, st = m && m.state;
    if (!st || !(st.running || st.spindle)) return;
    if (isGrbl() && m.rt) { m.rt(0x21); m.rt(0x18); }
    else if (m.stop) m.stop();
  });
  function start(plan) {
    if (!plan || !S.machine) { say('Nothing to run there.', 'warn'); return; }
    keepAwake(true);
    S.job = plan.kind;
    if (S.machine.setOverride) S.machine.setOverride(100);   // each job starts at its own feeds
    S.runMoves = plan.moves; S.runIdx = 0; S.userStopped = false;
    showPlan(plan);
    view.progress(0);
    if (S.machine instanceof M.SimMachine) S.machine.timeScale = S.simRate;
    S.machine.run(plan);
    if (!S.machine.state.running) tell(`Not run: ${String(S.machine.state.note || '').replace(/^not run: /i, '')}.`, 'warn');
    refresh();
  }


  // the test runs' own checklist: the router stays off (the card says so), so no bit or speed check; the rest as for a cut
  function testChecklist() {
    const o = originText();
    return [
      'your board is flat and held down; the bit clears every screw and clamp',
      inchItem(),
      /^the /.test(o.z) ? `Z zero is on ${o.z}` : `Z zero is ${o.z}`,
      isMR1() ? 'hands clear of the gantry, a hand near the MR-1\'s e-stop' : 'hands clear of the gantry, a foot near the floor e-stop'
    ].filter(Boolean);
  }
  // in the air: the deepest point clears the highest point of the cut by AIR_CLEAR, so a file
  // zeroed on the table does not run through the board
  // the highest point of every move below safe height, rapids too (a file
  // that rapids down near a pocket floor cuts only below its board's top)
  function airTop() { const mv = S.prog ? S.prog.parsed.moves : []; let t = 0; for (const m of mv) { if (m.z < SAFE_Z - 0.5) t = Math.max(t, m.z); if (m.z0 < SAFE_Z - 0.5) t = Math.max(t, m.z0); } return t; }
  function airClear() { return AIR_CLEAR + airTop(); }
  function askCut(kind) {
    if (!S.prog || stale()) return;
    const from = kind === 'from', test = kind === 'trace' || kind === 'air';
    const line = from ? Math.max(1, Math.round(+el.fromLine.value || 1)) : 0;
    el.card.innerHTML = '';
    // a cut with no trace this zero: said at the top, and one more tick the student owns
    const untraced = !test && !S.traced;
    // the zero not set in swarf: one tick the student owns on every run card, never a block
    const unzeroed = (!S.zeroXY || !S.zeroZ) ? [!S.zeroXY ? 'X Y' : '', !S.zeroZ ? 'Z' : ''].filter(Boolean).join(' and ') : '';
    const items = (test ? testChecklist() : checklist(from ? line : 0)).concat(
      unzeroed ? [`My ${unzeroed} zero is set on the machine`] : [],
      untraced ? ['no trace: I checked the bit clears every clamp and the zero is right'] : []);
    const checks = items.map(t => h('input', { type: 'checkbox' }));
    const b = P.cutBounds(S.prog.parsed);
    const size = b ? lens([b.max.x - b.min.x, b.max.y - b.min.y], 0) : '';
    const tool = spindleWord();
    const plan = makePlan(from ? 'from' : test ? kind : 'cut', line);
    const words = {
      trace: { h: 'Trace the border', go: 'trace', p: `The machine is about to move: up to ${up(1)} over Z 0, then around the ${size} box the cut fills, ${tool} off. Watch it stay over your board and clear every screw and clamp (clamps inside the cut are not checked).` },
      air: { h: `Run ${S.prog.name} as an air cut`, go: 'air cut', p: `The machine is about to move: the whole file ${prose(AIR_CLEAR)} above its highest point, ${tool} off, at 3/4 cutting speed${isDirect() ? ' (a slider changes it)' : ''}, about ${mins(S.prog.parsed.seconds / ((plan && plan.rate) || 0.75))}. It is not a clamp check: watch the path.` },
      from: { h: `Continue from line ${line}`, go: `continue from line ${line}`, p: `The machine is about to move and the ${tool} to start: up to ${up(1)}, over to where that line starts, ${tool} on, then the rest of the file.` },
      cut: { h: `Cut ${S.prog.name}`, go: 'cut', p: `The machine is about to move and the ${tool} to start.` }
    }[from ? 'from' : test ? kind : 'cut'];
    const go = h('button', { class: 'go', text: untraced ? `${words.go} without a trace` : words.go, disabled: '' });
    const bad = !plan ? 'There is nothing to run there.' : plan.problems.length ? `It can't run: ${plan.problems[0]}.` : '';
    const update = () => { go.disabled = !!bad || !checks.every(c => c.checked); };
    checks.forEach(c => c.addEventListener('change', update));
    // the way in, from where the bit is now: the same moves the machine will make
    const way = plan && window.SwarfRunPlan ? wayWords(plan) : '';
    const back = () => { el.sheet.classList.remove('on'); showPlan(null); };
    // summary first: file, bit, and whether the zero was set here or carried over (an assumption)
    const kz = S.keptZero, kxy = !!(kz && kz.xy && S.zeroXY), kzz = !!(kz && kz.z && S.zeroZ);
    const zeroSaid = !S.zeroXY || !S.zeroZ ? 'zero unknown' : kxy || kzz ? `earlier ${kxy && kzz ? '' : kxy ? 'X Y ' : 'Z '}zero, assumed` : 'zero set';
    const sum = [S.prog.name, bitNamed(from ? line : 0), zeroSaid, !from && !test ? `about ${mins(S.prog.parsed.seconds)}` : ''].filter(Boolean).join(' · ');
    // then only what is unusual; the plan's open warnings counted, not repeated (the inch note has its own tick)
    const open = test ? 0 : problems().warn.filter(w => !/^Written in inches/.test(w)).length;
    el.card.append(h('h2', { text: words.h }), h('p', { class: 'sr-sum', text: sum }),
      ...(bad ? [h('p', { class: 'sr-way bad', text: bad })] : []),
      ...(unzeroed ? [h('p', { class: 'sr-way bad', text: `${unzeroed} not zeroed in swarf: it runs from the machine's zero.` })] : []),
      ...(untraced ? [h('p', { class: 'sr-way bad', text: 'No trace this time: clamps and zero unchecked. Trace first if unsure.' })] : []),
      ...(open ? [h('p', { class: 'sr-way', text: `${open === 1 ? 'One concern' : `${open} concerns`} still open.` })] : []),
      h('p', { text: words.p }),
      ...(way ? [h('p', { class: 'sr-way', text: `First: ${way}.` })] : []),
      ...items.map((t, i) => h('label', {}, checks[i], h('span', { text: t }))),
      h('div', { class: 'row' }, h('button', { text: 'not yet', onclick: back }), go));
    // the student's ticks arm this plan, and only it; a plan made before the bit moved will not run
    go.onclick = () => { el.sheet.classList.remove('on'); if (unzeroed) tell(`Cutting from the machine's own zero (${unzeroed} not zeroed in swarf).`, 'warn'); else if (untraced) tell('Cutting without a trace.', 'warn'); start(window.SwarfRunPlan.arm(plan)); };
    if (plan) showPlan(plan);
    el.sheet.classList.add('on');
  }

  // Every move swarf makes by itself asks first: an "about to move" card before it moves or
  // turns on the spindle. Jogs are the
  // student's own hand on the machine and move at once.
  function routerButton() {
    const m = S.machine;
    if (!m || !m.routerTest) return;
    if (m.state.routerTest) { m.routerTest(false); return; }
    aboutToMove({ title: 'The router is about to start', text: 'It runs until you press the router button again or any key, or 60 seconds pass. Nothing moves while it runs. Bit clear of the board, hands clear of the bit.', go: 'start router',
      run: () => m.routerTest(true).catch(e => say(e.message, 'bad')) });
  }
  function aboutToMove({ title, text, go, run }) {
    if (!S.machine || S.machine.state.running) return;
    el.card.innerHTML = '';
    const ok = h('button', { class: 'go', text: go || 'move' });
    ok.onclick = () => { el.sheet.classList.remove('on'); if (isReal() && window.SwarfSound) SwarfSound.play('move'); run(); };
    const no = h('button', { text: 'not yet', onclick: () => el.sheet.classList.remove('on') });
    el.card.append(h('h2', { text: title }), h('p', { text }), h('p', { text: isMR1() ? 'Hands clear of the gantry, a hand near the MR-1\'s e-stop. Once it moves, space or Esc stops it.' : 'Hands clear of the gantry, a foot near the floor e-stop. Once it moves, space or Esc stops it.' }),
      h('div', { class: 'row' }, no, ok));
    el.sheet.classList.add('on');   // focus goes to not yet: a stray key never starts the machine
  }

  // A fault is latched: after the e-stop, a lost link mid-job
  // or a router whose state swarf could not know, nothing runs again until the student has looked
  // at the machine and said so. Jogs still work, to lift the bit clear.
  function faultCard() {
    const items = ['the bit has stopped turning', 'nothing is caught on the bit, the clamps or the gantry', 'the board has not moved under its screws or clamps', 'the red e-stop on the floor is released again'];
    const checks = items.map(() => h('input', { type: 'checkbox' }));
    const go = h('button', { class: 'go', text: 'all clear', disabled: '' });
    checks.forEach(c => c.addEventListener('change', () => { go.disabled = !checks.every(x => x.checked); }));
    go.onclick = async () => {
      // the router's state unknown: all clear sends every output off, and only a card that takes it clears the fault
      if (S.machine && S.machine.state.routerUnknown) {
        if (!(S.machine.recover && await S.machine.recover())) { tell('Not clear yet: the off did not reach the card. Check the USB cable, press connect, then all clear.', 'bad'); return; }
      }
      S.fault = null; el.sheet.classList.remove('on'); tell('All clear. The zero stays unproven until you check it: jog over it, or zero again.'); refresh();
    };
    el.card.innerHTML = '';
    el.card.append(h('h2', { text: 'Before anything runs again' }), h('p', { text: `${S.fault || 'The machine stopped'}. Look at the machine, then check each one:` }),
      ...items.map((t, i) => h('label', {}, checks[i], h('span', { text: t }))),
      h('div', { class: 'row' }, h('button', { text: 'not yet', onclick: () => el.sheet.classList.remove('on') }), go));
    el.sheet.classList.add('on');
  }

  // A waiting trace, in the air or cut opens what is left to do
  // when pressed while it waits
  function needsCard(k) {
    const st = S.machine && S.machine.state;
    const ready = st && st.connected && !st.queued && !(st.kind === 'sim' && st.moving);
    const list = needs(st, ready).filter(n => !n.opt);
    const word = { trace: 'trace', air: 'run an air cut', cut: 'cut' }[k];
    const shut = () => el.sheet.classList.remove('on');
    const act = {
      conn: () => h('button', { text: 'connect', onclick: () => { shut(); connect(true); } }),
      home: () => st && st.connected && !st.refused ? h('button', { text: 'home', onclick: () => { shut(); el.homeBtn.click(); } }) : null,
      fault: () => h('button', { text: 'all clear…', onclick: () => faultCard() }),
      prog: () => S.camBusy ? null : h('button', { text: 'make a part', onclick: () => { shut(); close(); const b = document.getElementById('swarf-step-shape'); if (b) b.click(); } }),
      z: () => S.machine && S.machine.state.connected && !isGrbl() ? h('button', { text: 'z plate', onclick: () => { shut(); plateWizard(); } }) : null,
      trace: () => h('button', { text: 'trace', onclick: () => { shut(); if (!needs(st, ready).some(n => !n.ok && !n.opt)) askCut('trace'); else needsCard('trace'); } })
    };
    el.card.innerHTML = '';
    el.card.append(h('h2', { text: `Before you can ${word}` }), h('p', { text: 'In this order:' }));
    for (const n of list) {
      const row = h('div', { class: 'sr-needrow' + (n.ok ? ' ok' : '') }, h('b', { text: n.ok ? '✓' : '○' }),
        h('span', {}, h('strong', { text: n.label }), n.ok ? null : h('small', { text: n.todo })));
      const a = !n.ok && act[n.k] && act[n.k]();
      if (a) row.append(a);
      el.card.append(row);
    }
    el.card.append(h('div', { class: 'row' }, h('button', { class: 'go', text: 'got it', onclick: () => { shut(); flashNeed(); } })));
    el.sheet.classList.add('on');
  }

  // ---- the table's corners: the machine's own frame : a way to zero to the front right
  // or front left corner of the machine, a kind of absolute positioning mode. The shop machine
  // has no home switches, so swarf learns the front-left corner once, from the bit placed over it;
  // the step count keeps it until the box is switched off.
  const CORNER = 'swarf-table-corner';
  function tableSize() {
    try { const d = window.kiri.api.conf.get().device; return { x: d.bedWidth || 2438.4, y: d.bedDepth || 1219.2 }; } catch (e) { return { x: 2438.4, y: 1219.2 }; }
  }
  function corner() {
    if (S.corner === undefined) { try { S.corner = JSON.parse(localStorage.getItem(CORNER)) || null; } catch (e) { S.corner = null; } }
    // a corner learned from the real box's count is lost when the box restarts (zeroLost), the simulator's when the page reloads
    // only for this page and this connection: a reload or a reconnect may hide a restart
    return S.corner && S.corner.kind === (isDirect() ? 'shopbot' : 'sim') && S.corner.page === PAGE_ID && S.corner.session === (S.connSession || 0) ? S.corner : null;
  }
  const PAGE_ID = Math.random().toString(36).slice(2);
  function setCorner(c) { S.corner = c; try { c ? localStorage.setItem(CORNER, JSON.stringify(c)) : localStorage.removeItem(CORNER); } catch (e) { /* private */ } }
  function cornersCard() {
    const m = S.machine;
    if (!m || m.state.running || !m.mabs) return;
    const shut = () => { el.sheet.classList.remove('on'); refresh(); };
    const T = tableSize();
    const draw = () => {
      const c = corner();
      el.card.innerHTML = '';
      el.card.append(h('h2', { text: 'The table\'s corners' }));
      if (!c) {
        el.card.append(h('p', { text: 'swarf does not know where the table is yet (this machine has no home switches). Jog the bit right over the front-left corner of the table, the corner nearest you on the left, then press below. swarf forgets it when the page reloads or the machine reconnects.' }));
      } else {
        const p = m.mabs();
        el.card.append(h('p', { text: `Front-left corner learned ${new Date(c.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. The bit is ${len(p.x - c.x)} right of it and ${len(p.y - c.y)} back. The table is ${lens([T.x, T.y], 0)}.` }));
        const rowFor = (name, cx, cy) => h('div', { class: 'sr-needrow' }, h('b', { text: '⌐' }), h('span', {}, h('strong', { text: name })),
          h('button', { text: 'make it X 0, Y 0', title: `This corner becomes X 0, Y 0; the bit stays put`, onclick: () => { zeroAtCorner(cx, cy); shut(); tell(`X 0, Y 0 is now the table's ${name} corner. The bit did not move.`); } }),
          h('button', { text: 'go there', title: `Up to ${up(1)}, then over the ${name} corner`, onclick: () => aboutToMove({ title: 'The bit is about to move', text: `Up to ${up(1)} over Z 0 (if it is lower), then over the table's ${name} corner.`, go: 'move', run: () => goCorner(cx, cy) }) }));
        el.card.append(rowFor('front left', c.x, c.y), rowFor('front right', c.x + T.x, c.y));
      }
      el.card.append(h('div', { class: 'row' },
        c ? h('button', { text: 'forget it', onclick: () => { setCorner(null); draw(); } }) : null,
        h('button', { text: c ? 'learn it again here' : 'the bit is over the front-left corner', onclick: () => { const p = m.mabs(); setCorner({ x: p.x, y: p.y, at: Date.now(), kind: isDirect() ? 'shopbot' : 'sim', page: PAGE_ID, session: S.connSession || 0 }); draw(); } }),
        h('button', { class: 'go', text: 'close', onclick: shut })));
    };
    draw();
    el.sheet.classList.add('on');
  }
  // zero at a corner without moving: here becomes (machine − corner) on each axis
  function zeroAtCorner(cx, cy) {
    const m = S.machine, p = m.mabs();
    if (m.setWork('x', p.x - cx) === false || m.setWork('y', p.y - cy) === false) { tell(`Not zeroed: ${m.state.note}.`, 'warn'); refresh(); return; }
    freshZero('xy'); S.zx = S.zy = S.zeroXY = true; markXYAt(); S.zeroSetAt = Date.now(); S.zeroFor = progKey(); S.zeroLost = false; S.traced = false;
    refresh();
  }
  function goCorner(cx, cy) {
    const m = S.machine, p = m.mabs(), w = m.state.pos;
    m.goTo({ z: Math.max(w.z, SAFE_Z), x: w.x + (cx - p.x), y: w.y + (cy - p.y) });
  }

  // ------------------------------------------------------------ machine check (USB)
  // Once per machine: which way each axis runs, which input is which switch,
  // whether output 1 is the spindle. Opens on the first USB connection.
  const CHECKED = 'swarf-shopbot-checked';
  const AXIS_HINT = { x: 'should go right, along the long side', y: 'should go away from you', z: 'should go up' };
  function isDirect() { return !!(M.DirectMachine && S.machine instanceof M.DirectMachine); }
  // the MR-1's board over Web Serial (swarf-grbl.js); a real machine is either one
  function isGrbl() { return !!(window.SwarfGrbl && S.machine instanceof window.SwarfGrbl.GrblMachine); }
  function isReal() { return isDirect() || isGrbl(); }
  function openCheck() {
    const m = S.machine;
    if (!isDirect() || !m.state.connected) return;
    S.checkShown = true;
    const st = m.state;
    S.check = { base: st.inputs ? { ...st.inputs } : null, dots: [] };
    el.card.innerHTML = '';
    const axes = ['x', 'y', 'z'].map(a => {
      const ok = h('button', { text: 'right way', onclick: () => ok.classList.add('ok') });
      return h('div', { class: 'sr-chk' },
        h('b', { text: a.toUpperCase() }),
        h('button', { text: a === 'z' ? `+${prose(20, 0)} up` : `+${prose(20, 0)}`, onclick: () => { ok.classList.remove('ok'); m.jog(a, 20); } }),
        h('span', { text: AXIS_HINT[a] }),
        ok,
        h('button', { text: 'wrong way', onclick: () => { ok.classList.remove('ok'); m.setFlip(a, !m.flip[a]); } }));
    });
    const dots = h('div', { class: 'sr-dots' });
    for (let i = 1; i <= 12; i++) { const d = h('i', { text: String(i) }); S.check.dots.push(d); dots.append(d); }
    const homeText = h('p');
    const showHome = () => {
      const H = m.homeCfg, set = H.set || {};
      homeText.textContent = `X home: ${set.x ? 'input ' + H.x.input : 'not set'} · Y home: ${set.y ? 'input ' + H.y.input : 'not set'}`;
    };
    // the one input that changed since the card opened, and its level now
    const lit = () => {
      const c = S.check, st = m.state;
      if (!c || !c.base || !st.inputs) return null;
      const changed = [];
      for (let n = 1; n <= 12; n++) if (m.level(st.inputs, n) !== m.level(c.base, n)) changed.push(n);
      return changed.length === 1 ? { input: changed[0], hit: m.level(st.inputs, changed[0]) } : null;
    };
    const take = a => {
      const l = lit();
      if (!l) { say(`Cover only the ${a.toUpperCase()} home sensor, so one number lights.`, 'warn'); return; }
      m.setHomeSensor(a, l.input, l.hit);
      showHome();
    };
    showHome();
    const plateText = h('p');
    const showPlate = () => { plateText.textContent = `Z plate: ${m.plateCfg.confirmed ? 'input ' + m.plateCfg.input : 'not set'}`; };
    showPlate();
    const takePlate = () => {
      const l = lit();
      if (!l) { say('Touch only the plate to the bit, so one number lights.', 'warn'); return; }
      m.setPlate(l.input, l.hit);
      showPlate();
    };
    // the e-stop (the shop's is a momentary button on input 8, not ShopBot's usual 4)
    const stopText = h('p');
    const showStop = () => { const c = m.stopCfg(); stopText.textContent = `e-stop: input ${c.input}, ${c.rest ? 'on' : 'off'} at rest`; };
    showStop();
    const takeStop = () => {
      const l = lit();
      if (!l) { say('Hold the red e-stop button down, so one number lights.', 'warn'); return; }
      m.setStop(l.input, l.hit ? 0 : 1);
      showStop();
    };
    const out = h('button', { class: 'sr-out', text: 'test the router (outputs 1 + 4) for 2 s' });
    out.onclick = async () => {
      if (!out.classList.contains('armed')) { out.classList.add('armed'); out.textContent = 'press again: the router may start'; return; }
      out.classList.remove('armed'); out.disabled = true; out.textContent = 'router on…';
      await m.testOutput(1, 2000).catch(e => say(e.message, 'bad'));
      out.disabled = false; out.textContent = 'test the router (outputs 1 + 4) for 2 s';
    };
    el.card.append(
      h('h2', { text: 'Check the machine' }),
      h('p', { text: 'Once per machine. Keep a foot near the floor e-stop.' }),
      ...axes,
      h('h3', { text: 'inputs' }),
      h('p', { text: 'Touch the plate to the bit, or cover a sensor. The number that lights is that input.' }),
      dots,
      h('details', {}, h('summary', { text: 'home sensors (only if this machine has them)' }),
        h('p', { text: 'Hold something metal at the X home sensor. When its number lights, press X; then the same for Y.' }),
        h('div', { class: 'sr-pair' },
          h('button', { text: "that's X home", onclick: () => take('x') }),
          h('button', { text: "that's Y home", onclick: () => take('y') })),
        homeText),
      h('h3', { text: 'e-stop' }),
      h('p', { text: 'Hold the red e-stop button down. While its number lights, press this.' }),
      h('button', { text: "that's the e-stop", onclick: takeStop }),
      stopText,
      h('h3', { text: 'Z plate' }),
      h('p', { text: 'Clip on, touch the plate to the bit and hold it there.' }),
      h('button', { text: "that's the Z plate", onclick: takePlate }),
      plateText,
      h('h3', { text: 'router' }),
      out,
      h('div', { class: 'row' },
        h('button', { text: 'save log', onclick: saveLog }),
        h('button', { class: 'go', text: 'done', onclick: () => { try { localStorage.setItem(CHECKED, '1'); } catch (e) {} S.check = null; el.sheet.classList.remove('on'); } })));
    el.sheet.classList.add('on');
    updateCheck(st);
  }
  // inputs 1-8 = the card's first input byte, bits 0-7; 9-12 = its second, bits 0-3; lit = changed since the card opened
  function updateCheck(st) {
    const c = S.check;
    if (!c || !st.inputs) return;
    if (!c.base) c.base = { ...st.inputs };
    c.dots.forEach((d, i) => {
      const [now, was] = i < 8 ? [st.inputs.lo >> i & 1, c.base.lo >> i & 1] : [st.inputs.hi >> (i - 8) & 1, c.base.hi >> (i - 8) & 1];
      d.classList.toggle('on', now !== was);
    });
  }
  function saveLog() {
    if (!isDirect()) return;
    const a = h('a', { href: URL.createObjectURL(new Blob([S.machine.logText()], { type: 'text/plain' })), download: `shopbot-usb-${new Date().toISOString().replace(/[:.]/g, '-')}.txt` });
    document.body.append(a); a.click(); a.remove();
  }

  function pauseResume() {
    const st = S.machine.state;
    if (st.paused) resumeNow(); else S.machine.pause();
  }
  // Resume runs a plan of its own: the veil shows its way back in, and pressing
  // resume arms that plan, and only it. The simulator keeps its own queue (no plan).
  function resumePlan() { return S.machine && S.machine.resumePlan ? S.machine.resumePlan() : null; }
  function resumeNow() {
    const plan = resumePlan();
    if (!plan) { S.machine.resume(); return; }
    if (plan.problems.length) { tell(`Not resumed: ${plan.problems[0]}.`, 'warn'); return; }
    S.runMoves = plan.moves; S.runIdx = 0;
    S.machine.resume(window.SwarfRunPlan.arm(plan));
  }

  // ------------------------------------------------------------ the MR-1 (swarf-grbl.js)
  // the job's machine is the MR-1 (setup › machine)
  // what turns the bit, and the machine, in the cards' words
  function spindleWord() { return isMR1() ? 'spindle' : 'router'; }
  function machineName() { return isMR1() ? 'MR-1' : 'ShopBot'; }
  function isMR1() {
    // a real machine connected decides; otherwise cam's machine
    if (isGrbl() && S.machine.state.connected) return true;
    if (isDirect() && S.machine.state.connected) return false;
    try { return /MR-1/i.test(window.kiri.api.conf.get().device.deviceName || ''); } catch (e) { return false; }
  }
  // the MR-1's working box for the file checks, from its machine profile (the board's own travel is checked on every plan)
  function mr1Limits() {
    let d = {};
    try { d = window.kiri.api.conf.get().device || {}; } catch (e) { /* no cam */ }
    return { x: [0, d.bedWidth || 500], y: [0, d.bedDepth || 500], z: [0, d.maxHeight || 150] };
  }
  const serialOK = () => !!(navigator && navigator.serial);
  const NO_SERIAL = () => `${browserName()} can't reach serial ports, so it can't run the MR-1. Everything else works here: design, toolpaths, simulate, export. To run the machine, open swarf in Chrome or Edge.`;
  function noSerialCard() {
    const api = window.kiri && window.kiri.api;
    const pre = ["<div class='f-col a-center swarf-shape'><h3>Running the MR-1 needs Chrome or Edge</h3>",
      `<p class='swarf-shape-why' style='color:inherit;max-width:360px'>${NO_SERIAL()}</p></div>`];
    return api.uc.confirm(undefined, { 'copy the link': 'copy', 'try control in the simulator': 'sim', cancel: false }, undefined, { pre }).then(v => {
      if (v === 'copy') { try { navigator.clipboard.writeText(location.origin + location.pathname); api.show.alert('The link is copied: paste it into Chrome or Edge.', 6); } catch (e) { /* no clipboard */ } return false; }
      return v === 'sim';
    });
  }
  // Chrome's reasons and the driver's, in plain words, for the MR-1
  function connWhyMR1(e) {
    const m = (e && (e.name + ': ' + e.message)) || String(e);
    if (/NotFoundError/.test(m) && /No port selected|No device selected/i.test(m)) return 'Chrome\'s port box closed without a choice. Press connect and pick the MR-1 (a USB serial port) in the box under the address bar.';
    if (/NotFoundError|no MR-1 on USB/.test(m)) return 'Chrome found no MR-1 it may offer. Check the USB cable and that the MR-1 is switched on, then press connect again.';
    if (/SecurityError|NotAllowedError/.test(m)) return 'Chrome blocks serial ports on this site. Click the icon left of the address, set Serial ports to Ask, reload, press connect.';
    if (/in use|another program has the port|InvalidState|busy|access/i.test(m)) return 'CutControl (or another swarf tab) has the MR-1\'s port. Quit CutControl and close other swarf tabs, then press connect. Only one program can use the port at a time.';
    if (/no GRBL board answered/.test(m)) return 'The port opened but no MR-1 answered. Press connect and pick the MR-1\'s port; if it repeats, switch the MR-1 off and on.';
    if (/did not send its settings/.test(m)) return 'The MR-1 answered but did not send its settings. Check the cable, then press connect again.';
    return `The MR-1 would not connect (${e && e.message ? e.message : m}). Press connect again; if it repeats, switch the MR-1 off and on.`;
  }
  // Connect to the MR-1: a port this page was allowed before connects by itself; the button asks once.
  // Every connect restarts the board, so it is never homed after one, and a zero comes back only
  // once it has homed again (homeGrbl) and its G54 still matches.
  async function connectGrbl(manual) {
    const G = window.SwarfGrbl && window.SwarfGrbl.GrblMachine;
    if (G && G.supported() && (manual || await G.known())) {
      if (S.machine instanceof G && S.machine.state.connected) return;
      const d = new G();
      let err = null;
      const ok = await d.connect(manual).catch(e => { err = e; d.set({ note: e.message }); return false; });
      S.connMsg = ok ? '' : manual ? connWhyMR1(err || { name: '', message: d.state.note }) : S.connMsg;
      if (ok) {
        if (S.estopHit) { S.estopHit = false; S.fault = null; S.hold = null; }
        S.connSession = (S.connSession || 0) + 1;
        if (S.machine && !(S.machine instanceof G)) forgetJob();
        if (S.zeroXY || S.zeroZ) rememberZero();
        S.zeroXY = S.zeroZ = S.traced = false; S.zx = S.zy = false; S.g54ok = null; S.keptZero = null; S.grblHomed = false;
        if (S.unsub) S.unsub();
        if (S.machine) { if (S.machine.stopPoll) S.machine.stopPoll(); else if (S.machine.timer) clearTimeout(S.machine.timer); }
        S.machine = d;
        d.onCue = name => { if (window.SwarfSound) SwarfSound.play(name); };
        S.unsub = d.on(onState);
        return;
      }
      if (manual && !err && d.state.note !== 'no MR-1 on USB') { refresh(); return; }
    }
    if (S.machine && !manual) return;
    if (S.unsub) S.unsub();
    if (S.machine) { if (S.machine.stopPoll) S.machine.stopPoll(); else if (S.machine.timer) clearTimeout(S.machine.timer); }
    S.machine = new M.SimMachine();
    S.machine.timeScale = S.simRate;
    if (manual && !(G && G.supported())) S.connMsg = NO_SERIAL();
    S.unsub = S.machine.on(onState);
    refresh();
  }
  // the board lost its place (an alarm, a restart): its zero is unproven until it homes again
  function grblState(st) {
    const homed = !!(st.connected && st.homed);
    if (S.grblHomed && !homed) {
      if (S.zeroXY || S.zeroZ) rememberZero();
      S.zeroXY = S.zeroZ = S.traced = false; S.zx = S.zy = false; S.g54ok = null; S.keptZero = null;
    }
    S.grblHomed = homed;
  }
  // the G54 zero the MR-1 was given, kept beside the board's own so "use the zero from" can check it
  const G54_KEY = 'swarf-grbl-zero';
  function saveG54() {
    const g = S.machine && S.machine.offsets && S.machine.offsets.G54;
    if (!g) return;
    try { localStorage.setItem(G54_KEY, JSON.stringify({ g54: g, at: S.zeroSetAt || Date.now(), had: S.zeroHad || null, where: S.zeroAt == null ? null : S.zeroAt, bit: S.zBit || null })); } catch (e) { /* private window */ }
  }
  function savedG54() { try { return JSON.parse(localStorage.getItem(G54_KEY)) || null; } catch (e) { return null; } }
  async function homeGrbl() {
    const m = S.machine;
    if (!isGrbl()) return;
    refresh();
    const ok = await m.home();
    if (!ok) { tell(`Not homed: ${m.state.note}.`, 'bad'); refresh(); return; }
    // the zero set before: still the board's G54 (to 0.01 mm), axis by axis
    S.g54ok = null;
    const z = savedG54();
    if (z && z.g54) {
      const o = await m.readOffsets();
      const g = o && o.G54, near = a => !!g && Math.abs(g[a] - z.g54[a]) <= 0.01;
      S.g54ok = { xy: near('x') && near('y'), z: near('z') };
      // after a reload the zero's record comes from beside the board's
      if (!S.zeroHad && z.had && zeroFresh(z.at)) { S.zeroHad = z.had; S.zeroSetAt = z.at; S.zeroAt = z.where == null ? undefined : z.where; S.zBit = z.bit || undefined; }
    }
    const back = zeroFresh(S.zeroSetAt) && S.g54ok && S.zeroHad && ((S.zeroHad.xy && S.g54ok.xy) || (S.zeroHad.z && S.g54ok.z));
    tell(back ? `Homed. The zero from ${zeroWhen(S.zeroSetAt)} is still on the MR-1: press "use the zero from" if the board has not moved, or zero again.` : 'Homed. Now jog the bit over your X 0, Y 0 and press zero x y.');
    refresh();
  }
  // The MR-1's machine check: what the board reports, read only. Its inputs light live, so each
  // switch can be pressed by hand and seen; the capture saves everything the board sent.
  function mr1Check() {
    const m = S.machine;
    if (!isGrbl() || !m.state.connected) return;
    const s = m.settings || {}, g = m.offsets && m.offsets.G54;
    const val = (k, u) => s[k] === undefined ? '—' : `${s[k]}${u ? ' ' + u : ''}`;
    const onOff = k => s[k] === 1 ? 'on' : s[k] === 0 ? 'off' : '—';
    const rows = [
      ['port', m.portInfo() || 'no USB ids reported'],
      ['board', m.raw.banner || `Grbl ${m.version || ''}`],
      ['reports in', s[13] === 1 ? 'inches ($13=1): swarf turns them into mm' : s[13] === 0 ? 'mm ($13=0)' : '—'],
      ['homing ($22)', onOff(22)],
      ['limit switches ($21)', onOff(21)],
      ['soft limits ($20)', s[20] === 0 ? 'off: swarf keeps every move 2 mm inside the travel itself' : onOff(20)],
      ['travel ($130-$132)', `X ${val(130)} · Y ${val(131)} · Z ${val(132)} mm`],
      ['top speeds ($110-$112)', `X ${val(110)} · Y ${val(111)} · Z ${val(112)} mm/min`],
      ['spindle top ($30)', val(30, 'rpm')],
      ['work zero (G54)', g ? `X ${g.x.toFixed(3)} · Y ${g.y.toFixed(3)} · Z ${g.z.toFixed(3)} mm` : '—']
    ];
    const LETTERS = [['X', 'x', 'X limit switch'], ['Y', 'y', 'Y limit switch'], ['Z', 'z', 'Z limit switch'], ['P', 'p', 'probe or tool setter'], ['D', 'd', 'door'], ['H', 'h', 'hold'], ['R', 'r', 'reset'], ['S', 's', 'cycle start']];
    const dots = h('div', { class: 'sr-dots' }), lit = LETTERS.map(([L, k, t]) => { const d = h('i', { text: L, title: t }); dots.append(d); return [k, d]; });
    const live = h('p', { class: 'sr-mr1live' }), pinText = h('p'), q = h('p');
    S.mr1Watch = st => {
      live.textContent = `now: ${st.grbl || '…'}${st.homed ? ', homed' : ', not homed'} · machine ${st.mpos ? ['x', 'y', 'z'].map(a => `${a.toUpperCase()} ${st.mpos[a].toFixed(3)}`).join(' ') : '—'} mm`;
      const p = st.pins || {};
      for (const [k, d] of lit) d.classList.toggle('on', !!p[k]);
      pinText.textContent = p.raw ? `inputs active now: ${p.raw}` : 'no input reads active';
      q.textContent = st.q !== undefined ? `input selected (Q): ${st.q}` : '';
      q.style.display = st.q !== undefined ? '' : 'none';
    };
    el.card.innerHTML = '';
    el.card.append(h('h2', { text: 'Machine check (nothing moves)' }),
      h('p', { text: 'What the MR-1 reports. Press each limit switch by hand, then the tool setter: its letter lights. Then press the e-stop and note what this card says.' }),
      h('div', { class: 'sr-mr1chk' }, ...rows.map(([k, v]) => h('div', { class: 'sr-row' }, h('span', { text: k }), h('span', { text: v })))),
      live, dots, pinText, q,
      h('details', {}, h('summary', { text: 'everything the board sent ($$, $#, $I)' }), h('pre', { class: 'sr-mr1raw', text: m.capture() })),
      h('div', { class: 'row' },
        h('button', { text: 'save the capture', title: 'Every line to and from the board, as a text file', onclick: saveCapture }),
        h('button', { class: 'go', text: 'done', onclick: () => { S.mr1Watch = null; el.sheet.classList.remove('on'); refresh(); } })));
    el.sheet.classList.add('on');
    S.mr1Watch(m.state);
  }
  function saveCapture() {
    if (!isGrbl()) return;
    const m = S.machine;
    const text = m.capture() + '\n--- every line, ms since the first (> to the board, < from it) ---\n' + m.logText();
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: `mr1-check-${new Date().toISOString().replace(/[:.]/g, '-')}.txt` });
    document.body.append(a); a.click(); a.remove();
  }
  // a machine of the other kind still held (the job's machine was switched): let it go, so connect finds the right one
  function letGoOfOther() {
    const m = S.machine;
    const wrong = (isMR1() && isDirect()) || (!isMR1() && isGrbl());
    if (!m || !wrong || m.state.running) return Promise.resolve();
    if (S.unsub) S.unsub();
    S.unsub = null;
    if (m.stopPoll) m.stopPoll();
    S.machine = null;
    return Promise.resolve(m.disconnect ? m.disconnect() : true).catch(() => {});
  }

  // ------------------------------------------------------------ machine
  // One connect at a time: the page's own connect and a click must not both
  // open the box.
  async function disconnect() {
    const d = S.machine;
    if (!(d && d.disconnect)) return;
    if (await d.disconnect()) {
      // the zero stays: on reconnect swarf asks to keep it,
      // and a count that moved while away (a restart, or another program's moves) drops it as before
      S.discAt = Date.now(); S.discWhy = '';
      tell(onWindows() ? 'Disconnected. ShopBot 3 can use the box now (zero again in it). Press connect to come back: swarf asks whether its zero still holds.' : 'Disconnected. Press connect to come back: swarf asks whether the zero still holds.', 'warn');
    } else tell(`Still connected: ${d.state.note}.`, 'bad');
    refresh();
  }
  function connect(manual) {
    S.connecting = (S.connecting || Promise.resolve()).then(() => connectNow(manual), () => connectNow(manual));
    return S.connecting;
  }

  // Chrome's own reasons, in plain words (never a silent connect)
  function connWhy(e) {
    const m = (e && (e.name + ': ' + e.message)) || String(e);
    if (e && e.next) return `${e.message[0].toUpperCase()}${e.message.slice(1)}.`;   // which chooser comes next (Windows)
    if (/COM port is in use/.test(m)) return 'ShopBot 3 (or another program) has the box\'s COM port. Quit ShopBot 3, then press connect. Only one program can use the box at a time.';
    if (onWindows() && /NotFoundError/.test(m)) return `Chrome found no ShopBot. On the shop PC, press connect and pick the ShopBot Controller (COM) port. On your own laptop, the box needs a one-time driver first: help, then search "windows laptop". ${WIN_ONE}`;
    if (onWindows() && /SecurityError/.test(m) && /gesture|activation/i.test(m)) return 'Press connect once more: Chrome shows its USB box now.';
    if (/NotFoundError/.test(m) && /No device selected/i.test(m)) return 'Chrome\'s USB box closed without a choice. Press connect, pick V204ShopBot in the box under the address bar, then Connect.';
    if (/NotFoundError/.test(m)) return 'Chrome found no ShopBot it may offer. Check the cable, then press connect again.';
    if (onWindows() && /SecurityError|NotAllowedError/.test(m)) return 'Chrome blocks serial ports on this site. Click the icon left of the address, set Serial ports to Ask, reload, press connect.';
    if (/SecurityError|NotAllowedError/.test(m)) return 'Chrome blocks USB on this site. Click the icon left of the address, set USB devices to Ask, reload, press connect.';
    // WebUSB on a PC where ShopBot's driver owns the box: Chrome may list it but cannot open it
    if (onWindows() && /access denied|Unable to claim/i.test(m)) return 'Windows gives the box to ShopBot\'s driver on this PC: press connect and pick the ShopBot Controller (COM) port instead. Quit ShopBot 3 first.';
    if (/claim|busy|access|in use|InvalidState/i.test(m)) return 'Another tab or program has the box open. Close other swarf tabs, then press connect.';
    return `The box would not connect (${m}). Press connect again; if it repeats, switch the box off and on.`;
  }
  // a page that loaded half its files from one deploy and half from the next must not drive the machine
  function buildsAgree() {
    const want = window.SWARF_BUILD, b = window.SWARF_BUILDS || {};
    return !want || Object.values(b).every(v => v === want);
  }
  async function connectNow(manual) {
    if (manual && !buildsAgree()) { S.connMsg = 'This page has files from two swarf builds (an update arrived while it loaded). Tap the version stamp in the corner to reload before you run the machine.'; tell(S.connMsg, 'bad'); refresh(); return; }
    if (isMR1()) return connectGrbl(manual);
    // swarf drives the box itself, over USB (Chrome/Edge). A box this page was allowed before connects by itself; the
    // connect button asks once. Without a box: the simulator.
    const D = M.DirectMachine;
    // the first press on this page says it out loud too, apart from the control line (which an error replaces)
    if (manual && onWindows() && !S.winSaid) { S.winSaid = true; try { window.kiri.api.show.alert(WIN_ONE, 10); } catch (e) { /* no kiri alert */ } }
    if (D && D.supported() && (manual || await D.known())) {
      if (S.machine instanceof D && S.machine.state.connected) return;
      const d = new D();
      let err = null;
      const ok = await d.connect(manual).catch(e => { err = e; d.set({ note: e.message }); return false; });
      S.connMsg = ok ? '' : manual ? (err ? connWhy(err) : d.state.note === 'no ShopBot on USB' ? connWhy({ name: 'NotFoundError', message: '' }) : `The box did not answer: ${d.state.note}.`) : S.connMsg;
      if (ok) {
        // connecting again after the e-stop is the student's say-so: its warnings go
        if (S.estopHit) { S.estopHit = false; S.fault = null; S.hold = null; }
        S.connSession = (S.connSession || 0) + 1;   // a table corner learned before this connection no longer counts
        // coming from the simulator or the MR-1: their zero, trace and stopped line are not this box's
        if (S.machine && !(S.machine instanceof D)) forgetJob();
        // the card keeps its count while powered; a count that moved while unplugged means a restart
        const was = S.lastSteps, now = d.steps;
        // up to two queued blocks (~300 ticks) still run after a drop; a restart moves the count far more
        // a saved origin read back broken and reset: the zero kept with it is gone too
        if (d.originRepaired) {
          S.zeroXY = S.zeroZ = S.traced = false; S.zx = S.zy = false; S.zeroSetAt = 0; S.zeroHad = null;
          saveZero();
        } else if (was && ['x', 'y', 'z'].some(a => Math.abs(was[a] - now[a]) > 600)) {
          S.zeroXY = S.zeroZ = S.traced = false; S.zx = S.zy = false; S.zeroSetAt = 0; S.zeroHad = null; S.zeroLost = true;
          saveZero();
          setCorner(null);   // the count restarted: the table's corner is unknown again
        } else if (was && (S.zeroXY || S.zeroZ || S.zeroHad)) {
          rememberZero();
          // an unchanged count cannot prove the box did not restart near zero:
          // the zero is not reused by itself; "use the last zero" asks the student to say so
          S.zeroXY = S.zeroZ = S.traced = false; S.zx = S.zy = false; S.zeroReconnect = true;
        }
        if (S.unsub) S.unsub();
        if (S.machine) { if (S.machine.stopPoll) S.machine.stopPoll(); else if (S.machine.timer) clearTimeout(S.machine.timer); }
        S.machine = d;
        // the machine says when: about to move, the router about to start, finished once the bit has coasted
        d.onCue = name => { if (window.SwarfSound) SwarfSound.play(name); };
        S.unsub = d.on(onState);
        return;
      }
      if (manual && d.state.note !== 'no ShopBot on USB' && !err) { refresh(); return; }
    }
    if (S.machine && !manual) return;
    if (S.unsub) S.unsub();
    if (S.machine) { if (S.machine.stopPoll) S.machine.stopPoll(); else if (S.machine.timer) clearTimeout(S.machine.timer); }
    S.machine = new M.SimMachine();
    S.machine.timeScale = S.simRate;
    if (manual && !(D && D.supported())) S.connMsg = NO_USB();
    S.unsub = S.machine.on(onState);
    refresh();
  }

  function onState(st) {
    if (isDirect() && (st.connected || st.lostMid)) { S.lastSteps = { ...S.machine.steps }; if (S.zeroXY || S.zeroZ) rememberZero(); else saveZero(); }
    for (const a of ['x', 'y', 'z']) el.dro[a].textContent = posText(st.pos[a] || 0);
    if (isDirect() && st.mpos) for (const a of ['x', 'y', 'z']) el.dro[a].title = `machine count ${st.mpos[a].toFixed(2)} mm · click to type a position`;
    el.mpos.textContent = isDirect() && st.mpos
      ? `machine ${['x', 'y', 'z'].map(a => a.toUpperCase() + ' ' + st.mpos[a].toFixed(1)).join(' ')} · ${S.machine.limitsKnown() ? 'limits on' : 'no end stops: watch the ends'}`
      : isGrbl() && st.mpos ? `machine ${['x', 'y', 'z'].map(a => a.toUpperCase() + ' ' + st.mpos[a].toFixed(1)).join(' ')} · ${st.homed ? 'homed: jogs stop 2 mm short of each end' : 'not homed'}`
      : '';
    if (isGrbl()) grblState(st);
    const tc = S.machine.mabs && corner();
    if (tc) { const p = S.machine.mabs(); el.mpos.textContent = `from the table's front-left corner: X ${(p.x - tc.x).toFixed(1)} Y ${(p.y - tc.y).toFixed(1)}` + (el.mpos.textContent ? ' · ' + el.mpos.textContent : ''); }
    view.setTool(st.pos);
    if (st.running) view.progress(st.line || 0);
    const sim = st.kind === 'sim';
    el.conn.className = 'sr-conn ' + (sim ? 'sim' : st.connected ? 'live' : '');
    const what = st.running ? (st.paused ? 'paused' : (S.job === 'trace' || S.job === 'air') ? 'test run' : 'cutting') : st.moving ? 'moving' : 'idle';
    el.connText.textContent = sim ? `simulator · ${what}` : st.connected ? `connected · ${what}${st.spindle ? (isGrbl() ? ' · spindle on' : ' · router on') : ''}` : 'not connected';
    el.target.textContent = sim ? 'practice simulator' : st.connected ? (isGrbl() ? 'MR-1' : 'ShopBot') : 'no machine';
    el.target.className = 'sr-target ' + (sim ? 'sim' : st.connected ? 'live' : 'off');
    el.conn.title = sim ? `The simulator, not the machine: plug in the ${isMR1() ? 'MR-1' : 'ShopBot'}, press connect` : '';
    el.connBtn.style.display = st.connected && !sim ? 'none' : '';
    el.discBtn.style.display = st.connected && !sim ? '' : 'none';
    const airing = isDirect() && st.running && S.job === 'air';
    // the MR-1's board scales cutting feeds only: shown for a cut, not for a trace or an air cut
    el.ovr.style.display = (isDirect() && st.running && !airing) || (isGrbl() && st.running && (S.job === 'cut' || S.job === 'from')) ? '' : 'none';
    el.rate.style.display = airing ? '' : 'none';
    if (airing) {
      if (document.activeElement !== el.rateIn) el.rateIn.value = st.rate || 100;
      el.rateVal.textContent = `${st.rate || 100}%${st.overrideHeld ? ' (held)' : ''}`;
      el.rateVal.title = st.overrideHeld ? 'Some moves stay slower: the machine\'s speed limits hold' : '';
    }
    el.ovrVal.textContent = `${st.override || 100}%${st.overrideHeld ? ' (held)' : ''}`;
    el.ovrVal.title = st.overrideHeld ? 'Some moves run slower or faster: the machine\'s limits hold' : '';
    el.ovrDn.disabled = (st.override || 100) <= 50; el.ovrUp.disabled = (st.override || 100) >= 150;
    el.discBtn.disabled = !!(st.running || st.moving);
    el.simCtl.style.display = sim ? '' : 'none';
    el.big.textContent = st.dialog ? 'waiting for you' : st.running ? (st.paused ? 'paused' : (S.job === 'trace' || S.job === 'air') ? 'test run' : 'cutting') : st.moving ? 'moving' : st.connected ? 'idle' : 'offline';
    el.rows.innerHTML = '';
    const row = (k, v) => el.rows.append(h('div', { class: 'sr-row' }, h('span', { text: k }), h('span', { text: v })));
    row(isGrbl() ? 'spindle' : 'router', st.routerUnknown ? 'unknown' : st.spindle ? 'on' : 'off');
    if (isGrbl()) row('board', `${st.grbl || '…'}${st.homed ? ' · homed' : ''}`);
    if (!sim && st.note && !st.running) el.rows.append(h('div', { class: 'sr-row note', text: st.note }));
    el.ask.classList.toggle('on', !!st.dialog);
    const veiled = !!(st.running && st.paused);
    if (veiled && !el.veil.classList.contains('on') && document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (veiled && !el.veil.classList.contains('on') && el.veilWay) {
      const rp = resumePlan(), way = rp && window.SwarfRunPlan ? wayWords(rp) : '';
      el.veilWay.textContent = rp && rp.problems.length ? `It can't resume: ${rp.problems[0]}.` : way ? `On resume: ${way}.` : '';
      el.veilWay.classList.toggle('bad', !!(rp && rp.problems.length));
      if (el.resumeBtn) {
        el.resumeBtn.disabled = !!(rp && rp.problems.length);
        // the button says what the plan does: a pause on the way in has no router to start
        // a trace or an air cut never had the router on (never "start the router")
        const dry = S.job === 'trace' || S.job === 'air';
        el.resumeBtn.textContent = !dry && !isGrbl() && (!rp || rp.steps.some(x => x.router === true)) ? 'start the router and resume' : 'resume';
      }
    }
    // the words follow every state while it shows: the MR-1's spindle stops a moment after the pause
    if (veiled) {
      const dry = S.job === 'trace' || S.job === 'air';
      const h2 = el.veil.querySelector('h2'), p = el.veil.querySelector('.sr-veilcard p');
      // the MR-1's card follows the driver's spin state: stopping, off, idle (it was not turning),
      // unsure (the board never said it stopped), starting (resume brings it back), turning (held at the machine)
      const spin = isGrbl() && st ? st.spin || 'stopping' : '';
      const SPIN = {
        stopping: ['Paused. Spindle stopping.', 'Keep clear.'],
        off: ['Paused. Spindle off.', 'Resume starts it here, waits for it, then cuts on.'],
        idle: ['Paused.', 'Resume carries on from here.'],
        unsure: ['Paused. The spindle may still be turning.', 'Keep clear of the bit.'],
        starting: ['Starting the spindle.', `Keep clear: it moves again in ${(S.machine && S.machine.cfg && S.machine.cfg.spinUp) || 2} seconds.`],
        turning: ['Paused at the machine.', 'The spindle is still turning: keep clear.']
      }[spin] || ['Paused.', 'Keep clear.'];
      if (h2) h2.textContent = dry ? `Paused. The ${S.job === 'air' ? 'air cut' : 'trace'} runs with the ${isGrbl() ? 'spindle' : 'router'} off.` : isGrbl() ? SPIN[0] : 'Paused. The router is switched off.';
      if (p) p.textContent = dry ? 'Resume carries on from here.'
        : isGrbl() ? SPIN[1]
        : 'It slows for a few seconds before it stops turning. Resume starts the router and carries on from here.';
      if (el.resumeBtn) el.resumeBtn.style.visibility = isGrbl() && spin === 'starting' ? 'hidden' : '';
      if (el.resumeBtn && isGrbl() && !dry) el.resumeBtn.textContent = spin === 'off' ? 'start the spindle and resume' : 'resume';
    }
    if (el.faultBar) {
      el.faultBar.style.display = S.fault ? '' : 'none';
      if (S.fault) el.faultText.textContent = `${S.fault[0].toUpperCase()}${S.fault.slice(1)}. Check the machine, then:`;
    }
    el.veil.classList.toggle('on', veiled);
    el.veil.parentElement.classList.toggle('sr-veiled', veiled);   // its buttons only: the ones under it hide
    el.checkBtn.style.display = isDirect() && st.connected ? '' : 'none';
    // the MR-1: no Z plate (its tool setter comes later) and no table corners (it homes to its own)
    el.plateBtn.style.display = st.connected && !isGrbl() ? '' : 'none';
    el.cornersBtn.style.display = st.connected && !st.running && !isGrbl() ? '' : 'none';
    el.mr1CheckBtn.style.display = isGrbl() && st.connected && !st.running ? '' : 'none';
    el.plateBtn.classList.toggle('next', !!(S.prog && S.zeroXY && (!S.zeroZ || S.toolChange) && !st.running));
    const hs = isDirect() && S.machine.homeCfg && S.machine.homeCfg.set;
    // the shop machine has no home switches and is zeroed by hand: Home only once both sensors are set
    el.homeBtn.style.display = (hs && hs.x && hs.y) || (isGrbl() && st.connected && !st.running) ? '' : 'none';
    el.homeBtn.classList.toggle('next', isGrbl() && !!st.connected && !st.homed && !st.refused);
    el.routerBtn.style.display = isDirect() && st.connected ? '' : 'none';
    el.routerBtn.classList.toggle('on', !!st.routerTest);
    el.routerBtn.disabled = !!(st.running || st.moving) && !st.routerTest;
    el.routerBtn.querySelector('small').textContent = st.routerTest ? 'on: stop' : 'test';
    el.note.textContent = isDirect()
      ? 'In an emergency, step on the red e-stop on the floor and keep clear until everything has stopped.'
      : isGrbl() ? 'In an emergency, press the MR-1\'s e-stop and keep clear until everything has stopped.'
      : `This is the simulator, not the machine. Press connect with the ${isMR1() ? 'MR-1' : 'ShopBot'} plugged in.`;
    if (S.check) updateCheck(st);
    if (S.mr1Watch) S.mr1Watch(st);
    if (S.plateWatch) S.plateWatch(st);
    // directions proven on the real box (no flips), so the check card waits for its button
    if (st.dialog) el.askText.textContent = st.dialog.caption || st.dialog.message || '';
    // a finished trace completes the trace step; a stopped one does not
    if ((st.kind === 'shopbot' || st.kind === 'grbl') && st.running) st.line = lineAt(st.pos);
    if (st.routerUnknown && !S.fault && !st.estopped) S.fault = isGrbl() ? 'swarf could not tell whether the spindle was still on' : 'swarf could not tell whether the router was still on';
    // the e-stop latches once, when its note first appears (the note stays in the state after)
    // the e-stop: swarf lets go of the machine, and connecting again clears it, so no
    // all-clear checklist; the zero is offered back on reconnect
    if ((st.note || '') !== S.prevNote && /stopped by the (e-stop|remote stop)/.test(st.note || '')) { S.estopHit = true; S.discAt = Date.now(); S.discWhy = 'the e-stop'; S.hold = null; }
    S.prevNote = st.note || '';
    if (S.lastRunning && !st.running) keepAwake(false);
    if (S.lastRunning && !st.running) {
      // only a real end of file is a finish: a stop, a hold or a dropped link keeps the line
      const finished = !S.userStopped && !st.stopHit && !st.lostMid && (st.kind === 'shopbot' || st.kind === 'grbl' ? st.done === true : /finished/.test(st.note));
      S.userStopped = false;
      // the MR-1 still connected after a job ended mid-file restarted (power, its e-stop, the cable)
      if (st.lostMid && !S.fault && isGrbl() && st.connected) S.fault = `the MR-1 restarted at line ${S.lastLine || 1} while it was running: it is not homed and its zero is unproven`;
      if (st.lostMid && !S.fault) S.fault = st.connected ? `the machine stopped at line ${S.lastLine || 1} mid-job (the computer paused or the stream ran dry)` : `the USB link dropped at line ${S.lastLine || 1} while the machine was running`;
      if (st.lostMid && (S.job === 'cut' || S.job === 'from')) {
        S.lostAt = S.stoppedAt = S.lastLine || 1;
        el.fromLine.value = String(S.stoppedAt);
      } else if (st.toolChange && (S.job === 'cut' || S.job === 'from')) {
        S.stoppedAt = st.resumeLine; el.fromLine.value = String(S.stoppedAt);
        const t = fileTools();
        // the bit this change loads: the last name given at or before the change line
        const next = S.prog.parsed.events.filter(e => e.kind === 'tool-name' && e.line <= st.resumeLine - 1).pop();
        S.toolChange = `Tool change at line ${st.resumeLine - 1}${next ? `: put in the ${next.value}.` : '.'}`;
        S.zeroZ = false; S.zStale = true;
      } else if (finished) {
        if (S.job === 'trace') S.traced = true;
        S.lastDone = S.job;
        try { window.dispatchEvent(new CustomEvent('swarf.run.finished', { detail: { job: S.job, prog: S.prog } })); } catch (e) { /* old browser */ }
        S.stoppedAt = 0;
      } else if (S.job === 'cut' || S.job === 'from') {
        S.stoppedAt = st.resumeLine || S.lastLine || 0;
        if (S.stoppedAt) el.fromLine.value = String(S.stoppedAt);
      }
      S.job = null;
    }
    if (st.running) { S.lastLine = st.line || S.lastLine; S.lostAt = 0; }
    S.lastRunning = st.running;
    refresh();
  }

  // The USB card does not report the line it is on; take the nearest segment of the
  // running program, searching forward from the last match so loops in the
  // path do not send it backwards.
  function lineAt(p) {
    const moves = S.runMoves;
    if (!moves || !moves.length) return 0;
    let best = S.runIdx || 0, bd = Infinity;
    const end = Math.min(moves.length, best + 600);
    for (let i = best; i < end; i++) {
      const m = moves[i];
      const dx = m.x - m.x0, dy = m.y - m.y0, dz = m.z - m.z0;
      const L = dx * dx + dy * dy + dz * dz;
      let t = L ? ((p.x - m.x0) * dx + (p.y - m.y0) * dy + (p.z - m.z0) * dz) / L : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(m.x0 + dx * t - p.x, m.y0 + dy * t - p.y, m.z0 + dz * t - p.z);
      if (d < bd - 1e-6) { bd = d; best = i; }
    }
    S.runIdx = best;
    return moves[best].line;
  }

  // ------------------------------------------------------------ open/close
  function place() {
    const tools = document.getElementById('mode-tools');
    const top = tools ? Math.round(tools.getBoundingClientRect().bottom) + 8 : 0;
    if (el.root) el.root.style.top = top + 'px';
  }
  function open() {
    if (!el.root) build();
    else if (S.rowsUnit !== (inch() ? 'in' : 'mm')) { rateRows(); renderPlan(); }
    place();
    if (!S.placeHooked) { window.addEventListener('resize', place); S.placeHooked = true; }
    el.root.classList.add('open');
    const step = document.getElementById('swarf-step-run');
    if (step) step.classList.add('swarf-step-on');
    document.body.classList.add('swarf-run-open');   // lifts swarf's phase filters (the gray after export) off Run
    S.open = true;
    view.wake();
    if (!S.machine) connect(false);
    view.resize(el.view);
    refresh();
  }
  function close() {
    playStop();
    if (S.machine && S.machine.state.running) { tell('Stop the job before leaving control.', 'warn', true); return; }
    // a card left open closes with control, so nothing behind it stays inert
    if (el.sheet && el.sheet.classList.contains('on')) { S.plateWatch = null; S.mr1Watch = null; S.afterZero = null; el.sheet.classList.remove('on'); }
    el.root.classList.remove('open');
    const step = document.getElementById('swarf-step-run');
    if (step) step.classList.remove('swarf-step-on');
    document.body.classList.remove('swarf-run-open', 'swarf-run-busy');
    S.open = false;
  }

  // Entry: RUN, the last step in cam's step row (after export). ShopBot only:
  // for another machine it says where to go instead.
  function isShopBot() {
    const api = window.kiri && window.kiri.api;
    try { return /shopbot/i.test(api.conf.get().device.deviceName || ''); } catch (e) { return false; }
  }
  // Safari and Firefox have no WebUSB: only Chrome-family browsers can drive the box
  // (said early and at the right time that Safari doesn't work)
  const usbOK = () => !!(window.ShopBotLink ? ShopBotLink.supported() : navigator && navigator.usb);
  // Windows reaches the box through ShopBot's own COM port, which one program holds at a time (said
  // whenever the Windows version is used)
  const onWindows = () => !!(window.ShopBotLink && ShopBotLink.windows && ShopBotLink.windows() && ShopBotLink.supported());
  const WIN_ONE = 'On Windows, quit ShopBot 3 before you press connect: only one program can use the box at a time. To go back to ShopBot 3, press disconnect (or close this tab) first, then zero again in ShopBot 3.';
  function browserName() {
    const u = navigator.userAgent || '';
    return /Firefox\//.test(u) ? 'Firefox' : /Safari\//.test(u) && !/Chrome\/|Chromium\//.test(u) ? 'Safari' : 'this browser';
  }
  const NO_USB = () => `${browserName()} can't reach USB, so it can't run the ShopBot. Everything else works here: design, toolpaths, simulate, export. To run the machine, open swarf in Chrome or Edge.`;
  // early: once, when the ShopBot is (or becomes) the machine in a browser without USB
  function warnNoUsb() {
    const api = window.kiri && window.kiri.api;
    if (usbOK() || S.usbWarned || !isShopBot() || !api || !api.show || !api.show.alert) return;
    S.usbWarned = true;
    api.show.alert(NO_USB(), 12);
  }
  // at the right time: pressing control, before anything opens
  function noUsbCard() {
    const api = window.kiri && window.kiri.api;
    const pre = ["<div class='f-col a-center swarf-shape'><h3>Running the ShopBot needs Chrome or Edge</h3>",
      `<p class='swarf-shape-why' style='color:inherit;max-width:360px'>${NO_USB()}</p></div>`];
    return api.uc.confirm(undefined, { 'copy the link': 'copy', 'try control in the simulator': 'sim', cancel: false }, undefined, { pre }).then(v => {
      if (v === 'copy') { try { navigator.clipboard.writeText(location.origin + location.pathname); api.show.alert('The link is copied: paste it into Chrome or Edge.', 6); } catch (e) { /* no clipboard */ } return false; }
      return v === 'sim';
    });
  }
  function runStep() {
    const api = window.kiri && window.kiri.api;
    if (isMR1()) {
      if (!serialOK() && !S.simOK && api && api.uc) {
        noSerialCard().then(go => { if (go) { S.simOK = true; runStep(); } });
        return;
      }
      letGoOfOther().then(() => {
        open();
        if (!(S.machine && S.machine.state.running)) fromCam();
      });
      return;
    }
    if (!usbOK() && isShopBot() && !S.simOK && api && api.uc) {
      noUsbCard().then(go => { if (go) { S.simOK = true; runStep(); } });
      return;
    }
    // not set up for the ShopBot: offer it here, one press (a shop with one
    // machine is not sent to find setup › machine first)
    if (!isShopBot()) {
      if (!api || !api.uc || !api.devices) return;
      const pre = ["<div class='f-col a-center swarf-shape'><h3>Control drives the ShopBot and the MR-1</h3>",
        "<p class='swarf-shape-why' style='color:inherit;max-width:340px'>This job is set up for another machine. Switch it to the ShopBot (a 4 × 8 ft bed) or the MR-1 (the benchtop mill) and go on to control?</p></div>"];
      api.uc.confirm(undefined, { 'use the ShopBot': 'ShopBot.Basic', 'use the MR-1': 'Langmuir.MR-1', cancel: false }, undefined, { pre }).then(v => {
        if (!v) return;
        try { api.devices.select(v); } catch (e) { api.show.alert(`swarf could not switch the machine: ${e.message}`, 8); return; }
        setTimeout(() => { placeEntry(); if (isShopBot() || isMR1()) runStep(); }, 400);
      });
      return;
    }
    // a MR-1 still held from before the switch is let go first
    if (isGrbl() && !S.machine.state.running) { letGoOfOther().then(() => runStep()); return; }
    open();
    // control runs what cam made: fresh toolpaths each time, unless a job is running
    if (!(S.machine && S.machine.state.running)) fromCam();
  }
  function placeEntry() {
    const step = document.getElementById('swarf-step-run');
    if (!step) return false;
    if (!step.dataset.wired) { step.addEventListener('click', runStep); step.dataset.wired = '1'; }
    const mr1 = isMR1(), sb = isShopBot() || mr1;
    step.classList.toggle('swarf-step-off', !sb);
    // control is the ShopBot's and the MR-1's: another machine has no control step
    step.style.display = sb ? '' : 'none';
    if (sb && !mr1) warnNoUsb();
    step.title = mr1 ? (serialOK() ? 'Control the MR-1: bring these toolpaths, home, jog, zero, trace, cut' : 'Control: needs Chrome or Edge')
      : sb && !usbOK() ? 'Control: needs Chrome or Edge' : sb ? 'Control the ShopBot: bring these toolpaths, jog, zero, trace, cut' : '';
    return true;
  }
  let tries = 0;
  const poll = setInterval(() => {
    const api = window.kiri && window.kiri.api;
    if ((api && api.event && placeEntry()) || ++tries > 200) {
      clearInterval(poll);
      if (api && api.event) {
        for (const ev of ['device.selected', 'settings.saved', 'device.select']) api.event.on(ev, () => placeEntry());
        // EXPORT and control must never send old paths: a change to the parts, the
        // stock or the machine forgets the finished toolpaths so cam makes them again.
        // Changes during (or just after) a toolpath run are cam's own and are ignored.
        let making = false, endedAt = 0;
        api.event.on('preview.begin', () => { making = true; });
        for (const ev of ['preview.end', 'preview.error']) api.event.on(ev, () => { making = false; endedAt = Date.now(); });
        const stale = () => { if (!making && Date.now() - endedAt > 800 && api.function.clear_progress) api.function.clear_progress(); };
        for (const ev of ['widget.add', 'widget.delete', 'widget.duplicate', 'selection.move', 'selection.rotate', 'selection.scale', 'selection.drag', 'device.selected', 'cam.stock.toggle', 'settings.saved']) api.event.on(ev, stale);
        // in control, the other steps lead back to cam (a running job keeps control)
        const tools = document.getElementById('mode-tools');
        if (tools) tools.addEventListener('click', e => {
          if (!S.open || e.target.closest('#swarf-step-run')) return;
          if (S.machine && S.machine.state.running) { e.stopPropagation(); e.preventDefault(); tell('Stop the job before leaving control.', 'warn', true); return; }
          close();
        }, true);
      }
    }
  }, 150);

  // renato.design/swarf-app/#control (or the older #run) opens straight into control
  if (location.hash === '#run' || location.hash === '#control') {
    const t = setInterval(() => { if (window.THREE && document.body) { clearInterval(t); open(); } }, 200);
  }

  // a card on control's sheet, for swarf-lessons.js: nodes in, the sheet shown; null hides it
  function card(nodes) {
    if (!el.root) build();
    // control closed meanwhile (a card due a moment after a cut): nothing opens over a hidden control
    if (nodes && !S.open) return;
    else if (S.rowsUnit !== (inch() ? 'in' : 'mm')) { rateRows(); renderPlan(); }
    if (!nodes) { el.sheet.classList.remove('on'); refresh(); return; }
    el.card.innerHTML = ''; el.card.append(...nodes); el.sheet.classList.add('on');
  }
  // another machine connected: the zero, the trace, a stopped line and a kept zero were the other one's
  function forgetJob() {
    S.zeroXY = S.zeroZ = S.traced = false; S.zx = S.zy = false;
    S.stoppedAt = 0; S.lostAt = 0; S.toolChange = null; S.keptZero = null; S.zStale = false; S.lastDone = null;
  }
  // a .swarf opened (swarf-file.js): the job control held is gone, and the reopened one is a new
  // job — no zero, no trace, no stop to go on from. The board's own zero is offered back, as for
  // any new file (help: keep the zero), never taken from the file.
  function forget() {
    if (S.machine && S.machine.state.running) return false;
    playStop();
    if (S.prog) rememberZero();
    S.prog = null; S.hold = null;
    S.zeroXY = S.zeroZ = S.traced = false;
    S.zx = S.zy = false; S.stoppedAt = 0; S.lastDone = null; S.toolChange = null; S.lostAt = 0;
    if (S.open) close();
    return true;
  }
  window.__swarfRun = { open, close, forget, loadProgram, card, tell: (t, c) => tell(t, c), state: S, view: () => view, preview: PV };
})();
