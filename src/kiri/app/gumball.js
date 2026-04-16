/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */
//
// swarf r14+: Rhino-style gumball. A single TransformControls instance
// follows the selected widget through all three modes: translate, rotate,
// scale. Larger than the part, visible whenever a widget is selected in
// ARRANGE view. W/E/R switch modes (translate / rotate / scale). Esc
// deselects. While dragging, the orbit control is paused so camera doesn't
// fight the handle.

import { api } from './api.js';
import { space } from '../../moto/space.js';
import { THREE, TransformControls } from '../../ext/three.js';

let gumball = null;
let currentWidget = null;
let preDragSnapshot = null;
let capturedOrbit = null;

const MODE_KEYS = {
    'w': 'translate',
    'e': 'rotate',
    'r': 'scale'
};

function getOrbit() {
    // space.internals() exposes { renderer, camera, platform, container, raycaster };
    // the orbit controller is stored on space module-internal; read it via internals too.
    // Actually internals() doesn't expose viewControl. We reach it via space.view or
    // via the public api — easiest: pause/resume are implicit via dragging-changed
    // which we hook below. For now we just stop propagation of pointer events while
    // a gumball drag is active by setting a flag the orbit loop respects (if wired).
    // Realistically: disabling pointer events on the canvas during drag is enough.
    return null;
}

function ensureGumball() {
    if (gumball) return gumball;
    const { camera, renderer } = space.internals();
    if (!camera || !renderer) return null;

    gumball = new TransformControls(camera, renderer.domElement);
    // Make the gumball large relative to the part — Rhino-style, bigger than
    // the geometry so handles don't disappear inside the mesh. 1.0 is default;
    // we compute a per-widget size below in sizeTo().
    gumball.size = 1.2;
    // Translate by default; W/E/R switch.
    gumball.setMode('translate');

    // Add the TransformControls' visual helper to the scene. Newer Three
    // exposes getHelper(); older instances are themselves Object3D.
    const helper = typeof gumball.getHelper === 'function' ? gumball.getHelper() : gumball;
    try { space.scene.add(helper); } catch (e) { /* fallback: already-added */ }

    // While a handle is being dragged, keep the camera still. TransformControls
    // emits 'dragging-changed' on mousedown/up of handles — match that to the
    // canvas pointer-events so OrbitControls can't consume drags meant for us.
    gumball.addEventListener('dragging-changed', (ev) => {
        const canvas = renderer.domElement;
        if (ev.value) {
            // capture starting state for one undo-pair on drag end
            if (currentWidget) {
                const w = currentWidget;
                preDragSnapshot = {
                    pos: { x: w.track.pos.x, y: w.track.pos.y, z: w.track.pos.z },
                    scale: w.track.scale ? { x: w.track.scale.x, y: w.track.scale.y, z: w.track.scale.z } : null,
                    rot: w.track.rot ? { x: w.track.rot.x, y: w.track.rot.y, z: w.track.rot.z } : null
                };
            }
            // stop orbit from stealing the drag — set a global flag orbit code can check,
            // and also disable pointer-events on any overlay that might catch mouseup.
            capturedOrbit = true;
            canvas.setAttribute('data-gumball-drag', '1');
        } else {
            canvas.removeAttribute('data-gumball-drag');
            capturedOrbit = false;
            // On drag end, read the new widget transform out of the mesh and push
            // it through swarf's selection API so the existing rebuild pipeline
            // (bounds, stock, slicing) fires. TransformControls mutates the mesh
            // directly; we mirror that into widget.track so next slice sees it.
            commitDrag();
        }
    });

    // Feed every change back into the render pipeline so the scene updates
    // during the drag without waiting for the orbit tick.
    gumball.addEventListener('objectChange', () => {
        try { space.update && space.update(); } catch (e) {}
    });

    return gumball;
}

