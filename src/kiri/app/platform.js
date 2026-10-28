/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { $, h } from '../../moto/webui.js';
import { ajax, js2o } from '../core/utils.js';
import { api } from './api.js';
import { MODES, VIEWS } from './consts.js';
import { colorSchemeRegistry } from './color/schemes.js';
import { load as file_load } from '../../load/file.js';
import { load_url as url_load } from '../../load/url.js';
import { newBounds } from '../../geo/bounds.js';
import { Packer } from './pack.js';
import { space } from '../../moto/space.js';
import { THREE } from '../../ext/three.js';
import { Widget, newWidget } from './widget.js';
import { profileSolid } from './swarf-profile.js';

const V0 = new THREE.Vector3(0,0,0);

/**
 * Get current color scheme
 */
function getColorScheme() {
    const mode = api.mode.get_id();
    const theme = api.space.is_dark() ? 'dark' : 'light';
    return colorSchemeRegistry.getScheme(mode, theme);
}

/** Bounds update callback */
let setbounds = undefined;

/** Flag indicating if grouping operation is in progress */
let grouping = false;

/** Maximum Z height of all widgets on platform */
let topZ = 0;

/**
 * Get current settings object.
 * @returns {object} Current configuration
 */
function current() {
    return api.conf.get();
}

/**
 * Get current mode ID constant.
 * @returns {number} Mode ID
 */
function get_mode() {
    return api.mode.get_id();
}

/**
 * Update platform origin position and rulers.
 * Calculates origin based on mode, device, and process settings:
 * - FDM: Corner or center based on device.originCenter/bedRound
 * - CAM: Relative to stock, with optional top origin
 * - 2D modes (LASER, DRAG, WJET, WEDM): Corner, center, or bounds-based
 * - Belt: Special Y offset handling
 * Applies mode-specific origin offsets and updates visual rulers.
 *
 * @param {boolean} [update_bounds=true] - Whether to recalculate bounds first
 */
function update_origin(update_bounds = true) {
    if (update_bounds) {
        platform.update_bounds();
    }

    const settings = current();
    const { device, process, controller, stock, bounds } = settings;
    const { FDM, CAM, SLA, LASER, DRAG, WJET, WEDM } = MODES;
    const TWOD = [ LASER, DRAG, WJET, WEDM ];
    const MODE = get_mode();

    let ruler = controller.showRulers;
    let stockCenter = stock.center || { x: 0, y: 0, z: 0 };
    let isIndexed = process.camStockIndexed;
    let isBelt = device.bedBelt;
    let origin = settings.origin = { x: 0, y: 0, z: 0 };
    let center = MODE === MODES.FDM ? device.originCenter || device.bedRound :
       MODE === MODES.SLA ? false :
       MODE === MODES.CAM ? process.camOriginCenter :
       device.originCenter || process.ctOriginCenter;

    if (MODE === MODES.CAM && process.camOriginTop) {
        origin.z = stock.z + 0.01;
    }

    if (!center) {
        if (MODE === MODES.CAM) {
            origin.x = (-stock.x / 2) + stockCenter.x;
            origin.y = (stock.y / 2) - stockCenter.y;
        } else {
            if (TWOD.contains(MODE) && process.ctOriginBounds) {
                let b = bounds;
                origin.x = b.min.x,
                origin.y = -b.min.y
            } else {
                origin.x = -device.bedWidth / 2;
                origin.y = device.bedDepth / 2;
            }
        }
    } else if (MODE === MODES.CAM) {
        origin.x = stockCenter.x;
        origin.y = -stockCenter.y;
    } else if (TWOD.contains(MODE) && process.ctOriginBounds ) {
        let b = bounds,
            mx = bounds.min.x,
            my = bounds.min.y,
            xd = b.max.x - mx,
            yd = b.max.y - my;
        origin.x += (mx + xd / 2);
        origin.y -= (my + yd / 2);
    } else if (isBelt) {
        origin.y = device.bedDepth / 2;
    }

    // CNC origin offsets
    if (MODE === MODES.CAM) {
        origin.x += process.camOriginOffX;
        origin.y -= process.camOriginOffY;
        origin.z += process.camOriginOffZ;
        if (isIndexed) {
            origin.y = 0;
        }
    }

    //  WireEDM origin offsets
    if (MODE === MODES.WEDM && process.ctOriginBounds) {
        origin.x -= process.ctOriginOffX;
        origin.y += process.ctOriginOffY;
    }
    space.platform.setRulers(ruler, ruler, 1 / api.view.unit_scale(), 'X', isBelt ? 'Z' : 'Y');

    let { x, y, z } = origin;
    let oz = process.camStockIndexed ? z / 2 : z;
    if (controller.showOrigin && MODE !== MODES.SLA) {
        space.platform.setOrigin(x, y, oz, true);
    } else {
        space.platform.setOrigin(x, y, oz, false);
    }
}

/**
 * Update platform size and visual appearance.
 * Sets platform dimensions from device settings, updates grid/rulers,
 * and applies dark mode styling if enabled.
 *
 * @param {boolean} [updateDark=true] - Whether to update dark mode styling
 */
// the floor's own color, kept when a skin first recolors it, so the swarf look gets it back
let baseFloor;
// a new skin repaints the floor, its grid and its rulers
if (self.addEventListener) self.addEventListener('swarf.skin', () => { try { update_size(); } catch (e) { /* not ready */ } });

