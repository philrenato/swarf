/**
 * swarf simulate-bar extensions — injects extras into Kiri's #layer-animate
 * when simulation starts:
 *   - "chips" toggle button (tied to window.__swarfChipsVisible which the
 *     chips layer reads before rendering/spawning)
 *   - "Nx" click-to-edit on the speed label so Phil can type a custom
 *     speed multiplier (overrides the built-in cycle list)
 */
(function () {
  'use strict';
  if (window.__swarfSimBarLoaded) return;
  window.__swarfSimBarLoaded = true;

  // Default: chips on. Overridden by ?nochips=1 (handled inside swarf-chips.js)
  window.__swarfChipsVisible = window.__swarfChipsVisible !== false;
  window.__swarfCustomSpeed  = null; // null = use built-in cycle

  // Chips toggle hook: swarf-chips.js listens for this event to flip its pools
  function toggleChips() {
    window.__swarfChipsVisible = !window.__swarfChipsVisible;
    try { window.dispatchEvent(new CustomEvent('swarf.chips.toggle', { detail: window.__swarfChipsVisible })); } catch (e) {}
    renderChipsBtn();
  }

  let chipsBtn = null;
  function renderChipsBtn() {
    if (!chipsBtn) return;
    const on = window.__swarfChipsVisible;
    chipsBtn.textContent = on ? 'chips on' : 'chips off';
    chipsBtn.style.background = on
      ? 'var(--swarf-accent, #7a2a1a)'
      : 'rgba(0,0,0,0.5)';
    chipsBtn.style.color = '#fff';
    chipsBtn.title = on ? 'chips are spawning — click to hide/stop' : 'chips are hidden — click to show';
  }

  function injectExtras() {
    const bar = document.getElementById('layer-animate');
    if (!bar || bar.dataset.swarfExtras === '1') return;
    // only inject when the bar is actually populated with kiri's buttons
    if (!bar.querySelector('button')) return;
    bar.dataset.swarfExtras = '1';

    // chips toggle button — appended at the end so kiri's layout isn't broken
    chipsBtn = document.createElement('button');
    chipsBtn.type = 'button';
    chipsBtn.className = 'swarf-sim-extra swarf-sim-chips';
    chipsBtn.onclick = toggleChips;
    bar.appendChild(chipsBtn);
    renderChipsBtn();

    // custom-speed: Kiri's speed VALUE is an <input> (newValue() creates one)
    // showing "1×", "2×", etc. Find any input or label in the bar whose value
    // matches the speed pattern; on click, prompt for a custom multiplier
    // and store it in window.__swarfCustomSpeed (anim-2d/3d updateSpeed
    // honors that override).
    const speedEls = [...bar.querySelectorAll('input, label')].filter(el => {
      const v = el.value !== undefined ? el.value : el.textContent;
      return /[½\d]\s*[x×]/i.test(String(v || '').trim());
    });
    const speedEl = speedEls[0];
    if (speedEl) {
      speedEl.style.cursor = 'text';
      speedEl.title = 'click to set a custom simulate speed (e.g. 3.5)';
      const handler = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        const curStr = String(speedEl.value !== undefined ? speedEl.value : speedEl.textContent);
        const cur = window.__swarfCustomSpeed ||
                    parseFloat(curStr.replace('½', '0.5').replace(/[x×]/gi, '')) || 1;
        const raw = prompt('custom simulate speed multiplier (e.g. 3.5)', String(cur));
        if (raw === null) return;
        if (raw.trim() === '') {
          window.__swarfCustomSpeed = null;
          return;
        }
        const v = parseFloat(raw);
        if (Number.isFinite(v) && v > 0 && v < 1000) {
          window.__swarfCustomSpeed = v;
          if (speedEl.value !== undefined) speedEl.value = `${v}×`;
          else speedEl.textContent = `${v}×`;
          try { window.dispatchEvent(new CustomEvent('swarf.speed.custom', { detail: v })); } catch (e) {}
        }
      };
      speedEl.addEventListener('click', handler);
      speedEl.addEventListener('focus', handler);
    }
  }

  // Watch for the bar to become populated (kiri injects buttons lazily on first simulate).
  const mo = new MutationObserver(() => {
    try { injectExtras(); } catch (e) { console.warn('swarf sim bar inject failed', e); }
  });
  const bar = document.getElementById('layer-animate');
  if (bar) mo.observe(bar, { childList: true, subtree: true });
  // also try a couple of times in case bar materializes after load
  let tries = 0;
  const poll = setInterval(() => {
    injectExtras();
    if (++tries > 40) clearInterval(poll);
  }, 500);
})();
