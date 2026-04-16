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
      offLabel: 'chips off', onLabel: 'chips on',
      offTitle: 'chips are hidden — click to show',
      onTitle:  'chips are spawning — click to hide',
    },
    paths: {
      flag: '__swarfPaths', key: PT_KEY, event: 'swarf.paths.toggle',
      offLabel: 'paths off', onLabel: 'paths on',
      offTitle: 'Kiri default toolpath wire is hidden — click to show',
      onTitle:  'Kiri default toolpath wire is visible — click to hide',
    },
    lightstream: {
      flag: '__swarfLightstream', key: LS_KEY, event: 'swarf.lightstream.toggle',
      offLabel: 'lightstreams off', onLabel: 'lightstreams on',
      offTitle: 'Tron-red ribbon paths hidden — click to show',
      onTitle:  'Tron-red ribbon paths visible — click to hide',
    },
  };

  // every rendered mirror so we can keep them in lockstep when one flips.
  const mirrors = { chips: [], paths: [], lightstream: [] };

  function paint(b, kind) {
    const cfg = CFG[kind];
    const on  = !!window[cfg.flag];
    b.textContent = on ? cfg.onLabel : cfg.offLabel;
    // ON = mill-red. OFF = solid black with a faint red hairline so the
    // button is fully visible in its "off" state (Phil markup r10-c).
    b.style.background   = on ? 'var(--swarf-accent-hi, #d02020)' : '#000';
    b.style.borderColor  = on ? 'var(--swarf-accent-hi, #d02020)' : 'var(--swarf-accent, #7a2a1a)';
    b.style.color        = '#fff';
    b.title              = on ? cfg.onTitle : cfg.offTitle;
    b.classList.toggle('swarf-toggle-on',  on);
    b.classList.toggle('swarf-toggle-off', !on);
  }

  function makeToggle(kind) {
    const cfg = CFG[kind];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swarf-sim-extra swarf-toggle swarf-toggle-' + kind;
    // solid black/red toggle style (overrides #layer-animate button rules)
    b.style.border = '1px solid var(--swarf-accent, #7a2a1a)';
    b.style.fontFamily = '"JetBrains Mono","IBM Plex Mono",ui-monospace,monospace';
    b.style.fontSize = '11px';
    b.style.letterSpacing = '0.1em';
    b.style.textTransform = 'lowercase';
    b.style.padding = '6px 10px';
    b.style.margin = '0 2px';
    b.style.cursor = 'pointer';
    b.style.borderRadius = '3px';
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

    // swarf r10-f (Phil feedback): paths button lives only in TOOLPATHS
    // view via Kiri's native label checkboxes — not here. Sim-bar keeps
    // chips + lightstreams only.
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
      field.style.cssText = 'width:58px; height:26px; padding:0 6px; background:rgba(0,0,0,0.55); color:#fff; border:1px solid var(--swarf-accent,#7a2a1a); border-radius:3px; font-family:"JetBrains Mono","IBM Plex Mono",ui-monospace,monospace; font-size:12px; text-align:right; margin:0 2px;';
      field.title = 'simulate speed multiplier — 0.5 to 100';
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
  function boot() {
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