function update_size(updateDark = true) {
    const { process, device, controller } = current();
    const { showRulers, units } = controller;

    space.platform.setRound(device.bedRound);
    space.platform.setSize(
       parseInt(device.bedWidth || 300),
       parseInt(device.bedDepth || 300),
       parseFloat(device.bedHeight || 5),
       parseFloat(device.maxHeight || 100)
    );

    const ruler = showRulers,
        unitMM = units === 'mm',
        gridMajor = unitMM ? 25 : 25.4,
        gridMinor = unitMM ? 5 : 25.4 / 10;

    if (updateDark) {
       const scheme = getColorScheme();
       // swarf viewport (per markup Apr 15): dark gray background, translucent red (X)
       // and amber (Y) grid lines, bed sized to the machine. Quieter than LastFirst.
       //   sky #14120f  (dark warm gray)
       //   major grid  X = 0x5a1a14  (translucent red)   Y = 0x5a3a14  (translucent amber)
       //   minor grid  X = 0x2a1a14                      Y = 0x2a2012
       // setGrid(major, minor, colorMajor, colorMinor) takes a single color per level,
       // so we alternate by using major=red-ish, minor=amber-ish as the two visible layers.
       // swarf viewport v2 (refs pass Apr 15, 20%+): mill-red X rails, iron Y grid,
       // brighter so the bed reads as a Tron-terminal workfield — still the carving
       // instrument, not a poster. CSS adds soft corner bloom via #container gradients.
       // swarf grid v3 (markup Apr 15, refs pass): lighter translucent gray floor,
       // soft gray grid (was red mill-rails, too hot); rulers thinned via faint bone
       // color so they read as helvetica-neue-thin in spirit (real font swap requires
       // a new bitmap atlas — deferred).
       // swarf skins (10-28): the floor's colors come from the skin (swarf-skin.js),
       // the red-sky look's own when no skin is set
       const SK = self.SwarfSkin, hex = n => '#' + n.toString(16).padStart(6, '0');
       const skc = (k, d) => SK ? SK.color(k, d) : d, skn = (k, d) => SK ? SK.number(k, d) : d;
       space.platform.set({ light: skn('floor-light', 0.06) });
       space.platform.setFont({ rulerColor: hex(skc('ruler', 0x7a7670)) }); // faint bone, thin-weight feel
       space.platform.setGrid(gridMajor, gridMinor, skc('grid-major', 0x6a6660), skc('grid-minor', 0x3a3833));
       {
           const f = skc('floor', null);
           if (f !== null) { const was = space.platform.setColor(f); if (baseFloor === undefined) baseFloor = was; }
           else if (baseFloor !== undefined) space.platform.setColor(baseFloor);
       }
       space.platform.opacity(skn('floor-opacity', 0.10));
       // swarf: null sky color = transparent scene background, so the body's
       // red-sky CSS gradient shows through canvas alpha (markup Apr 15 round 4).
       space.sky.set({ color: null, ambient: { intensity: 0.6 } });
       document.documentElement.setAttribute('data-theme', 'dark');
       space.platform.setSize();
    }

    space.platform.setRulers(ruler, ruler, 1 / api.view.unit_scale(), 'X', device.bedBelt ? 'Z' : 'Y');
    platform.update_origin();
}

/**
 * Update topZ to track maximum Z height of all widgets.
 * Used for belt mode and other Z-dependent calculations.
 */
function platformUpdateMidZ() {
    topZ = 0;
    api.widgets.each(widget => {
        topZ = Math.max(topZ, widget.mesh.getBoundingBox().max.z);
    });
    space.platform.setMaxZ(topZ);
}

/**
 * Update widget Z positioning based on CAM anchoring settings.
 * In CAM mode, anchors widgets to top/middle/bottom of stock with offset.
 * In other modes, resets topZ to 0.
 */
function update_top_z() {
    const { process, stock } = current();
    const MODE = get_mode();
    api.widgets.each(widget => {
        if (MODE === MODES.CAM) {
            const bounds = widget.getBoundingBox();
            const wzmax = bounds.max.z;
            const zdelta = process.camZOffset || 0;
            switch (process.camZAnchor) {
                case 'top':
                    widget.setTopZ(stock.z - zdelta, true);
                    break;
                case 'middle':
                    if (widget.isIndexed) {
                        widget.setTopZ(zdelta, true);
                    } else {
                        widget.setTopZ(stock.z - (stock.z - wzmax) / 2 + zdelta, true);
                    }
                    break;
                case 'bottom':
                    widget.setTopZ(wzmax + zdelta, true);
                    break;
            }
        } else {
            widget.setTopZ(0);
        }
    });
}

/**
 * Calculate and update stock dimensions for CAM mode.
 * Stock dimensions can be absolute or relative (offset from bounds).
 * Falls back to offset mode if any stock dimension is 0.
 * Calculates stock center point for origin calculations.
 * In non-CAM modes, clears stock object.
 */
function platformUpdateStock() {
    const settings = current();
    const { bounds, process, mode } = settings;
    const { camStockX, camStockY, camStockZ, camStockOffset, camStockIndexed } = process;
    if (mode === 'CAM') {
        let stock = settings.stock = {
            x: camStockX,
            y: camStockY,
            z: camStockZ
        };
        // drop back to offset mode if any stock dimension is 0
        if (camStockOffset || (stock.x * stock.y * stock.z === 0)) {
            stock.x += bounds.max.x - bounds.min.x;
            stock.y += bounds.max.y - bounds.min.y;
            stock.z += bounds.max.z - bounds.min.z;
        }
        stock.center = {
            x: (bounds.max.x + bounds.min.x) / 2,
            y: (bounds.max.y + bounds.min.y) / 2,
            z: camStockIndexed ? 0 : stock.z / 2
        };
    } else {
       settings.stock = {};
    }
}

/**
 * Set explicit platform bounds and trigger update.
 * @param {THREE.Box3} bounds - Bounding box to set
 * @returns {THREE.Box3} Updated bounds
 */
function set_bounds(bounds) {
    setbounds = bounds;
    return update_bounds();
}

/**
 * Calculate platform bounds from all widgets or use explicit bounds.
 * Unions all widget bounding boxes translated by their positions.
 * Updates stock, top Z, midZ, and origin after calculation.
 * @returns {THREE.Box3} Calculated or explicit bounds
 */
function update_bounds() {
    const bounds = setbounds || new THREE.Box3();
    if (!setbounds)
    api.widgets.each(widget => {
        let wp = widget.track.pos;
        let wb = widget.getBoundingBox().clone();
        wb.min.x += wp.x;
        wb.max.x += wp.x;
        wb.min.y += wp.y;
        wb.max.y += wp.y;
        bounds.union(wb);
    });
    if (bounds.isEmpty()) {
        bounds.set(V0, V0);
    }
    current().bounds = bounds;
    platformUpdateStock();
    update_top_z();
    platformUpdateMidZ();
    update_origin(false);
    return bounds;
}

/**
 * Get count of selected widgets in arrange view.
 * @returns {number} Selection count (0 if not in arrange view)
 */
function selected_count() {
    return api.view.is_arrange() ? api.selection.count() : 0;
}

/**
 * Update visual appearance of selected widgets.
 * Sets selected color and highlights extruder buttons for FDM multi-extruder devices.
 * Saves widget state after selection.
 */
function update_selected() {
    const settings = current();

    const { device } = settings;
    const { extruders } = device;
    const { selection, ui } = api;

    if (extruders) {
        for (let i = 0; i < extruders.length; i++) {
            let b = $(`sel-ext-${i}`);
            if (b) b.classList.remove('pop-sel');
        }
        const scheme = getColorScheme();
        selection.for_widgets(w => {
            w.setColor(scheme.widget.selected);
            let ext = api.widgets.annotate(w.id).extruder || 0;
            let b = $(`sel-ext-${ext}`);
            if (b) b.classList.add('pop-sel');
            w.saveState();
        }, true);
    } else {
        const scheme = getColorScheme();
        selection.for_widgets(w => {
            w.setColor(scheme.widget.selected);
        }, true);
    }
}

