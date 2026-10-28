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
    card.append(h, p, row, s);
    document.body.append(card);
  }

  function show() {
    const a = api();
    if (!card || !a || !a.widgets) return;
    const empty = a.widgets.all().length === 0;
    const cls = document.body.classList;
    card.classList.toggle('on', empty && !cls.contains('swarf-run-open') && !cls.contains('swarf-draw-open'));
  }

  let tries = 0;
  const t = setInterval(() => {
    const a = api();
    if ((a && a.event && a.widgets) || ++tries > 200) {
      clearInterval(t);
      if (!a || !a.event) return;
      build();
      for (const ev of ['widget.add', 'widget.delete', 'platform.layout', 'mode.set']) a.event.on(ev, () => setTimeout(show, 0));
      new MutationObserver(show).observe(document.body, { attributes: true, attributeFilter: ['class'] });
      show();
      setTimeout(show, 600);
    }
  }, 150);

  window.__swarfStart = { show };
})();
