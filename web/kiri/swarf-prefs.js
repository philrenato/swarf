/*
 * swarf prefs — setup › preferences in swarf's words (Phil 10-28: "the preferences dialog
 * box needs work again"). Kiri builds five columns of its own names (anti-alias, web asm,
 * heal mesh …) in a 2 × 3 grid with one cell empty. This regroups the same rows, by their
 * kiri.api.ui keys, into what a student looks for first ("the view", "the bed") and folds
 * the rest under "advanced". The rows, their inputs and their saving stay kiri's; only
 * where they sit and what they are called change.
 */
(function () {
  'use strict';
  const GROUPS = [
    { id: 'view', title: 'the view', rows: [
      ['showOrigin', 'show the origin', 'Show where X 0, Y 0 is on the bed'],
      ['showRulers', 'show rulers', 'Rulers along the bed\'s edges'],
      ['showSpeeds', 'color toolpaths by speed', 'Toolpaths shaded by how fast the bit moves'],
      ['units', 'units', 'Millimeters or inches, for every number swarf shows'],
      ['ortho', 'flat view, no perspective', 'Parallel lines stay parallel: good for checking sizes'],
      ['reverseZoom', 'reverse scroll zoom', 'Scroll the other way to zoom in'],
      ['animesh', 'simulate detail', 'Finer shows the cut surface better and runs slower']
    ] },
    { id: 'bed', title: 'the bed', rows: [
      ['autoSave', 'save my work as I go', 'Parts and steps come back when you reopen swarf'],
      ['autoLayout', 'place new parts by themselves', 'A new part is laid out beside the others'],
      ['freeLayout', 'drag parts anywhere', 'Off: parts stay where the layout put them']
    ] },
    { id: 'adv', title: 'advanced', fold: true, rows: [
      ['edgeangle', 'edge angle', 'How sharp a fold must be, in degrees, to count as an edge'],
      ['manifold', 'exact stock in simulate', 'A true solid for indexed stock: very slow'],
      ['detail', 'slicing detail', 'Lower is faster and uses less memory; lower it if a big part runs out of memory'],
      ['healMesh', 'repair broken meshes', 'Fix models with holes before slicing; slower'],
      ['assembly', 'web assembly', 'Faster maths in the browser; turn off if you see glitches'],
      ['webGPU', 'web gpu', 'Use the graphics card for some steps; turn off if you see glitches'],
      ['antiAlias', 'smooth edges on screen', 'Smoother lines, a little slower; takes a reload'],
      ['drawer', 'slide-out settings', 'Settings slide in from the side'],
      ['scrolls', 'scrollbars', 'Show scrollbars in long panels'],
      ['exportPreview', 'show the file in export', 'The first lines of the file in the export box'],
      ['exportOcto', 'send to a remote host', 'For 3D printers on a network (OctoPrint, Moonraker)'],
      ['devel', 'developer options', 'Debugging tools for swarf\'s makers']
    ] }
  ];

  function rowOf(el) { return el && (el.closest('.var-row') || el.parentElement); }

  function arrange() {
    const box = document.getElementById('mod-prefs');
    const ui = window.kiri && window.kiri.api && window.kiri.api.ui;
    if (!box || !ui || !ui.showOrigin || box.dataset.swarf) return !!(box && box.dataset.swarf);
    box.dataset.swarf = '1';
    box.classList.add('swarf-prefs');
    const title = box.querySelector('.menu-title');
    if (title) title.textContent = 'preferences';
    const wrap = document.createElement('div');
    wrap.className = 'swarf-prefs-body';
    const used = new Set();
    for (const g of GROUPS) {
      const col = document.createElement(g.fold ? 'details' : 'section');
      col.className = 'swarf-prefs-group swarf-prefs-' + g.id;
      const head = document.createElement(g.fold ? 'summary' : 'h4');
      head.textContent = g.title;
      col.append(head);
      const list = document.createElement('div');
      list.className = 'swarf-prefs-rows';
      for (const [key, word, why] of g.rows) {
        const row = rowOf(ui[key]);
        if (!row || used.has(row)) continue;
        used.add(row);
        const lab = row.querySelector('label');
        if (lab) lab.textContent = word;
        row.title = why;
        if (ui[key].setAttribute) ui[key].setAttribute('title', why);
        list.append(row);
      }
      col.append(list);
      wrap.append(col);
    }
    // Kiri's layout spacing is not the gap swarf keeps (12 mm, r42): the row would say the wrong number (Fable review 3 #22)
    const sp = rowOf(ui.spaceLayout); if (sp) { sp.style.display = 'none'; used.add(sp); }
    // dark mode is the skin's job now (VIEW › skin): its row stays, out of sight, with the old look
    const dark = rowOf(ui.dark);
    if (dark) { dark.classList.add('swarf-prefs-dark'); wrap.querySelector('.swarf-prefs-adv .swarf-prefs-rows').append(dark); const l = dark.querySelector('label'); if (l) l.textContent = 'dark mode'; }
    // kiri's own columns, now empty of everything we moved; anything left (a mode's own row) stays reachable
    const old = box.querySelector('.f-row.gap10');
    if (old) {
      for (const c of old.querySelectorAll(':scope > .f-col')) {
        for (const r of [...c.children]) if (r.classList.contains('var-row') && !used.has(r) && r !== dark) wrap.querySelector('.swarf-prefs-adv .swarf-prefs-rows').append(r);
      }
      old.classList.add('swarf-prefs-old');   // swarf.css forces this grid on; the class puts it away
    }
    const hr = box.querySelector('hr');
    if (hr) hr.style.display = 'none';
    box.append(wrap);
    return true;
  }

  // mm | in on the bed's top-left corner (Phil 10-30: "what if we put an in/mm slider right here?"),
  // one tap from every mode. It drives Kiri's own units select, so preferences and it are one setting.
  function unitsSwitch() {
    const ui = window.kiri && window.kiri.api && window.kiri.api.ui;
    const sel = ui && ui.units;
    if (!sel || !document.body) return false;
    const box = document.createElement('div');
    box.id = 'swarf-units';
    box.setAttribute('role', 'radiogroup');
    box.setAttribute('aria-label', 'units');
    box.title = 'Millimeters or inches, for every number swarf shows (also in setup › preferences)';
    const btns = {};
    const show = () => { for (const [k, b] of Object.entries(btns)) { const on = sel.value === k; b.classList.toggle('selected', on); b.setAttribute('aria-checked', on); } };
    for (const [k, word] of [['mm', 'mm'], ['in', 'in']]) {
      const b = document.createElement('button');
      b.textContent = word; b.setAttribute('role', 'radio');
      b.addEventListener('click', () => {
        if (sel.value !== k) { sel.value = k; if (sel.onchange) sel.onchange(); else sel.dispatchEvent(new Event('change')); }
        show();
      });
      btns[k] = b; box.append(b);
    }
    document.body.append(box);
    sel.addEventListener('change', show);
    try { for (const ev of ['settings.load', 'settings.saved']) window.kiri.api.event.on(ev, show); } catch (e) { /* events not ready */ }
    setInterval(show, 1000);   // a change made in code (onchange without an event) still shows
    show();
    return true;
  }
  let utries = 0;
  const ut = setInterval(() => { if (unitsSwitch() || ++utries > 200) clearInterval(ut); }, 200);

  let tries = 0;
  const t = setInterval(() => { if (arrange() || ++tries > 200) clearInterval(t); }, 200);
  window.__swarfPrefs = { arrange, GROUPS };
})();