/**
 * Select a widget on the platform.
 * Only works in arrange view. Handles group selection recursively.
 * With shift key, toggles selection. Without shift, replaces selection.
 * Emits 'widget.select' event and updates UI.
 * @param {Widget} widget - Widget to select
 * @param {boolean} shift - Whether shift key is pressed (multi-select)
 * @param {boolean} [recurse=true] - Whether to recursively select group members
 */
function select(widget, shift, recurse = true) {
    const { event, selection, view } = api;

    // swarf: a click on a part while looking at its toolpaths goes back to
    // arranging, with that part picked (Phil 10-27: "after I make something,
    // how do I select, delete etc?"). Not while a simulation plays.
    if (!view.is_arrange() && widget && view.get && view.get() === VIEWS.PREVIEW) {
        view.set_arrange();
    }
    if (!view.is_arrange()) {
        return;
    }

    // apply select to entire group
    if (recurse && widget && widget.group.length > 1) {
        for (let w of widget.group) {
            select(w, true, false);
        }
        return;
    }

    if (selection.contains(widget)) {
        if (shift) {
            platform.deselect(widget, recurse)
        } else if (selection.count() > 1) {
            platform.deselect(undefined, recurse);
            platform.select(widget, false, recurse);
        }
    } else {
        // prevent selection in slice view
        if (!widget.isVisible()) {
            return;
        }
        if (!shift) {
            platform.deselect(undefined, recurse);
        }
        selection.add(widget);
        event.emit('widget.select', widget);
        const scheme = getColorScheme();
        widget.setColor(scheme.widget.selected);
        $(`ws-${widget.id}`)?.classList.add('selected');
        selection.update_info();
    }

    platform.update_selected();
    space.update();
}

/**
 * Deselect widget(s) on the platform.
 * Only works in arrange view. Handles group deselection recursively.
 * If no widget provided, deselects all widgets.
 * Emits 'widget.deselect' event and updates UI.
 * @param {Widget} [widget] - Widget to deselect, or undefined to deselect all
 * @param {boolean} [recurse=true] - Whether to recursively deselect group members
 */
function deselect(widget, recurse = true) {
    const { selection, view } = api;

    if (!view.is_arrange()) {
        // don't de-select and re-color widgets in,
        // for example, sliced or preview modes
        return;
    }

    // apply deselect to entire group
    if (recurse && widget && widget.group.length > 1) {
        for (let w of widget.group) {
            deselect(w, false);
        }
        return;
    }

    if (!widget) {
        api.widgets.each(function(widget) {
            platform.deselect(widget);
        });
        return;
    }

    if (selection.remove(widget)) {
        api.event.emit('widget.deselect', widget);
    }

    $(`ws-${widget.id}`)?.classList.remove('selected');
    const scheme = getColorScheme();
    widget.setColor(scheme.widget.deselected);
    platform.update_selected();
    selection.update_info();
    space.update();
}

/**
 * Load mesh from URL (.stl or raw vertex data).
 * Detects file type and delegates to load_stl or ajax loader.
 * @param {string} url - URL to load from
 * @param {Function} [onload] - Callback(vertices, widget) on load complete
 */
function load(url, onload) {
    if (url.toLowerCase().indexOf(".stl") > 0) {
        platform.load_stl(url, onload);
    } else {
        ajax(url, vertices => {
            vertices = js2o(vertices).toFloat32();
            let widget = newWidget().loadVertices(vertices);
            widget.meta.url = url;
            platform.add(widget);
            if (onload) onload(vertices, widget);
        });
    }
}

/**
 * Load STL file from URL and add to platform.
 * @param {string} url - URL to STL file
 * @param {Function} [onload] - Callback(vertices, widget) on load complete
 * @param {FormData} [formdata] - Optional form data for POST request
 * @param {boolean} [credentials] - Include credentials in request
 * @param {object} [headers] - Additional HTTP headers
 */
function load_stl(url, onload, formdata, credentials, headers) {
    new file_load.STL().load(url, (vertices, filename) => {
        if (vertices) {
            let widget = newWidget().loadVertices(vertices);
            widget.meta.file = filename;
            platform.add(widget);
            if (onload) {
                onload(vertices, widget);
            }
        }
    }, formdata, 1 / api.view.unit_scale(), credentials, headers);
}

/**
 * Load mesh(es) from URL via file loader.
 * Supports multiple file formats. Groups loading to prevent intermediate layouts.
 * Emits 'load.url' event with loaded widgets.
 * @param {string} url - URL to load from
 * @param {object} [options={}] - Load options including optional group array
 */
function load_url(url, options = {}) {
    platform.group();
    url_load(url, options).then(objects => {
        let widgets = [];
        for (let object of objects) {
            let widget = newWidget(undefined, options.group).loadVertices(object.mesh);
            widget.meta.file = object.file;
            platform.add(widget);
            widgets.push(widget);
        }
        platform.group_done();
        api.event.emit("load.url", {
            url,
            options,
            widgets
        });
    }).catch(error => {
        api.show.alert(error);
    });
}

/**
 * Begin group loading mode.
 * Defers layout and group position updates until group_done() is called.
 */
function group() {
    grouping = true;
}

/**
 * Complete group loading and finalize widget positions.
 * Called after all widgets in a group are loaded.
 * Triggers layout if drop_layout feature is enabled.
 * @param {boolean} [skipLayout] - Whether to skip auto-layout
 */
function group_done(skipLayout) {
    grouping = false;
    Widget.Groups.loadDone();
    // swarf: parts from a drawing learn how far the group's centering moved them (load_svg_into)
    for (const w of api.widgets.all()) {
        if (!w.meta || !w.meta.tFix) continue;
        const d = (w.group && w.group[0] && w.group[0].track.center) || { dx: w.meta.c0[0], dy: w.meta.c0[1] };
        w.meta.t = [w.meta.c0[0] - d.dx, w.meta.c0[1] - d.dy];
        delete w.meta.tFix;
    }
    if (api.feature.drop_layout && !skipLayout) {
        platform.layout();
    }
}

/** Deferred widget additions pending batch processing */
let deferred = [];

/** Timeout handle for deferred widget batch processing */
let deferTimeout;

/**
 * Add widget to platform and 3D scene.
 * Can defer addition for batch processing to improve performance.
 * Initializes widget annotation (extruder assignment).
 * Updates bounds, triggers save, and positions widget if autoLayout is disabled.
 * Emits 'widget.add' event.
 * @param {Widget} widget - Widget to add
 * @param {boolean} shift - Whether to multi-select (shift key pressed)
 * @param {boolean} nolayout - Skip layout/positioning
 * @param {boolean} defer - Batch multiple adds for better performance
 */
