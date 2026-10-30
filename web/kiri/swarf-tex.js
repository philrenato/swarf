/*
 * swarf tex — mark a part, then texture the mark (Phil 10-29: "Draw is for making new shapes.
 * tex is for marking and then texturing and piercing those shapes").
 *
 * TEX opens the same board DRAW does (the bed from above, every part where it sits) with its own
 * tools: the brush paints a mark on a part and erases it (⌥ while painting, or the eraser), the
 * rectangle and ellipse drag one out, and a region fills one closed area of the part (its outline
 * less its holes). The card fills the picked mark: a pattern, its numbers, scale, turn and soft
 * edge, then how deep, with which bit and along which path. "done" keeps the marks and leaves.
 *
 * A mark lives on its part (meta.tex), in the part's own frame like DRAW's engraved lines, and
 * turns, scales, mirrors and copies with it. Each mark is a texture step in cam's list ("texture:
 * ocean waves on Seat"), before the steps that cut the parts free; the step's moves come from the
 * core's drop cutter (swarf-tex-core.mjs) in the slice worker (op-texture.js).
 *
 * The data leaves room for a second fill: a mark's fill is { fill: 'texture', … } now, and a
 * later step can make it { fill: 'pierce', … } from the same region.
 */
(function () {
  'use strict';
  const LEN = {
    unit: () => (window.SwarfLength ? window.SwarfLength.unit() : 'mm'),
    fld: v => (window.SwarfLength ? (window.SwarfLength.field || window.SwarfLength.show)(v) : String(v)),
    parse: t => (window.SwarfLength ? window.SwarfLength.parse(t) : parseFloat(t)),
    say: v => (window.SwarfLength ? window.SwarfLength.say(v) : `${+(+v).toFixed(2)} mm`),
    prose: v => (window.SwarfLength && window.SwarfLength.prose ? window.SwarfLength.prose(v, undefined, 2) : `${+(+v).toFixed(2)} mm`)
  };
  const api = () => window.kiri && window.kiri.api;
  const T = () => window.SwarfTexCore;
  const V = () => window.SwarfVector;
  const $ = id => document.getElementById(id);
  const r3 = v => +(+v).toFixed(3);
  const BRUSH = 'swarf-tex-brush', FILL = 'swarf-tex-fill';
  // the core's bits, and the tool library's own for each (src/kiri/app/conf/defaults.js)
  const BITS = {
    ball18: { tool: 1004, say: '1/8 in ball' },
    ball14: { tool: 1018, say: '1/4 in ball' },
    v60: { tool: 1106, say: '60° V-bit' },
    v90: { tool: 1105, say: '90° V-bit' },
    flat14: { tool: 1101, say: '1/4 in straight (flat)' }
  };
  // the tool library's bits as the core's: ball, V (its included angle from its taper) or flat.
  // A texture takes any of the three, a pierce a flat (straight) bit. With none in the library,
  // the five above.
  function bitOf(t) {
    if (!t) return null;
    const mm = v => (t.metric ? v : v * 25.4) || 0;
    const d = mm(t.flute_diam || t.shaft_diam);
    if (!(d > 0)) return null;
    const name = t.name || `#${t.number}`;
    if (t.type === 'ballmill') return { id: `lib${t.id}`, name, type: 'ball', diameter: d };
    if (t.type === 'endmill') return { id: `lib${t.id}`, name, type: 'flat', diameter: d };
    if (t.type === 'tapermill') {
      const half = t.taper_angle > 0 ? t.taper_angle : Math.atan((d - mm(t.taper_tip)) / 2 / Math.max(1e-6, mm(t.flute_len))) * 180 / Math.PI;
      return half > 1 && half < 89 ? { id: `lib${t.id}`, name, type: 'v', angle: 2 * half, diameter: d } : null;
    }
    return null;
  }
  function libraryBits(pierce) {
    const a = api(), tools = (a && a.conf.get().tools) || [];
    const out = tools.map(t => [t, bitOf(t)]).filter(([, b]) => b && (pierce ? b.type === 'flat' : true));
    return out.sort((x, y) => (x[1].type > y[1].type ? 1 : x[1].type < y[1].type ? -1 : x[1].diameter - y[1].diameter));
  }
  // a fill's bit made the library's: its tool id and spec (a fill from before names a core id)
  function normBit(f) {
    const lib = libraryBits(f.fill === 'pierce');
    if (!lib.length) return f;
    const id = typeof f.tool === 'number' ? f.tool : (BITS[f.tool] || {}).tool;
    let hit = lib.find(([t]) => t.id === id);
    if (!hit && f.fill === 'pierce') hit = lib.find(([, b]) => Math.abs(b.diameter - 3.175) < 0.01) || lib[0];
    if (!hit) hit = lib.find(([, b]) => b.type === 'ball' && Math.abs(b.diameter - 6.35) < 0.01) || lib[0];
    f.tool = hit[0].id; f.bit = hit[1];
    return f;
  }
  const PATHS = {
    auto: 'best',
    raster: 'raster',
    crosshatch: 'cross-hatch',
    plunge: 'plunge each dot',
    centerline: 'follow the centerline'
  };
  const TOOLS = {
    select: 'pick a part or a mark (V)',
    brush: 'paint a mark on a part; hold option (alt) to erase; [ and ] size the brush (B)',
    erase: 'erase from the mark (U)',
    rect: 'drag a rectangle onto the mark; with option (alt) it cuts it out (R)',
    ellipse: 'drag an ellipse onto the mark; with option (alt) it cuts it out (E)',
    region: 'click inside a part: its whole top, less its holes, joins the mark (G)',
    points: 'the mark\'s edge as points: drag one, click the edge to add one, Delete removes the picked (H)'
  };
  const KEYS = { v: 'select', b: 'brush', u: 'erase', r: 'rect', e: 'ellipse', g: 'region', h: 'points' };
  const WORD = { select: 'select', brush: 'brush', erase: 'erase', rect: 'rectangle', ellipse: 'ellipse', region: 'region', points: 'points' };
  const clone = o => JSON.parse(JSON.stringify(o));
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nameOf = w => String((w.meta && w.meta.file) || 'part').replace(/\.(svg|dxf|ai|pdf|stl|obj|3mf)$/i, '');
  const newId = () => 'tx' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ── a part from above: its outline loops on the bed (a drawing's, or its box) ──
  function flat(crv, step = 1) {
    const L = [];
    for (const b of V().cubics(crv)) {
      const est = Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1]) + Math.hypot(b[2][0] - b[1][0], b[2][1] - b[1][1]) + Math.hypot(b[3][0] - b[2][0], b[3][1] - b[2][1]);
      const n = Math.max(4, Math.min(128, Math.ceil(est / step)));
      for (let i = L.length ? 1 : 0; i <= n; i++) {
        const t = i / n, u = 1 - t;
        L.push([u * u * u * b[0][0] + 3 * u * u * t * b[1][0] + 3 * u * t * t * b[2][0] + t * t * t * b[3][0],
                u * u * u * b[0][1] + 3 * u * u * t * b[1][1] + 3 * u * t * t * b[2][1] + t * t * t * b[3][1]]);
      }
    }
    return L;
  }
  const isClosed = crv => { const P = crv.ctrlPts, a = P[0], b = P[P.length - 1]; return Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6; };
  const inLoop = (p, L) => { let n = false; for (let i = 0, j = L.length - 1; i < L.length; j = i++) if ((L[i][1] > p[1]) !== (L[j][1] > p[1]) && p[0] < (L[j][0] - L[i][0]) * (p[1] - L[i][1]) / (L[j][1] - L[i][1]) + L[i][0]) n = !n; return n; };
  const loopArea = L => { let a = 0; for (let i = 0, j = L.length - 1; i < L.length; j = i++) a += (L[j][0] + L[i][0]) * (L[j][1] - L[i][1]); return Math.abs(a / 2); };
  // a part's outline loops in its own frame (bed − its place): even-odd, outline and holes
  function localLoops(w) {
    const pos = w.track.pos;
    const D = window.__swarfDraw;
    if (D && w.meta && w.meta.svg && !w.meta.tilted && V()) {
      try {
        const loops = D.bedCurves(w).filter(c => isClosed(c.crv)).map(c => flat(c.crv).map(([x, y]) => [x - pos.x, y - pos.y]));
        if (loops.length) return { loops, drawn: true };
      } catch (e) { /* no drawing: its box */ }
    }
    const g = w.mesh.geometry;
    g.computeBoundingBox();
    const b = g.boundingBox;
    return { loops: [[[b.min.x, b.min.y], [b.max.x, b.min.y], [b.max.x, b.max.y], [b.min.x, b.max.y]]], drawn: false };
  }
  const onPart = (p, loops) => loops.reduce((n, L) => n + (inLoop(p, L) ? 1 : 0), 0) % 2 === 1;
  function sizeOf(w) {
    const g = w.mesh.geometry;
    g.computeBoundingBox();
    const b = g.boundingBox;
    return { top: b.max.z, thick: r3(b.max.z - b.min.z) };
  }

  // ── marks: a paint grid in the mark's frame, xf to the part's ──
  function loadMark(m) {
    const region = T().regionSpec(m.region);
    return { id: m.id, made: m.made, region: { ...region, data: region.data ? region.data.slice() : region.data }, xf: (m.xf || T().IDENTITY).slice(), fill: normBit(clone(m.fill)), est: m.est, ver: 1 };
  }
  function storeMark(m) {
    return { id: m.id, made: m.made, region: T().storeRegion(m.region), xf: m.xf.slice(), fill: clone(m.fill), est: m.est };
  }
  const markHas = m => m.region && m.region.data && m.region.data.some(v => v);
  function lastFill() {
    try { const f = JSON.parse(localStorage.getItem(FILL) || 'null'); if (f && ((f.fill === 'texture' && T().PATTERNS[f.pattern]) || (f.fill === 'pierce' && T().PIERCES[f.pattern] && document.body.classList.contains('swarf-expert')))) return f; } catch (e) { /* private */ }
    return null;
  }
  function newMark(part, made) {
    const b = part.box, pad = 2;
    const region = T().newGrid(b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad, 0.5);
    const f = lastFill() || T().newFill('waves', { tool: 'ball14' });
    f.origin = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    return { id: newId(), made: made || 'brush', region, xf: T().IDENTITY.slice(), fill: normBit(f), ver: 1 };
  }
  // the bed point p to the mark's frame
  function toMark(part, m, p) { return T().xfApply(T().xfInvert(m.xf), p[0] - part.pos[0], p[1] - part.pos[1]); }

  // ── the board ──
  let S = null;
  const ui = {};

  function open() {
    const a = api();
    if (!a || !T() || S) return;
    // one mode at a time: DRAW keeps its changes (as its done does) before TEX opens
    const D = window.__swarfDraw;
    if (D && D.state()) { D.close(true); if (D.state()) return; }
    const dev = a.conf.get().device || {};
    const parts = [];
    for (const w of a.widgets.all()) {
      if (w.track && w.track.synth) continue;
      const { loops, drawn } = localLoops(w);
      const pos = [w.track.pos.x, w.track.pos.y];
      const b = [Infinity, Infinity, -Infinity, -Infinity];
      for (const L of loops) for (const q of L) { b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]); }
      parts.push({ w, name: nameOf(w), pos, loops, drawn, box: b, ...sizeOf(w), tilted: !!(w.meta && w.meta.tilted), marks: (w.meta && Array.isArray(w.meta.tex) ? w.meta.tex : []).map(loadMark), dirty: false });
    }
    let brush = 12;
    try { brush = parseFloat(localStorage.getItem(BRUSH)) || 12; } catch (e) { /* private */ }
    S = { parts, bed: [dev.bedWidth || 600, dev.bedDepth || 600], sel: -1, mark: -1, tool: 'select', brush, drag: null, hover: null, undo: [] };
    build();
    const picked = a.selection.widgets ? a.selection.widgets() : [];
    const i = parts.findIndex(p => picked.includes(p.w));
    if (i >= 0) { S.sel = i; S.mark = parts[i].marks.length ? 0 : -1; }
    fit();
    say(!parts.length ? 'No parts yet: import one, make a shape or draw one, then come back to mark it.'
      : S.sel >= 0 ? `${parts[S.sel].name} is picked: paint on it with the brush (B), or drag a rectangle (R) or an ellipse (E).`
        : 'Pick a part, then mark it: the brush paints, the rectangle and ellipse drag out, a region fills its top.');
    render();
    imagesSoon();
    checkSoon();
  }

  function build() {
    const el = document.createElement('div');
    el.id = 'swarf-draw';                         // DRAW's board, its look in every skin
    el.className = 'sd-tex';
    const btn = t => `<button data-tool="${t}" title="${esc(TOOLS[t])}">${WORD[t]} <kbd>${Object.keys(KEYS).find(k => KEYS[k] === t).toUpperCase()}</kbd></button>`;
    el.innerHTML = `
      <svg id="tx-svg" tabindex="0"></svg>
      <div class="sd-bar">
        ${['select', 'brush', 'erase', 'rect', 'ellipse', 'region', 'points'].map(btn).join('')}
        <span class="tx-bsize" id="tx-bsize-wrap" title="across the brush ([ and ] change it)"><input id="tx-bsize" inputmode="text"><span class="u"></span></span>
        <span class="sd-sep"></span>
        <button id="tx-undo" title="undo (⌘Z)">undo</button>
        <button id="tx-fit" title="show the parts, or the whole bed (F) · pinch or ⌘-scroll to zoom, two fingers to slide">fit</button>
        <span class="sd-grow"></span>
        <button id="tx-cancel" title="close without changing the marks (Esc twice)">cancel</button>
        <button id="tx-done" class="sd-go" title="keep the marks and close">done</button>
      </div>
      <div class="sd-card" id="tx-card"></div>
      <p class="sd-say" id="tx-say"></p>`;
    (document.getElementById('app') || document.body).append(el);
    // swarf-draw-open: everything that steps aside for DRAW steps aside for TEX too
    document.body.classList.add('swarf-draw-open', 'swarf-tex-open');
    ui.el = el; ui.svg = $('tx-svg'); ui.card = $('tx-card');
    for (const b of el.querySelectorAll('[data-tool]')) b.onclick = () => setTool(b.dataset.tool);
    $('tx-undo').onclick = undo;
    const bs = $('tx-bsize');
    const takeBrush = () => { const v = LEN.parse(bs.value); if (!(v >= 0.5)) { say('Give the brush at least 0.5 mm across.'); return; } S.brush = r3(v); try { localStorage.setItem(BRUSH, String(S.brush)); } catch (e) { /* private */ } render(); };
    bs.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') { bs.dataset.took = bs.value; takeBrush(); bs.blur(); ui.svg.focus(); } if (e.key === 'Escape') { render(); ui.svg.focus(); } };
    bs.onchange = () => { if (bs.dataset.took !== bs.value) takeBrush(); };
    // a unit changed in cam: the card and the bar say it, and no stale line stays
    S.onUnits = () => setTimeout(() => { if (S) { say(''); render(); } }, 0);
    // (api(), not a: build has no a, and the ReferenceError hid in this catch since r2 N5)
    try { const u = api().ui.units; if (u) u.addEventListener('change', S.onUnits); } catch (e) { /* no units control */ }
    $('tx-fit').onclick = () => { fit(!S.whole); render(); ui.svg.focus(); };
    $('tx-cancel').onclick = () => close(false);
    $('tx-done').onclick = () => close(true);
    ui.svg.addEventListener('pointerdown', down);
    ui.svg.addEventListener('pointermove', move);
    ui.svg.addEventListener('pointerup', up);
    ui.svg.addEventListener('pointerleave', () => { if (S && !S.drag) { S.hover = null; render(); } });
    ui.svg.addEventListener('wheel', wheel, { passive: false });
    ui.card.addEventListener('scroll', scrollCue);
    window.addEventListener('keydown', key, true);
    window.addEventListener('keypress', hush, true);
    window.addEventListener('resize', render);
    ui.svg.focus();
  }
  const hush = e => e.stopPropagation();

  // done (apply) or cancel: either way TEX closes. Done never keeps you in TEX (Phil: a mode may
  // adapt, never trap): what it could not do, it says after.
  function close(apply) {
    if (!S) return;
    let said = '';
    if (apply) { try { said = commit(); } catch (e) { console.warn('swarf tex', e); said = `The marks could not all be kept: ${e.message || e}.`; } }
    window.removeEventListener('keydown', key, true);
    window.removeEventListener('keypress', hush, true);
    window.removeEventListener('resize', render);
    clearTimeout(S.checkT); clearTimeout(S.imgT);
    try { const u = api() && api().ui.units; if (u && S.onUnits) u.removeEventListener('change', S.onUnits); } catch (e) { /* gone */ }
    ui.el.remove();
    document.body.classList.remove('swarf-draw-open', 'swarf-tex-open');
    S = null;
    const a = api();
    // back in cam with the parts in view (r086 check M1: a camera left inside a part stays there)
    try { if (a && a.reveal) a.reveal(); } catch (e) { /* no view */ }
    if (said && a) a.show.alert(said, 10);
  }

  // ── view (as DRAW's): mm on the bed to px on the board ──
  function fit(whole) {
    const r = ui.svg.getBoundingClientRect();
    const W = r.width || window.innerWidth, H = r.height || window.innerHeight;
    const [bw, bd] = S.bed;
    let b = [-bw / 2, -bd / 2, bw / 2, bd / 2];
    if (!whole && S.parts.length) {
      b = [Infinity, Infinity, -Infinity, -Infinity];
      for (const p of S.parts) { b[0] = Math.min(b[0], p.box[0] + p.pos[0]); b[1] = Math.min(b[1], p.box[1] + p.pos[1]); b[2] = Math.max(b[2], p.box[2] + p.pos[0]); b[3] = Math.max(b[3], p.box[3] + p.pos[1]); }
      const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, h = Math.max(100, (b[2] - b[0]) * 0.62, (b[3] - b[1]) * 0.62);
      b = [cx - h, cy - h, cx + h, cy + h];
    }
    const left = 16, right = W > 900 ? 306 : 16, top = 76, bottom = 50;
    S.k = Math.max(0.02, Math.min((W - left - right) / (b[2] - b[0]), (H - top - bottom) / (b[3] - b[1])));
    S.ox = left + (W - left - right) / 2 - (b[0] + b[2]) / 2 * S.k;
    S.oy = top + (H - top - bottom) / 2 + (b[1] + b[3]) / 2 * S.k;
    S.whole = !!whole;
  }
  const sx = x => S.ox + x * S.k, sy = y => S.oy - y * S.k;
  function toMM(e) { const r = ui.svg.getBoundingClientRect(); return [(e.clientX - r.left - S.ox) / S.k, -(e.clientY - r.top - S.oy) / S.k]; }

  // ── the marks as pictures: the texture carved into the part's own surface, in every skin ──
  // The part's fill over the bed is the surface; a bounded range around it (never near-black, never
  // white) shades the carving, so a mark reads alike in wet plastic, classic and swarf.
  function skinColors() {
    if (S.colors) return S.colors;
    const rgba = (el, prop) => { const m = /(\d+(?:\.\d+)?)[, ]+(\d+(?:\.\d+)?)[, ]+(\d+(?:\.\d+)?)(?:[, /]+(\d*\.?\d+))?/.exec(el ? getComputedStyle(el)[prop] : ''); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
    const on = ui.svg.querySelector('.sd-part.on') || ui.svg.querySelector('.sd-part'), bedEl = ui.svg.querySelector('.sd-bed');
    const line = (rgba(on, 'stroke') || [242, 237, 228, 1]).slice(0, 3), bed = (rgba(bedEl, 'fill') || [26, 23, 22, 1]).slice(0, 3);
    const fill = rgba(on, 'fill') || [128, 128, 128, 0.2];
    const base = bed.map((b, i) => b + (fill[i] - b) * fill[3]);
    const light = (0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2]) / 255 > 0.5;
    const lo = base.map(c => Math.round(c * (light ? 0.64 : 0.55)));
    const hi = base.map(c => Math.round(c + (255 - c) * (light ? 0.16 : 0.3)));
    const c = { line, bed, base, lo, hi };
    if (on) S.colors = c;
    return c;
  }
  // mode: 'mask' (the painted area only, while painting is not shaded), 'coarse' (shaded, small:
  // under the brush every frame), 'full' (shaded, when the board rests). The picked mark's edge
  // comes along as a path for the board to dash over it.
  const RANK = { mask: 0, coarse: 1, full: 2 };
  function markImage(part, m, mode) {
    const g = m.region;
    if (m.img && m.img.ver === m.ver && RANK[m.img.mode] >= RANK[mode]) return m.img;
    let i0 = Infinity, j0 = Infinity, i1 = -1, j1 = -1;
    for (let j = 0; j < g.ny; j++) { const row = j * g.nx; for (let i = 0; i < g.nx; i++) if (g.data[row + i]) { if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; } }
    if (i1 < 0) return (m.img = { ver: m.ver, mode, href: null });
    const cap = mode === 'coarse' ? 20000 : 90000;
    const q = Math.max(1, Math.ceil(Math.sqrt((i1 - i0 + 1) * (j1 - j0 + 1) / cap)));
    const W = Math.ceil((i1 - i0 + 1) / q), H = Math.ceil((j1 - j0 + 1) / q), res = g.res * q;
    const uL = g.x0 + i0 * g.res, vT = g.y0 + (j1 + 1) * g.res;
    const cell = (u, v) => { const i = Math.floor((u - g.x0) / g.res), j = Math.floor((v - g.y0) / g.res); return i >= 0 && j >= 0 && i < g.nx && j < g.ny && g.data[j * g.nx + i]; };
    let hf = null, dmax = 1;
    if (mode !== 'mask') {
      const s = T().xfScale(m.xf);
      const tex = T().markTexture({ region: g, xf: m.xf, fill: m.fill }, { part: part.loops });
      if (tex) { const A = m.xf; hf = (u, v) => tex.h(A[0] * u + A[1] * v + A[4], A[2] * u + A[3] * v + A[5]); dmax = Math.max(0.5, tex.depth); }
    }
    const Hs = new Float32Array(W * H), In = new Uint8Array(W * H);
    for (let pj = 0; pj < H; pj++) for (let pi = 0; pi < W; pi++) {
      const u = uL + (pi + 0.5) * res, v = vT - (pj + 0.5) * res, k = pj * W + pi;
      In[k] = cell(u, v) && onPart(T().xfApply(m.xf, u, v), part.loops) ? 1 : 0;
      if (hf && In[k]) Hs[k] = hf(u, v);
    }
    const { line, lo, hi } = skinColors();
    const can = document.createElement('canvas'); can.width = W; can.height = H;
    const ctx = can.getContext('2d'), img = ctx.createImageData(W, H);
    const D = hf ? T().shadeHeight(Hs, W, H, res, { lo, hi }, In, dmax) : null;
    let edge = '';
    for (let pj = 0; pj < H; pj++) for (let pi = 0; pi < W; pi++) {
      const k = pj * W + pi, o = k * 4;
      if (!In[k]) continue;
      if (D) { img.data[o] = D[o]; img.data[o + 1] = D[o + 1]; img.data[o + 2] = D[o + 2]; img.data[o + 3] = 240; }
      else { for (let c = 0; c < 3; c++) img.data[o + c] = (lo[c] + hi[c]) >> 1; img.data[o + 3] = 170; }
      // the boundary: half strength, so the carving's own shading carries the edge
      const l = pi === 0 || !In[k - 1], r = pi === W - 1 || !In[k + 1], t = pj === 0 || !In[k - W], b = pj === H - 1 || !In[k + W];
      if (l || r || t || b) { for (let c = 0; c < 3; c++) img.data[o + c] = (img.data[o + c] + line[c]) >> 1; img.data[o + 3] = 255; }
      const x0 = pi * res, x1 = x0 + res, y0 = pj * res, y1 = y0 + res;
      if (l) edge += `M${x0},${y0}V${y1}`;
      if (r) edge += `M${x1},${y0}V${y1}`;
      if (t) edge += `M${x0},${y0}H${x1}`;
      if (b) edge += `M${x0},${y1}H${x1}`;
    }
    ctx.putImageData(img, 0, 0);
    return (m.img = { ver: m.ver, mode: hf ? mode : 'mask', href: can.toDataURL(), uL, vT, w: W * res, h: H * res, edge });
  }
  // the marks' pictures are made fine when the board rests
  function imagesSoon() {
    clearTimeout(S.imgT);
    S.imgT = setTimeout(() => { if (!S) return; for (const p of S.parts) for (const m of p.marks) markImage(p, m, 'full'); render(); }, 220);
  }
  // a pierce mark's cuts over it: slots a bit wide, holes their size
  function cutsSVG(p, m) {
    if (!(m.cuts && m.cuts.ver === m.ver)) {
      let c = null;
      try { c = T().pierceCuts({ region: m.region, xf: m.xf, fill: m.fill }, { thickness: p.thick, part: p.loops }); } catch (e) { console.warn('swarf tex', e); }
      m.cuts = { ver: m.ver, c };
    }
    const c = m.cuts.c, k = S.k;
    if (!c) return '';
    const X = x => sx(x + p.pos[0]), Y = y => sy(y + p.pos[1]);
    let d = '';
    for (const q of c.slots) d += `M${X(q.a[0])},${Y(q.a[1])}L${X(q.b[0])},${Y(q.b[1])}`;
    let o = d ? `<path class="tx-cut" d="${d}" style="stroke-width:${Math.max(1, c.width * k)}px"/>` : '';
    for (const h of c.holes) o += `<circle class="tx-cut tx-hole" cx="${X(h.x)}" cy="${Y(h.y)}" r="${Math.max(0.5, h.d / 2 * k)}"/>`;
    return o;
  }
  // ── points: the picked mark's edge as Pgon's and MASQ's region curve (swarf-tex-core fitCurves) ──
  function curveOf(m) {
    if (!(m.curve && m.curve.ver === m.ver)) {
      const count = m.curve && m.curve.count;
      const fit = count ? T().fitCurves(m.region, { count }) : T().fitCurves(m.region, { tol: 1 / T().xfScale(m.xf) });
      m.curve = { ver: m.ver, count: count || Math.max(...fit.loops.map(L => L.handles.length), 4), ...fit };
      S.pts = new Set();
    }
    return m.curve;
  }
  const bedOf = (part, m, q) => { const [x, y] = T().xfApply(m.xf, q[0], q[1]); return [x + part.pos[0], y + part.pos[1]]; };
  function pointsSVG() {
    const part = curPart(), m = curMark();
    if (!part || !m || !markHas(m)) return '';
    const c = curveOf(m), out = [];
    S.pts = S.pts || new Set();
    c.loops.forEach((L, li) => {
      const P = T().sampleCurve(L.handles, 12).pts.map(q => bedOf(part, m, q));
      out.push(`<path class="sd-pen tx-curve" d="M${P.map(q => `${sx(q[0])},${sy(q[1])}`).join('L')}Z"/>`);
    });
    // as DRAW: unseen rings round the points, then the points
    c.loops.forEach((L, li) => L.handles.forEach((h, i) => { const [x, y] = bedOf(part, m, h); out.push(`<circle class="sd-pthit" data-pt="${li}:${i}" cx="${sx(x)}" cy="${sy(y)}" r="9"/>`); }));
    c.loops.forEach((L, li) => L.handles.forEach((h, i) => { const [x, y] = bedOf(part, m, h), on = S.pts.has(`${li}:${i}`); out.push(`<rect class="sd-pt${on ? ' on' : ''}" data-pt="${li}:${i}" x="${sx(x) - 4}" y="${sy(y) - 4}" width="8" height="8"/>`); }));
    return out.join('');
  }
  // the curve back into the mark: from the paint's grid at the start, clipped to the part's top.
  // A curve that would cross itself leaves the paint as it was, and says so.
  function rewrite(part, m, base, curve, dragging) {
    const r = T().rewriteFromCurves(base, curve);
    if (!r) { say(dragging ? 'Stopped where the edge would cross itself: let go and it stays there.' : 'That would make the edge cross itself: the mark stays as it was. Move the point back, or another way.'); return false; }
    const top = onTop(part, m), g = m.region;
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      g.data[k] = r.data[k] && top(g.x0 + (i + 0.5) * g.res, g.y0 + (j + 0.5) * g.res) ? 1 : 0;
    }
    m.ver++; part.dirty = true;
    m.curve = { ...curve, ver: m.ver };
    return true;
  }
  function pointsDown(e, p) {
    const part = curPart(), m = curMark();
    if (!part || !m || !markHas(m)) { say('Pick a mark first: its edge shows its points.'); return; }
    const c = curveOf(m), id = e.target.dataset && e.target.dataset.pt;
    const base = { ...m.region, data: m.region.data.slice() }, start = clone({ loops: c.loops, count: c.count });
    if (id) {
      if (e.shiftKey) { S.pts.has(id) ? S.pts.delete(id) : S.pts.add(id); render(); return; }
      if (!S.pts.has(id)) S.pts = new Set([id]);
      snap();
      S.drag = { kind: 'pt', part, m, base, start, at: toMark(part, m, p), moved: false };
      ui.svg.setPointerCapture(e.pointerId);
      return;
    }
    // a click by the edge adds a point there
    const q = toMark(part, m, p), near = T().nearestOnCurves(c, q[0], q[1]);
    if (near && near.d * T().xfScale(m.xf) * S.k <= 8) {
      snap();
      const L = start.loops[near.loop];
      L.handles.splice(near.span + 1, 0, near.p);
      if (rewrite(part, m, base, start)) { S.pts = new Set([`${near.loop}:${near.span + 1}`]); say('A point added: drag it.'); } else S.undo.pop();
      render(); imagesSoon(); checkSoon();
      return;
    }
    // drag across points to pick them
    S.drag = { kind: 'ptbox', at: p, shift: e.shiftKey };
    ui.svg.setPointerCapture(e.pointerId);
  }
  function pointsMove(p, d) {
    if (d.kind === 'ptbox') { S.box = [d.at, p]; render(); return; }
    const q = toMark(d.part, d.m, p), dx = q[0] - d.at[0], dy = q[1] - d.at[1];
    if (!d.moved && Math.hypot(dx, dy) * T().xfScale(d.m.xf) * S.k < 2) return;
    d.moved = true;
    const curve = clone(d.start);
    for (const id of S.pts) { const [li, i] = id.split(':').map(Number), h = curve.loops[li] && curve.loops[li].handles[i]; if (h) { h[0] += dx; h[1] += dy; } }
    // a curve that would cross is not taken: the mark stays at the last place that did not
    d.bad = !rewrite(d.part, d.m, d.base, curve, true);
    renderSoon();
  }
  function pointsUp(d) {
    if (d.kind === 'ptbox') {
      const b = S.box; S.box = null;
      const part = curPart(), m = curMark();
      if (!b || !m) { render(); return; }
      if (!d.shift) S.pts = new Set();
      const x0 = Math.min(b[0][0], b[1][0]), x1 = Math.max(b[0][0], b[1][0]), y0 = Math.min(b[0][1], b[1][1]), y1 = Math.max(b[0][1], b[1][1]);
      curveOf(m).loops.forEach((L, li) => L.handles.forEach((h, i) => { const [x, y] = bedOf(part, m, h); if (x >= x0 && x <= x1 && y >= y0 && y <= y1) S.pts.add(`${li}:${i}`); }));
      render(); return;
    }
    if (!d.moved) { S.undo.pop(); render(); return; }
    // a drag that ended crossed lands where it last did not (rewrite kept that), and says so
    if (d.bad) say('The point stopped where the edge would have crossed itself.');
    render(); imagesSoon(); checkSoon();
  }
  function pointsDelete() {
    const part = curPart(), m = curMark();
    if (!m || !S.pts.size) return false;
    const c = clone({ loops: curveOf(m).loops, count: m.curve.count });
    const base = { ...m.region, data: m.region.data.slice() };
    const gone = {};
    for (const id of S.pts) { const [li, i] = id.split(':').map(Number); (gone[li] = gone[li] || new Set()).add(i); }
    c.loops = c.loops.map((L, li) => ({ ...L, handles: L.handles.filter((_, i) => !(gone[li] && gone[li].has(i))) }));
    if (c.loops.some(L => L.handles.length < 3)) { say('An edge needs at least three points.'); return true; }
    snap();
    if (rewrite(part, m, base, c)) { S.pts = new Set(); say('Points removed.'); } else S.undo.pop();
    render(); imagesSoon(); checkSoon();
    return true;
  }
  // ── a mark made into DRAW geometry: a part of its own, or a hole through its part ──
  // The outline is handed to DRAW (its own hole path: a hole inside, a notch across the edge), and
  // DRAW's done makes it. The mark goes when that outline is made, since it is the part's shape now
  // (a texture left on a hole would cut air); cancel in DRAW and the mark stays as it was.
  function makeOutline(part, m, as) {
    const C = T(), c = curveOf(m);
    if (!c.loops.length) return say('Paint the mark first: an outline comes from its edge.');
    if (C.curvesCross(c)) return say('The mark\'s edge crosses itself: fix its points first (points, H).');
    const a = api(), ops = a.conf.get().process.ops || [], tools = a.conf.get().tools || [];
    const cut = ops.find(o => o && (o.type === 'outline' || o.type === 'rough')), tool = cut && tools.find(t => t.id === cut.tool);
    const bit = tool ? (tool.metric ? 1 : 25.4) * (tool.flute_diam || 0.25) : 6.35;
    const reach = C.insideReach(m.region) * C.xfScale(m.xf);
    if (reach * 2 < bit * 1.05) return say(`The mark is too narrow for the ${tool ? tool.name : '1/4 in'} bit (${LEN.prose(bit)}) that cuts the outline: make it wider first.`);
    const loops = c.loops.map(L => C.sampleCurve(L.handles, 12).pts.map(q => bedOf(part, m, q)));
    const w = part.w, name = `${m.made || 'mark'} from ${part.name}`;
    close(true);
    const D = window.__swarfDraw;
    if (!D) return;
    D.open();
    const said = D.adopt({ widget: w, loops, as, name, markId: m.id });
    if (D.say) D.say(said);
  }
  // ── the part as a mesh with its marks, for rendering (worked out in the worker) ──
  function saveMesh(part) {
    const w = texWorker(), cut = !!S.meshCut, fmt = S.meshFmt || 'stl', res = S.meshRes || T().autoMeshRes(part.loops);
    const marks = part.marks.filter(markHas).map(m => ({ id: m.id, region: m.region, xf: m.xf, fill: m.fill }));
    const name = `${part.name}${cut ? ' as cut' : ''}`;
    say(`Making ${name} as a mesh…`);
    const done = r => {
      if (!S) return;
      if (r.error) return say(`The mesh could not be made: ${r.error}.`);
      const blob = r.buf ? new Blob([r.buf], { type: r.glb ? 'model/gltf-binary' : 'model/stl' }) : new Blob([r.text], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${name}.${fmt}`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      S.lastMesh = { name: a.download, bytes: blob.size, triangles: r.triangles, check: r.check };
      say(`Saved ${a.download}: ${r.triangles} triangles, ${r.check && r.check.watertight ? 'a closed solid' : 'NOT closed'}, in mm.`);
    };
    const ask = { kind: 'mesh', loops: part.loops, thickness: part.thick, marks, res, cut, format: fmt, name };
    if (w) { const id = ++asked; pending.set(id, done); w.postMessage({ id, ...ask }); return; }
    try {
      const M = T().partMesh(ask), check = T().meshCheck(M);
      done(fmt === 'obj' ? { text: T().meshOBJ(M, name), triangles: M.triangles, check } : fmt === 'glb' ? { buf: T().meshGLB(M, name), glb: true, triangles: M.triangles, check } : { buf: T().meshSTL(M, name), triangles: M.triangles, check });
    } catch (e) { done({ error: e.message || String(e) }); }
  }
  // fewer or more points: fitted again from the paint
  function pointsCount(n) {
    const m = curMark();
    if (!m) return;
    n = Math.max(4, Math.min(200, Math.round(n)));
    m.curve = { ver: -1, count: n };
    curveOf(m);
    render();
  }
  // while painting: one redraw a frame, the stroke's mark shaded coarse under the brush
  function renderSoon() {
    if (S.raf) return;
    S.raf = requestAnimationFrame(() => { if (!S) return; S.raf = 0; render(); });
  }

  function render() {
    if (!S) return;
    const k = S.k, [bw, bd] = S.bed, out = [];
    out.push(`<rect class="sd-bed" x="${sx(-bw / 2)}" y="${sy(bd / 2)}" width="${bw * k}" height="${bd * k}"/>`);
    const step = k * 10 > 6 ? 10 : 100;
    let gr = '';
    for (let x = Math.ceil(-bw / 2 / step) * step; x <= bw / 2; x += step) gr += `M${sx(x)},${sy(-bd / 2)}V${sy(bd / 2)}`;
    for (let y = Math.ceil(-bd / 2 / step) * step; y <= bd / 2; y += step) gr += `M${sx(-bw / 2)},${sy(y)}H${sx(bw / 2)}`;
    out.push(`<path class="sd-grid${step === 100 ? ' big' : ''}" d="${gr}"/>`);
    out.push(`<text class="sd-lab" x="${sx(-bw / 2) + 6}" y="${sy(bd / 2) + 14}">bed ${LEN.unit() === 'in' ? `${+(bw / 25.4).toFixed(1)} × ${+(bd / 25.4).toFixed(1)} in` : `${Math.round(bw)} × ${Math.round(bd)} mm`}</text>`);
    out.push(`<path class="sd-origin" d="M${sx(0) - 8},${sy(0)}H${sx(0) + 8}M${sx(0)},${sy(0) - 8}V${sy(0) + 8}"/><text class="sd-lab" x="${sx(0) + 6}" y="${sy(0) + 14}">0, 0</text>`);
    {
      const r = ui.svg.getBoundingClientRect(), want = 100 / k;
      // the scale bar in the units the switch says: round inches (1/8 in to 4 ft) or round mm
      const inch = LEN.unit() === 'in';
      const len = inch ? 25.4 * ([0.125, 0.25, 0.5, 1, 2, 3, 6, 12, 24, 48].find(v => v * 25.4 >= want * 0.6) || 48)
        : [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].find(v => v >= want * 0.6) || 2000;
      const x = 20, y = (r.height || window.innerHeight) - 46;
      out.push(`<path class="sd-scale" d="M${x},${y - 4}V${y}H${x + len * k}V${y - 4}"/><text class="sd-lab" x="${x}" y="${y - 8}">${inch ? LEN.say(len) : len >= 1000 ? len / 1000 + ' m' : len + ' mm'}</text>`);
    }
    S.parts.forEach((p, pi) => {
      const d = p.loops.map(L => 'M' + L.map(q => `${sx(q[0] + p.pos[0])},${sy(q[1] + p.pos[1])}`).join('L') + 'Z').join('');
      out.push(`<path class="sd-part${pi === S.sel ? ' on' : ''}" data-part="${pi}" d="${d}"><title>${esc(p.name)}${p.drawn ? '' : ' (its box: it has no drawing)'}</title></path>`);
    });
    // the marks over their parts; the picked one's edge dashed over it
    const painting = S.drag && S.drag.kind === 'paint' ? S.drag.t.m : null;
    let picked = '';
    S.parts.forEach((p, pi) => p.marks.forEach((m, mi) => {
      const im = markImage(p, m, m === painting ? 'coarse' : 'mask');
      if (!im.href) return;
      const A = m.xf;
      const e = S.ox + k * (p.pos[0] + A[4] + A[0] * im.uL + A[1] * im.vT), f = S.oy - k * (p.pos[1] + A[5] + A[2] * im.uL + A[3] * im.vT);
      const tf = `matrix(${k * A[0]},${-k * A[2]},${-k * A[1]},${k * A[3]},${e},${f})`;
      const on = pi === S.sel && mi === S.mark;
      out.push(`<image class="tx-mark${on ? ' on' : ''}" data-part="${pi}" data-mark="${mi}" href="${im.href}" width="${im.w}" height="${im.h}" preserveAspectRatio="none" transform="${tf}" style="pointer-events:none"/>`);
      if (on && im.edge) picked = `<path class="sd-box tx-edge" d="${im.edge}" transform="${tf}"/>`;
      if (m.fill.fill === 'pierce') out.push(cutsSVG(p, m));
    }));
    out.push(picked);
    if (S.tool === 'points') out.push(pointsSVG());
    if (S.box) {
      const [a, b] = S.box;
      const x = Math.min(sx(a[0]), sx(b[0])), y = Math.min(sy(a[1]), sy(b[1])), w = Math.abs(a[0] - b[0]) * k, h = Math.abs(a[1] - b[1]) * k;
      out.push(S.tool === 'ellipse' ? `<ellipse class="sd-box" cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}"/>` : `<rect class="sd-box" x="${x}" y="${y}" width="${w}" height="${h}"/>`);
    }
    // the brush: its size, and inside it where the soft edge reaches full depth
    if (S.hover && (S.tool === 'brush' || S.tool === 'erase')) {
      const r = S.brush / 2 * k, m = curMark(), fade = m ? m.fill.fade || 0 : 0;
      const er = S.tool === 'erase' || S.alt;
      out.push(`<circle class="${er ? 'sd-box' : 'sd-pen'} tx-brush" cx="${sx(S.hover[0])}" cy="${sy(S.hover[1])}" r="${r}"/>`);
      if (!er && fade > 0 && fade * k < r - 2) out.push(`<circle class="sd-ctl tx-brush" cx="${sx(S.hover[0])}" cy="${sy(S.hover[1])}" r="${r - fade * k}"/>`);
    }
    ui.svg.innerHTML = out.join('');
    for (const b of ui.el.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === S.tool);
    $('tx-undo').disabled = !S.undo.length;
    const bwrap = $('tx-bsize-wrap'), bin = $('tx-bsize');
    bwrap.style.display = S.tool === 'brush' || S.tool === 'erase' ? '' : 'none';
    if (document.activeElement !== bin) { bin.value = LEN.fld(r3(S.brush)); bwrap.querySelector('.u').textContent = LEN.unit(); }
    if (!S.drag) card();
  }

  const curPart = () => S.parts[S.sel];
  const curMark = () => { const p = curPart(); return p && p.marks[S.mark]; };
  // a mark's name: how it was made and its size on the part ("2 · ellipse 40 × 23 mm")
  function markName(m, i) {
    const im = m.img && m.img.href ? m.img : null, s = T().xfScale(m.xf);
    const w = im ? im.w * s : 0, h = im ? im.h * s : 0, inch = LEN.unit() === 'in';
    const n = v => (inch ? +(v / 25.4).toFixed(1) : Math.round(v));
    return `${i + 1} · ${m.made || 'mark'}${im ? ` ${n(w)} × ${n(h)} ${inch ? 'in' : 'mm'}` : ''}`;
  }

  // a kerfed board from the side, to its numbers: the board, the kerfs a bit wide at their pitch, the
  // skin left under them, and the arc it bends to (skin outside)
  function kerfPicture(part, f, pr) {
    const lib = T().fillTool(f), w = lib.diameter, Tb = part.thick || 19, skin = Math.min(Math.max(0, pr.skin), Tb);
    const pitch = T().kerfPitch(w, Tb, skin, pr.radius);
    // room kept right of the board for its "skin" label (r086 check P3: a long board clipped it to "sk")
    const W = 240, H = 56, k = Math.min(3, (H - 28) / Tb), x0 = 10, y0 = 4, n = Math.max(2, Math.min(8, Math.floor((W - 54) / Math.max(1, pitch * k))));
    const span = Math.min(W - 44, n * pitch * k + w * k);
    let kerfs = '';
    for (let i = 0; i < n; i++) { const x = x0 + w * k / 2 + i * pitch * k + pitch * k / 2; kerfs += `<rect x="${(x - w * k / 2).toFixed(1)}" y="${y0}" width="${Math.max(1, w * k).toFixed(1)}" height="${((Tb - skin) * k).toFixed(1)}"/>`; }
    const by = y0 + Tb * k;
    return `<div class="tx-kerfpic" title="from the side: kerfs a bit wide every ${esc(says(`⟦${pitch}⟧`))}, ${skin > 0 ? `${esc(says(`⟦${skin}⟧`))} of skin left under them` : 'right through'}; it bends with the skin outside">
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><rect class="tx-kp-board" x="${x0}" y="${y0}" width="${span.toFixed(1)}" height="${(Tb * k).toFixed(1)}"/><g class="tx-kp-kerf">${kerfs}</g>
      <path class="tx-kp-arc" d="M${x0},${by + 6} Q${x0 + span / 2},${by + 6 + Math.min(10, 600 / pr.radius)} ${x0 + span},${by + 6}"/>
      <text class="tx-kp-t" x="${x0 + span + 4}" y="${y0 + Tb * k - 1}">skin</text><text class="tx-kp-t" x="${x0 + span / 2 - 14}" y="${H - 2}">bends this way</text></svg></div>`;
  }
  // the patterns as swatches, in the skin's colors, made once a visit
  function swatchHref(id) {
    S.sw = S.sw || {};
    if (S.sw[id]) return S.sw[id];
    const N = 48, { lo, hi } = skinColors();
    const can = document.createElement('canvas'); can.width = N; can.height = N;
    const ctx = can.getContext('2d'), img = ctx.createImageData(N, N);
    img.data.set(T().swatch(id, N, { lo, hi }));
    ctx.putImageData(img, 0, 0);
    return (S.sw[id] = can.toDataURL());
  }

  // ── the card: the part › its marks › the picked mark's texture › how it is cut ──
  function card() {
    const part = curPart(), m = curMark(), C = T();
    const keepTop = ui.card.scrollTop;
    const lenRow = (word, id, v, tip) => `<div class="sd-row"${tip ? ` title="${esc(tip)}"` : ''}><span>${word}</span><input id="${id}" value="${LEN.fld(r3(v))}" inputmode="text" data-len="1"><span class="u">${LEN.unit()}</span></div>`;
    const numRow = (word, id, v, unit, tip) => `<div class="sd-row"${tip ? ` title="${esc(tip)}"` : ''}><span>${word}</span><input id="${id}" value="${v}" inputmode="decimal"><span class="u">${unit}</span></div>`;
    const selRow = (word, id, opts, v, tip) => `<div class="sd-row"${tip ? ` title="${esc(tip)}"` : ''}><span>${word}</span><select id="${id}">${opts.map(([k, t]) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select><span class="u"></span></div>`;
    const paramRow = (q, v) => {
      const id = `tx-p-${q.k}`, word = q.label.toLowerCase();
      if (q.shuffle) return `<div class="sd-row" title="another arrangement of the same pattern"><span>${word === 'seed' ? 'arrangement' : word}</span><button id="${id}" class="tx-shuffle">shuffle</button></div>`;
      if (q.type === 'select') return selRow(word, id, q.options.map(o => [o, o]), v);
      if (q.type === 'text') return `<div class="sd-row"><span>${word}</span><input id="${id}" class="wide" value="${esc(v)}"></div>`;
      if (q.unit === 'mm') return lenRow(word, id, v, q.tip);
      return numRow(word, id, v, q.unit === '°' ? '°' : '', q.tip);
    };
    let h = '';
    if (!part) {
      h += `<div class="sd-note">${S.parts.length ? 'Click a part to mark it.' : 'No parts on the bed yet.'}</div>`;
    } else {
      h += `<div class="sd-row tx-parthead"><span class="sd-h">${esc(part.name)}</span><button id="tx-new" title="start another mark on this part (the brush paints it)">new mark</button>${m ? '<button id="tx-del" title="remove this mark (Delete, with select)">delete</button>' : ''}</div>`;
      if (part.tilted) h += '<div class="sd-note">This part is tipped over: TEX marks the top of a part lying flat.</div>';
      if (S.tool === 'points' && m && markHas(m)) {
        const c = curveOf(m), n = c.loops.reduce((a, L) => a + L.handles.length, 0);
        h += `<div class="sd-row tx-ptsrow" title="how many points the edge is fitted to: fewer is smoother, more follows the paint closer"><span>points</span><input id="tx-npts" value="${n}" inputmode="numeric"><button id="tx-fewer" title="fewer points: smoother">fewer</button><button id="tx-more" title="more points: closer to the paint">more</button></div>`;
      }
      if (part.marks.length) h += `<div class="tx-picks">${part.marks.map((q, i) => `<button class="tx-pick${i === S.mark ? ' on' : ''}" data-mi="${i}" title="pick this mark">${esc(markName(q, i))}</button>`).join('')}</div>`;
      if (m && markHas(m) && (S.tool === 'select' || S.tool === 'points')) h += '<div class="sd-row tx-makes"><button id="tx-as-part" title="a new part from this mark\'s outline, beside this one, the board\'s thickness (in DRAW: press done to make it)">make it a part</button><button id="tx-as-hole" title="cut this mark\'s outline through the part, as DRAW\'s holes (in DRAW: press done to make it)">make it a hole</button></div>';
      if (!m) h += `<div class="sd-note">${part.marks.length ? 'Pick a mark, or start a new one.' : 'Paint on the part with the brush, or drag a rectangle or an ellipse: that is the mark. Then fill it here.'}</div>`;
    }
    const expert = document.body.classList.contains('swarf-expert');
    const bitRow = f => {
      const lib = libraryBits(f.fill === 'pierce');
      const opts = lib.length ? lib.map(([t, b]) => [String(t.id), `${b.name}${b.type === 'v' ? '' : ''}`]) : Object.entries(BITS).map(([k, b]) => [k, b.say]);
      return selRow('bit', 'tx-bit', opts, String(f.tool), f.fill === 'pierce' ? 'the straight bit that cuts the kerfs or holes; its width is the kerf' : 'the bit that cuts it: ball for smooth hollows, V for sharp grooves');
    };
    // pierce lives in advanced mode; a pierce mark seen from basic mode can still go back to
    // texture (review 10-30 F11), and says where pierce lives
    const fillRow = f => (expert || f.fill === 'pierce' ? `<div class="sd-row tx-fills" title="texture carves the top; pierce cuts through it"><span>fill</span><button class="tx-fill${f.fill === 'texture' ? ' on' : ''}" data-fill="texture">texture</button><button class="tx-fill${f.fill === 'pierce' ? ' on' : ''}" data-fill="pierce">pierce</button></div>${expert ? '' : '<div class="sd-note tx-adv">Pierce lives in advanced mode (view › advanced): here it can go back to texture.</div>'}` : `<div class="sd-h">${f.fill}</div>`);
    if (m && m.fill.fill === 'pierce') {
      const f = m.fill, P = C.PIERCES[f.pattern], pr = { ...C.pierceDefaults(f.pattern, part.thick), ...(f.params || {}) };
      h += fillRow(f);
      h += selRow('pattern', 'tx-pat', Object.entries(C.PIERCES).map(([k, q]) => [k, q.label]), f.pattern, P.blurb);
      if (f.pattern === 'kerf') h += kerfPicture(part, f, pr);
      const tex = m.info && m.info.ver === m.ver ? m.info : null;
      if (!tex) h += '<div class="sd-note">Working out the cut…</div>';
      else {
        h += `<div class="sd-note">${tex.seconds > 0 ? `About ${C.formatTime(tex.seconds)} to cut.` : 'Nothing to cut yet: no cut fits in the mark (below says why).'}</div>`;
        for (const n of tex.notes) h += `<div class="sd-note">${esc(n)}</div>`;
        for (const w of tex.warnings) h += `<div class="sd-note tx-warn">${esc(w)}</div>`;
      }
      for (const q of P.params) if (q.basic) h += paramRow(q, pr[q.k]);
      h += lenRow('soft edge', 'tx-fade', f.fade || 0, 'how far in from the mark\'s edge the pattern thins out: shorter slots, smaller holes');
      h += numRow(f.pattern === 'kerf' ? 'bend line' : 'turn', 'tx-angle', r3(f.angle || 0), '°', f.pattern === 'kerf' ? 'which way the kerfs run: the part bends across them' : 'the lattice turned');
      h += bitRow(f);
      h += '<div class="sd-row"><button id="tx-svg-save" title="the cuts as an SVG in mm for the laser: cuts on the red layer, holes on the blue">save for the laser (svg)</button></div>';
      // bridges and slots are second-order: folded, also in advanced mode
      const more = S.morePierce ?? false;
      h += `<details class="tx-more tx-more-p"${more ? ' open' : ''}><summary>more</summary>`;
      for (const q of P.params) if (!q.basic) h += paramRow(q, pr[q.k]);
      h += '</details>';
    } else if (m) {
      const f = m.fill, P = C.PATTERNS[f.pattern], pr = { ...C.defaults(f.pattern), ...(f.params || {}) };
      const compact = window.innerHeight < 820;
      h += `${fillRow(f)}<div class="tx-sws${compact ? ' tx-compact' : ''}">${Object.entries(C.PATTERNS).map(([k, p]) => `<button class="tx-sw${k === f.pattern ? ' on' : ''}" data-pat="${k}" aria-label="${esc(p.label)}: ${esc(p.blurb)}" data-hint="${esc(compact ? p.label : `${p.label}: ${p.blurb}`)}"><img alt="" src="${swatchHref(k)}"><span>${esc(p.short)}</span></button>`).join('')}</div>`;
      // at 720p the swatches keep their captions on two rows of five (review 10-30 B3: ten unlabeled
      // 16 px squares); the hint line goes (the captions and the pattern select name it) and path folds into more
      if (!compact) h += `<div class="sd-note tx-swhint" id="tx-swhint">${esc(`${P.label}: ${P.blurb}`)}</div>`;
      h += selRow('pattern', 'tx-pat', Object.entries(C.PATTERNS).map(([k, p]) => [k, p.label]), f.pattern, P.blurb);
      // what it costs and what to watch for, up by the pattern where it is seen
      const tex = m.info && m.info.ver === m.ver ? m.info : null;
      if (!tex) h += '<div class="sd-note">Working out the cut…</div>';
      else {
        h += `<div class="sd-note">About ${C.formatTime(tex.seconds)} to cut.</div>`;
        for (const w of tex.warnings) h += `<div class="sd-note tx-warn">${esc(w)}</div>`;
      }
      for (const q of P.params) if (q.basic) h += paramRow(q, pr[q.k]);
      h += lenRow('depth', 'tx-depth', f.depth, 'the deepest the texture goes below the part\'s top');
      h += lenRow('soft edge', 'tx-fade', f.fade || 0, 'how far in from the mark\'s edge the texture takes to reach its full depth');
      h += bitRow(f);
      const kind = P.build(C.defaults(f.pattern)).kind;
      const ok = { auto: true, raster: true, crosshatch: true, plunge: kind === 'dots', centerline: kind === 'strokes' };
      const pathRow = selRow('path', 'tx-path', Object.entries(PATHS).filter(([k]) => ok[k]).map(([k, t]) => [k, k === 'auto' && tex ? `${t}: ${PATHS[tex.strategy]}` : t]), ok[f.path] ? f.path : 'auto', 'how the bit goes over it: best picks one plunge per dot when the bit can make the dots, a V-bit along each groove, else raster');
      if (!compact) h += pathRow;
      // the pattern's finer points: folded, open in advanced mode
      const more = S.more ?? document.body.classList.contains('swarf-expert');
      h += `<details class="tx-more"${more ? ' open' : ''}><summary>more</summary>`;
      if (compact) h += pathRow;
      for (const q of P.params) if (!q.basic && q.k !== 'depth') h += paramRow(q, pr[q.k]);
      h += numRow('scale', 'tx-scale', r3((f.scale || 1) * 100), '%', 'the pattern larger or smaller');
      h += numRow('turn', 'tx-angle', r3(f.angle || 0), '°', 'the pattern turned');
      h += lenRow('grit', 'tx-grit', f.grit || 0, 'a fine, rough noise added on top (0 for none)');
      h += '</details>';
    }
    if (part && part.marks.some(markHas)) {
      const res = S.meshRes || r3(T().autoMeshRes(part.loops)), size = T().partMeshSize(part.loops, res);
      h += `<details class="tx-more tx-mesh"${S.meshOpen ? ' open' : ''}><summary>save as a mesh</summary>
        ${selRow('version', 'tx-mesh-cut', [['designed', 'as designed'], ['cut', 'as cut']], S.meshCut ? 'cut' : 'designed', 'as designed: each pattern\'s own surface; as cut: what the bits leave, as simulate shows it')}
        ${selRow('file', 'tx-mesh-fmt', [['stl', 'STL'], ['obj', 'OBJ'], ['glb', 'GLB']], S.meshFmt || 'stl', 'the part with its marks, a closed solid: STL and OBJ in mm, GLB (glTF) in meters with y up as glTF wants')}
        ${lenRow('detail', 'tx-mesh-res', res, 'the grid the top is made on: finer is closer and bigger')}
        <div class="sd-note">About ${(size.triangles / 1000).toFixed(0)} thousand triangles, ${(size.triangles * 50 / 1e6).toFixed(1)} MB as STL.</div>
        <div class="sd-row"><button id="tx-mesh-save" title="the part as a mesh with its marks, for rendering">save the part</button></div></details>`;
    }
    ui.card.innerHTML = h;
    ui.card.scrollTop = keepTop;
    scrollCue();
    const rd = el => (el.dataset.len ? LEN.parse(el.value) : parseFloat(el.value));
    const bind = (id, fn) => {
      const el = $(id); if (!el) return;
      if (el.tagName === 'SELECT') { el.onchange = () => { fn(el.value, el); ui.svg.focus(); }; return; }
      if (el.tagName === 'BUTTON') { el.onclick = () => { fn(null, el); ui.svg.focus(); }; return; }
      const value = () => (el.classList.contains('wide') ? el.value : rd(el));
      // Enter takes the value at once (as DRAW's fields do); the change that follows on blur is the same one
      el.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') { el.dataset.took = el.value; fn(value(), el); el.blur(); } if (e.key === 'Escape') { render(); ui.svg.focus(); } };
      el.onchange = () => { if (el.dataset.took === el.value) return; fn(value(), el); };
    };
    for (const b of ui.card.querySelectorAll('.tx-pick')) b.onclick = () => { S.mark = +b.dataset.mi; render(); checkSoon(); ui.svg.focus(); };
    const md = ui.card.querySelector('.tx-mesh');
    if (md) md.ontoggle = () => { if (S) { S.meshOpen = md.open; scrollCue(); } };
    bind('tx-mesh-cut', v => { S.meshCut = v === 'cut'; render(); });
    bind('tx-mesh-fmt', v => { S.meshFmt = v; render(); });
    bind('tx-mesh-res', v => { if (!(v >= 0.1)) return say('Give the detail at least 0.1 mm.'); S.meshRes = r3(v); render(); });
    const ms = $('tx-mesh-save');
    if (ms) ms.onclick = () => saveMesh(part);
    const det = ui.card.querySelector('.tx-more');
    // the toggle event lands after the card is drawn, so TEX may have closed by then
    if (det) det.ontoggle = () => { if (!S) return; if (det.classList.contains('tx-more-p')) S.morePierce = det.open; else S.more = det.open; scrollCue(); };
    const nb = $('tx-new');
    if (nb) nb.onclick = () => { snap(); part.marks.push(newMark(part)); S.mark = part.marks.length - 1; part.dirty = true; if (S.tool === 'select') S.tool = 'brush'; say('A new mark: paint it on the part.'); render(); ui.svg.focus(); };
    for (const [id, as] of [['tx-as-part', 'part'], ['tx-as-hole', 'hole']]) { const b = $(id); if (b) b.onclick = () => { makeOutline(part, m, as); }; }
    const db = $('tx-del');
    if (db) db.onclick = () => { delMark(); ui.svg.focus(); };
    const cnt = () => (m && m.curve ? m.curve.count : 12);
    const fw = $('tx-fewer'), mo = $('tx-more');
    if (fw) fw.onclick = () => { pointsCount(cnt() * 0.75); ui.svg.focus(); };
    if (mo) mo.onclick = () => { pointsCount(cnt() * 1.35 + 1); ui.svg.focus(); };
    bind('tx-npts', v => { if (!(v >= 4)) return say('Give it at least 4 points.'); const c = m.curve, tot = c.loops.reduce((a, L) => a + L.handles.length, 0); pointsCount(c.count * v / Math.max(1, tot)); });
    if (!m) return;
    const f = m.fill;
    // every change to the fill: undoable, remembered for the next mark, the picture and checks again
    const set = (fn) => { snap(); fn(f); m.ver++; part.dirty = true; try { localStorage.setItem(FILL, JSON.stringify({ ...f, origin: [0, 0] })); } catch (e) { /* private */ } render(); imagesSoon(); checkSoon(); };
    const pierce = f.fill === 'pierce';
    const pick = v => set(f => { if (pierce) { f.pattern = v; f.params = C.pierceDefaults(v, part.thick); return; } f.pattern = v; f.params = C.defaults(v); f.depth = f.params.depth; if (!PATHS[f.path]) f.path = 'auto'; });
    for (const b of ui.card.querySelectorAll('.tx-fill')) b.onclick = () => {
      const to = b.dataset.fill;
      if (to !== f.fill) {
        snap();
        const keep = { angle: f.angle || 0, origin: f.origin, fade: to === 'pierce' ? 0 : 3 };
        m.fill = normBit(to === 'pierce' ? C.newPierce('kerf', keep, part.thick) : { ...C.newFill('waves'), ...keep });
        m.ver++; part.dirty = true;
        say(to === 'pierce' ? 'Pierce: cuts through the part. A starting point: cut a test strip first.' : 'Texture: carved into the part\'s top.');
        render(); imagesSoon(); checkSoon();
      }
      ui.svg.focus();
    };
    const sv = $('tx-svg-save');
    if (sv) sv.onclick = () => {
      const txt = T().pierceSVG({ region: m.region, xf: m.xf, fill: m.fill }, { thickness: part.thick });
      if (!txt) return say('Nothing to save: no cut fits in the mark yet (the card says why).');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([txt], { type: 'image/svg+xml' }));
      a.download = `${part.name}-${f.pattern}.svg`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      say(`Saved ${a.download}: cuts on the red layer, holes on the blue, in mm.`);
    };
    bind('tx-pat', pick);
    const hint = $('tx-swhint'), hint0 = hint && hint.textContent;
    for (const b of ui.card.querySelectorAll('.tx-sw')) {
      b.onclick = () => { if (b.dataset.pat !== f.pattern) pick(b.dataset.pat); ui.svg.focus(); };
      b.onmouseenter = () => { if (hint) hint.textContent = b.dataset.hint; };
      b.onmouseleave = () => { if (hint) hint.textContent = hint0; };
    }
    for (const q of (pierce ? C.PIERCES : C.PATTERNS)[f.pattern].params) {
      if (q.k === 'depth') continue;
      bind(`tx-p-${q.k}`, v => {
        if (q.shuffle) {
          const was = (f.params || {})[q.k] ?? q.def;
          let n = was;
          while (n === was) n = q.min + Math.floor(Math.random() * (q.max - q.min + 1));
          return set(f => { f.params = { ...C.defaults(f.pattern), ...(f.params || {}), [q.k]: n }; });
        }
        if (q.type === 'range') {
          if (!isFinite(v)) return say(`Give ${q.label.toLowerCase()} a number.`);
          if (v < q.min || v > q.max) return say(`${q.label} goes from ${q.unit === 'mm' ? LEN.say(q.min) : q.min} to ${q.unit === 'mm' ? LEN.say(q.max) : q.max}${q.unit && q.unit !== 'mm' ? q.unit : ''}.`);
        }
        set(f => { f.params = { ...(pierce ? C.pierceDefaults(f.pattern, part.thick) : C.defaults(f.pattern)), ...(f.params || {}), [q.k]: q.type === 'range' ? r3(v) : v }; });
      });
    }
    bind('tx-scale', v => { if (!(v >= 5 && v <= 2000)) return say('Scale is a percentage from 5 to 2000.'); set(f => { f.scale = r3(v / 100); }); });
    bind('tx-angle', v => { if (!isFinite(v)) return; set(f => { f.angle = r3(v); }); });
    bind('tx-fade', v => { if (!(v >= 0)) return say('The soft edge is 0 or more.'); set(f => { f.fade = r3(v); }); });
    bind('tx-depth', v => {
      if (!(v >= 0.1)) return say('Give the texture at least 0.1 mm of depth.');
      set(f => { f.depth = r3(v); f.params = { ...(f.params || {}), depth: r3(v) }; });
      if (part.thick && v >= part.thick) say(`${LEN.prose(v)} is as deep as ${part.name} is thick: the texture would cut through. It stops at the board's bottom.`);
    });
    bind('tx-grit', v => { if (!(v >= 0 && v <= 3)) return say('Grit goes from 0 to 3 mm.'); set(f => { f.grit = r3(v); }); });
    bind('tx-bit', v => set(f => {
      const t = ((api().conf.get().tools) || []).find(t => String(t.id) === String(v));
      if (t && bitOf(t)) { f.tool = t.id; f.bit = bitOf(t); } else { f.tool = v; delete f.bit; }
    }));
    bind('tx-path', v => set(f => { f.path = v; }));
  }
  // a card taller than its room fades at the bottom while there is more below
  function scrollCue() {
    const c = ui.card;
    if (!c) return;
    c.classList.toggle('tx-below', c.scrollHeight - c.scrollTop - c.clientHeight > 4);
  }
  function say(t) { const el = $('tx-say'); if (el) el.textContent = t || ''; }

  // what a mark will cut, how long it takes, and what to watch for: worked out off the page's
  // thread (swarf-tex-worker.mjs), its lengths said here in cam's units
  let worker = null, asked = 0;
  const pending = new Map();
  function texWorker() {
    if (worker === false) return null;
    if (worker) return worker;
    try {
      worker = new Worker(new URL('swarf-tex-worker.mjs', document.baseURI), { type: 'module' });
      worker.onmessage = e => { const r = pending.get(e.data.id); pending.delete(e.data.id); if (r) r(e.data); };
      worker.onerror = () => { worker = false; for (const r of pending.values()) r({ error: 'no worker' }); pending.clear(); };
    } catch (e) { worker = false; }
    return worker || null;
  }
  // a length in the card's sentences: in inches the nearest 16th (SwarfLength.prose; r086 check S3),
  // in mm as before. Every length the checks say passes here once, so one pitch reads one way.
  const prose = v => (LEN.unit() === 'in' ? LEN.prose(v) : LEN.say(T().roundProse(v)));
  const says = t => String(t).replace(/⟦([-\d.e+]+)⟧/g, (_, v) => prose(+v));
  function info(part, m) {
    const op = stepOf(m.id) || {}, ver = m.ver;
    const ask = { mark: { id: m.id, region: m.region, xf: m.xf, fill: m.fill }, thickness: part.thick, part: part.loops, down: op.down || 0, rate: op.rate || 1500, plunge: op.plunge || 500 };
    const done = r => (r.error ? null : { ver, warnings: r.warnings.map(says), notes: r.notes.map(says), strategy: r.strategy, seconds: r.seconds });
    const w = texWorker();
    if (w) return new Promise(res => { const id = ++asked; pending.set(id, r => res(done(r) || here())); w.postMessage({ id, ...ask }); });
    return Promise.resolve(here());
    // no worker (an old browser): the same work here
    function here() {
      const C = T(), chk = C.markChecks(ask.mark, { thickness: part.thick, len: v => `⟦${v}⟧`, part: part.loops });
      let seconds = 0, strategy = 'raster';
      if (chk.tex || chk.cuts) { const p = C.markToolpath(ask.mark, { maxDepth: part.thick, stepDown: ask.down, res: 0.6, part: part.loops }); seconds = C.estimateTime(p.moves, { feed: ask.rate / 60, plunge: ask.plunge / 60 }).seconds; strategy = p.strategy; }
      return done({ warnings: chk.warnings, notes: chk.notes, strategy, seconds });
    }
  }
  function checkSoon() {
    if (!S) return;
    clearTimeout(S.checkT);
    S.checkT = setTimeout(() => {
      if (!S) return;
      const p = curPart(), m = curMark();
      if (!(p && m && markHas(m)) || (m.info && m.info.ver === m.ver) || m.asking === m.ver) return;
      m.asking = m.ver;
      info(p, m).then(r => {
        m.asking = 0;
        if (!S || !r || r.ver !== m.ver) return;
        m.info = r; m.est = r.seconds;
        if (!S.drag) render();
      }).catch(e => { m.asking = 0; console.warn('swarf tex', e); });
    }, 250);
  }

  // ── edits ──
  function snap() {
    S.undo.push({ sel: S.sel, mark: S.mark, parts: S.parts.map(p => ({ dirty: p.dirty, marks: p.marks.map(m => ({ ...m, region: { ...m.region, data: m.region.data.slice() }, xf: m.xf.slice(), fill: clone(m.fill), img: null, info: null })) })) });
    if (S.undo.length > 60) S.undo.shift();
  }
  function undo() {
    if (!S.undo.length) return;
    const u = S.undo.pop();
    u.parts.forEach((q, i) => { S.parts[i].marks = q.marks.map(m => ({ ...m, ver: (m.ver || 1) + 1, curve: m.curve ? { count: m.curve.count, ver: -1 } : null })); S.parts[i].dirty = true; });
    S.sel = u.sel; S.mark = u.mark;
    render(); imagesSoon(); checkSoon();
  }
  function delMark() {
    const p = curPart(), m = curMark();
    if (!m) return;
    snap();
    p.marks.splice(S.mark, 1); p.dirty = true;
    S.mark = p.marks.length ? Math.min(S.mark, p.marks.length - 1) : -1;
    say('The mark is gone (⌘Z brings it back). Done removes its step.');
    render();
  }
  function setTool(t) {
    S.tool = t; S.box = null; S.drag = null;
    const m = curMark();
    if (t === 'points' && m && markHas(m)) {
      const c = curveOf(m), n = c.loops.reduce((a, L) => a + L.handles.length, 0);
      say(`The edge fitted to ${n} points; more follows the paint closer. Drag one to reshape it; click the edge to add one.`);
    } else say(t === 'select' ? '' : `${WORD[t]}: ${TOOLS[t].replace(/ \(\w\)$/, '')}.`);
    render(); ui.svg.focus();
  }
  // the part under a bed point: the smallest whose top it is on
  function partAt(p) {
    let best = -1, area = Infinity;
    S.parts.forEach((q, i) => {
      if (q.tilted) return;
      const l = [p[0] - q.pos[0], p[1] - q.pos[1]];
      if (!onPart(l, q.loops)) return;
      const a = (q.box[2] - q.box[0]) * (q.box[3] - q.box[1]);
      if (a < area) { area = a; best = i; }
    });
    return best;
  }
  // the mark a tool works on: the picked part's picked mark; a press on another part picks it (and its
  // first mark, or a new one); a press off every part, with one picked, still marks the picked one
  function target(p, make) {
    const at = partAt(p);
    if (at >= 0 && at !== S.sel) { S.sel = at; S.mark = S.parts[at].marks.length ? 0 : -1; }
    const part = curPart();
    if (!part) { say('Press on a part: a mark lives on a part.'); return null; }
    if (part.tilted) { say(`${part.name} is tipped over: TEX marks the top of a part lying flat.`); return null; }
    if (!curMark() && make) { part.marks.push(newMark(part, WORD[S.tool])); S.mark = part.marks.length - 1; }
    return curMark() ? { part, m: curMark() } : null;
  }
  // a mark takes paint only on its part's top, less its holes (Phil 10-30: paint never goes past
  // the top's edge; where it meets the edge the pattern runs full to it, swarf-tex-core clipToPart)
  const onTop = (part, m) => (u, v) => onPart(T().xfApply(m.xf, u, v), part.loops);
  function stamp(t, a, b, val) {
    const { part, m } = t, s = T().xfScale(m.xf);
    const A = toMark(part, m, a), B = toMark(part, m, b), r = S.brush / 2 / s, seg = [A[0], A[1], B[0], B[1]], top = onTop(part, m);
    const d2 = (x, y) => { const ex = B[0] - A[0], ey = B[1] - A[1], L = ex * ex + ey * ey, t = L > 0 ? Math.max(0, Math.min(1, ((x - A[0]) * ex + (y - A[1]) * ey) / L)) : 0; return (x - A[0] - t * ex) ** 2 + (y - A[1] - t * ey) ** 2; };
    const box = [Math.min(seg[0], seg[2]) - r, Math.min(seg[1], seg[3]) - r, Math.max(seg[0], seg[2]) + r, Math.max(seg[1], seg[3]) + r];
    if (T().paintWhere(m.region, (x, y) => d2(x, y) <= r * r && (!val || top(x, y)), val, box)) { m.ver++; part.dirty = true; }
  }
  function shapeInto(t, box, kind, val) {
    const { part, m } = t;
    const x0 = Math.min(box[0][0], box[1][0]), x1 = Math.max(box[0][0], box[1][0]), y0 = Math.min(box[0][1], box[1][1]), y1 = Math.max(box[0][1], box[1][1]);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
    const top = onTop(part, m);
    const test = (u, v) => { const [x, y] = T().xfApply(m.xf, u, v), X = x + part.pos[0], Y = y + part.pos[1]; return (kind === 'rect' ? X >= x0 && X <= x1 && Y >= y0 && Y <= y1 : ((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2 <= 1) && (!val || top(u, v)); };
    const cs = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(q => toMark(part, m, q));
    const n = T().paintWhere(m.region, test, val, [Math.min(...cs.map(q => q[0])), Math.min(...cs.map(q => q[1])), Math.max(...cs.map(q => q[0])), Math.max(...cs.map(q => q[1]))]);
    if (n) { m.ver++; part.dirty = true; }
    return n;
  }
  // a region: the closed area of the part that the press is in (its top less its holes, or a hole's own)
  function regionInto(t, p, val) {
    const { part, m } = t;
    const l = [p[0] - part.pos[0], p[1] - part.pos[1]];
    const inside = part.loops.filter(L => inLoop(l, L));
    if (!inside.length) { say('Click inside the part.'); return 0; }
    if (inside.length % 2 === 0) { say('That is a hole in the part: there is nothing there to texture.'); return 0; }
    const own = inside.reduce((a, L) => (loopArea(L) < loopArea(a) ? L : a));
    const kids = part.loops.filter(L => L !== own && inLoop(L[0], own) && loopArea(L) < loopArea(own));
    const test = (u, v) => { const q = T().xfApply(m.xf, u, v); return inLoop(q, own) && !kids.some(K => inLoop(q, K)); };
    const n = T().paintWhere(m.region, test, val);
    if (n) { m.ver++; part.dirty = true; }
    return n;
  }

  // ── pointer ──
  function down(e) {
    if (e.button === 1 || (e.button === 0 && S.space)) { S.drag = { kind: 'pan', x: e.clientX, y: e.clientY }; ui.svg.setPointerCapture(e.pointerId); return; }
    if (e.button !== 0) return;
    const p = toMM(e);
    S.alt = e.altKey;
    if (S.tool === 'points') { pointsDown(e, p); return; }
    if (S.tool === 'select') {
      const at = partAt(p);
      if (at < 0) { S.sel = -1; S.mark = -1; render(); return; }
      const part = S.parts[at];
      // a press on a mark picks it (the last made, on top, first)
      let mi = -1;
      for (let i = part.marks.length - 1; i >= 0 && mi < 0; i--) {
        const m = part.marks[i], g = m.region, [u, v] = toMark(part, m, p);
        const ci = Math.floor((u - g.x0) / g.res), cj = Math.floor((v - g.y0) / g.res);
        if (ci >= 0 && cj >= 0 && ci < g.nx && cj < g.ny && g.data[cj * g.nx + ci]) mi = i;
      }
      S.sel = at; S.mark = mi >= 0 ? mi : (S.sel === at && curMark() ? S.mark : (part.marks.length ? 0 : -1));
      render(); checkSoon();
      return;
    }
    const erase = S.tool === 'erase' || e.altKey;
    if (S.tool === 'region') {
      snap();
      const t = target(p, !erase);
      if (!t) { S.undo.pop(); render(); return; }
      const n = regionInto(t, p, erase ? 0 : 1);
      if (!n) S.undo.pop(); else say(erase ? 'Taken out of the mark.' : t.part.drawn ? 'The region is in the mark.' : `The part's box is in the mark: ${t.part.name} has no drawing to find its outline from.`);
      render(); imagesSoon(); checkSoon();
      return;
    }
    snap();
    const t = target(p, !erase);
    if (!t) { S.undo.pop(); render(); return; }
    if (S.tool === 'brush' || S.tool === 'erase') {
      S.drag = { kind: 'paint', t, last: p, val: erase ? 0 : 1, changed: false };
      stamp(t, p, p, S.drag.val);
    } else S.drag = { kind: 'shape', t, at: p, val: erase ? 0 : 1 };
    ui.svg.setPointerCapture(e.pointerId);
    render();
  }
  function move(e) {
    const p = toMM(e), d = S.drag;
    S.alt = e.altKey;
    if (!d) { if (S.tool === 'brush' || S.tool === 'erase') { S.hover = p; renderSoon(); } return; }
    if (d.kind === 'pan') { S.ox += e.clientX - d.x; S.oy += e.clientY - d.y; d.x = e.clientX; d.y = e.clientY; render(); return; }
    if (d.kind === 'pt' || d.kind === 'ptbox') { pointsMove(p, d); return; }
    if (d.kind === 'paint') {
      S.hover = p;
      if (Math.hypot(p[0] - d.last[0], p[1] - d.last[1]) * S.k < 1.5) return;
      if (S.tool === 'brush') d.val = e.altKey ? 0 : 1;
      stamp(d.t, d.last, p, d.val);
      d.last = p;
      renderSoon();
      return;
    }
    if (d.kind === 'shape') {
      let b = p;
      if (e.shiftKey) { const s = Math.max(Math.abs(b[0] - d.at[0]), Math.abs(b[1] - d.at[1])); b = [d.at[0] + Math.sign(b[0] - d.at[0] || 1) * s, d.at[1] + Math.sign(b[1] - d.at[1] || 1) * s]; }
      d.to = b; S.box = [d.at, b];
      render();
      say(`${LEN.prose(Math.abs(b[0] - d.at[0]))} × ${LEN.prose(Math.abs(b[1] - d.at[1]))}`);
    }
  }
  function up() {
    const d = S.drag;
    S.drag = null;
    if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
    if (!d) return;
    if (d.kind === 'pt' || d.kind === 'ptbox') { pointsUp(d); return; }
    if (d.kind === 'shape') {
      S.box = null;
      const b = d.to;
      if (!b || Math.abs(b[0] - d.at[0]) < 1 || Math.abs(b[1] - d.at[1]) < 1) { S.undo.pop(); say('Drag farther: a shape needs at least 1 mm each way.'); render(); return; }
      if (!shapeInto(d.t, [d.at, b], S.tool, d.val)) { S.undo.pop(); say('That shape is off the mark\'s part.'); }
    }
    if (d.kind === 'paint' || d.kind === 'shape') {
      const m = d.t.m;
      if (!markHas(m) && d.val) say('Paint on the part: the mark is where you paint.');
      else if (d.val) say(`Marked. Pick its pattern in the card; press done to keep it.`);
    }
    render(); imagesSoon(); checkSoon();
  }
  function wheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const r = ui.svg.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const f = Math.exp(-e.deltaY * 0.01), k = Math.max(0.05, Math.min(200, S.k * f));
      S.ox = px - (px - S.ox) * k / S.k; S.oy = py - (py - S.oy) * k / S.k; S.k = k;
    } else { S.ox -= e.deltaX; S.oy -= e.deltaY; }
    render();
  }
  function key(e) {
    if (!S) return;
    const typing = e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName);
    if (typing) return;
    e.stopPropagation();
    const k = e.key;
    if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (k === 'Alt') { S.alt = true; window.addEventListener('keyup', function u(ev) { if (ev.key === 'Alt') { if (S) { S.alt = false; render(); } window.removeEventListener('keyup', u, true); } }, true); render(); return; }
    if (k === ' ') { e.preventDefault(); if (S.space) return; S.space = true; window.addEventListener('keyup', function u(ev) { if (ev.key === ' ') { if (S) S.space = false; window.removeEventListener('keyup', u, true); } }, true); return; }
    if (k === 'Escape') {
      e.preventDefault();
      if (S.drag) { S.drag = null; S.box = null; render(); return; }
      if (S.tool !== 'select') { setTool('select'); return; }
      if (S.mark >= 0) { S.mark = -1; render(); return; }
      if (S.sel >= 0) { S.sel = -1; render(); return; }
      // the last Escape leaves, never throwing marks away without asking (as DRAW)
      if (S.parts.some(p => p.dirty) && !(S.escAt && performance.now() - S.escAt < 3000)) {
        S.escAt = performance.now();
        say('Press Escape again to leave without your changes, or done to keep them.');
        return;
      }
      close(false);
      return;
    }
    if (e.metaKey || e.ctrlKey) return;
    const lk = k.toLowerCase();
    if (KEYS[lk]) { setTool(KEYS[lk]); return; }
    if (lk === 'f') { fit(!S.whole); render(); return; }
    if (k === '[' || k === ']') {
      S.brush = r3(Math.max(0.5, Math.min(300, S.brush * (k === ']' ? 1.25 : 0.8))));
      try { localStorage.setItem(BRUSH, String(S.brush)); } catch (er) { /* private */ }
      say(`Brush ${LEN.prose(S.brush)} across.`); render(); return;
    }
    if ((k === 'Delete' || k === 'Backspace') && S.tool === 'points') { e.preventDefault(); pointsDelete(); return; }
    if ((k === 'Delete' || k === 'Backspace') && curMark() && S.tool === 'select') { e.preventDefault(); delMark(); return; }
    // arrows slide the picked points (points), else the picked mark on its part (shift: 10 mm)
    const ar = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[k];
    const m = curMark();
    if (ar && m && S.tool === 'points' && S.pts && S.pts.size) {
      e.preventDefault();
      const part = curPart(), st = e.shiftKey ? 10 : 1, I = T().xfInvert(m.xf);
      // a step on the part, in the mark's frame (its turn and scale undone)
      const du = I[0] * ar[0] * st + I[1] * ar[1] * st, dv = I[2] * ar[0] * st + I[3] * ar[1] * st;
      const curve = clone({ loops: curveOf(m).loops, count: m.curve.count });
      for (const id of S.pts) { const [li, i] = id.split(':').map(Number), h = curve.loops[li] && curve.loops[li].handles[i]; if (h) { h[0] += du; h[1] += dv; } }
      snap();
      const keep = new Set(S.pts);
      if (rewrite(part, m, { ...m.region, data: m.region.data.slice() }, curve)) S.pts = keep; else S.undo.pop();
      render(); imagesSoon(); checkSoon();
      return;
    }
    if (ar && m) {
      e.preventDefault();
      const s = e.shiftKey ? 10 : 1;
      snap(); m.xf[4] += ar[0] * s; m.xf[5] += ar[1] * s; m.ver++; curPart().dirty = true;
      render(); imagesSoon(); checkSoon();
    }
  }

  // ── done: each changed part keeps its marks; the steps follow ──
  function commit() {
    const a = api();
    let kept = 0, changed = 0;
    for (const p of S.parts) {
      if (!p.dirty) continue;
      changed++;
      const list = p.marks.filter(markHas);
      for (const m of list) if (!(m.info && m.info.ver === m.ver)) delete m.est;
      if (list.length) p.w.meta.tex = list.map(storeMark); else delete p.w.meta.tex;
      kept += list.length;
      // saved now, not on the usual delay: a reload right after done keeps the marks
      if (p.w.saveState) p.w.saveState(() => {});
    }
    if (!changed) return '';
    const r = syncSteps(a);
    const ops = a.conf.get().process.ops || [], free = ops.some(o => o && (o.type === 'outline' || o.type === 'rough'));
    // worded per fill (review 10-30 F5: a pierce mark's toast said "a texture step")
    const by = r.addedBy || { texture: r.added, pierce: 0 };
    const kinds = ['texture', 'pierce'].filter(k => by[k]).map(k => (by[k] === 1 ? `${r.added === 1 ? 'a' : '1'} ${k} step` : `${by[k]} ${k} steps`));
    const added = `${kinds.join(' and ')} ${r.added === 1 ? 'was' : 'were'} added`;
    const steps = r.added ? (free ? `${added} before the cut-out` : `${added}; add an outline to cut the part free`) : r.removed ? `${r.removed === 1 ? 'its step was' : `${r.removed} steps were`} removed` : 'their steps cut them';
    return kept ? `${kept === 1 ? '1 mark is' : `${kept} marks are`} kept: ${steps}. Next: toolpaths.` : `No marks left${r.removed ? `: ${steps}` : ''}.`;
  }

  // ── the steps: one texture step per mark, before the steps that cut the parts free ──
  const STEP = o => o && (o.type === 'texture' || o.type === 'pierce');
  const stepType = mark => (mark.fill && mark.fill.fill === 'pierce' ? 'pierce' : 'texture');
  function stepOf(id) {
    const a = api(), ops = (a && a.conf.get().process.ops) || [];
    return ops.find(o => STEP(o) && o.texmark === id) || null;
  }
  function kiriTool(bit, tools) {
    if (typeof bit === 'number' && tools.some(t => t.id === bit)) return bit;
    const want = (BITS[bit] || BITS.ball14).tool;
    if (tools.some(t => t.id === want)) return want;
    const ball = tools.find(t => t.type === 'ballmill');
    return ball ? ball.id : (tools[0] && tools[0].id);
  }
  function marksOnBed(a) {
    const out = new Map();
    for (const w of a.widgets.all()) {
      if (!(w.meta && Array.isArray(w.meta.tex))) continue;
      for (const m of w.meta.tex) {
        if (!out.has(m.id)) out.set(m.id, { mark: m, ws: [] });
        out.get(m.id).ws.push(w);
      }
    }
    return out;
  }
  const stepLabel = e => {
    const names = e.ws.map(nameOf);
    const who = names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
    const pierce = stepType(e.mark) === 'pierce', P = (pierce ? T().PIERCES : T().PATTERNS)[e.mark.fill.pattern];
    return `${pierce ? 'pierce' : 'texture'}: ${P ? P.label.toLowerCase() : e.mark.fill.pattern} on ${who}`;
  };
  // addOnly: a part come back (undo of a delete) gets its steps again, and nothing is taken away
  // (parts arrive one by one when a workspace loads)
  function syncSteps(a, addOnly) {
    a = a || api();
    const s = a.conf.get(), proc = s.process, ops = proc.ops || (proc.ops = []);
    const marks = marksOnBed(a);
    let added = 0, removed = 0, changed = false;
    const addedBy = { texture: 0, pierce: 0 };
    for (let i = ops.length - 1; i >= 0 && !addOnly; i--) {
      const o = ops[i];
      if (STEP(o) && !marks.has(o.texmark)) { ops.splice(i, 1); removed++; }
    }
    const tools = s.tools || [], base = new Map();
    for (const [id, e] of marks) {
      let op = ops.find(o => STEP(o) && o.texmark === id);
      const type = stepType(e.mark);
      // a mark whose fill changed: its step changes kind, and moves to its kind's place
      if (op && op.type !== type) { ops.splice(ops.indexOf(op), 1); op.type = type; delete op.preset; op = { ...op, moved: true }; }
      const tool = kiriTool(e.mark.fill.tool, tools), label = stepLabel(e);
      base.set(id, label);
      if (!op || op.moved) {
        const like = ops.find(o => o && (o.type === 'outline' || o.type === 'rough')) || {};
        const was = op;
        op = was ? { ...was } : {
          type, texmark: id, tool, texlabel: label,
          spindle: like.spindle || proc.camTraceSpindle || 12000, rate: like.rate || proc.camTraceSpeed || 1500,
          plunge: like.plunge || proc.camTracePlunge || 500, down: like.down || 2, marks: {}
        };
        delete op.moved;
        // texture first, then pierce, then the steps that cut parts free (an outline, a rough), all
        // before the end-of-steps marker
        let at = ops.findIndex(o => o && (o.type === 'outline' || o.type === 'rough' || o.type === '|' || (type === 'texture' && o.type === 'pierce')));
        if (at < 0) at = ops.length;
        ops.splice(at, 0, op);
        if (was) changed = true; else { added++; addedBy[type]++; }
        continue;
      }
      // a new bit: the material's numbers for it again (swarf-material.js re-derives an unstamped step)
      if (op.tool !== tool) { op.tool = tool; delete op.preset; changed = true; }
    }
    // two steps that would read alike are numbered, in the order they cut
    const count = {}, seen = {};
    for (const o of ops) if (STEP(o) && base.has(o.texmark)) count[base.get(o.texmark)] = (count[base.get(o.texmark)] || 0) + 1;
    for (const o of ops) {
      if (!(STEP(o) && base.has(o.texmark))) continue;
      const b = base.get(o.texmark), label = count[b] > 1 ? `${b} · ${(seen[b] = (seen[b] || 0) + 1)}` : b;
      if (o.texlabel !== label) { o.texlabel = label; changed = true; }
    }
    for (const o of ops) if (STEP(o)) { const e = marks.get(o.texmark); if (e && e.mark.est != null) o.texest = e.mark.est; }
    if (added || removed || changed) {
      a.conf.save();
      a.event.emit('cam.op.render');
    }
    return { added, removed, addedBy };
  }
  // each texture step's marks, from every part's own, when the toolpaths are made: the mark, the
  // part's top and its thickness (the moves never go below the board)
  function texAreas() {
    const a = api();
    const s = a.conf.get(), ops = (s.process || {}).ops || [];
    if (!ops.some(STEP)) return;
    const marks = marksOnBed(a);
    for (const op of ops) {
      if (!STEP(op)) continue;
      op.marks = {};
      const e = marks.get(op.texmark);
      if (!e) continue;
      op.tool = kiriTool(e.mark.fill.tool, s.tools || []);
      for (const w of e.ws) {
        if (w.meta.tilted) continue;
        const { top, thick } = sizeOf(w);
        const part = localLoops(w).loops;
        op.marks[w.id] = w.meta.tex.filter(m => m.id === op.texmark).map(mark => ({ mark, top, thick, part }));
      }
    }
  }

  // ── concerns (sync.js asks): what each mark cannot do as set ──
  const said = new Map();
  function concerns() {
    const a = api(), out = [];
    if (!a || !T()) return out;
    for (const w of a.widgets.all()) {
      if (!(w.meta && Array.isArray(w.meta.tex))) continue;
      const { thick } = sizeOf(w), name = nameOf(w);
      let loops = null;
      for (const m of w.meta.tex) {
        const key = JSON.stringify([m.id, m.fill, m.xf, thick, m.region.nx, (m.region.runs || []).length, LEN.unit(), w.meta.svg ? w.meta.svg.length : 0]);
        if (!said.has(key)) {
          loops = loops || localLoops(w).loops;
          const mark = { ...m, region: T().regionSpec(m.region) };
          const part = { loops };
          const chk = T().markChecks(mark, { thickness: thick, len: prose, part: part.loops });
          said.set(key, chk.warnings);
          if (said.size > 200) said.delete(said.keys().next().value);
        }
        const pierce = stepType(m) === 'pierce', P = (pierce ? T().PIERCES : T().PATTERNS)[m.fill.pattern];
        for (const body of said.get(key)) out.push({
          title: `${pierce ? 'pierce' : 'texture'}: ${P ? P.label.toLowerCase() : m.fill.pattern} on ${name}`,
          body,
          hint: /cut through/.test(body) ? 'tex: less depth, or a thicker board' : pierce ? 'tex: a gentler bend, bigger spacing or a thinner bit; cut a test strip first' : 'tex: another bit, a bigger pattern, or less depth'
        });
      }
    }
    return out;
  }

  // ── the part's turns, scales and mirrors after it was marked: each mark follows it ──
  function track(w, M) {
    const d = (w.track && w.track.center) || { dx: 0, dy: 0 };
    for (const g of (w.group && w.group.length ? w.group : [w])) {
      if (!(g.meta && Array.isArray(g.meta.tex) && g.meta.tex.length)) continue;
      for (const m of g.meta.tex) m.xf = T().xfThen(m.xf || T().IDENTITY, [M[0], M[1], M[2], M[3], -(d.dx || 0), -(d.dy || 0)]);
    }
  }
  function onRotate({ widget, x, y, z }) {
    if (typeof x !== 'number') {
      const q = x || {};
      if (Math.abs(q.x || 0) > 1e-9 || Math.abs(q.y || 0) > 1e-9) return;
      const t = 2 * Math.atan2(q.z || 0, q.w ?? 1);
      return track(widget, [Math.cos(t), -Math.sin(t), Math.sin(t), Math.cos(t)]);
    }
    if (Math.abs(x || 0) > 1e-9 || Math.abs(y || 0) > 1e-9) return;
    const t = z || 0;
    track(widget, [Math.cos(t), -Math.sin(t), Math.sin(t), Math.cos(t)]);
  }

  // ── wiring ──
  let tries = 0;
  const t = setInterval(() => {
    const a = api(), step = $('swarf-step-tex');
    if ((a && a.event && step) || ++tries > 200) {
      clearInterval(t);
      if (!a || !a.event) return;
      const later = fn => (...args) => { try { fn(...args); } catch (e) { console.warn('swarf tex', e); } };
      a.event.on('widget.scale', later(({ widget, x, y }) => track(widget, [x || 1, 0, 0, y || 1])));
      a.event.on('widget.rotate', later(onRotate));
      a.event.on('widget.mirror', later(({ widget }) => track(widget, [-1, 0, 0, 1])));
      a.event.on('slice.begin', later(() => texAreas()));
      // a part deleted or copied: its marks' steps follow (a copy shares its marks' steps)
      for (const ev of ['widget.delete', 'widget.duplicate']) a.event.on(ev, later(() => setTimeout(later(() => { if (T()) syncSteps(a); }), 0)));
      a.event.on('cam.op.deleted', later(rec => {
        if (!STEP(rec)) return;
        const names = [];
        for (const w of a.widgets.all()) {
          if (!(w.meta && Array.isArray(w.meta.tex))) continue;
          const left = w.meta.tex.filter(m => m.id !== rec.texmark);
          if (left.length === w.meta.tex.length) continue;
          if (left.length) w.meta.tex = left; else delete w.meta.tex;
          names.push(nameOf(w));
          if (w.saveState) w.saveState(() => {});
        }
        if (names.length) a.show.alert(`The mark on ${names.join(', ')} is gone with its step: open tex to mark it again.`, 8);
        syncSteps(a);
      }));
      a.event.on('widget.add', later(w => setTimeout(later(() => { if (T() && [].concat(w).some(x => x && x.meta && Array.isArray(x.meta.tex))) syncSteps(a, true); }), 0)));
      if (step && !step.dataset.wired) { step.dataset.wired = '1'; step.addEventListener('click', open); }
    }
  }, 150);

  function pierceAvoid(w) {
    const list = (w && w.meta && Array.isArray(w.meta.tex) ? w.meta.tex : []).filter(m => stepType(m) === 'pierce');
    if (!list.length || !T()) return null;
    const marks = list.map(m => ({ g: T().regionSpec(m.region), I: T().xfInvert(m.xf || T().IDENTITY), s: T().xfScale(m.xf || T().IDENTITY) }));
    const at = (q, x, y) => { const [u, v] = T().xfApply(q.I, x, y), g = q.g, i = Math.floor((u - g.x0) / g.res), j = Math.floor((v - g.y0) / g.res); return i >= 0 && j >= 0 && i < g.nx && j < g.ny && g.data[j * g.nx + i]; };
    return (x, y, r) => marks.some(q => { if (at(q, x, y)) return true; for (let k = 0; k < 16; k++) { const a = k / 16 * 2 * Math.PI; for (const f of [0.5, 1]) if (at(q, x + r * f * Math.cos(a), y + r * f * Math.sin(a))) return true; } return false; });
  }

  window.__swarfTex = { open, close, state: () => S, lastMesh: () => S && S.lastMesh, concerns, syncSteps, texAreas, pierceAvoid, BITS };
})();
