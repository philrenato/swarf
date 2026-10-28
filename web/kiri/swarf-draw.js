/*
 * swarf draw — the bed seen from above, as a drawing (Phil 10-27: "select a
 * point, move it, on polygons and NURBS curves, draw something, scale any of
 * these things, give thicknesses … 2D drawing that yields machinable 3D forms").
 *
 * DRAW opens a board over the workspace showing every part that has a drawing
 * (shapes, SVG/DXF/AI/PDF imports) where it sits on the bed. Pick a part, then
 * its points: drag them, type where they go, add one (double-click an edge) or
 * remove one (delete). The pen draws a new outline (click a corner, drag a smooth
 * point); rectangle and ellipse drag out from corner to corner; text sets a
 * word in a real font (opentype.js reads the glyph outlines: the built-in Russo
 * One, or any .ttf / .otf the person picks). "done" rebuilds
 * each changed part from its drawing at its thickness, where it was drawn.
 *
 * Curves are Unreason's NURBS ({ degree, knots, ctrlPts: [[x, y, 0, w]…] }, mm,
 * y up, through window.SwarfVector). A curve whose spans are all Bézier pieces
 * (polygons, arcs, SVG paths) edits like Illustrator: anchors carry their
 * handles. Any other NURBS edits by its control points.
 *
 * Each part keeps a 2D transform (meta.xf) as cam scales, turns and mirrors
 * it, so its drawing lines up with the part exactly.
 */
