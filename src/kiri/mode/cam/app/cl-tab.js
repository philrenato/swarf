/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { api } from '../../../app/api.js';
import { colorSchemeRegistry } from '../../../app/color/schemes.js';
import { env, isDark } from './init-ui.js';
import { addbox, delbox, clearboxes } from '../../../app/boxes.js';
import { traceDone } from './cl-trace.js';
import { space as SPACE } from '../../../../moto/space.js';
import { rotAngle } from './autotab-rule.js';

let showTab, lastTab, tab, iw, ic;

// swarf: what happens around a tab clicked away with tabs › + (cl-tabedit.js sets these):
// edit(widget, fn) runs fn as one undoable step; removed(widget, rec) notes a deleted auto tab
export const tabHooks = { edit: null, removed: null };

export function mirrorTabs(widget) {
    // swarf: a tab's rot is an array once saved (auto tabs always), and the box's turn is baked
    // into its geometry, so the record is turned (a -> PI - a) and its box drawn again
    let tabs = api.widgets.annotate(widget.id).tab || [];
    tabs.forEach(rec => {
        let { id, pos } = rec;
        let a = Math.PI - rotAngle(rec.rot);
        rec.rot = [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
        pos.x = -pos.x;
        let live = widget.tabs && widget.tabs[id];
        if (live && live.box) {
            widget.adds.remove(live.box);
            widget.mesh.remove(live.box);
            delete widget.tabs[id];
        }
        let copy = Object.clone(rec);
        copy.rot = new THREE.Quaternion(...rec.rot);
        addWidgetTab(widget, copy);
    });
    SPACE.update();
}

export function rotateTabs(widget, x, y, z) {
    let tabs = api.widgets.annotate(widget.id).tab || [];
    tabs.forEach(rec => {
        let { id, pos, rot } = rec;
        if (!Array.isArray(rot)) {
            rot = rot.toArray();
        }
        let coff = widget.track.center;
        let tab = widget.tabs[id];
        let m4 = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x || 0, y || 0, z || 0));
        // update position vector
        let vc = new THREE.Vector3(pos.x, pos.y, pos.z).applyMatrix4(m4);
        // update rotation quaternion
        let [rx, ry, rz, rw] = rot;
        rec.rot = new THREE.Quaternion().multiplyQuaternions(
            new THREE.Quaternion(rx, ry, rz, rw),
            new THREE.Quaternion().setFromRotationMatrix(m4)
        ).toArray();
        tab.box.geometry.applyMatrix4(m4);
        tab.box.position.x = pos.x = vc.x - coff.dx;
        tab.box.position.y = pos.y = vc.y - coff.dy;
        tab.box.position.z = pos.z = vc.z;
    });
    SPACE.update();
}

export function createTabBox(iw, ic, n) {
    const { track } = iw;
    const { stock, bounds, process } = api.conf.get();
    const { camTabsWidth, camTabsHeight, camTabsDepth, camTabsMidline } = process;
    const { camZBottom, camStockIndexed } = process;
    const sz = stock.z || bounds.max.z;
    const zto = sz - iw.track.top;
    const zp = (camZBottom || camStockIndexed ? camZBottom : sz - track.box.d - zto) + (camTabsMidline ? 0 : camTabsHeight / 2);
    ic.x += n.x * camTabsDepth / 2; // offset from part
    ic.z -= n.y * camTabsDepth / 2; // offset swap z,y
    ic.y = zp; // offset swap in world space y,z
    const rot = new THREE.Quaternion().setFromAxisAngle(env.zaxis, Math.atan2(n.y, n.x));
    const pos = { x: ic.x, y: ic.y, z: ic.z };
    const dim = { x: camTabsDepth, y: camTabsWidth, z: camTabsHeight };
    const tab = addbox(pos, boxColor(), 'tabb', dim, { rotate: rot, opacity: boxOpacity() });
    return { pos, dim, rot, tab, width: camTabsWidth, height: camTabsHeight, stock };
}

export function addWidgetTab(widget, rec) {
    const { pos, dim, rot, id } = rec;
    const tabs = widget.tabs = (widget.tabs || {});
    // prevent duplicate restore from repeated settings load calls
    if (!tabs[id]) {
        pos.box = addbox(
            pos, boxColor(), id,
            dim, { group: widget.mesh, rotate: rot, opacity: boxOpacity() }
        );
        pos.box.tab = Object.assign({ widget, id }, pos);
        widget.adds.push(pos.box);
        tabs[id] = pos;
    }
}

export function recreateTabs() {
    let widgets = api.widgets.all();
    for (let w of widgets) clearTabs(w, true);
    restoreTabs(widgets);
}

