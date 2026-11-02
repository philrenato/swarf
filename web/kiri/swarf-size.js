/*
 * swarf size — the selected part's real size, where you are looking (in cam's units: mm, or
 * inches with fractions typed as 3/4 or 1 1/2, swarf-length.js)
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
  const AX = [['x', 'width'], ['y', 'length'], ['z', 'thickness']];
  const KEEP = 'swarf-size-keep';
  const L = () => window.SwarfLength;
  // cam's size fields are in its own units
  const scale = () => (L() && L().unit() === 'in' ? 25.4 : 1);
  let unitEl;
  let card, fields = {}, keep, edit, count, edge;

  function build() {
    card = document.createElement('div');
    card.id = 'swarf-size';
    card.innerHTML = '<span class="lbl">size</span>';
    for (const [a, word] of AX) {
      const inp = document.createElement('input');
      inp.inputMode = 'text'; inp.dataset.word = word;
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { inp.dataset.typed = '1'; apply(a); inp.blur(); } if (e.key === 'Escape') { delete inp.dataset.typed; show(); inp.blur(); } e.stopPropagation(); });
      inp.addEventListener('blur', () => apply(a));
      // only a box typed in is applied on blur; the rest show cam's numbers, focused or not
      // (review 10-28: Tab into depth kept its old 100, and leaving it squashed the part back)
      inp.addEventListener('input', () => { inp.dataset.typed = '1'; });
      fields[a] = inp;
      const w = document.createElement('label'); w.className = 'ax';
      w.append(inp, Object.assign(document.createElement('small'), { textContent: word }));
      card.append(w);
      if (a !== 'z') card.append(Object.assign(document.createElement('span'), { className: 'x', textContent: '×' }));
    }
    card.append(unitEl = Object.assign(document.createElement('span'), { className: 'mm', textContent: 'mm' }));
    // a shaped top edge, said where the size is (review 10-28 #8)
    edge = Object.assign(document.createElement('span'), { className: 'edge', title: 'the top edge: change it in draw' });
    card.append(edge);
    keep = document.createElement('label'); keep.className = 'keep';
    const box = document.createElement('input'); box.type = 'checkbox';
    try { box.checked = localStorage.getItem(KEEP) !== '0'; } catch (e) { box.checked = true; }
    box.addEventListener('change', () => { try { localStorage.setItem(KEEP, box.checked ? '1' : '0'); } catch (e) { /* private */ } });
    keep.title = 'width and length change together; the thickness stays as it is';
    keep.append(box, document.createTextNode('keep proportions'));
    keep.box = box;
    card.append(keep);
    // what you can do with the picked parts, where you can see it (Phil 10-27:
    // "after I make something, how do I select, delete etc?")
    const act = (word, title, fn) => { const b = document.createElement('button'); b.className = 'act'; b.textContent = word; b.title = title; b.onclick = fn; card.append(b); return b; };
    card.append(Object.assign(document.createElement('span'), { className: 'sep' }));
    edit = act('edit in draw', 'move its points, reshape it, change its thickness or edge', () => window.__swarfDraw && window.__swarfDraw.open());
    act('duplicate', 'a copy beside it', () => { const a = api(); a.selection.duplicate(); });
    act('delete', 'remove the picked parts (or press Delete)', () => { const a = api(); a.selection.delete(); setTimeout(show, 0); });
    count = Object.assign(document.createElement('span'), { className: 'n' });
    card.prepend(count);
    document.body.append(card);
  }

  // type a size: cam's own field, locks as "keep proportions" says, then cam applies it on blur
  function apply(a) {
    if (!fields[a].dataset.typed) return;
    delete fields[a].dataset.typed;
    // a length as typed (3/4, 1 1/2", 19 mm), in cam's units
    const src = $(`size_${a}`), v = (L() ? L().parse(fields[a].value) : parseFloat(fields[a].value)) / scale();
    if (!src || !(v > 0)) {
      const typed = fields[a].value.trim();
      if (src && typed) api().show.alert(`swarf could not read "${typed}" as a ${fields[a].dataset.word} above 0: it stays as it was.`, 5);
      show(); return;
    }
    if (Math.abs(v - parseFloat(src.was ?? src.value)) < 1e-6) return;
    // width and length move together when kept; height (the board's thickness) stays its own
    const together = keep.box.checked && a !== 'z';
    // the bed and the machine's reach first, as the shape dialog does (deep review 10-31 M1: 99999
    // went to cam's scale and froze the page)
    const was = parseFloat(src.was ?? src.value), k = was > 0 ? v / was : 1, mm = x => x * scale();
    const now = b => parseFloat(($(`size_${b}`) || {}).value) || 0;
    const w = mm(a === 'x' ? v : together ? now('x') * k : now('x')), d = mm(a === 'y' ? v : together ? now('y') * k : now('y')), t = mm(a === 'z' ? v : now('z'));
    const dev = (api().conf.get().device) || {}, bw = dev.bedWidth || Infinity, bd = dev.bedDepth || Infinity;
    const say = n => (L() ? L().say(n) : `${+n.toFixed(1)} mm`);
    const no = (w > bw || d > bd) && (w > bd || d > bw) ? `That is bigger than the bed (${say(bw)} × ${say(bd)}): the size stays as it was.`
      : t > 150 ? `That is thicker than the machine can cut (${say(150)}): the size stays as it was.` : null;
    if (no) { api().show.alert(no, 6); show(); return; }
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
    card.classList.toggle('on', n > 0 && !inControl && !document.body.classList.contains('swarf-draw-open'));
    if (!n) return;
    // several picked: the size is the first one's; the buttons act on all of them
    count.textContent = n > 1 ? `${n} parts ·` : '';
    count.title = n > 1 ? 'shift-click a part to add it or leave it out' : '';
    const picked = a.selection.widgets ? a.selection.widgets() : [];
    edit.style.display = picked.some(w => w.meta && w.meta.svg) ? '' : 'none';
    const e = picked[0] && picked[0].meta && picked[0].meta.edge;
    // scaled in width and depth, the edge stretched with it (its height did not): say so (review 10-28b #32)
    const xf = picked[0] && picked[0].meta && picked[0].meta.xf;
    const stretched = xf && (Math.abs(Math.hypot(xf[0], xf[1]) - 1) > 1e-3 || Math.abs(Math.hypot(xf[2], xf[3]) - 1) > 1e-3);
    edge.textContent = e && e.kind && e.kind !== 'straight' && e.size > 0 ? `${e.kind} ${L() ? L().say(e.size) : +(+e.size).toFixed(2) + ' mm'} edge${stretched ? ', stretched with the part' : ''}` : '';
    edge.style.display = edge.textContent ? '' : 'none';
    for (const [b] of AX) {
      const src = $(`size_${b}`);
      if (src && !fields[b].dataset.typed) fields[b].value = L() && L().unit() === 'in' ? L().show(parseFloat(src.value || 0) * 25.4) : (+parseFloat(src.value || 0).toFixed(2)).toString();
    }
    const u = L() ? L().unit() : 'mm';
    unitEl.textContent = u;
    for (const [b] of AX) fields[b].title = `${fields[b].dataset.word} in ${u === 'in' ? 'inches (3/4, 1 1/2 and 19 mm work too)' : 'mm (3/4 in works too)'}: type a size, then Enter`;
  }

  let tries = 0;
  const t = setInterval(() => {
    const a = api();
    if ((a && a.event && $('size_x')) || ++tries > 200) {
      clearInterval(t);
      if (!a || !a.event) return;
      build();
      // the sentence stays true: each act on the bed rewrites it, and toolpaths clears it (review 10-28b #3)
      const said = t => { try { a.event.alerts(true); if (t) a.show.alert(t, 6); } catch (e) { /* no alerts */ } };
      const nm = w => (w && w.meta && w.meta.file) || 'the part';
      let resizing = 0;
      a.event.on('selection.scale', () => { clearTimeout(resizing); resizing = setTimeout(() => { const v = AX.map(([b]) => parseFloat(($(`size_${b}`) || {}).value || 0) * scale()); said(`Resized to ${L() && L().unit() === 'in' ? v.map(x => L().say(x).replace(/ in$/, '')).join(' × ') + ' in' : v.map(x => +x.toFixed(2)).join(' × ') + ' mm'}.`); }, 120); });
      a.event.on('widget.duplicate', nw => said(`Made a copy, ${nm(nw)}, beside it.`));
      // (not DRAW's done, which swaps parts and says so itself)
      a.event.on('widget.delete', w => !(Array.isArray(w) && !w.length) && !document.body.classList.contains('swarf-draw-open') && !window.__swarfRestoring && setTimeout(() => { if (window.__swarfRestoring) return; const n = a.widgets.all().length; said(`Deleted ${nm(Array.isArray(w) ? w[0] : w)}.${n ? ` ${n} part${n === 1 ? '' : 's'} left.` : ''} ⌘Z brings it back.`); }, 0));
      a.event.on('preview.begin', () => said(''));
      for (const ev of ['widget.select', 'widget.deselect', 'selection.scale', 'selection.move', 'selection.rotate', 'platform.layout', 'widget.add', 'widget.delete']) a.event.on(ev, () => setTimeout(show, 0));
      new MutationObserver(show).observe(document.body, { attributes: true, attributeFilter: ['class'] });
      // mm | in: the fields in the new units at once (review r093-ux B2: they kept the old numbers
      // under the new suffix until the part was picked again)
      if (a.ui && a.ui.units) a.ui.units.addEventListener('change', () => setTimeout(show, 50));
      // (Phil 11-01) and cam's own size fields with them, which the card reads: a part picked in mm
      // kept 150 in its field after the switch, and typing 200 mm then read the board as 19 in thick
      a.event.on('units.set', () => { try { a.selection.update_info(); } catch (e) { /* nothing picked */ } setTimeout(show, 0); });
      show();
    }
  }, 150);

  window.__swarfSize = { show };
})();
