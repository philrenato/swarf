/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { api } from './api.js';
import { space } from '../../moto/space.js';
import { Widget } from '../core/widget.js';

const { event } = api;

/**
 * Undo/Redo action stack. Each entry contains {undo, redo} action records.
 * @type {Array<{undo: object, redo: object}>}
 */
let stack = [];

/** Current position in the undo/redo stack */
let stpos = 0;

/** Accumulator for drag movements - tracks cumulative x,y offset during selection drag */
let moved = { x: 0, y: 0 };

/** Message ID for the current undo/redo alert message */
let msgid;

event.on("load-done", () => {
    // swarf: no undo/redo buttons in UI (undo is the keyboard's job), but keep
    // the bind guarded in case upstream ever re-adds the DOM.
    const u = $('undo'); if (u) u.onclick = undo;
    const r = $('redo'); if (r) r.onclick = redo;

    // swarf: Cmd/Ctrl+Z for undo, Cmd/Ctrl+Shift+Z for redo. Skip when a
    // text input is focused so we don't steal the browser's in-field undo.
    document.addEventListener('keydown', (ev) => {
        if (!(ev.metaKey || ev.ctrlKey)) return;
        if (ev.key !== 'z' && ev.key !== 'Z') return;
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
        ev.preventDefault();
        if (ev.shiftKey) redo(); else undo();
    });
});

let undo = api.doit.undo = function() {
    if (stpos) {
        action(stack[--stpos].undo);
    } else {
        message('nothing to undo');
    }
};

let redo = api.doit.redo = function() {
    if (stpos < stack.length) {
        action(stack[stpos++].redo);
    } else {
        message('nothing to redo');
    }
};

/**
 * Clear the entire undo/redo stack and reset moved accumulator
 */
let clear = api.doit.clear = function() {
    stack = [];
    stpos = 0;
    moved = {x:0, y:0};
    updateButtons();
};

function updateButtons() {
    // swarf: no undo/redo UI in the chrome, but keep the guards in case the
    // DOM ever carries these ids again.
    const doit = $('doit');
    if (doit) {
        const isArrange = api.view.get() === api.consts.VIEWS.ARRANGE;
        doit.style.display = isArrange && stack.length ? 'flex' : 'none';
    }
    const u = $('undo'); if (u) u.disabled = stpos === 0;
    const r = $('redo'); if (r) r.disabled = stpos == stack.length;
}

function message(txt) {
    if (msgid) {
        api.hide.alert(msgid);
    }
    msgid = api.show.alert(txt);
}

/**
 * Execute an action record (undo or redo).
 * Dispatches based on action type: move, rotate, or scale.
 * @param {object} rec - Action record with type and action-specific properties
 * @param {string} rec.type - Action type: 'move', 'rotate', or 'scale'
 * @param {Array} rec.widgets - Widgets to operate on
 */
function action(rec) {
    // a group turns and scales as one (each call acts on the whole group), so once per group
    const groups = () => [...new Set(rec.widgets.map(w => w.group || [w]))].map(g => g[0]);
    switch (rec.type) {
        case 'move':
            for (let w of rec.widgets) {
                w._move(rec.dist.x, rec.dist.y, 0);
            }
            placed();
            break;
        case 'rotate':
            for (let w of groups()) {
                w.rotate(rec.x, rec.y, rec.z);
            }
            placed();
            break;
        case 'scale':
            for (let w of groups()) {
                w.scale(rec.x, rec.y, rec.z);
            }
            placed();
            break;
        // swarf: delete can be undone: a deleted part comes
        // back where it was, and undo-redo deletes it again
        case 'restore':
            quiet = true;
            // back into its group first: the delete emptied it, and a part with no group slices with
            // no tabs and has no scale or rotate (the outline would cut straight through)
            for (let w of rec.widgets) {
                const g = Widget.Groups.forid((w.group && w.group.id) || w.id);
                if (!g.includes(w)) g.push(w);
                w.group = g;
            }
            try { for (let w of rec.widgets) api.platform.add(w, true, true); } finally { quiet = false; }
            message(rec.say || (rec.widgets.length > 1 ? `${rec.widgets.length} parts are back` : 'the part is back'));
            break;
        case 'remove':
            quiet = true;
            telling = !!rec.say;
            try { api.platform.delete(rec.widgets.slice()); } finally { quiet = false; telling = false; }
            if (rec.say) message(rec.say);
            break;
        // swarf: a step that puts its own state back (tabs: placed, moved, resized, deleted)
        case 'call':
            rec.fn();
            if (rec.say) message(rec.say);
            break;
    }
    space.update();
    updateButtons();
}

// after an undo or redo moves, turns or scales parts: the stock, the picked box and the saved
// workspace follow, as they do for the step itself
function placed() {
    try {
        api.platform.update_bounds();
        api.selection.update_bounds();
        api.selection.update_info();
    } finally {
        api.space.auto_save();
    }
}

/**
 * Push an undo/redo action pair onto the stack.
 * Truncates stack at current position (clearing any "future" when adding new action).
 * @param {object} ur - Action pair with {undo, redo} records
 */
function pushActions(ur) {
    stack.length = stpos++;
    stack.push(ur);
    trim();
    updateButtons();
}

// swarf: deleted parts are kept whole for undo. Only the latest few, and no more than about
// GONE_TRIS triangles of them: a big relief deleted twice would hold gigabytes. The oldest entries go
// first (undo runs back in order, so everything before a dropped entry goes with it).
const GONE_MAX = 8, GONE_TRIS = 3e6;
const trisOf = w => { try { return (w.mesh.geometry.attributes.position.count || 0) / 3; } catch (e) { return 0; } };
function trim() {
    let n = 0, tris = 0;
    for (let i = stpos - 1; i >= 0; i--) {
        const u = stack[i].undo;
        if (!u || u.type !== 'restore') continue;
        n++;
        for (const w of u.widgets || []) tris += trisOf(w);
        // the latest delete is always kept, however big
        if (n > 1 && (n > GONE_MAX || tris > GONE_TRIS)) {
            stack.splice(0, i + 1);
            stpos -= i + 1;
            break;
        }
    }
}