export function restoreTabs(widgets) {
    widgets.forEach(widget => {
        const tabs = api.widgets.annotate(widget.id).tab || [];
        tabs.forEach(rec => {
            // handle record format change
            if (rec.rot.isQuaternion) {
                let {_x, _y, _z, _w} = rec.rot;
                rec = Object.clone(rec);
                rec.rot = new THREE.Quaternion(_x, _y, _z, _w);
            } else {
                let [x, y, z, w] = rec.rot;
                rec = Object.clone(rec);
                rec.rot = new THREE.Quaternion(x, y, z, w);
            }
            addWidgetTab(widget, rec);
        });
    });
}

export function clearTabs(widget, skiprec) {
    Object.values(widget.tabs || {}).forEach(rec => {
        widget.adds.remove(rec.box);
        widget.mesh.remove(rec.box);
    });
    widget.tabs = {};
    if (!skiprec) {
        delete api.widgets.annotate(widget.id).tab;
    }
    clearboxes();
}

export function updateTabs() {
    // update tab color and opacity
    api.widgets.all().forEach(widget => {
        Object.values(widget.tabs || {}).forEach(rec => {
            for (let rec of widget.adds || []) {
                rec.material.color = new THREE.Color(boxColor());
                rec.material.opacity = boxOpacity();
            }
        });
    });
}

export function tabHover(data) {
    delbox('tabb');
    const { int, type, point } = data;
    const object = int ? int.object : null;
    const tab = int ? object.tab : null;
    if (lastTab) {
        lastTab.box.material.color.r = 0;
        lastTab = null;
    }
    if (tab) {
        tab.box.material.color.r = 0.5;
        lastTab = tab;
        return;
    }
    if (type !== 'widget') {
        iw = null;
        return;
    }
    let n = int.face.normal;
    iw = int.object.widget;
    ic = int.point;
    // only near vertical faces
    // if (Math.abs(n.z) > 0.3) {
    //     return;
    // }
    showTab = createTabBox(iw, ic, n);
}

export function tabHoverUp(int) {
    delbox('tabb');
    const edit = (w, fn) => tabHooks.edit ? tabHooks.edit(w, fn) : fn();
    if (lastTab) {
        const { widget, box, id } = lastTab;
        lastTab = null;
        edit(widget, () => {
            widget.adds.remove(box);
            widget.mesh.remove(box);
            delete widget.tabs[id];
            let ta = api.widgets.annotate(widget.id).tab;
            let ix = ta.findIndex(rec => rec.id === id);
            if (ix < 0) return;
            let [gone] = ta.splice(ix, 1);
            // swarf: a deleted auto tab leaves a "no tab here" spot, so it does not come back
            if (tabHooks.removed) tabHooks.removed(widget, gone);
            api.conf.save();
            widget.saveState();
        });
        return;
    }
    if (!iw) return;
    const w0 = iw;
    edit(w0, () => tabAddAt(w0));
}

// the tab shown under the cursor, made real on its part
function tabAddAt(iw) {
    let ip = iw.track.pos;
    let wa = api.widgets.annotate(iw.id);
    let wt = (wa.tab = wa.tab || []);
    let pos = {
        x: showTab.pos.x - ip.x,
        y: -showTab.pos.z - ip.y,
        z: showTab.stock.z ?
            showTab.pos.y + ip.z + (env.isIndexed ? 0 : iw.track.tzoff) :
            showTab.dim.z / 2,
    }
    let id = Date.now();
    let { dim, rot } = showTab;
    let rec = { pos, dim, rot, id };
    wt.push(Object.clone(rec));
    addWidgetTab(iw, rec);
    api.conf.save();
    iw.saveState();
}

export function tabAdd() {
    traceDone();
    alert = api.show.alert("click the part's edge to add a tab, a tab to remove it; Esc or stop adding when done");
    // stop adding shows only while adding (review r093-ux T7: a "done" with nothing to finish)
    if (api.ui.tabDun) api.ui.tabDun.style.display = '';
    api.feature.hover = true;
    env.hover = tabHover;
    env.hoverUp = tabHoverUp;
}

export function tabDone() {
    if (api.ui.tabDun) api.ui.tabDun.style.display = 'none';
    delbox('tabb');
    clearboxes();
    api.hide.alert(alert);
    api.feature.hover = false;
    if (lastTab) {
        lastTab.box.material.color.r = 0;
        lastTab = null;
    }
}

export function tabClear() {
    tabDone();
    api.widgets.all().forEach(widget => {
        clearTabs(widget);
        widget.saveState();
    });
    api.conf.save();
}

export function boxColor() {
    const mode = 3; // CAM mode ID
    const theme = isDark() ? 'dark' : 'light';
    const scheme = colorSchemeRegistry.getScheme(mode, theme);
    return scheme.operations?.tabs?.color ?? (isDark() ? 0x00ddff : 0x0000dd);
}

export function boxOpacity() {
    const mode = 3; // CAM mode ID
    const theme = isDark() ? 'dark' : 'light';
    const scheme = colorSchemeRegistry.getScheme(mode, theme);
    return scheme.operations?.tabs?.opacity ?? (isDark() ? 0.75 : 0.6);
}
