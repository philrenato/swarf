/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */
//
// swarf r14+: Rhino-style gumball.
//
// Design:
// - Three TransformControls (translate, rotate, scale) all attached to a
//   single proxy Object3D at the widget's volume center. All three handle
//   sets are visible at once; there's no W/E/R mode switch.
// - During drag, the proxy moves under TransformControls' direct mutation.
//   We read the per-frame delta and apply it LIVE to the widget via
//   api.selection.move/rotate/scale so the part itself moves — not just
//   mesh.position, which creates the "floor is moving, part is static"
//   illusion Phil flagged.
// - On translate commit, snap the widget's bottom to z=0. Parts always sit
//   on the grid. Grid stays still during the drag; snap-back happens once
//   at drag end.
// - Proxy resyncs to widget volume center after every commit and whenever
//   selection / widget set changes, so the gumball never "loses" the part.

import { api } from './api.js';
import { space } from '../../moto/space.js';
import { THREE, TransformControls } from '../../ext/three.js';

// the three transform controllers — one per mode, all on the same proxy.
let controls = { translate: null, rotate: null, scale: null };
let proxy = null;            // invisible Object3D the gumball attaches to
let currentWidget = null;

// per-drag state
let dragging = null;          // 'translate' | 'rotate' | 'scale' | null
let dragStart = null;         // proxy snapshot at dragStart
let lastProxy = null;         // previous-frame proxy snapshot for delta

function ensureProxy() {
    if (proxy) return proxy;
    proxy = new THREE.Object3D();
    proxy.name = 'swarf-gumball-proxy';
    try { space.scene.add(proxy); } catch (e) {}
    return proxy;
}

function ensureControls() {
    if (controls.translate) return;
    const { camera, renderer } = space.internals();
    if (!camera || !renderer) return;

    ensureProxy();

    const modes = ['translate', 'rotate', 'scale'];
    for (const mode of modes) {
        const tc = new TransformControls(camera, renderer.domElement);
        tc.setMode(mode);
        // sizes offset slightly so the three gizmos don't overlap visually:
        // translate arrows innermost, rotate rings middle, scale cubes outermost.
        tc.size = mode === 'translate' ? 1.0 : mode === 'rotate' ? 1.5 : 2.0;
        tc.space = 'world';

        tc.addEventListener('dragging-changed', (ev) => {
            if (ev.value) onDragStart(mode);
            else          onDragEnd(mode);
            // tell orbit to stand down (picked up by any consumer reading this flag)
            renderer.domElement.setAttribute('data-gumball-drag', ev.value ? '1' : '');
        });
        tc.addEventListener('objectChange', () => onProxyChange(mode));

        try {
            const helper = typeof tc.getHelper === 'function' ? tc.getHelper() : tc;
            space.scene.add(helper);
        } catch (e) {}

        tc.attach(proxy);
        controls[mode] = tc;
    }
}

// Compute the widget's current volume center in world coordinates.
// widget.getBoundingBox() returns model-space bounds; track.pos is the
// widget's platform offset. The center is the bbox center shifted by pos.
function volumeCenter(widget) {
    if (!widget) return new THREE.Vector3();
    const bb = widget.getBoundingBox();
    const cx = (bb.min.x + bb.max.x) * 0.5 + (widget.track?.pos?.x || 0);
    const cy = (bb.min.y + bb.max.y) * 0.5 + (widget.track?.pos?.y || 0);
    const cz = (bb.min.z + bb.max.z) * 0.5 + (widget.track?.pos?.z || 0);
    return new THREE.Vector3(cx, cy, cz);
}

function syncProxyToWidget() {
    if (!proxy || !currentWidget) return;
    const c = volumeCenter(currentWidget);
    proxy.position.copy(c);
    proxy.rotation.set(0, 0, 0);
    proxy.scale.set(1, 1, 1);
    proxy.updateMatrixWorld(true);
    lastProxy = snapshotProxy();
}

function snapshotProxy() {
    return {
        pos: proxy.position.clone(),
        rot: proxy.rotation.clone(),
        scl: proxy.scale.clone()
    };
}

function onDragStart(mode) {
    if (!currentWidget) return;
    dragging = mode;
    dragStart = snapshotProxy();
    lastProxy = snapshotProxy();
    // hide the other two gumballs while one is active so handles don't collide.
    for (const m of Object.keys(controls)) {
        if (m !== mode && controls[m]) controls[m].enabled = false;
    }
}

