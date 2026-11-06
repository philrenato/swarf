/*
 * swarf menu — what you can do with a part, where it is (Phil 11-02: "consider what might be
 * appropriate for right click features ala Unreason. Maybe people could get to rotate etc that
 * way?"). Right-click a part on the bed: turn it, turn it over, stand it on its side or lay it flat,
 * mirror, duplicate, leave it out of this run, edit it in draw, texture it in tex, delete. Right-
 * click the empty bed: make a shape, draw, open a file, select all, and three ways to look. In
 * simulate: play or pause, start over, and the ways to look.
 *
 * As in Unreason (its context menus, 372):
 *   - a right-click opens the menu on release, and only if the mouse did not move: a right-drag
 *     still pans the view
 *   - a long press (half a second, under 8 px of movement) opens it on a touch screen or a pencil,
 *     which have no right button; Shift+F10 or the menu key opens it for the picked parts
 *   - only what can act is listed: no grayed rows
 *   - a press on a row runs it (closing on any pointerdown would empty the menu under the press)
 * Every row calls what the app already does (cam's selection, the objects list's tick, TEX's
 * lay flat): the menu is a way there, not a second copy.
 */
(function () {
  'use strict';
  const api = () => window.kiri && window.kiri.api;
  const LONG_MS = 500, SLOP = 8;
  let menu = null, press = null, longT = 0;

  const nameOf = w => (w && w.meta && w.meta.file) || 'the part';
  const busy = () => ['swarf-draw-open', 'swarf-tex-open', 'swarf-run-open'].some(c => document.body.classList.contains(c));
  const said = t => { const a = api(); try { a.event.alerts(true); a.show.alert(t, 5); } catch (e) { /* no alerts */ } };

  // the part under the pointer, by the view's own camera
  function partAt(x, y) {
    const a = api(), THREE = window.THREE, sp = window.moto && window.moto.space;
    if (!a || !THREE || !sp || !sp.internals) return null;
    const { camera, renderer } = sp.internals();
    const r = renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
    const ws = a.widgets.all().filter(w => w.mesh && w.mesh.visible !== false);
    const hit = ray.intersectObjects(ws.map(w => w.mesh), false)[0];
    return hit ? ws.find(w => w.mesh === hit.object) || null : null;
  }

  // rotation as cam rotates the picked parts (selected.js rotate: groups, bounds, save, the
  // selection.rotate event that keeps a part's turn and its TEX marks)
  const turn = (x, y, z) => api().selection.rotate(x, y, z);
  // back the way it last lay flat (swarf-board.js keeps meta.rq and meta.rflat for each part)
  function layFlat(w) {
    const THREE = window.THREE, m = w.meta || {};
    const now = new THREE.Quaternion(...(m.rq || [0, 0, 0, 1])), flat = new THREE.Quaternion(...(m.rflat || [0, 0, 0, 1]));
    w.rotate(flat.multiply(now.invert()));
    const a = api();
    try { a.selection.update_bounds(); a.platform.update_bounds(); a.space.auto_save(); a.selection.update_info(); window.moto.space.update(); } catch (e) { /* no workspace */ }
  }

  // onto its long edge: the turn is about the part's longer side on the bed, so a plank stands on
  // its long edge, not on its end
  function standOnEdge(w) {
    const b = w.getBoundingBox ? w.getBoundingBox() : null;
    const long = b && (b.max.y - b.min.y) > (b.max.x - b.min.x) ? 'y' : 'x';
    if (long === 'x') turn(Math.PI / 2, 0, 0); else turn(0, Math.PI / 2, 0);
  }

  function partItems(w) {
    const a = api(), sel = a.selection.widgets ? a.selection.widgets() : [];
    // a part already among the picked ones: the rows act on all of them; else on this one alone
    if (!sel.includes(w)) a.platform.select(w, false);
    const list = a.selection.widgets ? a.selection.widgets() : [w];
    const who = list.length > 1 ? `${list.length} parts` : nameOf(w);
    const out = list.every(p => p.meta && p.meta.disabled);
    const tilted = list.some(p => p.meta && p.meta.tilted);
    const items = [
      { label: 'turn left 90°', title: 'a quarter turn counterclockwise, seen from above', run: () => { turn(0, 0, Math.PI / 2); said(`Turned ${who} a quarter left.`); } },
      { label: 'turn right 90°', title: 'a quarter turn clockwise, seen from above', run: () => { turn(0, 0, -Math.PI / 2); said(`Turned ${who} a quarter right.`); } },
      { label: 'turn it over', title: 'upside down, its bottom on top: to cut its other side', run: () => { turn(0, Math.PI, 0); said(`Turned ${who} over: its other side is on top.`); } },
      tilted
        ? { label: 'lay it flat', title: 'back the way it last lay flat', run: () => { for (const p of list) if (p.meta && p.meta.tilted) layFlat(p); said(`${who} lies flat again.`); } }
        : { label: 'stand it on its side', title: 'a quarter turn onto its long edge: to cut into that edge', run: () => { standOnEdge(w); said(`${who} stands on its long edge. Lay it flat from here again.`); } },
      { label: 'mirror', title: 'flipped left to right', run: () => { a.selection.mirror(); said(`Mirrored ${who}.`); } },
      { label: 'duplicate', title: 'a copy beside it', run: () => a.selection.duplicate() },
      { label: 'copies…', title: 'rows and columns of it, with a gap', run: () => window.__swarfSize && window.__swarfSize.copies() },
      { sep: true },
      out
        ? { label: 'cut it in this run', title: 'tick it in objects again: its toolpaths come back', run: () => { a.platform.set_cut(list, true); said(`${who} will be cut in this run.`); } }
        : { label: 'leave it out of this run', title: 'untick it in objects: it stays on the bed, nothing cuts it', run: () => { a.platform.set_cut(list, false); said(`${who} is left out of this run: tick it in objects to cut it again.`); } },
    ];
    if (list.length === 1 && w.meta && w.meta.svg && window.__swarfDraw) items.push({ label: 'edit in draw', title: 'move its points, reshape it, change its thickness or edge', run: () => window.__swarfDraw.open() });
    if (list.length === 1 && document.getElementById('swarf-step-tex')) items.push({ label: 'texture it in tex', title: 'paint a texture or a mark on its top', run: () => document.getElementById('swarf-step-tex').click() });
    items.push({ sep: true }, { label: 'delete', title: '⌘Z brings it back', danger: true, run: () => a.selection.delete() });
    return { title: who, items };
  }

  function bedItems() {
    const a = api(), V = window.moto && window.moto.space && window.moto.space.view;
    const $ = id => document.getElementById(id);
    const items = [];
    if ($('swarf-step-shape')) items.push({ label: 'make a shape', title: 'a circle, rectangle, ring, polygon, star or slot, with a thickness', run: () => $('swarf-step-shape').click() });
    if (window.__swarfDraw) items.push({ label: 'draw a part', title: 'an outline or words, seen from above', run: () => window.__swarfDraw.open() });
    if ($('load-file')) items.push({ label: 'open a file', title: 'a drawing, a model or a .swarf project', run: () => $('load-file').click() });
    if (a.widgets.all().length && a.view.is_arrange()) items.push({ label: 'select all', title: 'every part on the bed', run: () => a.platform.select_all() });
    if (V) items.push({ sep: true },
      { label: 'look from above', run: () => V.top() },
      { label: 'look from the front', run: () => V.front() },
      { label: 'look around it', title: 'the view swarf starts with', run: () => V.home() });
    return { title: null, items: items.filter((it, i, l) => !(it.sep && (i === 0 || i === l.length - 1))) };
  }

  // in simulate the part is under the stock and the bed's rows make nothing there: the player and
  // the ways to look (the bar's own buttons, pressed)
  function simItems() {
    const an = (api().ui || {}).anim || {}, V = window.moto && window.moto.space && window.moto.space.view;
    const shown = b => b && b.style && b.style.display !== 'none' && b.isConnected;
    const items = [];
    if (shown(an.pause)) items.push({ label: 'pause', run: () => an.pause.click() });
    else if (shown(an.play)) items.push({ label: 'play', run: () => an.play.click() });
    if (an.replay) items.push({ label: 'start over', title: 'the board uncut, the bit at its first move', run: () => an.replay.click() });
    if (V) items.push({ sep: true },
      { label: 'look from above', run: () => V.top() },
      { label: 'look from the front', run: () => V.front() },
      { label: 'look around it', title: 'the view swarf starts with', run: () => V.home() });
    return { title: null, items: items.filter((it, i, l) => !(it.sep && (i === 0 || i === l.length - 1))) };
  }

  function close() {
    if (!menu) return;
    menu.remove(); menu = null;
  }

  function open(x, y, w) {
    close();
    const a = api();
    if (!a || busy()) return false;
    // parts are changed while arranging; simulate has the player; else the bed's rows
    const spec = a.view.get && a.view.get() === 4 ? simItems() : w && a.view.is_arrange() ? partItems(w) : bedItems();
    if (!spec.items.length) return false;
    menu = document.createElement('div');
    menu.className = 'swarf-ctx';
    menu.setAttribute('role', 'menu');
    if (spec.title) menu.append(Object.assign(document.createElement('div'), { className: 'swarf-ctx-title', textContent: spec.title }));
    for (const it of spec.items) {
      if (it.sep) { menu.append(Object.assign(document.createElement('div'), { className: 'swarf-ctx-sep' })); continue; }
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'menuitem');
      b.textContent = it.label;
      if (it.title) b.title = it.title;
      if (it.danger) b.classList.add('danger');
      b.onclick = () => { close(); try { it.run(); } catch (e) { console.warn('swarf menu:', e); } };
      menu.append(b);
    }
    document.body.append(menu);
    // inside the window, beside the pointer
    const r = menu.getBoundingClientRect(), W = innerWidth, H = innerHeight;
    menu.style.left = Math.max(8, Math.min(x, W - r.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, H - r.height - 8)) + 'px';
    const first = menu.querySelector('button');
    if (first) first.focus({ preventScroll: true });
    return true;
  }

  // the keys a menu answers to: up, down, Home, End, Escape (Enter and space press the row)
  document.addEventListener('keydown', e => {
    if (menu) {
      const bs = [...menu.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
      if (e.key === 'Escape') { close(); e.preventDefault(); e.stopPropagation(); return; }
      const go = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: bs.length - 1 }[e.key];
      if (go !== undefined) { bs[(go + bs.length) % bs.length].focus(); e.preventDefault(); e.stopPropagation(); }
      else if (e.key === 'Tab') close();
      return;
    }
    // Shift+F10 or the menu key: the picked parts' menu, at the middle of the view
    if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      const a = api(), t = e.target;
      if (!a || (t && t.closest && t.closest('input, textarea, select, [contenteditable]'))) return;
      const sel = a.selection && a.selection.widgets ? a.selection.widgets() : [];
      const c = canvas(), r = c ? c.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
      if (open(r.left + r.width / 2, r.top + r.height / 2, sel[0] || null)) e.preventDefault();
    }
  }, true);

  const canvas = () => { try { return window.moto.space.internals().renderer.domElement; } catch (e) { return null; } };

  function hook() {
    const c = canvas();
    if (!c || !api()) return false;
    // a press anywhere but on the menu closes it (capture: before the view takes the press)
    document.addEventListener('pointerdown', e => { if (menu && !(e.target.closest && e.target.closest('.swarf-ctx'))) close(); }, true);
    for (const ev of ['wheel', 'resize', 'blur']) window.addEventListener(ev, close, { passive: true });
    c.addEventListener('pointerdown', e => {
      clearTimeout(longT);
      press = { x: e.clientX, y: e.clientY, button: e.button, moved: false, type: e.pointerType };
      // a touch or a pencil held still: the menu
      if (e.pointerType !== 'mouse' && e.isPrimary) longT = setTimeout(() => { if (press && !press.moved) { press.long = true; open(press.x, press.y, partAt(press.x, press.y)); } }, LONG_MS);
    });
    window.addEventListener('pointermove', e => {
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > (press.type === 'mouse' ? 4 : SLOP)) { press.moved = true; clearTimeout(longT); }
    });
    // a right-click is told from a right-drag (a pan) on its release
    window.addEventListener('pointerup', e => {
      const p = press; press = null; clearTimeout(longT);
      if (!p || p.moved || p.button !== 2 || p.type !== 'mouse') return;
      // after the view's own mouseup, so its click handling never meets an open menu
      const w = partAt(e.clientX, e.clientY);
      setTimeout(() => open(e.clientX, e.clientY, w), 0);
    });
    // a held finger's menu stays open as it lifts; the view's own click on release is left alone
    window.addEventListener('pointercancel', () => { press = null; clearTimeout(longT); });
    return true;
  }

  window.__swarfMenu = { open, close, partAt, isOpen: () => !!menu, rows: () => menu ? [...menu.querySelectorAll('button')].map(b => b.textContent) : [] };
  let tries = 0;
  const t = setInterval(() => { if (hook() || ++tries > 200) clearInterval(t); }, 150);
})();
