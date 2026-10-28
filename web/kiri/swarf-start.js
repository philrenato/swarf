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
      b('make a shape', 'a circle, rectangle, ring, slot or star, with a thickness', () => $('swarf-step-shape') && $('swarf-step-shape').click()),
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
      for (const ev of ['widget.add', 'widget.delete', 'platform.layout', 'mode.set', 'device.select']) a.event.on(ev, () => setTimeout(show, 0));
      new MutationObserver(show).observe(document.body, { attributes: true, attributeFilter: ['class'] });
      show();
      setTimeout(show, 600);
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
