/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { api } from './api.js';
import { space } from '../../moto/space.js';
import { THREE } from '../../ext/three.js';
import { tool as MeshTool } from '../../mesh/tool.js';
import { Widget } from './widget.js';
import { encode as objEncode } from '../../load/obj.js';
import { encode as stlEncode } from '../../load/stl.js';
import { $ } from '../../moto/webui.js';

/**
 * Array of currently selected widget meshes.
 * @type {Array}
 */
const selectedMeshes = [];

function updateTool(ev) {
    api.tool.update(ev);
}

/**
 * Execute function for each unique group represented in selection.
 * Passes the first widget from each group to the function.
 * @param {function} fn - Function(widget) to execute for each group
 */
function for_groups(fn) {
    // (a part taken off the bed has an empty group: nothing to act on)
    let groups = widgets(true).map(w => w.group).filter(g => g && g.length).uniq();
    for (let group of groups) {
        fn(group[0]);
    }
}

/**
 * Execute function for each selected widget.
 * If nothing selected, defaults to all widgets unless noauto=true.
 * @param {function} fn - Function(widget) to execute
 * @param {boolean} [noauto] - If true, don't auto-select all widgets when none selected
 */
function for_widgets(fn, noauto) {
    let m = selectedMeshes;
    let w = api.widgets.all();
    if (m.length === 0 && w.length) {
        m = noauto ? [] : w.map(w => w.mesh);
    }
    m.slice().forEach(mesh => { fn(mesh.widget) });
}

/**
 * Execute function for all widgets with selection status.
 * @param {function} fn - Function(widget, is_selected) to execute
 */
function for_status(fn) {
    api.widgets.all().forEach(w => {
        fn(w, selectedMeshes.contains(w.mesh));
    });
}

/**
 * Execute function for each selected mesh.
 * @param {function} fn - Function(mesh) to execute
 */
function for_meshes(fn) {
    selectedMeshes.slice().forEach(mesh => { fn(mesh) });
}

/**
 * Move selected widget groups.
 * Only works in ARRANGE view.
 * @param {number} x - X offset
 * @param {number} y - Y offset
 * @param {number} z - Z offset
 * @param {boolean} [abs] - If true, use absolute positioning instead of relative
 */
function move(x, y, z, abs) {
    if (!api.view.is_arrange()) {
        return;
    }
    for_groups(w => w.move(x, y, z, abs));
    update_bounds();
    api.platform.update_bounds();
    api.event.emit('selection.move', {x, y, z, abs});
    space.update();
    api.space.auto_save();
}

/**
 * Compute bounding box of all selected meshes.
 * @returns {THREE.Box3} Bounding box
 */
function get_bounds() {
    // Helper to compute bounds of selected meshes
    const THREE = self.THREE;
    let bounds = new THREE.Box3();
    selection.for_meshes(mesh => {
        let box = mesh.getBoundingBox().clone();
        let pos = mesh.widget.mesh.position;
        box.min.add(pos);
        box.max.add(pos);
        bounds = bounds.union(box);
    });
    return bounds;
}

/**
 * Update UI size/scale info fields based on selected mesh bounds.
 * Calculates combined bounding box and displays dimensions/scale in UI.
 */
function update_info() {
    const ui = api.ui;
    let bounds = new THREE.Box3(), track;
    for_meshes(mesh => {
        let box = mesh.getBoundingBox().clone();
        track = mesh.widget.track;
        let {pos} = track
        box.min.add(pos);
        box.max.add(pos);
        bounds = bounds.union(box);
    });
    if (bounds.min.x === Infinity) {
        if (selectedMeshes.length === 0) {
            ui.size.X.value = 0;
            ui.size.Y.value = 0;
            ui.size.Z.value = 0;
            ui.scale.X.value = 1;
            ui.scale.Y.value = 1;
            ui.scale.Z.value = 1;
        }
        return;
    }
    let dx = bounds.max.x - bounds.min.x,
        dy = bounds.max.y - bounds.min.y,
        dz = bounds.max.z - bounds.min.z,
        scale = api.view.unit_scale();
    // swarf: inches to 4 places, so 20 mm reads 0.787 in the size card, not 0.79
    ui.size.X.value = ui.size.X.was = (dx / scale).round(scale === 25.4 ? 4 : 2)
    ui.size.Y.value = ui.size.Y.was = (dy / scale).round(scale === 25.4 ? 4 : 2)
    ui.size.Z.value = ui.size.Z.was = (dz / scale).round(scale === 25.4 ? 4 : 2)
    ui.scale.X.value = ui.scale.X.was = track.scale.x.round(2);
    ui.scale.Y.value = ui.scale.Y.was = track.scale.y.round(2);
    ui.scale.Z.value = ui.scale.Z.was = track.scale.z.round(2);
    update_bounds();
}

/**
 * Update platform bounds and constrain widgets to bed limits.
 * For belt mode, fits widgets and updates origin.
 * Automatically moves widgets back into bounds if they exceed bed size.
 * @param {Array<Widget>} [widgets] - Widgets to bound. Defaults to selected widgets.
 */
