/**
 * swarf: one tab at a time (Phil 10-30: "would still like to be able to move/delete/change them
 * individually"). In cam, with no mode to enter or leave: a press on a tab picks it (it lights
 * up; the size card gives way to the tab's own card).
 *   - drag it: it slides along the part's outline, stays on the edge and turned to it, and stops
 *     short of another tab or a place TEX cuts through
 *   - Delete or Backspace (not while typing in a field): it goes. A deleted auto tab leaves a
 *     "no tab here" spot, so placing again leaves that place empty (cl-autotab.js)
 *   - its card: length, height and reach in the cam units (SwarfLength: 3/4 in, 12 mm), "back
 *     to automatic" for an auto tab you changed, delete
 * An auto tab moved or resized becomes pinned: placing again never moves, resizes or deletes it.
 * Every change is one step of undo. A press anywhere else lets the tab go; esc does too.
 *
 * Why no mode: a tab is its own small box on the edge, so a press on one is never a press meant
 * for the part (a press on the part still picks and moves the part). tabs › + keeps its own
 * clicks (add on the edge, a click on a tab removes it); a pick waits while it is on.
 */

import { api } from '../../../app/api.js';
import { env } from './init-ui.js';
import { space as SPACE } from '../../../../moto/space.js';
import { tabHooks, boxColor, boxOpacity } from './cl-tab.js';
import { tabSnap, tabUndo, autoSpot, autoReplan, partLoops, pierceAvoid, tabZ, dropLive, addLive, setOf } from './cl-autotab.js';
import { loopInfo, nearestOnLoops, edgeOf, recordAt, overlaps } from './autotab-rule.js';

const SL = () => window.SwarfLength;
const say = mm => (SL() ? SL().say(mm) : `${(+mm).toFixed(2)} mm`);
const DRAG_PX = 3;       // a press that moves less than this is a click, not a drag
const KEYS = [['width', 'length', 'y', 'how long the tab is, along the edge'], ['height', 'height', 'z', 'how tall the tab is, up from the bottom of the cut'], ['depth', 'reach', 'x', 'how far the tab reaches across the cut']];

let picked = null;       // { widget, id }
let drag = null;         // { widget, id, x, y, moved, before, loops, info, others, avoid }
let card = null, els = {};

const recOf = p => p && (api.widgets.annotate(p.widget.id).tab || []).find(r => r.id === p.id);
const liveOf = p => p && p.widget.tabs && p.widget.tabs[p.id];

function inputHasFocus() {
    const a = document.activeElement;
    return !!(a && (a.nodeName === 'INPUT' || a.nodeName === 'TEXTAREA' || a.nodeName === 'SELECT' || a.isContentEditable));
}

// the picked tab's color in this skin (--sk3d-tab-picked); bright yellow in the swarf look (the tabs themselves are red)
function pickColor() {
    return window.SwarfSkin ? window.SwarfSkin.color('tab-picked', 0xffe14a) : 0xffe14a;
}

function light(on) {
    const live = liveOf(picked);
    if (!live || !live.box) return;
    const m = live.box.material;
    m.color.setHex(on ? pickColor() : boxColor());
    m.opacity = on ? 0.95 : boxOpacity();
    if (m.emissive) m.emissive.setHex(on ? 0x331a00 : 0x000000);
    SPACE.update();
}

export function tabPick(widget, id) {
    tabUnpick();
    picked = { widget, id };
    light(true);
    showCard();
    return picked;
}

export function tabUnpick() {
    if (!picked) return;
    light(false);
    picked = null;
    hideCard();
}

// ---- pointer: pick, drag ---------------------------------------------------------------------

function ndc(e, el) {
    const r = el.getBoundingClientRect();
    return new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
}

// the tab box under the pointer, nearest first
function tabAt(e) {
    const I = SPACE.internals(), el = I.renderer.domElement;
    const boxes = [];
    for (const w of api.widgets.all()) {
        if (w.track.synth || !w.mesh || !w.mesh.visible) continue;
        for (const live of Object.values(w.tabs || {})) if (live && live.box && live.box.visible !== false) boxes.push(live.box);
    }
    if (!boxes.length) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc(e, el), I.camera);
    const hit = ray.intersectObjects(boxes, false)[0];
    return hit && hit.object.tab ? { widget: hit.object.tab.widget, id: hit.object.tab.id } : null;
}