/**
 * swarf: push a step that undoes and redoes itself.
 * @param {Function} undo puts the state before back
 * @param {Function} redo puts the state after back
 * @param {Object} say { undo, redo } what each says when it runs
 */
api.doit.push = function(undo, redo, say = {}) {
    pushActions({ undo: { type: 'call', fn: undo, say: say.undo }, redo: { type: 'call', fn: redo, say: say.redo } });
};

let quiet = false;   // an undo or redo of a delete must not clear the stack it came from
let telling = false; // this undo says what it did itself (the bed's "Deleted..." stays out of it)
api.doit.telling = () => telling;
api.doit.quiet = () => quiet;
// swarf: parts made together and taken back together (copies): the reverse of a delete
api.doit.made = function(widgets, say = {}) {
    pushActions({ undo: { type: 'remove', widgets, say: say.undo }, redo: { type: 'restore', widgets, say: say.redo } });
};
// swarf: parts that became other parts (separate: one part became its pieces). Runs the change
// now; undo takes the new parts away and puts the old ones back where they were, redo the reverse.
// Nothing is packed again (telling) and nothing is moved off its neighbour (swarf-place.js).
api.doit.swap = function(from, to, say = {}) {
    const go = (out, back, s) => {
        quiet = true; telling = true; self.__swarfCopying = true;
        try {
            api.platform.delete(out.slice());
            for (let w of back) {
                const g = Widget.Groups.forid((w.group && w.group.id) || w.id);
                if (!g.includes(w)) g.push(w);
                w.group = g;
                api.platform.add(w, true, true);
            }
        } finally { quiet = false; telling = false; self.__swarfCopying = false; }
        api.platform.deselect();
        for (let w of back) if (!api.selection.contains(w)) api.platform.select(w, true);
        api.space.auto_save();
        if (s) message(s);
    };
    go(from, to);
    pushActions({ undo: { type: 'call', fn: () => go(to, from), say: say.undo }, redo: { type: 'call', fn: () => go(from, to), say: say.redo } });
};
// swarf: parts made and removed as part of another step (an inlay's plug, kept in step with its
// mark) are that step's undo, not their own, and never clear the stack
api.doit.quietly = function(fn) {
    const was = quiet;
    quiet = true;
    try { return fn(); } finally { quiet = was; }
};
// a re-pack moves every part: the moves before it no longer say where a part was
event.on('platform.layout', (packed) => {
    if (packed === true && !quiet) clear();
});
// swarf: a new part (an import, a shape) keeps the history: every entry names its own parts. A part
// swapped for another (a .swarf opened, file › new, DRAW's done, TEX) leaves entries for parts that
// are gone, so those still start the history again.
const replacing = () => !!(self.__swarfRestoring || document.body.classList.contains('swarf-draw-open') || document.body.classList.contains('swarf-tex-open'));
event.on('widget.add', () => {
    if (!quiet && replacing()) clear();
});
event.on('widget.delete', (widget) => {
    if (quiet || replacing()) return;
    const widgets = (Array.isArray(widget) ? widget : [widget]).map(w => w && (w.widget || w)).filter(Boolean);
    if (!widgets.length) return;
    // a part kept for undo keeps its shape and place; its slices and shadows are made again if it comes back
    for (const w of widgets) {
        try { if (w.clearSlices) w.clearSlices(); w.cache = {}; } catch (e) { /* nothing held */ }
    }
    pushActions({ undo: { type: 'restore', widgets }, redo: { type: 'remove', widgets } });
});

event.on('view.set', mode => {
    updateButtons();
});

// selection event (store position)
event.on('selection.rotate', (rec) => {
    let type = "rotate";
    let widgets = api.selection.widgets(true);
    if (!widgets.length) {
        return;
    }
    let {x, y, z} = rec;
    if (!(x || y || z)) {
        return;
    }
    // a turn given as a quaternion (lay flat on a face) is undone by its inverse
    const back = x && x.isQuaternion ? { x: x.clone().invert() } : { x: -x, y: -y, z: -z };
    pushActions({
        redo: {
            type,
            widgets,
            x, y, z
        },
        undo: {
            type,
            widgets,
            ...back
        }
    })
});

event.on('selection.scale', (rec) => {
    let [x, y, z] = rec;
    // ignore scale close to 1
    if (Math.abs(1 - (x * y * z)) < 0.0001) {
        return;
    }
    let widgets = api.selection.widgets(true);
    if (!widgets.length) {
        return;
    }
    let type = "scale";
    pushActions({
        redo: {
            type,
            widgets,
            x, y, z
        },
        undo: {
            type,
            widgets,
            x: 1/x, y: 1/y, z: 1/z
        }
    });
});

// selection moved (accumulator)
event.on('selection.drag', (delta) => {
    moved.x += delta.x;
    moved.y += delta.y;
});

// move complete (store updated position)
event.on('mouse.drag.done', () => {
    let widgets = api.selection.widgets(true);
    if (!widgets.length) {
        return;
    }
    let type = "move";
    pushActions({
        redo: {
            type,
            widgets,
            dist: moved
        },
        undo: {
            type,
            widgets,
            dist: {x: -moved.x, y: -moved.y}
        }
    });
    moved = {x:0, y:0};
});