function update_bounds(widgets) {
    const settings = api.conf.get();
    // update bounds on selection for drag limiting
    const isBelt = settings.device.bedBelt;
    if (isBelt) {
        if (api.platform.fit()) {
            api.platform.update_origin();
            space.update();
        }
    }
    const dvy = settings.device.bedDepth;
    const dvx = settings.device.bedWidth;
    const bounds_sel = new THREE.Box3();
    if (!widgets) {
        widgets = selectedMeshes.map(m => m.widget);
    }
    for (let widget of widgets) {
        const wp = widget.track.pos;
        const bx = widget.track.box;
        const miny = wp.y - bx.h / 2 + dvy / 2;
        const maxy = wp.y + bx.h / 2 + dvy / 2;
        const minx = wp.x - bx.w / 2 + dvx / 2;
        const maxx = wp.x + bx.w / 2 + dvx / 2;
        // keep widget in bounds when rotated or scaled
        const ylo = miny < 0;
        const yhi = !isBelt && maxy > dvy
        if (ylo && !yhi) {
            widget.move(0, -miny, 0);
        } else if (yhi && !ylo) {
            widget.move(0, dvy - maxy, 0);
        }
        const xlo = minx < 0;
        const xhi = maxx > dvx;
        if (xlo && !xhi) {
            widget.move(-minx, 0, 0);
        } else if (xhi && !xlo) {
            widget.move(dvx - maxx, 0, 0);
        }

        const wb = widget.mesh.getBoundingBox().clone();
        wb.min.x += wp.x;
        wb.max.x += wp.x;
        wb.min.y += wp.y;
        wb.max.y += wp.y;
        bounds_sel.union(wb);
    }
    settings.bounds_sel = bounds_sel;
}

/**
 * Duplicate selected widgets with offset.
 * Only works in ARRANGE view.
 * New widgets offset by bounding box width + 1 in X direction.
 */
function duplicate() {
    if (!api.view.is_arrange()) {
        return;
    }
    const made = [];
    // one undo takes the copies away again; the steps before it stay undoable
    api.doit.quietly(() => for_widgets(widget => {
        const bb = widget.mesh.getBoundingBox();
        const op = widget.track.pos;
        // swarf: 12 mm to the right, the layout's gap, and no re-pack,
        // so the original stays where it was put
        const nw = copyOf(widget);
        nw.move(op.x + bb.max.x - bb.min.x + 12, op.y, op.z, true);
        api.platform.add(nw, false, true);      // the copy is the one picked
        api.event.emit("widget.duplicate", nw, widget);
        made.push(nw);
    }));
    if (made.length) {
        const n = made.length;
        api.doit.made(made, { undo: `Took back the ${n === 1 ? 'copy' : `${n} copies`}.`, redo: `The ${n === 1 ? 'copy is' : `${n} copies are`} back.` });
        api.space.auto_save();
    }
}

/**
 * swarf: a copy of a widget: its geometry, its name's next number, its drawing, marks and tabs.
 * Not on the bed yet.
 * @param {Widget} ow - the widget to copy
 * @param {Array} [group] - the group it joins (a word's letters stay one word); else its own
 */
function copyOf(ow, group) {
        const mesh = ow.mesh;
        const nw = api.widgets.new(undefined, group).loadGeometry(mesh.geometry.clone());
        // swarf: a copy has its own name ("…-2", "…-3"), so the list tells them apart
        const base = String(ow.meta.file || 'part').replace(/-\d+$/, '');
        const taken = new Set(api.widgets.all().map(w => w.meta.file));
        let n = 2;
        while (taken.has(`${base}-${n}`)) n++;
        nw.meta.file = `${base}-${n}`;
        nw.meta.vertices = ow.meta.vertices;
        // swarf: the copy keeps its drawing (DRAW, save drawing) and its marks (TEX: the same
        // mark ids, so the same texture steps cut it) and sits beside the original
        for (const k of ['svg', 'c0', 'xf', 't', 'edge', 'tilted', 'engrave', 'tex', 'drawn', 'orig', 'rq', 'rflat', 'disabled']) {
            if (ow.meta[k] !== undefined) nw.meta[k] = JSON.parse(JSON.stringify(ow.meta[k]));
        }
        nw.anno = ow.annotations();
        // what a step has picked on this part comes along: a copy with no floor or holes of its own
        // was cut free with its pocket missing, and drilled the holes the original had unticked
        for (const op of api.conf.get().process?.ops || []) {
            for (const k of ['surfaces', 'drills']) {
                if (op && op[k] && op[k][ow.id] !== undefined) op[k][nw.id] = JSON.parse(JSON.stringify(op[k][ow.id]));
            }
        }
        return nw;
}