function add(widget, shift, nolayout, defer) {
    api.widgets.add(widget);
    space.world.add(widget.mesh);
    widget.anno = widget.anno || {};
    widget.anno.extruder = widget.anno.extruder || 0;
    if (defer) {
        deferred.push({widget, shift, nolayout});
        clearTimeout(deferTimeout);
        deferTimeout = setTimeout(platformAddDeferred, 150);
    } else {
        platform.select(widget, shift);
        platform.update_bounds();
        api.space.auto_save();
        changed();
        api.event.emit('widget.add', widget);
        // Apply saved visual state AFTER selection/color to avoid being overwritten
        api.visuals.apply_visual_state(widget);
        if (nolayout) {
            return;
        }
        if (!grouping) {
            group_done(nolayout);
            if (!current().controller.autoLayout) {
                positionNewWidget(widget);
            }
        }
    }
}

/**
 * Process batch of deferred widget additions.
 * Called after 150ms timeout to batch multiple rapid additions.
 * Positions widgets if autoLayout is disabled, then completes grouping.
 * @private
 */
function platformAddDeferred() {
    let skiplayout = false;
    for (let rec of deferred) {
        let { widget, shift, nolayout } = rec;
        skiplayout |= nolayout;
        // platform.select(widget, shift);
        if (!nolayout && !current().controller.autoLayout) {
            positionNewWidget(widget);
        }
    }
    if (!grouping) {
        group_done(skiplayout);
    }
    api.event.emit('widget.add', deferred.map(r => r.widget));
    // Apply visual state to all deferred widgets after they're positioned
    for (let rec of deferred) {
        api.visuals.apply_visual_state(rec.widget);
    }
    platform.update_bounds();
    api.space.auto_save();
    changed();
    deferred = [];
}

/**
 * Find non-colliding position for newly added widget.
 * Uses spiral search pattern radiating from center (0,0).
 * Tests 360 positions at each radius (10, 20, 30...200mm).
 * Skips if this is the first widget on platform.
 * @param {Widget} widget - Widget to position
 * @private
 */
function positionNewWidget(widget) {
    if (api.widgets.count() <= 1) {
        return;
    }
    const settings = current();
    const { device } = settings;
    const { bedWidth, bedDepth } = device;
    const wbb = widget.getBoundingBox();
    const dim = {
        x: wbb.max.x - wbb.min.x,
        y: wbb.max.y - wbb.min.y
    };
    const hdim = {
        x: dim.x / 2,
        y: dim.y / 2
    };
    const bounds = newBounds();
    const target = newBounds();
    const DEG2RAD = Math.PI / 180;
    const WIDGETS = api.widgets.all();
    // look for best position for new widget that doesn't collide
    outer: for (let rad = 10; rad < 200; rad += 10) {
        inner: for (let d = 0; d < 360; d += 1) {
            let dx = Math.cos(d * DEG2RAD) * rad;
            let dy = Math.sin(d * DEG2RAD) * rad;
            bounds.set(dx - hdim.x, dx + hdim.x, dy - hdim.y, dy + hdim.y);
            for (let w = 0, wl = WIDGETS.length; w < wl; w++) {
                let wt = WIDGETS[w];
                if (wt === widget) {
                    continue;
                }
                let tpo = wt.track.pos;
                let tbb = wt.getBoundingBox();
                let dim = {
                    x: (tbb.max.x - tbb.min.x) / 2,
                    y: (tbb.max.y - tbb.min.y) / 2
                };
                target.set(tpo.x - dim.x, tpo.x + dim.x, tpo.y - dim.y, tpo.y + dim.y);
                if (target.overlaps(bounds, 5)) {
                    continue inner;
                }
            }
            widget._move(dx, dy, widget.track.pos.z, true);
            break outer;
        }
    }
}

/**
 * Delete widget(s) from platform.
 * Handles single widget, array of widgets, or widget records.
 * Removes from API widget collection, selection, groups, and 3D scene.
 * Can defer post-processing for batch deletions.
 * Emits 'widget.delete' event.
 * @param {Widget|Array<Widget>} widget - Widget(s) to delete
 * @param {boolean} [defer] - Skip post-processing (for batch operations)
 */
function platformDelete(widget, defer) {
    if (!widget) {
        return;
    }
    if (Array.isArray(widget)) {
        const mc = widget.slice();
        for (let i = 0; i < mc.length; i++) {
            platform.delete(mc[i].widget || mc[i], true);
        }
        delete_post();
        api.event.emit('widget.delete', widget);
        return;
    }
    api.client.clear(widget);
    api.widgets.remove(widget);
    api.selection.remove(widget);
    Widget.Groups.remove(widget);
    space.world.remove(widget.mesh);
    if (!defer) {
        delete_post();
        api.event.emit('widget.delete', widget);
    }
}

/**
 * Post-deletion cleanup and updates.
 * Updates slider, bounds, layout, selection, triggers save.
 * @private
 */
function delete_post() {
    api.view.update_slider_max();
    platform.update_bounds();
    if (get_mode() !== MODES.FDM) {
        platform.layout();
    }
    space.update();
    platform.update_selected();
    if (api.feature.drop_layout) {
        platform.layout();
    }
    api.space.auto_save();
    changed();
}

/**
 * Render widget list UI with action buttons.
 * Creates interactive widget cards with save/rename/replace/disable/delete buttons.
 * Highlights widgets on hover. Updates when widgets are added/removed/modified.
 */
function changed() {
    // swarf r45 (review 10-28b #9, #10): one row per group (a word is one row, "swarf (5 pieces)"),
    // and the whole name, cut at its end by CSS if it must be, never in the middle
    const lead = w => !w.group || w.group.length < 2 || w.group[0] === w;
    h.bind($('ws-widgets'), api.widgets.all().filter(lead).map(w => {
        let color;
        const many = w.group && w.group.length > 1;
        let file = w.meta.file || 'no name';
        if (many) file = `${file.replace(/-\d+$/, '')} (${w.group.length} pieces)`;
        let fsho = file;
        return [
            h.div({
                onmouseenter() {
                    color = w.getColor();
                    w.setColor(0x0088ff, null, false);
                },
                onmouseleave() {
                    w.setColor(color, null, false);
                },
            },[
                h.div({ class: "widpop" }, [
                    h.div({ class: "widopt" }, [
                        h.button(
                            {
                                title: "save",
                                onclick() { w.saveToCatalog(null,true) }
                            },
                            [ h.i({ class:"fas fa-save" }) ]
                        ),
                        h.button(
                            {
                                title: "rename",
                                onclick() { api.widgets.rename(w) }
                            },
                            [ h.i({ class:"fas fa-pen-to-square" }) ]
                        ),
                        h.button(
                            {
                                title: "replace",
                                onclick() { api.widgets.replace(null,w) }
                            },
                            [ h.i({ class:"fas fa-rotate" }) ]
                        ),
                        h.button(
                            {
                                id: `w-en-${w.id}`,
                                title: "toggle disabled",
                                class: w.meta.disabled ? "disabled" : "",
                                onclick() {
                                    let dis = w.meta.disabled = !w.meta.disabled;
                                    let sel = api.selection.contains(w);
                                    const scheme = getColorScheme();
                                    api.uc.setClass($(`w-en-${w.id}`), "disabled", dis);
                                    w.setColor(sel ? scheme.widget.selected : scheme.widget.deselected, null, false);
                                }
                            },
                            [ h.i({ class:"fas fa-ban" }) ]
                        ),
                        h.button(
                            {
                                title: "delete",
                                onclick() { platformDelete(many ? w.group.slice() : w) }
                            },
                            [ h.i({ class:"fas fa-trash" }), ]
                        )
                    ])
                    // swarf: removed vestigial caret-left toggle (markup #2, Apr 15) —
                    // .widopt already appears on hover via CSS, the button did nothing.
                ]),
                h.button({
                    _: fsho,
                    id: `ws-${w.id}`,
                    class: "grow name",
                    title: file,
                    // onmouseenter() {
                    //     color = w.getColor();
                    //     w.setColor(0x0088ff, null, false);
                    // },
                    // onmouseleave() {
                    //     w.setColor(color, null, false);
                    // },
                    onclick() {
                        select(w, true, !many ? false : true);
                        color = w.getColor();
                    }
                })
            ])
        ]
    }));
}