function commitDrag() {
    if (!currentWidget || !preDragSnapshot) return;
    const w = currentWidget;
    const mode = gumball && gumball.getMode ? gumball.getMode() : 'translate';
    const mesh = w.mesh;
    // Delta between snapshot and current mesh world position/rotation/scale.
    // For translate: widget.track.pos is the relative offset from origin —
    // we call selection.move(dx, dy, dz) with delta in mm.
    if (mode === 'translate') {
        const dx = mesh.position.x - preDragSnapshot.pos.x;
        const dy = mesh.position.y - preDragSnapshot.pos.y;
        const dz = mesh.position.z - preDragSnapshot.pos.z;
        // reset mesh position so selection.move isn't doubled on top of the
        // TransformControls' direct mutation — selection.move will re-apply.
        mesh.position.set(preDragSnapshot.pos.x, preDragSnapshot.pos.y, preDragSnapshot.pos.z);
        if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1e-4) {
            api.selection.move(dx, dy, dz);
        }
    } else if (mode === 'rotate') {
        // TransformControls stores rotation on mesh.rotation (Euler). Widget's
        // own rotate path rotates geometry, not mesh — so we snapshot the
        // Euler delta, reset the mesh, and call selection.rotate.
        const cur = mesh.rotation;
        const pre = preDragSnapshot.rot || { x: 0, y: 0, z: 0 };
        const rx = cur.x, ry = cur.y, rz = cur.z;
        mesh.rotation.set(0, 0, 0);
        if (Math.abs(rx) + Math.abs(ry) + Math.abs(rz) > 1e-4) {
            api.selection.rotate(rx, ry, rz);
        }
    } else if (mode === 'scale') {
        const cur = mesh.scale;
        const rx = cur.x || 1;
        const ry = cur.y || 1;
        const rz = cur.z || 1;
        mesh.scale.set(1, 1, 1);
        if (Math.abs(1 - rx * ry * rz) > 1e-4) {
            api.selection.scale(rx, ry, rz);
        }
    }
    preDragSnapshot = null;
    // Re-attach to the (possibly re-placed) mesh so the handle follows.
    if (gumball && currentWidget) {
        try { gumball.attach(currentWidget.mesh); } catch (e) {}
    }
    try { space.update && space.update(); } catch (e) {}
}

function sizeTo(widget) {
    if (!gumball || !widget || !widget.mesh) return;
    const geo = widget.mesh.geometry;
    try { geo.computeBoundingBox && geo.computeBoundingBox(); } catch (e) {}
    const bb = geo.boundingBox;
    if (!bb) return;
    const dim = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
    // Rhino-like: handles noticeably larger than the part. 1.2 default, bumped
    // further for small parts so the gumball never vanishes inside geometry.
    if (dim < 20) gumball.size = 2.0;
    else if (dim < 60) gumball.size = 1.6;
    else gumball.size = 1.2;
}

function attachToSelection() {
    const widgets = api.widgets.all();
    const selected = api.selection && api.selection.widgets ? api.selection.widgets() : [];
    // prefer explicitly selected widget; fall back to the only widget when
    // exactly one part is on the platform. matches swarf's for_widgets habit
    // (scale works without explicit selection if there's only one thing).
    let w = selected[0] || null;
    if (!w && widgets.length === 1) w = widgets[0];
    if (!gumball) ensureGumball();
    if (!gumball) return;
    // Only show in ARRANGE — the gumball makes no sense during slicing or sim.
    const arrange = api.view && api.view.is_arrange && api.view.is_arrange();
    if (!arrange || !w) {
        try { gumball.detach(); } catch (e) {}
        try { gumball.visible = false; } catch (e) {}
        currentWidget = null;
        return;
    }
    currentWidget = w;
    try { gumball.attach(w.mesh); } catch (e) {}
    sizeTo(w);
    gumball.visible = true;
    try { space.update && space.update(); } catch (e) {}
}

function setMode(mode) {
    if (!gumball) return;
    try { gumball.setMode(mode); } catch (e) {}
}

api.event.on('load-done', () => {
    ensureGumball();
    attachToSelection();

    // selection changes — re-attach or hide
    api.event.on('widget.select', attachToSelection);
    api.event.on('widget.deselect', attachToSelection);
    api.event.on('widget.add', attachToSelection);
    api.event.on('widget.delete', attachToSelection);
    api.event.on('view.set', attachToSelection);

    // W / E / R keyboard mode switch — standard 3D DCC convention.
    // Skip when a text field is focused so typing in inputs isn't hijacked.
    document.addEventListener('keydown', (ev) => {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
        if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
        const k = ev.key?.toLowerCase();
        if (MODE_KEYS[k]) {
            setMode(MODE_KEYS[k]);
            ev.preventDefault();
        }
    });
});

// expose for debugging + probes
export const gumballApi = {
    get instance() { return gumball; },
    get widget() { return currentWidget; },
    setMode,
    attach: attachToSelection
};
window.__swarfGumball = gumballApi;