(function () {
  'use strict';
  const api = () => window.kiri && window.kiri.api;
  const V = () => window.SwarfVector;
  const $ = id => document.getElementById(id);
  const r3 = v => +(+v).toFixed(3);
  const THICK = 'swarf-draw-thick';
  const HIT = 7;                                 // px: how near a press must be to a point

  // ── a part's 2D transform, kept as cam changes it ──
  const mul = (A, B) => [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3]];
  // cam bakes each scale / turn / mirror into the mesh, then re-centres it on
  // its box (track.center holds that shift) before it says so. The drawing
  // follows both: local = xf·(p − c0) + t, on the bed = local + pos.
  function track(w, M) {
    const d = (w.track && w.track.center) || { dx: 0, dy: 0 };
    for (const g of (w.group && w.group.length ? w.group : [w])) {
      if (!g.meta || !g.meta.svg) continue;
      const known = !!g.meta.xf;
      g.meta.xf = mul(M, g.meta.xf || guessXf(g));
      if (known && g.meta.t) {
        const [tx, ty] = g.meta.t;
        g.meta.t = [M[0] * tx + M[1] * ty - (d.dx || 0), M[2] * tx + M[3] * ty - (d.dy || 0)];
      } else delete g.meta.t;                    // from before r37: line it up by its box instead
    }
  }
  function onRotate({ widget, x, y, z }) {
    if (typeof x !== 'number') {                 // a quaternion (lay flat, face tool): about Z only if x, y are nil
      const q = x || {};
      if (Math.abs(q.x || 0) > 1e-9 || Math.abs(q.y || 0) > 1e-9) return tilt(widget);
      const t = 2 * Math.atan2(q.z || 0, q.w ?? 1);
      return track(widget, [Math.cos(t), -Math.sin(t), Math.sin(t), Math.cos(t)]);
    }
    if (Math.abs(x || 0) > 1e-9 || Math.abs(y || 0) > 1e-9) return tilt(widget);
    const t = z || 0;
    track(widget, [Math.cos(t), -Math.sin(t), Math.sin(t), Math.cos(t)]);
  }
  function tilt(w) { for (const g of (w.group && w.group.length ? w.group : [w])) if (g.meta) g.meta.tilted = true; }
  // a part from before r37: its transform from what cam tracked (mirror, then scale, then turn)
  function guessXf(w) {
    const t = w.track || {}, s = t.scale || {}, rz = (t.rot || {}).z || 0, m = t.mirror ? -1 : 1;
    return mul([Math.cos(rz), -Math.sin(rz), Math.sin(rz), Math.cos(rz)], [m * (s.x || 1), 0, 0, s.y || 1]);
  }

  // ── curves ──
  const clone = o => JSON.parse(JSON.stringify(o));
  function boxOf(curves) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const c of curves) for (const C of V().cubics(c.crv)) for (const p of C) {
      b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]);
    }
    return b;
  }
  const isClosed = crv => { const P = crv.ctrlPts, a = P[0], b = P[P.length - 1]; return Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6; };
  // every interior knot at full multiplicity: the curve is Bézier pieces end to end
  function isChain(crv) {
    const p = crv.degree, U = crv.knots, n = crv.ctrlPts.length;
    if (U.length !== n + p + 1 || (n - 1) % p) return false;
    for (let i = 1; i <= p; i++) if (U[i] !== U[0] || U[U.length - 1 - i] !== U[U.length - 1]) return false;
    for (let i = p + 1; i < U.length - p - 1; i += p) for (let k = 1; k < p; k++) if (U[i + k] !== U[i]) return false;
    return true;
  }
  function chainKnots(p, spans) {
    const U = Array(p + 1).fill(0);
    for (let s = 1; s < spans; s++) for (let k = 0; k < p; k++) U.push(s);
    for (let k = 0; k <= p; k++) U.push(spans);
    return U;
  }
  // the drawing as it sits on the bed: centred on c0, through xf, at the part's place
  function bedCurves(w) {
    if (typeof w.meta.svg !== 'string' || !/<svg/.test(w.meta.svg)) return [];
    let list;
    try { list = V().curves(w.meta.svg); } catch (e) { return []; }
    if (!list.length) return [];
    const c0 = w.meta.c0 || (b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2])(boxOf(list));
    const M = w.meta.xf || guessXf(w);
    for (const c of list) c.crv.ctrlPts = c.crv.ctrlPts.map(([x, y, z, wt]) => {
      const u = x - c0[0], v = y - c0[1];
      return [M[0] * u + M[1] * v, M[2] * u + M[3] * v, 0, wt ?? 1];
    });
    const pos = w.track.pos;
    let dx, dy;
    if (w.meta.t) { dx = pos.x + w.meta.t[0]; dy = pos.y + w.meta.t[1]; }
    else {                                       // a part from before r37: centre the drawing on the part's place
      const b = boxOf(list);
      dx = pos.x - (b[0] + b[2]) / 2; dy = pos.y - (b[1] + b[3]) / 2;
    }
    for (const c of list) for (const P of c.crv.ctrlPts) { P[0] += dx; P[1] += dy; }
    return list;
  }
  function thicknessOf(w) {
    const g = w.mesh && w.mesh.geometry;
    if (!g) return 6;
    g.computeBoundingBox();
    const b = g.boundingBox;
    return r3(b.max.z - b.min.z);
  }

  // ── the board ──
  let S = null;                                  // open state
  const ui = {};

  function open() {
    const a = api();
    if (!a || !V() || S) return;
    const dev = a.conf.get().device || {};
    const bw = dev.bedWidth || 600, bd = dev.bedDepth || 600;
    const parts = [], others = [];
    for (const w of a.widgets.all()) {
      if (w.meta && w.meta.svg && !w.meta.tilted) {
        const curves = bedCurves(w);
        if (curves.length) { parts.push({ w, name: w.meta.file || 'part', thick: thicknessOf(w), edge: w.meta.edge ? { ...w.meta.edge } : { kind: 'straight', size: 2 }, curves, dirty: false }); continue; }
      }
      const g = w.mesh.geometry; g.computeBoundingBox();
      const b = g.boundingBox, p = w.track.pos;
      others.push([p.x + b.min.x, p.y + b.min.y, p.x + b.max.x, p.y + b.max.y, w.meta && w.meta.file || 'part']);
    }
    let t0 = 6;
    try { t0 = parseFloat(localStorage.getItem(THICK)) || 6; } catch (e) { /* private */ }
    S = { parts, others, bed: [bw, bd], sel: -1, pts: new Set(), tool: 'select', pen: [], drag: null, undo: [], thick: t0, edge: { kind: 'straight', size: 2 }, removed: [], hover: null };
    build();
    // the part picked in the workspace is the one picked here
    const picked = a.selection.widgets ? a.selection.widgets() : [];
    const i = parts.findIndex(p => picked.includes(p.w));
    if (i >= 0) S.sel = i;
    fit();
    say(parts.length ? 'Pick a part, then a point to move it. The pen draws a new outline.' : (others.length ? 'These parts have no drawing to edit (only shapes and 2D drawings do). The pen draws a new outline.' : 'The pen draws an outline: click its corners, then click the first one to close it.'));
    render();
  }

  function build() {
    const el = document.createElement('div');
    el.id = 'swarf-draw';
    el.innerHTML = `
      <svg id="sd-svg" tabindex="0"></svg>
      <div class="sd-bar">
        <button data-tool="select" title="pick parts and points (V)">select</button>
        <button data-tool="pen" title="draw an outline: click for a corner, drag for a smooth point, click the first to close (P)">pen</button>
        <button data-tool="rect" title="drag a rectangle from corner to corner; shift for a square (R)">rectangle</button>
        <button data-tool="ellipse" title="drag an ellipse from corner to corner; shift for a circle (E)">ellipse</button>
        <button data-tool="text" title="click where the text starts; type it in the card (T)">text</button>
        <span class="sd-sep"></span>
        <button id="sd-undo" title="undo (⌘Z)">undo</button>
        <button id="sd-fit" title="show the parts, or the whole bed (F) · pinch or ⌘-scroll to zoom, two fingers to slide">fit</button>
        <span class="sd-grow"></span>
        <button id="sd-cancel" title="close without changing the parts (Esc twice)">cancel</button>
        <button id="sd-done" class="sd-go" title="rebuild the changed parts and close">done</button>
      </div>
      <div class="sd-card" id="sd-card"></div>
      <p class="sd-say" id="sd-say"></p>`;
    document.body.append(el);
    document.body.classList.add('swarf-draw-open');
    ui.el = el; ui.svg = $('sd-svg'); ui.card = $('sd-card');
    for (const b of el.querySelectorAll('[data-tool]')) b.onclick = () => setTool(b.dataset.tool);
    $('sd-undo').onclick = undo;
    $('sd-fit').onclick = () => { fit(!S.whole); render(); ui.svg.focus(); };
    $('sd-cancel').onclick = () => close(false);
    $('sd-done').onclick = () => close(true);
    ui.svg.addEventListener('pointerdown', down);
    ui.svg.addEventListener('pointermove', move);
    ui.svg.addEventListener('pointerup', up);
    ui.svg.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', render);
    ui.svg.focus();
  }

  function close(apply) {
    if (!S) return;
    if (apply) commit();
    window.removeEventListener('keydown', key, true);
    window.removeEventListener('resize', render);
    ui.el.remove();
    document.body.classList.remove('swarf-draw-open');
    S = null;
  }

  // ── view: mm on the bed to px on the board ──
  // to the parts (with room around them), or to the whole bed (whole = true)
  function fit(whole) {
    const r = ui.svg.getBoundingClientRect();
    const W = r.width || window.innerWidth, H = r.height || window.innerHeight;
    const [bw, bd] = S.bed;
    let b = [-bw / 2, -bd / 2, bw / 2, bd / 2];
    const live = S.parts.filter(p => !p.gone);
    if (!whole && (live.length || S.others.length)) {
      b = [Infinity, Infinity, -Infinity, -Infinity];
      const take = q => { b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[2]); b[3] = Math.max(b[3], q[3]); };
      for (const p of live) take(boxOf(p.curves));
      for (const o of S.others) take(o);
      // at least 300 mm across, so one small part is not a wall of a few points
      const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, h = Math.max(150, (b[2] - b[0]) * 0.7, (b[3] - b[1]) * 0.7);
      b = [cx - h, cy - h, cx + h, cy + h];
    }
    const left = 16, right = W > 900 ? 260 : 16, top = 76, bottom = 50;
    S.k = Math.max(0.02, Math.min((W - left - right) / (b[2] - b[0]), (H - top - bottom) / (b[3] - b[1])));
    S.ox = left + (W - left - right) / 2 - (b[0] + b[2]) / 2 * S.k;
    S.oy = top + (H - top - bottom) / 2 + (b[1] + b[3]) / 2 * S.k;
    S.whole = !!whole;
  }
  const sx = x => S.ox + x * S.k, sy = y => S.oy - y * S.k;
  function toMM(e) { const r = ui.svg.getBoundingClientRect(); return [(e.clientX - r.left - S.ox) / S.k, -(e.clientY - r.top - S.oy) / S.k]; }

  // the points a person moves: anchors (and handles) of a chain, control points otherwise
  function handles(part) {
    const out = [];
    part.curves.forEach((c, ci) => {
      const crv = c.crv, P = crv.ctrlPts, n = P.length, closed = isClosed(crv), p = crv.degree;
      const chain = isChain(crv);
      for (let i = 0; i < n; i++) {
        if (closed && i === n - 1) continue;      // the closing point is the first
        const anchor = !chain || i % p === 0;
        out.push({ id: `${ci}:${i}`, ci, i, x: P[i][0], y: P[i][1], anchor, chain });
      }
    });
    return out;
  }

  // a point and whatever moves with it: the closing twin, and an anchor's own handles
  function moveSet(part, ids) {
    const set = new Set();
    for (const id of ids) {
      const [ci, i] = id.split(':').map(Number), crv = part.curves[ci].crv, n = crv.ctrlPts.length, p = crv.degree;
      const closed = isClosed(crv), chain = isChain(crv);
      const add = j => { if (j < 0 || j >= n) return; set.add(`${ci}:${j}`); if (closed && j === 0) set.add(`${ci}:${n - 1}`); if (closed && j === n - 1) set.add(`${ci}:0`); };
      add(i);
      if (chain && p > 1 && i % p === 0) {
        add(i + 1); add(i - 1);
        if (closed && i === 0) add(n - 2);
      }
    }
    return set;
  }

  function render() {
    if (!S) return;
    const k = S.k, [bw, bd] = S.bed, out = [];
    // the bed and a 10 mm / 100 mm grid
    out.push(`<rect class="sd-bed" x="${sx(-bw / 2)}" y="${sy(bd / 2)}" width="${bw * k}" height="${bd * k}"/>`);
    const step = k * 10 > 6 ? 10 : 100;
    let g = '';
    for (let x = Math.ceil(-bw / 2 / step) * step; x <= bw / 2; x += step) g += `M${sx(x)},${sy(-bd / 2)}V${sy(bd / 2)}`;
    for (let y = Math.ceil(-bd / 2 / step) * step; y <= bd / 2; y += step) g += `M${sx(-bw / 2)},${sy(y)}H${sx(bw / 2)}`;
    out.push(`<path class="sd-grid${step === 100 ? ' big' : ''}" d="${g}"/>`);
    if (step === 10) {
      let G = '';
      for (let x = Math.ceil(-bw / 200) * 100; x <= bw / 2; x += 100) G += `M${sx(x)},${sy(-bd / 2)}V${sy(bd / 2)}`;
      for (let y = Math.ceil(-bd / 200) * 100; y <= bd / 2; y += 100) G += `M${sx(-bw / 2)},${sy(y)}H${sx(bw / 2)}`;
      out.push(`<path class="sd-grid big" d="${G}"/>`);
    }
    for (const o of S.others) out.push(`<rect class="sd-other" x="${sx(o[0])}" y="${sy(o[3])}" width="${(o[2] - o[0]) * k}" height="${(o[3] - o[1]) * k}"><title>${o[4]}: no drawing to edit</title></rect>`);
    S.parts.forEach((part, pi) => {
      if (part.gone) return;
      const d = part.curves.map(c => pathOf(c.crv)).join(' ');
      out.push(`<path class="sd-part${pi === S.sel ? ' on' : ''}" data-part="${pi}" d="${d}"/>`);
      // a wide, unseen edge, so a press near the outline (to add a point) lands on the part
      if (pi === S.sel) out.push(`<path class="sd-edge" data-part="${pi}" d="${d}"/>`);
    });
    const part = S.parts[S.sel];
    if (part && !part.gone) {
      // the control lines of each curve, then its points
      let cl = '';
      for (const c of part.curves) {
        const P = c.crv.ctrlPts, p = c.crv.degree, chain = isChain(c.crv);
        if (p === 1) continue;
        if (chain) for (let i = 0; i < P.length; i += p) {
          if (i + 1 < P.length) cl += `M${sx(P[i][0])},${sy(P[i][1])}L${sx(P[i + 1][0])},${sy(P[i + 1][1])}`;
          if (i - 1 >= 0) cl += `M${sx(P[i][0])},${sy(P[i][1])}L${sx(P[i - 1][0])},${sy(P[i - 1][1])}`;
        } else cl += 'M' + P.map(q => `${sx(q[0])},${sy(q[1])}`).join('L');
      }
      if (cl) out.push(`<path class="sd-ctl" d="${cl}"/>`);
      for (const h of handles(part)) {
        const on = S.pts.has(h.id), X = sx(h.x), Y = sy(h.y);
        out.push(h.anchor
          ? `<rect class="sd-pt${on ? ' on' : ''}" data-pt="${h.id}" x="${X - 4}" y="${Y - 4}" width="8" height="8"/>`
          : `<circle class="sd-hd${on ? ' on' : ''}" data-pt="${h.id}" cx="${X}" cy="${Y}" r="3.5"/>`);
      }
    }
    // the pen's outline so far, and the line to the cursor
    if (S.tool === 'pen' && S.pen.length) {
      const pen = S.hover && !S.drag ? S.pen.concat([{ p: S.hover, h: null }]) : S.pen;
      const C = penPieces(pen, false);
      let d = `M${sx(pen[0].p[0])},${sy(pen[0].p[1])}`;
      for (const c of C) d += `C${sx(c[1][0])},${sy(c[1][1])} ${sx(c[2][0])},${sy(c[2][1])} ${sx(c[3][0])},${sy(c[3][1])}`;
      out.push(`<path class="sd-pen" d="${d}"/>`);
      // the smooth points' handles, both sides
      let hl = '';
      for (const q of S.pen) if (q.h) { const o = [2 * q.p[0] - q.h[0], 2 * q.p[1] - q.h[1]]; hl += `M${sx(o[0])},${sy(o[1])}L${sx(q.h[0])},${sy(q.h[1])}`; }
      if (hl) out.push(`<path class="sd-ctl" d="${hl}"/>`);
      for (const q of S.pen.slice(1)) out.push(`<rect class="sd-pt" x="${sx(q.p[0]) - 3}" y="${sy(q.p[1]) - 3}" width="6" height="6" style="pointer-events:none"/>`);
      out.push(`<rect class="sd-pt first" x="${sx(S.pen[0].p[0]) - 5}" y="${sy(S.pen[0].p[1]) - 5}" width="10" height="10"/>`);
    }
    if (S.ghost) out.push(`<path class="sd-pen" d="${pathOf(S.ghost)}"/>`);
    if (S.tool === 'text' && S.ghostText && S.ghostText.length) out.push(`<path class="sd-pen" d="${S.ghostText.map(c => pathOf(c.crv)).join(' ')}"/>`);
    if (S.box) {
      const [a, b] = S.box;
      out.push(`<rect class="sd-box" x="${Math.min(sx(a[0]), sx(b[0]))}" y="${Math.min(sy(a[1]), sy(b[1]))}" width="${Math.abs(a[0] - b[0]) * k}" height="${Math.abs(a[1] - b[1]) * k}"/>`);
    }
    ui.svg.innerHTML = out.join('');
    for (const b of ui.el.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === S.tool);
    $('sd-undo').disabled = !S.undo.length;
    card();
  }
  function pathOf(crv) {
    const C = V().cubics(crv);
    if (!C.length) return '';
    let d = `M${sx(C[0][0][0])},${sy(C[0][0][1])}`;
    for (const c of C) d += `C${sx(c[1][0])},${sy(c[1][1])} ${sx(c[2][0])},${sy(c[2][1])} ${sx(c[3][0])},${sy(c[3][1])}`;
    return d + (isClosed(crv) ? 'Z' : '');
  }

  // the card: what is picked, its numbers, typeable
  function card() {
    const part = S.parts[S.sel];
    const row = (word, id, v, unit) => `<div class="sd-row"><span>${word}</span><input id="${id}" value="${v}" inputmode="decimal"><span class="u">${unit}</span></div>`;
    const textRows = (str, hh) => `<div class="sd-row"><span>words</span><input id="sd-str" class="wide" value="${esc(str)}"></div>${row('letter height', 'sd-th', hh, 'mm')}
      <div class="sd-row"><span>font</span><span class="sd-font">${esc(TEXT.name)}</span><button id="sd-font" title="use a .ttf or .otf font from this computer">change…</button></div>`;
    const edgeRows = e => `<div class="sd-row"><span>top edge</span><select id="sd-edge">${['straight', 'chamfer', 'round'].map(k => `<option${k === e.kind ? ' selected' : ''}>${k}</option>`).join('')}</select><span class="u"></span></div>${e.kind === 'straight' ? '' : row('edge size', 'sd-es', e.size, 'mm')}`;
    let h = '';
    if (S.tool !== 'select') {
      const how = {
        pen: 'Click for a corner. Drag for a smooth point. Click the first point (or press Enter) to close the outline.',
        rect: 'Drag from one corner to the other. Hold shift for a square.',
        ellipse: 'Drag from one corner of its box to the other. Hold shift for a circle.',
        text: 'Type the words, then click where they start (the left end of the baseline).'
      }[S.tool];
      h = `<div class="sd-h">${S.tool === 'rect' ? 'rectangle' : S.tool}</div><div class="sd-note">${how}</div>`;
      if (S.tool === 'text') h += textRows(TEXT.str, TEXT.h);
      h += `${row('thickness', 'sd-pen-t', S.thick, 'mm')}${edgeRows(S.edge)}`;
    } else if (part && !part.gone) {
      const b = boxOf(part.curves), one = S.pts.size === 1 ? [...S.pts][0] : null;
      h = `<div class="sd-h">${esc(part.name)}</div>${part.text ? textRows(part.text.str, part.text.h) : ''}${row('width', 'sd-w', r3(b[2] - b[0]), 'mm')}${row('depth', 'sd-d', r3(b[3] - b[1]), 'mm')}${row('thickness', 'sd-t', part.thick, 'mm')}${edgeRows(part.edge)}`;
      if (one) {
        const [ci, i] = one.split(':').map(Number), P = part.curves[ci].crv.ctrlPts[i];
        h += `<div class="sd-h">point</div>${row('x', 'sd-px', r3(P[0]), 'mm')}${row('y', 'sd-py', r3(P[1]), 'mm')}`;
      } else if (S.pts.size) h += `<div class="sd-h">${S.pts.size} points</div>`;
      h += `<div class="sd-h">${S.pts.size ? (S.pts.size === 1 ? 'around it' : 'the points') : 'the part'}</div>${row('scale', 'sd-scale', 100, '%')}${row('turn', 'sd-turn', 0, '°')}
        <div class="sd-note">${S.pts.size ? 'Drag a point, or type where it goes. Delete removes it. Double-click an edge to add one.' : 'Drag the part to move it. Click a point to pick it; drag across points to pick several.'}</div>
        ${S.pts.size ? '' : '<div class="sd-row"><button id="sd-del" title="remove this part (when you press done)">delete this part</button></div>'}`;
    } else if (S.parts.some(p => !p.gone)) {
      h = '<div class="sd-note">Click a part to edit it.</div>';
    }
    ui.card.innerHTML = h;
    const num = (id, fn) => { const el = $(id); if (!el) return; el.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') { fn(parseFloat(el.value), el); el.blur(); } if (e.key === 'Escape') { render(); ui.svg.focus(); } }; el.onchange = () => fn(parseFloat(el.value), el); };
    num('sd-t', v => { if (!(v > 0)) return say('The thickness must be more than 0 mm.'); if (v === part.thick) return; snap(); part.thick = r3(v); part.dirty = true; render(); });
    // the top edge: the pen's next outline, or the picked part
    const E = S.tool !== 'select' ? S.edge : part && part.edge;
    const sel = $('sd-edge');
    if (sel && E) sel.onchange = () => { if (S.tool === 'select') { snap(); part.dirty = true; } E.kind = sel.value; render(); edgeSay(); };
    num('sd-es', v => { if (!(v > 0)) return say('The edge size must be more than 0 mm.'); if (!E || v === E.size) return; if (S.tool === 'select') { snap(); part.dirty = true; } E.size = r3(v); render(); edgeSay(); });
    num('sd-pen-t', v => { if (v > 0) { S.thick = r3(v); try { localStorage.setItem(THICK, String(S.thick)); } catch (e) { /* private */ } } });
    num('sd-px', v => { if (!isFinite(v)) return; const [ci, i] = [...S.pts][0].split(':').map(Number), P = part.curves[ci].crv.ctrlPts[i]; if (v === r3(P[0])) return; snap(); shiftPts(part, [...S.pts], v - P[0], 0); render(); });
    num('sd-py', v => { if (!isFinite(v)) return; const [ci, i] = [...S.pts][0].split(':').map(Number), P = part.curves[ci].crv.ctrlPts[i]; if (v === r3(P[1])) return; snap(); shiftPts(part, [...S.pts], 0, v - P[1]); render(); });
    // width / depth: the whole part stretched about its centre to that size
    const size = (axis, v) => {
      if (!(v > 0)) return say('A size must be more than 0 mm.');
      const b = boxOf(part.curves), was = axis ? b[3] - b[1] : b[2] - b[0];
      if (!(was > 0) || Math.abs(v - was) < 1e-6) return;
      const f = v / was;
      snap();
      const keep = S.pts; S.pts = new Set();
      transform(part, ([x, y]) => (axis ? [x, y * f] : [x * f, y]));
      S.pts = keep;
      render();
    };
    // text: the words and their height, for the tool's next text or the picked text part
    const strEl = $('sd-str');
    if (strEl) {
      const setText = (str, hh) => {
        if (S.tool === 'text') { TEXT.str = str; TEXT.h = hh; return; }
        const t = { ...part.text, str, h: hh }, c = textCurves(t);
        if (!c.length) return say('Type some letters: an empty text has nothing to cut.');
        snap(); part.text = t; part.curves = c; part.dirty = true; render();
      };
      strEl.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') { strEl.blur(); } };
      strEl.oninput = () => { if (S.tool === 'text') TEXT.str = strEl.value; };
      strEl.onchange = () => setText(strEl.value, S.tool === 'text' ? TEXT.h : part.text.h);
      num('sd-th', v => { if (!(v > 0)) return say('The letter height must be more than 0 mm.'); setText(S.tool === 'text' ? TEXT.str : part.text.str, r3(v)); });
      const fb = $('sd-font');
      if (fb) fb.onclick = () => {
        const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.ttf,.otf' });
        inp.onchange = async () => {
          const file = inp.files && inp.files[0];
          if (!file) return;
          try {
            if (!window.opentype) await loadScript('vendor/opentype/opentype.min.js');
            TEXT.font = window.opentype.parse(await file.arrayBuffer());
            TEXT.name = file.name.replace(/\.(ttf|otf)$/i, '');
            if (S.tool !== 'text' && part && part.text) setText(part.text.str, part.text.h);
            say(`Letters now in ${TEXT.name}.`);
            render();
          } catch (e) { say(`That font could not be read (${e.message}). Try a .ttf or .otf.`); }
        };
        inp.click();
      };
    }
    const del = $('sd-del');
    if (del) del.onclick = () => { S.pts.clear(); deletePts(); ui.svg.focus(); };
    num('sd-w', v => size(0, v));
    num('sd-d', v => size(1, v));
    num('sd-scale', v => { if (!(v > 0)) return say('Scale is a percentage more than 0.'); if (v !== 100) { snap(); transform(part, M => [M[0] * v / 100, M[1] * v / 100]); render(); } });
    num('sd-turn', v => { if (!isFinite(v) || !v) return; const t = v * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); snap(); transform(part, ([x, y]) => [c * x - s * y, s * x + c * y]); render(); });
  }
  // whether the picked part's edge fits its outline, said at once rather than at done
  function edgeSay() {
    const a = api(), part = S.parts[S.sel];
    if (!part || S.tool !== 'select' || part.edge.kind === 'straight' || !a.platform.edge_problem) return;
    const closed = part.curves.filter(c => isClosed(c.crv));
    if (!closed.length) return;
    const why = a.platform.edge_problem(V().svgOf(closed), { depth: part.thick, resolution: 2, segmin: 48, soup: true, dpi: 0, edge: part.edge });
    say(why || `A ${part.edge.size} mm ${part.edge.kind} fits. Press done to shape it.`);
  }
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function say(t) { const el = $('sd-say'); if (el) el.textContent = t || ''; }

  // ── edits ──
  function snap() { S.undo.push(JSON.stringify({ parts: S.parts.map(p => ({ ...p, w: null })), sel: S.sel, pts: [...S.pts] })); if (S.undo.length > 200) S.undo.shift(); }
  function undo() {
    if (!S.undo.length) return;
    const u = JSON.parse(S.undo.pop());
    u.parts.forEach((p, i) => { p.w = S.parts[i] ? S.parts[i].w : null; });
    S.parts = u.parts; S.sel = u.sel; S.pts = new Set(u.pts);
    render();
  }
  function shiftPts(part, ids, dx, dy) {
    delete part.text;                            // its letters are curves now

    for (const id of moveSet(part, ids)) { const [ci, i] = id.split(':').map(Number), P = part.curves[ci].crv.ctrlPts[i]; P[0] += dx; P[1] += dy; }
    part.dirty = true;
  }
  // scale / turn the picked points about their centre, or the whole part about its centre
  function transform(part, f) {
    delete part.text;

    const ids = S.pts.size ? moveSet(part, [...S.pts]) : null;
    const list = [];
    part.curves.forEach((c, ci) => c.crv.ctrlPts.forEach((P, i) => { if (!ids || ids.has(`${ci}:${i}`)) list.push(P); }));
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const P of list) { b[0] = Math.min(b[0], P[0]); b[1] = Math.min(b[1], P[1]); b[2] = Math.max(b[2], P[0]); b[3] = Math.max(b[3], P[1]); }
    const cx = ids ? (b[0] + b[2]) / 2 : (bb => (bb[0] + bb[2]) / 2)(boxOf(part.curves));
    const cy = ids ? (b[1] + b[3]) / 2 : (bb => (bb[1] + bb[3]) / 2)(boxOf(part.curves));
    for (const P of list) { const [x, y] = f([P[0] - cx, P[1] - cy]); P[0] = x + cx; P[1] = y + cy; }
    part.dirty = true;
  }
  function deletePts() {
    const part = S.parts[S.sel];
    if (!part) return;
    if (S.pts.size) delete part.text;
    if (!S.pts.size) { snap(); part.gone = true; S.sel = -1; say(`${part.name} will be removed when you press done.`); render(); return; }
    const byCurve = new Map();
    for (const id of S.pts) { const [ci, i] = id.split(':').map(Number); if (!byCurve.has(ci)) byCurve.set(ci, []); byCurve.get(ci).push(i); }
    const before = JSON.stringify(part.curves);
    for (const [ci, idx] of byCurve) {
      const crv = part.curves[ci].crv;
      if (!isChain(crv)) { say('This curve is a free NURBS: its points move, but cannot be removed.'); continue; }
      const p = crv.degree, closed = isClosed(crv);
      let spans = [];
      for (let s = 0; s + p < crv.ctrlPts.length; s += p) spans.push(crv.ctrlPts.slice(s, s + p + 1).map(q => q.slice()));
      // remove anchors from the highest index down; each joins the span before it to the one after
      const anchors = [...new Set(idx.map(i => (i % p ? null : i / p)).filter(v => v !== null))].sort((a, b) => b - a);
      for (const A of anchors) {
        if (spans.length <= (closed ? 3 : 1)) { say('A shape needs at least three corners.'); break; }
        if (closed && A === 0) { const L = spans.pop(), R = spans.shift(); spans.push(joinSpans(L, R, p)); continue; }
        if (A === 0) { spans.shift(); continue; }
        if (A === spans.length) { spans.pop(); continue; }
        const L = spans[A - 1], R = spans[A];
        spans.splice(A - 1, 2, joinSpans(L, R, p));
      }
      if (closed && spans.length) spans[spans.length - 1][p] = spans[0][0].slice();
      const P = [spans[0][0]];
      for (const s of spans) P.push(...s.slice(1));
      crv.ctrlPts = P; crv.knots = chainKnots(p, spans.length);
    }
    if (JSON.stringify(part.curves) !== before) { S.undo.push(JSON.stringify({ parts: S.parts.map(q => ({ ...q, w: null, curves: q === part ? JSON.parse(before) : q.curves })), sel: S.sel, pts: [...S.pts] })); part.dirty = true; }
    S.pts.clear();
    render();
  }
  // two Bézier spans as one: keep the outer handles
  function joinSpans(L, R, p) {
    if (p === 1) return [L[0], R[1]];
    if (p === 2) return [L[0], [(L[1][0] + R[1][0]) / 2, (L[1][1] + R[1][1]) / 2, 0, (L[1][3] + R[1][3]) / 2], R[2]];
    const h = Math.ceil(p / 2);
    return [...L.slice(0, h), ...R.slice(h)];
  }
  // double-click an edge: a new anchor there, the span split where it was pressed
  function dbl(e) {
    const part = S.parts[S.sel];
    if (!part || S.tool !== 'select') return;
    const m = toMM(e), best = { d: Infinity };
    part.curves.forEach((c, ci) => {
      if (!isChain(c.crv)) return;
      const p = c.crv.degree, P = c.crv.ctrlPts;
      for (let s = 0; s + p < P.length; s += p) {
        const H = P.slice(s, s + p + 1).map(([x, y, , w]) => [x * (w ?? 1), y * (w ?? 1), w ?? 1]);
        for (let j = 1; j < 40; j++) {
          const t = j / 40, q = casteljau(H, t).point, d = Math.hypot(q[0] / q[2] - m[0], q[1] / q[2] - m[1]);
          if (d < best.d) Object.assign(best, { d, ci, s, t, p });
        }
      }
    });
    if (best.d * S.k > 10) { say(part.curves.every(c => !isChain(c.crv)) ? 'Points can be added to polygons and Bézier curves, not to a free NURBS.' : 'Double-click right on an edge to add a point there.'); return; }
    snap();
    const crv = part.curves[best.ci].crv, p = best.p;
    const H = crv.ctrlPts.slice(best.s, best.s + p + 1).map(([x, y, , w]) => [x * (w ?? 1), y * (w ?? 1), w ?? 1]);
    const { left, right } = casteljau(H, best.t);
    const back = h => [h[0] / h[2], h[1] / h[2], 0, h[2]];
    crv.ctrlPts.splice(best.s, p + 1, ...left.map(back), ...right.slice(1).map(back));
    crv.knots = chainKnots(p, (crv.ctrlPts.length - 1) / p);
    part.dirty = true;
    delete part.text;
    S.pts = new Set([`${best.ci}:${best.s + p}`]);
    render();
  }
  function casteljau(H, t) {
    let a = H.map(x => x.slice());
    const left = [a[0].slice()], right = [a[a.length - 1].slice()];
    while (a.length > 1) {
      const b = [];
      for (let i = 0; i < a.length - 1; i++) b.push([0, 1, 2].map(c => (1 - t) * a[i][c] + t * a[i + 1][c]));
      a = b; left.push(a[0].slice()); right.unshift(a[a.length - 1].slice());
    }
    return { point: a[0], left, right };
  }

  // ── pointer ──
  function setTool(t) {
    S.tool = t; S.pen = []; S.hover = null; S.ghost = null; S.ghostText = null;
    if (t !== 'select') { S.sel = -1; S.pts.clear(); }
    if (t === 'text') fontReady().then(() => S && render()).catch(e => say(`Text needs its font: ${e.message}.`));
    render(); ui.svg.focus();
  }
  const snapMM = v => Math.round(v * 10) / 10;
  function down(e) {
    if (e.button === 1 || (e.button === 0 && S.space)) { S.drag = { kind: 'pan', x: e.clientX, y: e.clientY }; ui.svg.setPointerCapture(e.pointerId); return; }
    if (e.button !== 0) return;
    const m = toMM(e);
    if (S.tool === 'pen') { penDown(m, e); ui.svg.setPointerCapture(e.pointerId); return; }
    if (S.tool === 'text') { placeText(m); return; }
    if (S.tool === 'rect' || S.tool === 'ellipse') { S.drag = { kind: 'shape', at: [snapMM(m[0]), snapMM(m[1])] }; ui.svg.setPointerCapture(e.pointerId); return; }
    // a second press soon and near: a double-click (the board redraws on every
    // press, so the browser's own dblclick never sees the same element twice)
    const last = S.lastDown, now = performance.now();
    S.lastDown = { t: now, x: e.clientX, y: e.clientY };
    if (last && now - last.t < 400 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 6 && S.sel >= 0 && !(e.target.dataset && e.target.dataset.pt)) { S.lastDown = null; dbl(e); return; }
    const t = e.target, pt = t.dataset && t.dataset.pt, pi = t.dataset && t.dataset.part;
    if (pt) {
      if (e.shiftKey) { S.pts.has(pt) ? S.pts.delete(pt) : S.pts.add(pt); render(); return; }
      if (!S.pts.has(pt)) S.pts = new Set([pt]);
      snap();
      S.smooth = S.pts.size === 1 ? smoothPair(S.parts[S.sel], pt) : null;
      S.drag = { kind: 'pts', at: m, moved: false };
    } else if (pi !== undefined) {
      const i = +pi;
      if (i !== S.sel) { S.sel = i; S.pts.clear(); }
      else if (!e.shiftKey) S.pts.clear();
      snap();
      S.drag = { kind: 'part', at: m, moved: false };
    } else {
      if (S.sel >= 0) S.drag = { kind: 'box', at: m, shift: e.shiftKey };
      else { S.pts.clear(); }
      if (!S.drag) render();
    }
    ui.svg.setPointerCapture(e.pointerId);
    render();
  }
  function move(e) {
    const m = toMM(e);
    const d = S.drag;
    if (S.tool === 'pen') {
      const q = [snapMM(m[0]), snapMM(m[1])];
      // dragging out from the point just placed: its handle, mirrored behind it
      if (d && d.kind === 'penh') {
        const a = S.pen[d.i];
        if (Math.hypot(q[0] - a.p[0], q[1] - a.p[1]) * S.k >= 3) a.h = q;
        else a.h = null;
        render(); say(a.h ? 'a smooth point: let go to keep its curve' : '');
        return;
      }
      S.hover = q; render(); say(`${r3(q[0])}, ${r3(q[1])} mm`);
      return;
    }
    if (S.tool === 'text' && TEXT.font) {
      const c = textCurves({ str: TEXT.str, h: TEXT.h, at: [snapMM(m[0]), snapMM(m[1])] });
      S.ghostText = c; render(); return;
    }
    if (!d) return;
    if (d.kind === 'shape') {
      let b = [snapMM(m[0]), snapMM(m[1])];
      if (e.shiftKey) { const s = Math.max(Math.abs(b[0] - d.at[0]), Math.abs(b[1] - d.at[1])); b = [d.at[0] + Math.sign(b[0] - d.at[0] || 1) * s, d.at[1] + Math.sign(b[1] - d.at[1] || 1) * s]; }
      d.to = b;
      const w = Math.abs(b[0] - d.at[0]), h = Math.abs(b[1] - d.at[1]);
      S.ghost = w > 0 && h > 0 ? shapeCrv(S.tool, d.at, b) : null;
      render(); say(`${r3(w)} × ${r3(h)} mm`);
      return;
    }
    if (d.kind === 'pan') { S.ox += e.clientX - d.x; S.oy += e.clientY - d.y; d.x = e.clientX; d.y = e.clientY; render(); return; }
    if (d.kind === 'box') { S.box = [d.at, m]; render(); return; }
    const part = S.parts[S.sel];
    let dx = m[0] - d.at[0], dy = m[1] - d.at[1];
    if (!d.moved && Math.hypot(dx, dy) * S.k < 3) return;
    // whole tenths of a millimetre from where the drag began
    dx = snapMM(dx); dy = snapMM(dy);
    if (!dx && !dy) return;
    if (d.kind === 'pts') { shiftPts(part, [...S.pts], dx, dy); keepSmooth(part); }
    else { for (const c of part.curves) for (const P of c.crv.ctrlPts) { P[0] += dx; P[1] += dy; } if (part.text) part.text.at = [part.text.at[0] + dx, part.text.at[1] + dy]; part.dirty = true; }
    d.at = [d.at[0] + dx, d.at[1] + dy];
    d.moved = true;
    render();
  }
  function up(e) {
    const d = S.drag;
    S.drag = null;
    if (!d) return;
    if (d.kind === 'penh') { render(); return; }
    if (d.kind === 'shape') {
      S.ghost = null;
      const b = d.to;
      if (!b || Math.abs(b[0] - d.at[0]) < 1 || Math.abs(b[1] - d.at[1]) < 1) { say('Drag farther: a shape needs to be at least 1 mm each way.'); render(); return; }
      addPart(S.tool === 'rect' ? 'rectangle' : 'ellipse', shapeCrv(S.tool, d.at, b));
      return;
    }
    if ((d.kind === 'pts' || d.kind === 'part') && !d.moved) S.undo.pop();          // a click, not a move
    if (d.kind === 'box') {
      const part = S.parts[S.sel], b = S.box;
      S.box = null;
      if (!b) { S.sel = -1; S.pts.clear(); render(); return; }   // a click on the empty bed
      if (!d.shift) S.pts.clear();
      const x0 = Math.min(b[0][0], b[1][0]), x1 = Math.max(b[0][0], b[1][0]), y0 = Math.min(b[0][1], b[1][1]), y1 = Math.max(b[0][1], b[1][1]);
      for (const h of handles(part)) if (h.anchor && h.x >= x0 && h.x <= x1 && h.y >= y0 && h.y <= y1) S.pts.add(h.id);
    }
    render();
  }
  function penDown(m) {
    const q = [snapMM(m[0]), snapMM(m[1])];
    if (S.pen.length >= 3 || (S.pen.length >= 2 && S.pen.some(q => q.h))) {
      const f = S.pen[0].p;
      if (Math.hypot(sx(f[0]) - sx(q[0]), sy(f[1]) - sy(q[1])) <= HIT + 3) return penClose();
    }
    const l = S.pen[S.pen.length - 1];
    if (l && l.p[0] === q[0] && l.p[1] === q[1]) return;
    S.pen.push({ p: q, h: null });
    S.drag = { kind: 'penh', i: S.pen.length - 1 };
    render();
  }
  // the pen's points as cubic pieces: a smooth point's handle on its way out,
  // mirrored on its way in; a corner's handles a third of the way along its edge
  function penPieces(pen, closed) {
    const n = pen.length, out = [];
    const third = (a, b) => [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3];
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = pen[i], b = pen[(i + 1) % n];
      const o = a.h || third(a.p, b.p);
      const inb = b.h ? [2 * b.p[0] - b.h[0], 2 * b.p[1] - b.h[1]] : third(b.p, a.p);
      out.push([a.p, o, inb, b.p]);
    }
    return out;
  }
  function penClose() {
    if (S.pen.length < 3 && !S.pen.some(q => q.h)) { say('An outline needs at least three corners, or a smooth point.'); return; }
    if (S.pen.length < 2) { say('An outline needs at least two points.'); return; }
    const pen = S.pen;
    const crv = pen.some(q => q.h)
      ? V().bezierChainCrv(penPieces(pen, true))
      : V().polyCrv(pen.map(q => q.p), true);
    // the chain must end exactly where it began
    const P = crv.ctrlPts; P[P.length - 1] = P[0].slice();
    S.drag = null;
    addPart('drawing', crv);
  }
  // a rectangle, or an ellipse as four exact rational arcs, in the box from a to b
  function shapeCrv(tool, a, b) {
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    if (tool === 'rect') return V().polyCrv([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2, w = Math.SQRT1_2;
    const P = [[cx + rx, cy, 1], [cx + rx, cy + ry, w], [cx, cy + ry, 1], [cx - rx, cy + ry, w], [cx - rx, cy, 1], [cx - rx, cy - ry, w], [cx, cy - ry, 1], [cx + rx, cy - ry, w], [cx + rx, cy, 1]];
    return { degree: 2, knots: [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4], ctrlPts: P.map(([x, y, wt]) => [x, y, 0, wt]) };
  }
  // ── text: real glyph outlines ──
  const TEXT = { str: 'swarf', h: 30, font: null, name: 'Russo One' };
  function loadScript(src) {
    return new Promise((res, rej) => { const el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = () => rej(new Error(`${src} did not load`)); document.head.append(el); });
  }
  async function fontReady() {
    if (TEXT.font) return TEXT.font;
    if (!window.opentype) await loadScript('vendor/opentype/opentype.min.js');
    for (const u of ['moto/russo-one.ttf', '../moto/russo-one.ttf']) {
      try { const r = await fetch(u); if (r.ok) { TEXT.font = window.opentype.parse(await r.arrayBuffer()); return TEXT.font; } } catch (e) { /* the next place */ }
    }
    throw new Error('the built-in font did not load');
  }
  // the words as closed curves in board mm, the first letter's baseline starting at `at`,
  // capitals `h` mm tall
  function textCurves(t) {
    const f = TEXT.font;
    if (!f || !t.str.trim()) return [];
    const os2 = f.tables.os2;
    const cap = (os2 && os2.sCapHeight) || (g => g.y2 - g.y1)(f.charToGlyph('H').getBoundingBox()) || f.unitsPerEm * 0.7;
    const path = f.getPath(t.str, t.at[0], -t.at[1], t.h * f.unitsPerEm / cap);
    const d = path.toPathData(4);
    if (!d) return [];
    const b = path.getBoundingBox(), W = Math.max(1e-3, b.x2 - b.x1), H = Math.max(1e-3, b.y2 - b.y1);
    return V().curves(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="${b.x1} ${b.y1} ${W} ${H}"><path d="${d}"/></svg>`).filter(c => isClosed(c.crv));
  }
  async function placeText(m) {
    try { await fontReady(); } catch (e) { say(`Text needs its font: ${e.message}.`); return; }
    const t = { str: TEXT.str, h: TEXT.h, at: [snapMM(m[0]), snapMM(m[1])], font: TEXT.name };
    const curves = textCurves(t);
    if (!curves.length) { say('Type some letters in the card first.'); return; }
    snap();
    const n = S.parts.filter(p => !p.w).length + 1;
    S.parts.push({ w: null, name: `text-${n}`, thick: S.thick, edge: { ...S.edge }, curves, text: t, dirty: true });
    S.tool = 'select'; S.sel = S.parts.length - 1; S.pts.clear(); S.ghost = null;
    say('Text placed. Change its words or height in the card; drag it to move it.');
    render();
  }
  function addPart(word, crv) {
    snap();
    const n = S.parts.filter(p => !p.w).length + 1;
    S.parts.push({ w: null, name: `${word}-${n}`, thick: S.thick, edge: { ...S.edge }, curves: [{ crv }], dirty: true });
    S.pen = []; S.hover = null; S.tool = 'select'; S.sel = S.parts.length - 1; S.pts.clear();
    say('Made. Drag its points to shape it, or press done to make it a part.');
    render();
  }
  // a smooth point stays smooth: turning one handle turns the other the opposite way, keeping its length
  function keepSmooth(part) {
    if (S.pts.size !== 1 || !S.smooth) return;
    const { ci, o, a, len } = S.smooth, P = part.curves[ci].crv.ctrlPts, h = P[[...S.pts][0].split(':').map(Number)[1]];
    const dx = h[0] - P[a][0], dy = h[1] - P[a][1], l = Math.hypot(dx, dy);
    if (!(l > 1e-9)) return;
    P[o][0] = P[a][0] - dx / l * len; P[o][1] = P[a][1] - dy / l * len;
  }
  // when one handle is picked: its anchor and the handle across it, if the two are in line
  function smoothPair(part, id) {
    const [ci, i] = id.split(':').map(Number), crv = part.curves[ci].crv, P = crv.ctrlPts, n = P.length, p = crv.degree;
    if (!isChain(crv) || p < 2 || i % p === 0) return null;
    const closed = isClosed(crv);
    let a, o;
    if (i % p === 1) { a = i - 1; o = a - 1; if (o < 0) o = closed ? n - 2 : -1; }
    else { a = i + 1; o = a + 1; if (o >= n) o = closed ? 1 : n; }
    if (o < 0 || o >= n) return null;
    const ux = P[i][0] - P[a][0], uy = P[i][1] - P[a][1], vx = P[a][0] - P[o][0], vy = P[a][1] - P[o][1];
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (!(lu > 1e-9 && lv > 1e-9) || (ux * vx + uy * vy) / (lu * lv) < Math.cos(2 * Math.PI / 180)) return null;
    return { ci, o, a, len: lv };
  }
  function wheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {                 // pinch or ⌘-wheel: zoom about the cursor
      const r = ui.svg.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const f = Math.exp(-e.deltaY * 0.01), k = Math.max(0.05, Math.min(200, S.k * f));
      S.ox = px - (px - S.ox) * k / S.k; S.oy = py - (py - S.oy) * k / S.k; S.k = k;
    } else { S.ox -= e.deltaX; S.oy -= e.deltaY; }   // two fingers: slide
    render();
  }
  function key(e) {
    if (!S) return;
    const typing = e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName);
    if (typing) return;
    e.stopPropagation();
    const k = e.key;
    if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (k === ' ') { if (S.space) { e.preventDefault(); return; } S.space = true; e.preventDefault(); window.addEventListener('keyup', function u(ev) { if (ev.key === ' ') { S && (S.space = false); window.removeEventListener('keyup', u, true); } }, true); return; }
    if (k === 'Escape') {
      e.preventDefault();
      if (S.pen.length) { S.pen = []; render(); return; }
      if (S.tool !== 'select') { setTool('select'); return; }
      if (S.pts.size) { S.pts.clear(); render(); return; }
      if (S.sel >= 0) { S.sel = -1; render(); return; }
      close(false); return;
    }
    if (k === 'Enter' && S.tool === 'pen' && S.pen.length) { e.preventDefault(); penClose(); return; }
    if (k === 'v' || k === 'V') { setTool('select'); return; }
    if (k === 'f' || k === 'F') { fit(!S.whole); render(); return; }
    if (k === 'p' || k === 'P') { setTool('pen'); return; }
    if (k === 'r' || k === 'R') { setTool('rect'); return; }
    if (k === 'e' || k === 'E') { setTool('ellipse'); return; }
    if (k === 't' || k === 'T') { setTool('text'); return; }
    if ((k === 'Delete' || k === 'Backspace') && S.tool === 'select') { e.preventDefault(); deletePts(); return; }
    if (k === 'Backspace' && S.tool === 'pen' && S.pen.length) { e.preventDefault(); S.pen.pop(); render(); return; }
    const ar = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[k];
    const part = S.parts[S.sel];
    if (ar && part) {
      e.preventDefault();
      const s = e.shiftKey ? 10 : 1;
      snap();
      if (S.pts.size) shiftPts(part, [...S.pts], ar[0] * s, ar[1] * s);
      else { for (const c of part.curves) for (const P of c.crv.ctrlPts) { P[0] += ar[0] * s; P[1] += ar[1] * s; } part.dirty = true; }
      render();
    }
  }

  // ── done: each changed part rebuilt from its drawing, where it was drawn ──
  function commit() {
    const a = api();
    const changed = S.parts.filter(p => p.dirty || p.gone);
    if (!changed.length) return;
    // parts stay where they were drawn: auto layout would repack them
    if (a.ui.autoLayout && a.ui.autoLayout.checked) { a.ui.autoLayout.checked = false; a.ui.autoLayout.dispatchEvent(new Event('change')); }
    const open = [], made = [], failed = [];
    for (const p of changed) {
      if (p.gone) { if (p.w) a.platform.delete(p.w); continue; }
      const closed = p.curves.filter(c => isClosed(c.crv));
      if (closed.length < p.curves.length) open.push(p.name);
      if (!closed.length) continue;
      const svg = V().svgOf(closed);
      const ws = a.platform.load_svg(svg, p.name.replace(/\.(svg|dxf|ai|pdf)$/i, ''), { depth: p.thick, resolution: 2, segmin: 48, soup: true, dpi: 0, place: true, edge: p.edge });
      if (!ws.length) { failed.push(`${p.name}: ${ws.error || 'swarf could not make it from its drawing. Is the outline crossing itself?'}`); continue; }
      if (p.w) a.platform.delete(p.w);
      made.push(...ws);
    }
    if (made.length) a.platform.select(made[0]);
    const n = made.length;
    if (failed.length) { a.show.alert(`Not changed: ${failed.join(' ')}`, 12); return; }
    a.show.alert(open.length ? `${open.join(', ')}: open lines were left out (only closed outlines get a thickness).` : `${n} part${n === 1 ? '' : 's'} rebuilt from the drawing. Next: a step (${made.some(w => w.meta.edge) ? 'contour shapes the edge, outline cuts it out' : 'outline cuts it out'}), then toolpaths.`, 8);
  }

  // ── wiring ──
  let tries = 0;
  const t = setInterval(() => {
    const a = api(), step = $('swarf-step-draw');
    if ((a && a.event && step) || ++tries > 200) {
      clearInterval(t);
      if (!a || !a.event) return;
      a.event.on('widget.scale', ({ widget, x, y }) => track(widget, [x || 1, 0, 0, y || 1]));
      a.event.on('widget.rotate', onRotate);
      a.event.on('widget.mirror', ({ widget }) => track(widget, [-1, 0, 0, 1]));
      if (step && !step.dataset.wired) { step.dataset.wired = '1'; step.addEventListener('click', open); }
    }
  }, 150);

  window.__swarfDraw = { open, close, bedCurves, state: () => S, isChain, text: TEXT };
})();