/**
 * Select all widgets on platform.
 * Adds each widget to selection without recursing into groups.
 */
function select_all() {
    api.widgets.each(widget => {
        platform.select(widget, true, false)
    });
}

/**
 * Arrange widgets on platform using automatic layout.
 * Behavior varies by mode:
 * - FDM: 2D bin packing with support spacing. Belt mode uses linear Y layout with optional X randomization.
 * - SLA: 2D bin packing with support spacing
 * - CAM/LASER: 2D bin packing with configurable tile spacing
 *
 * Belt mode special handling:
 * - Positions widgets linearly along Y axis
 * - Adds belt lead spacing
 * - Optional X randomization for better adhesion
 * - Auto-expands bed depth if needed
 *
 * Standard mode:
 * - Uses 2D bin packing algorithm (Packer class)
 * - Grows packing area by 10% if widgets don't fit
 * - Centers packed layout on platform
 *
 * Emits 'platform.layout' event when complete.
 */
function layout() {
    const MODE = get_mode();
    const settings = current();
    const { process, device, controller } = settings;
    const { ui } = api;

    const auto = ui.autoLayout.checked,
        isBelt = device.bedBelt,
        isArrange = api.view.is_arrange(),
        layout = isArrange && auto;

    let gap = controller.spaceLayout;

    switch (MODE) {
        case MODES.SLA:
            gap = gap || (process.slaSupportLayers && process.slaSupportDensity ? 2 : 1);
            break;
        case MODES.CAM:
            // swarf (review 10-28): parts packed 1 mm apart read as one part, and no bit
            // fits between them: room for a 1/4 in bit and some
            gap = Math.max(gap || process.ctOutTileSpacing || 1, 12);
            break;
        case MODES.LASER:
            gap = gap || process.ctOutTileSpacing || 1;
            break;
        case MODES.FDM:
            gap = gap || ((process.sliceSupportExtra || 0) * 2) + 1;
            // auto resize device to support a larger object
            if (isBelt) {
                fit();
            }
            break;
    }

    api.view.set_arrange();
    api.view.hide_slices();
    api.space.auto_save();

    if (!isArrange) {
        // skip auto-layout when not in arrange mode
        api.event.emit('platform.layout');
        return space.update();
    }

    // do not layout when switching back from slice view
    if (!auto || (!space && !layout)) {
        api.event.emit('platform.layout');
        return space.update();
    }

    // TODO: in CNC mode with >1 widget, force layout min spacing @ largest tool diameter

    // space parts to account for anchor in belt mode
    if (isBelt) {
        gap += process.firstLayerBeltLead || 0;
        const WIDGETS = api.widgets.all();
        let bounds = update_bounds(),
            movey = -(device.bedDepth / 2);
        for (let widget of WIDGETS) {
            let ylen = widget.track.box.h;
            // only move the root widget in the group
            if (widget.id === widget.group.id) {
                widget.move(0, movey + ylen/2, 0, true);
                movey += ylen + gap;
            }
        }
        if (controller.spaceLayout === 0) {
            let sum = 0;
            let sorted = WIDGETS.sort((a, b) => a.track.pos.y - b.track.pos.y);
            sorted.forEach(w => {
                w.move(0, sum, 0);
                sum += w.track.box.d + 1 + gap;
            });
        }
        if (controller.spaceRandoX) {
            for (let w of WIDGETS) {
                w.move(
                    (0.5 - Math.random()) * (device.bedWidth - w.track.box.w - process.firstLayerBrim),
                    0, 0);
            }
        }
    } else {
        let i, m, sz = space.platform.size(),
            mp = [sz.x, sz.y],
            ms = [mp[0] / 2, mp[1] / 2],
            c = Widget.Groups.blocks().sort(),
            p = new Packer(ms[0], ms[1], gap).fit(c);

        while (!p.packed) {
            ms[0] *= 1.1;
            ms[1] *= 1.1;
            p = new Packer(ms[0], ms[1], gap).fit(c);
        }

        for (i = 0; i < c.length; i++) {
            m = c[i];
            m.fit.x += m.w / 2;
            m.fit.y += m.h / 2;
            m.move(p.max.w / 2 - m.fit.x, p.max.h / 2 - m.fit.y, 0, true);
        }
    }

    platform.update_origin();
    space.update();
    api.event.emit('platform.layout');
}

/**
 * Create widget from vertex data and add to platform.
 * Optionally saves to catalog and adds to group.
 * @param {Array} [group] - Optional group array for grouping multiple widgets
 * @param {Float32Array|Array} vertices - Vertex data (converted to Float32Array if needed)
 * @param {string} [filename] - Optional filename for metadata and catalog
 * @returns {Widget} Created widget
 */
function load_verts(group, vertices, filename) {
    const widget = newWidget(undefined, group).loadVertices(vertices.toFloat32(), true);
    widget.meta.file = filename;
    if (filename) widget.saveToCatalog(filename);
    add(widget);
    return widget;
}

/**
 * swarf: make parts from SVG text (the shape tool, and 2D files converted to SVG).
 * opt as the SVG import dialog's: { depth, resolution, segmin, soup, dpi }.
 * Returns the widgets made.
 */
function load_svg(text, name, opt = {}) {
    platform.group();
    const made = load_svg_into([], text, name, opt);
    flagDoubled(made, text);
    // opt.place: the drawing is in bed millimeters (DRAW), so each part goes where it was drawn
    if (opt.place) for (const w of made) w.move(w.meta.c0[0], w.meta.c0[1], w.track.pos.z, true);
    platform.group_done(!!opt.place);
    return made;
}