/**
 * swarf: the picked parts again at each offset (edit › copies, web/kiri/swarf-size.js). All of it is
 * one undo. Every part on the bed that was picked stays picked, with its copies, so they move together.
 * @param {Array<{x:number,y:number}>} offsets - from where the picked parts sit, in mm
 * @param {Object} say - { undo, redo } what each says when it runs
 * @returns {Array} the new widgets
 */
function copies(offsets, say) {
    const from = widgets();
    if (!api.view.is_arrange() || !from.length || !offsets.length) {
        return [];
    }
    const made = [];
    const leads = [];
    self.__swarfCopying = true;     // a copy keeps its place (swarf-place.js) and the sentence is said once
    try {
        api.doit.quietly(() => {
            for (const off of offsets) {
                const groups = new Map();
                for (const ow of from) {
                    let group;
                    if (ow.group && ow.group.length > 1) {
                        group = groups.get(ow.group);
                        if (!group) groups.set(ow.group, group = []);
                    }
                    const nw = copyOf(ow, group);
                    const op = ow.track.pos;
                    nw._move(op.x + off.x, op.y + off.y, op.z, true);
                    if (!group || group.length === 1) leads.push(nw);
                    made.push(nw);
                    api.platform.add(nw, true, true);
                    api.event.emit("widget.duplicate", nw, ow);
                }
            }
        });
        // adding a piece of a group toggles the rest of it: the picks as they should end
        const picked = from.concat();
        api.platform.deselect();
        for (const w of picked) if (!api.selection.contains(w)) api.platform.select(w, true);
        for (const w of leads) if (!api.selection.contains(w)) api.platform.select(w, true);
    } finally {
        self.__swarfCopying = false;
    }
    api.doit.made(made, say);
    api.space.auto_save();
    return made;
}

/**
 * Mirror selected widgets along X axis.
 * Only works in ARRANGE view.
 */
function mirror() {
    if (!api.view.is_arrange()) {
        return;
    }
    // Widget.mirror flips its whole group about the group's centre (its members share one place),
    // so once per group: a word reads backwards as a word, and a group of two is not flipped back
    const groups = new Set();
    const onBed = api.widgets.all();
    for_widgets(widget => { if (onBed.includes(widget) && widget.group && widget.group.length) groups.add(widget.group); });
    for (const g of groups) {
        // members placed apart (not sharing one place) trade places about the group's centre too
        const apart = g.some(w => w.track.pos.x !== g[0].track.pos.x);
        let cx = 0;
        if (apart) {
            let x0 = Infinity, x1 = -Infinity;
            for (const w of g) {
                const b = w.getBoundingBox();
                x0 = Math.min(x0, w.track.pos.x + b.min.x); x1 = Math.max(x1, w.track.pos.x + b.max.x);
            }
            cx = (x0 + x1) / 2;
        }
        g[0].mirror();
        if (apart) for (const w of g) w._move(2 * cx - w.track.pos.x, w.track.pos.y, w.track.pos.z, true);
    }
    api.platform.update_bounds();
    space.update();
    api.space.auto_save();
}

/**
 * Scale selected widget groups.
 * Only works in ARRANGE view.
 * Updates bounds, saves workspace, refreshes info and display.
 * @param {number} x - X scale factor
 * @param {number} y - Y scale factor
 * @param {number} z - Z scale factor
 * @param {boolean} [last] - If strictly false, skips auto-save
 */
function scale() {
    if (!api.view.is_arrange()) {
        return;
    }
    let args = [...arguments];
    for_groups(w => w.scale(...args));
    selection.update_bounds();
    api.platform.update_bounds();
    api.event.emit('selection.scale', args);
    // skip update if last argument is strictly 'false'
    if (args.last() === false) {
        return;
    }
    api.space.auto_save();
    selection.update_info();
    space.update();
}

/**
 * Rotate selected widget groups.
 * Only works in ARRANGE view.
 * Updates bounds, saves workspace, refreshes info and display.
 * @param {number} x - X rotation in radians
 * @param {number} y - Y rotation in radians
 * @param {number} z - Z rotation in radians
 */
function rotate(x, y, z) {
    if (!api.view.is_arrange()) {
        return;
    }
    for_groups(w => w.rotate(x, y, z));
    selection.update_bounds();
    api.platform.update_bounds();
    api.event.emit('selection.rotate', {x, y, z});
    api.space.auto_save();
    selection.update_info();
    space.update();
}

/**
 * Merge selected widgets into a single widget.
 * Combines all vertex data from selected widgets into one mesh.
 * @param {object} options - Options
 * @param {boolean} [options.deleteMerged=true] - If true, deletes original widgets after merge
 */