// where the pointer meets the plane of the tab, in the part's frame
function pointerOnPart(e, widget, z) {
    const I = SPACE.internals();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc(e, I.renderer.domElement), I.camera);
    const mesh = widget.mesh;
    mesh.updateMatrixWorld();
    const origin = new THREE.Vector3(0, 0, z).applyMatrix4(mesh.matrixWorld);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
    const at = ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin), new THREE.Vector3());
    return at ? mesh.worldToLocal(at) : null;
}

// may a press on the canvas pick a tab now: cam, arrange, no tool of its own holding the mouse
function canPick(e, hover) {
    if (!env.isCamMode || (!hover && e.button !== 0)) return false;
    if (api.feature.hover || api.feature.on_mouse_down || api.feature.on_mouse_up) return false;
    if (api.view.is_arrange && !api.view.is_arrange()) return false;
    const I = SPACE.internals();
    return !!(I && I.renderer && e.target === I.renderer.domElement);
}

function onDown(e) {
    if (!canPick(e)) return;
    const hit = tabAt(e);
    if (!hit) { tabUnpick(); return; }
    // the press is the tab's: the view does not turn and the part is not picked or moved
    e.preventDefault();
    e.stopPropagation();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    tabPick(hit.widget, hit.id);
    const rec = recOf(picked);
    if (!rec) return;
    drag = { widget: hit.widget, id: hit.id, x: e.clientX, y: e.clientY, moved: false, before: tabSnap([hit.widget]) };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
}

function onMove(e) {
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_PX) return;
    const { widget } = drag;
    const rec = recOf(drag);
    if (!rec) return;
    if (!drag.moved) {
        drag.moved = true;
        drag.loops = partLoops(widget, rec.dim.z);
        drag.info = loopInfo(drag.loops);
        drag.others = (api.widgets.annotate(widget.id).tab || []).filter(r => r.id !== rec.id).map(r => ({ ...edgeOf(r), w: r.dim.y }));
        drag.avoid = pierceAvoid(widget);
    }
    if (!drag.loops.length) return;
    const p = pointerOnPart(e, widget, rec.pos.z);
    if (!p) return;
    const hit = nearestOnLoops(drag.loops, p, drag.info);
    if (!hit) return;
    const bit = rec.dim.x || 6.35;
    if (overlaps(hit, rec.dim.y, drag.others)) return note('another tab is there');
    if (drag.avoid && drag.avoid(hit.x, hit.y, rec.dim.y / 2 + bit)) return note('tex cuts through there');
    note('');
    moveTo(widget, rec, recordAt(rec, hit));
}

function onUp(e) {
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    const d = drag;
    drag = null;
    if (!d.moved) return;
    const rec = recOf(d);
    if (rec && rec.auto) rec.pinned = true;
    d.widget.saveState();
    api.conf.save();
    tabUndo(d.before, 'tab moved');
    showCard();
}

// a record to a new place: the record, and its box drawn again (its turn is baked into the box)
function moveTo(widget, rec, at) {
    dropLive(widget, rec);
    Object.assign(rec, at);
    addLive(widget, rec);
    light(true);
}

function onHover(e) {
    if (drag || e.buttons || !canPick(e, true)) return;
    const el = e.target;
    const over = !!tabAt(e);
    if (over) el.style.cursor = 'grab';
    else if (el.style.cursor === 'grab') el.style.cursor = '';
}

// ---- keys --------------------------------------------------------------------------------------

