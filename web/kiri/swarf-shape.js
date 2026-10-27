/*
 * swarf shape — make a part without a file: circle, rectangle, rounded
 * rectangle, ring, polygon or slot, at a size and a thickness (Phil 10-27:
 * "make a circle, give it a thickness, then make gcode and cut").
 *
 * The shape is written as a small SVG in millimetres and handed to cam's own
 * SVG import (api.platform.load_svg), so it becomes an ordinary part: it moves,
 * scales, takes toolpath steps and goes to control like anything imported.
 */
(function () {
  'use strict';

  const SHAPES = {
    circle:  { label: 'circle',            fields: ['d'] },
    ellipse: { label: 'ellipse',           fields: ['w', 'h'] },
    rect:    { label: 'rectangle',         fields: ['w', 'h'] },
    rounded: { label: 'rounded rectangle', fields: ['w', 'h', 'r'] },
    ring:    { label: 'ring',              fields: ['d', 'di'] },
    polygon: { label: 'polygon',           fields: ['d', 'n'] },
    star:    { label: 'star',              fields: ['d', 'p', 'i'] },
    slot:    { label: 'slot',              fields: ['w', 'h'] }
  };
  const FIELD = {
    d:  { label: 'diameter', unit: 'mm', value: 100 },
    di: { label: 'hole diameter', unit: 'mm', value: 50 },
    w:  { label: 'width', unit: 'mm', value: 150 },
    h:  { label: 'height', unit: 'mm', value: 100 },
    r:  { label: 'corner radius', unit: 'mm', value: 10 },
    n:  { label: 'sides', unit: '', value: 6 },
    p:  { label: 'points', unit: '', value: 5 },
    i:  { label: 'inner size', unit: '%', value: 44 }      // ReLeaf's star
  };
  const LAST = 'swarf-shape-last';

  const api = () => window.kiri && window.kiri.api;
  const $ = id => document.getElementById(id);
  const f = v => +(+v).toFixed(3);

  // The shape as SVG in mm (viewBox = mm, so cam's import reads mm straight).
  function svgFor(kind, v) {
    const head = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}mm" height="${f(h)}mm" viewBox="0 0 ${f(w)} ${f(h)}">`;
    const circlePath = (cx, cy, r) => `M ${f(cx - r)} ${f(cy)} A ${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)} A ${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)} Z`;
    switch (kind) {
      case 'circle': { const r = v.d / 2; return head(v.d, v.d) + `<path d="${circlePath(r, r, r)}"/></svg>`; }
      case 'ellipse': return head(v.w, v.h) + `<ellipse cx="${f(v.w / 2)}" cy="${f(v.h / 2)}" rx="${f(v.w / 2)}" ry="${f(v.h / 2)}"/></svg>`;
      case 'rect': return head(v.w, v.h) + `<rect x="0" y="0" width="${f(v.w)}" height="${f(v.h)}"/></svg>`;
      case 'rounded': return head(v.w, v.h) + `<rect x="0" y="0" width="${f(v.w)}" height="${f(v.h)}" rx="${f(v.r)}" ry="${f(v.r)}"/></svg>`;
      case 'slot': { const r = Math.min(v.w, v.h) / 2; return head(v.w, v.h) + `<rect x="0" y="0" width="${f(v.w)}" height="${f(v.h)}" rx="${f(r)}" ry="${f(r)}"/></svg>`; }
      case 'ring': { const r = v.d / 2, ri = v.di / 2; return head(v.d, v.d) + `<path fill-rule="evenodd" d="${circlePath(r, r, r)} ${circlePath(r, r, ri)}"/></svg>`; }
      case 'polygon': {
        const r = v.d / 2, n = Math.round(v.n), pts = [];
        for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / n; pts.push(`${f(r + r * Math.cos(a))},${f(r + r * Math.sin(a))}`); }
        return head(v.d, v.d) + `<polygon points="${pts.join(' ')}"/></svg>`;
      }
      case 'star': {
        const r = v.d / 2, n = Math.round(v.p), k = v.i / 100, pts = [];
        for (let j = 0; j < n * 2; j++) { const a = -Math.PI / 2 + j * Math.PI / n, q = j % 2 ? r * k : r; pts.push(`${f(r + q * Math.cos(a))},${f(r + q * Math.sin(a))}`); }
        return head(v.d, v.d) + `<polygon points="${pts.join(' ')}"/></svg>`;
      }
    }
    return null;
  }

  // what is wrong with these numbers, in the student's words (null = fine)
  function problem(kind, v, t, bed) {
    for (const k of SHAPES[kind].fields) if (!(v[k] > 0)) return `Give the ${FIELD[k].label} a number above 0.`;
    if (!(t > 0)) return 'Give the thickness a number above 0.';
    if (kind === 'ring' && v.di >= v.d) return 'The hole must be smaller than the ring.';
    if (kind === 'rounded' && v.r * 2 > Math.min(v.w, v.h)) return `The corner radius can be at most ${f(Math.min(v.w, v.h) / 2)} mm here.`;
    if (kind === 'polygon' && (v.n < 3 || v.n > 64 || Math.round(v.n) !== v.n)) return 'A polygon needs a whole number of sides, 3 to 64.';
    if (kind === 'star' && (v.p < 3 || v.p > 64 || Math.round(v.p) !== v.p)) return 'A star needs a whole number of points, 3 to 64.';
    if (kind === 'star' && (v.i < 5 || v.i > 95)) return 'Inner size is a percent of the outside, 5 to 95.';
    const wide = SHAPES[kind].fields.includes('w'), w = wide ? v.w : v.d, h = wide ? v.h : v.d;
    if (bed && (w > bed.w || h > bed.h) && (w > bed.h || h > bed.w)) return `That is bigger than the bed (${bed.w} × ${bed.h} mm).`;
    if (t > 150) return 'That is thicker than the machine can cut (150 mm).';
    return null;
  }

  function nameFor(kind, v, t) {
    const s = { star: `${Math.round(v.p)}-${f(v.d)}`, ellipse: `${f(v.w)}x${f(v.h)}`, circle: `${f(v.d)}`, rect: `${f(v.w)}x${f(v.h)}`, rounded: `${f(v.w)}x${f(v.h)}`, slot: `${f(v.w)}x${f(v.h)}`, ring: `${f(v.d)}-${f(v.di)}`, polygon: `${Math.round(v.n)}-${f(v.d)}` }[kind];
    return `${SHAPES[kind].label.replace(/ /g, '-')}-${s}mm-${f(t)}thick`;
  }

  function open() {
    const a = api();
    if (!a || !a.platform || !a.platform.load_svg) return;
    let last = {};
    try { last = JSON.parse(localStorage.getItem(LAST)) || {}; } catch (e) { /* none */ }
    const kind0 = SHAPES[last.kind] ? last.kind : 'circle';
    const val = k => (last.v && last.v[k] > 0 ? last.v[k] : FIELD[k].value);
    const rows = Object.keys(FIELD).map(k =>
      `<tr data-f="${k}"><th>${FIELD[k].label}</th><td><input id="shape-${k}" value="${val(k)}" size="6" inputmode="decimal"> ${FIELD[k].unit}</td></tr>`).join('');
    const pre = [
      "<div class='f-col a-center swarf-shape'>",
      "  <h3>Make a shape</h3>",
      "  <div class='f-row t-right'><table>",
      `  <tr><th>shape</th><td><select id="shape-kind">${Object.keys(SHAPES).map(k => `<option value="${k}"${k === kind0 ? ' selected' : ''}>${SHAPES[k].label}</option>`).join('')}</select></td></tr>`,
      rows,
      `  <tr><th>thickness</th><td><input id="shape-t" value="${last.t > 0 ? last.t : 6}" size="6" inputmode="decimal"> mm</td></tr>`,
      "  </table></div>",
      "  <div id='shape-prev' class='swarf-shape-prev'></div>",
      "  <p id='shape-why' class='swarf-shape-why'></p>",
      "</div>"
    ];
    const read = () => {
      const kind = $('shape-kind').value, v = {};
      for (const k of Object.keys(FIELD)) v[k] = parseFloat(($(`shape-${k}`) || {}).value);
      return { kind, v, t: parseFloat($('shape-t').value) };
    };
    const dev = (a.conf.get().device || {});
    const bed = dev.bedWidth && dev.bedDepth ? { w: dev.bedWidth, h: dev.bedDepth } : null;
    const show = () => {
      const { kind, v, t } = read();
      for (const tr of document.querySelectorAll('.swarf-shape tr[data-f]')) tr.style.display = SHAPES[kind].fields.includes(tr.dataset.f) ? '' : 'none';
      // the size field says what it measures for this shape
      const dl = document.querySelector('.swarf-shape tr[data-f="d"] th');
      if (dl) dl.textContent = { polygon: 'across the corners', star: 'across the points' }[kind] || 'diameter';
      const why = problem(kind, v, t, bed);
      $('shape-why').textContent = why || '';
      // a small picture of it, to scale within its box
      const svg = !why && svgFor(kind, v);
      $('shape-prev').innerHTML = svg ? svg.replace(/width="[^"]*" height="[^"]*"/, 'width="100%" height="100%" preserveAspectRatio="xMidYMid meet"') : '';
      const ok = [...document.querySelectorAll('#dialog button')].find(b => /^make$/i.test(b.textContent.trim()));
      if (ok) ok.disabled = !!why;
    };
    a.uc.confirm(undefined, { make: true, cancel: false }, undefined, { pre }).then(go => {
      if (!go) return;
      const { kind, v, t } = read();
      const why = problem(kind, v, t, bed);
      if (why) { a.show.alert(why, 6); return; }
      try { localStorage.setItem(LAST, JSON.stringify({ kind, v, t })); } catch (e) { /* private window */ }
      const made = a.platform.load_svg(svgFor(kind, v), nameFor(kind, v, t), { depth: t, resolution: 2, segmin: 48, soup: true, dpi: 0 });
      if (!made.length) { a.show.alert('swarf could not make that shape.', 6); return; }
      a.show.alert(`Made a ${SHAPES[kind].label}, ${f(t)} mm thick. Next: add a step (outline cuts it out), then toolpaths.`, 8);
    });
    setTimeout(() => {
      if (!$('shape-kind')) return;
      $('shape-kind').addEventListener('change', show);
      for (const el of document.querySelectorAll('.swarf-shape input')) el.addEventListener('input', show);
      show();
    }, 0);
  }

  // FILE > save drawing: the selected parts (or every part with a drawing) as
  // DXF, AI, SVG or PDF, true size, placed as they sit on the bed
  function saveDrawing() {
    const a = api(), V = window.SwarfVector;
    if (!a || !V) return;
    const parts = [], flat = [], tilted = [];
    a.selection.for_widgets(w => {
      if (!w.meta || !w.meta.svg) { flat.push(w.meta && w.meta.file || 'a part'); return; }
      const t = w.track || {}, r = t.rot || {};
      if (Math.abs(r.x || 0) > 1e-6 || Math.abs(r.y || 0) > 1e-6) { tilted.push(w.meta.file); return; }
      parts.push({ svg: w.meta.svg, sx: (t.scale || {}).x || 1, sy: (t.scale || {}).y || 1, rz: r.z || 0, mirror: !!t.mirror, px: (t.pos || {}).x || 0, py: (t.pos || {}).y || 0 });
    });
    if (!parts.length) { a.show.alert(flat.length || tilted.length ? 'Only shapes and imported drawings (SVG, DXF, AI, PDF) have a drawing to save.' : 'Nothing to save yet.', 8); return; }
    const pre = [
      "<div class='f-col a-center swarf-shape'><h3>Save drawing</h3>",
      `<p class='swarf-shape-why' style='color:inherit'>${parts.length} part${parts.length > 1 ? 's' : ''}, true size, in mm${tilted.length ? ` — ${tilted.length} tipped on its side left out` : ''}${flat.length ? ` — ${flat.length} without a drawing left out` : ''}</p></div>`
    ];
    a.uc.confirm(undefined, { dxf: 'dxf', ai: 'ai', svg: 'svg', pdf: 'pdf', cancel: false }, undefined, { pre }).then(kind => {
      if (!kind) return;
      const out = V.writeParts(kind, parts);
      const type = { dxf: 'application/dxf', ai: 'application/postscript', svg: 'image/svg+xml', pdf: 'application/pdf' }[kind];
      const name = (parts.length === 1 && a.widgets.all().find(w => w.meta && w.meta.svg === parts[0].svg)?.meta.file || 'swarf-drawing').replace(/[^\w.-]+/g, '-');
      const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([out], { type })), download: `${name}.${kind}` });
      document.body.append(link); link.click(); link.remove();
    });
  }

  // wire the SHAPE step once the step row exists
  let tries = 0;
  const t = setInterval(() => {
    const step = document.getElementById('swarf-step-shape');
    if (step || ++tries > 200) clearInterval(t);
    if (step && !step.dataset.wired) { step.dataset.wired = '1'; step.addEventListener('click', open); }
    const save = document.getElementById('swarf-save-drawing');
    if (save && !save.dataset.wired) { save.dataset.wired = '1'; save.addEventListener('click', saveDrawing); }
  }, 150);

  window.__swarfShape = { open, svgFor, problem, nameFor, saveDrawing };
})();
