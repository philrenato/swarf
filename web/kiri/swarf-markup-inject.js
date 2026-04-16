/**
 * renato.design — markup toolbar
 * Injected into local preview via ?markup=1
 * Annotations saved to tools/markup-feedback.json via POST /markup-save
 *
 * MODES:
 *   select  — normal scrolling/clicking
 *   edit    — click any text node to edit it in place
 *   note    — click anywhere to drop an annotation bubble
 *   draw    — freehand pen over the page
 *   arrow   — click drag to draw an arrow
 */

(function () {
  'use strict';

  // Markup toolbar is always on while we're actively iterating on swarf.
  // (Previously gated behind ?dev=1 / ?markup=1 to hide it in "normal" use.)

  // ── STATE ──────────────────────────────────────────────────────────────────
  const state = {
    mode: 'select',
    drawColor: '#e8ff00',
    drawSize: 3,
    annotations: [],   // { id, x, y, scrollY, text }
    textEdits: [],     // { selector, original, current }
    strokes: [],       // SVG path data strings + color/size
    annotationCounter: 0,
    drawing: false,
    currentPath: null,
    arrowStart: null,
  };

  // ── INJECT STYLES ──────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap');

    #rd-markup-root * { box-sizing: border-box; font-family: 'IBM Plex Mono', monospace; }

    #rd-toolbar {
      position: fixed;
      /* swarf: float bottom-right so it doesn't occlude Kiri:Moto's top bar */
      bottom: 16px; right: 16px; left: auto; top: auto;
      height: 38px;
      background: rgba(17,17,17,0.92);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      border: 1px solid #2a2a2a;
      border-radius: 6px;
      box-shadow: 0 6px 24px rgba(0,0,0,0.55);
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 0 8px;
      z-index: 999999;
      user-select: none;
      cursor: move;
    }
    .rd-label {
      font-size: 9px;
      color: #555;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      padding: 0 8px 0 4px;
      white-space: nowrap;
    }
    .rd-sep { width: 1px; height: 22px; background: #2a2a2a; margin: 0 5px; }
    #rd-toolbar-body { display: inline-flex; align-items: center; gap: 2px; overflow: hidden; transition: max-width 0.22s ease, opacity 0.18s ease; max-width: 2000px; opacity: 1; }
    #rd-toolbar.rd-collapsed #rd-toolbar-body { max-width: 0; opacity: 0; pointer-events: none; }
    #rd-toolbar.rd-collapsed { padding-right: 4px; }
    .rd-btn {
      height: 28px;
      padding: 0 9px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 3px;
      color: #666;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      transition: all 0.1s;
      white-space: nowrap;
      letter-spacing: 0.04em;
    }
    .rd-btn:hover { border-color: #333; color: #ccc; }
    .rd-btn.rd-active {
      background: #e8ff00;
      color: #000 !important;
      border-color: #e8ff00;
      font-weight: 500;
    }
    .rd-swatch {
      width: 14px; height: 14px;
      border-radius: 50%;
      border: 2px solid #333;
      cursor: pointer;
      flex-shrink: 0;
      transition: border-color 0.1s;
    }
    .rd-swatch.rd-active { border-color: #e8ff00 !important; }
    .rd-size-select {
      height: 22px;
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 3px;
      color: #aaa;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 10px;
      padding: 0 5px;
      cursor: pointer;
    }
    .rd-send-btn {
      margin-left: auto !important;
      background: #e8ff00 !important;
      color: #000 !important;
      border-color: #e8ff00 !important;
      font-weight: 500;
      padding: 0 14px !important;
    }
    .rd-send-btn:hover { background: #fff !important; border-color: #fff !important; }

    /* Editable text highlight */
    body.rd-edit-mode [data-rd-editable]:hover {
      outline: 1px dashed rgba(232,255,0,0.5) !important;
      background: rgba(232,255,0,0.03) !important;
      cursor: text !important;
    }
    body.rd-edit-mode [data-rd-editable]:focus {
      outline: 2px solid #e8ff00 !important;
      background: rgba(232,255,0,0.05) !important;
    }
    body.rd-edit-mode [data-rd-editable][data-rd-dirty] {
      background: rgba(232,255,0,0.08) !important;
    }

    /* Note mode cursor */
    body.rd-note-mode { cursor: cell !important; }

    /* Draw cursor */
    body.rd-draw-mode { cursor: crosshair !important; }
    body.rd-arrow-mode { cursor: crosshair !important; }

    /* Annotation bubble */
    .rd-annotation {
      position: absolute;
      z-index: 999990;
      min-width: 180px;
      max-width: 260px;
      filter: drop-shadow(0 4px 16px rgba(0,0,0,0.5));
    }
    .rd-ann-header {
      background: #e8ff00;
      color: #000;
      font-size: 8px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      padding: 4px 7px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: move;
      border-radius: 4px 4px 0 0;
      user-select: none;
    }
    .rd-ann-close {
      background: none;
      border: none;
      color: #000;
      cursor: pointer;
      font-size: 13px;
      line-height: 1;
      padding: 0;
      font-weight: bold;
    }
    .rd-ann-body {
      background: #1a1a1a;
      border: 1px solid #e8ff00;
      border-top: none;
      border-radius: 0 0 4px 4px;
    }
    .rd-ann-textarea {
      width: 100%;
      min-height: 56px;
      background: transparent;
      border: none;
      color: #d0d0d0;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 11px;
      line-height: 1.5;
      padding: 7px 9px;
      resize: vertical;
      outline: none;
    }
    .rd-ann-textarea::placeholder { color: #444; }

    /* SVG draw layer */
    #rd-svg-layer {
      position: fixed;
      top: 0; left: 0;
      width: 100vw; height: 100vh;
      pointer-events: none;
      z-index: 999980;
      overflow: visible;
    }
    #rd-svg-layer.rd-draw-active,
    #rd-svg-layer.rd-arrow-active {
      pointer-events: all;
    }

    /* Compare mode panels */
    .rd-compare {
      border: 1px solid #e8ff00;
      margin: 12px 0;
      font-family: 'IBM Plex Mono', monospace;
      position: relative;
      z-index: 10;
    }
    .rd-compare-header {
      background: #e8ff00;
      color: #000;
      font-size: 8px;
      font-weight: 500;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      padding: 5px 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .rd-compare-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
    }
    .rd-compare-col {
      padding: 10px;
      position: relative;
    }
    .rd-compare-col:first-child { border-right: 1px solid #2a2a2a; }
    .rd-compare-col-label {
      font-size: 8px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .rd-compare-col-label.rd-old { color: #ff6666; }
    .rd-compare-col-label.rd-new { color: #66ff88; }
    .rd-compare-col-label input[type="radio"] { accent-color: #e8ff00; }
    .rd-compare-ta {
      width: 100%;
      min-height: 80px;
      background: #0e0e0e;
      color: #d0d0d0;
      border: 1px solid #2a2a2a;
      border-radius: 3px;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 11px;
      line-height: 1.6;
      padding: 8px;
      resize: vertical;
    }
    .rd-compare-ta:focus { outline: none; border-color: #e8ff00; }
    .rd-compare-ta.rd-chosen {
      border-color: #e8ff00;
      background: rgba(232,255,0,0.03);
    }
    .rd-compare-ta.rd-dimmed { opacity: 0.3; }

    /* Top padding so site doesn't hide under toolbar */
    #rd-body-pad { height: 0; } /* swarf: toolbar floats, no body offset needed */

    /* Send modal */
    #rd-send-modal {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.75);
      z-index: 9999999;
      align-items: center;
      justify-content: center;
    }
    #rd-send-modal.open { display: flex; }
    .rd-modal-box {
      background: #161616;
      border: 1px solid #2a2a2a;
      border-radius: 7px;
      width: 540px;
      max-width: 90vw;
      box-shadow: 0 24px 80px rgba(0,0,0,0.8);
      overflow: hidden;
    }
    .rd-modal-header {
      background: #e8ff00;
      color: #000;
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      padding: 9px 13px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .rd-modal-close {
      background: none; border: none; color: #000;
      font-size: 15px; cursor: pointer; font-weight: bold;
    }
    .rd-modal-body { padding: 14px; }
    .rd-modal-body p {
      font-size: 10px; color: #666; margin-bottom: 9px;
      line-height: 1.6;
    }
    #rd-brief {
      width: 100%; height: 240px;
      background: #0e0e0e;
      border: 1px solid #2a2a2a;
      border-radius: 3px;
      color: #d0d0d0;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 10px;
      line-height: 1.6;
      padding: 10px;
      resize: none;
      outline: none;
    }
    .rd-modal-actions {
      display: flex; gap: 7px; margin-top: 9px; justify-content: flex-end;
    }
    .rd-mbtn {
      height: 28px; padding: 0 13px;
      border-radius: 3px;
      font-family: 'IBM Plex Mono', monospace;
      font-size: 10px;
      cursor: pointer;
      border: 1px solid #2a2a2a;
      background: transparent;
      color: #aaa;
    }
    .rd-mbtn.primary {
      background: #e8ff00; color: #000;
      border-color: #e8ff00; font-weight: 500;
    }
    .rd-mbtn.primary:hover { background: #fff; border-color: #fff; }
    .rd-saved-notice {
      font-size: 10px; color: #e8ff00;
      display: none; text-align: center; margin-top: 7px;
    }
  `;
  document.head.appendChild(style);

  // ── TOP PADDING ────────────────────────────────────────────────────────────
  const pad = document.createElement('div');
  pad.id = 'rd-body-pad';
  document.body.insertBefore(pad, document.body.firstChild);

  // ── SVG DRAW LAYER ─────────────────────────────────────────────────────────
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'rd-svg-layer';
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  document.body.appendChild(svg);

  // ── TOOLBAR ────────────────────────────────────────────────────────────────
  const toolbar = document.createElement('div');
  toolbar.id = 'rd-toolbar';
  toolbar.innerHTML = `
    <span class="rd-label">markup</span>
    <span id="rd-toolbar-body">
      <div class="rd-sep"></div>
      <button class="rd-btn rd-active" id="rd-btn-select">↖ select</button>
      <button class="rd-btn" id="rd-btn-edit">✎ edit text</button>
      <button class="rd-btn" id="rd-btn-note">⊕ note</button>
      <button class="rd-btn" id="rd-btn-draw">✏ draw</button>
      <button class="rd-btn" id="rd-btn-arrow">↗ arrow</button>
      <div class="rd-sep"></div>
      <span class="rd-label" style="font-size:8px">color</span>
      <div class="rd-swatch rd-active" style="background:#e8ff00" data-color="#e8ff00" title="yellow"></div>
      <div class="rd-swatch" style="background:#ff4d4d" data-color="#ff4d4d" title="red"></div>
      <div class="rd-swatch" style="background:#4daaff" data-color="#4daaff" title="blue"></div>
      <div class="rd-swatch" style="background:#ffffff; border-color:#555" data-color="#ffffff" title="white"></div>
      <select class="rd-size-select" id="rd-size">
        <option value="2">thin</option>
        <option value="3" selected>med</option>
        <option value="5">thick</option>
        <option value="8">fat</option>
      </select>
      <div class="rd-sep"></div>
      <button class="rd-btn" id="rd-btn-undo" title="Undo last stroke (Cmd+Z)">↩ undo</button>
      <button class="rd-btn" id="rd-btn-clear" style="color:#ff6666">✕ clear all</button>
      <div class="rd-sep"></div>
      <button class="rd-btn" id="rd-btn-compare" title="Load compare proposals from markup-compare.json">⇔ compare</button>
      <button class="rd-btn rd-send-btn" id="rd-btn-send">→ send to claude</button>
    </span>
    <button class="rd-btn" id="rd-btn-collapse" title="Collapse/expand markup toolbar" style="margin-left:6px">«</button>
  `;
  document.body.appendChild(toolbar);

  // swarf: drag the toolbar by its edges (not buttons). Restore position from localStorage.
  (function enableToolbarDrag(){
    const KEY = 'swarf-markup-toolbar-pos';
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
        toolbar.style.left = saved.left + 'px';
        toolbar.style.top = saved.top + 'px';
        toolbar.style.right = 'auto';
        toolbar.style.bottom = 'auto';
      }
    } catch(_) {}
    let dx = 0, dy = 0, dragging = false;
    toolbar.addEventListener('pointerdown', (ev) => {
      // only drag when grabbing toolbar chrome itself, not its buttons/swatches/inputs
      const t = ev.target;
      if (t !== toolbar && !t.classList.contains('rd-label') && !t.classList.contains('rd-sep')) return;
      dragging = true;
      toolbar.setPointerCapture(ev.pointerId);
      const r = toolbar.getBoundingClientRect();
      dx = ev.clientX - r.left;
      dy = ev.clientY - r.top;
      ev.preventDefault();
    });
    toolbar.addEventListener('pointermove', (ev) => {
      if (!dragging) return;
      const left = Math.max(4, Math.min(window.innerWidth - toolbar.offsetWidth - 4, ev.clientX - dx));
      const top  = Math.max(4, Math.min(window.innerHeight - toolbar.offsetHeight - 4, ev.clientY - dy));
      toolbar.style.left = left + 'px';
      toolbar.style.top = top + 'px';
      toolbar.style.right = 'auto';
      toolbar.style.bottom = 'auto';
    });
    toolbar.addEventListener('pointerup', (ev) => {
      if (!dragging) return;
      dragging = false;
      try {
        localStorage.setItem(KEY, JSON.stringify({ left: toolbar.offsetLeft, top: toolbar.offsetTop }));
      } catch(_) {}
    });
  })();

  // ── SEND MODAL ─────────────────────────────────────────────────────────────
  const modal = document.createElement('div');
  modal.id = 'rd-send-modal';
  modal.innerHTML = `
    <div class="rd-modal-box">
      <div class="rd-modal-header">
        feedback brief
        <button class="rd-modal-close" id="rd-modal-close-btn">×</button>
      </div>
      <div class="rd-modal-body">
        <p>Review and edit before sending. This will be saved to <strong>tools/markup-feedback.json</strong> — tell Claude "markup ready" in the terminal.</p>
        <textarea id="rd-brief" spellcheck="false" readonly></textarea>
        <div class="rd-modal-actions">
          <button class="rd-mbtn" id="rd-copy-btn">copy</button>
          <button class="rd-mbtn primary" id="rd-save-btn">save to file</button>
        </div>
        <div class="rd-saved-notice" id="rd-saved-notice">✓ saved — tell Claude "markup ready" in terminal</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // ── MAKE TEXT EDITABLE ─────────────────────────────────────────────────────
  function makeEditable() {
    const targets = document.querySelectorAll(
      'h1, h2, h3, h4, h5, h6, p, li, span, a, td, th, label, button, figcaption, blockquote, dt, dd'
    );
    targets.forEach(el => {
      // Skip toolbar and modal elements
      if (el.closest('#rd-toolbar, #rd-send-modal, .rd-annotation')) return;
      el.setAttribute('data-rd-editable', '1');
      el.setAttribute('data-rd-original', el.innerText);
      el.setAttribute('contenteditable', 'false');
    });
  }
  makeEditable();

  // ── MODE SWITCHING ─────────────────────────────────────────────────────────
  function setMode(mode) {
    state.mode = mode;
    // Button highlights
    ['select','edit','note','draw','arrow'].forEach(m => {
      document.getElementById(`rd-btn-${m}`)?.classList.toggle('rd-active', m === mode);
    });
    // Body classes
    document.body.classList.remove('rd-edit-mode','rd-note-mode','rd-draw-mode','rd-arrow-mode');
    if (mode !== 'select') document.body.classList.add(`rd-${mode}-mode`);
    // SVG layer
    svg.classList.remove('rd-draw-active','rd-arrow-active');
    if (mode === 'draw') svg.classList.add('rd-draw-active');
    if (mode === 'arrow') svg.classList.add('rd-arrow-active');
    // contenteditable
    document.querySelectorAll('[data-rd-editable]').forEach(el => {
      el.contentEditable = (mode === 'edit') ? 'true' : 'false';
    });
  }

  // swarf v010: collapse/expand the markup toolbar horizontally
  (function wireCollapse() {
    const COLLAPSE_KEY = 'swarf-markup-toolbar-collapsed';
    const btn = document.getElementById('rd-btn-collapse');
    function setCollapsed(c) {
      toolbar.classList.toggle('rd-collapsed', c);
      btn.textContent = c ? '»' : '«';
      btn.title = c ? 'Expand markup toolbar' : 'Collapse markup toolbar';
      try { localStorage.setItem(COLLAPSE_KEY, c ? '1' : '0'); } catch (e) {}
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setCollapsed(!toolbar.classList.contains('rd-collapsed'));
    });
    try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1'); } catch (e) {}
  })();

  document.getElementById('rd-btn-select').addEventListener('click', () => setMode('select'));
  document.getElementById('rd-btn-edit').addEventListener('click', () => setMode('edit'));
  document.getElementById('rd-btn-note').addEventListener('click', () => setMode('note'));
  document.getElementById('rd-btn-draw').addEventListener('click', () => setMode('draw'));
  document.getElementById('rd-btn-arrow').addEventListener('click', () => setMode('arrow'));

  // Keyboard shortcuts removed — they intercept typing in edit/note modes.

  // ── COLORS ────────────────────────────────────────────────────────────────
  toolbar.querySelectorAll('.rd-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      toolbar.querySelectorAll('.rd-swatch').forEach(s => s.classList.remove('rd-active'));
      sw.classList.add('rd-active');
      state.drawColor = sw.dataset.color;
    });
  });

  document.getElementById('rd-size').addEventListener('change', e => {
    state.drawSize = parseInt(e.target.value);
  });

  // ── ANNOTATIONS ──────────────────────────────────────────────────────────
  document.addEventListener('click', e => {
    if (state.mode !== 'note') return;
    if (e.target.closest('#rd-toolbar, #rd-send-modal, .rd-annotation')) return;

    const id = ++state.annotationCounter;
    const scrollY = window.scrollY;
    const x = e.pageX;
    const y = e.pageY;

    const ann = {
      id, x, y, scrollY,
      text: '',
      el: null
    };

    const el = document.createElement('div');
    el.className = 'rd-annotation';
    el.id = `rd-ann-${id}`;
    el.style.cssText = `left:${x}px; top:${y}px;`;
    el.innerHTML = `
      <div class="rd-ann-header" data-ann-id="${id}">
        note #${id}
        <button class="rd-ann-close" data-ann-id="${id}">×</button>
      </div>
      <div class="rd-ann-body">
        <textarea class="rd-ann-textarea" placeholder="describe what you want here…" data-ann-id="${id}"></textarea>
      </div>
    `;
    document.body.appendChild(el);
    ann.el = el;
    state.annotations.push(ann);

    el.querySelector('.rd-ann-textarea').focus();

    // Close button
    el.querySelector('.rd-ann-close').addEventListener('click', () => {
      el.remove();
      const idx = state.annotations.findIndex(a => a.id === id);
      if (idx !== -1) state.annotations.splice(idx, 1);
    });

    // Drag
    makeDraggable(el, el.querySelector('.rd-ann-header'));

    // Text sync
    el.querySelector('.rd-ann-textarea').addEventListener('input', ev => {
      ann.text = ev.target.value;
    });

    setMode('select');
  });

  function makeDraggable(el, handle) {
    let ox, oy, sx, sy;
    handle.addEventListener('mousedown', e => {
      if (e.target.classList.contains('rd-ann-close')) return;
      ox = e.clientX; oy = e.clientY;
      sx = el.offsetLeft; sy = el.offsetTop;
      const onMove = ev => {
        el.style.left = (sx + ev.clientX - ox) + 'px';
        el.style.top  = (sy + ev.clientY - oy) + 'px';
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  // ── FREEHAND DRAWING ─────────────────────────────────────────────────────
  let currentPoints = [];

  svg.addEventListener('mousedown', e => {
    if (state.mode === 'draw') {
      state.drawing = true;
      currentPoints = [{ x: e.clientX, y: e.clientY + window.scrollY }];
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', state.drawColor);
      path.setAttribute('stroke-width', state.drawSize);
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('opacity', '0.9');
      svg.appendChild(path);
      state.currentPath = path;
    } else if (state.mode === 'arrow') {
      state.arrowStart = { x: e.clientX, y: e.clientY + window.scrollY };
    }
  });

  svg.addEventListener('mousemove', e => {
    if (state.mode === 'draw' && state.drawing && state.currentPath) {
      currentPoints.push({ x: e.clientX, y: e.clientY + window.scrollY });
      state.currentPath.setAttribute('d', pointsToPath(currentPoints));
    } else if (state.mode === 'arrow' && state.arrowStart) {
      // Preview arrow — remove temp
      document.getElementById('rd-arrow-preview')?.remove();
      const ax = state.arrowStart.x, ay = state.arrowStart.y;
      const bx = e.clientX, by = e.clientY + window.scrollY;
      const line = makeArrowSVG(ax, ay, bx, by, state.drawColor, state.drawSize, 'rd-arrow-preview');
      svg.appendChild(line);
    }
  });

  svg.addEventListener('mouseup', e => {
    if (state.mode === 'draw' && state.drawing) {
      state.drawing = false;
      if (currentPoints.length > 1) {
        state.strokes.push({
          type: 'freehand',
          d: pointsToPath(currentPoints),
          color: state.drawColor,
          size: state.drawSize
        });
      } else {
        state.currentPath?.remove();
      }
      state.currentPath = null;
      currentPoints = [];
    } else if (state.mode === 'arrow' && state.arrowStart) {
      document.getElementById('rd-arrow-preview')?.remove();
      const ax = state.arrowStart.x, ay = state.arrowStart.y;
      const bx = e.clientX, by = e.clientY + window.scrollY;
      const dx = bx - ax, dy = by - ay;
      if (Math.sqrt(dx*dx + dy*dy) > 10) {
        const arrow = makeArrowSVG(ax, ay, bx, by, state.drawColor, state.drawSize);
        svg.appendChild(arrow);
        state.strokes.push({
          type: 'arrow',
          x1: ax, y1: ay, x2: bx, y2: by,
          color: state.drawColor,
          size: state.drawSize
        });
      }
      state.arrowStart = null;
    }
  });

  function pointsToPath(pts) {
    if (pts.length < 2) return '';
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${pts[i].x} ${pts[i].y}`;
    }
    return d;
  }

  function makeArrowSVG(x1, y1, x2, y2, color, size, id) {
    const markerId = 'rd-arrow-head-' + Math.random().toString(36).slice(2,7);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    if (id) g.id = id;

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', markerId);
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '8');
    marker.setAttribute('refX', '6');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', '0 0, 8 3, 0 6');
    poly.setAttribute('fill', color);
    marker.appendChild(poly);
    defs.appendChild(marker);
    g.appendChild(defs);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', size);
    line.setAttribute('marker-end', `url(#${markerId})`);
    line.setAttribute('stroke-linecap', 'round');
    g.appendChild(line);
    return g;
  }

  // ── UNDO ──────────────────────────────────────────────────────────────────
  function undoStroke() {
    if (!state.strokes.length) return;
    state.strokes.pop();
    // Remove last child of svg that's a path or g
    const children = Array.from(svg.children);
    for (let i = children.length - 1; i >= 0; i--) {
      const tag = children[i].tagName.toLowerCase();
      if (tag === 'path' || tag === 'g') {
        children[i].remove();
        break;
      }
    }
  }

  document.getElementById('rd-btn-undo').addEventListener('click', undoStroke);

  // ── CLEAR ─────────────────────────────────────────────────────────────────
  document.getElementById('rd-btn-clear').addEventListener('click', () => {
    if (!confirm('Clear all annotations, edits, and drawings?')) return;
    // Strokes
    Array.from(svg.children).forEach(c => {
      if (c.tagName === 'path' || c.tagName === 'g') c.remove();
    });
    state.strokes = [];
    // Annotations
    state.annotations.forEach(a => a.el?.remove());
    state.annotations = [];
    state.annotationCounter = 0;
    // Text edits — restore originals
    document.querySelectorAll('[data-rd-editable][data-rd-dirty]').forEach(el => {
      el.innerText = el.getAttribute('data-rd-original');
      el.removeAttribute('data-rd-dirty');
    });
    state.textEdits = [];
  });

  // Track text edits
  document.addEventListener('input', e => {
    const el = e.target;
    if (!el.hasAttribute('data-rd-editable')) return;
    el.setAttribute('data-rd-dirty', '1');
    const selector = getCssSelector(el);
    const current = el.innerText;
    const original = el.getAttribute('data-rd-original');
    const existing = state.textEdits.find(t => t.selector === selector);
    if (existing) {
      existing.current = current;
    } else {
      state.textEdits.push({ selector, original, current });
    }
  });

  function getCssSelector(el) {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0,2).join('.') : '';
    const text = el.getAttribute('data-rd-original')?.slice(0,30).replace(/\s+/g,' ') || '';
    return `${tag}${id}${cls} [original: "${text}"]`;
  }

  // ── SEND ──────────────────────────────────────────────────────────────────
  document.getElementById('rd-btn-send').addEventListener('click', () => {
    const brief = buildBrief();
    document.getElementById('rd-brief').value = brief;
    modal.classList.add('open');
    document.getElementById('rd-saved-notice').style.display = 'none';
  });

  document.getElementById('rd-modal-close-btn').addEventListener('click', () => {
    modal.classList.remove('open');
  });

  document.getElementById('rd-copy-btn').addEventListener('click', () => {
    const text = document.getElementById('rd-brief').value;
    navigator.clipboard.writeText(text).then(() => {
      document.getElementById('rd-copy-btn').textContent = 'copied ✓';
      setTimeout(() => document.getElementById('rd-copy-btn').textContent = 'copy', 1500);
    });
  });

  document.getElementById('rd-save-btn').addEventListener('click', async () => {
    const brief = document.getElementById('rd-brief').value;
    const payload = buildPayload();

    try {
      const res = await fetch('http://localhost:8731/markup-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        document.getElementById('rd-saved-notice').style.display = 'block';
        document.getElementById('rd-save-btn').textContent = 'saved ✓';
      } else {
        throw new Error('server error');
      }
    } catch {
      // Fallback: download as file
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'markup-feedback.json'; a.click();
      document.getElementById('rd-saved-notice').style.display = 'block';
      document.getElementById('rd-saved-notice').textContent = '↓ downloaded — drag to your project folder, then tell Claude "markup ready"';
    }
  });

  function buildBrief() {
    const lines = [];
    lines.push(`RENATO.DESIGN MARKUP FEEDBACK`);
    lines.push(`page: ${window.location.pathname}`);
    lines.push(`timestamp: ${new Date().toISOString()}`);
    lines.push('');

    if (state.textEdits.length) {
      lines.push(`TEXT EDITS (${state.textEdits.length})`);
      lines.push('─'.repeat(40));
      state.textEdits.forEach((t, i) => {
        lines.push(`${i+1}. ${t.selector}`);
        lines.push(`   FROM: ${t.original}`);
        lines.push(`   TO:   ${t.current}`);
        lines.push('');
      });
    }

    if (state.annotations.length) {
      lines.push(`ANNOTATIONS (${state.annotations.length})`);
      lines.push('─'.repeat(40));
      state.annotations.forEach((a, i) => {
        const ann = a.el || document.getElementById(`rd-ann-${a.id}`);
        const text = ann ? ann.querySelector('.rd-ann-textarea').value : a.text;
        lines.push(`${i+1}. at position (${Math.round(a.x)}, ${Math.round(a.y)}) — scroll offset ${Math.round(a.scrollY)}px`);
        lines.push(`   "${text || '(no text)'}"`);
        lines.push('');
      });
    }

    if (state.strokes.length) {
      lines.push(`DRAWINGS`);
      lines.push('─'.repeat(40));
      lines.push(`${state.strokes.length} stroke(s) drawn on the page.`);
      lines.push('(see strokes array in JSON for coordinates)');
      lines.push('');
    }

    if (state.compareDecisions.length) {
      lines.push(`COMPARE DECISIONS (${state.compareDecisions.length})`);
      lines.push('─'.repeat(40));
      state.compareDecisions.forEach((d, i) => {
        lines.push(`${i+1}. ${d.id} → ${d.choice.toUpperCase()}`);
        lines.push(`   TEXT: ${d.text.slice(0, 120)}${d.text.length > 120 ? '…' : ''}`);
        lines.push('');
      });
    }

    if (!state.textEdits.length && !state.annotations.length && !state.strokes.length && !state.compareDecisions.length) {
      lines.push('(no changes marked)');
    }

    return lines.join('\n');
  }

  function buildPayload() {
    const annData = state.annotations.map(a => {
      const el = a.el || document.getElementById(`rd-ann-${a.id}`);
      const text = el ? el.querySelector('.rd-ann-textarea').value : a.text;
      return { id: a.id, x: a.x, y: a.y, scrollY: a.scrollY, text };
    });

    return {
      page: window.location.pathname,
      timestamp: new Date().toISOString(),
      textEdits: state.textEdits,
      annotations: annData,
      strokes: state.strokes,
      compareDecisions: state.compareDecisions,
      brief: buildBrief()
    };
  }

  // ── COMPARE MODE ─────────────────────────────────────────────────────────
  //
  // Claude writes tools/markup-compare.json with an array of proposals:
  //   [{ "id": "dilate-what-it-is",
  //      "label": "Dilate > What It Is",
  //      "selector": ".writing-block",          // CSS selector to inject after
  //      "sectionIndex": 0,                      // which match (0-based)
  //      "old": "Original text...",
  //      "new": "Revised text...",
  //      "default": "old" }]                     // which is pre-selected
  //
  // Phil picks old/new, can edit either textarea.
  // Decisions land in markup-feedback.json under "compareDecisions".

  state.compareDecisions = [];  // { id, choice, text }

  document.getElementById('rd-btn-compare').addEventListener('click', async () => {
    // Remove any existing compare panels
    document.querySelectorAll('.rd-compare').forEach(el => el.remove());
    state.compareDecisions = [];

    try {
      const res = await fetch('http://localhost:8731/tools/markup-compare.json?t=' + Date.now());
      if (!res.ok) throw new Error('no compare file');
      const proposals = await res.json();

      if (!proposals.length) {
        alert('No compare proposals found in markup-compare.json');
        return;
      }

      proposals.forEach((p, pi) => {
        const targets = document.querySelectorAll(p.selector);
        const target = targets[p.sectionIndex || 0];
        if (!target) {
          console.warn(`[compare] no match for "${p.selector}" index ${p.sectionIndex || 0}`);
          return;
        }

        const chosen = p.default || 'new';
        const uid = p.id || `compare-${pi}`;
        const radioName = `rd-cmp-${uid}`;

        const panel = document.createElement('div');
        panel.className = 'rd-compare';
        panel.dataset.compareId = uid;
        panel.innerHTML = `
          <div class="rd-compare-header">
            <span>${p.label || uid}</span>
            <span style="font-size:7px;color:#666;">${uid}</span>
          </div>
          <div class="rd-compare-grid">
            <div class="rd-compare-col">
              <label class="rd-compare-col-label rd-old">
                <input type="radio" name="${radioName}" value="old" ${chosen==='old'?'checked':''}>
                original
              </label>
              <textarea class="rd-compare-ta ${chosen==='old'?'rd-chosen':'rd-dimmed'}" data-side="old">${escHtml(p.old || '')}</textarea>
            </div>
            <div class="rd-compare-col">
              <label class="rd-compare-col-label rd-new">
                <input type="radio" name="${radioName}" value="new" ${chosen==='new'?'checked':''}>
                revised
              </label>
              <textarea class="rd-compare-ta ${chosen==='new'?'rd-chosen':'rd-dimmed'}" data-side="new">${escHtml(p.new || '')}</textarea>
            </div>
          </div>
        `;

        // Insert after the target element
        target.parentNode.insertBefore(panel, target.nextSibling);

        // Wire radio buttons
        panel.querySelectorAll(`input[name="${radioName}"]`).forEach(radio => {
          radio.addEventListener('change', () => {
            const val = radio.value;
            panel.querySelectorAll('.rd-compare-ta').forEach(ta => {
              if (ta.dataset.side === val) {
                ta.classList.add('rd-chosen');
                ta.classList.remove('rd-dimmed');
              } else {
                ta.classList.remove('rd-chosen');
                ta.classList.add('rd-dimmed');
              }
            });
            syncCompareDecision(uid, panel);
          });
        });

        // Wire textarea input
        panel.querySelectorAll('.rd-compare-ta').forEach(ta => {
          ta.addEventListener('input', () => syncCompareDecision(uid, panel));
        });

        // Initial decision
        syncCompareDecision(uid, panel);
      });

      console.log(`[compare] loaded ${proposals.length} proposal(s)`);
      const btn = document.getElementById('rd-btn-compare');
      btn.textContent = `\u21D4 ${proposals.length} loaded`;
      btn.style.color = '#e8ff00';

    } catch (err) {
      console.warn('[compare]', err.message);
      alert('Could not load markup-compare.json. Make sure Claude has written it first.');
    }
  });

  function syncCompareDecision(uid, panel) {
    const radio = panel.querySelector('input[type="radio"]:checked');
    if (!radio) return;
    const choice = radio.value;
    const ta = panel.querySelector(`.rd-compare-ta[data-side="${choice}"]`);
    const text = ta ? ta.value : '';

    const idx = state.compareDecisions.findIndex(d => d.id === uid);
    const decision = { id: uid, choice, text };
    if (idx >= 0) {
      state.compareDecisions[idx] = decision;
    } else {
      state.compareDecisions.push(decision);
    }
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── INIT ──────────────────────────────────────────────────────────────────
  setMode('select');
  console.log('[renato markup] loaded. compare button loads proposals');

})();
