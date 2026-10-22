/**
 * swarf run — Run mode: drive the ShopBot from swarf.
 *
 * Layout (Phil, 10-22): preview upper left, blank until a program loads; jog
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
    check: 'Check: swarf reads the file: millimeters, fits the table, every line it can run.',
    zero: 'Zero: jog the bit to your board\'s X 0, Y 0 and press zero x y; then zero z, or use the z plate.',
    trace: 'Trace: the bit runs the rectangle the cut fills, 25 mm up, router off. An air cut runs the whole file above the board. Both need a program and the zero.',
    cut: 'Cut: after a trace, a short checklist, then the router starts.'
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
  // The shop router is a Porter-Cable 7518 with its own five-step dial (Phil 10-27).
  // Its five settings, from Porter-Cable's listings for the 7518 (10-27); its selector is marked in rpm.
  const DIAL = [[1, 10000], [2, 13000], [3, 16000], [4, 19000], [5, 21000]];
  function dialFor(rpm) {
    const d = DIAL.reduce((a, b) => Math.abs(b[1] - rpm) < Math.abs(a[1] - rpm) ? b : a);
    // a speed past the dial's ends says so plainly, never as two numbers that disagree (review 10-28b #25)
    if (rpm < DIAL[0][1]) return `setting 1, its slowest (${DIAL[0][1].toLocaleString()} rpm; the file asked ${rpm.toLocaleString()})`;
    if (rpm > DIAL[4][1]) return `setting 5, its fastest (${DIAL[4][1].toLocaleString()} rpm; the file asked ${rpm.toLocaleString()})`;
    return `setting ${d[0]} (${d[1].toLocaleString()} rpm${d[1] !== rpm ? `; the file asked ${rpm.toLocaleString()}` : ''})`;
  }
  // line: a continue from that line names the bit and speed in effect there, not the file's first
  // an inch file: the student confirms its size in both units before it moves (Phil 10-29)
  function inchItem() {
    const p = S.prog && S.prog.parsed;
    if (!p || p.units !== 'in') return null;
    const b = P.cutBounds(p);
    if (!b) return null;
    const w = b.max.x - b.min.x, d = b.max.y - b.min.y, z = -b.min.z;
    const i = v => +(v / 25.4).toFixed(3);
    return `this file is in inches: its cut is ${i(w)} × ${i(d)} in (${w.toFixed(1)} × ${d.toFixed(1)} mm), ${i(z)} in (${z.toFixed(1)} mm) deep, and that is your part`;
  }
  function checklist(line) {
    const t = fileTools(), o = originText();
    const ev = S.prog ? S.prog.parsed.events : [];
    const at = k => line ? ev.filter(e => e.kind === k && e.line < line && (k !== 'rpm' || e.value > 0)).pop() : null;
    const bit = (at('tool-name') || {}).value || t.names[0], rpm = (at('rpm') || {}).value || t.rpm[0];
    return [
      'your board lies flat, screwed or clamped down, and the bit clears every screw and clamp',
      inchItem(),
      bit ? `the bit in the router is the ${bit} this file ${line ? `uses at line ${line}` : 'was made for'}` : 'the bit in the router is the one this file was made for',
      rpm ? `the router is set to ${dialFor(rpm)}: swarf only switches it on and off` : null,
      S.plateUsed ? 'the Z plate and its clip are put away' : null,
      /^the /.test(o.z) ? `Z zero is on ${o.z}` : `Z zero is ${o.z}`,
      'safety glasses on, dust collection on',
      'I will stay at the machine until it finishes'
    ].filter(Boolean);
  }

  // ------------------------------------------------------------ state
  const S = {
    open: false, machine: null, unsub: null,
    prog: null,          // { name, text, parsed, source }
    zeroXY: false, zeroZ: false, traced: false,
    job: null,           // what is running: 'trace' | 'air' | 'cut' | 'from' | 'preview'
    lastRunning: false, jogStep: 1, jogSpeed: 2500, contHeld: null, simRate: 10   // 2500: above the motors' rough band, near ShopBot 3's jog (10-29)
  };  // a zero from before a reload: offered back once connected, if the card's count has not jumped
  try { const z = JSON.parse(localStorage.getItem('swarf-run-zero')); if (z && z.had && z.at && z.steps) { S.zeroHad = z.had; S.zeroSetAt = z.at; S.lastSteps = z.steps; } } catch (e) { /* none */ }

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
  font-family: "JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace; font-size: 13px; }
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
.sr-jog.locked > :not(.sr-lock):not(.sr-dro):not(.sr-jh) { opacity: .85; pointer-events: none; }   /* readable while locked (legibility pass 10-28); the lock line says why */   /* readable while locked (legibility pass 10-28) */
.sr-jog.locked .sr-dro { pointer-events: none; }
.sr-jog.offline > :not(.sr-lock):not(.sr-jh) { opacity: .4; pointer-events: none; filter: grayscale(1); }   /* not connected: nothing here can reach the machine */
.sr-keyrow { display: flex; align-items: center; gap: 10px; }
#swarf-run .sr-ovr { display: flex; align-items: center; gap: 8px; margin: 6px 0 2px; }
#swarf-run .sr-ovr .lbl { font-size: 12px; }
#swarf-run .sr-ovr b { min-width: 48px; text-align: center; font-variant-numeric: tabular-nums; }
#swarf-run .sr-ovr button { padding: 4px 12px; }
#swarf-run .sr-bedmap { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; pointer-events: auto; }
#swarf-run .sr-bedmap svg { width: 64px; height: auto; display: block; }
#swarf-run .sr-bedmap rect { fill: none; stroke: currentColor; stroke-width: 1.6; opacity: .75; }
#swarf-run .sr-bedmap circle { fill: currentColor; }
#swarf-run .sr-bedmap path { fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; opacity: .8; }
#swarf-run .sr-bedmap text { font: 600 8px system-ui, sans-serif; fill: currentColor; }
#swarf-run .sr-bedmap small { font-size: 10px; line-height: 1; }
.sr-keyrow .sr-keys { flex: 1; }
#swarf-run .sr-keyrow button.sr-router { flex: none; min-width: 0; padding: 3px 10px; border-radius: 999px; font-size: 11px; line-height: 1.1; display: flex; flex-direction: column; align-items: center; }
#swarf-run .sr-keyrow button.sr-router b { font-size: 12px; }
#swarf-run .sr-keyrow button.sr-router small { font-size: 10px; }
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
.sr-actions button { border-radius: 10px; padding: 14px 0; font-size: 14px; font-weight: 600; letter-spacing: .06em;
  background: var(--swarf-bg-3, #1c1817); border: 1px solid var(--swarf-line-2, #3a1e18); }
.sr-actions .cut { background: var(--swarf-accent, #d02020); border-color: var(--swarf-accent, #d02020); color: #fff; }
.sr-actions .cut:not(:disabled):hover { background: var(--swarf-accent-hi, #ff3a2a); box-shadow: 0 0 18px var(--swarf-glow, rgba(224,40,30,.32)); }
.sr-actions .stop { background: #3a0c0a; border-color: var(--swarf-accent-hi, #ff3a2a); color: #fff; }
.sr-actions .trace.next, .sr-actions .air.next { border-color: var(--swarf-accent, #d02020); box-shadow: 0 0 12px var(--swarf-glow, rgba(224,40,30,.32)); }
.sr-plan { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px; color: var(--swarf-text-2, #8a857c); font-size: 12px; line-height: 1.6; }
.sr-plan .w { color: var(--swarf-amber, #c08a3a); }
.sr-plan .b { color: var(--swarf-accent-hi, #ff3a2a); }
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
.sr-card { width: min(520px, 92vw); background: var(--swarf-bg-2, #13100f); border: 1px solid var(--swarf-accent, #d02020); border-radius: 14px; padding: 18px 20px; }
.sr-card h2 { margin: 0 0 6px; font-size: 18px; }
.sr-card p { margin: 0 0 12px; color: var(--swarf-text-2, #8a857c); line-height: 1.5; }
.sr-card label { display: flex; gap: 10px; align-items: flex-start; padding: 7px 0; cursor: pointer; line-height: 1.4; }
.sr-card input { accent-color: var(--swarf-accent, #d02020); width: 18px; height: 18px; margin: 0; flex: none; }
.sr-card .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
.sr-card .row button { border-radius: 10px; padding: 10px 16px; background: var(--swarf-bg-3, #1c1817); border: 1px solid var(--swarf-line-2, #3a1e18); }
.sr-card .row .go { background: var(--swarf-accent, #d02020); border-color: var(--swarf-accent, #d02020); color: #fff; font-weight: 600; }
.sr-card .row .go:disabled { opacity: .4; cursor: default; }
.sr-plate .sr-plate-t { display: flex; align-items: center; gap: 8px; margin: 4px 0 10px; color: var(--swarf-text-2, #8a857c); font-size: 13px; }
.sr-plate .sr-plate-t input { width: 84px; height: auto; text-align: right; padding: 5px 8px; border-radius: 6px; border: 1px solid #4f4642; background: #322c29; color: #fff; font: inherit; accent-color: auto; }
.sr-card label span { flex: 1; min-width: 0; white-space: normal; overflow-wrap: anywhere; }
.sr-plate .sr-circuit { margin: 2px 0 4px 28px; color: var(--swarf-text-2, #8a857c); font-size: 13px; }
.sr-plate .sr-circuit.ok { color: var(--swarf-text, #d8d2c6); }
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
.sr-dots i { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font: 600 11px "JetBrains Mono", ui-monospace, monospace; font-style: normal; border: 1px solid var(--swarf-line-2, #3a1e18); color: var(--swarf-text-2, #8a857c); }
.sr-dots i.on { background: var(--swarf-accent, #d02020); border-color: var(--swarf-accent, #d02020); color: #fff; }
.sr-card .sr-out.armed { border-color: var(--swarf-accent, #d02020); color: #fff; }
body.swarf-run-open { filter: none !important; }
/* ---- review pass 10-27 ---- */
.sr-pad button { flex-direction: column; gap: 1px; line-height: 1.05; }
.sr-pad button b { font-size: 15px; }
.sr-pad button small { font-size: 9px; font-weight: 500; letter-spacing: .04em; color: #d8d2c6; text-transform: none; }
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
/* ---- inside swarf (10-27): no header row; steps + sentence share a line ---- */
.sr-top { display: flex; align-items: center; gap: 14px; padding: 0 16px 6px; }
.sr-top .sr-steps { flex: none; padding: 0; gap: 4px; }
.sr-top .sr-step { flex: none; padding: 5px 9px; font-size: 11px; gap: 6px; }
.sr-top .sr-step .n { width: 17px; height: 17px; font-size: 10px; }
.sr-top .sr-say { flex: 1; padding: 0; min-height: 2.7em; font-size: 14px; line-height: 1.35; }  /* two lines kept: a long sentence no longer moves the page (review 10-28b #22) */
.sr-jog h3.sr-jh { display: flex; align-items: center; gap: 10px; }
.sr-jh .sr-conn { margin-left: auto; text-transform: none; letter-spacing: .02em; font-weight: 400; font-size: 12px; }
.sr-jh .sr-conn button { padding: 2px 10px; font-size: 12px; }
.sr-vtools button.on { background: rgb(31,48,66) !important; border-color: #8fb0d0 !important; }
.sr-veil { position: absolute; inset: 0; z-index: 9; display: none; place-items: center; background: rgba(20,18,17,.72); backdrop-filter: grayscale(1) blur(1px); }
.sr-veil.on { display: grid; }
#swarf-run.sr-veiled .sr-actions { visibility: hidden !important; }   /* Fable 3 #6: scoped() made it a descendant rule that never matched */
.sr-veilcard { width: min(520px, 92vw); background: #13100f; border: 1px solid var(--swarf-amber, #c08a3a); border-left: 3px solid var(--swarf-amber, #c08a3a); padding: 20px 22px; }
.sr-veilcard h2 { margin: 0 0 8px; font-size: 24px; color: #fff; }
.sr-veilcard p { margin: 0 0 16px; line-height: 1.5; color: var(--swarf-text, #d8d2c6); }
.sr-veilcard .row { display: flex; gap: 10px; justify-content: flex-end; }
.sr-veilcard button { padding: 12px 18px; border-radius: 3px; background: #3a3532; border: 1px solid #5e5550; color: #fff; font-size: 14px; text-transform: none; letter-spacing: 0.02em; }
.sr-veilcard .go { background: var(--swarf-accent, #d02020); border-color: var(--swarf-accent-hi, #ff3a2a); }
.sr-other { display: inline-block; margin: 6px 12px 0; font-size: 12px; color: var(--swarf-text-2, #8a857c); text-decoration: underline; }
.sr-other:hover { color: var(--swarf-text, #d8d2c6); }
/* ---- jog panel, tidy (Phil 10-27: "a little sloppy") ---- */
.sr-col > .sr-jog { flex: none; padding-bottom: 12px; }
.sr-col > .sr-mach { flex: 1 1 auto; }
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
.sr-jog .sr-modes .lbl small { color: var(--swarf-text-2, #8a857c); font-size: 10px; font-weight: 400; letter-spacing: .04em; text-transform: none; }
.sr-jog .sr-modes button, .sr-jog .sr-modes input { width: 100%; min-width: 0; height: 32px; padding: 0; box-sizing: border-box; text-align: center; font-size: 13px; flex: none; }
.sr-jog .sr-modes button.held { flex: none; }
.sr-jog .sr-pad { display: grid; grid-template-columns: repeat(3, 60px) 22px 60px; grid-template-rows: repeat(3, 50px); gap: 6px; justify-content: center; margin: 12px 12px 0; }
.sr-jog .sr-pad button small { font-size: 9px; letter-spacing: .06em; }
.sr-jog .sr-keys { margin: 8px 12px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px; }
.sr-jog .sr-goto { display: flex; gap: 6px; margin: 10px 12px 0; }
.sr-jog .sr-goto > button { flex: 1; padding: 8px 0; }
@media (max-width: 900px) { .sr-grid { grid-template-columns: 1fr; overflow-y: auto; } .sr-col > .sr-view { flex: none; height: 360px; } }
/* ---- swarf skin (Phil 10-27: "more readable, too dark, fit with swarf") ----
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
/* ---- calm (Phil 10-27: "this app design is INCREDIBLY busy/clumsy looking") ----
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
#swarf-run .sr-actions .stop { grid-column: span 2; }   /* while a job runs, stop is the biggest target (Interfacing review 10-28 #6) */
#swarf-run .sr-actions button { padding: 14px 0 !important; font-size: 14px !important; }
#swarf-run .sr-actions .cut:not(:disabled) { background: var(--c-red) !important; border-color: var(--c-red) !important; color: #fff !important; }
#swarf-run .sr-actions .cut:disabled { background: var(--c-btn) !important; border-color: var(--c-bline) !important; }
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
/* one look for "on" in control: the sim speed chip, the view chips and the keep-zero offer match the jog chips (review 10-28b #27) */
#swarf-run .sr-sim button.on, #swarf-run .sr-vtools button.on { background: #45403c !important; border-color: #b3aaa0 !important; color: #fff !important; }
#swarf-run .sr-keepzero { background: #2a2523; border-color: #4f4642; color: #f2ede4; border-radius: 6px; }
#swarf-run .sr-keepzero:hover { border-color: #a39a90; }
/* a button waiting on a step is pressable: it says what it needs (Phil 10-28: "I can't figure out why
   it won't let me go to trace or in the air") */
#swarf-run .sr-actions .cut.quiet { background: var(--swarf-bg-3, #1c1817) !important; color: inherit !important; border-color: var(--swarf-line-2, #3a1e18) !important; box-shadow: none !important; }
#swarf-run .sr-actions button.wait { opacity: .78; cursor: help; box-shadow: none !important; }
#swarf-run .sr-need { padding: 8px 12px 0; display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--c-dim, #8a857c); }
#swarf-run .sr-need:empty { display: none; }
#swarf-run .sr-need b { font-weight: 500; color: var(--c-text, #d8d2c6); }
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
#swarf-run .sr-plate-view { position: relative; width: 100%; aspect-ratio: 460 / 200; margin: 0 0 8px; }
#swarf-run .sr-plate-view canvas { width: 100%; height: 100%; display: block; }
#swarf-run .sr-plate-view span { position: absolute; transform: translate(-50%, -130%); font-size: 11px; white-space: nowrap; pointer-events: none;
  color: var(--c-text, #d8d2c6); background: var(--swarf-bg-2, rgba(19,16,15,.8)); padding: 1px 6px; border-radius: 6px; }
#swarf-run .sr-plate-view .sr-plate-note { position: absolute; right: 6px; bottom: 4px; font-size: 10px; font-style: normal; color: var(--c-dim, #8a857c); }
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
  // No orphans (Phil 10-28: "be maniacal culling orphans"): a sentence's last two words are
  // tied with a no-break space, so its last line is never one word ("clamp", "one:"). Short
  // labels (three words or fewer) and anything without a space are left alone.
  const tie = t => typeof t === 'string' && t.trim().split(/\s+/).length > 3 ? t.replace(/ (\S+)\s*$/, '\u00a0$1') : t;
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

  function build() {
    document.head.append(h('style', { text: scoped(CSS) }));
    const root = el.root = h('div', { id: 'swarf-run' });

    // Control sits inside swarf (Phil 10-27: "not a whole new line at top"): swarf's
    // menubar and step row stay; the connection lives in the jog header; the five
    // steps and the sentence share one line.
    el.conn = h('div', { class: 'sr-conn' }, h('span', { class: 'sr-dot' }), el.connText = h('span', { text: '' }),
      el.discBtn = h('button', { text: 'disconnect', title: 'let go of the box, so ShopBot 3 or another program can use it', onclick: () => disconnect() }),
      el.connBtn = h('button', { text: 'connect', title: onWindows() ? 'connect to the ShopBot over its USB cable. Quit ShopBot 3 first: one program at a time' : 'connect to the ShopBot over its USB cable', onclick: () => connect(true) }));
    el.steps = h('div', { class: 'sr-steps' });
    STEPS.forEach((s, i) => el.steps.append(h('div', { class: 'sr-step', 'data-step': s, title: STEP_SAYS[s], onclick: () => tell(STEP_SAYS[s]) }, h('span', { class: 'n', text: String(i + 1) }), h('span', { text: s }))));
    el.say = h('div', { class: 'sr-say' });
    el.strip = h('div', { class: 'sr-strip' });   // MASQ's working strip: on while the machine runs
    root.append(h('div', { class: 'sr-top' }, el.steps, el.say), el.strip);

    // grid
    const grid = h('div', { class: 'sr-grid' });
    root.append(grid);

    // preview (upper left)
    el.view = h('div', { class: 'sr-box sr-view' });
    el.canvas = h('canvas');
    el.empty = h('div', { class: 'sr-empty' });   // the box below says what to do (Fable 3 #7: it was said four ways)
    el.facts = h('div', { class: 'sr-facts' });
    el.scrubLabel = h('span', { text: '' });
    el.scrub = h('input', { type: 'range', min: '0', max: '0', value: '0', title: 'Show the program up to a line' });
    // scrub: the path up to a line, and the bit (and the ghost machine) where that line ends.
    // ▶ plays the program through like cam's simulate (Phil 10-27: "the bed isn't moving
    // when I scrub this playhead … can it just play?"). The numbers stay the machine's.
    el.scrub.addEventListener('input', () => { playStop(); previewAt(+el.scrub.value); });
    el.play = h('button', { class: 'sr-play', text: '▶', title: 'Play the program through (space pauses)', onclick: () => (PV.raf ? playStop() : playStart()) });
    el.playRate = h('button', { class: 'sr-rate', text: `preview ${PV.rate}×`, title: 'How fast it plays, against the machine\'s own speed', onclick: () => { PV.rate = PV_RATES[(PV_RATES.indexOf(PV.rate) + 1) % PV_RATES.length]; el.playRate.textContent = `preview ${PV.rate}×`; } });
    el.view.append(el.canvas, el.empty, el.facts,
      h('div', { class: 'sr-vtools' },
        h('button', { text: 'top', onclick: () => view.camTop(), title: 'Look straight down' }),
        h('button', { text: '3d', onclick: () => view.camIso(), title: 'Angled view' }),
        h('button', { text: 'fit', onclick: () => view.fit(), title: 'Fit the program in view' }),
        el.ghostBtn = h('button', { text: 'machine', title: 'Show the ShopBot: its 4 × 8 ft bed slides in X under the gantry, as it does in the shop', onclick: () => { view.setGhost(!view.ghost.visible); el.ghostBtn.classList.toggle('on', view.ghost.visible); } })),
      h('div', { class: 'sr-scrub' }, el.play, el.playRate, el.scrub, el.scrubLabel));
    el.view.addEventListener('dragover', e => { e.preventDefault(); el.view.classList.add('drag'); });
    el.view.addEventListener('dragleave', () => el.view.classList.remove('drag'));
    el.view.addEventListener('drop', e => {
      e.preventDefault(); el.view.classList.remove('drag');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readFile(f);
    });

    // jog (upper right)
    el.jog = h('div', { class: 'sr-box sr-jog' }, h('h3', { class: 'sr-jh' }, h('span', { text: 'jog' }), el.conn), h('div', { class: 'sr-lock', text: 'locked while the program runs' }));
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
    // Step and speed rows (Phil 10-27: findable, plain, more humane than most control software)
    el.modes = h('div', { class: 'sr-modes sr-steprow' }, h('span', { class: 'lbl' }, 'step', h('small', { text: 'mm' })));
    const stepIn = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'mm…', title: 'Type any step in mm, then Enter' });
    const pickStep = (v, b) => { S.jogStep = v; for (const c of el.modes.querySelectorAll('button')) c.classList.toggle('on', c === b); stepIn.classList.toggle('on', !b); };
    for (const v of [0.1, 1, 10, 50, 'cont']) {
      const b = h('button', { class: v === 'cont' ? 'held' : '', text: v === 'cont' ? 'continuous' : String(v), title: v === 'cont' ? 'Continuous (as on the MR-1): moves for as long as you hold the button or key down. No end stops on this machine: let go in time.' : `Each press moves ${v} mm` });
      b.onclick = () => pickStep(v, b);
      if (v === S.jogStep) b.classList.add('on');
      el.modes.append(b);
    }
    stepIn.addEventListener('change', () => { const v = parseFloat(stepIn.value); if (v > 0) pickStep(v, null); });
    stepIn.addEventListener('keydown', e => { if (e.key === 'Enter') stepIn.blur(); });
    el.modes.insertBefore(stepIn, el.modes.querySelector('button.held'));
    el.speeds = h('div', { class: 'sr-modes' }, h('span', { class: 'lbl' }, 'speed', h('small', { text: 'mm/min' })));
    for (const v of [250, 500, 1000, 2500, 5000, 'rapid']) {
      const b = h('button', { text: v === 'rapid' ? 'max' : String(v), title: (v === 'rapid' ? 'The shop jog speed, 6000 mm/min' : `Jog at ${v} mm/min`) + `; Z never above ${Z_JOG_MAX}` });
      b.onclick = () => { S.jogSpeed = v; setJogSpeed(); for (const c of el.speeds.querySelectorAll('button')) c.classList.toggle('on', c === b); };
      if (v === S.jogSpeed) b.classList.add('on');
      el.speeds.append(b);
    }
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
    // the router by hand, to test it (Phil 10-29): asks before it starts, red while on, one press stops it
    // the bed seen from the front, 8 x 4 like the ShopBot's (Phil 10-29): which way X and Y run
    const bed = h('div', { class: 'sr-bedmap', title: 'The bed from the front: X runs along its long side, Y away from you. The dot is the front-left corner.' });
    bed.innerHTML = '<svg viewBox="0 0 84 46" aria-hidden="true"><rect x="2" y="2" width="80" height="40" rx="3"/><circle cx="6" cy="38" r="2.6"/><path d="M14 38H34M30 35l4 3-4 3M6 30V12M3 16l3-4 3 4"/><text x="38" y="41">X</text><text x="9" y="11">Y</text></svg><small>front</small>';
    bed.style.gridColumn = 2; bed.style.gridRow = 2;
    pad.append(bed);
    // (Phil 10-29: out of the jog grid, small, in the corner, so a jog press never lands on it)
    el.routerBtn = h('button', { class: 'sr-router', title: 'Test the router: switch it on, then off', onclick: () => routerButton() }, h('b', { text: 'router' }), h('small', { text: 'test' }));
    el.jog.append(pad,
      h('div', { class: 'sr-keyrow' }, el.routerBtn,
        el.keys = h('div', { class: 'sr-keys', text: '← → ↑ ↓  X Y   ·   fn ↑ ↓  Z   ·   space stops' })),
      h('div', { class: 'sr-goto' },
        el.homeBtn = h('button', { text: 'home', title: 'run to the home sensors', onclick: () => aboutToMove({ title: 'The machine is about to home', text: 'It lifts, then runs to the home sensors in the -X, -Y corner.', go: 'home', run: () => S.machine.home() }) }),
        el.goXY = h('button', { text: 'go to x y 0', title: 'Up, then over to X 0, Y 0', onclick: () => aboutToMove({ title: 'The bit is about to move',
          // before Z is zeroed there is no Z 0 to name: it lifts from where it is (Fable 3 #12)
          text: S.zeroZ ? 'Up to 25 mm (1 in) over Z 0 (if it is lower), then over to X 0, Y 0.' : 'Up 25 mm (1 in) from where it is, then over to X 0, Y 0.',
          go: 'move', run: () => { const z = S.machine.state.pos.z; S.machine.goTo({ z: S.zeroZ ? Math.max(z, SAFE_Z) : z + 25.4, x: 0, y: 0 }); } }) }),
        el.goZ = h('button', { text: 'go to 5 above z 0', title: 'Down to 5 mm above Z 0, slowly', onclick: () => aboutToMove({ title: 'The bit is about to come down', text: 'Down to 5 mm above Z 0, slowly. Check nothing is under the bit but the board.', go: 'move', run: () => { setJogSpeed(); S.machine.goTo({ z: 5 }); } }) }),
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
      h('button', { text: 'make a part', title: 'Back to cam: make a shape, draw one or import one, add a step, then press control again', onclick: () => { close(); const b = document.getElementById('swarf-step-shape'); if (b) b.click(); } }),
      h('button', { text: 'open a file', title: 'A ShopBot (.sbp) or G-code (.nc) file made somewhere else', onclick: () => el.fileInput.click() }),
      h('button', { text: 'a test cut', title: 'Learn the machine on a scrap of plywood: zero, trace, cut, then measure it', onclick: () => window.__swarfLessons && window.__swarfLessons.choose() }),
      el.measure = h('button', { text: 'measure it', title: 'Type in what your calipers read', onclick: () => window.__swarfLessons && window.__swarfLessons.measure() }));
    el.lessonLink = h('a', { class: 'sr-other', text: 'a test cut', href: '#', title: 'Learn the machine on a scrap of plywood: zero, trace, cut, then measure it' });
    el.lessonLink.addEventListener('click', e => { e.preventDefault(); if (window.__swarfLessons) window.__swarfLessons.choose(); });
    el.prog.append(el.fileInput, h('div', { class: 'sr-file' }, el.fileName, el.fromCam), el.start, h('div', {}, el.otherFile, el.lessonLink));
    el.btn = {
      trace: h('button', { class: 'trace', text: 'trace', title: 'Run the rectangle the cut fills, 25 mm up, router off', onclick: () => askCut('trace') }),
      air: h('button', { class: 'air', text: 'air cut', title: 'Run the whole file above your board, router off', onclick: () => askCut('air') }),
      cut: h('button', { class: 'cut', text: 'cut', title: 'cut the file: the router starts', onclick: askCut }),
      pause: h('button', { class: 'pause', text: 'pause', title: 'pause: the router stops, the bit stays put', onclick: pauseResume }),
      stop: h('button', { class: 'stop', text: 'stop', title: 'Stop all motion', onclick: () => { S.userStopped = true; S.machine.stop(); } })
    };
    el.prog.append(h('div', { class: 'sr-actions' }, el.btn.trace, el.btn.air, el.btn.cut, el.btn.pause, el.btn.stop));
    // the feed override while a job runs (Phil 10-29, like the MR-1's): cuts only, 50 to 150 % in 5 % steps
    const ovr = d => { const m = S.machine; if (m && m.setOverride) { m.setOverride(((m.state.override || 100) + d)); refresh(); } };
    el.ovr = h('div', { class: 'sr-ovr' }, h('span', { class: 'lbl', text: 'feed' }),
      el.ovrDn = h('button', { text: '−5%', title: 'cut 5 % slower (down to 50 %)', onclick: () => ovr(-5) }),
      el.ovrVal = h('b', { text: '100%' }),
      el.ovrUp = h('button', { text: '+5%', title: 'cut 5 % faster (up to 150 %, never past the machine\'s top speed)', onclick: () => ovr(5) }),
      h('button', { text: '100%', title: 'back to the file\'s own feeds', onclick: () => { const m = S.machine; if (m && m.setOverride) { m.setOverride(100); refresh(); } } }));
    el.prog.append(el.ovr);
    el.need = h('div', { class: 'sr-need' });
    el.prog.append(el.need);
    // a waiting button still takes the press, and says what it waits for
    for (const k of ['trace', 'air', 'cut']) el.btn[k].addEventListener('click', e => {
      if (!el.btn[k].classList.contains('wait')) return;
      e.stopImmediatePropagation(); needsCard(k);
    }, true);
    el.fromLine = h('input', { type: 'number', min: '1', value: '1' });
    el.fromBtn = h('button', { text: 'continue from line', title: 'Up to 25 mm, over, then cut from this line on', onclick: () => askCut('from') });
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
    el.soundBtn = h('button', { class: 'sr-out', text: soundWord(), title: 'Short sounds on the ShopBot: about to move, router starting, something wrong, finished. The simulator stays quiet.', onclick: () => { if (!window.SwarfSound) return; SwarfSound.set(SwarfSound.level() ? 0 : 0.6); el.soundBtn.textContent = soundWord(); if (SwarfSound.level()) SwarfSound.play('done'); } });
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

    grid.append(h('div', { class: 'sr-col' }, el.view, el.prog), h('div', { class: 'sr-col' }, el.jog, el.stat));
    el.fromCam.classList.add('sr-link'); el.fromCam.textContent = 'make the toolpaths again';

    // cut checklist sheet
    el.veil = h('div', { class: 'sr-veil' }, h('div', { class: 'sr-veilcard' },
      h('h2', { text: 'Paused. The router is switched off.' }),
      h('p', { text: 'The bit stopped where it was; it slows for a few seconds before it stops turning. Resume starts the router and carries on from here. End the job keeps the line so you can continue later.' }),
      h('div', { class: 'row' },
        h('button', { text: 'end the job', onclick: () => { S.userStopped = true; S.machine.stop(); } }),
        el.resumeBtn = h('button', { class: 'go', text: 'start the router and resume', onclick: () => resumeNow() }))));
    el.veilWay = h('p', { class: 'sr-way' });
    el.veil.querySelector('.sr-veilcard p').after(el.veilWay);
    root.append(el.veil);
    el.sheet = h('div', { class: 'sr-sheet' });
    el.card = h('div', { class: 'sr-card' });
    el.sheet.append(el.card);
    root.append(el.sheet);

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
      // shop's ShopBot the BED moves in X under a fixed gantry (Phil 10-27: "the bed
      // isn't moving"), so with the machine shown this whole group slides in X.
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
        // close in on the job the gantry would fill the view: only the bed shows until you zoom out
        if (this.ghostParts) this.ghostParts.gantry.visible = this.sph.r > 1800;
        this.renderer.render(this.scene, this.camera); requestAnimationFrame(loop);
      };
      loop();
    },
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
    // The shop's ShopBot, ghosted for scale (Phil 10-27): a 4 x 8 ft bed that slides
    // along X under a fixed gantry; the carriage rides the beam in Y and the router
    // rides the carriage in Z. The bed lives in this.work and slides with the job.
    // With no home switches the board's place on the bed is unknown: the job sits
    // near the bed's front-left corner. Turned off with the "machine" chip.
    buildGhost() {
      const THREE = this.THREE, G = new THREE.Group();
      // one model for CONTROL and SIMULATE: swarf-shopbot-model.js (Phil 10-28, from photos)
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
    // (and backs off if it must) so the bit and the job are both in frame (review 10-28 #23)
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
      if (this.grid) this.grid.visible = !on;   // the bed is the grid when the machine shows (Phil: "why are there 2 grids?")
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
  function readFile(f) {
    const r = new FileReader();
    r.onload = () => loadProgram(f.name, String(r.result), 'file');
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
    S.camError = ''; S.camBusy = true; refresh();
    const done = msg => { S.camBusy = false; S.camDone = null; if (msg) S.camError = msg; clearTimeout(S.camTimer); refresh(); };
    // cam's event bus has no off(): one listener for good, pointed at the current request
    S.camDone = done;
    if (!S.camErrHooked) { S.camErrHooked = true; api.event.on('preview.error', e => { if (S.camDone) S.camDone(`The toolpaths could not be made: ${e && e.message ? e.message : e || 'check the steps'}.`); }); }
    S.camTimer = setTimeout(() => done('The toolpaths took too long to make. Press toolpaths in the step row to see why.'), 120000);
    try {
      if (api.function.clear_progress) api.function.clear_progress();
      api.function.export((text) => {
        if (!S.camBusy) return;
        done('');
        if (!text || !/\S/.test(text)) { S.camError = 'No toolpaths were made. Check the steps, then press control.'; refresh(); return; }
        const names = api.widgets.all().map(w => w.meta && w.meta.file).filter(Boolean);
        const base = (names[0] || 'part').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').slice(0, 40);
        loadProgram(base + '.sbp', text, 'cam');
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
    playStop();
    // cam made the very same toolpaths again: keep the job where it is (a stop, a tool
    // change, the zero), just say so (review 10-27: a round trip to cam forgot the line)
    if (S.prog && source === 'cam' && S.prog.source === 'cam' && S.prog.text === text) { refresh(); return; }
    const parsed = P.parse(text, { machineUnits: 'mm' });
    S.prog = { name, text, parsed, source, ...(extra || {}) };
    S.hold = null;   // a new program's own first step says what to do, not the last answer
    rememberZero();  // the zero is the board's, not the file's: one press keeps it (Phil 10-29)
    S.zeroXY = S.zeroZ = S.traced = false;
    S.zx = S.zy = false; S.stoppedAt = 0; S.lastDone = null; S.toolChange = null; S.lostAt = 0;
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
    const near = (v, w) => Math.abs(v) <= Math.max(10, w * 0.03);   // an outline's path sits a bit's radius outside the stock
    const w = b.max.x - b.min.x, d = b.max.y - b.min.y;
    let xy;
    if (near(b.min.x, w) && near(b.min.y, d)) xy = 'the front-left corner of your board';   // the poster's words (10-28)
    else if (near((b.min.x + b.max.x) / 2, w) && near((b.min.y + b.max.y) / 2, d)) xy = 'the center of your board';
    else xy = `the point your file calls X 0, Y 0 (the cut spans X ${b.min.x.toFixed(0)} to ${b.max.x.toFixed(0)}, Y ${b.min.y.toFixed(0)} to ${b.max.y.toFixed(0)} mm)`;
    const z = b.max.z <= 2 && b.min.z < 0 ? 'the top of your board' : b.min.z >= -0.5 ? 'the table under your board' : 'where your file puts Z 0';
    return { xy, z };
  }

  function problems() {
    const out = { block: [], warn: [] };
    if (!S.prog) return out;
    const p = S.prog.parsed;
    if (!p.moves.length) out.block.push('The file has no moves swarf can read.');
    if (p.units === 'in') out.warn.push('Written in inches: swarf turns every move into millimeters (1 in = 25.4 mm). The checklist shows the size in both.');
    else if (p.units !== 'mm') out.block.push(`This file's units (${p.units}) are not inches or millimeters.`);
    const b = P.cutBounds(p);
    const L = M.LIMITS;
    // the table's corner known (table corners card): the job must sit on the table from this zero
    const c = S.machine && S.machine.mabs && corner();
    if (b && c && S.zeroXY) {
      const T = tableSize(), ma = S.machine.mabs(), pos = S.machine.state.pos;
      const x0 = b.min.x + ma.x - pos.x - c.x, y0 = b.min.y + ma.y - pos.y - c.y, x1 = x0 + b.max.x - b.min.x, y1 = y0 + b.max.y - b.min.y;
      if (x0 < -2 || y0 < -2 || x1 > T.x + 2 || y1 > T.y + 2) out.block.push(`From this zero the cut runs off the table (X ${x0.toFixed(0)} to ${x1.toFixed(0)}, Y ${y0.toFixed(0)} to ${y1.toFixed(0)} mm from its front-left corner). Zero somewhere else.`);
    }
    // Z zero on the table, not the board (third review #5): every safe height would sit in the board
    if (window.SwarfRunPlan && window.SwarfRunPlan.validate(p).some(v => v.k === 'table-zero')) out.block.push('Every cut in this file is above Z 0, so it was made with Z zero on the table. swarf zeros Z on the top of your board: make the file again with Z zero on the top of the material (in VCarve: Job Setup, Z Zero, Material Surface).');
    // any line swarf can't carry out exactly blocks the run (design review 10-28 #2): skipping
    // one can start every move after it from the wrong place
    const mover = p.unsupported[0];
    if (mover) out.block.push(`Line ${mover.line} is something swarf can't carry out exactly ("${mover.text.slice(0, 40)}")${p.unsupported.length > 1 ? `, and ${p.unsupported.length - 1} more` : ''}. Skipping it could start the moves after it from the wrong place, so swarf won't run this file. Make it again from swarf's toolpaths, or without that line.`);
    // the card cannot step slower than this (a 16-bit tick at its clock): a slower feed would run faster (review #3)
    // per move, from its own steps (follow-up review #2): a diagonal's floor is higher than an axis's
    const T = 7372800 / 65536, U = { x: 72.183661, y: 72.183661, z: 90.229567 };
    const floorOf = m => { const L = Math.hypot(m.x - m.x0, m.y - m.y0, m.z - m.z0), st = Math.max(Math.abs(m.x - m.x0) * U.x, Math.abs(m.y - m.y0) * U.y, Math.abs(m.z - m.z0) * U.z); return st >= 1 ? T * L / st : 0; };
    const slow = p.moves.find(m => !m.rapid && m.feed > 0 && m.feed < floorOf(m) * 1.02);
    if (slow) out.block.push(`Line ${slow.line} asks for ${Math.round(slow.feed * 60)} mm/min, slower than the machine can step smoothly in that direction (${Math.ceil(floorOf(slow) * 60 * 1.02)} mm/min). It would run faster than asked. Raise that feed and make the toolpaths again.`);
    if (b) {
      const w = b.max.x - b.min.x, d = b.max.y - b.min.y;
      if (w > L.x[1] - L.x[0] || d > L.y[1] - L.y[0]) out.block.push(`The cut is ${w.toFixed(0)} × ${d.toFixed(0)} mm, bigger than the table.`);
    }
    for (const w of p.warnings) if (!/units|inches|millimeters/.test(w.text)) out.warn.push((w.line ? `line ${w.line}: ` : '') + w.text);
    return out;
  }

  function renderPlan() {
    el.plan.innerHTML = '';
    if (!S.prog) return;
    const p = S.prog.parsed, b = P.cutBounds(p);
    const add = (t, cls) => el.plan.append(h('div', { class: cls || '', text: t }));
    el.facts.textContent = b ? `${(b.max.x - b.min.x).toFixed(0)} × ${(b.max.y - b.min.y).toFixed(0)} mm · ${(-Math.min(0, b.min.z)).toFixed(1)} mm deep · about ${mins(p.seconds)}` : '';
    const pr = problems();
    if (!pr.block.length) add(`✓ millimeters · ✓ fits the table · ✓ ${p.moves.length} moves read`, 'ok');
    const t = fileTools();
    if (t.names.length) add(`bit  ${t.names.join(', then ')}`);
    if (t.rpm.length) add(`router  ${t.rpm.map(dialFor).join(', then ')}`);
    const changes = p.events.filter(e => e.kind === 'tool-change');
    if (changes.length > 1) add(`${changes.length} tool changes: at each one the bit stops ${CHANGE_Z} mm up with the router off; change it, zero Z again, then continue`, 'w');
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
    return Math.max(0, total - done);
  }

  function mins(s) {
    if (!s) return '—';
    if (s < 90) return `${Math.round(s)} s`;
    const m = Math.round(s / 60);
    return m < 90 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  }

  // ------------------------------------------------------------ steps
  function stepNow() {
    if (!S.prog || !S.prog.parsed.moves.length) return 'load';
    if (problems().block.length) return 'check';
    if (!S.zeroXY || !S.zeroZ) return 'zero';
    if (!S.traced) return 'trace';
    return 'cut';
  }

  // what a run waits for, in order: each with its plain words and the control that does it
  function needs(st, ready) {
    const real = st && st.kind !== 'sim';
    return [
      { k: 'conn', label: real || !st ? 'connected' : 'connected (simulator)', ok: !!(st && st.connected), todo: 'plug in the ShopBot and press connect' },
      { k: 'fault', label: 'all clear', ok: !S.fault, todo: S.fault ? `${S.fault}: check the machine, then press all clear` : '' },
      { k: 'busy', label: 'machine still', ok: !st || !st.connected || ready, todo: 'wait for the machine to stop moving' },
      { k: 'prog', label: 'a program', ok: !!(S.prog && S.prog.parsed.moves.length), todo: 'make a part in cam and press control, or open a file' },
      { k: 'file', label: 'file checked', ok: !(S.prog && problems().block.length), todo: (S.prog && problems().block[0] || 'fix the file').replace(/\.$/, '') },
      { k: 'xy', label: 'X Y zeroed', ok: !!S.zeroXY, todo: S.zeroHad && S.zeroHad.xy && S.zeroSetAt && !S.zx ? 'press "use the zero you set" if the board has not moved, or jog over your X 0, Y 0 and press zero x y' : 'jog the bit over your X 0, Y 0 and press zero x y' },
      { k: 'z', label: 'Z zeroed', ok: !!S.zeroZ, todo: S.zeroHad && S.zeroHad.z && S.zeroSetAt && !S.toolChange && !S.zStale ? 'press "use the zero you set", or zero Z again' : 'press z plate, or lower the bit onto paper and press zero z' },
      { k: 'trace', label: 'traced', ok: !!S.traced, todo: 'press trace and watch it clear the clamps' }
    ].filter(n => n.k !== 'busy' || !n.ok);
  }
  function flashNeed(k) {
    const first = k || ((needs(S.machine && S.machine.state, true).find(n => !n.ok)) || {}).k;
    const b = { conn: el.connBtn, xy: el.zxyBtn, z: el.plateBtn && el.plateBtn.style.display !== 'none' ? el.plateBtn : el.zzBtn, prog: el.start, trace: el.btn.trace }[first];
    if (!b || !b.animate) return;
    b.animate([{ boxShadow: '0 0 0 0 rgba(242,237,228,0)' }, { boxShadow: '0 0 0 6px rgba(242,237,228,.6)' }, { boxShadow: '0 0 0 0 rgba(242,237,228,0)' }], { duration: 700, iterations: 2 });
  }

  function refresh() {
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
    // the ShopBot not connected: everything that needs it greys out (Phil 10-29); the simulator keeps them
    const offline = isDirect() && !(st && st.connected);
    el.jog.classList.toggle('offline', offline);
    for (const b of [el.btn.trace, el.btn.air, el.btn.cut]) if (b) b.classList.toggle('offline', offline);
    // a job on the machine (running or paused) keeps control: cam's steps look asleep (review 10-28 #20)
    document.body.classList.toggle('swarf-run-busy', !!running && S.open);
    // what trace, in the air and cut wait for, each one named; a waiting button still takes the
    // press and says it (Phil 10-28: "I can't figure out why it won't let me go to trace or in the air")
    const need = needs(st, ready);
    const testWhy = need.filter(n => !n.ok && n.k !== 'trace').map(n => n.todo);
    const cutWhy = need.filter(n => !n.ok).map(n => n.todo);
    const wait = (b, list, word, title) => {
      b.disabled = !!running || offline;
      b.classList.toggle('wait', !running && list.length > 0);
      b.dataset.why = list.length ? `${word} needs: ${list.join(', then ')}.` : '';
      b.title = list.length ? b.dataset.why : title;
    };
    wait(el.btn.trace, testWhy, 'Trace', 'Run the rectangle the cut fills, 25 mm up, router off');
    wait(el.btn.air, testWhy, 'An air cut', 'Run the whole file above your board, router off');
    wait(el.btn.cut, cutWhy, 'Cut', 'cut the file: the router starts');
    el.fromBtn.disabled = running || cutWhy.length > 0;
    el.fromBtn.title = cutWhy.length ? `Continue needs: ${cutWhy.join(', then ')}.` : 'Up to 25 mm, over, then cut from this line on';
    el.need.innerHTML = '';
    if (!running && need.some(n => !n.ok)) {
      el.need.append(h('b', { text: 'to run:' }));
      for (const n of need) el.need.append(h('span', { class: n.ok ? 'ok' : 'no', text: (n.ok ? '✓ ' : '○ ') + n.label, title: n.ok ? '' : n.todo, onclick: n.ok ? null : () => { tell(`${n.todo[0].toUpperCase()}${n.todo.slice(1)}.`, 'warn'); flashNeed(n.k); } }));
    }
    // a finished cut: the steps read done, cut goes quiet, and the box offers what comes next (Fable 3 #11)
    const finished = !running && (S.lastDone === 'cut' || S.lastDone === 'from') && !S.stoppedAt;
    if (finished) for (const node of el.steps.children) node.className = 'sr-step done';
    el.btn.cut.classList.toggle('quiet', finished);
    el.start.style.display = !S.prog || finished ? '' : 'none';
    // after a test cut, "measure it" waits where the student looks (Fable 3 #9)
    if (el.measure) el.measure.style.display = finished && S.prog && S.prog.source === 'lesson' ? '' : 'none';
    if (el.keys) el.keys.textContent = running ? 'any key pauses   ·   emergency: the red e-stop on the floor' : '← → ↑ ↓  X Y   ·   fn ↑ ↓  Z   ·   space stops';   // Fable 3 #10
    el.otherFile.style.display = S.prog ? '' : 'none';
    el.lessonLink.style.display = S.prog ? '' : 'none';
    el.fromCam.style.display = S.prog && S.prog.source === 'cam' ? '' : 'none';
    // the control that does the next thing is lit
    const first = need.find(n => !n.ok);
    el.connBtn.classList.toggle('next', !!(first && first.k === 'conn'));
    el.zxyBtn.classList.toggle('next', !!(first && first.k === 'xy') && !running);
    el.fromRow.style.display = S.stoppedAt ? '' : 'none';
    el.fromBtn.textContent = `continue from line ${el.fromLine.value}`;
    // go-to buttons only once zero was set this session: a saved zero may be from before a restart
    el.goXY.style.display = S.zeroXY && S.zeroSetAt ? '' : 'none';
    el.goZ.style.display = S.zeroZ && S.zeroSetAt ? '' : 'none';
    el.strip.classList.toggle('on', !!running && !(st && st.paused));
    el.btn.trace.classList.toggle('next', now === 'trace' && !running);
    el.btn.pause.disabled = !running;
    for (const k of ['trace', 'air', 'cut']) el.btn[k].style.display = running ? 'none' : '';
    for (const k of ['pause', 'stop']) el.btn[k].style.display = running ? '' : 'none';
    el.btn.pause.textContent = st && st.paused ? 'resume' : 'pause';
    el.btn.stop.disabled = !st;
    el.fromCam.disabled = !!running;
    el.fromCam.title = running ? 'not while the job runs: stop it first' : 'Make the toolpaths again and bring them here';
    // "same zero as last time": only a zero set in this session, offered when a new file needs one
    // never after a bit change: the saved Z belongs to the old bit
    // and only before either zero is set again: never in the middle of setting them (review 10-28b #21)
    // after a reconnect the offer stands with no file loaded too: the zero was the machine's, not the file's
    // Phil 10-29: "if I am zeroed I shouldn't have to rezero": any file, a test cut, after a reload;
    // never after a bit change (its Z is the old bit's) or a count that jumped (the box restarted)
    const offer = S.zeroSetAt && S.zeroHad && (S.zeroHad.xy || S.zeroHad.z) && !S.zeroXY && !S.zeroZ && !S.zx && !S.zy && !S.toolChange && !S.zStale && !running
      && (!isDirect() || (S.machine.state && S.machine.state.connected));
    el.keepZero.style.display = offer ? '' : 'none';
    if (offer && S.zeroReconnect) el.keepZero.textContent = `the board and the machine have not moved since ${S.discWhy || (S.discAt ? 'you disconnected' : 'the link dropped')}: use the zero from ${new Date(S.zeroSetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    else if (offer) el.keepZero.textContent = `use the zero you set at ${new Date(S.zeroSetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} (${S.zeroHad.xy && S.zeroHad.z ? 'X Y and Z' : S.zeroHad.xy ? 'X Y' : 'Z'}): the board has not moved`;
    // the plan's checks follow the zero (Fable review 3 #1: it said "fits the table" when it no longer did)
    const sig = S.prog ? problems().block.join('|') : '';
    if (sig !== S.planSig) { S.planSig = sig; renderPlan(); }
    // a latched fault sounds, softly and again every few seconds, until all clear (real machine only)
    if (window.SwarfSound) { const want = !!S.fault && isDirect(); if (want !== SwarfSound.faulting()) SwarfSound.fault(want); }
    coach(now, st);
  }

  function coach(now, st) {
    // an answer to a press stays a few seconds: the machine's state updates would wipe it at once
    if (S.hold && Date.now() < S.hold.until && !(st && st.running)) return say(S.hold.text, S.hold.cls);
    if (S.fault && !(st && (st.running || st.routerUnknown))) return say(`${S.fault[0].toUpperCase()}${S.fault.slice(1)}. Check the machine, then press all clear in the line under the buttons. Jogs still work, to lift the bit clear.`, 'bad');
    if (st && st.routerUnknown) return say(`${S.lostAt ? `The USB link dropped at line ${S.lostAt}. ` : ''}swarf can't tell whether the router is still on: press the red e-stop on the floor and wait until the bit has stopped turning. Then plug in and press connect${S.lostAt ? `; continue from line ${S.lostAt} after` : ''}.`, 'bad');
    if (S.connMsg && (!st || st.kind === 'sim' || !st.connected)) return say(S.connMsg, 'bad');
    if (st && st.dialog) return say(`The file asks: ${st.dialog.caption || st.dialog.message}`, 'warn');
    if (st && st.running) {
      const total = S.prog ? S.prog.parsed.lines : 0;
      const what = { trace: 'Tracing the rectangle the cut fills, 25 mm up, router off', air: 'Running an air cut, router off', cut: 'Cutting', from: 'Cutting', preview: 'Previewing' }[S.job] || 'Running';
      const left = timeLeft();
      const where = left ? `, about ${mins(left)} left` : '';
      if (st.paused) return say(`${what}: paused, router off. Press resume to go on, or end the job.`, 'warn');
      return say(`${what}${where}. Stay at the machine. Any key pauses it while swarf is in front (router off, bit held); that is not an emergency stop. ${(window.SwarfSafetyWords || {}).emergency || 'In an emergency, step on the red e-stop on the floor.'}`);
    }
    if (st && !st.connected && st.estopped) return say(`The e-stop stopped the machine${S.stoppedAt ? ` at line ${S.stoppedAt}` : ''}, and swarf let go of it. When everything has stopped and the machine is safe, press connect.`, 'bad');
    if (st && !st.connected && S.lostAt) return say(`The USB link dropped at line ${S.lostAt}. If the machine is still moving or the router still turns, press the floor e-stop. Plug in, press connect, then continue from line ${S.lostAt}.`, 'bad');
    const win = onWindows() ? ` ${WIN_ONE}` : '';
    if (st && !st.connected && M.DirectMachine && S.machine instanceof M.DirectMachine) return say(`Not connected: ${st.note}. Plug the box's USB cable into this computer and press connect.${win}`, 'bad');
    if (st && !st.connected) return say(`Not connected. Plug the ShopBot into this computer and press connect.${win}`, 'bad');
    const o = originText();
    switch (now) {
      case 'load': return say(S.camBusy ? 'Making the toolpaths…' : S.camError || 'No toolpaths yet. Add a step to your part (rough, contour, outline, pocket), then press control.');
      case 'check': return say(problems().block[0], 'bad');
      case 'zero':
        if (S.toolChange) return say(`${S.toolChange} The bit is ${CHANGE_Z} mm up and the router is off. Change the bit, then press z plate to zero Z on ${o.z} (or lower it onto a sheet of paper and press zero z), then continue from line ${S.stoppedAt}.`, 'warn');
        if (S.zeroLost) return say('The box lost its position while it was unplugged. Zero X Y and Z again before you go on.', 'warn');
        if (!S.zeroXY) return say(`Jog the bit over ${o.xy}, then press zero x y. Step 10 to get close, then 1.`);
        if (/top/.test(o.z)) return say(`Now Z, on ${o.z}: press z plate and the bit finds the board itself with the touch plate. Or lower it with step 0.1 onto a sheet of paper until it just drags, then press zero z.`);
        return say(`Lower the bit to ${o.z}: step 1 to get close, then 0.1, with a sheet of paper under the bit until it just drags. Then press zero z.`);
      case 'trace': return say('Press trace. The bit runs the rectangle your cut fills, 25 mm up, router off. Check it clears every screw and clamp and stays over your board.');
      case 'cut':
        if (S.lostAt) return say(`The USB link dropped at line ${S.lostAt}. If the machine is still moving or the router still turns, press the floor e-stop. Plug in, press connect, then continue from line ${S.lostAt}.`, 'bad');
        if (S.stoppedAt && st && st.resumeLine === S.stoppedAt) return say(`${st.note[0].toUpperCase()}${st.note.slice(1)}. The router is off and the bit is up.`, 'warn');
        if (S.stoppedAt) return say(`Stopped at line ${S.stoppedAt}. To finish, press continue from line ${S.stoppedAt}; to start over, press cut.`, 'warn');
        if ((S.lastDone === 'cut' || S.lastDone === 'from') && st && st.coasting) return say((window.SwarfSafetyWords || {}).coasting || 'Finished. Keep your hands clear until the bit has stopped turning.', 'warn');
        return say(S.lastDone === 'cut' || S.lastDone === 'from' ? ((window.SwarfSafetyWords || {}).finished || 'Finished. Wait until the bit has stopped turning.') : 'Ready. Press cut. You will confirm a short checklist first.');
    }
  }

  function tell(text, cls) {
    S.hold = { text, cls, until: Date.now() + 5000 };
    say(text, cls);
    clearTimeout(S.holdT); S.holdT = setTimeout(() => { S.hold = null; refresh(); }, 5100);
  }
  function say(text, cls) {
    el.say.textContent = tie(text || '');
    el.say.className = 'sr-say' + (cls ? ' ' + cls : '');
  }

  // ------------------------------------------------------------ actions
  function doZero(axes) {
    if (!S.machine || S.machine.state.running) return;
    S.machine.zero(axes);
    if (axes.includes('x') && axes.includes('y')) S.zeroXY = true;
    else if (axes === 'x') S.zx = true;
    else if (axes === 'y') S.zy = true;
    if (S.zx && S.zy) S.zeroXY = true;
    if (axes.includes('z')) { S.zeroZ = true; S.zStale = false; }
    S.zeroSetAt = Date.now(); S.zeroFor = progKey();
    S.zeroLost = false;
    // a new bit after a tool change keeps the trace: only Z moved
    if (S.toolChange && axes === 'z') S.toolChange = null;
    else S.traced = false;
    refresh();
  }

  // Z plate (Phil 10-27, then "the auto z depth with the touch off tool. Like the SB
  // software has, but more tightly integrated"): one card, not five. The plate's
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
    // the plate's input once proved is kept (machine setup, or the first touch): after that the card
    // has no touch step (Phil 10-29: "I don't want/like that"). The plate already reading contact is
    // still refused before the bit moves, and the descent stops after its travel.
    const known = !sim && !!(m.plateCfg && m.plateCfg.confirmed);
    let base = null, seen = null, proved = known, zeroed = false;
    const checks = [
      ['over', `The bit is over your board, less than ${Math.round((m.plateCfg && m.plateCfg.travel) || 60)} mm above the plate (the search distance below).`],
      ['clip', 'The ground clip is on the black Allen screw in the side of the router\'s housing, its wire clear of the bit.'],
      ['under', 'The plate lies flat on the board, right under the bit. Hands clear.']
    ];
    const boxes = {};
    const body = h('div', { class: 'sr-plate' });
    const thick = h('input', { type: 'text', inputmode: 'decimal', value: String(+m.plateCfg.thickness.toFixed(3)), title: 'Measure your plate with calipers: Z zero is this much below where the bit touches' });
    const circuit = h('p', { class: 'sr-circuit' });
    const touchBtn = sim ? h('button', { text: 'touch the plate to the bit', title: 'The simulator has no plate: this stands in for the touch', onclick: () => { proved = true; show(); } }) : null;
    const go = h('button', { class: 'go' });
    const back = h('button', { text: 'cancel', onclick: () => { S.plateWatch = null; el.sheet.classList.remove('on'); refresh(); } });
    const put = h('input', { type: 'checkbox' });
    const pic = plateView();
    const show = () => {
      const all = checks.every(([k]) => boxes[k].checked);
      if (pic) pic.pose(zeroed ? 'away' : proved ? 'flat' : 'test');
      if (zeroed) {
        body.innerHTML = '';
        body.append(h('h2', { text: 'Z is zero on top of your board' }),
          h('p', { text: 'Put the plate back where it lives and unclip the ground clip, so neither is near the bit when it cuts.' }),
          h('label', {}, put, h('span', { text: 'the plate and the clip are put away' })));
        go.textContent = 'done'; go.disabled = !put.checked;
        go.title = go.disabled ? "Tick 'the plate and the clip are put away' first" : 'Close the card: Z is set';
        return;
      }
      circuit.textContent = proved
        ? '✓ the circuit works'
        : sim ? 'Touch the plate to the bit, to prove the circuit.' : 'Touch the plate to the bit, then take it away: swarf waits for the touch.';
      circuit.classList.toggle('ok', proved);
      circuit.style.display = known ? 'none' : '';
      if (touchBtn) touchBtn.style.display = proved ? 'none' : '';
      go.textContent = 'touch off';
      go.disabled = !(all && proved);
      go.title = go.disabled ? (proved ? 'Tick the three checks first' : 'Prove the circuit first: touch the plate to the bit') : 'The bit comes down slowly, touches, lifts, touches again and lifts 25 mm. Any key stops it.';
    };
    // the inputs as they stand with the clip on: a touch changes exactly one of them
    const watch = st => {
      if (!base || !st.inputs || proved) return;
      // once the plate's input is set in machine setup, only that input counts (design review 10-28 #8)
      const only = m.plateCfg && m.plateCfg.confirmed ? m.plateCfg.input : 0;
      for (let n = 1; n <= 12; n++) {
        if (only && n !== only) continue;
        const was = m.level(base, n), now = m.level(st.inputs, n);
        if (now !== was && !seen) { seen = { input: n, hit: now }; circuit.textContent = 'touch seen: now take the plate away'; }
        if (seen && n === seen.input && now === was) {      // touched and let go: the circuit works
          S.plateWatch = null;                              // first: setPlate's state update calls back in here
          m.setPlate(seen.input, seen.hit);
          proved = true; show();
          return;
        }
      }
    };
    if (!sim && !known) { base = m.state.inputs ? { ...m.state.inputs } : null; S.plateWatch = watch; }
    thick.addEventListener('keydown', e => e.stopPropagation());
    // how far the bit searches down for the plate (Phil 10-29: 60 mm by default, raise it by hand)
    const reach = h('input', { type: 'text', inputmode: 'decimal', value: String(Math.round((m.plateCfg && m.plateCfg.travel) || 60)), title: 'How far the bit comes down looking for the plate before it gives up' });
    reach.addEventListener('keydown', e => e.stopPropagation());
    reach.addEventListener('change', () => {
      const t = parseFloat(reach.value);
      if (!(t >= 10 && t <= 150) || !m.setPlateTravel || !m.setPlateTravel(t)) { reach.value = String(Math.round((m.plateCfg && m.plateCfg.travel) || 60)); say('Search down is 10 to 150 mm.', 'warn'); return; }
      const over = boxes.over && boxes.over.nextElementSibling;
      if (over) over.textContent = `The bit is over your board, less than ${Math.round(t)} mm above the plate (the search distance below).`;
    });
    thick.addEventListener('change', () => {
      const t = parseFloat(thick.value);
      if (!(t > 0 && t < 50) || !m.setPlateThickness || !m.setPlateThickness(t)) { thick.value = String(+m.plateCfg.thickness.toFixed(3)); say('A plate is between 0 and 50 mm thick: measure yours with calipers.', 'warn'); }
    });
    put.addEventListener('change', show);
    go.onclick = async () => {
      if (zeroed) { S.plateUsed = false; el.sheet.classList.remove('on'); refresh(); return; }
      go.disabled = true; go.textContent = 'touching off…';
      S.plateWatch = null;
      el.sheet.classList.remove('on');
      const ok = await m.zZero();
      if (!ok) { refresh(); return; }     // the sentence carries the reason; the card stays shut
      S.zeroZ = true; S.zStale = false; S.zeroSetAt = Date.now(); S.zeroFor = progKey(); S.plateUsed = true;
      if (S.toolChange) S.toolChange = null; else S.traced = false;
      zeroed = true;
      el.sheet.classList.add('on'); show(); refresh();
    };
    body.append(h('h2', { text: 'Zero Z with the plate' }),
      h('div', { class: 'sr-plate-t' }, h('span', { text: 'plate thickness' }), thick, h('span', { text: 'mm: measure your plate with calipers' })),
      h('div', { class: 'sr-plate-t' }, h('span', { text: 'search down' }), reach, h('span', { text: 'mm: how far the bit comes down looking for the plate' })));
    for (const [k, t] of checks) {
      boxes[k] = h('input', { type: 'checkbox' });
      boxes[k].addEventListener('change', show);
      body.append(h('label', {}, boxes[k], h('span', { text: t })));
      if (k === 'clip') body.append(circuit, ...(touchBtn ? [touchBtn] : []));
    }
    el.card.innerHTML = '';
    el.card.append(...(pic ? [pic.el] : []), body, h('div', { class: 'row' }, back, go));
    show();
    el.sheet.classList.add('on');
  }

  // The plate card's picture (Phil 10-28: the plate model, swarf-plate-model.js): the bit, the
  // ground clip on the router's clamp ring and the plate, posed for the card's step: 'test' (held
  // up against the bit, the circuit check), 'flat' (on the board, the bit coming down to it) and
  // 'away' (put back). Ink on the light skins, the faint ghost on the dark one. It renders only
  // while the card is open.
  function plateView() {
    const THREE = window.THREE, PM = window.SwarfPlateModel;
    if (!THREE || !PM) return null;
    const wrap = h('div', { class: 'sr-plate-view' }), canvas = h('canvas');
    const labels = { bit: h('span', { text: 'bit', class: 'l' }), clip: h('span', { text: 'ground clip', class: 'r' }), plate: h('span', { text: 'plate', class: 'b' }) };
    // a picture of the steps, not the machine's live position (follow-up review)
    wrap.append(canvas, ...Object.values(labels), h('em', { class: 'sr-plate-note', text: 'a picture, not the live machine' }));
    const W = 460, H = 200;
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); r.setSize(W, H, false); r.setClearColor(0, 0);
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, W / H, 1, 5000);
    cam.up.set(0, 0, 1); cam.position.set(200, -340, 150); cam.lookAt(-10, 0, 46);   // the bit, the plate, and the clip on its screw up the housing
    const dark = !document.documentElement.getAttribute('data-skin');
    const model = PM.build(THREE, { style: dark ? 'ghost' : 'ink' });
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
    const frame = now => {
      if (!document.contains(canvas) || !el.sheet.classList.contains('on')) { r.dispose(); raf = 0; return; }
      // flat: the bit comes down to the plate, touches, lifts, as touch off will do
      const k = ((now - t0) / 3200) % 1, still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const bitZ = pose === 'flat' ? (still ? 12 : 3 + 32 * Math.abs(Math.cos(k * Math.PI))) : pose === 'test' ? 30 : 60;
      model.set({ bitZ, plate: pose });
      r.render(scene, cam); place();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return { el: wrap, pose(p) { if (p !== pose) { pose = p; t0 = performance.now(); } } };
  }

  async function plateZero() {
    if (!isDirect() || S.machine.state.running) return;
    if (await S.machine.zZero()) { S.zeroZ = true; S.zeroSetAt = Date.now(); S.zeroFor = progKey(); if (S.toolChange) S.toolChange = null; else S.traced = false; }
    refresh();
  }

  // which program a zero was set for: a new program with other origin words retires it (Fable 3 #2)
  // the zero, kept across files and reloads: what was zeroed, when, and the card's count then
  const ZERO_KEY = 'swarf-run-zero';
  function rememberZero() { if (S.zeroXY || S.zeroZ) S.zeroHad = { xy: !!S.zeroXY, z: !!S.zeroZ }; saveZero(); }
  function saveZero() {
    const t = Date.now(); if (t - (S.zeroSavedAt || 0) < 500 && S.zeroHad) return; S.zeroSavedAt = t;
    try { localStorage.setItem(ZERO_KEY, JSON.stringify({ had: S.zeroHad || null, at: S.zeroSetAt || 0, steps: S.lastSteps || null })); } catch (e) { /* private window */ }
  }
  function progKey() { return S.prog ? `${S.prog.source}|${S.prog.name}|${originText().xy}` : ''; }
  function keepZero() {
    const had = S.zeroHad || { xy: true, z: true };
    S.zeroXY = !!had.xy; S.zeroZ = !!had.z; S.zx = S.zy = !!had.xy; S.zeroReconnect = false; S.discAt = 0; S.discWhy = '';
    if (S.lostAt || S.stoppedAt) S.traced = true;   // a job that was running had its trace; the student has just vouched for the zero
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
    const span = el.dro[a], inp = h('input', { type: 'number', step: 'any', class: 'v', value: (m.state.pos[a] || 0).toFixed(3) });
    span.replaceWith(inp); inp.focus(); inp.select();
    let done = false;
    const finish = ok => {
      if (done) return; done = true;
      const v = parseFloat(inp.value);
      inp.replaceWith(span);
      if (ok && isFinite(v)) {
        m.setWork(a, v);
        // a typed position sets that axis like zero does (and a new trace, unless it is Z after a tool change)
        if (a === 'x') S.zx = true; else if (a === 'y') S.zy = true; else { S.zeroZ = true; S.zStale = false; }
        if (S.zx && S.zy) S.zeroXY = true;
        S.zeroSetAt = Date.now(); S.zeroFor = progKey(); S.zeroLost = false;
        if (S.toolChange && a === 'z') S.toolChange = null; else S.traced = false;
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

  // Keys (ShopBot keypad layout): arrows X/Y, Page Up/Down Z, by the step setting
  // ('hold' moves while the key is down). Space or Esc stops, always.
  const JOG_KEYS = { ArrowRight: ['x', 1, '+X'], ArrowLeft: ['x', -1, '−X'], ArrowUp: ['y', 1, '+Y'], ArrowDown: ['y', -1, '−Y'], PageUp: ['z', 1, '+Z'], PageDown: ['z', -1, '−Z'] };
  function padButton(label) { return el.jog.querySelector(`.sr-pad button[data-axis="${label}"]`); }
  function onKey(e) {
    // a card on the sheet: only a click presses its buttons; Esc closes it (nothing is moving yet)
    if (S.open && el.sheet && el.sheet.classList.contains('on') && e.type === 'keydown' && !(S.machine && (S.machine.state.running || S.machine.homing))) {
      if (e.key === 'Escape') { e.preventDefault(); S.plateWatch = null; el.sheet.classList.remove('on'); refresh(); return; }
      const t = e.target;
      if ((e.key === ' ' || e.key === 'Enter') && t && t.tagName === 'BUTTON' && el.sheet.contains(t)) { e.preventDefault(); e.stopPropagation(); return; }
      if (t && t.tagName === 'INPUT') return;
    }
    // a running job: any key at all pauses it, router off (Phil 10-27)
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
  function start(plan) {
    if (!plan || !S.machine) { say('Nothing to run there.', 'warn'); return; }
    S.job = plan.kind;
    if (S.machine.setOverride) S.machine.setOverride(100);   // each job starts at its own feeds
    S.runMoves = plan.moves; S.runIdx = 0; S.userStopped = false;
    showPlan(plan);
    view.progress(0);
    if (S.machine instanceof M.SimMachine) S.machine.timeScale = S.simRate;
    S.machine.run(plan);
    if (!S.machine.state.running) tell(`Not run: ${S.machine.state.note}.`, 'warn');
    refresh();
  }


  // the test runs' own checklist: the router stays off, so no bit or speed check; the rest as for a cut
  function testChecklist() {
    const o = originText();
    return [
      'your board lies flat, screwed or clamped down, and the bit clears every screw and clamp',
      'the router stays off: swarf does not switch it on for this',
      inchItem(),
      /^the /.test(o.z) ? `Z zero is on ${o.z}` : `Z zero is ${o.z}`,
      'hands clear of the gantry, a foot near the floor e-stop'
    ].filter(Boolean);
  }
  // in the air: the deepest point clears the highest point of the cut by AIR_CLEAR, so a file
  // zeroed on the table does not run through the board (design review 10-28 #7)
  // the highest point of every move below safe height, rapids too (follow-up review #5: a file
  // that rapids down near a pocket floor cuts only below its board's top)
  function airTop() { const mv = S.prog ? S.prog.parsed.moves : []; let t = 0; for (const m of mv) { if (m.z < SAFE_Z - 0.5) t = Math.max(t, m.z); if (m.z0 < SAFE_Z - 0.5) t = Math.max(t, m.z0); } return t; }
  function airClear() { return AIR_CLEAR + airTop(); }
  function askCut(kind) {
    if (!S.prog) return;
    const from = kind === 'from', test = kind === 'trace' || kind === 'air';
    const line = from ? Math.max(1, Math.round(+el.fromLine.value || 1)) : 0;
    el.card.innerHTML = '';
    const items = test ? testChecklist() : checklist(from ? line : 0);
    const checks = items.map(t => h('input', { type: 'checkbox' }));
    const b = P.cutBounds(S.prog.parsed);
    const size = b ? `${(b.max.x - b.min.x).toFixed(0)} × ${(b.max.y - b.min.y).toFixed(0)} mm` : '';
    const words = {
      trace: { h: 'Trace the border', go: 'trace', p: `The machine is about to move. The bit goes up to 25 mm (1 in) over Z 0, then runs the rectangle the cut fills (${size}), router off. It checks the outside of the cut only, not clamps inside it. Watch that it stays over your board and clears every clamp. Check each one:` },
      air: { h: `Run ${S.prog.name} as an air cut`, go: 'air cut', p: `The machine is about to move. The whole file runs ${AIR_CLEAR} mm above its highest point, router off, about ${mins(S.prog.parsed.seconds)}. It is not a clamp check: watch the path before you cut. Check each one:` },
      from: { h: `Continue from line ${line}`, go: `continue from line ${line}`, p: `The machine is about to move and the router to start. The bit goes up to 25 mm (1 in), over to where that line starts, starts the router, then cuts the rest of the file. Check each one:` },
      cut: { h: `Cut ${S.prog.name}`, go: 'cut', p: `The machine is about to move and the router to start. The file runs to the end, about ${mins(S.prog.parsed.seconds)}. Check each one:` }
    }[from ? 'from' : test ? kind : 'cut'];
    const plan = makePlan(from ? 'from' : test ? kind : 'cut', line);
    const go = h('button', { class: 'go', text: words.go, disabled: '' });
    const bad = !plan ? 'There is nothing to run there.' : plan.problems.length ? `It can't run: ${plan.problems[0]}.` : '';
    const update = () => { go.disabled = !!bad || !checks.every(c => c.checked); };
    checks.forEach(c => c.addEventListener('change', update));
    // the way in, from where the bit is now: the same moves the machine will make
    const way = plan && window.SwarfRunPlan ? window.SwarfRunPlan.entryWords(plan) : '';
    const back = () => { el.sheet.classList.remove('on'); showPlan(null); };
    el.card.append(h('h2', { text: words.h }), h('p', { text: words.p }),
      ...(way ? [h('p', { class: 'sr-way', text: `The way in: ${way}.` })] : []),
      ...(bad ? [h('p', { class: 'sr-way bad', text: bad })] : []),
      ...items.map((t, i) => h('label', {}, checks[i], h('span', { text: t }))),
      h('div', { class: 'row' }, h('button', { text: 'not yet', onclick: back }), go));
    // the student's ticks arm this plan, and only it; a plan made before the bit moved will not run
    go.onclick = () => { el.sheet.classList.remove('on'); start(window.SwarfRunPlan.arm(plan)); };
    if (plan) showPlan(plan);
    el.sheet.classList.add('on');
  }

  // Every move swarf makes by itself asks first (Phil 10-28: "it should never move or turn on
  // spindle without popping up with a solid 'I am about to move' type message"). Jogs are the
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
    ok.onclick = () => { el.sheet.classList.remove('on'); if (isDirect() && window.SwarfSound) SwarfSound.play('move'); run(); };
    const no = h('button', { text: 'not yet', onclick: () => el.sheet.classList.remove('on') });
    el.card.append(h('h2', { text: title }), h('p', { text }), h('p', { text: 'Hands clear of the gantry, a foot near the floor e-stop. Once it moves, space or Esc stops it.' }),
      h('div', { class: 'row' }, no, ok));
    el.sheet.classList.add('on');
    no.focus();   // a stray key never starts the machine (Interfacing review 10-28 #1)
  }

  // A fault is latched (the follow-up review's fault state): after the e-stop, a lost link mid-job
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

  // A waiting trace, in the air or cut opens what is left to do (Phil 10-28: "If cut is
  // unavailable then clicking it should pop up what has to be done before cut")
  function needsCard(k) {
    const st = S.machine && S.machine.state;
    const ready = st && st.connected && !st.queued && !(st.kind === 'sim' && st.moving);
    const list = needs(st, ready).filter(n => k === 'cut' || n.k !== 'trace');
    const word = { trace: 'trace', air: 'run an air cut', cut: 'cut' }[k];
    const shut = () => el.sheet.classList.remove('on');
    const act = {
      conn: () => h('button', { text: 'connect', onclick: () => { shut(); connect(true); } }),
      fault: () => h('button', { text: 'all clear…', onclick: () => faultCard() }),
      prog: () => h('button', { text: 'make a part', onclick: () => { shut(); close(); const b = document.getElementById('swarf-step-shape'); if (b) b.click(); } }),
      z: () => S.machine && S.machine.state.connected ? h('button', { text: 'z plate', onclick: () => { shut(); plateWizard(); } }) : null,
      trace: () => h('button', { text: 'trace', onclick: () => { shut(); if (!needs(st, ready).some(n => !n.ok && n.k !== 'trace')) askCut('trace'); else needsCard('trace'); } })
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

  // ---- the table's corners: the machine's own frame (Phil 10-28: "a way to 0 to the front right
  // or front left corner of the machine - a kind of absolute positioning mode"). The shop machine
  // has no home switches, so swarf learns the front-left corner once, from the bit placed over it;
  // the step count keeps it until the box is switched off.
  const CORNER = 'swarf-table-corner';
  function tableSize() {
    try { const d = window.kiri.api.conf.get().device; return { x: d.bedWidth || 2438.4, y: d.bedDepth || 1219.2 }; } catch (e) { return { x: 2438.4, y: 1219.2 }; }
  }
  function corner() {
    if (S.corner === undefined) { try { S.corner = JSON.parse(localStorage.getItem(CORNER)) || null; } catch (e) { S.corner = null; } }
    // a corner learnt from the real box's count is lost when the box restarts (zeroLost), the simulator's when the page reloads
    // only for this page and this connection (design review 10-28 #6): a reload or a reconnect may hide a restart
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
        el.card.append(h('p', { text: 'swarf does not know where the table is yet (this machine has no home switches). Jog the bit right over the front-left corner of the table, the corner nearest you on the left, then press below. It holds until the machine is switched off.' }));
      } else {
        const p = m.mabs();
        el.card.append(h('p', { text: `Front-left corner learnt ${new Date(c.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. The bit is ${(p.x - c.x).toFixed(1)} mm right of it and ${(p.y - c.y).toFixed(1)} mm back. The table is ${T.x.toFixed(0)} × ${T.y.toFixed(0)} mm.` }));
        const rowFor = (name, cx, cy) => h('div', { class: 'sr-needrow' }, h('b', { text: '⌐' }), h('span', {}, h('strong', { text: name })),
          h('button', { text: 'make it X 0, Y 0', title: `The ${name} corner becomes X 0, Y 0; the bit does not move`, onclick: () => { zeroAtCorner(cx, cy); shut(); tell(`X 0, Y 0 is now the table's ${name} corner. The bit did not move.`); } }),
          h('button', { text: 'go there', title: `Up to 25 mm (1 in), then over the ${name} corner`, onclick: () => aboutToMove({ title: 'The bit is about to move', text: `Up to 25 mm (1 in) over Z 0 (if it is lower), then over the table's ${name} corner.`, go: 'move', run: () => goCorner(cx, cy) }) }));
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
    m.setWork('x', p.x - cx); m.setWork('y', p.y - cy);
    S.zx = S.zy = S.zeroXY = true; S.zeroSetAt = Date.now(); S.zeroFor = progKey(); S.zeroLost = false; S.traced = false;
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
        h('button', { text: a === 'z' ? '+20 mm up' : '+20 mm', onclick: () => { ok.classList.remove('ok'); m.jog(a, 20); } }),
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
    // the e-stop (Phil 10-29: the shop's is a momentary button on input 8, not ShopBot's usual 4)
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
  // Resume runs a plan of its own (third review #5): the veil shows its way back in, and pressing
  // resume arms that plan, and only it. The simulator keeps its own queue (no plan).
  function resumePlan() { return S.machine && S.machine.resumePlan ? S.machine.resumePlan() : null; }
  function resumeNow() {
    const plan = resumePlan();
    if (!plan) { S.machine.resume(); return; }
    if (plan.problems.length) { tell(`Not resumed: ${plan.problems[0]}.`, 'warn'); return; }
    S.runMoves = plan.moves; S.runIdx = 0;
    S.machine.resume(window.SwarfRunPlan.arm(plan));
  }

  // ------------------------------------------------------------ machine
  // One connect at a time: the page's own connect and a click must not both
  // open the box.
  async function disconnect() {
    const d = S.machine;
    if (!(d && d.disconnect)) return;
    if (await d.disconnect()) {
      // the zero stays (Phil 10-29: "just confirm that 0 is right"): on reconnect swarf asks to keep it,
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

  // Chrome's own reasons, in plain words (Phil 10-27: "Connect does nothing")
  function connWhy(e) {
    const m = (e && (e.name + ': ' + e.message)) || String(e);
    if (/COM port is in use/.test(m)) return 'ShopBot 3 (or another program) has the box\'s COM port. Quit ShopBot 3, then press connect. Only one program can use the box at a time.';
    if (onWindows() && /NotFoundError/.test(m)) return `Chrome found no ShopBot. On the shop PC, press connect and pick the ShopBot Controller (COM) port. On your own laptop, the box needs a one-time driver first: see help › control, "Windows laptop". ${WIN_ONE}`;
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
        S.connSession = (S.connSession || 0) + 1;   // a table corner learnt before this connection no longer counts
        // the card keeps its count while powered; a count that moved while unplugged means a restart
        const was = S.lastSteps, now = d.steps;
        // up to two queued blocks (~300 ticks) still run after a drop; a restart moves the count far more
        if (was && ['x', 'y', 'z'].some(a => Math.abs(was[a] - now[a]) > 600)) {
          S.zeroXY = S.zeroZ = S.traced = false; S.zx = S.zy = false; S.zeroSetAt = 0; S.zeroHad = null; S.zeroLost = true;
          saveZero();
          setCorner(null);   // the count restarted: the table's corner is unknown again
        } else if (was && (S.zeroXY || S.zeroZ || S.zeroHad)) {
          rememberZero();
          // an unchanged count cannot prove the box did not restart near zero (follow-up review #4):
          // the zero is not reused by itself; "use the last zero" asks the student to say so
          S.zeroXY = S.zeroZ = S.traced = false; S.zx = S.zy = false; S.zeroReconnect = true;
        }
        if (S.unsub) S.unsub();
        if (S.machine && S.machine.timer) clearTimeout(S.machine.timer);
        S.machine = d;
        // the machine says when: about to move, the router about to start, finished once the bit has coasted (third review #6)
        d.onCue = name => { if (window.SwarfSound) SwarfSound.play(name); };
        S.unsub = d.on(onState);
        return;
      }
      if (manual && d.state.note !== 'no ShopBot on USB' && !err) { refresh(); return; }
    }
    if (S.machine && !manual) return;
    if (S.unsub) S.unsub();
    if (S.machine && S.machine.timer) clearTimeout(S.machine.timer);
    S.machine = new M.SimMachine();
    S.machine.timeScale = S.simRate;
    if (manual && !(D && D.supported())) S.connMsg = NO_USB();
    S.unsub = S.machine.on(onState);
    refresh();
  }

  function onState(st) {
    if (isDirect() && (st.connected || st.lostMid)) { S.lastSteps = { ...S.machine.steps }; if (S.zeroXY || S.zeroZ) rememberZero(); else saveZero(); }
    for (const a of ['x', 'y', 'z']) el.dro[a].textContent = (st.pos[a] || 0).toFixed(3);
    if (isDirect() && st.mpos) for (const a of ['x', 'y', 'z']) el.dro[a].title = `machine count ${st.mpos[a].toFixed(2)} mm since the box was switched on · click to type a position`;
    el.mpos.textContent = isDirect() && st.mpos
      ? `machine ${['x', 'y', 'z'].map(a => a.toUpperCase() + ' ' + st.mpos[a].toFixed(1)).join(' ')} · ${S.machine.limitsKnown() ? 'limits on' : 'no end stops: watch the ends'}`
      : '';
    const tc = S.machine.mabs && corner();
    if (tc) { const p = S.machine.mabs(); el.mpos.textContent = `from the table's front-left corner: X ${(p.x - tc.x).toFixed(1)} Y ${(p.y - tc.y).toFixed(1)}` + (el.mpos.textContent ? ' · ' + el.mpos.textContent : ''); }
    view.setTool(st.pos);
    if (st.running) view.progress(st.line || 0);
    const sim = st.kind === 'sim';
    el.conn.className = 'sr-conn ' + (sim ? 'sim' : st.connected ? 'live' : '');
    const what = st.running ? (st.paused ? 'paused' : (S.job === 'trace' || S.job === 'air') ? 'test run' : 'cutting') : st.moving ? 'moving' : 'idle';
    el.connText.textContent = sim ? `simulator · ${what}` : st.connected ? `connected · ${what}${st.spindle ? ' · router on' : ''}` : 'not connected';
    el.conn.title = sim ? 'The simulator, not the real machine: plug the ShopBot in and press connect' : '';
    el.connBtn.style.display = st.connected && !sim ? 'none' : '';
    el.discBtn.style.display = st.connected && !sim ? '' : 'none';
    el.ovr.style.display = isDirect() && st.running ? '' : 'none';
    el.ovrVal.textContent = `${st.override || 100}%`;
    el.ovrDn.disabled = (st.override || 100) <= 50; el.ovrUp.disabled = (st.override || 100) >= 150;
    el.discBtn.disabled = !!(st.running || st.moving);
    el.simCtl.style.display = sim ? '' : 'none';
    el.big.textContent = st.dialog ? 'waiting for you' : st.running ? (st.paused ? 'paused' : (S.job === 'trace' || S.job === 'air') ? 'test run' : 'cutting') : st.moving ? 'moving' : st.connected ? 'idle' : 'offline';
    el.rows.innerHTML = '';
    const row = (k, v) => el.rows.append(h('div', { class: 'sr-row' }, h('span', { text: k }), h('span', { text: v })));
    row('router', st.routerUnknown ? 'unknown' : st.spindle ? 'on' : 'off');
    if (!sim && st.note && !st.running) el.rows.append(h('div', { class: 'sr-row note', text: st.note }));
    el.ask.classList.toggle('on', !!st.dialog);
    const veiled = !!(st.running && st.paused);
    if (veiled && !el.veil.classList.contains('on') && document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (veiled && !el.veil.classList.contains('on') && el.veilWay) {
      const rp = resumePlan(), way = rp && window.SwarfRunPlan ? window.SwarfRunPlan.entryWords(rp) : '';
      el.veilWay.textContent = rp && rp.problems.length ? `It can't resume: ${rp.problems[0]}.` : way ? `The way back in: ${way}.` : '';
      el.veilWay.classList.toggle('bad', !!(rp && rp.problems.length));
      if (el.resumeBtn) {
        el.resumeBtn.disabled = !!(rp && rp.problems.length);
        // the button says what the plan does: a pause on the way in has no router to start
        el.resumeBtn.textContent = !rp || rp.steps.some(x => x.router === true) ? 'start the router and resume' : 'resume';
      }
    }
    el.veil.classList.toggle('on', veiled);
    el.veil.parentElement.classList.toggle('sr-veiled', veiled);   // its buttons only: the ones under it hide (review 10-28)
    el.checkBtn.style.display = isDirect() && st.connected ? '' : 'none';
    el.plateBtn.style.display = st.connected ? '' : 'none';
    el.cornersBtn.style.display = st.connected && !st.running ? '' : 'none';
    el.plateBtn.classList.toggle('next', !!(S.prog && S.zeroXY && (!S.zeroZ || S.toolChange) && !st.running));
    // no home switches on the shop machine (10-27): Home shows over USB only once both sensors are set
    const hs = isDirect() && S.machine.homeCfg && S.machine.homeCfg.set;
    // the shop machine has no home switches and is zeroed by hand (Phil 10-27): Home only once both sensors are set
    el.homeBtn.style.display = hs && hs.x && hs.y ? '' : 'none';
    el.routerBtn.style.display = isDirect() && st.connected ? '' : 'none';
    el.routerBtn.classList.toggle('on', !!st.routerTest);
    el.routerBtn.disabled = !!(st.running || st.moving) && !st.routerTest;
    el.routerBtn.querySelector('small').textContent = st.routerTest ? 'on: stop' : 'test';
    el.note.textContent = isDirect()
      ? 'In an emergency, step on the red e-stop on the floor and keep clear until everything has stopped.'
      : 'This is the simulator, not the machine. Press connect with the ShopBot plugged in.';
    if (S.check) updateCheck(st);
    if (S.plateWatch) S.plateWatch(st);
    // 10-27: directions proven on the real box (no flips), so the check card waits for its button
    if (st.dialog) el.askText.textContent = st.dialog.caption || st.dialog.message || '';
    // a finished trace completes the trace step; a stopped one does not
    if (st.kind === 'shopbot' && st.running) st.line = lineAt(st.pos);
    if (st.routerUnknown && !S.fault && !st.estopped) S.fault = 'swarf could not tell whether the router was still on';
    // the e-stop latches once, when its note first appears (the note stays in the state after)
    // the e-stop (Phil 10-29): swarf lets go of the machine, and connecting again clears it, so no
    // all-clear checklist; the zero is offered back on reconnect
    if ((st.note || '') !== S.prevNote && /stopped by the (e-stop|remote stop)/.test(st.note || '')) { S.estopHit = true; S.discAt = Date.now(); S.discWhy = 'the e-stop'; S.hold = null; }
    S.prevNote = st.note || '';
    if (S.lastRunning && !st.running) {
      // only a real end of file is a finish: a stop, a hold or a dropped link keeps the line (Fable review 10-27)
      const finished = !S.userStopped && !st.stopHit && !st.lostMid && (st.kind === 'shopbot' ? st.done === true : /finished/.test(st.note));
      S.userStopped = false;
      if (st.lostMid && !S.fault) S.fault = `the USB link dropped at line ${S.lastLine || 1} while the machine was running`;
      if (st.lostMid && (S.job === 'cut' || S.job === 'from')) {
        S.lostAt = S.stoppedAt = S.lastLine || 1;
        el.fromLine.value = String(S.stoppedAt);
      } else if (st.toolChange && (S.job === 'cut' || S.job === 'from')) {
        S.stoppedAt = st.resumeLine; el.fromLine.value = String(S.stoppedAt);
        const t = fileTools();
        // the bit this change loads: the last name given at or before the change line
        const next = S.prog.parsed.events.filter(e => e.kind === 'tool-name' && e.line <= st.resumeLine - 1).pop();
        S.toolChange = `Tool change at line ${st.resumeLine - 1}${next ? `: put in the ${next.value}.` : '.'} swarf has switched the router off: wait until the bit has stopped turning, then change it. Leave the router's own switch on; swarf turns it back on.`;
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
    place();
    if (!S.placeHooked) { window.addEventListener('resize', place); S.placeHooked = true; }
    el.root.classList.add('open');
    const step = document.getElementById('swarf-step-run');
    if (step) step.classList.add('swarf-step-on');
    document.body.classList.add('swarf-run-open');   // lifts swarf's phase filters (the gray after export) off Run
    S.open = true;
    if (!S.machine) connect(false);
    view.resize(el.view);
    refresh();
  }
  function close() {
    playStop();
    if (S.machine && S.machine.state.running) { say('Stop the job before leaving control.', 'warn'); return; }
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
  // (Phil 10-28: "better indicate to users early and at the right time that Safari doesn't work")
  const usbOK = () => !!(window.ShopBotLink ? ShopBotLink.supported() : navigator && navigator.usb);
  // Windows reaches the box through ShopBot's own COM port, which one program holds at a time (Phil 10-29:
  // say so whenever the Windows version is used)
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
    if (!usbOK() && isShopBot() && !S.simOK && api && api.uc) {
      noUsbCard().then(go => { if (go) { S.simOK = true; runStep(); } });
      return;
    }
    // not set up for the ShopBot: offer it here, one press (review 10-28: "a shop with one
    // machine should not ask" you to find setup › machine first)
    if (!isShopBot()) {
      if (!api || !api.uc || !api.devices) return;
      const pre = ["<div class='f-col a-center swarf-shape'><h3>Control drives the shop's ShopBot</h3>",
        "<p class='swarf-shape-why' style='color:inherit;max-width:340px'>This job is set up for another machine. Switch it to the ShopBot (a 4 × 8 ft bed) and go on to control? The MR-1 uses export instead.</p></div>"];
      api.uc.confirm(undefined, { 'use the ShopBot': true, cancel: false }, undefined, { pre }).then(yes => {
        if (!yes) return;
        try { api.devices.select('ShopBot.Basic'); } catch (e) { api.show.alert(`swarf could not switch to the ShopBot: ${e.message}`, 8); return; }
        setTimeout(() => { placeEntry(); if (isShopBot()) runStep(); }, 400);
      });
      return;
    }
    open();
    // control runs what cam made: fresh toolpaths each time, unless a job is running
    if (!(S.machine && S.machine.state.running)) fromCam();
  }
  function placeEntry() {
    const step = document.getElementById('swarf-step-run');
    if (!step) return false;
    if (!step.dataset.wired) { step.addEventListener('click', runStep); step.dataset.wired = '1'; }
    const sb = isShopBot();
    step.classList.toggle('swarf-step-off', !sb);
    // control is the ShopBot's alone: another machine has no control step (Phil 10-28)
    step.style.display = sb ? '' : 'none';
    if (sb) warnNoUsb();
    step.title = sb && !usbOK() ? 'control: needs Chrome or Edge' : sb ? 'control the ShopBot: bring these toolpaths, jog, zero, trace, cut' : '';
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
          if (S.machine && S.machine.state.running) { e.stopPropagation(); e.preventDefault(); say('Stop the job before leaving control.', 'warn'); return; }
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
    if (!nodes) { el.sheet.classList.remove('on'); refresh(); return; }
    el.card.innerHTML = ''; el.card.append(...nodes); el.sheet.classList.add('on');
  }
  window.__swarfRun = { open, close, loadProgram, card, tell: (t, c) => tell(t, c), state: S, view: () => view, preview: PV };
})();