function onKey(e) {
    if (!picked) return;
    if (e.key === 'Escape') { tabUnpick(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !inputHasFocus() && !(api.modal && api.modal.visible && api.modal.visible())) {
        // the tab goes, not the part it is on
        e.preventDefault();
        e.stopPropagation();
        tabDelete();
    }
}

// ---- the edits ---------------------------------------------------------------------------------

/** Delete the picked tab (an auto one leaves a "no tab here" spot). */
export function tabDelete() {
    const p = picked, rec = recOf(p);
    if (!rec) return false;
    const before = tabSnap([p.widget]);
    tabUnpick();
    const anno = api.widgets.annotate(p.widget.id);
    dropLive(p.widget, rec);
    anno.tab = anno.tab.filter(r => r.id !== rec.id);
    autoSpot(p.widget, rec);
    p.widget.saveState();
    api.conf.save();
    SPACE.update();
    tabUndo(before, 'tab deleted');
    api.show.alert('tab deleted (undo brings it back)', 3);
    return true;
}

/**
 * Resize the picked tab: key is width (length), height or depth (reach), mm in millimeters.
 * @returns {string} '' when done, else what stopped it
 */
export function tabResize(key, mm) {
    const p = picked, rec = recOf(p);
    if (!rec || !(mm > 0)) return 'type a number above zero';
    const w = p.widget, T = (w.track.box && w.track.box.d) || Infinity;
    let why = '';
    const dim = { ...rec.dim };
    if (key === 'width') {
        const others = (api.widgets.annotate(w.id).tab || []).filter(r => r.id !== rec.id).map(r => ({ ...edgeOf(r), w: r.dim.y }));
        if (overlaps(edgeOf(rec), mm, others)) return 'that long, it runs into the next tab';
        dim.y = mm;
    } else if (key === 'height') {
        dim.z = Math.min(mm, T * 0.9);
        if (dim.z < mm) why = `held to ${say(dim.z)}, under the board's thickness`;
    } else if (key === 'depth') {
        dim.x = mm;
    } else return 'no such size';
    if (dim.x === rec.dim.x && dim.y === rec.dim.y && dim.z === rec.dim.z) return why;
    const before = tabSnap([w]);
    const e = edgeOf(rec), a = Math.atan2(rec.pos.y - e.y, rec.pos.x - e.x);
    const z = dim.z === rec.dim.z ? rec.pos.z : tabZ(w, dim.z);
    dropLive(w, rec);
    rec.dim = dim;
    // still half its reach out from the same edge point, and standing on the bottom of the cut
    rec.pos = { x: e.x + Math.cos(a) * dim.x / 2, y: e.y + Math.sin(a) * dim.x / 2, z };
    if (rec.auto) rec.pinned = true;
    addLive(w, rec);
    light(true);
    w.saveState();
    api.conf.save();
    SPACE.update();
    tabUndo(before, 'tab resized');
    showCard();
    return why;
}

/** The picked auto tab goes back to automatic: it is planned again with the others. */
export function tabAuto() {
    const p = picked, rec = recOf(p);
    if (!rec || !rec.auto || !setOf(p.widget)) return false;
    const before = tabSnap([p.widget]);
    tabUnpick();
    const anno = api.widgets.annotate(p.widget.id);
    dropLive(p.widget, rec);
    anno.tab = anno.tab.filter(r => r.id !== rec.id);
    autoReplan(p.widget);
    SPACE.update();
    tabUndo(before, 'tab back to automatic');
    return true;
}

// ---- the card ------------------------------------------------------------------------------------

function buildCard() {
    card = document.createElement('div');
    card.id = 'swarf-tabcard';
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', 'the picked tab');
    els.kind = Object.assign(document.createElement('span'), { className: 'kind' });
    card.append(els.kind);
    els.f = {};
    for (const [key, word, , title] of KEYS) {
        const inp = document.createElement('input');
        inp.id = `swarf-tab-${key}`;
        inp.inputMode = 'text';
        inp.spellcheck = false;
        inp.autocomplete = 'off';
        inp.setAttribute('aria-label', `tab ${word}`);
        inp.title = title;
        const commit = () => {
            if (!inp.dataset.typed) return;
            delete inp.dataset.typed;
            const v = SL() ? SL().parse(inp.value) : parseFloat(inp.value);
            const why = Number.isFinite(v) && v > 0 ? tabResize(key, Math.round(v * 1000) / 1000) : 'type a number above zero, like 1/2 or 12 mm';
            note(why);
            showCard(true);
        };
        inp.addEventListener('keydown', e => {
            e.stopPropagation();   // typing here never reaches cam's keys (Delete stays in the field)
            // the blur commits, so the field shows the number back in its own form (3/4 -> 0.75)
            if (e.key === 'Enter') { e.preventDefault(); inp.dataset.typed = '1'; inp.blur(); }
            if (e.key === 'Escape') { e.preventDefault(); delete inp.dataset.typed; inp.blur(); showCard(); }
        });
        inp.addEventListener('keypress', e => e.stopPropagation());
        inp.addEventListener('input', () => { inp.dataset.typed = '1'; });
        inp.addEventListener('blur', commit);
        const wrap = document.createElement('label');
        wrap.className = 'ax';
        wrap.append(inp, Object.assign(document.createElement('small'), { textContent: word }));
        card.append(wrap);
        els.f[key] = inp;
    }
    els.unit = Object.assign(document.createElement('span'), { className: 'mm' });
    card.append(els.unit, Object.assign(document.createElement('span'), { className: 'sep' }));
    const act = (id, word, title, fn) => {
        const b = Object.assign(document.createElement('button'), { id, className: 'act', textContent: word, title });
        b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); fn(); });
        card.append(b);
        return b;
    };
    els.auto = act('swarf-tab-auto', 'back to automatic', 'let auto tabs place and size this one again', tabAuto);
    act('swarf-tab-del', 'delete', 'take this tab away (or press Delete); an auto tab leaves the place empty', tabDelete);
    els.note = Object.assign(document.createElement('span'), { className: 'note' });
    els.note.setAttribute('aria-live', 'polite');
    card.append(els.note);
    document.body.appendChild(card);
}

