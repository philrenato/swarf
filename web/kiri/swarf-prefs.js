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
      ['showSpeeds', 'colour toolpaths by speed', 'Toolpaths shaded by how fast the bit moves'],
      ['units', 'units', 'Millimeters or inches, for every number swarf shows'],
      ['ortho', 'flat view, no perspective', 'Parallel lines stay parallel: good for checking sizes'],
      ['reverseZoom', 'reverse scroll zoom', 'Scroll the other way to zoom in'],
      ['animesh', 'simulate detail', 'Finer shows the cut surface better and runs slower']
    ] },
    { id: 'bed', title: 'the bed', rows: [
      ['autoSave', 'save my work as I go', 'Parts and steps come back when you reopen swarf'],
      ['autoLayout', 'place new parts by themselves', 'A new part is laid out beside the others'],
      ['freeLayout', 'drag parts anywhere', 'Off: parts stay where the layout put them'],
      ['spaceLayout', 'space between parts', 'The gap swarf leaves between parts it lays out']
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
    // dark mode is the skin's job now (VIEW › skin): its row stays, out of sight, with the old look
    const dark = rowOf(ui.dark);
    if (dark) { dark.classList.add('swarf-prefs-dark'); wrap.querySelector('.swarf-prefs-adv .swarf-prefs-rows').append(dark); const l = dark.querySelector('label'); if (l) l.textContent = 'dark mode'; }
    // kiri's own columns, now empty of everything we moved; anything left (a mode's own row) stays reachable
    const old = box.querySelector('.f-row.gap10');
    if (old) {
      for (const c of old.querySelectorAll(':scope > .f-col')) {
        for (const r of [...c.children]) if (r.classList.contains('var-row') && !used.has(r) && r !== dark) wrap.querySelector('.swarf-prefs-adv .swarf-prefs-rows').append(r);
      }
      old.style.display = 'none';
    }
    const hr = box.querySelector('hr');
    if (hr) hr.style.display = 'none';
    box.append(wrap);
    return true;
  }

  let tries = 0;
  const t = setInterval(() => { if (arrange() || ++tries > 200) clearInterval(t); }, 200);
  window.__swarfPrefs = { arrange, GROUPS };
})();
