/*
 * swarf start — what an empty bed says (review 10-28, Phil: "Empty bed with
 * prompt works"). No demo cube: when nothing is on the bed, one quiet card in
 * the middle of it offers the three ways to begin, each the same as its step.
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const api = () => window.kiri && window.kiri.api;
  let card;

  function build() {
    card = document.createElement('div');
    card.id = 'swarf-start';
    const b = (word, title, fn) => { const x = document.createElement('button'); x.textContent = word; x.title = title; x.onclick = fn; return x; };
    const row = document.createElement('div'); row.className = 'row';
    row.append(
      b('make a shape', 'a circle, rectangle, ring, polygon, star or slot, with a thickness', () => $('swarf-step-shape') && $('swarf-step-shape').click()),
      b('draw one', 'draw an outline or type words on the bed, seen from above', () => window.__swarfDraw && window.__swarfDraw.open()),
      b('open a file', 'a drawing (SVG, DXF, AI, PDF) or a model (STL, OBJ)', () => $('load-file') && $('load-file').click()));
    const h = document.createElement('h2'); h.textContent = 'The bed is empty';
    const p = document.createElement('p'); p.textContent = 'Make a shape, draw one, or open a file.';
    const s = document.createElement('small'); s.textContent = 'or drop a file anywhere on the bed';
    const m = document.createElement('small'); m.className = 'bed';
    card.append(h, p, row, s, m);
    document.body.append(card);
  }

  function show() {
    const a = api();
    if (!card || !a || !a.widgets) return;
    const empty = a.widgets.all().length === 0;
    const cls = document.body.classList;
    // never over a dialog (Fable review 3 #14: it floated over setup › machine)
    const modal = (document.getElementById('dialog') || {}).open || [...document.querySelectorAll('#modal, .mdialog')].some(m => m.offsetParent && getComputedStyle(m).display !== 'none' && m.id !== 'swarf-start');
    if (modal) { card.classList.remove('on'); return; }
    card.classList.toggle('on', empty && !cls.contains('swarf-run-open') && !cls.contains('swarf-draw-open'));
    // which machine, and its bed, as DRAW names it
    try { const d = a.conf.get().device; card.querySelector('.bed').textContent = `${(d.deviceName || 'machine').replace(/\./g, ' ')} · bed ${Math.round(d.bedWidth)} × ${Math.round(d.bedDepth)} mm`; } catch (e) { /* no device yet */ }
  }

  let tries = 0;
  const t = setInterval(() => {
    const a = api();
    if ((a && a.event && a.widgets) || ++tries > 200) {
      clearInterval(t);
      if (!a || !a.event) return;
      build();
      // Phil 10-28: "we should default to lower left as 0, not center": saved jobs from
      // before carry the old centre origin; move them over once (a choice made after stays)
      try {
        if (!localStorage.getItem('swarf-origin-front-left')) {
          const s = a.conf.get();
          if (s.process) s.process.camOriginCenter = false;
          const saved = s.sproc && (s.sproc.CAM || s.sproc.cam);
          if (saved) for (const k in saved) if (saved[k] && typeof saved[k] === 'object') saved[k].camOriginCenter = false;
          a.conf.save();
          localStorage.setItem('swarf-origin-front-left', '1');
        }
      } catch (e) { /* private window: the default already says front-left */ }
      for (const ev of ['widget.add', 'widget.delete', 'platform.layout', 'mode.set', 'device.select']) a.event.on(ev, () => setTimeout(show, 0));
      new MutationObserver(show).observe(document.body, { attributes: true, attributeFilter: ['class'] });
      show();
      setTimeout(show, 600);
      // setup › machine: the two machines, plainly; Kiri's own editor behind "machine settings"
      // (Fable review 3 #14: the student met gcode macros and firmware flags there)
      const dev = $('set-device');
      if (dev) dev.addEventListener('click', e => {
        e.stopImmediatePropagation(); e.preventDefault();
        const cur = (a.conf.get().device || {}).deviceName || '';
        const pre = ["<div class='f-col a-center swarf-shape'><h3>Which machine?</h3>",
          `<p class='swarf-shape-why' style='color:inherit;max-width:340px'>Now: ${cur.replace(/\./g, ' ')}. The ShopBot is the shop's 4 × 8 ft router, run from swarf's control. The MR-1 is the benchtop mill; it takes the exported file.</p></div>`];
        a.uc.confirm(undefined, { 'ShopBot (4 × 8 ft bed)': 'ShopBot.Basic', 'MR-1 (500 × 500 mm bed)': 'Langmuir.MR-1', 'machine settings': 'edit', cancel: false }, undefined, { pre }).then(v => {
          if (v === 'edit') return a.show.devices();
          if (v && v !== cur) a.devices.select(v);
        });
      }, true);
      // switching machine says at once what no longer fits (Fable review 3 #13)
      a.event.on('device.selected', () => setTimeout(() => {
        try {
          const d = a.conf.get().device || {}, big = [];
          for (const w of a.widgets.all()) { const g = w.mesh.geometry; g.computeBoundingBox(); const b = g.boundingBox; if (b.max.x - b.min.x > d.bedWidth + 0.5 || b.max.y - b.min.y > d.bedDepth + 0.5) big.push(`${(w.meta && w.meta.file || 'a part').replace(/\.[^.]+$/, '')} is ${(b.max.x - b.min.x).toFixed(0)} × ${(b.max.y - b.min.y).toFixed(0)} mm`); }
          if (big.length) a.show.alert(`${big.join('; ')}: bigger than this machine's ${d.bedWidth.toFixed(0)} × ${d.bedDepth.toFixed(0)} mm bed.`, 10);
        } catch (e) { /* no parts yet */ }
      }, 300));
      // on an empty bed, toolpaths and export say why nothing happens (review 10-28b #16)
      for (const id of ['act-paths', 'act-export', 'act-animate']) {
        const b = $(id);
        if (b) b.addEventListener('click', e => {
          if (a.widgets.all().length) return;
          e.stopPropagation();
          const p = card.querySelector('p');
          p.textContent = 'Nothing to cut yet: make a shape, draw one, or open a file.';
          p.classList.add('nudge');
          clearTimeout(p.t); p.t = setTimeout(() => { p.textContent = 'Make a shape, draw one, or open a file.'; p.classList.remove('nudge'); }, 2500);
        }, true);
      }
      // a faded step says why it is off (review 10-28b #15)
      const sim = $('act-animate');
      if (sim) {
        const why = () => {
          const off = sim.classList.contains('disabled');
          if (off && !sim.dataset.title) sim.dataset.title = sim.title;
          sim.title = off ? (a.widgets.all().length ? 'simulate: press toolpaths first' : 'simulate: put a part on the bed, then press toolpaths') : (sim.dataset.title || sim.title);
        };
        new MutationObserver(why).observe(sim, { attributes: true, attributeFilter: ['class'] });
        for (const ev of ['widget.add', 'widget.delete']) a.event.on(ev, () => setTimeout(why, 0));
        why();
      }
    }
  }, 150);

  window.__swarfStart = { show };
})();