function merge({ deleteMerged = true }) {
    let sel = widgets();
    if (sel.length === 0) {
        sel = api.widgets.all();
    }
    let obj = [];
    sel.forEach(widget => {
        let {x, y, z} = widget.track.pos || { x:0, y:0, z:0 };
        let pos = widget.mesh.geometry.attributes.position;
        let pvals = pos.array;
        for (let i=0, il=pos.count; i<il; i += 3) {
            let pi = i * pos.itemSize;
            obj.push(pvals[pi++] + x, pvals[pi++] + y, pvals[pi++] + z);
            obj.push(pvals[pi++] + x, pvals[pi++] + y, pvals[pi++] + z);
            obj.push(pvals[pi++] + x, pvals[pi++] + y, pvals[pi++] + z);
        }
    });
    let w = api.platform.load_verts([], obj, "merged");
    if (deleteMerged) api.platform.delete(sel);
    api.platform.select(w);
}

/**
 * Isolates the bodies within the selected widgets. If no widgets are selected,
 * it processes all available widgets. For each widget, it checks if a tool is
 * associated; if not, it creates a new MeshTool and indexes the vertices.
 * The function identifies isolated bodies within each widget. If a widget has
 * a single body, it remains selected. Otherwise, it creates new widgets for
 * each isolated body and selects them while deleting the original widget.
 */
function isolateBodies(){
    let sel = widgets();
    console.log('isolate', sel);
    if (sel.length === 0) {
        sel = api.widgets.all();
    }
    for(let widget of sel){
        if (!widget.tool) {
            let tool = widget.tool = new MeshTool();
            tool.index(widget.getGeoVertices({ unroll: true, translate:true }));
        }
        let bodies = widget.tool.isolateBodies()
        if(bodies.length ==1){
            api.platform.select(widget);
        }else{
            // console.log(bodies,Array.from(bodies.entries()))
            for(let [i,verts] of bodies.entries()){
                let w = api.platform.load_verts([], verts, `isolate ${i} of ${ widget.anno.file}`);
                api.platform.select(w)
            }
            api.platform.delete(widget);
        }
    }
}

/**
 * swarf: when several parts come in together, for instance as an stl, a right
 * click ungroups them so they can be selected and worked on and deleted separately.
 *
 * pieces(w): the separate solids in one part's mesh, as lists of triangle numbers. Triangles that
 * share a corner (by position, to 1/10000 mm) are one piece. A closed shell turned inside out that
 * lies inside a solid (a hollow: its volume reads negative) belongs to that solid. Remembered per
 * mesh until its corners change (a move does not change them; a turn or a scale does).
 */