// swarf (KCAD's guidelines, via the poster session 10-28): a drawing with an outline drawn twice,
// or two outlines lying on top of each other, cuts the same place twice or leaves a sliver. Say
// so when the parts arrive: same size at the same place is a doubled line, a big overlap is two
// outlines on top of each other.
function flagDoubled(made, text) {
    if (!api.show || !api.show.alert) return;
    // the same shape written twice: under even-odd filling the copies cancel, so look at the
    // drawing's own elements, not the parts (two equal rectangles make no part at all)
    try {
        const doc = new DOMParser().parseFromString(text, 'image/svg+xml'), seen = new Map();
        let twice = 0;
        for (const e of doc.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line')) {
            const key = e.tagName + '|' + ['d', 'points', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'transform'].map(a => (e.getAttribute(a) || '').replace(/\s+/g, ' ').trim()).join('|');
            if (seen.has(key)) twice++; else seen.set(key, 1);
        }
        if (twice) { api.show.alert(`${twice} shape${twice > 1 ? 's are' : ' is'} drawn twice in this drawing, on top of ${twice > 1 ? 'themselves' : 'itself'}: the copies cancel or cut twice. Delete the extra in your drawing and open it again.`, 12); return; }
    } catch (e) { /* not parseable here: the parts' own check below */ }
    if (!made || made.length < 2) return;
    const box = w => { const g = w.mesh.geometry; g.computeBoundingBox(); const b = g.boundingBox, c = w.meta && w.meta.c0 || [0, 0]; return { x0: c[0] + b.min.x, x1: c[0] + b.max.x, y0: c[1] + b.min.y, y1: c[1] + b.max.y }; };
    const B = made.map(box);
    let doubled = 0, over = 0;
    for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
        const a = B[i], b = B[j];
        const same = Math.abs(a.x0 - b.x0) < 0.05 && Math.abs(a.x1 - b.x1) < 0.05 && Math.abs(a.y0 - b.y0) < 0.05 && Math.abs(a.y1 - b.y1) < 0.05;
        if (same) { doubled++; continue; }
        const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        const small = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
        if (ix > 0 && iy > 0 && small > 0 && ix * iy > small * 0.5) over++;
    }
    if (doubled) api.show.alert(`${doubled} outline${doubled > 1 ? 's are' : ' is'} drawn twice in this drawing: swarf would cut ${doubled > 1 ? 'them' : 'it'} twice. Delete the extra in your drawing, or here (select it, delete).`, 12);
    else if (over) api.show.alert(`${over} pair${over > 1 ? 's' : ''} of outlines lie on top of each other: check the drawing; overlapping parts cut into each other.`, 12);
}

// parts from SVG text into a load group. Each part keeps its own drawing
// (meta.svg), the drawing's center for that part (meta.c0, where cam centered
// it) and a 2D transform (meta.xf, kept by swarf-draw.js as the part is scaled,
// turned and mirrored, with meta.t the shift cam's re-centering adds), so DRAW
// and "save drawing" put it where the part is.
function load_svg_into(group, text, name, opt = {}) {
    const made = [], boxes = [];
    let ind = 0;
    const solids = svg_solids(text, opt);
    if (solids.error) { made.error = solids.error; return made; }
    for (const v of solids) {
        faceOut(v);
        const b = [Infinity, Infinity, -Infinity, -Infinity];
        for (let i = 0; i < v.length; i += 3) {
            b[0] = Math.min(b[0], v[i]); b[1] = Math.min(b[1], v[i + 1]);
            b[2] = Math.max(b[2], v[i]); b[3] = Math.max(b[3], v[i + 1]);
        }
        const w = load_verts(group, v, ind++ ? `${name}-${ind}` : name);
        w.meta.svg = text;
        w.meta.c0 = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
        w.meta.xf = [1, 0, 0, 1];
        if (opt.edge && opt.edge.kind !== 'straight') w.meta.edge = { kind: opt.edge.kind, size: +opt.edge.size };
        w.meta.t = [0, 0];
        made.push(w);
        boxes.push(b);
    }
    // cam centers the load group as one in group_done (Widget.Groups.loadDone):
    // a part's offset from its own drawing center is what that moves it
    for (const w of made) w.meta.tFix = true;
    // two parts from one drawing: each keeps only its own shapes
    const V = window.SwarfVector;
    if (made.length > 1 && V && V.split) {
        const own = V.split(text, boxes);
        made.forEach((w, i) => { if (own[i]) w.meta.svg = own[i]; });
    }
    return made;
}