function onDragEnd(mode) {
    dragging = null;
    dragStart = null;
    lastProxy = null;
    for (const m of Object.keys(controls)) {
        if (controls[m]) controls[m].enabled = true;
    }
    if (!currentWidget) return;

    // bottom-snap to z=0 after any transform ends (translate, rotate, or
    // scale can all shift the bottom). Rotate changes orientation, which
    // may lift the lowest point off z=0; re-snap so parts always sit on
    // the grid.
    snapBottomToGrid();

    // resync proxy to the freshly-settled widget volume center so the
    // gumball re-centers on the part every time.
    syncProxyToWidget();
    try { space.update && space.update(); } catch (e) {}
}

function snapBottomToGrid() {
    if (!currentWidget) return;
    try {
        const w = currentWidget;
        const bb = w.getBoundingBox();
        const bottomZ = bb.min.z + (w.track?.pos?.z || 0);
        if (Math.abs(bottomZ) > 1e-4) {
            api.selection.move(0, 0, -bottomZ);
        }
    } catch (e) {}
}

function onProxyChange(mode) {
    if (!currentWidget || !dragging || dragging !== mode) return;
    if (!lastProxy) { lastProxy = snapshotProxy(); return; }
    const now = snapshotProxy();

    if (mode === 'translate') {
        const dx = now.pos.x - lastProxy.pos.x;
        const dy = now.pos.y - lastProxy.pos.y;
        // constrain Z so parts don't lift off the grid mid-drag. We'll re-snap
        // on drag end either way, but keeping the drag in XY feels natural
        // for CNC parts sitting on stock.
        api.selection.move(dx, dy, 0);
    } else if (mode === 'rotate') {
        // apply the per-frame Euler delta directly. proxy rotation is Euler;
        // convert to small-angle delta by diffing component-wise.
        const rx = now.rot.x - lastProxy.rot.x;
        const ry = now.rot.y - lastProxy.rot.y;
        const rz = now.rot.z - lastProxy.rot.z;
        if (Math.abs(rx) + Math.abs(ry) + Math.abs(rz) > 1e-6) {
            api.selection.rotate(rx, ry, rz);
        }
    } else if (mode === 'scale') {
        // scale factor = now / last. clamp low end so a flicker through 0
        // doesn't zero the widget.
        const sx = Math.max(0.01, now.scl.x / Math.max(1e-6, lastProxy.scl.x));
        const sy = Math.max(0.01, now.scl.y / Math.max(1e-6, lastProxy.scl.y));
        const sz = Math.max(0.01, now.scl.z / Math.max(1e-6, lastProxy.scl.z));
        if (Math.abs(1 - sx * sy * sz) > 1e-6) {
            api.selection.scale(sx, sy, sz);
        }
    }

    lastProxy = now;
    // resync proxy to widget center so the gumball origin tracks the part's
    // new volume center during continuous drag. we overwrite translate's
    // current proxy position with the widget's new center — TransformControls
    // tolerates this since it reads the live position on next pointer move.
    if (mode !== 'translate') {
        const c = volumeCenter(currentWidget);
        proxy.position.copy(c);
        lastProxy.pos.copy(c);
        proxy.updateMatrixWorld(true);
    }
}

function visible(bool) {
    for (const m of Object.keys(controls)) {
        const tc = controls[m];
        if (!tc) continue;
        tc.visible = bool;
        try {
            const h = typeof tc.getHelper === 'function' ? tc.getHelper() : tc;
            if (h) h.visible = bool;
        } catch (e) {}
    }
}

function attachToSelection() {
    ensureControls();
    if (!controls.translate) return;

    const widgets = api.widgets.all();
    const selected = api.selection && api.selection.widgets ? api.selection.widgets() : [];
    let w = selected[0] || null;
    if (!w && widgets.length === 1) w = widgets[0];

    const arrange = api.view && api.view.is_arrange && api.view.is_arrange();
    if (!arrange || !w) {
        currentWidget = null;
        visible(false);
        return;
    }

    currentWidget = w;
    syncProxyToWidget();
    visible(true);
    try { space.update && space.update(); } catch (e) {}
}

api.event.on('load-done', () => {
    ensureControls();
    attachToSelection();

    api.event.on('widget.select', attachToSelection);
    api.event.on('widget.deselect', attachToSelection);
    api.event.on('widget.add', attachToSelection);
    api.event.on('widget.delete', attachToSelection);
    api.event.on('view.set', attachToSelection);
    // resync on any selection transform so the gumball follows external changes too
    api.event.on('selection.move', () => { if (!dragging) syncProxyToWidget(); });
    api.event.on('selection.rotate', () => { if (!dragging) syncProxyToWidget(); });
    api.event.on('selection.scale', () => { if (!dragging) syncProxyToWidget(); });
});

// expose for probes / debugging
export const gumballApi = {
    get controls() { return controls; },
    get widget() { return currentWidget; },
    attach: attachToSelection,
    snapBottom: snapBottomToGrid
};
window.__swarfGumball = gumballApi;
