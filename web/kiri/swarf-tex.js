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
    fld: v => (window.SwarfLength ? window.SwarfLength.show(v) : String(v)),
    parse: t => (window.SwarfLength ? window.SwarfLength.parse(t) : parseFloat(t)),
    say: v => (window.SwarfLength ? window.SwarfLength.say(v) : `${+(+v).toFixed(2)} mm`)
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
  const PATHS = {
    auto: 'best',
    raster: 'raster',
    crosshatch: 'cross-hatch',
    plunge: 'plunge each dot',
    centerline: 'follow the centerline'
  };
  const TOOLS = {
    select: 'pick a part or a mark (V)',
    brush: 'paint a mark on a part; hold ⌥ to erase; [ and ] size the brush (B)',
    erase: 'erase from the mark (U)',
    rect: 'drag a rectangle onto the mark; ⌥ cuts it out (R)',
    ellipse: 'drag an ellipse onto the mark; ⌥ cuts it out (E)',
    region: 'click inside a part: its whole top, less its holes, joins the mark (G)'
  };
  const KEYS = { v: 'select', b: 'brush', u: 'erase', r: 'rect', e: 'ellipse', g: 'region' };
  const WORD = { select: 'select', brush: 'brush', erase: 'erase', rect: 'rectangle', ellipse: 'ellipse', region: 'region' };
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
    return { id: m.id, region: { ...region, data: region.data ? region.data.slice() : region.data }, xf: (m.xf || T().IDENTITY).slice(), fill: clone(m.fill), est: m.est, ver: 1 };
  }
  function storeMark(m) {
    return { id: m.id, region: T().storeRegion(m.region), xf: m.xf.slice(), fill: clone(m.fill), est: m.est };
  }
  const markHas = m => m.region && m.region.data && m.region.data.some(v => v);
  function lastFill() {
    try { const f = JSON.parse(localStorage.getItem(FILL) || 'null'); if (f && f.fill === 'texture' && T().PATTERNS[f.pattern]) return f; } catch (e) { /* private */ }
    return null;
  }
  function newMark(part) {
    const b = part.box, pad = 2;
    const region = T().newGrid(b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad, 0.5);
    const f = lastFill() || T().newFill('waves', { tool: 'ball14' });
    f.origin = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    return { id: newId(), region, xf: T().IDENTITY.slice(), fill: f, ver: 1 };
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
    say(parts.length ? 'Pick a part, then mark it: the brush paints, the rectangle and ellipse drag out, a region fills its top.' : 'No parts yet: import one, make a shape or draw one, then come back to mark it.');
    render();
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
        ${['select', 'brush', 'erase', 'rect', 'ellipse', 'region'].map(btn).join('')}
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
    $('tx-fit').onclick = () => { fit(!S.whole); render(); ui.svg.focus(); };
    $('tx-cancel').onclick = () => close(false);
    $('tx-done').onclick = () => close(true);
    ui.svg.addEventListener('pointerdown', down);
    ui.svg.addEventListener('pointermove', move);
    ui.svg.addEventListener('pointerup', up);
    ui.svg.addEventListener('pointerleave', () => { if (S && !S.drag) { S.hover = null; render(); } });
    ui.svg.addEventListener('wheel', wheel, { passive: false });
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
    ui.el.remove();
    document.body.classList.remove('swarf-draw-open', 'swarf-tex-open');
    S = null;
    const a = api();
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
    const left = 16, right = W > 900 ? 260 : 16, top = 76, bottom = 50;
    S.k = Math.max(0.02, Math.min((W - left - right) / (b[2] - b[0]), (H - top - bottom) / (b[3] - b[1])));
    S.ox = left + (W - left - right) / 2 - (b[0] + b[2]) / 2 * S.k;
    S.oy = top + (H - top - bottom) / 2 + (b[1] + b[3]) / 2 * S.k;
    S.whole = !!whole;
  }
  const sx = x => S.ox + x * S.k, sy = y => S.oy - y * S.k;
  function toMM(e) { const r = ui.svg.getBoundingClientRect(); return [(e.clientX - r.left - S.ox) / S.k, -(e.clientY - r.top - S.oy) / S.k]; }

  // ── the marks as pictures: the texture shaded in the skin's own colors ──
  function skinColors() {
    if (S.colors) return S.colors;
    const rgb = (el, prop) => { const m = /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(el ? getComputedStyle(el)[prop] : ''); return m ? [+m[1], +m[2], +m[3]] : null; };
    const on = ui.svg.querySelector('.sd-part.on') || ui.svg.querySelector('.sd-part'), bed = ui.svg.querySelector('.sd-bed');
    const c = { line: rgb(on, 'stroke') || [242, 237, 228], bed: rgb(bed, 'fill') || [26, 23, 22] };
    if (on) S.colors = c;
    return c;
  }
  function markImage(part, m, full) {
    const g = m.region;
    if (m.img && m.img.ver === m.ver && (m.img.full || !full)) return m.img;
    let i0 = Infinity, j0 = Infinity, i1 = -1, j1 = -1;
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) if (g.data[j * g.nx + i]) { if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
    if (i1 < 0) return (m.img = { ver: m.ver, full, href: null });
    const q = Math.max(1, Math.ceil(Math.sqrt((i1 - i0 + 1) * (j1 - j0 + 1) / 90000)));
    const W = Math.ceil((i1 - i0 + 1) / q), H = Math.ceil((j1 - j0 + 1) / q), res = g.res * q;
    const uL = g.x0 + i0 * g.res, vT = g.y0 + (j1 + 1) * g.res;
    const cell = (u, v) => { const i = Math.floor((u - g.x0) / g.res), j = Math.floor((v - g.y0) / g.res); return i >= 0 && j >= 0 && i < g.nx && j < g.ny && g.data[j * g.nx + i]; };
    let hf = null, dmax = 1;
    if (full) {
      const s = T().xfScale(m.xf);
      const tex = T().markTexture({ region: g, xf: T().IDENTITY, fill: { ...m.fill, fade: (m.fill.fade || 0) / s } });
      if (tex) { hf = tex.h; dmax = Math.max(0.5, tex.depth); }
    }
    const Hs = new Float32Array(W * H), In = new Uint8Array(W * H);
    for (let pj = 0; pj < H; pj++) for (let pi = 0; pi < W; pi++) {
      const u = uL + (pi + 0.5) * res, v = vT - (pj + 0.5) * res, k = pj * W + pi;
      In[k] = cell(u, v) ? 1 : 0;
      if (hf && In[k]) Hs[k] = hf(u, v);
    }
    const { line, bed } = skinColors();
    const can = document.createElement('canvas'); can.width = W; can.height = H;
    const ctx = can.getContext('2d'), img = ctx.createImageData(W, H), D = img.data;
    const L = [-0.55, 0.55, 0.63];
    for (let pj = 0; pj < H; pj++) for (let pi = 0; pi < W; pi++) {
      const k = pj * W + pi, o = k * 4;
      if (!In[k]) continue;
      const edge = pi === 0 || pj === 0 || pi === W - 1 || pj === H - 1 || !In[k - 1] || !In[k + 1] || !In[k - W] || !In[k + W];
      if (edge) { D[o] = line[0]; D[o + 1] = line[1]; D[o + 2] = line[2]; D[o + 3] = 255; continue; }
      let t = 0.35;
      if (hf) {
        // lit from the back left: the surface z = −h, its normal (hx, hy, 1); deeper is darker
        const hx = (Hs[k + 1] - Hs[k - 1]) / (2 * res) * 1.6, hy = -(Hs[k - W] - Hs[k + W]) / (2 * res) * 1.6;
        const sh = Math.max(0, (hx * L[0] + hy * L[1] + L[2]) / Math.hypot(hx, hy, 1)) / 0.93;
        t = Math.min(1, (0.25 + 0.6 * sh) * (1 - 0.35 * Hs[k] / dmax));
      }
      for (let c = 0; c < 3; c++) D[o + c] = Math.round(bed[c] + (line[c] - bed[c]) * t);
      D[o + 3] = hf ? 235 : 150;
    }
    ctx.putImageData(img, 0, 0);
    return (m.img = { ver: m.ver, full, href: can.toDataURL(), uL, vT, w: W * res, h: H * res });
  }
  // the marks' pictures are remade when the board rests
  function imagesSoon() {
    clearTimeout(S.imgT);
    S.imgT = setTimeout(() => { if (!S) return; for (const p of S.parts) for (const m of p.marks) markImage(p, m, true); render(); }, 220);
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
    out.push(`<text class="sd-lab" x="${sx(-bw / 2) + 6}" y="${sy(bd / 2) + 14}">bed ${Math.round(bw)} × ${Math.round(bd)} mm</text>`);
    out.push(`<path class="sd-origin" d="M${sx(0) - 8},${sy(0)}H${sx(0) + 8}M${sx(0)},${sy(0) - 8}V${sy(0) + 8}"/><text class="sd-lab" x="${sx(0) + 6}" y="${sy(0) + 14}">0, 0</text>`);
    {
      const r = ui.svg.getBoundingClientRect(), want = 100 / k;
      const len = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].find(v => v >= want * 0.6) || 2000;
      const x = 20, y = (r.height || window.innerHeight) - 46;
      out.push(`<path class="sd-scale" d="M${x},${y - 4}V${y}H${x + len * k}V${y - 4}"/><text class="sd-lab" x="${x}" y="${y - 8}">${len >= 1000 ? len / 1000 + ' m' : len + ' mm'}</text>`);
    }
    S.parts.forEach((p, pi) => {
      const d = p.loops.map(L => 'M' + L.map(q => `${sx(q[0] + p.pos[0])},${sy(q[1] + p.pos[1])}`).join('L') + 'Z').join('');
      out.push(`<path class="sd-part${pi === S.sel ? ' on' : ''}" data-part="${pi}" d="${d}"><title>${esc(p.name)}${p.drawn ? '' : ' (its box: it has no drawing)'}</title></path>`);
    });
    // the marks over their parts; the picked one's edge drawn over it
    S.parts.forEach((p, pi) => p.marks.forEach((m, mi) => {
      const im = markImage(p, m, false);
      if (!im.href) return;
      const A = m.xf;
      const e = S.ox + k * (p.pos[0] + A[4] + A[0] * im.uL + A[1] * im.vT), f = S.oy - k * (p.pos[1] + A[5] + A[2] * im.uL + A[3] * im.vT);
      out.push(`<image class="tx-mark${pi === S.sel && mi === S.mark ? ' on' : ''}" data-part="${pi}" data-mark="${mi}" href="${im.href}" width="${im.w}" height="${im.h}" preserveAspectRatio="none" transform="matrix(${k * A[0]},${-k * A[2]},${-k * A[1]},${k * A[3]},${e},${f})" style="pointer-events:none"/>`);
    }));
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
    if (!S.drag) card();
  }

  const curPart = () => S.parts[S.sel];
  const curMark = () => { const p = curPart(); return p && p.marks[S.mark]; };

  // ── the card ──
  function card() {
    const part = curPart(), m = curMark(), C = T();
    const lenRow = (word, id, v, tip) => `<div class="sd-row"${tip ? ` title="${esc(tip)}"` : ''}><span>${word}</span><input id="${id}" value="${LEN.fld(r3(v))}" inputmode="text" data-len="1"><span class="u">${LEN.unit()}</span></div>`;
    const numRow = (word, id, v, unit, tip) => `<div class="sd-row"${tip ? ` title="${esc(tip)}"` : ''}><span>${word}</span><input id="${id}" value="${v}" inputmode="decimal"><span class="u">${unit}</span></div>`;
    const selRow = (word, id, opts, v, tip) => `<div class="sd-row"${tip ? ` title="${esc(tip)}"` : ''}><span>${word}</span><select id="${id}">${opts.map(([k, t]) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select><span class="u"></span></div>`;
    let h = '';
    if (S.tool === 'brush' || S.tool === 'erase') h += `<div class="sd-h">${S.tool}</div>${lenRow('brush size', 'tx-bsize', S.brush, 'across the brush ([ and ] change it)')}`;
    else if (S.tool !== 'select') h += `<div class="sd-h">${WORD[S.tool]}</div><div class="sd-note">${esc(TOOLS[S.tool].replace(/ \(\w\)$/, ''))}.</div>`;
    if (!part) {
      h += `<div class="sd-note">${S.parts.length ? 'Click a part to mark it.' : 'No parts on the bed yet.'}</div>`;
    } else {
      h += `<div class="sd-h">${esc(part.name)}</div>`;
      if (part.tilted) h += '<div class="sd-note">This part is tipped over: TEX marks the top of a part lying flat.</div>';
      if (part.marks.length > 1 || (part.marks.length && !m)) h += `<div class="sd-row">${part.marks.map((q, i) => `<button class="tx-pick${i === S.mark ? ' on' : ''}" data-mi="${i}" title="pick this mark">${i + 1} · ${esc(C.PATTERNS[q.fill.pattern].label.toLowerCase())}</button>`).join('')}</div>`;
      h += `<div class="sd-row"><button id="tx-new" title="start another mark on this part (the brush paints it)">new mark</button>${m ? '<button id="tx-del" title="remove this mark (Delete)">delete mark</button>' : ''}</div>`;
      if (!m) h += `<div class="sd-note">${part.marks.length ? 'Pick a mark, or start a new one.' : 'Paint on the part with the brush, or drag a rectangle or an ellipse: that is the mark. Then fill it here.'}</div>`;
    }
    if (m) {
      const f = m.fill, P = C.PATTERNS[f.pattern];
      h += `<div class="sd-h">texture</div>${selRow('pattern', 'tx-pat', Object.entries(C.PATTERNS).map(([k, p]) => [k, p.label]), f.pattern, P.blurb)}`;
      for (const q of P.params) {
        if (q.k === 'depth') continue;
        const v = (f.params || {})[q.k] ?? q.def, id = `tx-p-${q.k}`, word = q.label.toLowerCase();
        if (q.type === 'select') h += selRow(word, id, q.options.map(o => [o, o]), v);
        else if (q.type === 'text') h += `<div class="sd-row"><span>${word}</span><input id="${id}" class="wide" value="${esc(v)}"></div>`;
        else if (q.unit === 'mm') h += lenRow(word, id, v);
        else h += numRow(word, id, v, q.unit === '°' ? '°' : '');
      }
      h += numRow('scale', 'tx-scale', r3((f.scale || 1) * 100), '%', 'the pattern larger or smaller');
      h += numRow('turn', 'tx-angle', r3(f.angle || 0), '°', 'the pattern turned');
      h += lenRow('soft edge', 'tx-fade', f.fade || 0, 'how far in from the mark\'s edge the texture takes to reach its full depth');
      h += lenRow('depth', 'tx-depth', f.depth, 'the deepest the texture goes below the part\'s top');
      h += lenRow('grit', 'tx-grit', f.grit || 0, 'a fine, rough noise added on top (0 for none)');
      h += selRow('bit', 'tx-bit', Object.entries(BITS).map(([k, b]) => [k, b.say]), f.tool, 'the bit that cuts it: ball for smooth hollows, V for sharp grooves');
      const tex = m.info && m.info.ver === m.ver ? m.info : null;
      const ok = { auto: true, raster: true, crosshatch: true, plunge: P.build(C.defaults(f.pattern)).kind === 'dots', centerline: P.build(C.defaults(f.pattern)).kind === 'strokes' };
      h += selRow('path', 'tx-path', Object.entries(PATHS).filter(([k]) => ok[k]).map(([k, t]) => [k, k === 'auto' && tex ? `${t}: ${PATHS[tex.strategy]}` : t]), ok[f.path] ? f.path : 'auto', 'how the bit goes over it: best picks one plunge per dot when the bit can make the dots, a V-bit along each groove, else raster');
      if (!tex) h += '<div class="sd-note">Working out the cut…</div>';
      else {
        h += `<div class="sd-note">About ${C.formatTime(tex.seconds)} to cut${tex.outside > 0.02 ? `; ${Math.round(tex.outside * 100)}% of it is off the part` : ''}.</div>`;
        for (const w of tex.warnings) h += `<div class="sd-note tx-warn">${esc(w)}</div>`;
      }
    }
    ui.card.innerHTML = h;
    const rd = el => (el.dataset.len ? LEN.parse(el.value) : parseFloat(el.value));
    const bind = (id, fn) => {
      const el = $(id); if (!el) return;
      if (el.tagName === 'SELECT') { el.onchange = () => { fn(el.value, el); ui.svg.focus(); }; return; }
      const value = () => (el.classList.contains('wide') ? el.value : rd(el));
      // Enter takes the value at once (as DRAW's fields do); the change that follows on blur is the same one
      el.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') { el.dataset.took = el.value; fn(value(), el); el.blur(); } if (e.key === 'Escape') { render(); ui.svg.focus(); } };
      el.onchange = () => { if (el.dataset.took === el.value) return; fn(value(), el); };
    };
    for (const b of ui.card.querySelectorAll('.tx-pick')) b.onclick = () => { S.mark = +b.dataset.mi; render(); ui.svg.focus(); };
    const nb = $('tx-new');
    if (nb) nb.onclick = () => { snap(); part.marks.push(newMark(part)); S.mark = part.marks.length - 1; part.dirty = true; if (S.tool === 'select') S.tool = 'brush'; say('A new mark: paint it on the part.'); render(); ui.svg.focus(); };
    const db = $('tx-del');
    if (db) db.onclick = () => { delMark(); ui.svg.focus(); };
    bind('tx-bsize', v => { if (!(v >= 0.5)) return say('Give the brush at least 0.5 mm across.'); S.brush = r3(v); try { localStorage.setItem(BRUSH, String(S.brush)); } catch (e) { /* private */ } render(); });
    if (!m) return;
    const f = m.fill;
    // every change to the fill: undoable, remembered for the next mark, the picture and checks again
    const set = (fn) => { snap(); fn(f); m.ver++; part.dirty = true; try { localStorage.setItem(FILL, JSON.stringify({ ...f, origin: [0, 0] })); } catch (e) { /* private */ } render(); imagesSoon(); checkSoon(); };
    bind('tx-pat', v => set(f => { f.pattern = v; f.params = C.defaults(v); f.depth = f.params.depth; if (!PATHS[f.path]) f.path = 'auto'; }));
    for (const q of C.PATTERNS[f.pattern].params) {
      if (q.k === 'depth') continue;
      bind(`tx-p-${q.k}`, v => {
        if (q.type === 'range') {
          if (!isFinite(v)) return say(`Give ${q.label.toLowerCase()} a number.`);
          if (v < q.min || v > q.max) return say(`${q.label} goes from ${q.unit === 'mm' ? LEN.say(q.min) : q.min} to ${q.unit === 'mm' ? LEN.say(q.max) : q.max}${q.unit && q.unit !== 'mm' ? q.unit : ''}.`);
        }
        set(f => { f.params = { ...C.defaults(f.pattern), ...(f.params || {}), [q.k]: q.type === 'range' ? r3(v) : v }; });
      });
    }
    bind('tx-scale', v => { if (!(v >= 5 && v <= 2000)) return say('Scale is a percentage from 5 to 2000.'); set(f => { f.scale = r3(v / 100); }); });
    bind('tx-angle', v => { if (!isFinite(v)) return; set(f => { f.angle = r3(v); }); });
    bind('tx-fade', v => { if (!(v >= 0)) return say('The soft edge is 0 or more.'); set(f => { f.fade = r3(v); }); });
    bind('tx-depth', v => {
      if (!(v >= 0.1)) return say('Give the texture at least 0.1 mm of depth.');
      set(f => { f.depth = r3(v); f.params = { ...(f.params || {}), depth: r3(v) }; });
      if (part.thick && v >= part.thick) say(`${LEN.say(v)} is as deep as ${part.name} is thick: the texture would cut through. It stops at the board's bottom.`);
    });
    bind('tx-grit', v => { if (!(v >= 0 && v <= 3)) return say('Grit goes from 0 to 3 mm.'); set(f => { f.grit = r3(v); }); });
    bind('tx-bit', v => set(f => { f.tool = v; }));
    bind('tx-path', v => set(f => { f.path = v; }));
  }
  function say(t) { const el = $('tx-say'); if (el) el.textContent = t || ''; }

  // what a mark will cut, how long it takes, and what to watch for (when the board rests)
  function info(part, m) {
    const C = T(), mark = { ...m, region: m.region };
    const chk = C.markChecks(mark, { thickness: part.thick, len: LEN.say, outside: offPart(part, m) });
    let seconds = 0, strategy = 'raster';
    if (chk.tex) {
      const op = stepOf(m.id) || {};
      const p = C.markToolpath(mark, { maxDepth: part.thick, stepDown: op.down > 0 ? op.down : 0, res: 0.6 });
      seconds = C.estimateTime(p.moves, { feed: (op.rate || 1500) / 60, plunge: (op.plunge || 500) / 60 }).seconds;
      strategy = p.strategy;
    }
    return { ver: m.ver, warnings: chk.warnings, notes: chk.notes, strategy, seconds, outside: offPart(part, m) };
  }
  // how much of a mark lies off its part (0..1)
  function offPart(part, m) {
    const g = m.region;
    let n = 0, off = 0;
    const st = Math.max(1, Math.round(Math.sqrt(g.nx * g.ny / 40000)));
    for (let j = 0; j < g.ny; j += st) for (let i = 0; i < g.nx; i += st) {
      if (!g.data[j * g.nx + i]) continue;
      n++;
      const p = T().xfApply(m.xf, g.x0 + (i + 0.5) * g.res, g.y0 + (j + 0.5) * g.res);
      if (!onPart(p, part.loops)) off++;
    }
    return n ? off / n : 0;
  }
  function checkSoon() {
    if (!S) return;
    clearTimeout(S.checkT);
    S.checkT = setTimeout(() => {
      if (!S) return;
      const p = curPart(), m = curMark();
      if (p && m && markHas(m) && !(m.info && m.info.ver === m.ver)) {
        try { m.info = info(p, m); m.est = m.info.seconds; } catch (e) { console.warn('swarf tex', e); }
        render();
      }
    }, 350);
  }

  // ── edits ──
  function snap() {
    S.undo.push({ sel: S.sel, mark: S.mark, parts: S.parts.map(p => ({ dirty: p.dirty, marks: p.marks.map(m => ({ ...m, region: { ...m.region, data: m.region.data.slice() }, xf: m.xf.slice(), fill: clone(m.fill), img: null, info: null })) })) });
    if (S.undo.length > 60) S.undo.shift();
  }
  function undo() {
    if (!S.undo.length) return;
    const u = S.undo.pop();
    u.parts.forEach((q, i) => { S.parts[i].marks = q.marks.map(m => ({ ...m, ver: (m.ver || 1) + 1 })); S.parts[i].dirty = true; });
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
    if (!curMark() && make) { part.marks.push(newMark(part)); S.mark = part.marks.length - 1; }
    return curMark() ? { part, m: curMark() } : null;
  }
  function stamp(t, a, b, val) {
    const { part, m } = t, s = T().xfScale(m.xf);
    const A = toMark(part, m, a), B = toMark(part, m, b);
    if (T().stampStroke(m.region, A[0], A[1], B[0], B[1], S.brush / 2 / s, val)) { m.ver++; part.dirty = true; }
  }
  function shapeInto(t, box, kind, val) {
    const { part, m } = t;
    const x0 = Math.min(box[0][0], box[1][0]), x1 = Math.max(box[0][0], box[1][0]), y0 = Math.min(box[0][1], box[1][1]), y1 = Math.max(box[0][1], box[1][1]);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
    const test = (u, v) => { const [x, y] = T().xfApply(m.xf, u, v), X = x + part.pos[0], Y = y + part.pos[1]; return kind === 'rect' ? X >= x0 && X <= x1 && Y >= y0 && Y <= y1 : ((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2 <= 1; };
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
      if (!n) S.undo.pop(); else say(erase ? 'Taken out of the mark.' : 'The region is in the mark.');
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
    if (!d) { if (S.tool === 'brush' || S.tool === 'erase') { S.hover = p; render(); } return; }
    if (d.kind === 'pan') { S.ox += e.clientX - d.x; S.oy += e.clientY - d.y; d.x = e.clientX; d.y = e.clientY; render(); return; }
    if (d.kind === 'paint') {
      S.hover = p;
      if (Math.hypot(p[0] - d.last[0], p[1] - d.last[1]) * S.k < 1.5) return;
      stamp(d.t, d.last, p, d.val);
      d.last = p;
      render();
      return;
    }
    if (d.kind === 'shape') {
      let b = p;
      if (e.shiftKey) { const s = Math.max(Math.abs(b[0] - d.at[0]), Math.abs(b[1] - d.at[1])); b = [d.at[0] + Math.sign(b[0] - d.at[0] || 1) * s, d.at[1] + Math.sign(b[1] - d.at[1] || 1) * s]; }
      d.to = b; S.box = [d.at, b];
      render();
      say(`${LEN.say(Math.abs(b[0] - d.at[0]))} × ${LEN.say(Math.abs(b[1] - d.at[1]))}`);
    }
  }
  function up() {
    const d = S.drag;
    S.drag = null;
    if (!d) return;
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
      say(`Brush ${LEN.say(S.brush)} across.`); render(); return;
    }
    if ((k === 'Delete' || k === 'Backspace') && curMark()) { e.preventDefault(); delMark(); return; }
    // arrows slide the picked mark on its part (shift: 10 mm)
    const ar = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[k];
    const m = curMark();
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
      for (const m of list) if (!(m.info && m.info.ver === m.ver)) { try { m.info = info(p, m); m.est = m.info.seconds; } catch (e) { /* said in concerns */ } }
      if (list.length) p.w.meta.tex = list.map(storeMark); else delete p.w.meta.tex;
      kept += list.length;
      // saved now, not on the usual delay: a reload right after done keeps the marks
      if (p.w.saveState) p.w.saveState(() => {});
    }
    if (!changed) return '';
    const r = syncSteps(a);
    const steps = r.added ? `${r.added === 1 ? 'a texture step was' : `${r.added} texture steps were`} added before the cut-out` : r.removed ? `${r.removed === 1 ? 'its step was' : `${r.removed} steps were`} removed` : 'the texture steps cut them';
    return kept ? `${kept === 1 ? '1 mark is' : `${kept} marks are`} kept: ${steps}. Next: toolpaths.` : `No marks left${r.removed ? `: ${steps}` : ''}.`;
  }

  // ── the steps: one texture step per mark, before the steps that cut the parts free ──
  function stepOf(id) {
    const a = api(), ops = (a && a.conf.get().process.ops) || [];
    return ops.find(o => o && o.type === 'texture' && o.texmark === id) || null;
  }
  function kiriTool(bit, tools) {
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
    const P = T().PATTERNS[e.mark.fill.pattern];
    return `texture: ${P ? P.label.toLowerCase() : e.mark.fill.pattern} on ${who}`;
  };
  function syncSteps(a) {
    a = a || api();
    const s = a.conf.get(), proc = s.process, ops = proc.ops || (proc.ops = []);
    const marks = marksOnBed(a);
    let added = 0, removed = 0, changed = false;
    for (let i = ops.length - 1; i >= 0; i--) {
      const o = ops[i];
      if (o && o.type === 'texture' && !marks.has(o.texmark)) { ops.splice(i, 1); removed++; }
    }
    const tools = s.tools || [];
    for (const [id, e] of marks) {
      let op = ops.find(o => o && o.type === 'texture' && o.texmark === id);
      const tool = kiriTool(e.mark.fill.tool, tools), label = stepLabel(e);
      if (!op) {
        const like = ops.find(o => o && (o.type === 'outline' || o.type === 'rough')) || {};
        op = {
          type: 'texture', texmark: id, tool, texlabel: label,
          spindle: like.spindle || proc.camTraceSpindle || 12000, rate: like.rate || proc.camTraceSpeed || 1500,
          plunge: like.plunge || proc.camTracePlunge || 500, down: like.down || 2, marks: {}
        };
        // before the steps that cut parts free (an outline, a rough), and before the end-of-steps marker
        let at = ops.findIndex(o => o && (o.type === 'outline' || o.type === 'rough' || o.type === '|'));
        if (at < 0) at = ops.length;
        ops.splice(at, 0, op);
        added++;
        continue;
      }
      // a new bit: the material's numbers for it again (swarf-material.js re-derives an unstamped step)
      if (op.tool !== tool) { op.tool = tool; delete op.preset; changed = true; }
      if (op.texlabel !== label) { op.texlabel = label; changed = true; }
    }
    for (const o of ops) if (o && o.type === 'texture') { const e = marks.get(o.texmark); if (e && e.mark.est != null) o.texest = e.mark.est; }
    if (added || removed || changed) {
      a.conf.save();
      a.event.emit('cam.op.render');
    }
    return { added, removed };
  }
  // each texture step's marks, from every part's own, when the toolpaths are made: the mark, the
  // part's top and its thickness (the moves never go below the board)
  function texAreas() {
    const a = api();
    const s = a.conf.get(), ops = (s.process || {}).ops || [];
    if (!ops.some(o => o && o.type === 'texture')) return;
    const marks = marksOnBed(a);
    for (const op of ops) {
      if (!op || op.type !== 'texture') continue;
      op.marks = {};
      const e = marks.get(op.texmark);
      if (!e) continue;
      op.tool = kiriTool(e.mark.fill.tool, s.tools || []);
      for (const w of e.ws) {
        if (w.meta.tilted) continue;
        const { top, thick } = sizeOf(w);
        op.marks[w.id] = w.meta.tex.filter(m => m.id === op.texmark).map(mark => ({ mark, top, thick }));
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
        const key = JSON.stringify([m.id, m.fill, m.xf, thick, m.region.nx, m.region.runs.length, LEN.unit(), w.meta.svg ? w.meta.svg.length : 0]);
        if (!said.has(key)) {
          loops = loops || localLoops(w).loops;
          const mark = { ...m, region: T().regionSpec(m.region) };
          const part = { loops };
          const chk = T().markChecks(mark, { thickness: thick, len: LEN.say, outside: offPart(part, { ...mark, xf: mark.xf || T().IDENTITY }) });
          said.set(key, chk.warnings);
          if (said.size > 200) said.delete(said.keys().next().value);
        }
        const P = T().PATTERNS[m.fill.pattern];
        for (const body of said.get(key)) out.push({
          title: `texture: ${P ? P.label.toLowerCase() : m.fill.pattern} on ${name}`,
          body,
          hint: /off the part/.test(body) ? 'tex: erase what is off the part (U), or slide the mark onto it (arrows)' : /cut through/.test(body) ? 'tex: less depth, or a thicker board' : 'tex: another bit, a bigger pattern, or less depth'
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
      if (step && !step.dataset.wired) { step.dataset.wired = '1'; step.addEventListener('click', open); }
    }
  }, 150);

  window.__swarfTex = { open, close, state: () => S, concerns, syncSteps, texAreas, BITS };
})();