// a solid's faces turned outward: an outline drawn clockwise extrudes inside
// out (negative volume), which renders dark from above (Phil 10-27: "too dark")
function faceOut(v) {
    let vol = 0;
    for (let i = 0; i + 8 < v.length; i += 9) {
        const ax = v[i], ay = v[i + 1], az = v[i + 2], bx = v[i + 3], by = v[i + 4], bz = v[i + 5], cx = v[i + 6], cy = v[i + 7], cz = v[i + 8];
        vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    if (vol >= 0) return v;
    for (let i = 0; i + 8 < v.length; i += 9) {
        for (let k = 3; k < 6; k++) { const t = v[i + k]; v[i + k] = v[i + k + 3]; v[i + k + 3] = t; }
    }
    return v;
}

// the solids an SVG makes at opt.depth: straight walls, or with a shaped top
// edge (opt.edge = { kind: 'chamfer' | 'round', size }, swarf-profile.js).
// Returns vertex arrays, or { error } when the edge cannot fit the shape.
function svg_solids(text, opt = {}) {
    const edge = opt.edge;
    if (!edge || edge.kind === 'straight' || !(+edge.size > 0)) return file_load.SVG.parse(text, opt);
    const depth = parseFloat(opt.depth) || 5;
    const out = [];
    for (const poly of file_load.SVG.parse(text, { ...opt, flat: true })) {
        const r = profileSolid(poly, depth, edge);
        if (r.error) return { error: r.error };
        out.push(r.vertices);
    }
    return out;
}

// why this edge cannot be made on this drawing, or null (for the shape and draw dialogs)
function edge_problem(text, opt = {}) {
    try {
        const r = svg_solids(text, opt);
        return r.error || (r.length ? null : 'Nothing closed to give a thickness to.');
    } catch (e) {
        return `swarf could not shape that edge (${e.message}).`;
    }
}

/**
 * Load multiple files from File objects.
 * Supports: STL, OBJ, 3MF, SVG, PNG, JPG, KMZ, Gerber (.gbr), gcode, raw vertex data.
 * Also handles settings import (.b64, .km, .ini files).
 * Groups loading to prevent intermediate layouts.
 * Prompts user for grouping when multiple objects detected.
 * @param {Array<File>} files - Array of File objects from file input or drag/drop
 * @param {Array} [group] - Optional group array for grouping loaded widgets
 */
function load_files(files, group) {
    platform.group();
    let loading = files.length;
    for (let file of files) {
        const name = file.name,
            reader = new FileReader(),
            lower = name.toLowerCase(),
            isstl = lower.endsWith(".stl"),
            isobj = lower.endsWith(".obj"),
            is3mf = lower.endsWith(".3mf"),
            issvg = lower.endsWith(".svg"),
            isdxf = lower.endsWith(".dxf"),
            isai = lower.endsWith(".ai") || lower.endsWith(".pdf"),
            ispng = lower.endsWith(".png"),
            isjpg = lower.endsWith(".jpg"),
            iskmz = lower.endsWith(".kmz"),
            isini = lower.endsWith(".ini"),
            isgbr = lower.endsWith(".gbr"),
            israw = lower.endsWith(".raw") || lower.indexOf('.') < 0,
            isset = lower.endsWith(".b64") || lower.endsWith(".km"),
            isgcode = lower.endsWith(".gcode") || lower.endsWith(".nc");
        reader.file = file;
        reader.onloadend = function(e) {
            const data = e.target.result;
            function load_dec() {
                if (--loading === 0) {
                    platform.group_done(isgcode);
                }
            }
            if (israw) {
                load_verts(group, JSON.parse(data));
                load_dec();
            } else if (api.feature.on_load && (isstl || isobj || is3mf)) {
                api.feature.on_load(data, file);
                load_dec();
            } else if (api.feature.on_add_stl && isstl) {
                api.feature.on_add_stl(data, file);
                load_dec();
            } else if (isstl) {
                const stl = new file_load.STL().parse(data, api.view.unit_scale());
                load_verts(group, stl, name);
                load_dec();
            } else if (isobj) {
                const objs = file_load.OBJ.parse(data.textDecode('utf-8'));
                const ondn = function() {
                    for (let obj of objs) {
                        load_verts(group, obj, obj.name ? `${obj.name}-${name}` : name);
                    }
                    load_dec();
                };
                if (objs.length > 1 && !group) {
                    api.uc.confirm('group objects?').then(ok => {
                        group = ok ? [] : group;
                        ondn();
                    });
                } else {
                    ondn();
                }
            } else if (isgbr) {
                let text = data.textDecode('utf-8');
                if (api.conf.get().controller.devel) {
                    api.event.emit('cam.parse.gerber', { data: text });
                } else {
                    api.client.gerber2mesh(text, progress => {
                        api.show.progress(progress, "converting");
                    }, vertices => {
                        api.show.progress(0);
                        let wid = load_verts(group, vertices, name);
                        if (api.mode.is_cam()) {
                            // attach raw illustration
                            // api.event.emit('cam.parse.gerber', { data: text, mesh: wid.mesh });
                        }
                    });
            }
            } else if (is3mf) {
                let odon = function(models) {
                    let msg = api.show.alert('Adding Objects');
                    for (let model of models) {
                        load_verts(group, model.faces, model.name ? `${model.name}-${name}` : name);
                    }
                    load_dec();
                    api.hide.alert(msg);
                }
                let msg = api.show.alert('Decoding 3MF');
                file_load.TMF.parseAsync(data).then(models => {
                    api.hide.alert(msg);
                    if (models.length > 1 && !group) {
                        api.uc.confirm(`group ${models.length} objects?`).then(ok => {
                            if (ok) {
                                group = [];
                            }
                            odon(models);
                        });
                    } else {
                        odon(models);
                    }
                });
            } else if (isgcode) {
                api.function.parse(data.textDecode('utf-8'), 'gcode');
                load_dec();
            } else if (issvg) {
                loadSVGDialog(opt => {
                    group = group || [];
                    let svg = file_load.SVG.parse(data.textDecode('utf-8'), opt);
                    let ind = 0;
                    if (svg.length === 0) {
                        api.show.alert(`SVG contains no polylines`, 10);
                        api.show.alert(`Fonts must be converted to paths`, 10);
                    }
                    for (let v of svg) {
                        load_verts(group, svg[ind++], ind ? `${name}-${ind}` : name);
                    }
                    load_dec();
                });
            } else if (isai) {
                // swarf r36: Illustrator / PDF drawings through Unreason's reader (web/kiri/swarf-vector.mjs),
                // as SVG in mm into the same thickness dialog as an SVG
                const V = window.SwarfVector;
                if (!V) { api.show.alert('the drawing reader is still loading: try again', 6); load_dec(); return; }
                V.toSVG(name, new Uint8Array(data)).then(r => {
                    if (!r.svg) {
                        api.show.alert(r.open ? `${r.open} open line${r.open > 1 ? 's' : ''} and no closed shape: only closed shapes can be given a thickness` : 'no shapes found in that drawing', 10);
                        load_dec();
                        return;
                    }
                    if (r.open) api.show.alert(`${r.open} open line${r.open > 1 ? 's were' : ' was'} left out: only closed shapes can be given a thickness`, 10);
                    loadSVGDialog(opt => {
                        group = group || [];
                        load_svg_into(group, r.svg, name.replace(/\.(ai|pdf)$/i, ''), opt);
                        load_dec();
                    });
                }).catch(e => { api.show.alert(`could not read that drawing: ${e.message}`, 10); load_dec(); });
            } else if (isdxf) {
                loadDXFDialog(opt => {
                    group = group || [];
                    let dxf = file_load.DXF.parse(data.textDecode('utf-8'), opt);
                    let ind = 0;
                    if (dxf.length === 0) {
                        api.show.alert(`DXF contains no supported entities`, 10);
                    }
                    for (let v of dxf) {
                        load_verts(group, dxf[ind++], ind ? `${name}-${ind}` : name);
                    }
                    load_dec();
                });
            }
            else if (iskmz) api.settings.import_zip(data, true);
            else if (isset) api.settings.import(data.textDecode('utf-8'), true);
            else if (ispng) api.image.dialog(data, name);
            else if (isjpg) api.image.convert(data, name);
            else if (isini) api.settings.import_prusa(data.textDecode('utf-8'));
            else api.show.alert(`Unsupported file: ${reader.file.name}`);
        };
        reader.readAsArrayBuffer(reader.file);
    }
}

// swarf: the thickness SHAPE last used, so an import starts where a shape would
function lastThickness() {
    try {
        const t = JSON.parse(localStorage.getItem('swarf-shape-last')).t;
        if (t > 0) return t;
    } catch (e) { /* none yet */ }
    return 6;
}

/**
 * Show dialog to configure SVG import settings.
 * Prompts for extrusion depth, arc resolution, DPI, and nesting.
 * @param {Function} doit - Callback with options: {soup, resolution, segmin, depth, dpi}
 * @private
 */
function loadSVGDialog(doit) {
    // swarf: the dialog speaks SHAPE's words (review 10-28b #7), and starts at
    // the last thickness SHAPE used, so a drawing and a shape come out alike
    const t = lastThickness();
    const opt = {pre: [
        "<div class='f-col a-center swarf-import'>",
        "  <h3>make parts from a drawing</h3>",
        "  <p class='t-just' style='width:320px;line-height:1.5em'>",
        "  Each closed outline becomes a part, this thick.",
        "  Text must be turned into outlines first (in Illustrator: Type › Create Outlines).",
        "  </p>",
        "  <div class='f-row t-right'><table>",
        `  <tr><th>thickness</th><td><input id='svg-depth' value='${t}' size='4' inputmode='decimal'> mm</td></tr>`,
        "  <tr><th title='an outline inside another is cut out of it, as a hole'>holes stay holes</th><td><input id='svg-nest' value='1' type='checkbox' checked></td></tr>",
        "  </table></div>",
        "  <details style='width:320px'><summary>finer settings</summary><table>",
        "  <tr><th title='more points follow a curve more closely; 0.5 is accepted'>points per mm on a curve</th><td><input id='svg-arcs' value='1' size='3'></td></tr>",
        "  <tr><th title='so a small circle stays round'>fewest points on a curve</th><td><input id='svg-marc' value='10' size='3'></td></tr>",
        "  <tr><th title='only if the drawing is measured in pixels; 0 reads it in mm'>pixels per inch</th><td><input id='svg-dpi' value='0' size='3'></td></tr>",
        "  </table></details>",
        "</div>"
    ]};
    api.uc.confirm(undefined, {'make parts':true, cancel:false}, undefined, opt).then((ok) => {
        let depth = Math.max(0.1, parseFloat($('svg-depth').value));
        let arcs = Math.max(0.01, parseFloat($('svg-arcs').value));
        let marc = Math.max(1, parseInt($('svg-marc').value));
        let sdpi = Math.max(0, parseInt($('svg-dpi').value));
        let soup = $('svg-nest').checked;
        ok && doit({ soup, resolution: arcs, segmin: marc, depth, dpi: sdpi });
    });
}

/**
 * Show dialog to configure DXF import settings.
 * Prompts for extrusion depth, arc segment size, and nesting.
 * @param {Function} doit - Callback with options: {soup, depth, segmentSize, minSegments}
 * @private
 */
function loadDXFDialog(doit) {
    const rnd = Date.now().toString(36);
    const host = $('mod-any');
    host.innerHTML = [
        `<div class="image-convert-dialog f-col a-center swarf-import">`,
        `  <h3 class="image-convert-title">make parts from a drawing</h3>`,
        `  <p class="image-convert-copy t-just">`,
        `  Each closed outline becomes a part, this thick.`,
        `  </p>`,
        `  <div class="f-row t-right image-convert-fields"><table>`,
        `  <tr><th>thickness</th><td><input id="dxf-depth-${rnd}" value="${lastThickness()}" size="4" inputmode="decimal"> mm</td></tr>`,
        `  <tr><th title="most drawings say their units; pick one if the parts come out 25 times too big or too small">units</th><td><select id="dxf-units-${rnd}"><option value="auto" selected>as the file says</option><option value="mm">millimeters</option><option value="inch">inches</option></select></td></tr>`,
        `  <tr><th title="an outline inside another is cut out of it, as a hole">holes stay holes</th><td><input id="dxf-nest-${rnd}" type="checkbox" checked></td></tr>`,
        `  </table></div>`,
        `  <details class="image-convert-fields"><summary>finer settings</summary><table>`,
        `  <tr><th title="shorter pieces follow a curve more closely">length of each piece of a curve</th><td><input id="dxf-seg-${rnd}" value="1" size="3"> mm</td></tr>`,
        `  <tr><th title="so a small circle stays round">fewest pieces on a curve</th><td><input id="dxf-min-${rnd}" value="4" size="3"></td></tr>`,
        `  </table></details>`,
        `  <div class="f-row j-end image-convert-actions">`,
        `    <button id="dxf-convert-ok-${rnd}">make parts</button>`,
        `    <button id="dxf-convert-cancel-${rnd}">cancel</button>`,
        `  </div>`,
        `</div>`
    ].join('');

    const units = $(`dxf-units-${rnd}`);
    const depth = $(`dxf-depth-${rnd}`);
    const segmentSize = $(`dxf-seg-${rnd}`);
    const minSegments = $(`dxf-min-${rnd}`);
    const nest = $(`dxf-nest-${rnd}`);
    const okBtn = $(`dxf-convert-ok-${rnd}`);
    const cancelBtn = $(`dxf-convert-cancel-${rnd}`);

    okBtn.onclick = () => {
        api.modal.hide();
        setTimeout(() => {
            doit({
                soup: nest.checked,
                depth: Math.max(0.1, parseFloat(depth.value)),
                segmentSize: Math.max(0.01, parseFloat(segmentSize.value)),
                minSegments: Math.max(3, parseInt(minSegments.value)),
                units: units.value
            });
        }, 50);
    };
    cancelBtn.onclick = () => api.modal.hide();
    depth.onkeypress = (ev) => {
        if (ev.key === 'Enter' || ev.charCode === 13) okBtn.click();
    };
    api.modal.show('any');
    setTimeout(() => depth.focus(), 0);
}

/**
 * Expand platform bed depth to fit widgets (belt mode only).
 * Finds maximum Y dimension of all widgets and expands bed if needed.
 * Adds 10mm padding. Saves original bed depth.
 * @returns {boolean} True if bed was expanded
 */
function fit() {
    let maxy = 0;
    api.widgets.each(widget => {
        let wb = widget.mesh.getBoundingBox().clone();
        maxy = Math.max(maxy, wb.max.y - wb.min.y);
    });
    const { device } = current();
    if (maxy > device.bedDepth) {
        device.bedDepthSave = device.bedDepth;
        device.bedDepth = maxy + 10;
        space.platform.setSize(
            parseInt(device.bedWidth),
            parseInt(device.bedDepth),
            parseFloat(device.bedHeight),
            parseFloat(device.maxHeight)
        );
        space.platform.update();
        return true;
    }
}

// extend API (api.platform)
export const platform = {
    fit,
    add,
    changed,
    delete: platformDelete,
    layout: layout,
    group,
    group_done,
    load,
    load_stl,
    load_url,
    load_files,
    load_verts,
    load_svg,
    edge_problem,
    deselect,
    select,
    select_all,
    selected_count,
    set_bounds,
    update_origin,
    update_bounds,
    update_size,
    update_top_z,
    update_selected,
    update: space.platform.update,
    set_font: space.platform.setFont,
    show_axes: space.platform.showAxes,
    show_volume: space.platform.showVolume,
    top_z() { return topZ },
    clear() { api.space.clear(); api.space.save(true)  }
};
