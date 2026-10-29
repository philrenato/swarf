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
  // lengths in cam's units (swarf-length.js); with it missing, millimeters as before
  const LEN = {
    unit: () => (window.SwarfLength ? window.SwarfLength.unit() : 'mm'),
    fld: v => (window.SwarfLength ? window.SwarfLength.show(v) : String(v)),
    parse: t => (window.SwarfLength ? window.SwarfLength.parse(t) : parseFloat(t)),
    say: v => (window.SwarfLength ? window.SwarfLength.say(v) : `${+(+v).toFixed(2)} mm`)
  };
  const api = () => window.kiri && window.kiri.api;
  const V = () => window.SwarfVector;
  const $ = id => document.getElementById(id);
  // a typed length is held to a thousandth of a mm; a field refuses one that rounds under its floor (torture test 10-29: 0.0004 became 0)
  const r3 = v => +(+v).toFixed(3);
  const THICK = 'swarf-draw-thick';
  const HIT = 7;                                 // px: how near a press must be to a point

  // ── a part's 2D transform, kept as cam changes it ──
  const mul = (A, B) => [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3]];
  // cam bakes each scale / turn / mirror into the mesh, then re-centers it on
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
  // the drawing as it sits on the bed: centered on c0, through xf, at the part's place
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
    else {                                       // a part from before r37: center the drawing on the part's place
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
        <button data-tool="select" title="pick parts and points (V)">select <kbd>V</kbd></button>
        <button data-tool="pen" title="draw an outline: click for a corner, drag for a smooth point, click the first to close (P)">pen <kbd>P</kbd></button>
        <button data-tool="rect" title="drag a rectangle from corner to corner; shift for a square (R)">rectangle <kbd>R</kbd></button>
        <button data-tool="ellipse" title="drag an ellipse from corner to corner; shift for a circle (E)">ellipse <kbd>E</kbd></button>
        <button data-tool="text" title="type the words in the card, then click where they start (T)">text <kbd>T</kbd></button>
        <span class="sd-sep"></span>
        <button id="sd-undo" title="undo (⌘Z)">undo</button>
        <button id="sd-fit" title="show the parts, or the whole bed (F) · pinch or ⌘-scroll to zoom, two fingers to slide">fit</button>
        <span class="sd-grow"></span>
        <button id="sd-cancel" title="close without changing the parts (Esc twice)">cancel</button>
        <button id="sd-done" class="sd-go" title="rebuild the changed parts and close">done</button>
      </div>
      <div class="sd-card" id="sd-card"></div>
      <p class="sd-say" id="sd-say"></p>`;
    (document.getElementById("app") || document.body).append(el);   // inside #app, so the menus open over draw (as over control)
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
    // cam's own letter keys listen for keypress (r opened recent files, e the machine dialog):
    // none of them reach cam while drawing
    window.addEventListener('keypress', hush, true);
    window.addEventListener('resize', render);
    ui.svg.focus();
  }

  const hush = e => e.stopPropagation();
  function close(apply) {
    if (!S) return;
    if (apply) {
      const bad = S.parts.find(p => !p.gone && p.dirty && checkCross(p));
      if (bad) { S.sel = S.parts.indexOf(bad); render(); say(crossSay(bad, bad.cross) + ' Then press done.'); return; }
      commit();
    }
    window.removeEventListener('keydown', key, true);
    window.removeEventListener('keypress', hush, true);
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
    // the ground (review 10-28: "no bed, origin, scale or units"): the bed's size in its
    // corner, the origin, and a scale bar of a round length about 100 px long
    out.push(`<text class="sd-lab" x="${sx(-bw / 2) + 6}" y="${sy(bd / 2) + 14}">bed ${Math.round(bw)} × ${Math.round(bd)} mm</text>`);
    out.push(`<path class="sd-origin" d="M${sx(0) - 8},${sy(0)}H${sx(0) + 8}M${sx(0)},${sy(0) - 8}V${sy(0) + 8}"/><text class="sd-lab" x="${sx(0) + 6}" y="${sy(0) + 14}">0, 0</text>`);
    {
      const r = ui.svg.getBoundingClientRect(), want = 100 / k;
      const len = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].find(v => v >= want * 0.6) || 2000;
      const x = 20, y = (r.height || window.innerHeight) - 46;
      out.push(`<path class="sd-scale" d="M${x},${y - 4}V${y}H${x + len * k}V${y - 4}"/><text class="sd-lab" x="${x}" y="${y - 8}">${len >= 1000 ? len / 1000 + ' m' : len + ' mm'}</text>`);
    }
    for (const o of S.others) out.push(`<rect class="sd-other" x="${sx(o[0])}" y="${sy(o[3])}" width="${(o[2] - o[0]) * k}" height="${(o[3] - o[1]) * k}"><title>${o[4]}: no drawing to edit</title></rect>`);
    // wider places to press (review 10-28 #12), under the parts so a press on a part wins:
    // near any outline picks its part, and so does anywhere in a word's box (inside an o, between letters)
    S.parts.forEach((part, pi) => {
      if (part.gone || pi === S.sel) return;
      if (part.text) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const c of part.curves) for (const q of c.crv.ctrlPts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
        if (isFinite(x0)) out.push(`<rect class="sd-hit" data-part="${pi}" x="${sx(x0) - 4}" y="${sy(y1) - 4}" width="${(x1 - x0) * k + 8}" height="${(y1 - y0) * k + 8}"/>`);
      }
      out.push(`<path class="sd-near" data-part="${pi}" d="${part.curves.map(c => pathOf(c.crv)).join(' ')}"/>`);
    });
    S.parts.forEach((part, pi) => {
      if (part.gone) return;
      const d = part.curves.map(c => pathOf(c.crv)).join(' ');
      out.push(`<path class="sd-part${pi === S.sel ? ' on' : ''}${part.cross || part.over ? ' cross' : ''}" data-part="${pi}" d="${d}"/>`);
      if (part.cross) out.push(`<circle class="sd-cross" cx="${sx(part.cross[0])}" cy="${sy(part.cross[1])}" r="7"/>`);
      // a wide, unseen edge, so a press near the outline (to add a point) lands on the part
      if (pi === S.sel) out.push(`<path class="sd-edge" data-part="${pi}" d="${d}"/>`);
    });
    const part = S.parts[S.sel];
    // a picked word shows its box, not every letter's points: it is edited by its words (review 10-28b #11)
    if (part && !part.gone && part.text) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const c of part.curves) for (const q of c.crv.ctrlPts) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
      out.push(`<rect class="sd-wordbox" data-part="${S.sel}" x="${sx(x0) - 6}" y="${sy(y1) - 6}" width="${(x1 - x0) * k + 12}" height="${(y1 - y0) * k + 12}"/>`);
    }
    if (part && !part.gone && !part.text) {
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
      // unseen rings round the points, so a press a few pixels off still takes one; under
      // the points themselves, so a press right on a point never goes to a crowding neighbor
      const H = handles(part);
      for (const h of H) out.push(`<circle class="sd-pthit" data-pt="${h.id}" cx="${sx(h.x)}" cy="${sy(h.y)}" r="${h.anchor ? 9 : 7}"/>`);
      for (const h of H) {
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

  // where an outline crosses itself, or null (review 10-28 #11): cam cannot tell inside from
  // outside past a crossing. Each closed curve on its own, as a fine polyline.
  function polyOf(crv) {
    const L = [];
    for (const b of V().cubics(crv)) for (let i = L.length ? 1 : 0; i <= 8; i++) {
      const t = i / 8, u = 1 - t;
      L.push([u * u * u * b[0][0] + 3 * u * u * t * b[1][0] + 3 * u * t * t * b[2][0] + t * t * t * b[3][0],
              u * u * u * b[0][1] + 3 * u * u * t * b[1][1] + 3 * u * t * t * b[2][1] + t * t * t * b[3][1]]);
    }
    return L;
  }
  const segX = (a, b, q, r) => {
    const d = (b[0] - a[0]) * (r[1] - q[1]) - (b[1] - a[1]) * (r[0] - q[0]);
    if (Math.abs(d) < 1e-12) return false;
    const s = ((q[0] - a[0]) * (r[1] - q[1]) - (q[1] - a[1]) * (r[0] - q[0])) / d, t = ((q[0] - a[0]) * (b[1] - a[1]) - (q[1] - a[1]) * (b[0] - a[0])) / d;
    return s >= 0 && s <= 1 && t >= 0 && t <= 1;
  };
  const inside = (p, L) => { let n = false; for (let i = 0, j = L.length - 1; i < L.length; j = i++) if ((L[i][1] > p[1]) !== (L[j][1] > p[1]) && p[0] < (L[j][0] - L[i][0]) * (p[1] - L[i][1]) / (L[j][1] - L[i][1]) + L[i][0]) n = !n; return n; };
  // the first other part this one overlaps (outlines cross, or one sits inside the other), or null
  // (review 10-28b #5: a rectangle drawn over a part became a solid inside it, and both were cut)
  function overlapOf(part) {
    const mine = part.curves.map(c => polyOf(c.crv)), mb = boxOf(part.curves);
    for (const o of S.parts) {
      if (o === part || o.gone) continue;
      const ob = boxOf(o.curves);
      if (ob[0] > mb[2] || mb[0] > ob[2] || ob[1] > mb[3] || mb[1] > ob[3]) continue;
      const theirs = o.curves.map(c => polyOf(c.crv));
      for (const A of mine) for (const B of theirs) {
        if (inside(A[0], B) || inside(B[0], A)) return o;
        for (let i = 0; i < A.length - 1; i++) for (let j = 0; j < B.length - 1; j++) if (segX(A[i], A[i + 1], B[j], B[j + 1])) return o;
      }
    }
    return null;
  }
  function crossing(part) {
    for (const c of part.curves) {
      const L = polyOf(c.crv);
      for (let i = L.length - 1; i > 0; i--) if (Math.hypot(L[i][0] - L[i - 1][0], L[i][1] - L[i - 1][1]) < 1e-9) L.splice(i, 1);
      const n = L.length - 1;
      for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;                 // the closing pair share a point
        const [a, b2] = [L[i], L[i + 1]], [q, r] = [L[j], L[j + 1]];
        const d = (b2[0] - a[0]) * (r[1] - q[1]) - (b2[1] - a[1]) * (r[0] - q[0]);
        if (Math.abs(d) < 1e-12) continue;
        const s = ((q[0] - a[0]) * (r[1] - q[1]) - (q[1] - a[1]) * (r[0] - q[0])) / d;
        const t = ((q[0] - a[0]) * (b2[1] - a[1]) - (q[1] - a[1]) * (b2[0] - a[0])) / d;
        // half-open, so a crossing that falls right on a sample is still seen
        if (s >= 0 && s < 1 - 1e-9 && t >= 0 && t < 1 - 1e-9) return [a[0] + s * (b2[0] - a[0]), a[1] + s * (b2[1] - a[1])];
      }
    }
    return null;
  }
  const crossSay = (part, x) => `${part.name} crosses itself near ${LEN.unit() === 'in' ? `${LEN.fld(x[0])}, ${LEN.fld(x[1])} in` : `${r3(x[0])}, ${r3(x[1])} mm`}: past a crossing, swarf cannot tell inside from outside. Move a point so its lines don't cross.`;
  function checkCross(part) {
    part.cross = part.text ? null : crossing(part);
    if (part.cross) say(crossSay(part, part.cross));
    const o = overlapOf(part);
    part.over = o ? o.name : null;
    if (o && !part.cross) say(`${part.name} overlaps ${o.name}: move it, or the toolpaths will cut them as one.`);
    return part.cross;
  }

  // the card: what is picked, its numbers, typeable
  function card() {
    const part = S.parts[S.sel];
    // a length row shows and reads cam's units (swarf-length.js: 3/4, 1 1/2", 19 mm); the part stays in mm
    const row = (word, id, v, unit) => unit === 'mm'
      ? `<div class="sd-row"><span>${word}</span><input id="${id}" value="${LEN.fld(v)}" inputmode="text" data-len="1"><span class="u">${LEN.unit()}</span></div>`
      : `<div class="sd-row"><span>${word}</span><input id="${id}" value="${v}" inputmode="decimal"><span class="u">${unit}</span></div>`;
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
    const rd = el => (el.dataset.len ? LEN.parse(el.value) : parseFloat(el.value));
    const num = (id, fn) => { const el = $(id); if (!el) return; el.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') { fn(rd(el), el); el.blur(); } if (e.key === 'Escape') { render(); ui.svg.focus(); } }; el.onchange = () => fn(rd(el), el); };
    num('sd-t', v => { if (!(r3(v) >= 0.1)) return say('Give the thickness at least 0.1 mm.'); if (v === part.thick) return; snap(); part.thick = r3(v); part.dirty = true; render(); });
    // the top edge: the pen's next outline, or the picked part
    const E = S.tool !== 'select' ? S.edge : part && part.edge;
    const sel = $('sd-edge');
    if (sel && E) sel.onchange = () => { if (S.tool === 'select') { snap(); part.dirty = true; } E.kind = sel.value; render(); edgeSay(); };
    num('sd-es', v => { if (!(r3(v) >= 0.1)) return say('Give the edge size at least 0.1 mm.'); if (!E || v === E.size) return; if (S.tool === 'select') { snap(); part.dirty = true; } E.size = r3(v); render(); edgeSay(); });
    num('sd-pen-t', v => { if (r3(v) >= 0.1) { S.thick = r3(v); try { localStorage.setItem(THICK, String(S.thick)); } catch (e) { /* private */ } } });
    num('sd-px', v => { if (!isFinite(v)) return; const [ci, i] = [...S.pts][0].split(':').map(Number), P = part.curves[ci].crv.ctrlPts[i]; if (v === r3(P[0])) return; snap(); shiftPts(part, [...S.pts], v - P[0], 0); render(); });
    num('sd-py', v => { if (!isFinite(v)) return; const [ci, i] = [...S.pts][0].split(':').map(Number), P = part.curves[ci].crv.ctrlPts[i]; if (v === r3(P[1])) return; snap(); shiftPts(part, [...S.pts], 0, v - P[1]); render(); });
    // width / depth: the whole part stretched about its center to that size
    const size = (axis, v) => {
      if (!(v > 0)) return say('Give the size a length above 0.');
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
        snap(); part.text = t; part.curves = c; part.dirty = true;
        if (part.named) part.name = wordName(str, part.name);
        render();
      };
      strEl.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') { strEl.blur(); } };
      strEl.oninput = () => { if (S.tool === 'text') TEXT.str = strEl.value; };
      strEl.onchange = () => setText(strEl.value, S.tool === 'text' ? TEXT.h : part.text.h);
      num('sd-th', v => { if (!(r3(v) >= 1)) return say('Give the letters at least 1 mm of height.'); setText(S.tool === 'text' ? TEXT.str : part.text.str, r3(v)); });
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
    say(why || `A ${LEN.say(part.edge.size)} ${part.edge.kind} fits. Press done to shape it.`);
  }
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function say(t) { const el = $('sd-say'); if (el) el.textContent = t || ''; }

  // ── edits ──
  function snap() { S.undo.push(JSON.stringify({ parts: S.parts.map(p => ({ ...p, w: null })), sel: S.sel, pts: [...S.pts] })); if (S.undo.length > 200) S.undo.shift(); }
  function undo() {
    if (S.dropped && !S.pen.length) { const d = S.dropped; S.dropped = null; setTool('pen'); S.pen = d; say('The open outline is back. Click its first point to close it.'); render(); return; }
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
  // scale / turn the picked points about their center, or the whole part about its center
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
  // an outline left open by a tool switch or Escape is kept for undo, and said (Fable review 3 #16)
  function dropPen() {
    if (S.pen.length < 2) { S.pen = []; return false; }
    S.dropped = S.pen.slice(); S.pen = [];
    say('The open outline was dropped: ⌘Z brings it back.');
    return true;
  }
  function setTool(t) {
    const had = S.tool === 'pen' && t !== 'pen' && dropPen();
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
      S.hover = q; render(); say(LEN.unit() === 'in' ? `${LEN.fld(q[0])}, ${LEN.fld(q[1])} in` : `${r3(q[0])}, ${r3(q[1])} mm`);
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
      render(); say(`${LEN.say(w)} × ${LEN.say(h)}`);
      return;
    }
    if (d.kind === 'pan') { S.ox += e.clientX - d.x; S.oy += e.clientY - d.y; d.x = e.clientX; d.y = e.clientY; render(); return; }
    if (d.kind === 'box') { S.box = [d.at, m]; render(); return; }
    const part = S.parts[S.sel];
    let dx = m[0] - d.at[0], dy = m[1] - d.at[1];
    if (!d.moved && Math.hypot(dx, dy) * S.k < 3) return;
    // whole tenths of a millimeter from where the drag began
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
      if (!b || Math.abs(b[0] - d.at[0]) < 1 || Math.abs(b[1] - d.at[1]) < 1) { say(`Drag farther: a shape needs to be at least ${LEN.unit() === 'in' ? '1 mm (0.04 in)' : '1 mm'} each way.`); render(); return; }
      addPart(S.tool === 'rect' ? 'rectangle' : 'ellipse', shapeCrv(S.tool, d.at, b));
      return;
    }
    if ((d.kind === 'pts' || d.kind === 'part') && !d.moved) S.undo.pop();          // a click, not a move
    if ((d.kind === 'pts' || d.kind === 'part') && d.moved && S.parts[S.sel]) { checkCross(S.parts[S.sel]); for (const p of S.parts) if (p !== S.parts[S.sel] && p.over) p.over = overlapOf(p) ? p.over : null; }
    if (d.kind === 'box') {
      const part = S.parts[S.sel], b = S.box;
      S.box = null;
      if (!b) { S.sel = -1; S.pts.clear(); render(); return; }   // a click on the empty bed
      if (!d.shift) S.pts.clear();
      const x0 = Math.min(b[0][0], b[1][0]), x1 = Math.max(b[0][0], b[1][0]), y0 = Math.min(b[0][1], b[1][1]), y1 = Math.max(b[0][1], b[1][1]);
      if (!part.text) for (const h of handles(part)) if (h.anchor && h.x >= x0 && h.x <= x1 && h.y >= y0 && h.y <= y1) S.pts.add(h.id);
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
  // a word is named by its words, so the list reads "HIM (3 pieces)" (review 10-28b #9)
  const wordName = (str, or) => (String(str).trim().replace(/\s+/g, '-').replace(/[^\w.-]/g, '').slice(0, 24)) || or;
  async function placeText(m) {
    try { await fontReady(); } catch (e) { say(`Text needs its font: ${e.message}.`); return; }
    const t = { str: TEXT.str, h: TEXT.h, at: [snapMM(m[0]), snapMM(m[1])], font: TEXT.name };
    const curves = textCurves(t);
    if (!curves.length) { say('Type some letters in the card first.'); return; }
    snap();
    const n = S.parts.filter(p => !p.w).length + 1;
    S.parts.push({ w: null, name: wordName(t.str, `text-${n}`), named: true, thick: S.thick, edge: { ...S.edge }, curves, text: t, dirty: true });
    S.tool = 'select'; S.sel = S.parts.length - 1; S.pts.clear(); S.ghost = null;
    say('Text placed. Change its words or height in the card; drag it to move it.');
    checkCross(S.parts[S.sel]);
    render();
  }
  function addPart(word, crv) {
    snap();
    const n = S.parts.filter(p => !p.w).length + 1;
    S.parts.push({ w: null, name: `${word} ${n}`, thick: S.thick, edge: { ...S.edge }, curves: [{ crv }], dirty: true });
    S.pen = []; S.hover = null; S.tool = 'select'; S.sel = S.parts.length - 1; S.pts.clear();
    if (S.parts.length === 1 && !S.others.length) fit();   // Fable review 3 #19: the first drawing, not a fingernail on a 2.4 m bed
    say('Made. Drag its points to shape it, or press done to make it a part.');
    checkCross(S.parts[S.sel]);
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
    // typing in a field: the field's own keys (cam's shortcuts skip a focused select too, keyboard.js)
    if (typing) return;
    e.stopPropagation();
    const k = e.key;
    if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (k === ' ') { if (S.space) { e.preventDefault(); return; } S.space = true; e.preventDefault(); window.addEventListener('keyup', function u(ev) { if (ev.key === ' ') { S && (S.space = false); window.removeEventListener('keyup', u, true); } }, true); return; }
    if (k === 'Escape') {
      e.preventDefault();
      if (S.pen.length) { dropPen(); render(); return; }
      if (S.tool !== 'select') { setTool('select'); return; }
      if (S.pts.size) { S.pts.clear(); render(); return; }
      if (S.sel >= 0) { S.sel = -1; render(); return; }
      // the last Escape leaves, but never throws away drawing without asking (review 10-28b #18)
      if (S.parts.some(p => p.dirty || (p.gone && p.w)) && !(S.escAt && performance.now() - S.escAt < 3000)) {
        S.escAt = performance.now();
        say('Press Escape again to leave without your changes, or done to make them.');
        return;
      }
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
    let fresh = false;
    const changed = S.parts.filter(p => p.dirty || p.gone);
    if (!changed.length) return;
    // parts stay where they were drawn: auto layout would repack them
    if (a.ui.autoLayout && a.ui.autoLayout.checked) { a.ui.autoLayout.checked = false; a.ui.autoLayout.dispatchEvent(new Event('change')); }
    const open = [], made = [], failed = [], adapted = [];
    let built = 0;
    for (const p of changed) {
      if (p.gone) { if (p.w) a.platform.delete(p.w); p.w = null; continue; }
      const closed = p.curves.filter(c => isClosed(c.crv));
      if (closed.length < p.curves.length) open.push(p.name);
      if (!closed.length) continue;
      const svg = V().svgOf(closed);
      const nm = p.name.replace(/\.(svg|dxf|ai|pdf)$/i, '');
      let ws = a.platform.load_svg(svg, nm, { depth: p.thick, resolution: 2, segmin: 48, soup: true, dpi: 0, place: true, edge: p.edge });
      // an edge that does not fit: made with a straight top instead, and said (Phil 10-29: "it should
      // do something, adapt, not do something, but never make it so I can't get out of this mode")
      if (!ws.length && p.edge && p.edge.kind !== 'straight') {
        const why = ws.error;
        ws = a.platform.load_svg(svg, nm, { depth: p.thick, resolution: 2, segmin: 48, soup: true, dpi: 0, place: true, edge: { kind: 'straight', size: 0 } });
        if (ws.length) adapted.push(`${p.name}: made with a straight top edge (${(why || `the ${p.edge.kind} did not fit`).replace(/\.$/, '')})`);
      }
      if (!ws.length) { failed.push(`${p.name} not made: ${(ws.error || 'swarf could not make it from its drawing. Is the outline crossing itself?').replace(/\.$/, '')}${p.w ? '; the part stays as it was' : ''}.`); continue; }
      if (!p.w) fresh = true;
      if (p.w) a.platform.delete(p.w);
      made.push(...ws);
      built++;
      // made: a second done (after a failure below) leaves it be
      p.w = ws[0]; p.dirty = false;
    }
    if (made.length) a.platform.select(made[0]);
    if (fresh && a.frame) setTimeout(() => a.frame(), 120);   // Fable review 3 #17: done counts as a landing
    // a word, or any one drawing, counts as one, however many parts its letters make
    const n = built;
    // done always leaves DRAW: what could not be made is said, and a part that was there stays as it was
    if (failed.length || adapted.length) {
      a.show.alert([...adapted.map(x => x + '.'), ...failed].join(' ') + (failed.length ? ' Open draw again to change it.' : ''), 14);
      return;
    }
    a.show.alert(open.length ? `${open.join(', ')}: open lines were left out (only closed outlines get a thickness).` : `${n === 1 ? (made.length > 1 ? `Made from the drawing: ${made.length} pieces, kept together.` : '1 part rebuilt from the drawing.') : `${n} drawings made into parts.`} Next: a step (${made.some(w => w.meta.edge) ? 'contour shapes the edge, outline cuts it out' : 'outline cuts it out'}), then toolpaths.`, 8);
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