const piecesSeen = new WeakMap();
const BIG = 1000000;    // triangles: past this a part is counted when asked, not on every right-click
function sample(arr) {
    let s = arr.length;
    const step = Math.max(1, Math.floor(arr.length / 64));
    for (let i = 0; i < arr.length; i += step) s += arr[i] * (i % 7 + 1);
    return s;
}
function counted(w) {
    const arr = w && w.mesh && w.mesh.geometry && w.getGeoVertices({ unroll: true });
    const seen = arr && piecesSeen.get(w);
    return seen && seen.arr === arr && seen.sum === sample(arr) ? seen.out : null;
}
function pieces(w) {
    const arr = w && w.mesh && w.mesh.geometry && w.getGeoVertices({ unroll: true });
    if (!arr || !arr.length) return [];
    const was = counted(w);
    if (was) return was;
    const n = (arr.length / 9) | 0;
    // a corner's key is its position; each triangle joins the pieces of its three corners
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
    const owner = new Map();
    const keyOf = o => `${Math.round(arr[o] * 1e4)},${Math.round(arr[o + 1] * 1e4)},${Math.round(arr[o + 2] * 1e4)}`;
    for (let t = 0; t < n; t++) {
        for (let k = 0; k < 3; k++) {
            const key = keyOf(t * 9 + k * 3);
            const had = owner.get(key);
            if (had === undefined) { owner.set(key, t); continue; }
            const a = find(had), b = find(t);
            if (a !== b) parent[a] = b;
        }
    }
    const byRoot = new Map();
    for (let t = 0; t < n; t++) {
        const r = find(t);
        let p = byRoot.get(r);
        if (!p) byRoot.set(r, p = { tris: [], vol: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
        p.tris.push(t);
        const o = t * 9;
        const ax = arr[o], ay = arr[o + 1], az = arr[o + 2], bx = arr[o + 3], by = arr[o + 4], bz = arr[o + 5], cx = arr[o + 6], cy = arr[o + 7], cz = arr[o + 8];
        p.vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
        for (let k = 0; k < 9; k++) {
            const v = arr[o + k], d = k % 3;
            if (v < p.min[d]) p.min[d] = v;
            if (v > p.max[d]) p.max[d] = v;
        }
    }
    let list = [...byRoot.values()];
    // a hollow belongs to the smallest solid around it: inside out (negative volume), closed (each
    // edge on two triangles), and truly inside (a ray from one of its corners crosses the solid an
    // odd number of times), not only inside its box. Only when the file has solids that read
    // positive: a whole file wound backwards keeps every piece.
    const solids = list.filter(p => p.vol > 0);
    if (solids.length && solids.length < list.length) {
        const inBox = (a, b) => [0, 1, 2].every(d => a.min[d] >= b.min[d] - 1e-3 && a.max[d] <= b.max[d] + 1e-3);
        const size = p => (p.max[0] - p.min[0]) * (p.max[1] - p.min[1]) * (p.max[2] - p.min[2]);
        const closed = p => {
            const edges = new Map();
            for (const t of p.tris) for (let k = 0; k < 3; k++) {
                const a = keyOf(t * 9 + k * 3), b = keyOf(t * 9 + ((k + 1) % 3) * 3);
                const e = a < b ? a + '|' + b : b + '|' + a;
                edges.set(e, (edges.get(e) || 0) + 1);
            }
            for (const c of edges.values()) if (c !== 2) return false;
            return true;
        };
        // a ray along +x from (x, y, z), nudged off the axes so it misses edges: odd crossings = inside
        const within = (h, s) => {
            const o0 = h.tris[0] * 9, px = arr[o0], py = arr[o0 + 1] + 1.234e-5, pz = arr[o0 + 2] + 2.345e-5;
            let hits = 0;
            for (const t of s.tris) {
                const o = t * 9;
                const ay = arr[o + 1], az = arr[o + 2], by = arr[o + 4], bz = arr[o + 5], cy = arr[o + 7], cz = arr[o + 8];
                const d = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
                if (Math.abs(d) < 1e-12) continue;
                const u = ((py - ay) * (cz - az) - (pz - az) * (cy - ay)) / d;
                const v = ((by - ay) * (pz - az) - (bz - az) * (py - ay)) / d;
                if (u < 0 || v < 0 || u + v > 1) continue;
                const x = arr[o] + u * (arr[o + 3] - arr[o]) + v * (arr[o + 6] - arr[o]);
                if (x > px) hits++;
            }
            return hits % 2 === 1;
        };
        for (const h of list.filter(p => p.vol <= 0)) {
            const host = solids.filter(s => inBox(h, s)).sort((a, b) => size(a) - size(b)).find(s => within(h, s));
            if (!host || !closed(h)) continue;
            for (const t of h.tris) host.tris.push(t);
            h.gone = true;
        }
        list = list.filter(p => !p.gone);
    }
    const out = list.map(p => p.tris);
    piecesSeen.set(w, { arr, sum: sample(arr), out });
    return out;
}

/**
 * swarf: what separate(w) would do to this part: 'group' (parts that came in together and move as
 * one: each moves on its own after), 'pieces' (one mesh holding several solids: each becomes a
 * part), 'maybe' (a mesh too big to count on a right-click: counted when asked), or null.
 * Not for a drawn part, a part with tex marks or one on the rotary axis: those carry what a piece
 * could not keep (its drawing, its marks and their steps, its axis).
 */
function separable(w) {
    if (!w || !api.view.is_arrange()) return null;
    // ungrouping moves each mesh within its part: a drawing and carved words move with it
    // (followMesh), marks and the rotary axis would not
    if (w.group && w.group.length > 1) return w.group.some(p => (p.meta.tex && p.meta.tex.length) || p.track.indexed) ? null : 'group';
    const m = w.meta || {};
    if (m.svg || m.drawn || m.engrave || (m.tex && m.tex.length) || w.track.indexed) return null;
    const known = counted(w);
    if (!known && (w.meta.vertices || 0) / 3 > BIG) return 'maybe';
    return pieces(w).length > 1 ? 'pieces' : null;
}

/**
 * swarf: separate a part. Parts grouped on import are ungrouped, each centred on itself where it
 * sat; a mesh of several solids becomes one part per solid, each where it sat, named <name>-1, -2,
 * ..., keeping the tabs and the picked floors that fall on it. One undo step either way.
 * @returns {{ n: number, how: string, lost: string[] }} n 0: nothing to separate
 */
function separate(w) {
    const how = separable(w);
    if (!how) return { n: 0, how };
    const name = String(w.meta.file || 'the part');
    if (how === 'group') {
        const members = w.group.slice();
        // a member whose place moved by d had its mesh moved by -d within it: its drawing
        // (meta.t), carved words and original curves sit in the mesh frame and move the same way
        const followMesh = fn => {
            const was = members.map(m => ({ x: m.track.pos.x, y: m.track.pos.y }));
            fn();
            members.forEach((m, i) => {
                const dx = m.track.pos.x - was[i].x, dy = m.track.pos.y - was[i].y;
                if (!(dx || dy)) return;
                const meta = m.meta || {};
                if (meta.t) meta.t = [meta.t[0] - dx, meta.t[1] - dy];
                for (const k of ['engrave', 'orig']) {
                    if (Array.isArray(meta[k])) for (const L of meta[k]) {
                        if (L && L.crv && L.crv.ctrlPts) L.crv.ctrlPts = L.crv.ctrlPts.map(([x, y, z, wt]) => [x - dx, y - dy, z, wt]);
                    }
                }
            });
        };
        const after = lead => {
            api.platform.deselect();
            api.platform.select(lead, false);
            api.platform.update_bounds();
            api.space.auto_save();
        };
        const split = () => {
            followMesh(() => {
                Widget.Groups.split(members);
                // each member's mesh was placed about the group's centre: centred on itself, it turns,
                // mirrors and scales about itself, and its box is its own
                for (const m of members) {
                    const g = m.mesh.geometry;
                    g.computeBoundingBox();
                    const b = g.boundingBox, dx = (b.min.x + b.max.x) / 2, dy = (b.min.y + b.max.y) / 2;
                    m.moveMesh(dx, dy, 0);
                    m._move(dx, dy, 0);
                    m.group.centered = true;
                }
            });
            after(w);
        };
        const join = () => {
            followMesh(() => Widget.Groups.merge(members));
            after(members[0]);
        };
        split();
        api.doit.push(join, split, {
            undo: `the ${members.length} parts move together again`,
            redo: `the ${members.length} parts move on their own`
        });
        return { n: members.length, how, lost: [] };
    }
    const list = pieces(w);
    if (list.length < 2) return { n: 1, how: 'one', lost: [] };
    const arr = w.getGeoVertices({ unroll: true });
    const op = w.track.pos;
    const base = name.replace(/\.(stl|obj|3mf|amf)$/i, '').replace(/-\d+$/, '');
    const taken = new Set(api.widgets.all().map(x => x.meta.file));
    const anno = w.annotations ? w.annotations() : (w.anno || {});
    const ops = (api.conf.get().process || {}).ops || [];
    const whereTri = new Map();     // the original's triangle number -> [piece, its number there]
    const lost = [];
    let n = 1;
    const made = [], boxes = [];
    list.forEach((tris, pi) => {
        const v = new Float32Array(tris.length * 9);
        let i = 0;
        tris.forEach((t, j) => { whereTri.set(t, [pi, j]); for (let k = 0; k < 9; k++) v[i++] = arr[t * 9 + k]; });
        let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let j = 0; j < v.length; j += 3) {
            if (v[j] < x0) x0 = v[j]; if (v[j] > x1) x1 = v[j];
            if (v[j + 1] < y0) y0 = v[j + 1]; if (v[j + 1] > y1) y1 = v[j + 1];
            if (v[j + 2] < z0) z0 = v[j + 2];
        }
        // centred on its own footprint, its bottom on the bed, then moved back where it sat
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        for (let j = 0; j < v.length; j += 3) { v[j] -= cx; v[j + 1] -= cy; v[j + 2] -= z0; }
        const nw = api.widgets.new().loadVertices(v);
        nw.center();                // its box for the layout and the checks (the mesh is already centred)
        nw.group.centered = true;
        while (taken.has(`${base}-${n}`)) n++;
        taken.add(nw.meta.file = `${base}-${n}`);
        if (w.meta.disabled) nw.meta.disabled = w.meta.disabled;
        nw._move(op.x + cx, op.y + cy, op.z, true);
        made.push(nw);
        boxes.push({ x0, y0, x1, y1, cx, cy });
    });
    // tabs: each goes to the piece whose footprint is nearest it (a tab sits on an outline's edge)
    const tabs = (anno.tab || []);
    for (const rec of tabs) {
        const d = b => Math.hypot(Math.max(b.x0 - rec.pos.x, 0, rec.pos.x - b.x1), Math.max(b.y0 - rec.pos.y, 0, rec.pos.y - b.y1));
        let best = 0;
        boxes.forEach((b, k) => { if (d(b) < d(boxes[best])) best = k; });
        const nw = made[best], b = boxes[best], c = JSON.parse(JSON.stringify(rec));
        c.pos = { x: rec.pos.x - b.cx, y: rec.pos.y - b.cy, z: rec.pos.z };
        nw.anno = nw.anno || {};
        (nw.anno.tab = nw.anno.tab || []).push(c);
    }
    // a step's picked floors are triangle numbers: each goes to its piece, renumbered there
    for (const o of ops) {
        const picks = o && o.surfaces && o.surfaces[w.id];
        if (!picks || !picks.length) continue;
        for (const f of picks) {
            const at = whereTri.get(f);
            if (!at) continue;
            const id = made[at[0]].id;
            (o.surfaces[id] = o.surfaces[id] || []).push(at[1]);
        }
    }
    if (ops.some(o => o && o.drills && o.drills[w.id])) lost.push('the drill step finds its holes again on each piece');
    api.doit.swap([w], made, {
        undo: `${name} is one part again`,
        redo: `${name} is ${made.length} parts again`
    });
    return { n: made.length, how, lost };
}

/**
 * Export selected widgets to STL or OBJ format.
 * If multiple widgets, applies position offsets in STL format.
 * @param {string} [format="stl"] - Export format: "stl" or "obj"
 * @returns {ArrayBuffer|string} Encoded file data
 */
function exportWidgets(format = "stl") {
    let sel = widgets();
    if (sel.length === 0) {
        sel = api.widgets.all();
    }
    let facets = 0;
    let outs = [];
    sel.forEach(widget => {
        let mesh = widget.mesh;
        let geo = mesh.geometry;
        outs.push({geo, widget});
        facets += geo.attributes.position.count;
    });
    if (format === "obj") {
        let recs = outs.map(out => {
            let meta = out.widget.meta;
            let name = meta.file || 'unnamed';
            let { position } = out.geo.attributes;
            return { file: name, varr: position.array };
        });
        return objEncode(recs);
    }
    let recs = outs.map(out => {
        let { position } = out.geo.attributes;
        let pvals = position.array;
        let varr = pvals;

        // Apply position offset if exporting multiple widgets
        if (outs.length > 1) {
            let {x, y, z} = out.widget.track.pos;
            varr = new Float32Array(pvals.length);
            for (let i = 0; i < pvals.length; i += 3) {
                varr[i] = pvals[i] + x;
                varr[i+1] = pvals[i+1] + y;
                varr[i+2] = pvals[i+2] + z;
            }
        }

        return { file: out.widget.meta.file || 'unnamed', varr };
    });
    return stlEncode(recs);
}

/**
 * Get selected widgets.
 * @param {boolean} [orall] - If true and nothing selected, returns all widgets
 * @returns {Array<Widget>} Selected widgets or empty array
 */
function widgets(orall) {
    let sel = selectedMeshes.slice().map(m => m.widget);
    return sel.length ? sel : orall ? api.widgets.all() : []
}

function setDisabled(bool) {
    for_widgets(w => w.meta.disabled = bool);
    api.platform.update_selected();
}

function settings() {
    return api.conf.get();
}

/**
 * Prompt user for rotation angles and rotate selection.
 * Shows alert if nothing selected.
 * Accepts comma-separated X,Y,Z degrees.
 */
function input_rotate() {
    if (selection.meshes().length === 0) {
        api.show.alert("select object to rotate");
        return;
    }
    api.uc.prompt("Enter X,Y,Z degrees of rotation","").then(coord => {
        coord = (coord || '').split(',');
        let prod = Math.PI / 180,
            x = parseFloat(coord[0] || 0.0) * prod,
            y = parseFloat(coord[1] || 0.0) * prod,
            z = parseFloat(coord[2] || 0.0) * prod;
        selection.rotate(x, y, z);
    });
}

/**
 * Prompt user for position coordinates and move selection.
 * Shows alert if nothing selected.
 * Accepts comma-separated X,Y coordinates.
 * Adjusts for center vs corner origin modes.
 */
function input_position() {
    if (selection.meshes().length === 0) {
        api.show.alert("select object to position");
        return;
    }
    let current = settings(),
        { device, process} = current,
        center = process.ctOriginCenter || process.camOriginCenter || device.bedRound || device.originCenter,
        bounds = selection.get_bounds();

    api.uc.prompt("Enter X,Y coordinates for selection","").then(coord => {
        coord = (coord || '').split(',');
        let x = parseFloat(coord[0] || 0.0),
            y = parseFloat(coord[1] || 0.0),
            z = parseFloat(coord[2] || 0.0);

        if (!center) {
            x = x - device.bedWidth/2 + (bounds.max.x - bounds.min.x)/2;
            y = y - device.bedDepth/2 + (bounds.max.y - bounds.min.y)/2
        }

        selection.move(x, y, z, true);
    });
}

/**
 * Handle size input change event.
 * Calculates scale ratio from size change and applies to selection.
 * Respects lock checkboxes for proportional scaling.
 * Prevents scales below 0.1.
 * @param {Event} e - Input change event
 * @param {object} ui - UI elements object with size/lock fields
 */
function input_resize(e, ui) {
    let dv = parseFloat(e.target.value || 1),
        pv = parseFloat(e.target.was || 1),
        ra = dv / pv,
        xv = parseFloat(ui.size.X.was ?? ui.scale.X.value) || 1,
        yv = parseFloat(ui.size.Y.was ?? ui.scale.Y.value) || 1,
        zv = parseFloat(ui.size.Z.was ?? ui.scale.Z.value) || 1,
        ta = e.target,
        xc = ui.lock.X.checked,
        yc = ui.lock.Y.checked,
        zc = ui.lock.Z.checked,
        xt = ta === ui.size.X,
        yt = ta === ui.size.Y,
        zt = ta === ui.size.Z,
        tl = (xt && xc) || (yt && yc) || (zt && zc),
        xr = ((tl && xc) || (!tl && xt) ? ra : 1),
        yr = ((tl && yc) || (!tl && yt) ? ra : 1),
        zr = ((tl && zc) || (!tl && zt) ? ra : 1);
    // prevent null scale
    if (xv * xr < 0.1 || yv * yr < 0.1 || zv * zr < 0.1) {
        api.alerts.show('invalid scale value');
        return;
    }
    selection.scale(xr,yr,zr);
    ui.size.X.was = ui.size.X.value = xv * xr;
    ui.size.Y.was = ui.size.Y.value = yv * yr;
    ui.size.Z.was = ui.size.Z.value = zv * zr;
}

/**
 * Handle scale input change event.
 * Calculates scale ratio from scale change and applies to selection.
 * Respects lock checkboxes for proportional scaling.
 * Prevents scales below 0.1.
 * @param {Event} e - Input change event
 * @param {object} ui - UI elements object with scale/lock fields
 */
function input_scale(e, ui) {
    let dv = parseFloat(e.target.value || 1),
        pv = parseFloat(e.target.was || 1),
        ra = dv / pv,
        xv = parseFloat(ui.scale.X.was ?? ui.scale.X.value) || 1,
        yv = parseFloat(ui.scale.Y.was ?? ui.scale.Y.value) || 1,
        zv = parseFloat(ui.scale.Z.was ?? ui.scale.Y.value) || 1,
        ta = e.target,
        xc = ui.lock.X.checked,
        yc = ui.lock.Y.checked,
        zc = ui.lock.Z.checked,
        xt = ta === ui.scale.X,
        yt = ta === ui.scale.Y,
        zt = ta === ui.scale.Z,
        tl = (xt && xc) || (yt && yc) || (zt && zc),
        xr = ((tl && xc) || (!tl && xt) ? ra : 1),
        yr = ((tl && yc) || (!tl && yt) ? ra : 1),
        zr = ((tl && zc) || (!tl && zt) ? ra : 1);
    // prevent null scale
    if (xv * xr < 0.1 || yv * yr < 0.1 || zv * zr < 0.1) {
        api.alerts.show('invalid scale value');
        return;
    }
    selection.scale(xr,yr,zr);
    ui.scale.X.was = ui.scale.X.value = xv * xr;
    ui.scale.Y.was = ui.scale.Y.value = yv * yr;
    ui.scale.Z.was = ui.scale.Z.value = zv * zr;
}

function parse_as_float(e) {
    e.target.value = parseFloat(e.target.value) || 0;
}

/**
 * Bind input handlers to UI elements.
 * Sets up Enter key handlers for scale, size, tool, and rotation inputs.
 * @param {object} ui - UI elements object
 */
function input_binding(ui) {
    // on enter but not on blur (upstream behavior)
    space.event.onEnterKey([
        ui.scale.X,        (e) => input_scale(e, ui),
        ui.scale.Y,        (e) => input_scale(e, ui),
        ui.scale.Z,        (e) => input_scale(e, ui),
        ui.size.X,         (e) => input_resize(e, ui),
        ui.size.Y,         (e) => input_resize(e, ui),
        ui.size.Z,         (e) => input_resize(e, ui),
    ]);
    // swarf: also apply on blur so typing a value and tabbing/clicking
    // away works without hunting for Enter. Guard with a `was` check so an
    // unchanged field (e.g. user just focused and left) doesn't fire.
    const applyScale = (e) => { if (parseFloat(e.target.value) !== parseFloat(e.target.was)) input_scale(e, ui); };
    const applyResize = (e) => { if (parseFloat(e.target.value) !== parseFloat(e.target.was)) input_resize(e, ui); };
    [ui.scale.X, ui.scale.Y, ui.scale.Z].forEach(el => el?.addEventListener('blur', applyScale));
    [ui.size.X, ui.size.Y, ui.size.Z].forEach(el => el?.addEventListener('blur', applyResize));
    // on enter and blur
    space.event.onEnterKey([
        ui.toolName,       updateTool,
        ui.toolNum,        updateTool,
        ui.toolFluteDiam,  updateTool,
        ui.toolFluteLen,   updateTool,
        ui.toolShaftDiam,  updateTool,
        ui.toolShaftLen,   updateTool,
        ui.toolTaperTip,   updateTool,
        ui.toolTaperAngle, updateTool,
        $('rot_x'),        parse_as_float,
        $('rot_y'),        parse_as_float,
        $('rot_z'),        parse_as_float
    ], true);
}

// extend API (api.selection)
export const selection = {
    copies,
    duplicate,
    for_groups,
    for_meshes,
    for_status,
    for_widgets,
    get_bounds,
    input_binding,
    input_position,
    input_rotate,
    isolateBodies,
    merge,
    pieces,
    separable,
    separate,
    mirror,
    move,
    rotate,
    scale,
    update_bounds,
    update_info,
    widgets,
    export:     exportWidgets,
    add(w)      { selectedMeshes.addOnce(w.mesh) },
    delete()    { api.platform.delete(widgets()) },
    remove(w)   { return selectedMeshes.remove(w.mesh) },
    count()     { return selectedMeshes.length },
    contains(w) { return selectedMeshes.indexOf(w.mesh) >= 0 },
    enable()    { setDisabled(false) },
    disable()   { setDisabled(true) },
    opacity()   { api.widgets.opacity(...arguments) },
    meshes()    { return selectedMeshes.slice() },
};
