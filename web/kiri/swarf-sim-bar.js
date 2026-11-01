/**
 * swarf simulate-bar extensions — renders visualization toggles in both the
 * SIMULATE sim-bar (#layer-animate) and a small floating TOOLPATHS bar that
 * appears whenever the sim-bar isn't populated. Both surfaces share state
 * via the same __swarfPaths / __swarfLightstream / __swarfChipsVisible
 * window flags and CustomEvents, so flipping a toggle in one place updates
 * all mirrors instantly.
 *
 * Buttons:
 *   chips        — physics layer (simulate only)
 *   paths        — Kiri default wire (default OFF — button stays visible)
 *   lightstreams — Tron-red ribbon (default ON)
 *
 * Visual rule (markup Apr 15 r10-c): ON = mill-red, OFF = solid black.
 * Both states are fully visible; OFF is never hidden.
 */
(function () {
  'use strict';
  if (window.__swarfSimBarLoaded) return;
  window.__swarfSimBarLoaded = true;

  // swarf v010 r8: chips default OFF — reserved for when the student
  // explicitly turns on the "feels like a real cut" view.
  try {
    const chipsSaved = localStorage.getItem('swarf.chips');
    window.__swarfChipsVisible = chipsSaved === '1';
  } catch (e) { window.__swarfChipsVisible = false; }
  window.__swarfCustomSpeed = null; // null = use built-in cycle

  // swarf v010 r7: two independent toolpath toggles (can both be on)
  //   __swarfLightstream — Tron red ribbons (default ON)
  //   __swarfPaths       — Kiri default yellow-wire path (default OFF)
  const LS_KEY = 'swarf.lightstream';
  const PT_KEY = 'swarf.paths';
  const CH_KEY = 'swarf.chips';
  try {
    const lsSaved = localStorage.getItem(LS_KEY);
    window.__swarfLightstream = lsSaved === null ? true  : lsSaved === '1';
    const ptSaved = localStorage.getItem(PT_KEY);
    window.__swarfPaths       = ptSaved === null ? false : ptSaved === '1';
  } catch (e) { window.__swarfLightstream = true; window.__swarfPaths = false; }

  // ─── button factory ─────────────────────────────────────────────────────
  const CFG = {
    chips: {
      flag: '__swarfChipsVisible', key: CH_KEY, event: 'swarf.chips.toggle',
      offLabel: 'chips', onLabel: 'chips',
      offTitle: 'flying chips: off',
      onTitle:  'flying chips: on',
    },
    paths: {
      flag: '__swarfPaths', key: PT_KEY, event: 'swarf.paths.toggle',
      offLabel: 'paths off', onLabel: 'paths on',
      offTitle: 'Kiri default toolpath wire is hidden — click to show',
      onTitle:  'Kiri default toolpath wire is visible — click to hide',
    },
    lightstream: {
      flag: '__swarfLightstream', key: LS_KEY, event: 'swarf.lightstream.toggle',
      offLabel: 'lightstreams', onLabel: 'lightstreams',
      offTitle: 'the bit\'s trail: off',
      onTitle:  'the bit\'s trail: on',
    },
  };

  // every rendered mirror so we can keep them in lockstep when one flips.
  const mirrors = { chips: [], paths: [], lightstream: [] };

  function paint(b, kind) {
    const cfg = CFG[kind];
    const on  = !!window[cfg.flag];
    b.textContent = on ? cfg.onLabel : cfg.offLabel;
    // (whole-app review r086 B5) one pill style for every toggle on the bar, chips, lightstreams
    // and machine alike: each skin draws .swarf-toggle-on / -off (the swarf skin: on = mill-red)
    b.title              = on ? cfg.onTitle : cfg.offTitle;
    b.classList.toggle('swarf-toggle-on',  on);
    b.classList.toggle('swarf-toggle-off', !on);
    // (r093 UX V2) the state is the pill's fill, as machine's; the word stays the same
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function makeToggle(kind) {
    const cfg = CFG[kind];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swarf-sim-extra swarf-toggle swarf-toggle-' + kind;
    b.onclick = () => {
      window[cfg.flag] = !window[cfg.flag];
      try { localStorage.setItem(cfg.key, window[cfg.flag] ? '1' : '0'); } catch (e) {}
      try { window.dispatchEvent(new CustomEvent(cfg.event, { detail: window[cfg.flag] })); } catch (e) {}
    };
    mirrors[kind].push(b);
    paint(b, kind);
    return b;
  }

  // When any flag flips (via any mirror, or via swarf-viz-menu / external),
  // repaint every mirror so all bars stay visually in sync.
  function syncAll(kind) { mirrors[kind].forEach(b => paint(b, kind)); }
  window.addEventListener('swarf.chips.toggle',       () => syncAll('chips'));
  window.addEventListener('swarf.paths.toggle',       () => syncAll('paths'));
  window.addEventListener('swarf.lightstream.toggle', () => syncAll('lightstream'));

  // ─── SIMULATE sim-bar injection ─────────────────────────────────────────
  function injectSimBar() {
    const bar = document.getElementById('layer-animate');
    if (!bar || bar.dataset.swarfExtras === '1') return;
    if (!bar.querySelector('button')) return; // wait for Kiri to populate
    bar.dataset.swarfExtras = '1';
    // (whole-app review r086 B5) the bar names itself in every skin, and its two numbers say
    // what they are: "speed ×1" and "done 35 %"
    const name = document.createElement('span');
    name.className = 'swarf-sim-name';
    name.textContent = 'simulate';
    bar.prepend(name);
    const pct = [...bar.querySelectorAll('label')].find(l => l.textContent.trim() === '%');
    if (pct) {
      pct.textContent = 'done';
      pct.classList.add('swarf-sim-word');
      const v = pct.nextElementSibling;
      if (v && v.tagName === 'INPUT') {
        v.title = 'how much of the cut has run';
        const u = document.createElement('span'); u.className = 'swarf-sim-word swarf-sim-unit'; u.textContent = '%';
        v.after(u);
      }
    }

    // swarf r10-f (Phil feedback): no paths button on the bar; the paths' checkboxes are Kiri's native
    // label row, which in simulate (Phil 11-01) holds one box per step, above this bar
    // (swarf-lightstream.js addStepBox). The bar keeps chips + lightstreams.
    bar.appendChild(makeToggle('chips'));
    bar.appendChild(makeToggle('lightstream'));

    // ── editable speed field (Phil markup Apr 15 item 4) ──
    // Find the speed label: readonly <input size="3"> that follows the
    // fast-forward (toggle speed) button. Previous regex approach failed
    // because updateSpeed() hasn't set the value yet when injectSimBar
    // fires from the MutationObserver.
    const speedBtn = bar.querySelector('button[title="toggle speed"]');
    const speedLabelEl = speedBtn
      ? speedBtn.nextElementSibling
      : bar.querySelector('input[readonly][size="3"]');
    if (speedLabelEl && speedLabelEl.tagName === 'INPUT') {
      speedLabelEl.style.display = 'none';
      const field = document.createElement('input');
      field.type = 'number';
      field.min = '0.5'; field.max = '100'; field.step = '0.5';
      field.value = String(window.__swarfCustomSpeed || 1);
      field.className = 'swarf-sim-extra swarf-sim-speedfield';
      field.style.cssText = 'width:52px; height:26px; padding:0 6px; text-align:right; margin:0 2px;';
      field.title = 'how fast simulate runs: 1 is the machine\'s own speed, up to 100 times';
      const commit = () => {
        let v = parseFloat(field.value);
        if (!Number.isFinite(v) || v <= 0) v = 1;
        if (v < 0.5) v = 0.5;
        if (v > 100) v = 100;
        field.value = String(v);
        window.__swarfCustomSpeed = v;
        try { window.dispatchEvent(new CustomEvent('swarf.speed.custom', { detail: v })); } catch (e) {}
      };
      field.addEventListener('change', commit);
      field.addEventListener('keydown', (e) => { if (e.key === 'Enter') field.blur(); });
      field.addEventListener('click', (e) => e.stopPropagation());
      speedLabelEl.parentNode.insertBefore(field, speedLabelEl.nextSibling);
      const sw = document.createElement('span'); sw.className = 'swarf-sim-word'; sw.textContent = 'speed ×';
      field.before(sw);
    }
  }

  // ─── observers ──────────────────────────────────────────────────────────
  function wireObservers() {
    const bar = document.getElementById('layer-animate');
    if (bar) {
      new MutationObserver(() => {
        try { injectSimBar(); } catch (e) { console.warn('swarf sim bar inject failed', e); }
      }).observe(bar, { childList: true, subtree: true, attributes: true, attributeFilter: ['class','style'] });
    }
  }
  // (review r086 F3) Space in simulate plays and pauses; it never scrolls the page
  function onSpace(e) {
    if (e.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey) return;
    const bar = document.getElementById('layer-animate');
    if (!bar || !bar.offsetParent || document.body.classList.contains('swarf-run-open') || document.body.classList.contains('swarf-draw-open')) return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName) || t.isContentEditable)) return;
    e.preventDefault();
    if (e.repeat) return;
    const vis = title => [...bar.querySelectorAll(`button[title="${title}"]`)].find(b => b.offsetParent);
    const b = vis('pause') && window.__swarfSimPlaying ? vis('pause') : vis('play');
    if (b) { b.click(); window.__swarfSimPlaying = b.title === 'play'; }
  }
  // Esc leaves simulate for the toolpaths, as Esc leaves DRAW, TEX and the tab card (deep review S8)
  function onEsc(e) {
    if (e.key !== 'Escape') return;
    const bar = document.getElementById('layer-animate');
    if (!bar || !bar.offsetParent || document.body.classList.contains('swarf-run-open') || document.body.classList.contains('swarf-draw-open')) return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    const modal = document.getElementById('modal');
    if (modal && modal.style.display === 'flex') return;
    const paths = document.getElementById('act-paths');
    if (paths) paths.click();
  }
  function boot() {
    document.addEventListener('keydown', onSpace);
    document.addEventListener('keydown', onEsc);
    wireObservers();
    // poll a few times in case layer-animate materializes after load
    let tries = 0;
    const poll = setInterval(() => {
      try { injectSimBar(); } catch (e) {}
      if (++tries > 40) clearInterval(poll);
    }, 500);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
