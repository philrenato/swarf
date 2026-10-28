/*
 * swarf skin — three looks for the whole app (Phil 10-28: "two alternate skin packs
 * for the entire app that take it from its present futuristic look to: wet
 * plastic/liquid glass and classic OS").
 *
 *   swarf    the red-sky mill look (no data-skin attribute: the base stylesheets alone)
 *   glass    wet plastic and liquid glass: frosted panes, jelly buttons, a pale sky
 *   classic  BeOS, Windows 95 and Mac OS 9 mixed: bevels, a yellow tab, pinstripes
 *
 * Loaded in <head>, before anything paints, so a page never opens in the wrong skin.
 * The colour layer is generated (tools/make_skins.mjs → swarf-skin-map.css) and each
 * skin's own file (swarf-skin-glass.css, swarf-skin-classic.css) gives its colours
 * and its chrome. The 3D scenes read their colours from CSS custom properties
 * (--sk3d-*) through SwarfSkin.color() and redraw on the 'swarf.skin' event.
 * The choice lives in VIEW › skin and in localStorage.
 */
(function () {
  'use strict';
  const KEY = 'swarf-skin';
  const SKINS = [
    { id: 'swarf', name: 'swarf', title: 'the red-sky mill: hot red on warm black', bar: '#d02020' },
    { id: 'glass', name: 'liquid glass', title: 'wet plastic and liquid glass: frosted panes, jelly buttons, a pale sky', bar: '#ededee' },
    { id: 'classic', name: 'classic', title: 'a classic desktop: BeOS tabs, Windows 95 bevels, Mac OS 9 pinstripes', bar: '#d6d6d6' }
  ];
  const root = document.documentElement;
  // liquid glass is the default (Phil 10-28: "Make the wet plastic aesthetic the default")
  let current = 'glass';
  try { const s = localStorage.getItem(KEY); if (SKINS.some(k => k.id === s)) current = s; } catch (e) { /* private window */ }
  // ?skin=glass in the address opens in that skin (and keeps it)
  try { const q = new URLSearchParams(location.search).get('skin'); if (SKINS.some(k => k.id === q)) current = q; } catch (e) { /* no URL */ }

  function stamp() {
    if (current === 'swarf') root.removeAttribute('data-skin');
    else root.setAttribute('data-skin', current);
    // the installed app's title bar: the manifest's red, unless the page names its own colour
    try {
      let m = document.querySelector('meta[name="theme-color"]');
      if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
      m.content = SKINS.find(k => k.id === current).bar;
    } catch (e) { /* no head yet */ }
  }
  stamp();

  // a 3D colour as a number, from a --sk3d-* property; the base look's own when unset
  function color(name, fallback) {
    try {
      const v = getComputedStyle(root).getPropertyValue('--sk3d-' + name).trim();
      if (!v) return fallback;
      const c = document.createElement('canvas').getContext('2d');
      c.fillStyle = '#000'; c.fillStyle = v;
      const s = c.fillStyle;
      if (s[0] === '#') return parseInt(s.slice(1), 16);
      const m = s.match(/\d+(\.\d+)?/g);
      return m ? (+m[0] << 16) | (+m[1] << 8) | +m[2] : fallback;
    } catch (e) { return fallback; }
  }
  // a number from a --sk3d-* property (opacity, intensity)
  function number(name, fallback) {
    try { const v = parseFloat(getComputedStyle(root).getPropertyValue('--sk3d-' + name)); return isFinite(v) ? v : fallback; } catch (e) { return fallback; }
  }

  function set(id) {
    if (!SKINS.some(k => k.id === id) || id === current) return;
    current = id;
    try { localStorage.setItem(KEY, id); } catch (e) { /* private window */ }
    stamp();
    mark();
    try { window.dispatchEvent(new CustomEvent('swarf.skin', { detail: id })); } catch (e) { /* old browser */ }
  }

  // VIEW › skin: one row per skin, the current one ticked
  function mark() {
    for (const k of SKINS) {
      const row = document.getElementById('swarf-skin-' + k.id);
      if (row) row.classList.toggle('swarf-skin-on', k.id === current);
    }
  }
  function menu() {
    const anchor = document.getElementById('app-xpnd');
    if (!anchor || document.getElementById('swarf-skin-swarf')) return !!anchor;
    const list = anchor.parentNode;
    const head = document.createElement('div');
    head.className = 'swarf-skin-head';
    head.innerHTML = '<label>skin</label>';
    list.insertBefore(document.createElement('hr'), anchor);
    list.insertBefore(head, anchor);
    for (const k of SKINS) {
      const row = document.createElement('div');
      row.id = 'swarf-skin-' + k.id;
      row.className = 'swarf-skin-row';
      row.title = k.title;
      const lbl = document.createElement('label');
      lbl.textContent = k.name;
      const ic = document.createElement('span');
      ic.innerHTML = '<i class="fas fa-check"></i>';
      row.append(lbl, ic);
      row.addEventListener('click', e => { e.stopPropagation(); set(k.id); });
      list.insertBefore(row, anchor);
    }
    list.insertBefore(document.createElement('hr'), anchor);
    mark();
    return true;
  }
  let tries = 0;
  const poll = setInterval(() => { if (menu() || ++tries > 200) clearInterval(poll); }, 150);

  window.SwarfSkin = { get: () => current, set, list: () => SKINS.map(k => ({ ...k })), color, number };
})();