function note(text) {
    if (!els.note) return;
    els.note.textContent = text || (picked ? 'drag it along the edge' : '');
    // the standing hint is one line (r086 check P1: it wrapped to two once "stays as you set it" showed)
    els.note.classList.toggle('hint', !text);
}

function showCard(keepNote) {
    const rec = recOf(picked);
    if (!rec) return hideCard();
    if (!card) buildCard();
    els.kind.textContent = !rec.auto ? 'your own tab' : rec.pinned ? 'auto tab, stays as you set it' : 'auto tab';
    els.auto.style.display = rec.auto && rec.pinned ? '' : 'none';
    for (const [key, , d] of KEYS) {
        const el = els.f[key];
        if (document.activeElement !== el) el.value = SL() ? (SL().field || SL().show)(rec.dim[d]) : String(+(+rec.dim[d]).toFixed(2));
    }
    els.unit.textContent = SL() ? SL().unit() : 'mm';
    if (!keepNote) note('');
    card.classList.add('on');
    document.body.classList.add('swarf-tab-picked');
}

function hideCard() {
    if (card) card.classList.remove('on');
    document.body.classList.remove('swarf-tab-picked');
}

// ---- wiring --------------------------------------------------------------------------------------

export function tabEditInit() {
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onHover, false);
    window.addEventListener('keydown', onKey, true);
    // a tab clicked away with tabs › + is one step of undo too, and an auto one leaves a spot
    tabHooks.edit = (widget, fn) => { const before = tabSnap([widget]); fn(); tabUndo(before, 'tabs'); };
    tabHooks.removed = (widget, rec) => autoSpot(widget, rec);
    const drop = () => tabUnpick();
    api.event.on(['slice.begin', 'mode.set', 'view.set', 'widget.delete', 'selection.scale', 'cam.tabs.clear', 'cam.tabs.add'], drop);
    api.event.on('feature.hover', on => { if (on) drop(); });
    api.event.on(['widget.rotate', 'widget.mirror', 'widget.duplicate'], drop);
    window.addEventListener('swarf.tabs.restored', drop);
    window.addEventListener('swarf.skin', () => light(true));
    if (api.ui.units) api.ui.units.addEventListener('change', () => setTimeout(() => picked && showCard(true), 0));
    window.__swarfTabEdit = {
        pick: tabPick, unpick: tabUnpick, delete: tabDelete, resize: tabResize, auto: tabAuto,
        get picked() { return picked ? { widget: picked.widget.id, id: picked.id } : null; },
        color: pickColor,
    };
}
