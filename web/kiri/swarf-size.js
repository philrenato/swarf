/*
 * swarf size — the selected part's real size in mm, where you are looking
 * (Phil 10-27: "clearer scaling controls"). A small card at the bottom of the
 * workspace: width × depth × height, each typeable, and "keep proportions".
 *
 * It drives cam's own scale panel (#size_x/y/z and the lock boxes, kept
 * current by cam for every selection), so the scaling itself is cam's.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const api = () => window.kiri && window.kiri.api;
  const AX = [['x', 'width'], ['y', 'depth'], ['z', 'height']];
  const KEEP = 'swarf-size-keep';
  let card, fields = {}, keep;

  function build() {
    card = document.createElement('div');
    card.id = 'swarf-size';
    card.innerHTML = '<span class="lbl">size</span>';
    for (const [a, word] of AX) {
      const inp = document.createElement('input');
      inp.inputMode = 'decimal'; inp.title = `${word} in mm: type a size, then Enter`;
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { apply(a); inp.blur(); } if (e.key === 'Escape') { show(); inp.blur(); } e.stopPropagation(); });
      inp.addEventListener('blur', () => apply(a));
      fields[a] = inp;
      const w = document.createElement('label'); w.className = 'ax';
      w.append(inp, Object.assign(document.createElement('small'), { textContent: word }));
      card.append(w);
      if (a !== 'z') card.append(Object.assign(document.createElement('span'), { className: 'x', textContent: '×' }));
    }
    card.append(Object.assign(document.createElement('span'), { className: 'mm', textContent: 'mm' }));
    keep = document.createElement('label'); keep.className = 'keep';
    const box = document.createElement('input'); box.type = 'checkbox';
    try { box.checked = localStorage.getItem(KEEP) !== '0'; } catch (e) { box.checked = true; }
    box.addEventListener('change', () => { try { localStorage.setItem(KEEP, box.checked ? '1' : '0'); } catch (e) { /* private */ } });
    keep.title = 'width and depth change together; the height (thickness) stays as it is';
    keep.append(box, document.createTextNode('keep proportions'));
    keep.box = box;
    card.append(keep);
    document.body.append(card);
  }

  // type a size: cam's own field, locks as "keep proportions" says, then cam applies it on blur
  function apply(a) {
    const src = $(`size_${a}`), v = parseFloat(fields[a].value);
    if (!src || !(v > 0)) { show(); return; }
    if (Math.abs(v - parseFloat(src.was ?? src.value)) < 1e-6) return;
    // width and depth move together when kept; height (the board's thickness) stays its own
    const together = keep.box.checked && a !== 'z';
    for (const [b] of AX) { const l = $(`lock_${b}`); if (l) l.checked = together && b !== 'z'; }
    src.value = String(v);
    src.dispatchEvent(new Event('blur'));
    setTimeout(show, 0);
  }

  function show() {
    const a = api();
    if (!card || !a || !a.platform) return;
    const n = a.platform.selected_count ? a.platform.selected_count() : 0;
    const inControl = document.body.classList.contains('swarf-run-open');
    card.classList.toggle('on', n > 0 && !inControl);
    if (!n) return;
    for (const [b] of AX) {
      const src = $(`size_${b}`);
      if (src && document.activeElement !== fields[b]) fields[b].value = (+parseFloat(src.value || 0).toFixed(2)).toString();
    }
  }

  let tries = 0;
  const t = setInterval(() => {
    const a = api();
    if ((a && a.event && $('size_x')) || ++tries > 200) {
      clearInterval(t);
      if (!a || !a.event) return;
      build();
      for (const ev of ['widget.select', 'widget.deselect', 'selection.scale', 'selection.move', 'selection.rotate', 'platform.layout', 'widget.add', 'widget.delete']) a.event.on(ev, () => setTimeout(show, 0));
      new MutationObserver(show).observe(document.body, { attributes: true, attributeFilter: ['class'] });
      show();
    }
  }, 150);

  window.__swarfSize = { show };
})();
