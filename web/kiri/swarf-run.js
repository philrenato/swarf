/**
 * swarf run — Run mode: drive the ShopBot from swarf.
 *
 * Layout (Phil, 10-22): preview upper left, blank until a program loads; jog
 * upper right, always there, locked while a program runs. Program and its
 * steps lower left; machine status and ShopBot's own questions lower right.
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
  if (window.__swarfRunLoaded) return;
  window.__swarfRunLoaded = true;

  const P = window.SwarfRunParse, M = window.SwarfRunMachine;
  const SAFE_Z = 25.4;          // shop machine [VC] safe Z
  const AIR_CLEAR = 5;          // air cut: deepest point this far above zero
  const STEPS = ['load', 'check', 'zero', 'trace', 'cut'];
  const CHECKLIST = [
    'the stock is clamped or screwed down',
    'the bit in the spindle is the one this file was made for',
    'Z zero is where the file expects it',
    'safety glasses on, dust collection on',
    'I will stay at the machine until it finishes'
  ];

  // ------------------------------------------------------------ state
  const S = {
    open: false, machine: null, unsub: null,
    prog: null,          // { name, text, parsed, source }
    zeroXY: false, zeroZ: false, traced: false,
    job: null,           // what is running: 'trace' | 'air' | 'cut' | 'from' | 'preview'
    lastRunning: false, jogStep: 1, contHeld: null, simRate: 10
  };
  const el = {};

  // ------------------------------------------------------------ style
  // swarf's index.css makes every div a flex row and restyles every button, so
  // each rule below is scoped under #swarf-run (see scoped()) to outrank those.
  const CSS = `
#swarf-run div { display: block; }
#swarf-run button { display: inline-flex; align-items: center; justify-content: center; text-transform: none; letter-spacing: normal;
  font-size: inherit; margin: 0; white-space: normal; transition: border-color .12s, background .12s; color: var(--swarf-text, #d8d2c6); }
#swarf-run button:hover, #swarf-run button:active { background: var(--swarf-bg-3, #1c1817); color: var(--swarf-text, #d8d2c6); }
#swarf-run { position: fixed; inset: 0; z-index: 100000; display: none; flex-direction: column;
  background: var(--swarf-bg, #0a0808); color: var(--swarf-text, #d8d2c6);
  font-family: "JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace; font-size: 13px; }
#swarf-run.open { display: flex; }
#swarf-run button { font: inherit; color: inherit; cursor: pointer; }
#swarf-run button:disabled { cursor: not-allowed; opacity: .32; }
.sr-head { display: flex; align-items: center; gap: 14px; padding: 10px 16px; border-bottom: 1px solid var(--swarf-line, #2a1612); }
.sr-back { background: none; border: 1px solid var(--swarf-line-2, #3a1e18); border-radius: 999px; padding: 5px 12px; }
.sr-back:hover { border-color: var(--swarf-accent, #d02020); }
.sr-title { letter-spacing: .14em; color: var(--swarf-text-2, #8a857c); }
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
.sr-say { padding: 10px 16px 12px; font-size: 15px; line-height: 1.4; min-height: 24px; }
.sr-say.warn { color: var(--swarf-amber, #c08a3a); }
.sr-say.bad { color: var(--swarf-accent-hi, #ff3a2a); }
.sr-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 10px; padding: 0 16px 16px; }
.sr-col { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.sr-col > .sr-view { flex: 62 1 0; }
.sr-col > .sr-prog { flex: 38 1 0; }
.sr-col > .sr-jog { flex: 1 1 auto; }
.sr-col > .sr-mach { flex: none; }
.sr-box { background: var(--swarf-bg-2, #13100f); border: 1px solid var(--swarf-line, #2a1612); border-radius: 12px; min-height: 0; position: relative; overflow: hidden; }
.sr-box h3 { margin: 0; font-size: 11px; font-weight: 500; letter-spacing: .16em; color: var(--swarf-text-3, #58534a); padding: 10px 12px 6px; text-transform: uppercase; }
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
.sr-jog { padding-bottom: 10px; overflow-y: auto; transition: opacity .2s; }
.sr-jog.locked > :not(.sr-lock) { opacity: .28; pointer-events: none; filter: grayscale(1); }
.sr-lock { display: none; position: absolute; top: 8px; right: 12px; color: var(--swarf-text-2, #8a857c); font-size: 11px; }
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
.sr-chk { display: grid; grid-template-columns: 28px auto 1fr auto auto; gap: 8px; align-items: center; padding: 5px 0; }
.sr-chk b { font-size: 15px; }
.sr-chk span { color: var(--swarf-text-2, #8a857c); font-size: 12px; }
.sr-chk button, .sr-card .sr-out { border-radius: 8px; padding: 6px 10px; background: var(--swarf-bg-3, #1c1817); border: 1px solid var(--swarf-line-2, #3a1e18); }
.sr-pair { display: flex; gap: 8px; margin: 4px 0; }
.sr-pair button { border-radius: 8px; padding: 6px 10px; background: var(--swarf-bg-3, #1c1817); border: 1px solid var(--swarf-line-2, #3a1e18); }
.sr-chk button.ok { border-color: #2f9e5a; color: #6fd39a; }
.sr-card h3 { margin: 14px 0 4px; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: var(--swarf-text-2, #8a857c); }
.sr-dots { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 0 8px; }
.sr-dots i { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font: 600 11px "JetBrains Mono", ui-monospace, monospace; font-style: normal; border: 1px solid var(--swarf-line-2, #3a1e18); color: var(--swarf-text-2, #8a857c); }
.sr-dots i.on { background: var(--swarf-accent, #d02020); border-color: var(--swarf-accent, #d02020); color: #fff; }
.sr-card .sr-out.armed { border-color: var(--swarf-accent, #d02020); color: #fff; }
body.swarf-run-open { filter: none !important; }
#swarf-run-enter { margin-left: 8px; background: var(--swarf-accent, #d02020); color: #fff; border: none; border-radius: 999px; padding: 4px 14px;
  font: 600 12px "JetBrains Mono", ui-monospace, monospace; letter-spacing: .1em; cursor: pointer; align-self: center; }
#swarf-run-enter:hover { background: var(--swarf-accent-hi, #ff3a2a); }
@media (max-width: 900px) { .sr-grid { grid-template-columns: 1fr; overflow-y: auto; } .sr-col > .sr-view { flex: none; height: 360px; } }
`;

  // ------------------------------------------------------------ dom
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'class') e.className = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'text') e.textContent = attrs[k];
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

    // header
    el.conn = h('div', { class: 'sr-conn' }, h('span', { class: 'sr-dot' }), el.connText = h('span', { text: '' }),
      el.connBtn = h('button', { text: 'connect', onclick: () => connect(true) }));
    root.append(h('div', { class: 'sr-head' },
      h('button', { class: 'sr-back', text: '← back to cam', onclick: close, title: 'Return to toolpaths' }),
      h('div', { class: 'sr-title' }, h('b', { text: 'run' }), ' · shopbot'),
      el.conn));

    // steps + the sentence
    el.steps = h('div', { class: 'sr-steps' });
    STEPS.forEach((s, i) => el.steps.append(h('div', { class: 'sr-step', 'data-step': s }, h('span', { class: 'n', text: String(i + 1) }), h('span', { text: s }))));
    el.say = h('div', { class: 'sr-say' });
    root.append(el.steps, el.say);

    // grid
    const grid = h('div', { class: 'sr-grid' });
    root.append(grid);

    // preview (upper left)
    el.view = h('div', { class: 'sr-box sr-view' });
    el.canvas = h('canvas');
    el.empty = h('div', { class: 'sr-empty' }, h('div', {},
      h('b', { text: 'nothing loaded' }), h('br'), 'drop a .sbp or .nc file here, press load file, or bring the toolpaths over from cam'));
    el.facts = h('div', { class: 'sr-facts' });
    el.scrubLabel = h('span', { text: '' });
    el.scrub = h('input', { type: 'range', min: '0', max: '0', value: '0', title: 'Show the program up to a line' });
    el.scrub.addEventListener('input', () => { view.showUpTo(+el.scrub.value); el.scrubLabel.textContent = `line ${el.scrub.value}`; });
    el.view.append(el.canvas, el.empty, el.facts,
      h('div', { class: 'sr-vtools' },
        h('button', { text: 'top', onclick: () => view.camTop(), title: 'Look straight down' }),
        h('button', { text: '3d', onclick: () => view.camIso(), title: 'Angled view' }),
        h('button', { text: 'fit', onclick: () => view.fit(), title: 'Fit the program in view' })),
      h('div', { class: 'sr-scrub' }, el.scrub, el.scrubLabel));
    el.view.addEventListener('dragover', e => { e.preventDefault(); el.view.classList.add('drag'); });
    el.view.addEventListener('dragleave', () => el.view.classList.remove('drag'));
    el.view.addEventListener('drop', e => {
      e.preventDefault(); el.view.classList.remove('drag');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readFile(f);
    });

    // jog (upper right)
    el.jog = h('div', { class: 'sr-box sr-jog' }, h('h3', { text: 'jog' }), h('div', { class: 'sr-lock', text: 'locked while the program runs' }));
    el.dro = {};
    const dro = h('div', { class: 'sr-dro' });
    for (const a of ['x', 'y', 'z']) {
      el.dro[a] = h('span', { class: 'v', text: '0.000' });
      dro.append(h('div', { class: 'sr-axis' }, h('span', { class: 'a', text: a.toUpperCase() }), el.dro[a],
        h('button', { text: 'zero', title: `Make this ${a.toUpperCase()} position 0`, onclick: () => doZero(a) })));
    }
    el.jog.append(dro,
      h('div', { class: 'sr-zrow' },
        h('button', { text: 'zero x y', title: 'This spot becomes X 0, Y 0', onclick: () => doZero('xy') }),
        h('button', { text: 'zero z', title: 'This height becomes Z 0', onclick: () => doZero('z') }),
        el.plateBtn = h('button', { text: 'z plate', title: 'Zero Z on the plate: plate under the bit, clip on (ShopBot C2)', onclick: plateZero }),
        el.keepZero = h('button', { class: 'keep', text: 'keep zero', title: 'Use X, Y and Z zero as they are now', onclick: keepZero })));
    el.modes = h('div', { class: 'sr-modes' }, h('span', { text: 'step' }));
    for (const v of ['cont', 0.1, 1, 10, 50]) {
      const b = h('button', { text: v === 'cont' ? 'hold' : String(v), title: v === 'cont' ? 'Moves while you hold the arrow' : `Each press moves ${v} mm` });
      b.onclick = () => { S.jogStep = v; for (const c of el.modes.querySelectorAll('button')) c.classList.toggle('on', c === b); };
      if (v === 1) b.classList.add('on');
      el.modes.append(b);
    }
    el.jog.append(el.modes);
    const pad = h('div', { class: 'sr-pad' });
    const cell = (label, axis, dir, col, row) => {
      const b = h('button', { text: label, title: `Jog ${label}` });
      b.style.gridColumn = col; b.style.gridRow = row;
      b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); jogDown(axis, dir, b); });
      b.addEventListener('pointerup', () => jogUp(b));
      b.addEventListener('pointercancel', () => jogUp(b));
      b.addEventListener('lostpointercapture', () => jogUp(b));
      pad.append(b);
    };
    cell('+Y', 'y', 1, 2, 1); cell('−X', 'x', -1, 1, 2); cell('+X', 'x', 1, 3, 2); cell('−Y', 'y', -1, 2, 3);
    cell('+Z', 'z', 1, 5, 1); cell('−Z', 'z', -1, 5, 3);
    el.jog.append(pad,
      h('div', { class: 'sr-goto' },
        h('button', { text: 'home', title: 'Seek the home switches (ShopBot C3)', onclick: () => S.machine.home() }),
        h('button', { text: 'go to x y 0', title: 'Up to safe height, then over to X 0, Y 0', onclick: () => S.machine.goTo({ z: Math.max(S.machine.state.pos.z, SAFE_Z), x: 0, y: 0 }) }),
        h('button', { text: 'go to z 0', title: 'Down to Z 0 (slowly check the bit clears)', onclick: () => S.machine.goTo({ z: 0 }) })));

    // program (lower left)
    el.prog = h('div', { class: 'sr-box sr-prog' }, h('h3', { text: 'program' }));
    el.fileInput = h('input', { type: 'file', accept: '.sbp,.nc,.tap,.gcode,.txt', style: 'display:none' });
    el.fileInput.addEventListener('change', () => { if (el.fileInput.files[0]) readFile(el.fileInput.files[0]); el.fileInput.value = ''; });
    el.fileName = h('span', { class: 'name', text: 'no program' });
    el.fromCam = h('button', { text: 'use cam toolpaths', title: 'Bring the toolpaths you made in cam', onclick: fromCam });
    el.prog.append(el.fileInput, h('div', { class: 'sr-file' }, el.fileName, el.fromCam,
      h('button', { text: 'load file', onclick: () => el.fileInput.click(), title: 'Open a .sbp or .nc file' })));
    el.btn = {
      trace: h('button', { class: 'trace', text: 'trace', title: 'Run the outline 25 mm up, spindle off', onclick: () => start('trace') }),
      air: h('button', { class: 'air', text: 'air cut', title: 'Run the whole program above the stock, spindle off', onclick: () => start('air') }),
      cut: h('button', { class: 'cut', text: 'cut', title: 'Cut the program', onclick: askCut }),
      pause: h('button', { class: 'pause', text: 'pause', onclick: pauseResume }),
      stop: h('button', { class: 'stop', text: 'stop', title: 'Stop all motion', onclick: () => { S.userStopped = true; S.machine.stop(); } })
    };
    el.prog.append(h('div', { class: 'sr-actions' }, el.btn.trace, el.btn.air, el.btn.cut, el.btn.pause, el.btn.stop));
    el.fromLine = h('input', { type: 'number', min: '1', value: '1' });
    el.fromBtn = h('button', { text: 'cut from line', title: 'Up to safe height, over, then cut from this line on', onclick: () => askCut('from') });
    el.prog.append(h('div', { class: 'sr-from' }, 'restart after a break:', el.fromLine, el.fromBtn));
    el.plan = h('div', { class: 'sr-plan' });
    el.prog.append(el.plan);

    // status (lower right)
    el.stat = h('div', { class: 'sr-box sr-mach' }, h('h3', { text: 'machine' }));
    el.big = h('div', { class: 'sr-big', text: '—' });
    el.rows = h('div', {});
    el.ask = h('div', { class: 'sr-ask' }, el.askText = h('p'),
      h('button', { text: 'continue', onclick: () => S.machine.answer(1) }),
      h('button', { text: 'quit the file', onclick: () => S.machine.answer(-1) }));
    el.simCtl = h('div', { class: 'sr-sim' }, 'simulator speed');
    for (const r of [1, 10, 50]) {
      const b = h('button', { text: `${r}×`, onclick: () => { S.simRate = r; if (S.machine.timeScale !== undefined || S.machine instanceof M.SimMachine) S.machine.timeScale = r; for (const c of el.simCtl.querySelectorAll('button')) c.classList.toggle('on', c === b); } });
      if (r === S.simRate) b.classList.add('on');
      el.simCtl.append(b);
    }
    el.note = h('div', { class: 'sr-note', text: 'The red stop button on the machine stops everything, always. The stop here stops motion through ShopBot.' });
    el.checkBtn = h('button', { class: 'sr-out', text: 'check the machine', onclick: () => openCheck() });
    el.stat.append(h('div', { class: 'sr-stat' }, el.big, el.rows, el.ask, el.simCtl, el.checkBtn, el.note));

    grid.append(h('div', { class: 'sr-col' }, el.view, el.prog), h('div', { class: 'sr-col' }, el.jog, el.stat));

    // cut checklist sheet
    el.sheet = h('div', { class: 'sr-sheet' });
    el.card = h('div', { class: 'sr-card' });
    el.sheet.append(el.card);
    root.append(el.sheet);

    document.body.append(root);
    view.init(el.canvas, el.view);
  }

  // ------------------------------------------------------------ viewer
  const view = {
    init(canvas, box) {
      const THREE = window.THREE;
      this.THREE = THREE;
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.renderer.setClearColor(0x0d0a09, 1);
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(40, 1, 1, 50000);
      this.camera.up.set(0, 0, 1);
      this.target = new THREE.Vector3(0, 0, 0);
      this.sph = { r: 800, th: -Math.PI / 2 + 0.5, ph: 0.9 };
      this.paths = null;
      this.done = -1;
      // origin axes
      const ax = new THREE.Group();
      const axis = (x, y, z, c) => {
        const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(x, y, z)]);
        return new THREE.Line(g, new THREE.LineBasicMaterial({ color: c }));
      };
      ax.add(axis(40, 0, 0, 0xd02020), axis(0, 40, 0, 0x3fbf6a), axis(0, 0, 40, 0x4a7fd0));
      this.scene.add(ax);
      // tool
      // a cone with its tip at the group origin (the bit's tip), widening upward
      const tool = new THREE.Mesh(new THREE.ConeGeometry(4, 18, 20), new THREE.MeshBasicMaterial({ color: 0xd8d2c6 }));
      tool.geometry.translate(0, -9, 0);
      tool.rotation.x = -Math.PI / 2;
      this.tool = new THREE.Group();
      this.tool.add(tool);
      this.scene.add(this.tool);
      this.grid = null;
      this.bindOrbit(canvas);
      new ResizeObserver(() => this.resize(box)).observe(box);
      this.resize(box);
      const loop = () => { this.renderer.render(this.scene, this.camera); requestAnimationFrame(loop); };
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
      c.addEventListener('wheel', e => { e.preventDefault(); this.sph.r *= Math.exp(e.deltaY * 0.001); this.place(); }, { passive: false });
      this.place();
    },
    load(parsed) {
      const THREE = this.THREE;
      if (this.paths) { this.scene.remove(this.paths); this.paths.geometry.dispose(); }
      if (this.grid) { this.scene.remove(this.grid); }
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
      this.scene.add(this.paths);
      this.bounds = parsed.bounds;
      const b = P.cutBounds(parsed) || parsed.bounds;
      if (b) {
        const sx = Math.max(50, b.max.x - b.min.x), sy = Math.max(50, b.max.y - b.min.y);
        const size = Math.ceil(Math.max(sx, sy) * 1.4 / 50) * 50;
        this.grid = new THREE.GridHelper(size, size / 10, 0x3a1e18, 0x1f1614);
        this.grid.rotation.x = Math.PI / 2;
        this.grid.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, Math.min(0, b.min.z) - 0.2);
        this.scene.add(this.grid);
      }
      this.done = -1;
      // tool marker sized to the job: about a tenth of its span, 6-40 mm tall
      const span = b ? Math.max(b.max.x - b.min.x, b.max.y - b.min.y) : 200;
      this.tool.scale.setScalar(Math.min(40, Math.max(6, span / 10)) / 18);
      this.paint(Infinity, Infinity);
      this.fit();
    },
    clear() {
      if (this.paths) { this.scene.remove(this.paths); this.paths = null; }
      if (this.grid) { this.scene.remove(this.grid); this.grid = null; }
    },
    // upTo: lines shown at all; doneLine: lines already run (brighter)
    paint(upTo, doneLine) {
      if (!this.paths) return;
      const col = this.paths.geometry.attributes.color;
      const a = col.array;
      for (let i = 0; i < this.lineOf.length; i++) {
        const ln = this.lineOf[i];
        let r, g, b;
        if (ln > upTo) { r = g = b = 0.06; }
        else if (this.rapid[i]) { r = 0.34; g = 0.33; b = 0.29; }
        else if (ln <= doneLine) { r = 1.0; g = 0.25; b = 0.16; }
        else { r = 0.62; g = 0.14; b = 0.11; }
        a[i * 6] = a[i * 6 + 3] = r; a[i * 6 + 1] = a[i * 6 + 4] = g; a[i * 6 + 2] = a[i * 6 + 5] = b;
      }
      col.needsUpdate = true;
    },
    showUpTo(line) { this.upTo = line; this.paint(line, this.doneLine || 0); },
    progress(line) { this.doneLine = line; this.paint(this.upTo === undefined ? Infinity : this.upTo, line); },
    setTool(p) { this.tool.position.set(p.x, p.y, p.z); },
    fit() {
      const b = this.bounds;
      if (!b) { this.target.set(0, 0, 0); this.sph.r = 600; this.place(); return; }
      this.target.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
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

  function fromCam() {
    const api = window.kiri && window.kiri.api;
    if (!api || !api.function || !api.function.export) { say('Cam is not ready yet.', 'warn'); return; }
    say('Getting the toolpaths from cam…');
    try {
      api.function.export((text) => {
        const names = api.widgets.all().map(w => w.meta && w.meta.file).filter(Boolean);
        const base = (names[0] || 'swarf').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').slice(0, 40);
        loadProgram(base + '.sbp', text, 'cam');
      });
    } catch (e) {
      say('There are no toolpaths yet. Go back to cam and press toolpaths first.', 'warn');
    }
  }

  function loadProgram(name, text, source) {
    const parsed = P.parse(text, { machineUnits: 'mm' });
    S.prog = { name, text, parsed, source };
    S.zeroXY = S.zeroZ = S.traced = false;
    S.zx = S.zy = false; S.stoppedAt = 0; S.lastDone = null;
    el.fileName.textContent = name;
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
    if (!b) return { xy: 'X 0, Y 0', z: 'Z 0' };
    const near = (v, w) => Math.abs(v) <= Math.max(2, w * 0.03);
    const w = b.max.x - b.min.x, d = b.max.y - b.min.y;
    let xy;
    if (near(b.min.x, w) && near(b.min.y, d)) xy = 'the front-left corner of your stock';
    else if (near((b.min.x + b.max.x) / 2, w) && near((b.min.y + b.max.y) / 2, d)) xy = 'the center of your stock';
    else xy = `the point your file calls X 0, Y 0 (the cut spans X ${b.min.x.toFixed(0)} to ${b.max.x.toFixed(0)}, Y ${b.min.y.toFixed(0)} to ${b.max.y.toFixed(0)} mm)`;
    const z = b.max.z <= 2 && b.min.z < 0 ? 'the top of your stock' : b.min.z >= -0.5 ? 'the table (the bottom of your stock)' : 'where your file puts Z 0';
    return { xy, z };
  }

  function problems() {
    const out = { block: [], warn: [] };
    if (!S.prog) return out;
    const p = S.prog.parsed;
    if (!p.moves.length) out.block.push('The file has no moves this screen can read.');
    if (p.units !== 'mm') out.block.push('This file is in inches and the ShopBot runs millimeters. Make the file again with the millimeter post-processor.');
    const b = P.cutBounds(p);
    const L = M.LIMITS;
    if (b && S.machine && S.machine.state.kind === 'shopbot' && S.zeroXY) {
      // after zeroing, location 0 is the job origin, so the job must fit inside travel from here
    }
    if (b) {
      const w = b.max.x - b.min.x, d = b.max.y - b.min.y;
      if (w > L.x[1] - L.x[0] || d > L.y[1] - L.y[0]) out.block.push(`The cut is ${w.toFixed(0)} × ${d.toFixed(0)} mm, bigger than the table.`);
    }
    if (p.unsupported.length) out.warn.push(`${p.unsupported.length} line${p.unsupported.length > 1 ? 's' : ''} this preview can't draw (ShopBot will still run ${p.unsupported.length > 1 ? 'them' : 'it'}). First: line ${p.unsupported[0].line}, "${p.unsupported[0].text.slice(0, 40)}".`);
    for (const w of p.warnings) if (!/units|inches|millimeters/.test(w.text)) out.warn.push((w.line ? `line ${w.line}: ` : '') + w.text);
    return out;
  }

  function renderPlan() {
    el.plan.innerHTML = '';
    if (!S.prog) return;
    const p = S.prog.parsed, b = P.cutBounds(p);
    const add = (t, cls) => el.plan.append(h('div', { class: cls || '', text: t }));
    if (b) {
      add(`size  ${(b.max.x - b.min.x).toFixed(1)} × ${(b.max.y - b.min.y).toFixed(1)} mm, ${(-Math.min(0, b.min.z)).toFixed(1)} mm deep`);
      el.facts.textContent = `${(b.max.x - b.min.x).toFixed(0)} × ${(b.max.y - b.min.y).toFixed(0)} mm · ${(-Math.min(0, b.min.z)).toFixed(1)} deep · about ${mins(p.seconds)}`;
    } else el.facts.textContent = '';
    add(`time  about ${mins(p.seconds)} of cutting and moving`);
    add(`units ${p.units === 'mm' ? 'millimeters' : 'inches'}`);
    const tools = p.events.filter(e => e.kind === 'tool' || e.kind === 'tool-change');
    const rpm = p.events.filter(e => e.kind === 'rpm').map(e => e.value).filter(v => v > 0);
    if (rpm.length) add(`spindle ${[...new Set(rpm)].join(', ')} rpm`);
    const changes = p.events.filter(e => e.kind === 'tool-change');
    if (changes.length > 1) add(M.DirectMachine && S.machine instanceof M.DirectMachine
      ? `${changes.length} tool changes: a change after cutting starts ends the cut there, with the spindle off and Z up; change the bit, zero Z, then cut from the line it names`
      : `${changes.length} tool changes: ShopBot will stop and ask at each one`, 'w');
    else if (tools.length) add('one tool');
    const pr = problems();
    for (const t of pr.block) add(t, 'b');
    for (const t of pr.warn) add(t, 'w');
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

  function refresh() {
    const st = S.machine ? S.machine.state : null;
    const now = stepNow();
    const idx = STEPS.indexOf(now);
    for (const node of el.steps.children) {
      const i = STEPS.indexOf(node.dataset.step);
      node.className = 'sr-step' + (i < idx ? ' done' : i === idx ? (now === 'check' ? ' blocked' : ' now') : '');
    }
    const running = st && st.running;
    // commands still on their way to ShopBot count as busy: nothing new starts until they land
    const ready = st && st.connected && !st.queued && !(st.kind === 'sim' && st.moving) && !S.checking && !S.linkBad;
    el.jog.classList.toggle('locked', !!running);
    el.btn.trace.disabled = running || !ready || idx < 3;
    el.btn.air.disabled = running || !ready || idx < 3;
    el.btn.cut.disabled = running || !ready || idx < 4;
    el.fromBtn.disabled = running || !ready || idx < 4;
    el.btn.trace.classList.toggle('next', now === 'trace' && !running);
    el.btn.pause.disabled = !running;
    el.btn.pause.textContent = st && st.paused ? 'resume' : 'pause';
    el.btn.stop.disabled = !st;
    el.fromCam.disabled = !!running;
    el.keepZero.disabled = !S.prog || running;
    coach(now, st);
  }

  function coach(now, st) {
    if (st && st.dialog) return say(`ShopBot is asking: ${st.dialog.caption || st.dialog.message}`, 'warn');
    if (st && st.running) {
      const total = S.prog ? S.prog.parsed.lines : 0;
      const what = { trace: 'Tracing the outline 25 mm up, spindle off', air: 'Air cut above the stock, spindle off', cut: 'Cutting', from: 'Cutting', preview: 'Previewing' }[S.job] || 'Running';
      const where = (S.job === 'cut' || S.job === 'from') ? `, line ${st.line || 0} of ${total}` : '';
      if (st.paused) return say(`${what}: paused. Press resume to go on, or stop to end the file.`, 'warn');
      return say(`${what}${where}. Stay at the machine. Pause or stop any time; the red button on the machine stops everything.`);
    }
    if (S.checking) return say('Checking that ShopBot takes commands from swarf. This is a preview: nothing moves.');
    if (S.linkBad) return say('ShopBot did not take the test file from swarf. Close ShopBot 3 and the helper window, then double-click the helper again. If it happens again, use ShopBot 3 by itself today.', 'bad');
    if (st && !st.connected && M.DirectMachine && S.machine instanceof M.DirectMachine) return say(`Not connected: ${st.note}. Plug the box's USB cable into this computer and press connect.`, 'bad');
    if (st && !st.connected) return say(st.note && st.kind === 'shopbot' ? `Not connected: ${st.note}. Start the helper on the shop laptop and open ShopBot 3.` : 'Not connected to the machine.', 'bad');
    const o = originText();
    switch (now) {
      case 'load': return say('Load a file, or bring your toolpaths over from cam.');
      case 'check': return say(problems().block[0], 'bad');
      case 'zero':
        if (!S.zeroXY) return say(`Jog the bit over ${o.xy}, then press zero x y.`);
        if (isDirect() && S.machine.plateCfg.confirmed && /top|table/.test(o.z)) return say(`Lower the bit until it just touches ${o.z}, then press zero z; or set the plate there under the bit and press z plate.`);
        return say(`Lower the bit until it just touches ${o.z}, then press zero z.`);
      case 'trace': return say('Press trace. The bit runs around the outline 25 mm up with the spindle off. Watch that it stays over your stock.');
      case 'cut':
        if (S.stoppedAt && st && st.resumeLine === S.stoppedAt) return say(`${st.note[0].toUpperCase()}${st.note.slice(1)}. The spindle is off and the bit is up.`, 'warn');
        if (S.stoppedAt) return say(`Stopped at line ${S.stoppedAt}. Raise the bit with +Z first. To finish the job press cut from line (it is set to ${S.stoppedAt}); to start over press cut.`, 'warn');
        return say(S.lastDone === 'cut' || S.lastDone === 'from' ? 'Finished. Vacuum, then lift the bit away before you unclamp.' : 'Ready. Press cut. You will confirm a short checklist first.');
    }
  }

  function say(text, cls) {
    el.say.textContent = text || '';
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
    if (axes.includes('z')) S.zeroZ = true;
    S.traced = false;
    refresh();
  }

  async function plateZero() {
    if (!isDirect() || S.machine.state.running) return;
    if (await S.machine.zZero()) { S.zeroZ = true; S.traced = false; }
    refresh();
  }

  function keepZero() {
    S.zeroXY = S.zeroZ = true;
    refresh();
  }

  function jogDown(axis, dir, b) {
    if (!S.machine || S.machine.state.running) return;
    b.classList.add('held');
    if (S.jogStep === 'cont') { S.contHeld = b; S.machine.jogHold(axis, dir); }
    else S.machine.jog(axis, dir * S.jogStep);
  }
  function jogUp(b) {
    b.classList.remove('held');
    if (S.contHeld === b) { S.contHeld = null; S.machine.jogRelease(); }
  }

  function start(kind, extra) {
    if (!S.prog || !S.machine) return;
    const p = S.prog.parsed, name = S.prog.name.replace(/\.[^.]+$/, '');
    let prog;
    if (kind === 'trace') prog = P.traceProgram(p, SAFE_Z, name);
    else if (kind === 'air') prog = P.airProgram(p, AIR_CLEAR, name, SAFE_Z);
    else if (kind === 'from') prog = P.fromLineProgram(p, extra, SAFE_Z, name);
    else prog = { name, moves: p.moves, sbp: S.prog.text, spindle: true };
    if (!prog) { say('Nothing to run there.', 'warn'); return; }
    S.job = kind;
    S.runMoves = prog.moves; S.runIdx = 0; S.userStopped = false;
    if (kind === 'air') view.load({ ...p, moves: prog.moves, bounds: P.boundsOf(prog.moves) });
    else if (view.bounds !== p.bounds) view.load(p);
    view.progress(0);
    if (S.machine instanceof M.SimMachine) S.machine.timeScale = S.simRate;
    S.machine.run({ ...prog, preview: false });
    refresh();
  }

  function askCut(kind) {
    const from = kind === 'from';
    const line = from ? Math.max(1, Math.round(+el.fromLine.value || 1)) : 0;
    el.card.innerHTML = '';
    const checks = CHECKLIST.map(t => h('input', { type: 'checkbox' }));
    const go = h('button', { class: 'go', text: from ? `cut from line ${line}` : 'cut', disabled: '' });
    const update = () => { go.disabled = !checks.every(c => c.checked); };
    checks.forEach(c => c.addEventListener('change', update));
    el.card.append(
      h('h2', { text: from ? `Cut from line ${line}` : `Cut ${S.prog.name}` }),
      h('p', { text: from
        ? 'The bit goes up to 25 mm, over to where that line starts, starts the spindle, then cuts the rest of the file.'
        : `The spindle starts and the file runs to the end, about ${mins(S.prog.parsed.seconds)}. Check each one:` }),
      ...CHECKLIST.map((t, i) => h('label', {}, checks[i], h('span', { text: t }))),
      h('div', { class: 'row' }, h('button', { text: 'not yet', onclick: () => el.sheet.classList.remove('on') }), go));
    go.onclick = () => { el.sheet.classList.remove('on'); start(from ? 'from' : 'cut', line); };
    el.sheet.classList.add('on');
  }

  // ------------------------------------------------------------ machine check (USB)
  // Once per machine: which way each axis runs, which input is which switch,
  // whether output 1 is the spindle. Opens on the first USB connection.
  const CHECKED = 'swarf-shopbot-checked';
  const AXIS_HINT = { x: 'should go away from the home corner, along the long side', y: 'should go away from the home corner, across the table', z: 'should go up' };
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
        h('button', { text: a === 'z' ? '+1 mm up' : '+1 mm', onclick: () => { ok.classList.remove('ok'); m.jog(a, 1); } }),
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
    const out = h('button', { class: 'sr-out', text: 'test output 1 (spindle) for 2 s' });
    out.onclick = async () => {
      if (!out.classList.contains('armed')) { out.classList.add('armed'); out.textContent = 'press again: the spindle may start'; return; }
      out.classList.remove('armed'); out.disabled = true; out.textContent = 'output 1 on…';
      await m.testOutput(1, 2000).catch(e => say(e.message, 'bad'));
      out.disabled = false; out.textContent = 'test output 1 (spindle) for 2 s';
    };
    el.card.append(
      h('h2', { text: 'Check the machine' }),
      h('p', { text: 'Once per machine. Keep a hand near the red stop button.' }),
      ...axes,
      h('h3', { text: 'inputs' }),
      h('p', { text: 'Press a limit switch, or touch the plate to the bit. The number that lights is that input.' }),
      dots,
      h('h3', { text: 'home sensors' }),
      h('p', { text: 'Hold something metal at the X home sensor. When its number lights, press X; then the same for Y.' }),
      h('div', { class: 'sr-pair' },
        h('button', { text: "that's X home", onclick: () => take('x') }),
        h('button', { text: "that's Y home", onclick: () => take('y') })),
      homeText,
      h('h3', { text: 'Z plate' }),
      h('p', { text: 'Clip on, touch the plate to the bit and hold it there.' }),
      h('button', { text: "that's the Z plate", onclick: takePlate }),
      plateText,
      h('h3', { text: 'spindle' }),
      out,
      h('div', { class: 'row' },
        h('button', { text: 'save log', onclick: saveLog }),
        h('button', { class: 'go', text: 'done', onclick: () => { try { localStorage.setItem(CHECKED, '1'); } catch (e) {} S.check = null; el.sheet.classList.remove('on'); } })));
    el.sheet.classList.add('on');
    updateCheck(st);
  }
  // inputs 1-8 = P6 bits 0-7, 9-12 = P2 bits 0-3; lit = changed since the card opened
  function updateCheck(st) {
    const c = S.check;
    if (!c || !st.inputs) return;
    if (!c.base) c.base = { ...st.inputs };
    c.dots.forEach((d, i) => {
      const [now, was] = i < 8 ? [st.inputs.p6 >> i & 1, c.base.p6 >> i & 1] : [st.inputs.p2 >> (i - 8) & 1, c.base.p2 >> (i - 8) & 1];
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
    if (st.paused) S.machine.resume(); else S.machine.pause();
  }

  // ------------------------------------------------------------ machine
  // One connect at a time: the page's own connect and a click must not both
  // open the box.
  function connect(manual) {
    S.connecting = (S.connecting || Promise.resolve()).then(() => connectNow(manual), () => connectNow(manual));
    return S.connecting;
  }

  async function connectNow(manual) {
    // Chrome/Edge: the box straight over USB. A box this page was allowed
    // before connects by itself; the connect button asks once.
    const D = M.DirectMachine;
    if (D && D.supported() && (manual || await D.known())) {
      if (S.machine instanceof D && S.machine.state.connected) return;
      const d = new D();
      const ok = await d.connect(manual).catch(e => { d.set({ note: e.message }); return false; });
      if (ok) {
        if (S.unsub) S.unsub();
        if (S.machine && S.machine.timer) clearTimeout(S.machine.timer);
        S.machine = d;
        S.unsub = d.on(onState);
        return;
      }
      if (manual && d.state.note !== 'no ShopBot on USB') { say(`ShopBot over USB: ${d.state.note}.`, 'bad'); return; }
    }
    const real = await M.BridgeMachine.available();
    if (S.machine && real && S.machine.state.kind === 'shopbot') return;
    if (!real && S.machine && !manual) return;
    if (S.unsub) S.unsub();
    if (S.machine && S.machine.timer) clearTimeout(S.machine.timer);
    S.machine = real ? new M.BridgeMachine().start() : new M.SimMachine();
    if (!real) S.machine.timeScale = S.simRate;
    if (manual && !real) say('The shop laptop helper is not running here. Using the simulator.', 'warn');
    S.unsub = S.machine.on(onState);
    if (real) checkLink();
  }

  // Once per laptop: prove ShopBot takes commands from swarf, in preview.
  async function checkLink() {
    let ok = false;
    try { ok = localStorage.getItem('swarf-run-link-ok') === '1'; } catch (e) {}
    if (ok) return;
    const m = S.machine;
    for (let i = 0; i < 50 && !m.state.connected; i++) await new Promise(r => setTimeout(r, 200));
    if (!m.state.connected) return;
    S.checking = true; refresh();
    const good = await m.verify().catch(() => false);
    S.checking = false;
    if (good) { try { localStorage.setItem('swarf-run-link-ok', '1'); } catch (e) {} }
    S.linkBad = !good;
    refresh();
  }

  function onState(st) {
    for (const a of ['x', 'y', 'z']) el.dro[a].textContent = (st.pos[a] || 0).toFixed(3);
    view.setTool(st.pos);
    if (st.running) view.progress(st.line || 0);
    const sim = st.kind === 'sim';
    el.conn.className = 'sr-conn ' + (sim ? 'sim' : st.connected ? 'live' : '');
    el.connText.textContent = sim ? 'simulator — not the real machine' : st.connected ? 'shopbot connected' : 'shopbot not connected';
    el.connBtn.style.display = st.connected && !sim ? 'none' : '';
    el.simCtl.style.display = sim ? '' : 'none';
    el.big.textContent = st.dialog ? 'waiting for you' : st.running ? (st.paused ? 'paused' : (S.job === 'trace' || S.job === 'air') ? 'test run' : 'cutting') : st.moving ? 'moving' : st.connected ? 'idle' : 'offline';
    el.rows.innerHTML = '';
    const row = (k, v) => el.rows.append(h('div', { class: 'sr-row' }, h('span', { text: k }), h('span', { text: v })));
    row('spindle', st.spindle ? 'on' : 'off');
    if (st.running) row('line', `${st.line || 0} of ${S.prog ? S.prog.parsed.lines : '—'}`);
    if (!sim && st.note) row('note', st.note);
    el.ask.classList.toggle('on', !!st.dialog);
    el.checkBtn.style.display = isDirect() && st.connected ? '' : 'none';
    el.plateBtn.style.display = isDirect() && st.connected ? '' : 'none';
    el.note.textContent = isDirect()
      ? 'The red stop button on the machine stops everything, always. The stop here slows the machine to a stop and turns the spindle off.'
      : 'The red stop button on the machine stops everything, always. The stop here stops motion through ShopBot.';
    if (S.check) updateCheck(st);
    if (isDirect() && st.connected && !S.checkShown && !st.running) {
      let done = false;
      try { done = localStorage.getItem(CHECKED) === '1'; } catch (e) {}
      if (!done) setTimeout(openCheck, 0); else S.checkShown = true;
    }
    if (st.dialog) el.askText.textContent = st.dialog.caption || st.dialog.message || '';
    // a finished trace completes the trace step; a stopped one does not
    if (st.kind === 'shopbot' && st.running) st.line = lineAt(st.pos);
    if (S.lastRunning && !st.running) {
      const finished = !S.userStopped && !st.stopHit && (st.kind === 'shopbot' || /finished/.test(st.note));
      S.userStopped = false;
      if (finished) {
        if (S.job === 'trace') S.traced = true;
        S.lastDone = S.job;
        S.stoppedAt = 0;
      } else if (S.job === 'cut' || S.job === 'from') {
        S.stoppedAt = st.resumeLine || S.lastLine || 0;
        if (S.stoppedAt) el.fromLine.value = String(S.stoppedAt);
      }
      S.job = null;
    }
    if (st.running) S.lastLine = st.line || S.lastLine;
    S.lastRunning = st.running;
    refresh();
  }

  // ShopBot does not publish the line it is on; take the nearest segment of the
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
  function open() {
    if (!el.root) build();
    el.root.classList.add('open');
    document.body.classList.add('swarf-run-open');   // lifts swarf's phase filters (the gray after export) off Run
    S.open = true;
    if (!S.machine) connect(false);
    view.resize(el.view);
    refresh();
  }
  function close() {
    if (S.machine && S.machine.state.running) { say('Stop the program before leaving run.', 'warn'); return; }
    el.root.classList.remove('open');
    document.body.classList.remove('swarf-run-open');
    S.open = false;
  }

  // Entry: a "run" pill in swarf's menubar, for the ShopBot only.
  function isShopBot() {
    const api = window.kiri && window.kiri.api;
    try { return /shopbot/i.test(api.conf.get().device.deviceName || ''); } catch (e) { return false; }
  }
  function placeEntry() {
    const bar = document.getElementById('menubar');
    if (!bar) return false;
    let b = document.getElementById('swarf-run-enter');
    if (!b) {
      b = h('button', { id: 'swarf-run-enter', text: 'run ▸', title: 'Run the ShopBot: preview, jog, test, cut', onclick: open });
      bar.append(b);
    }
    b.style.display = isShopBot() ? '' : 'none';
    return true;
  }
  let tries = 0;
  const poll = setInterval(() => {
    const api = window.kiri && window.kiri.api;
    if ((api && api.event && placeEntry()) || ++tries > 200) {
      clearInterval(poll);
      if (api && api.event) {
        for (const ev of ['device.selected', 'settings.saved', 'device.select']) api.event.on(ev, () => placeEntry());
      }
    }
  }, 150);

  // renato.design/swarf-app/#run opens straight into Run (the laptop helper links here)
  if (location.hash === '#run') {
    const t = setInterval(() => { if (window.THREE && document.body) { clearInterval(t); open(); } }, 200);
  }

  window.__swarfRun = { open, close, loadProgram, state: S };
})();
