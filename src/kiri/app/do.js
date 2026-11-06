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
    switch (rec.type) {
        case 'move':
            for (let w of rec.widgets) {
                w._move(rec.dist.x, rec.dist.y, 0);
            }
            break;
        case 'rotate':
            for (let w of rec.widgets) {
                w.rotate(rec.x, rec.y, rec.z);
            }
            break;
        case 'scale':
            for (let w of rec.widgets) {
                w._scale(rec.x, rec.y, rec.z);
            }
            api.selection.update_info();
            break;
        // swarf (Interfacing review 10-28: delete could not be undone): a deleted part comes
        // back where it was, and undo-redo deletes it again
        case 'restore':
            quiet = true;
            // back into its group first: the delete emptied it, and a part with no group slices with
            // no tabs and has no scale or rotate (torture test 10-29: the outline cut straight through)
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

/**
 * Push an undo/redo action pair onto the stack.
 * Truncates stack at current position (clearing any "future" when adding new action).
 * @param {object} ur - Action pair with {undo, redo} records
 */
function pushActions(ur) {
    stack.length = stpos++;
    stack.push(ur);
    updateButtons();
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
// swarf: parts made and removed as part of another step (an inlay's plug, kept in step with its
// mark) are that step's undo, not their own, and never clear the stack
api.doit.quietly = function(fn) {
    const was = quiet;
    quiet = true;
    try { return fn(); } finally { quiet = was; }
};
event.on([
    'platform.layout',
    'widget.add'
], (widget) => {
    if (!quiet) clear();
});
event.on('widget.delete', (widget) => {
    if (quiet) return;
    const widgets = (Array.isArray(widget) ? widget : [widget]).map(w => w && (w.widget || w)).filter(Boolean);
    if (!widgets.length) return;
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
    pushActions({
        redo: {
            type,
            widgets,
            x, y, z
        },
        undo: {
            type,
            widgets,
            x: -x, y: -y, z: -z
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
