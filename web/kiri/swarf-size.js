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
    // the picked parts as the objects list names them: a word or a drawing kept together is one
    // thing, "shapes (2 pieces)" (review 105 P3)
    const picked = a.selection.widgets ? a.selection.widgets() : [];
    const groups = [...new Set(picked.map(w => w.group || w))];
    const many = g => Array.isArray(g) && g.length > 1;
    count.textContent = groups.length === 1 && many(groups[0]) ? `${a.platform.part_name(groups[0][0], true)} ·`
      : groups.length > 1 ? `${groups.length} parts ·` : '';
    count.title = n > 1 ? 'shift-click a part to add it or leave it out' : '';
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
      a.event.on('widget.duplicate', nw => { if (!window.__swarfCopying) said(`Made a copy, ${nm(nw)}, beside it.`); });
      // (not DRAW's done, which swaps parts and says so itself)
      a.event.on('widget.delete', w => !(Array.isArray(w) && !w.length) && !document.body.classList.contains('swarf-draw-open') && !window.__swarfRestoring && !(a.doit.telling && a.doit.telling()) && setTimeout(() => { if (window.__swarfRestoring) return; const n = a.widgets.all().length; said(`Deleted ${nm(Array.isArray(w) ? w[0] : w)}.${n ? ` ${n} part${n === 1 ? '' : 's'} left.` : ''} ⌘Z brings it back.`); }, 0));
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

  // ---- copies: rows and columns of the picked parts ----
  const GAP = 12;                 // the arrival rule's gap (swarf-place.js)
  const MAX_COPIES = 200;
  const footprint = w => {
    const g = w.mesh && w.mesh.geometry;
    if (!g) return null;
    g.computeBoundingBox();
    const b = g.boundingBox, p = w.track.pos;
    return [b.min.x + p.x, b.min.y + p.y, b.max.x + p.x, b.max.y + p.y];
  };
  const union = list => list.reduce((u, b) => b ? (u ? [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])] : b) : u, null);
  const hits = (a, b) => a[0] < b[2] - 0.01 && b[0] < a[2] - 0.01 && a[1] < b[3] - 0.01 && b[1] < a[3] - 0.01;
  const say = mm => (L() ? L().say(mm) : `${+mm.toFixed(1)} mm`);

  // where the rows and columns go. The picked part is one of the cells: they grow right and back from
  // it, and start further left or forward when that is what keeps them on the bed and off other parts.
  // { offsets, ... } or { why } in the student's words
  function plan(across, back, gap, picked) {
    const a = api(), d = a.conf.get().device || {}, W = (d.bedWidth || Infinity) / 2, D = (d.bedDepth || Infinity) / 2;
    if (!(Number.isInteger(across) && across >= 1) || !(Number.isInteger(back) && back >= 1)) return { why: 'Across and back are whole numbers, 1 or more.' };
    if (!(gap >= 0)) return { why: 'The gap is a length, 0 or more.' };
    const box = union(picked.map(footprint));
    if (!box) return { why: 'Pick a part first.' };
    const cw = box[2] - box[0], cd = box[3] - box[1];
    const fresh = (across * back - 1) * picked.length;
    if (fresh > MAX_COPIES) return { why: `That is ${fresh} new parts: swarf makes ${MAX_COPIES} at a time.` };
    const spanX = across * cw + (across - 1) * gap, spanY = back * cd + (back - 1) * gap;
    const fitOf = (c, bed) => Math.max(1, Math.floor((bed + gap) / (c + gap) + 1e-6));
    if (spanX > W * 2 + 0.01) return { why: `It runs off the bed: ${across} across needs ${say(spanX)}, and the bed is ${say(W * 2)} wide. ${fitOf(cw, W * 2)} across fit.`, box };
    if (spanY > D * 2 + 0.01) return { why: `It runs off the bed: ${back} back needs ${say(spanY)}, and the bed is ${say(D * 2)} deep. ${fitOf(cd, D * 2)} back fit.`, box };
    const others = a.widgets.all().filter(w => !picked.includes(w)).map(w => ({ w, b: footprint(w) })).filter(o => o.b);
    const stepX = cw + gap, stepY = cd + gap;
    let blocked = null;
    for (let j0 = 0; j0 < back; j0++) for (let i0 = 0; i0 < across; i0++) {
      const x0 = box[0] - i0 * stepX, y0 = box[1] - j0 * stepY;
      if (x0 < -W - 0.01 || x0 + spanX > W + 0.01 || y0 < -D - 0.01 || y0 + spanY > D + 0.01) continue;
      const offsets = [];
      let on = null;
      for (let j = 0; j < back && !on; j++) for (let i = 0; i < across && !on; i++) {
        if (i === i0 && j === j0) continue;
        const x = (i - i0) * stepX, y = (j - j0) * stepY;
        const cell = [box[0] + x, box[1] + y, box[2] + x, box[3] + y];
        const o = others.find(o => hits(cell, o.b));
        if (o) on = o.w; else offsets.push({ x, y });
      }
      if (!on) return { offsets, box, cw, cd, others, W, D };
      blocked = blocked || on;
    }
    if (blocked) return { why: `It lands on ${(blocked.meta && blocked.meta.file) || 'another part'}: move that part, or ask for fewer.`, box };
    return { why: 'It runs off the bed from where the part sits: move the part, or ask for fewer.', box };
  }

  function copies() {
    const a = api();
    if (!a || !a.platform) return;
    if (!a.view.is_arrange()) a.view.set_arrange();
    let picked = a.selection.widgets();
    const all = a.widgets.all();
    // nothing picked and one thing on the bed: that one
    if (!picked.length && all.length && all.every(w => w.group === all[0].group)) { a.platform.select(all[0], false); picked = a.selection.widgets(); }
    if (!picked.length) { a.show.alert(all.length ? 'Pick a part first, then copies.' : 'Nothing to copy yet: make a part first.', 5); return; }
    const inch = L() && L().unit() === 'in';
    const pre = [
      "<div class='f-col a-center swarf-shape swarf-copies'>",
      '  <h3>Copies</h3>',
      "  <div class='f-row t-right'><table>",
      "  <tr><th>across</th><td><input id='copies-across' value='2' size='6' inputmode='numeric' title='how many in each row, side to side, counting the part you have'></td></tr>",
      "  <tr><th>back</th><td><input id='copies-back' value='1' size='6' inputmode='numeric' title='how many rows, front to back, counting the row the part is in'></td></tr>",
      `  <tr><th>gap</th><td><input id='copies-gap' value='${L() ? L().show(GAP) : GAP}' size='6' inputmode='text' title='the clear space between parts: leave room for the bit, plus a little'> ${inch ? 'in' : 'mm'}</td></tr>`,
      '  </table></div>',
      "  <div id='copies-prev' class='swarf-shape-prev' title='the bed from above: the new parts, and any that are already there'></div>",
      "  <p id='copies-says' class='swarf-copies-says'></p>",
      "  <p id='copies-why' class='swarf-shape-why'></p>",
      '</div>'
    ];
    const $v = id => (document.getElementById(id) || {}).value;
    const read = () => {
      const g = L() ? L().parse($v('copies-gap')) : parseFloat($v('copies-gap'));
      return { across: Number(String($v('copies-across')).trim()), back: Number(String($v('copies-back')).trim()), gap: g };
    };
    const button = word => [...document.querySelectorAll('#dialog button')].find(b => b.textContent.trim().toLowerCase() === word);
    const refresh = () => {
      const v = read(), p = plan(v.across, v.back, v.gap, picked);
      const none = !p.why && !p.offsets.length;
      document.getElementById('copies-why').textContent = p.why || (none ? 'One across and one back is the part you have: ask for more.' : '');
      document.getElementById('copies-says').textContent = p.why || none ? '' : `${v.across * v.back} in all, ${p.offsets.length * picked.length} new.`;
      const b = button('make');
      if (b) { b.disabled = !!p.why || none; b.title = p.why || (none ? 'Ask for more than one' : 'Make them: one undo takes them all back'); }
      const cancel = button('cancel');
      if (cancel) cancel.title = 'Close this card and make nothing';
      // the bed from above, with the cells on it
      const box = document.getElementById('copies-prev');
      if (!p.offsets || !isFinite(p.W)) { box.innerHTML = ''; return; }
      const rect = (x, y, w, h, c) => `<rect x="${(x + p.W).toFixed(1)}" y="${(p.D - y - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" class="${c}"/>`;
      const cells = [];
      for (const o of p.others) cells.push(rect(o.b[0], o.b[1], o.b[2] - o.b[0], o.b[3] - o.b[1], 'other'));
      cells.push(rect(p.box[0], p.box[1], p.cw, p.cd, 'mine'));
      for (const o of p.offsets) cells.push(rect(p.box[0] + o.x, p.box[1] + o.y, p.cw, p.cd, 'new'));
      box.innerHTML = `<svg viewBox="0 0 ${(p.W * 2).toFixed(1)} ${(p.D * 2).toFixed(1)}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"><rect width="${(p.W * 2).toFixed(1)}" height="${(p.D * 2).toFixed(1)}" class="bed"/>${cells.join('')}</svg>`;
    };
    a.uc.confirm(undefined, { make: true, cancel: false }, undefined, { pre }).then(go => {
      if (!go) return;
      const v = read(), p = plan(v.across, v.back, v.gap, picked);
      if (p.why || !p.offsets.length) { if (p.why) a.show.alert(p.why, 7); return; }
      const name = picked[0].meta && picked[0].meta.file || 'the part';
      const n = p.offsets.length * picked.length;
      const made = a.selection.copies(p.offsets, { undo: `Took back the ${n === 1 ? 'copy' : `${n} copies`}.`, redo: `The ${n === 1 ? 'copy is' : `${n} copies are`} back.` });
      if (!made.length) return;
      a.event.alerts(true);
      a.show.alert(`Made ${n === 1 ? 'a copy' : `${n} copies`} of ${name}: ${v.across} across, ${v.back} back, ${say(v.gap)} apart. ⌘Z takes ${n === 1 ? 'it' : 'them all'} back.`, 8);
      if (a.reveal) a.reveal(a.widgets.all());
    });
    setTimeout(() => {
      for (const id of ['copies-across', 'copies-back', 'copies-gap']) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.addEventListener('input', refresh);
        el.addEventListener('keydown', e => e.stopPropagation());
      }
      if (document.getElementById('copies-why')) refresh();
    }, 0);
  }

  window.__swarfSize = { show, copies, plan };
})();
