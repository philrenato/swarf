/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { $ } from '../../../moto/webui.js';
import { api } from '../api.js';
import { beta, version } from '../../../moto/license.js';
import { fileOps } from '../file-ops.js';
import { local as sdb } from '../../../data/local.js';
import { preferences } from '../preferences.js';
import { settings as set_ctrl } from '../conf/manager.js';
import { settingsOps } from '../conf/settings.js';
import { conf } from '../conf/defaults.js';
import { space } from '../../../moto/space.js';
import { THREE } from '../../../ext/three.js';
import { VIEWS } from '../consts.js';
import * as view_tools from '../face-tool.js';

const { SETUP, LOCAL } = api.const;
const { catalog, client, platform, selection, stats, ui } = api;

const DOC = self.document;
const WIN = self.window;
const LANG = api.language.current;
const STARTMODE = SETUP.sm && SETUP.sm.length === 1 ? SETUP.sm[0] : null;

// SECOND STAGE INIT AFTER UI RESTORED
export async function init_sync() {
    const proto = location.protocol;

    api.event.emit('init.two');

    // swarf: bring a stored profile's tool library up to the default one.
    // Runs after conf.restore() so it edits the real profile, not the
    // template. Adds default tools the profile lacks, takes each default's
    // T number, and replaces the vee 1/8 record if it still carries the
    // upstream 0.125 mm defect (inch numbers under metric: true). Tools the
    // student added (ids from Date.now()) are untouched, as are ops.
    try {
        const s = api.conf.get();
        if (s && Array.isArray(s.tools)) {
            let changed = false;
            for (const def of conf.template.tools) {
                const i = s.tools.findIndex(t => t.id == def.id);
                if (i < 0) {
                    s.tools.push(Object.clone(def));
                    changed = true;
                    continue;
                }
                const t = s.tools[i];
                if (def.id === 1003 && t.metric && t.flute_diam < 1) {
                    s.tools[i] = Object.clone(def);
                    changed = true;
                } else if (t.number !== def.number) {
                    t.number = def.number;
                    changed = true;
                }
            }
            // a student-added tool keeps its T number unless a default now holds it
            const defNums = new Set(conf.template.tools.map(t => t.number));
            const defIds = new Set(conf.template.tools.map(t => t.id));
            let next = Math.max(...s.tools.map(t => t.number || 0)) + 1;
            for (const t of s.tools) {
                if (!defIds.has(t.id) && defNums.has(t.number)) {
                    t.number = next++;
                    changed = true;
                }
            }
            if (changed) api.conf.save();
        }
    } catch (e) { console.warn('swarf: tool library migration failed', e); }

    // load script extensions
    if (SETUP.s) SETUP.s.forEach(function(lib) {
        let scr = DOC.createElement('script');
        scr.setAttribute('async', true);
        scr.setAttribute('defer', true);
        scr.setAttribute('src',`/code/${lib}.js`);
        DOC.body.appendChild(scr);
        stats.add('load_'+lib);
        api.event.emit('load.lib', lib);
    });

    // override stored settings
    if (SETUP.v) SETUP.v.forEach(function(kv) {
        kv = kv.split('=');
        sdb.setItem(kv[0],kv[1]);
    });

    // import octoprint settings
    if (SETUP.ophost) {
        let ohost = api.const.OCTO = {
            host: SETUP.ophost[0],
            apik: SETUP.opkey ? SETUP.opkey[0] : ''
        };
        sdb['octo-host'] = ohost.host;
        sdb['octo-apik'] = ohost.apik;
        console.log({octoprint:ohost});
    }

    // One-time migration: Initialize model.opacity from existing ghosting state
    if (api.local.getFloat('model.opacity') === null) {
        const wireframeOpacity = api.local.getFloat('model.wireframe.opacity');
        const wireframe = api.local.getBoolean('model.wireframe', false);

        // If ghosting was enabled (wireframe off, opacity < 1), preserve it
        if (!wireframe && wireframeOpacity !== null && wireframeOpacity < 1) {
            api.local.set('model.opacity', wireframeOpacity);
        } else {
            api.local.set('model.opacity', 1.0);
        }
    }

    // load workspace from url
    if (SETUP.wrk) {
        set_ctrl.import_url(`${proto}//${SETUP.wrk[0]}`, false);
    }

    // load an object from url
    if (SETUP.load) {
        console.log({load:SETUP});
        api.platform.load_url(`${proto}//${SETUP.load[0]}`);
    }

    // bind this to UI so main can call it on settings import
    ui.sync = ui_sync;
    ui_sync();

    // clear alerts as they build up
    setInterval(api.event.alerts, 1000);

    // add hide-alerts-on-alert-click
    ui.alert.dialog.onclick = function() {
        api.event.alerts(true);
    };

    if (!SETUP.s) console.log(`kiri | init main | ${version}`);

    // send init-done event
    api.event.emit('init-done', stats);

    // swarf: no cookie banner (swarf sets no cookies; the markup is gone)

    // warn of degraded functionality when SharedArrayBuffers are missing
    // swarf: one plain sentence, and none on a first visit, whose one reload (swarf-sw.js, index.html)
    // brings the shared memory (live 086 in Firefox: three broken lines flashed before that reload)
    const swReload = 'serviceWorker' in navigator && !navigator.serviceWorker.controller;
    if (api.feature.work_alerts && !window.SharedArrayBuffer && !swReload) {
        api.alerts.show("This window can't share memory with swarf's helpers, so simulate and some steps won't run. A private window can do this: open swarf in a normal window, or reload.", 12);
    }

    // add keyboard focus handler (must use for iframes)
    WIN.addEventListener('load', function () {
        WIN.focus();
        DOC.body.addEventListener('click', function() {
            WIN.focus();
        },false);
    });

    // Setup navigation button bindings
    setup_keybd_nav();

    // show topline separator when iframed
    if (WIN.self !== WIN.top) {
        $('menubar').classList.add('top');
    }

    // warn users they are running a beta release
    if (beta && beta > 0 && sdb.kiri_beta != beta) {
        api.show.alert('caution: beta code ahead', 10);
        sdb.kiri_beta = beta;
    }

    // warn users they are using a development server
    let devwarn = sdb.kiri_dev;
    if (location.host === 'dev.grid.space' && devwarn !== version) {
        api.alerts.show('this is a development server', 10);
        api.alerts.show('use grid.space/kiri for production', 10);
        sdb.kiri_dev = version;
    }

    // hide url params but preserve version root (when present)
    let wlp = WIN.location.pathname;
    let kio = wlp.indexOf('/kiri/');
    if (kio >= 0) {
        history.replaceState({}, '', wlp.substring(0,kio + 6));
    }

    // upon restore, seed presets
    api.event.emitDefer('preset', api.conf.get());

    // lift curtain
    $('curtain').style.display = 'none';
}

function ui_sync() {
    const current = api.conf.get();
    const control = current.controller;

    if (!control.devel) {
        // TODO: hide thin type 3 during development
        api.const.LISTS.thin.length = 3;
    }

    platform.deselect();
    catalog.addFileListener(fileOps.updateCatalog);
    space.view.setZoom(control.reverseZoom, control.zoomSpeed);
    space.platform.setGridZOff(undefined);
    space.platform.setZOff(0.05);
    space.view.setProjection(control.ortho ? 'orthographic' : 'perspective');

    // restore UI state from settings
    ui.antiAlias.checked = control.antiAlias;
    ui.assembly.checked = control.assembly;
    ui.autoLayout.checked = control.autoLayout;
    ui.autoSave.checked = control.autoSave;
    ui.devel.checked = control.devel;
    ui.freeLayout.checked = control.freeLayout;
    ui.healMesh.checked = control.healMesh;
    ui.manifold.checked = control.manifold;
    ui.ortho.checked = control.ortho;
    ui.reverseZoom.checked = control.reverseZoom;
    ui.showOrigin.checked = control.showOrigin;
    ui.showRulers.checked = control.showRulers;
    ui.showSpeeds.checked = control.showSpeeds;
    ui.spaceRandoX.checked = control.spaceRandoX;
    // ui.threaded.checked = setThreaded(control.threaded);
    ui.webGPU.checked = control.webGPU;

    preferences.setThreaded(true);
    preferences.lineTypeSave();
    preferences.detailSave();
    api.visuals.update_stats();

    // optional set-and-lock mode (hides mode menu)
    let SETMODE = SETUP.mode ? SETUP.mode[0] : null;

    // optional set-and-lock device (hides device menu)
    let DEVNAME = SETUP.dev ? SETUP.dev[0] : null;

    // setup default mode and enable mode locking, if set
    api.mode.set(SETMODE || STARTMODE || current.mode, SETMODE);

    // fill device list
    api.devices.refresh();

    // update ui fields from settings
    api.conf.update_fields();

    // default to ARRANGE view mode
    api.view.set(VIEWS.ARRANGE);

    // add ability to override (todo: restore?)
    // api.show.controls(api.feature.controls);

    // update everything dependent on the platform size
    platform.update_size();

    // load wasm if indicated
    client.wasm(control.assembly === true);
}

function setup_keybd_nav() {
    const panelPosKeys = {
        'panel-move': 'win.move',
        'panel-rotate': 'win.roate',
        'panel-scale': 'win.scale'
    };

    function parsePanelPos(key) {
        if (!key) return null;
        const raw = api.local.get(key);
        if (!raw) return null;
        if (typeof raw === 'object' && raw.left !== undefined && raw.top !== undefined) {
            return raw;
        }
        if (typeof raw === 'string') {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.left !== undefined && parsed.top !== undefined) {
                    return parsed;
                }
            } catch (e) {
                // ignore malformed stored values
            }
        }
        return null;
    }

    function placePanel(panel, pos) {
        if (!panel || !pos) return;
        panel.style.left = `${Math.round(pos.left)}px`;
        panel.style.top = `${Math.round(pos.top)}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    }

    function placePanelDefault(panel) {
        if (!panel) return;
        const rect = panel.getBoundingClientRect();
        const width = rect.width || 260;
        const modeToolsRect = $('mode-tools')?.getBoundingClientRect();
        const baseTop = modeToolsRect ? (modeToolsRect.bottom + 10) : 92;
        const minPad = 8;
        const maxLeft = Math.max(minPad, window.innerWidth - width - minPad);
        const left = Math.min(maxLeft, Math.max(minPad, (window.innerWidth - width) / 2));
        placePanel(panel, { left, top: baseTop });
    }

    function showSelectionPanel(pid) {
        const panel = $(pid);
        if (!panel) return;
        panel.classList.remove('hide');
        const key = panelPosKeys[pid];
        const saved = parsePanelPos(key);
        if (saved) {
            placePanel(panel, saved);
        } else {
            placePanelDefault(panel);
        }
    }

    function hideSelectionPanel(pid) {
        const panel = $(pid);
        if (!panel) return;
        panel.classList.add('hide');
    }

    function toggleSelectionPanel(pid) {
        const el = $(pid);
        if (!el) return;
        if (el.classList.contains('hide')) {
            showSelectionPanel(pid);
        } else {
            hideSelectionPanel(pid);
        }
    }

    function makePanelDraggable(panelId, handleId, storageKey) {
        const panel = $(panelId);
        const handle = $(handleId);
        if (!panel || !handle) return;
        let sx = 0, sy = 0, px = 0, py = 0, dragging = false;
        handle.onmousedown = (ev) => {
            if (ev.button !== 0) return;
            dragging = true;
            sx = ev.clientX;
            sy = ev.clientY;
            const rect = panel.getBoundingClientRect();
            px = rect.left;
            py = rect.top;
            ev.preventDefault();
            ev.stopPropagation();
        };
        document.addEventListener('mousemove', (ev) => {
            if (!dragging) return;
            const nx = px + (ev.clientX - sx);
            const ny = py + (ev.clientY - sy);
            panel.style.left = `${Math.round(nx)}px`;
            panel.style.top = `${Math.round(ny)}px`;
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', () => {
            if (dragging && storageKey) {
                const rect = panel.getBoundingClientRect();
                api.local.set(storageKey, JSON.stringify({
                    left: Math.round(rect.left),
                    top: Math.round(rect.top)
                }));
            }
            dragging = false;
        });
    }

    // bind interface action elements
    ui.acct.help.onclick = (ev) => { ev.stopPropagation(); api.help.show() };
    // swarf: 'donate' menu item removed; skip binding (Kiri had a GridSpace patreon link)
    if (ui.acct.don8) ui.acct.don8.onclick = (ev) => { ev.stopPropagation(); api.modal.show('don8') };
    if (ui.acct.export) {
        ui.acct.export.onclick = (ev) => { ev.stopPropagation(); settingsOps.export_profile() };
        // swarf: the menu item's own title says what a .kmz is (menu.js); Kiri's "make a backup of your
        // device" wrote over it (deep review P5)
    }
    // prevent modal input from propagating to parents
    ui.modalBox.onclick = (ev) => { ev.stopPropagation() };

    $('export-support-a').onclick = (ev) => { ev.stopPropagation(); api.modal.show('don8') };
    // swarf: mode menu removed — these buttons no longer exist in the DOM
    $('set-device').onclick = (ev) => { ev.stopPropagation(); api.show.devices() };
    $('set-tools').onclick = (ev) => { ev.stopPropagation(); api.show.tools() };
    $('set-prefs').onclick = (ev) => { ev.stopPropagation(); api.modal.show('prefs') };
    // swarf: Help menu — Search / Concordance / About
    const helpSearch = $('swarf-help-search');
    if (helpSearch) helpSearch.onclick = (ev) => { ev.stopPropagation(); api.modal.show('swarf-search'); setTimeout(() => { const i = $('swarf-search-input'); if (i) i.focus(); }, 50); };
    // the videos about swarf (Phil 11-01), one place for the link: the about card and help › swarf videos
    const VIDEOS = 'https://www.youtube.com/watch?v=PLagAIp6MCY&list=PLNPXIo7F2Cm0';
    const helpVid = $('swarf-videos');
    if (helpVid) helpVid.onclick = (ev) => { ev.stopPropagation(); window.open(VIDEOS, '_blank', 'noopener'); };
    const helpConc = $('swarf-concordance');
    if (helpConc) helpConc.onclick = (ev) => { ev.stopPropagation(); api.modal.show('swarf-concordance'); };
    const helpReset = $('swarf-reset-profile');
    if (helpReset) helpReset.onclick = (ev) => {
        ev.stopPropagation();
        // (whole-app review r086 F10) asked in swarf's own card, not the browser's
        document.body.click();
        const pre = ["<div class='f-col a-center swarf-shape'><h3>Start swarf over?</h3>",
            "<p class='swarf-shape-why' style='color:inherit;max-width:340px'>Every setting, bit and part on this computer goes, and swarf reloads as new. A project saved as a .swarf file is kept: open it again after.</p></div>"];
        api.uc.confirm(undefined, { 'keep everything': false, 'start over': 'reset' }, undefined, { pre }).then(v => {
            if (v === 'reset' && window.__swarfResetProfile) window.__swarfResetProfile();
        });
    };
    // swarf: reparent #panel-left and #panel-right out of #mid so fixed positioning
    // actually pins to the viewport. Some ancestor in Kiri's flow has a containing block
    // that was trapping fixed descendants.
    (function(){
        const reparent = (id) => {
            const el = document.getElementById(id);
            if (el && el.parentNode !== document.body) document.body.appendChild(el);
        };
        reparent('panel-left');
        reparent('panel-right');
        // (whole-app review r086 C3) advanced's own panels (machine profile, stock, limits,
        // origin, expert) sat over the right rail, see-through. They are a column of their own
        // beside toolpaths, below the notice line, scrolling if they run long.
        const left = document.getElementById('panel-left'), tp = document.getElementById('panel-right');
        if (!left || !tp) return;
        const dock = () => {
            const r = tp.getBoundingClientRect();
            if (!left.offsetParent || r.height < 4) return;
            const top = 136;
            const set = (k, v) => left.style.setProperty(k, v, 'important');
            set('top', top + 'px'); set('left', Math.round(r.right + 10) + 'px'); set('right', 'auto'); set('bottom', 'auto');
            set('width', '280px'); set('max-height', Math.max(160, innerHeight - top - 100) + 'px');
        };
        if (window.ResizeObserver) { new ResizeObserver(dock).observe(tp); new ResizeObserver(dock).observe(left); }
        window.addEventListener('resize', dock);
        new MutationObserver(() => setTimeout(dock, 0)).observe(document.body, { attributes: true, attributeFilter: ['class'] });
        setTimeout(dock, 0);
    })();

    // swarf: click-to-open menus (kill Kiri's hover-to-open — markup note: "like a real app")
    (function(){
        const menus = document.querySelectorAll('#menubar .top-menu > span');
        const close = () => {
            menus.forEach(m => m.classList.remove('swarf-open'));
            document.body.classList.remove('swarf-menu-open');
        };
        menus.forEach(m => {
            if (!m.querySelector(':scope > .pop, :scope > .top-menu-drop')) return; // only menus with a dropdown
            m.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const wasOpen = m.classList.contains('swarf-open');
                close();
                if (!wasOpen) {
                    m.classList.add('swarf-open');
                    document.body.classList.add('swarf-menu-open');
                }
            });
        });
        document.addEventListener('click', close);
        document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });
        // swarf (whole-app review r086 F7): the menu bar and the mode row take Tab. Enter or
        // Space presses a step or opens a menu (its first item takes the focus); arrows walk the
        // open menu's items; Esc closes it. One focus ring per skin (swarf.css).
        const press = (el, ev) => { ev.preventDefault(); ev.stopPropagation(); el.click(); };
        const items = m => [...m.querySelectorAll('.top-menu-drop .content > div')].filter(d => d.offsetParent && !d.classList.contains('hide'));
        menus.forEach(m => {
            if (!m.querySelector(':scope > .top-menu-drop')) return;
            m.tabIndex = 0;
            m.setAttribute('role', 'button');
            m.setAttribute('aria-haspopup', 'menu');
            for (const d of m.querySelectorAll('.top-menu-drop .content > div')) { d.tabIndex = -1; d.setAttribute('role', 'menuitem'); }
            m.addEventListener('keydown', ev => {
                const list = items(m), at = list.indexOf(document.activeElement);
                if ((ev.key === 'Enter' || ev.key === ' ') && at >= 0) return press(list[at], ev);
                if (ev.key === 'Enter' || ev.key === ' ' || (ev.key === 'ArrowDown' && !m.classList.contains('swarf-open'))) {
                    press(m, ev);
                    setTimeout(() => { const f = items(m)[0]; if (f) f.focus(); }, 0);
                    return;
                }
                if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                    ev.preventDefault();
                    const n = list[(at + (ev.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length];
                    if (n) n.focus();
                }
                if (ev.key === 'Escape') { close(); m.focus(); }
            });
        });
        const steps = () => document.querySelectorAll('#mode-tools > .swarf-step');
        const stepKeys = () => steps().forEach(s => {
            if (s.dataset.swarfTab) return;
            s.dataset.swarfTab = '1';
            s.tabIndex = 0;
            s.setAttribute('role', 'button');
            s.addEventListener('keydown', ev => { if ((ev.key === 'Enter' || ev.key === ' ') && !ev.repeat) press(s, ev); });
        });
        stepKeys();
        setTimeout(stepKeys, 1500);
    })();

    // swarf r44 (review 10-28 #7): one camera rule. The view frames all the parts with one
    // margin, and moves only when it has to: a part arrives off screen or onto an empty
    // bed, or a project loads. Deleting, duplicating beside, or redrawing in place leaves
    // the camera where the student put it; an emptied bed goes home.
    (function(){
        const FILL = 1.0;            // space.view.fit padding: the parts span about a third of the view
        const meshes = () => (api.widgets.all() || []).map(w => w.mesh).filter(Boolean);
        // the parts' box in the scene, bounds rebuilt first (a part made a moment ago)
        const boxOf = list => {
            const box = new THREE.Box3();
            for (const m of list) { try { m.geometry && m.geometry.computeBoundingBox(); } catch (e) {} box.expandByObject(m); }
            return box;
        };
        // every corner of the parts' box inside the window (lim of the half-width), in front of
        // the camera, and the camera not inside the box (r086 check M1: a wall of orange)
        const inView = (list, lim = 0.9) => {
            const cam = space.internals && space.internals().camera;
            if (!cam) return false;
            cam.updateMatrixWorld();
            const box = boxOf(list);
            if (box.isEmpty()) return true;
            if (box.containsPoint(cam.position)) return false;
            const v = new THREE.Vector3();
            for (let i = 0; i < 8; i++) {
                v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(cam);
                if (Math.abs(v.x) > lim || Math.abs(v.y) > lim || v.z > 1 || v.z < -1) return false;
            }
            return true;
        };
        // the camera under the bed (scene y is the bed's up): nobody looks at a part from there
        const below = list => {
            const cam = space.internals && space.internals().camera;
            const box = boxOf(list);
            return !!cam && !box.isEmpty() && cam.position.y < box.min.y;
        };
        // One fit at a time. space.view.fit tweens the zoom as a ratio of where the camera is when
        // it starts, so two fits a few ms apart (DRAW's done: widget.add at 60 ms and done at 120)
        // multiplied into each other and left the camera inside the part (r086 check M1). Calls in
        // a burst become one fit, made two frames later when the rebuilt meshes have their bounds;
        // a call during a tween waits for it to land. Once landed, the fit is checked: a corner off
        // screen, the camera in the parts' box or under the bed, and it fits again at once.
        let queued = false, busy = false, again = false, guard = 0;
        const fitNow = (then, tween) => {
            try { space.event.onResize(); } catch (e) {}
            try { api.platform.update_bounds(); } catch (e) {}
            const all = meshes();
            for (const m of all) { try { m.geometry && m.geometry.computeBoundingBox(); } catch (e) {} }
            if (!(space.view.fit && all.length)) { bed(); then && then(); return; }
            const opts = { padding: FILL, visibleOnly: true, objects: all };
            if (below(all)) opts.up = Math.PI / 4;       // looking up from under the bed: back over it
            if (!tween) opts.tween = false;
            space.view.fit(then, opts);
        };
        const settle = () => {
            const all = meshes();
            if (!all.length || (inView(all, 0.95) && !below(all))) return;
            try { fitNow(null, false); } catch (e) {}
        };
        const landed = () => {
            clearTimeout(guard);
            if (!busy) return;
            busy = false;
            if (again) { again = false; frame(); return; }
            settle();
        };
        const frame = () => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => requestAnimationFrame(() => {
                queued = false;
                if (busy) { again = true; return; }
                busy = true;
                guard = setTimeout(landed, 900);   // a tween that never calls back
                try { fitNow(landed, true); } catch (e) { landed(); }
            }));
        };
        // an empty bed: the home angle, framing the whole bed (review 10-28b #14)
        const bed = () => {
            const plat = space.internals && space.internals().platform;
            space.view.home();
            if (plat && space.view.fit) setTimeout(() => { try { if (!meshes().length) space.view.fit(undefined, { padding: 0.75, objects: [plat] }); } catch (e) {} }, 380);
        };
        api.frame_bed = bed;
        // simulate frames the board it carves, not the part: the stock is wider and ran under the
        // toolpaths panel, the view on its corner (deep review S5 / r086-whole B7)
        api.event.on('function.animate', () => {
            window.__swarfSimStock = null;
            let n = 0;
            const t = setInterval(() => {
                const st = window.__swarfSimStock;
                if (!st && ++n < 40) return;
                clearInterval(t);
                if (st && space.view.fit) try { st.updateMatrixWorld && st.updateMatrixWorld(); space.view.fit(undefined, { padding: FILL * 1.35, objects: [st], visibleOnly: false }); } catch (e) { /* no view */ }
            }, 50);
        });
        const always = () => { requestAnimationFrame(frame); setTimeout(frame, 250); };
        let wasEmpty = true;
        const added = payload => {
            const empty = wasEmpty;
            setTimeout(() => {
                const list = (Array.isArray(payload) ? payload : [payload]).map(w => w && w.mesh).filter(Boolean);
                wasEmpty = !meshes().length;
                if (empty || !inView(list.length ? list : meshes())) frame();
            }, 60);
        };
        api.event.on('widget.add', added);
        api.event.on('widget.delete', () => setTimeout(() => { if (!meshes().length) { wasEmpty = true; frame(); } }, 60));
        // a deleted part's toolpaths leave the bed with it (deep review S19: its ring stayed drawn beside
        // the next part until toolpaths was pressed again); the steps stay, the paths are made again
        api.event.on('widget.delete', w => { if (Array.isArray(w) && !w.length) return; if (api.view && !api.view.is_arrange()) api.view.set_arrange(); });
        api.event.on('widgets.loaded', () => { wasEmpty = !meshes().length; always(); });
        api.event.on('load.url', always);
        api.event.on('device.select', () => setTimeout(() => { if (!meshes().length) bed(); }, 300));
        api.frame = frame;
        // frame only if these parts are not all in view (the same rule, for code that moved parts)
        api.reveal = list => { if (!inView((list && list.length ? list : api.widgets.all()).map(w => w.mesh).filter(Boolean))) frame(); };

        // swarf r14+: force-select newly-added widgets after a short delay so
        // drag-to-move works on first import. platform.add calls platform.select
        // but the initial select is sometimes swallowed if the view hasn't
        // settled into ARRANGE yet. Re-running select later closes that window.
        const selectNew = (payload) => {
            const widgets = Array.isArray(payload) ? payload : (payload ? [payload] : []);
            setTimeout(() => {
                try {
                    if (!api.view.is_arrange?.()) return;
                    const ws = widgets.length ? widgets : api.widgets.all();
                    if (!ws.length) return;
                    // if nothing is already selected, select the first one.
                    if (api.selection.count() === 0) api.platform.select(ws[0], false);
                } catch (e) {}
            }, 300);
        };
        api.event.on('widget.add', selectNew);
        api.event.on('load.url', selectNew);
    })();

    // swarf: lower-left renato.design watermark (markup Apr 15, annotation #7)
    (function(){
        if (document.getElementById('swarf-watermark')) return;
        const wm = document.createElement('a');
        wm.id = 'swarf-watermark';
        wm.href = 'https://renato.design';
        wm.target = '_blank';
        wm.rel = 'noopener';
        wm.textContent = 'renato.design';
        document.body.appendChild(wm);
    })();

    // swarf: Expert toggle — flips body.swarf-expert, persists in localStorage
    (function(){
        const key = 'swarf-expert';
        const apply = (on) => {
            document.body.classList.toggle('swarf-expert', !!on);
            const item = document.getElementById('swarf-expert-toggle');
            if (item) item.classList.toggle('selected', !!on);
        };
        let was = null; try { was = localStorage.getItem(key); } catch (e) { /* storage blocked */ }
        apply(was === '1');
        const tog = $('swarf-expert-toggle');
        if (tog) tog.onclick = (ev) => {
            ev.stopPropagation();
            const next = document.body.classList.contains('swarf-expert') ? 0 : 1;
            try { localStorage.setItem(key, String(next)); } catch (e) { /* storage blocked */ }
            apply(next);
        };
    })();
    // swarf: Concerns drawer (markup Apr 15, locked rule) — bottom-bar count badge,
    // click opens a list of rule-based warnings. Starter ruleset: stepover too wide
    // on finishing, plunge rate same as feed rate, depth-of-cut > 1× tool diameter.
    // Op records name these fields `rate` and `down` (see cl-ops.js createPopOp) —
    // reading `feed`/`depth` here made rules 2 and 3 unfireable.
    // More rules land during the coaching pass.
    (function(){
        if (document.getElementById('swarf-concerns')) return;
        const wrap = document.createElement('div');
        wrap.id = 'swarf-concerns';
        wrap.innerHTML = `
            <div id="swarf-concerns-tab" title="what could go wrong with this setup: click to open">
                <span>concerns</span>
                <span id="swarf-concerns-count">0</span>
            </div>
            <div id="swarf-concerns-body"></div>
        `;
        document.body.appendChild(wrap);
        const tab = wrap.querySelector('#swarf-concerns-tab');
        const body = wrap.querySelector('#swarf-concerns-body');
        const count = wrap.querySelector('#swarf-concerns-count');
        tab.addEventListener('click', (e) => {
            e.stopPropagation();
            wrap.classList.toggle('open');
        });
        document.addEventListener('click', (e) => {
            if (!wrap.contains(e.target)) wrap.classList.remove('open');
        });
        // (review r086 F2) the pill docks under the right rail, never inside its panels: its top
        // follows the rail's bottom as panels open, close and scroll; with no rail it keeps its corner
        const dock = () => {
            const rail = document.getElementById('swarf-right-rail');
            const r = rail && rail.offsetParent !== null ? rail.getBoundingClientRect() : null;
            if (r && r.height > 4) { wrap.style.top = Math.round(r.bottom + 8) + 'px'; wrap.style.bottom = 'auto'; }
            else { wrap.style.top = ''; wrap.style.bottom = ''; }
        };
        const rail = document.getElementById('swarf-right-rail');
        if (rail && window.ResizeObserver) new ResizeObserver(dock).observe(rail);
        window.addEventListener('resize', dock);
        new MutationObserver(dock).observe(document.body, { attributes: true, attributeFilter: ['class'] });
        setTimeout(dock, 0);
        // (r086 check S1) a rail cut at the window's foot says there is more below it: at 720
        // the auto tabs panel ran past the fold with nothing to show it scrolled. (r093 UX B3/V5)
        // advanced's panel column and the tex card scroll too, and say so the same way.
        const watched = new WeakSet();
        const moreBelow = box => {
            if (!box || watched.has(box)) return;
            watched.add(box);
            let rq = 0;
            const more = () => { rq = 0; box.classList.toggle('swarf-more', box.scrollHeight - box.clientHeight - box.scrollTop > 6); };
            const soon = () => { if (!rq) rq = requestAnimationFrame(more); };
            box.addEventListener('scroll', soon, { passive: true });
            window.addEventListener('resize', soon);
            if (window.ResizeObserver) new ResizeObserver(soon).observe(box);
            new MutationObserver(soon).observe(box, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'open'] });
            setTimeout(soon, 0);
        };
        moreBelow(rail);
        moreBelow(document.getElementById('panel-left'));
        // the tex card is built when tex opens
        new MutationObserver(() => moreBelow(document.getElementById('tx-card'))).observe(document.body, { attributes: true, attributeFilter: ['class'] });

        // rule engine: pull current settings + ops, evaluate each rule, render warnings
        const tabsOpened = new Set();
        function evaluate() {
            const warnings = [];
            // (whole-app review r086 F4) a concern's numbers follow mm | in too
            const inch = !!window.SwarfLength && window.SwarfLength.unit() === 'in';
            // (r086 check S3) in inches a sentence says the nearest 16th, as a tape measure reads
            const len = (v, dp = 1) => inch ? window.SwarfLength.prose(v, 'in') : `${(+v).toFixed(dp)} mm`;
            const pair = (a, b) => inch ? `${+(a / 25.4).toFixed(1)} × ${+(b / 25.4).toFixed(1)} in` : `${a.toFixed(0)} × ${b.toFixed(0)} mm`;
            const rate = v => inch ? `${+(v / 25.4).toFixed(1)} in/min` : `${v} mm/min`;
            try {
                const settings = api.conf.get();
                const proc = settings.process || {};
                const ops = (proc.ops || proc.ops2 || []).filter(Boolean);
                const tools = settings.tools || [];
                for (const op of ops) {
                    // op.tool holds a tool id; the library stores imperial
                    // tools in inches, and every op field here is mm.
                    const tool = tools.find(t => t.id == op.tool);
                    const td = tool
                        ? (tool.flute_diam || 0) * (tool.metric ? 1 : 25.4)
                        : 3.175;
                    // rule 1 — stepover > 50% on a finishing pass
                    if ((op.type === 'contour' || op.type === 'finish') && op.step != null) {
                        if (op.step > 0.5) {
                            warnings.push({
                                title: `wide stepover on ${op.type}`,
                                body: `${(op.step*100).toFixed(0)}% of tool diameter on a finishing pass leaves a coarser surface than typical (5–15%).`,
                                hint: 'finer stepover = smoother finish + slower run'
                            });
                        }
                    }
                    // rule 2 — plunge faster than the 30–40% of feed the palette holds
                    if (op.rate && op.plunge && op.plunge > op.rate * 0.5) {
                        warnings.push({
                            title: `plunge rate near feed rate`,
                            body: `plunging at ${rate(op.plunge)} vs feed ${rate(op.rate)}: swarf's presets plunge at 30–40% of feed.`,
                            hint: 'too fast a plunge snaps end-mills'
                        });
                    }
                    // swarf: values that make a dangerous cut (torture test 10-29: all passed with no word)
                    if (op.down != null && ['rough', 'outline', 'pocket', 'contour'].includes(op.type) && !(op.down > 0)) {
                        warnings.push({
                            title: `${op.type} step-down is ${op.down}`,
                            body: 'a step-down of zero or less cuts the whole depth in one pass, or nothing at all.',
                            hint: 'about half the bit\'s width or less, for example 3 mm for a 1/4 in bit' });
                    }
                    if (op.ov_botz != null && op.ov_botz !== 0 && proc.camStockZ !== undefined) {
                        const thick = Math.max(0, ...api.widgets.all().filter(w => !w.track.synth).map(w => (w.track.box || {}).d || 0));
                        if (op.ov_botz < -2 || (thick && op.ov_botz > thick)) warnings.push({
                            title: `${op.type} bottom is ${len(op.ov_botz)}`,
                            body: op.ov_botz < -2 ? `that is ${len(-op.ov_botz)} below the bottom of the board: into the spoilboard or the table.` : 'that is above the top of the board: the step cuts nothing.',
                            hint: 'leave the override at 0 to cut to the part\'s own bottom' });
                    }
                    // rule 3 — step-down past half the tool diameter, the palette's ceiling
                    if (op.down && td && op.down > td * 0.5) {
                        warnings.push({
                            title: `step-down over half the tool diameter`,
                            body: `a ${len(op.down, 2)} step-down on a ${len(td, 2)} bit: swarf's presets stay under ${len(td / 2, 2)}.`,
                            hint: 'split into shallower passes for safer cutting'
                        });
                    }
                    // rule 4 — cutting speed past the material's HSS figure: the
                    // machine's spindle floor (ShopBot 9000) or a hand-typed rpm
                    // not on the ShopBot: its router turns 10,000 rpm at its slowest and takes
                    // carbide bits, so this fired on every default setup (reviews 10-29)
                    const mat = window.__swarfMaterial;
                    const vcMax = mat && mat.cut && mat.cut.vc;
                    const router = /shopbot/i.test((settings.device && settings.device.deviceName) || '');
                    if (vcMax && op.spindle && td && !router) {
                        const vc = Math.PI * td * op.spindle / 1000;
                        if (vc > vcMax * 1.5) {
                            warnings.push({
                                title: `spindle too fast for a steel bit in ${mat.name}`,
                                body: `${vc.toFixed(0)} m/min cutting speed at ${op.spindle} rpm on a ${td.toFixed(2)} mm tool — a high-speed steel (HSS) bit in ${mat.name} wants ${vcMax}.`,
                                hint: 'carbide, a smaller tool, or a slower spindle'
                            });
                        }
                    }
                }
                // rapids skim the board: z clearance is how far above its top they travel. The ShopBot
                // gets 5 mm (swarf-sky.js); under 3 mm there (screws, clamps, a board not flat over a
                // sheet) or 0.5 mm on the MR-1's plate, it is a concern (Phil 10-29: it fired on 1 mm)
                const zc = proc.camZClearance;
                const sb = /shopbot/i.test((settings.device && settings.device.deviceName) || '');
                const zsay = v => window.SwarfLength ? window.SwarfLength.say(v) : `${(+v).toFixed(1)} mm`;
                if (zc != null && zc < (sb ? 3 : 0.5)) warnings.push({
                    title: `rapids only ${zsay(zc)} above the board`,
                    body: zc <= 0 ? 'with z clearance at or under 0, every rapid move runs at or into the board at full speed.' : 'moves between cuts barely clear the board and catch on a screw, a clamp or a high spot.',
                    hint: `limits › z clearance: ${sb ? '5 mm (0.2 in)' : 'at least 1 mm'}` });
            } catch (e) { /* swallow until ops shape is finalised */ }
            // the bed is a limit on both machines (Fable review 3 #13): a part bigger than the bed,
            // or hanging off it, is a concern in cam, not only a blocked file in control
            try {
                const dev = api.conf.get().device || {}, bw = dev.bedWidth, bd = dev.bedDepth;
                const mach = (dev.deviceName || 'machine').replace(/\./g, ' ').replace(/^(\w+) Basic$/, '$1');
                const soft = /shopbot/i.test(dev.deviceName || '');
                for (const w of api.widgets.all()) {
                    const g = w.mesh.geometry; g.computeBoundingBox();
                    const b = g.boundingBox, p = w.track.pos, name = (w.meta && w.meta.file || 'a part').replace(/\.[^.]+$/, '');
                    const sx = b.max.x - b.min.x, sy = b.max.y - b.min.y, sz = b.max.z - b.min.z;
                    if (bw && bd && (sx > bw + 0.5 || sy > bd + 0.5)) warnings.push({
                        title: `${name} is bigger than the ${mach}'s bed`,
                        body: `${pair(sx, sy)}; the bed is ${pair(bw, bd)}. The machine cannot cut it as it is.`,
                        hint: 'make it smaller, or choose the other machine (setup › machine)' });
                    else if (bw && bd && (p.x + b.min.x < -bw / 2 - 0.5 || p.x + b.max.x > bw / 2 + 0.5 || p.y + b.min.y < -bd / 2 - 0.5 || p.y + b.max.y > bd / 2 + 0.5)) warnings.push({
                        title: `${name} hangs off the bed`,
                        body: `part of it sits outside the ${mach}'s ${pair(bw, bd)} bed.`,
                        hint: 'drag it back onto the bed' });
                    // the shop's ShopBot rule (KCAD guidelines): boards from 1/4 to 2 1/2 in; thinner goes to the laser
                    if (soft && (sz < 6.35 - 0.05 || sz > 63.5 + 0.05)) warnings.push({
                        title: `${name} is ${len(sz)} thick`,
                        body: sz < 6.35 ? 'the ShopBot takes boards from 1/4 in (6.35 mm) up. Thinner sheet goes to the laser.' : 'the ShopBot takes boards up to 2 1/2 in (63.5 mm) thick.',
                        hint: sz < 6.35 ? 'use the laser for thin sheet' : 'ask the technician about thicker stock' });
                }
            } catch (e) { /* no device yet */ }
            // cut free with nothing holding it (Phil 10-29: "anything that could fly off the
            // machine"; "cuts that seem to go all the way through without tabs should be flagged"):
            // an outline cut through the board leaves the part, and every piece inside a hole it
            // cuts, loose on the last pass, where the spinning bit can throw it
            try {
                const proc = api.conf.get().process || {};
                const outl = (proc.ops || []).filter(o => o && (o.type === 'outline' || o.type === 'rough') && !o.disabled);
                const through = !(proc.camZBottom > 0) && !proc.camStockIndexed;
                const audit = window.__swarfAutoTabs && window.__swarfAutoTabs.audit;
                if (outl.length && through && audit) {
                    // a rough down to the part's bottom frees it as an outline does (Phil 10-29: a rough-only circle)
                    const outer = outl.some(o => o.type === 'rough' || !o.inside), holes = outl.some(o => !o.omitthru && !o.omitvoid);
                    for (const w of api.widgets.all()) {
                        if (w.track.synth) continue;
                        const name = (w.meta && w.meta.file || 'a part').replace(/\.[^.]+$/, '');
                        const a = audit(w);
                        // the first time a part is cut free with no tabs, the tabs drawer opens on its
                        // auto tabs button: the hint names it, so it should be in sight (deep review S10)
                        if (outer && a.outerTabs === 0 && !tabsOpened.has(w.id)) {
                            tabsOpened.add(w.id);
                            setTimeout(() => { const hd = document.querySelector('#cam-tabs .set-header'), row = document.querySelector('#cam-tabs .swarf-autotabs-row'); if (hd && row && row.classList.contains('hide')) hd.click(); }, 0);
                        }
                        if (outer && a.outerTabs === 0) warnings.push({
                            title: `${name} is cut free with no tabs`,
                            body: `the ${outl.some(o => o.type === 'outline') ? 'outline' : 'rough'} cuts all the way down around it, so on the last pass the part comes loose. The spinning bit can grab it and throw it.`,
                            hint: 'tabs › auto tabs holds it to the board, or screw it down where the bit does not go' });
                        const loose = holes ? a.loose.filter(h => h.tabs === 0) : [];
                        if (loose.length) {
                            const big = Math.max(...loose.map(h => h.across));
                            const say = inch ? len(big) : window.SwarfLength ? window.SwarfLength.say(big) : `${big} mm`;
                            warnings.push({
                                title: `${loose.length} loose piece${loose.length === 1 ? '' : 's'} inside ${name}`,
                                body: `${loose.length === 1 ? 'a hole leaves' : `${loose.length} holes leave`} a piece cut free (${loose.length === 1 ? '' : 'the widest '}${say} across) with no tab. It can fly when it comes loose.`,
                                hint: 'tabs › auto tabs with "hold inside pieces" on, or a pocket that clears the hole instead' });
                        }
                    }
                }
            } catch (e) { /* tabs not ready yet */ }
            // TEX's marks: what each cannot do as set, in TEX's words (web/kiri/swarf-tex.js)
            try { if (window.__swarfTex) warnings.push(...window.__swarfTex.concerns()); } catch (e) { /* tex not ready */ }
            render(warnings);
        }
        function render(warnings) {
            const seen = new Set();
            warnings = warnings.filter(w => { const k = w.title + '|' + w.body; if (seen.has(k)) return false; seen.add(k); return true; });
            count.textContent = String(warnings.length);
            tab.classList.toggle('has-warnings', warnings.length > 0);
            if (warnings.length === 0) {
                body.innerHTML = '<div class="swarf-empty">setup looks clean — no concerns to flag.</div>';
                return;
            }
            // a concern's title carries a file name: text, never markup (deep review 10-31, as M1)
            const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
            body.innerHTML = warnings.map(w =>
                `<div class="swarf-concern"><strong>${esc(w.title)}</strong>${esc(w.body)}<em>${esc(w.hint)}</em></div>`
            ).join('');
        }
        evaluate();
        // re-evaluate on settings + op changes
        // conf.save emits settings.saved on every op add/edit; the material
        // system emits cam.op.render after a re-derive
        ['settings','settings.saved','cam.op.render','widget.add','widget.delete','device.selected','selection.move','selection.scale','selection.drag','slice.end','units.set']
            .forEach(ev => api.event.on(ev, evaluate));
        window.addEventListener('swarf.material.change', evaluate);
    })();

    // swarf: clicking the TOOLPATHS step bar opens the operation list details
    // panel + scrolls to it (markup Apr 15 — "bring toolpaths back, put in the red
    // toolpaths bar at top which has nothing in it now").
    (function(){
        const tpDetails = $('swarf-toolpaths-details');
        const tpStep = $('view-arrange');
        if (tpStep && tpDetails) {
            tpStep.addEventListener('click', () => {
                tpDetails.open = true;
                try { tpDetails.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
            });
            // open by default on boot so students see there's an op list ready to use
            tpDetails.open = true;
        }
    })();

    // swarf: tool-library opener inside the toolpaths panel (markup Apr 15 —
    // "you're missing the machining tools"). Opens Kiri's tool editor modal.
    (function(){
        const b = $('swarf-open-tools');
        // api.show.tools fills the list first; showing the modal alone left it empty (Phil 10-29)
        if (b) b.onclick = (ev) => { ev.stopPropagation(); api.show.tools(); };
    })();

    // swarf: Searchable Help — index of every named thing in swarf with a
    // short explanation. Real-time filter against the user's query. Index
    // expands during the coaching pass.
    (function(){
        const input = document.getElementById('swarf-search-input');
        const results = document.getElementById('swarf-search-results');
        if (!input || !results) return;
        const INDEX = [
            { kind:'app', name:'videos', body:'help › swarf videos opens the videos about swarf on YouTube in a new tab; the about card (help › about swarf) links them too.', tags:'videos video youtube watch tutorial how to learn demo' },
            { kind:'shop', name:'ShopBot quick start', body:'help › ShopBot quick start walks from a drawing to a cut part in ten steps, as on the shop poster, with a show me on the steps swarf can open for you.', tags:'quick start tutorial first time poster steps shopbot how to' },
            { kind:'shop', name:'permission', body:"the ShopBot runs with a faculty member or the technician's say-so. ask before you start.", tags:'permission faculty technician rules kcad shop' },
            { kind:'shop', name:'your board', body:'bring your own board, flat and labeled with your name, with extra for a test cut. 1/4 to 2 1/2 in thick, up to 4 × 8 ft; thinner sheet goes to the laser.', tags:'board material thickness size laser kcad' },
            { kind:'shop', name:'your drawing', body:'closed outlines only, and no doubled lines on top of each other: swarf cuts every line it is given.', tags:'closed paths duplicate lines drawing kcad' },
            { kind:'shop', name:'protection', body:'safety glasses and hearing protection on, dust collection on, hair and sleeves back.', tags:'safety glasses hearing dust kcad' },
            { kind:'shop', name:'the floor e-stop', body:'the red button on the floor, pressed with your foot. in an emergency, step on it and keep clear until everything has stopped.', tags:'e-stop emergency stop floor foot kcad' },
            { kind:'shop', name:'hours', body:'the ShopBot runs when the woodshop is open; check its hours.', tags:'hours woodshop open kcad' },
            { kind:'run', name:'control', body:'drives the ShopBot from swarf over its USB cable, in Chrome or Edge only. jog, zero, trace, air cut, cut. only shows when the ShopBot is the machine; the MR-1 uses export.', tags:'control shopbot usb run machine chrome edge' },
            { kind:'run', name:'trace / air cut / cut', body:'each one opens a checklist first. trace runs the bit around the rectangle the cut fills, raised, router off; an air cut runs the whole file above the board; cut starts the router. a waiting button says what it still needs.', tags:'trace air cut run checklist rectangle' },
            { kind:'run', name:'jog', body:'moves at once, by the step you pick. go-to buttons and home ask first. space or esc stops; while a job runs, any key pauses it.', tags:'jog move step keys arrows' },
            { kind:'run', name:'table corners', body:"no home switches on this machine: put the bit over the table's front-left corner once and swarf learns it until the machine is switched off. then zero at, or go to, the front-left or front-right corner.", tags:'table corner absolute zero front left right' },
            { kind:'run', name:'z plate', body:'finds the top of the board by touching the bit to a metal plate. put the plate and its clip away before you cut.', tags:'z plate touch off zero height' },
            { kind:'run', name:'router', body:'Porter-Cable 7518. swarf only switches it on and off; set its speed on its dial, 1 (10,000 rpm) to 5 (21,000).', tags:'router spindle porter cable dial rpm' },
            { kind:'run', name:'test cut', body:'learn the machine on scrap plywood. the square and the circle: a groove you measure with calipers. cut out a square: a part held by tabs.', tags:'test cut training lesson calibrate measure' },
            { kind:'draw', name:'draw', body:'the bed seen from above. pen, rectangle, ellipse, text; move points; give it a thickness and a top edge. done or switching mode keeps your changes; cancel drops them.', tags:'draw pen rectangle ellipse text points' },
            { kind:'draw', name:'holes', body:"in draw, an outline drawn wholly inside a part is a hole in it. the card's inside or over a part makes the next outline add to the part, cut from it, or a part of its own instead.", tags:'hole holes add cut subtract join inside draw' },
            { kind:'draw', name:'regions', body:"draw › regions (G): overlapping outlines split into every region they make. click a region to fill or empty it; apply, done or another tool makes the filled regions the parts.", tags:'regions region fill empty overlap boolean shapereason draw' },
            { kind:'draw', name:'pencil', body:"draw › pencil (N): drag freehand and it becomes a few smooth points that move like the pen's. points in the card fits it again: fewer is smoother. end near the start to close it.", tags:'pencil freehand sketch points smooth draw' },
            { kind:'draw', name:'engrave', body:"draw a line over a part (the pencil, or the pen: click its last point again), give it an engrave depth, press done: an engrave step cuts along the line, the bit's center on it, that deep from the part's top.", tags:'engrave engraved line groove carve depth trace draw' },
            { kind:'tex', name:'tex', body:"the mode for marking a part and texturing the mark (draw makes shapes; tex marks them). pick a part, mark it, then pick a pattern in the card. done adds a texture step for each mark, before the cut-out; cancel drops them.", tags:'tex texture mark marking surface finish pattern carve decorate mode' },
            { kind:'tex', name:'clear marks', body:"tex › clear removes every mark on the picked part, or on all parts when none is picked. undo brings them back.", tags:'clear marks remove all erase tex undo' },
            { kind:'tex', name:'sliders', body:"every number in tex's card has a slider beside it: drag it, or type a value in its field.", tags:'slider sliders number field value density tex card' },
            { kind:'tex', name:'direction', body:"tex › direction turns the pattern on the mark.", tags:'direction angle turn rotate pattern tex' },
            { kind:'tex', name:'relief', body:"tex › relief: cut in carves the pattern into the top; stands up cuts the ground around it away and leaves the pattern standing.", tags:'relief invert raise stands up cut in raised sunk tex' },
            { kind:'tex', name:'edge', body:"tex's card keeps falloff and border under edge. on a short window the fold is shape and edge, with direction and relief inside it too.", tags:'edge shape and edge fold card short window tex' },
            { kind:'tex', name:'falloff', body:"edge › falloff shapes the soft edge: smooth, a straight ramp, round (steep at the edge) or cove (gentle at the edge).", tags:'falloff curve soft edge ramp round cove smooth tex' },
            { kind:'tex', name:'border', body:"edge › border runs a band along the mark's edge: a round groove, a V groove, a round bead, a row of beads, a step down, a chamfer, a roundover, a cove, or a plain rim the texture stops short of.", tags:'border band bead beads groove step chamfer roundover cove rim tex' },
            { kind:'tex', name:'border sizes', body:"a border's width, depth and in from edge (how far in it starts) are yours; bead spacing sets the gap in a row of beads. along: where the paint reaches the part's edge, the border can follow it too.", tags:'border width depth in from edge bead spacing along tex' },
            { kind:'tex', name:'floor', body:"more › floor sinks the whole mark first, and the texture is cut on its floor. floor, border and falloff all cut with the raster.", tags:'floor sink sunk recess more tex' },
            { kind:'tex', name:'finish', body:"tex › finish sets how close the raster passes run: smooth and fine take longer, standard leaves ridges sanding takes off, ridged and bold leave the passes showing on purpose.", tags:'finish smooth fine standard ridged bold stepover ridges coarse tex' },
            { kind:'tex', name:'brush', body:"tex › brush paints a mark on a part; hold option (alt) or use erase to take it away. the slider beside it (or [ and ]) makes the brush smaller or larger. the soft edge in the card fades the texture to nothing at the mark's edge.", tags:'brush paint erase eraser mark tex soft edge size' },
            { kind:'tex', name:'mark', body:"in tex, the area of a part to texture. paint it, drag a rectangle (R) or an ellipse (E), or click a region (G): the part's whole top less its holes. a mark moves, turns, scales and copies with its part and is saved with it. arrows slide the picked mark; delete removes it.", tags:'mark region area rectangle ellipse tex move copy saved' },
            { kind:'tex', name:'points', body:"tex › points (H): the picked mark's edge as points on a smooth curve. drag a point and the mark follows it; click the edge to add one; pick points (or drag across them) and press delete to remove them; fewer and more fit it again. painting afterwards fits it again.", tags:'points curve edge handles reshape outline tex mark' },
            { kind:'tex', name:'make it a part', body:"tex › make it a part / make it a hole: the picked mark's outline goes to draw as a new part beside its own (the board's thickness), or is cut through its part (inside: a hole; across the edge: a notch). press done in draw to make it, and the mark goes; cancel and the mark stays.", tags:'make part hole outline mark tex draw cut through notch' },
            { kind:'tex', name:'save as a mesh', body:"tex › save as a mesh: the part with its marks as a closed solid in mm, for rendering (Rendre, Unreason, Blender): its top textured, its pierce cuts through. as designed is each pattern's own surface; as cut is what the bits leave, as simulate shows it. STL, OBJ (smooth normals) or GLB (glTF, in meters); the walls follow the true outline and cuts, and detail sets the grid on the top; the card says how many triangles.", tags:'mesh export stl obj render rendering solid watertight as cut as designed tex' },
            { kind:'tex', name:'pierce', body:"advanced mode: tex's fill can be pierce instead of texture. kerfs: cuts along the bend line at the spacing for the bend radius asked (leave a skin, or right through with bridges); holes: round holes right through on a grid or hex. its own step, after texture and before the outline; auto tabs keep clear of it. every number is a starting point: cut a test strip first. save for the laser writes an svg.", tags:'pierce kerf kerfs bend bendy plywood living hinge holes lattice through laser svg tex advanced' },
            { kind:'tex', name:'blobtex', body:"tex › blobtex: circles of every size that melt into each other. dish carves them in, pillow leaves them raised; puff span is how far in from a blob's edge it takes to reach full depth, so wide blobs puff more than small ones.", tags:'blobtex blob blobs metaball metaballs merge puff pillow dish inflate bubbles organic' },
            { kind:'tex', name:'reaction', body:"tex › reaction grows a reaction-diffusion pattern: spots, maze, worms, coral or cells. growth runs from the first blobs to the whole area; detail is how wide each stripe or spot is; crisp edges sharpens it.", tags:'reaction diffusion turing gray scott spots maze worms coral cells growth detail organic biological' },
            { kind:'tex', name:'patterns', body:"tex's textures: polka dots, dashes & dots, Morse (your words), flutes, knurl, noise, reaction, blobtex, ocean waves, stone wall, basket weave, step & repeat, memphis (an 80s print) and quilted. scale and turn change any of them; depth sets how deep.", tags:'pattern patterns texture reaction diffusion blobtex blob metaball dots morse flutes knurl noise perlin waves stone weave repeat motif memphis 80s quilted tex' },
            { kind:'tex', name:'soft edge', body:"tex › soft edge: how far in from a mark's edge the texture takes to reach its full depth, so it fades out instead of stopping at a wall.", tags:'soft edge fade feather falloff tex' },
            { kind:'tex', name:'texture step', body:"one step per tex mark, before the outline. the bit never goes below the mark's depth or the board, and concerns say when a bit cannot make the pattern. its card (edit ▾) tunes it as any step: the bit, path, finish and stepover are the mark's, the same as in tex, with the step's own step-down, feed and plunge; a stepover typed there makes the finish custom.", tags:'texture step raster tex concerns depth' },
            { kind:'tex', name:'texture bit', body:"a ball bit leaves smooth hollows, a V-bit sharp grooves. each pattern starts with the bit that makes it best: a 90° V-bit for knurl, step & repeat and memphis, the 1/4 in ball for the rest. a bit you pick stays.", tags:'texture bit ball v-bit vbit tex' },
            { kind:'tex', name:'texture path', body:"a texture step's path: raster passes, cross-hatch, one plunge per dot, or along each groove's center. each pattern starts with the path that suits it best, unless you pick one.", tags:'path raster crosshatch cross-hatch plunge centerline texture tex' },
            { kind:'draw', name:'fonts', body:"draw › text › font: the built-in Russo One, this computer's fonts (Chrome and Edge ask first), or a .ttf or .otf file. each word keeps its own font.", tags:'font fonts text typeface system local draw' },
            { kind:'app', name:'shape', body:'a circle, rectangle, ring, polygon, star or slot, with a thickness.', tags:'shape circle rectangle ring polygon star slot' },
            { kind:'app', name:'modes', body:'cam, draw, tex and control. cam makes the steps, draw makes shapes, tex marks and textures them, control runs the machine. in draw, tex or control the step row folds to those four.', tags:'modes mode cam draw tex control' },
            { kind:'app', name:'size card', body:'pick a part and the size card shows its width, length and thickness. if they do not match your drawing, type the right size in the card.', tags:'size card width length height thickness scale resize dimensions' },
            { kind:'app', name:'steps', body:'the steps panel on the left: the material, the bits, then each step in the order it cuts. click a step to change its numbers.', tags:'steps step list panel left operations ops toolpaths' },
            { kind:'app', name:'add a step', body:'steps › add a step puts rough, contour, outline or pocket at the end of the list. advanced adds level, drill and trace.', tags:'add a step new step operation rough contour outline pocket' },
            { kind:'app', name:'bits', body:'steps › bits opens the bit library: the shop\'s bits and their sizes, and any bit you add.', tags:'bits bit tool library tools endmills end mills cutters' },
            { kind:'app', name:'toolpaths', body:'toolpaths, in the step row, makes the paths the bit will follow for every step and draws them on the bed. check them, then simulate.', tags:'toolpaths toolpath paths make generate preview step row' },
            { kind:'app', name:'clear', body:'clear, in the step row, wipes the toolpaths and the simulation off the bed. the steps stay; press toolpaths to make the paths again.', tags:'clear wipe reset paths simulation step row' },
            { kind:'app', name:'concerns', body:'the concerns tab, with its count, flags setup problems before you cut, each with what to do about it. click it to open the list.', tags:'concerns warning warnings problems check setup' },
            { kind:'app', name:'advanced', body:'view › advanced shows tools still in alpha: more steps (level, drill, trace), stock size, machine limits and more fields on each step. most jobs never need it.', tags:'advanced expert alpha more tools options' },
            { kind:'app', name:'reset profile', body:'help › reset profile starts swarf over on this computer: every setting, bit and part goes, and it reloads as new. a project saved as a .swarf file is kept.', tags:'reset profile start over clear settings fresh reload' },
            { kind:'app', name:'version', body:'the build number sits at the bottom right, always. tap it to update to the latest build: swarf clears its cache and reloads.', tags:'version build number update latest reload badge' },
            { kind:'app', name:'zero at', body:'where X 0, Y 0 sits on the stock: its front-left corner (the default), or its center for something round. you put the bit on that spot before you cut.', tags:'zero origin corner center center round x0 y0' },
            { kind:'app', name:'skin', body:'view › skin: wet plastic (default), classic, swarf.', tags:'skin theme look glass classic' },
            { kind:'op', name:'auto tabs', body:'tabs › auto tabs: a starting set of tabs sized for the material, the bit, the board and the machine. how many: fewer to more; size: smaller to larger. the press places them at once, as ordinary tabs: there is no apply. click a tab to move, resize or delete it; undo or remove all takes them back.', tags:'auto tabs bridges hold parts cutout outline' },
            { kind:'op', name:'move a tab', body:'click a tab to pick it: drag it along the edge, press delete to remove it, or change its length, height and reach in its card. a tab you moved or resized stays as you set it when auto tabs are placed again (back to automatic lets go); where you deleted one stays empty. remove all starts over. undo takes back each change.', tags:'move tab drag tab delete tab remove tab resize tab pick tab single tab pinned back to automatic no tab here' },
            { kind:'op', name:'tab settings', body:'tabs: every number is a field — length, height, reach, count, from corners, hold inside pieces, holes from, in each hole. empty = automatic (gray); type a value to pin it. tabs follow their part: change a field, scale the part, or change the material, bit or machine, and they are placed again. all automatic empties them.', tags:'tab settings length height reach how many count corners holes pinned automatic parametric tab size' },
            { kind:'op', name:'loose pieces', body:'an outline that cuts through frees the part, and the piece inside every hole it cuts. with no tab it can catch the bit and fly. concerns and the cut checklist name each one; auto tabs hold them (hold inside pieces), or screw them down where the bit does not go. never reach in while the router turns.', tags:'loose pieces cut free through no tabs fly thrown slug hole inside piece retain hold down screw' },
            { kind:'run', name:'windows', body:'control runs in Chrome or Edge on Windows too. quit ShopBot 3 first: the box takes one program at a time. press disconnect (or close the tab) before going back to ShopBot 3. if Chrome lists no port for the box, check the box is on and its cable in, quit ShopBot 3, and press connect again.', tags:'windows pc com port com3 shopbot 3 chrome edge one program driver' },
            { kind:'run', name:'windows laptop', body:'your own Windows laptop (no ShopBot software): give the box a driver once with Zadig (zadig.akeo.ie): Options › List All Devices, pick V204ShopBot (USB ID 10C4 83C4), set WinUSB, Replace Driver. never on a PC that runs ShopBot 3.', tags:'windows laptop zadig winusb driver student usb' },
            { kind:'run', name:'disconnect', body:'lets go of the box (outputs off), so another program can use it. connect again and swarf offers to keep your zero.', tags:'disconnect release box com port shopbot 3 reconnect' },
            { kind:'run', name:'e-stop', body:'the red floor button. swarf stops the machine at once, switches the router off and lets go of it; press connect when the machine is safe. machine setup\'s that\'s the e-stop sets which input it is on.', tags:'e-stop emergency stop red button floor input disconnect safety' },
            { kind:'run', name:'router test', body:'the small router button in the jog pad: asks first, sounds a warning, then runs the router until you press it again, any key, the e-stop or 60 s. nothing moves while it runs.', tags:'router test spindle on off button red' },
            { kind:'run', name:'feed override', body:'while a job runs: −5% / +5% from 50 to 150 %, on cutting moves only, never past the machine\'s top speed. each job starts at 100 %.', tags:'feed override speed faster slower percent 5' },
            { kind:'app', name:'inches', body:'mm | in at the top left (or setup › preferences › units) switches every number swarf shows, control\'s jog step, speed and position too. type 3/4, 1 1/2\", 0.75 in or 19 mm in any length field. control runs .sbp files written in inches.', tags:'inches inch mm units fraction convert' },
            { kind:'app', name:'save project (.swarf)', body:'files › save project (.swarf), or ⌘S: one file with the parts, drawings, tex marks, tabs, steps, board, material, bits, machine and units. the machine zero never goes in it: a reopened job asks for its zero.', tags:'save project swarf file keep everything cmd-s' },
            { kind:'app', name:'open project', body:'drop a .swarf file on the bed, use files › open project, or double-click it once swarf is installed. a bit or machine this computer lacks is added, and swarf says so.', tags:'open project swarf file another computer drag drop double-click' },
            { kind:'app', name:'.swarf or .kmz', body:'.swarf keeps everything; .kmz opens in Kiri:Moto. files › save for Kiri:Moto (.kmz) writes the parts, machine and steps as Kiri:Moto reads them, less the tex steps (Kiri:Moto has no texture step). a skin, sounds and other choices of this computer stay on it, in both.', tags:'kmz kiri moto export workspace swarf file which' },
            { kind:'app', name:'the shop\'s bits', body:'1/4 straight 48-005, 1/4 up-cut 52-910, 1/4 down-cut 57-910, 1/2 straight 48-072, in bits. in wood they cut with the shop\'s own numbers (120 in/min, 1/8 in a pass, 12,000 rpm).', tags:'bits tools shop upcut downcut straight part number feeds' },
            { kind:'run', name:'keep the zero', body:'a zero you set is kept across files, test cuts, a reconnect or a reload: one press of use the zero you set takes it back, no re-zeroing. it is dropped after a bit change or a box restart.', tags:'zero keep reuse reload reconnect' },
            { kind:'run', name:'search down', body:'on the z plate card: how far the bit comes down looking for the plate, 60 mm unless you raise it.', tags:'z plate search down distance touch off' },
            { kind:'app', name:'undo', body:'edit › undo, or ⌘Z (Ctrl+Z): takes back the last change to the parts, tabs or steps, a delete too. edit › redo, or ⇧⌘Z, puts it back.', tags:'undo redo take back cmd-z ctrl-z mistake edit menu' },
            { kind:'app', name:'select all', body:'edit › select all, or ⌘A: picks every part on the bed, to move, size or delete them together. edit › delete, or the delete key, removes the picked parts (undo brings them back); with nothing picked it does nothing.', tags:'select all pick every part delete edit menu cmd-a' },
            { kind:'app', name:'export', body:'export (in the row, or file › export the machine file) makes the file the machine runs: name it, read how long it takes, how big it is, which bit and which material, and press save name.sbp. also save the project (.swarf) keeps the parts and steps to open again.', tags:'export save sbp file machine file gcode shopbot file' },
            { kind:'app', name:'simulate', body:'watch the bit cut the board before the machine does. space plays and pauses; speed × runs it faster (1 is the machine\'s own speed); done says how much of the cut has run.', tags:'simulate simulator simulation play pause speed done preview' },
            { kind:'app', name:'step boxes', body:'in simulate, the checkbox beside each step shows or hides that step\'s paths.', tags:'step boxes checkbox checkboxes show hide paths each step simulate simulator' },
            { kind:'app', name:'machine view', body:'simulate › machine shows the ShopBot around the board as it cuts. bed slides on: the bed slides under the gantry, as on the shop\'s ShopBot; off: the bed holds still and the gantry moves.', tags:'machine view bed slides gantry shopbot simulate simulator' },
            { kind:'app', name:'chips', body:'simulate › chips throws chips off the bit as it cuts and leaves them on the bed, tinted by the material.', tags:'chips dust sawdust simulate simulator' },
            { kind:'app', name:'lightstreams', body:'simulate › lightstreams draws a red ribbon behind the bit, so you can see where it has been.', tags:'lightstreams lightstream ribbon trail red path simulate simulator' },
            { kind:'app', name:'view', body:'cam: F fits the parts in view. drag turns the view, shift-drag (or right-drag) pans, and the wheel zooms toward the cursor.', tags:'view fit zoom pan orbit turn rotate mouse wheel camera f key' },
            { kind:'app', name:'keys', body:'⌘Z undo, ⇧⌘Z redo, ⌘A select all, ⌘S save project, delete removes the picked parts, F fits them in view. tab walks the menus and the step row; enter or space presses. in draw and tex, hover a tool to see its key.', tags:'keys keyboard shortcuts tab focus enter space' },
            { kind:'op', name:'rough', body:'the first pass: it clears most of the wood in flat layers above the part, fast and deep, and leaves a little for contour to finish.', tags:'roughing clearing bulk first pass' },
            { kind:'op', name:'contour', body:'a smooth pass over a curved top after rough: the bit runs back and forth in one direction at a fine stepover, following the surface. 5–15 % of the bit\'s width is typical.', tags:'contouring finishing surface curved' },
            { kind:'op', name:'outline', body:"cuts the part free from the board along its outside edge. usually the last step. add tabs so the part doesn't fly out.", tags:'outline cutout silhouette' },
            { kind:'op', name:'pocket', body:'clears flat-bottomed hollows: trays, recesses, a sunk hole. pick the floor face and swarf clears down to it, inside its walls.', tags:'pocket cavity tray' },
            { kind:'param', name:'stepover', body:'how far the bit moves sideways between passes, as a share of its width: the step card says 40 % of bit. swarf starts wood, foam and plastic at 30–45 %. wider cuts faster and works the bit harder.', tags:'stepover sideways pass spacing percent of bit' },
            { kind:'param', name:'step-down', body:'how deep each pass cuts, in mm or inches as mm | in says (type 1/8 or 3 mm). swarf keeps every preset under half the bit\'s width, which is careful for wood. deeper than the bit is wide and its flutes cannot clear the chips.', tags:'depth of cut step down stepdown doc layer pass' },
            { kind:'param', name:'feed rate', body:'how fast the bit moves through the wood: mm/min, or in/min when mm | in says in. when in doubt: slower is safer.', tags:'feed feedrate mm/min in/min cutting speed' },
            { kind:'param', name:'plunge rate', body:'how fast the tool drives down into material. usually 30–50% of feed rate. too fast snaps end-mills.', tags:'plunge plungerate descent' },
            { kind:'param', name:'spindle speed', body:'RPM of the cutter. it follows the material and the tool width, not a fixed number — a wider tool at the same RPM cuts faster at its edge, so it has to slow down. the MR-1 tops out at 8000. on the ShopBot the router is set by hand on its dial, 1 (10,000 rpm) to 5 (21,000); the cut card names the setting the file asks for.', tags:'spindle rpm cutter speed' },
            { kind:'param', name:'ease down', body:'ramp into the cut at an angle instead of plunging straight down. easier on the tool, especially for end-mills with no center cut. on by default, and the material sets the angle: a shallow one for hard wood, up to 10 degrees for foam.', tags:'ease down ramp helix descent' },
            { kind:'param', name:'depth first', body:'advanced: cut each area to its full depth before moving to the next, instead of one layer across every area at a time.', tags:'depth first order strategy advanced' },
            { kind:'param', name:'tab', body:"small uncut bridge of stock that holds the part during the outline cut so it doesn't shift or fly out. break/sand off after.", tags:'tab tabs holding bridge' },
            { kind:'param', name:'material', body:'what you are cutting. the material row at the top of steps sets the feed, plunge, speed, step-down, stepover and ramp angle for every step, and tints the board and chips. its numbers are careful starting points.', tags:'material stock feeds speeds preset palette' },
            { kind:'param', name:'stock', body:'the board on the machine\'s bed. swarf sizes it to the parts; advanced lets you size it yourself.', tags:'stock material block bed' },
            { kind:'param', name:'z top / z bottom', body:'advanced: the top and bottom heights the steps cut between.', tags:'z top bottom bounds height advanced' },
            { kind:'param', name:'z clearance', body:'advanced: how high the bit lifts above the board between cuts. high enough to clear screws and clamps; low enough not to waste time.', tags:'z clearance retract rapid lift advanced' },
            { kind:'tool', name:'end-mill', body:'a flat-bottomed bit, the workhorse (the step card calls it end, as in end 1/4). fewer flutes clear chips better in wood and plastic; the shop\'s ShopBot bits are 2-flute.', tags:'endmill flat cutter mill flutes' },
            { kind:'tool', name:'ball-end', body:'spherical tip. for 3D contour finishing on curved surfaces. leaves a cusp pattern proportional to stepover.', tags:'ballend spherical 3d finishing' },
            { kind:'tool', name:'v-bit', body:'conical cutter for engraving and chamfering. depth controls the line width.', tags:'vbit cone engraving chamfer' },
            { kind:'tool', name:'drill', body:'plunges straight down to make holes. the drill step is in advanced.', tags:'drill hole plunge advanced' },
            { kind:'coach', name:'why rough before contour', body:"rough clears the easy bulk first at a deep stepdown. then contour finishes the surface at a fine stepover. one operation can't do both jobs efficiently.", tags:'order strategy rough contour finishing' },
            { kind:'coach', name:'why stepover matters', body:'stepover sets surface finish. wide stepover = scallops between passes (rough texture). narrow stepover = smoother but slower.', tags:'stepover finish quality scallop' },
            { kind:'coach', name:'feeds and speeds', body:'rule of thumb: chip load × flutes × rpm = feed rate. use a chip load chart for your material/diameter or err slow.', tags:'feeds speeds chip load rpm' },
            { kind:'coach', name:'how to keep the part in place', body:'add tabs in the outline operation, or use double-sided tape, vacuum hold-down, or screw clamps for soft sheet stock.', tags:'workholding tabs clamping fixture' }
        ];
        function render(query) {
            const q = (query || '').trim().toLowerCase();
            // a name match beats a tag match beats a body match (review 10-30 C4: "tex" listed
            // draw first, "tab" table corners); ties keep the index's order
            // (review r093 H5) a whole-word name match beats a part-word one ("tab" listed table
            // corners second); an advanced-only entry gives way to a student's tag match ("first"
            // gave depth first over the quick start) unless its name is the whole query
            const wordIn = (s, w) => ` ${s.replace(/[^a-z0-9.'-]+/g, ' ')} `.includes(` ${w} `);
            const score = e => {
                const n = e.name.toLowerCase();
                if (n === q) return 100;
                const adv = e.body.startsWith('advanced') ? 45 : 0;
                if (wordIn(n, q)) return (n.startsWith(q) ? 85 : 75) - adv;
                if (n.startsWith(q)) return 60 - adv;
                if (n.includes(q)) return 50 - adv;
                const t = ` ${e.tags.toLowerCase()} `;
                if (t.includes(` ${q} `)) return 40;
                if (t.includes(q)) return 20;
                return e.body.toLowerCase().includes(q) ? 1 : 0;
            };
            // a student's own words (deep review S15: "my part moved", "stuck", "mm to inches" found
            // nothing): when the phrase is in no entry, each word counts, read as the app says it
            const SAY = { moved: 'move', moving: 'move', drag: 'move', dragged: 'move', stuck: 'pause', frozen: 'pause', jammed: 'reset',
                inches: 'units', inch: 'units', millimeters: 'units', convert: 'units', metric: 'units', imperial: 'units',
                undo: 'undo', back: 'undo', clamp: 'tabs', hold: 'tabs', loose: 'tabs', fly: 'tabs', speed: 'feed', fast: 'feed', slow: 'feed',
                deep: 'depth', depth: 'step-down', zero: 'zero', origin: 'zero', start: 'zero', save: 'save', bend: 'pierce', kerf: 'pierce',
                pattern: 'texture', carve: 'texture', engrave: 'engrave', text: 'text', letters: 'text', bit: 'bit', router: 'router', estop: 'e-stop' };
            const STOP = new Set(['my', 'the', 'a', 'an', 'to', 'is', 'it', 'of', 'in', 'on', 'how', 'do', 'i', 'why', 'what', 'and', 'or', 'mm', 'for', 'with', 'can', 'cant', "can't", 'wont', "won't"]);
            const words = q.split(/[^a-z0-9-]+/).filter(w => w.length > 1 && !STOP.has(w)).map(w => SAY[w] || w);
            const scoreAll = e => score(e) || (words.length > 1 || words[0] !== q ? words.reduce((t, w) => t + (q === w ? 0 : scoreWord(e, w)), 0) : 0);
            const scoreWord = (e, w) => {
                const n = e.name.toLowerCase(), t = ` ${e.tags.toLowerCase()} `;
                return n.includes(w) ? 30 : t.includes(` ${w} `) ? 20 : t.includes(w) ? 8 : e.body.toLowerCase().includes(w) ? 1 : 0;
            };
            const matches = !q ? INDEX : INDEX.map((e, i) => ({ e, i, s: scoreAll(e) })).filter(x => x.s > 0)
                .sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.e);
            if (matches.length === 0) {
                results.innerHTML = '<div class="swarf-help-empty"><p>no matches.</p><p>try a control name, a parameter, or a phrase like &ldquo;why rough&rdquo;.</p></div>';
                return;
            }
            results.innerHTML = matches.map(e =>
                `<div class="swarf-result"><span class="swarf-result-kind ${e.kind}">${({ app: 'swarf', run: 'control', op: 'step', param: 'setting', coach: 'how to', tool: 'bit' })[e.kind] || e.kind}</span><strong>${e.name}</strong><p>${e.body}</p></div>`
            ).join('');
        }
        input.addEventListener('keyup', () => render(input.value));
        render('');
    })();

    $('file-new').onclick = (ev) => { ev.stopPropagation(); settingsOps.new_workspace() };
    // swarf: .swarf projects (web/kiri/swarf-file.js), loaded here too when a page's own index lacks the tag
    if (!self.SwarfFile && !document.querySelector('script[src*="swarf-file.js"]')) {
        const s = document.createElement('script'); s.src = 'swarf-file.js'; document.body.appendChild(s);
    }
    $('file-recent').onclick = () => { api.modal.show('files') };
    $('file-import').onclick = (ev) => { api.event.import(ev); };
    $('view-top').onclick = space.view.top;
    $('view-home').onclick = space.view.home;

    $('unrotate').onclick = () => {
        api.widgets.for(w => w.unrotate());
        selection.update_info();
    };

    // attach button handlers to support targets
    for (let btn of ["don8pt","don8gh","don8pp"]) {
        $(btn).onclick = (ev) => {
            window.open(ev.target.children[0].href);
        }
    }

    // rotation buttons
    let d = (Math.PI / 180);
    $('rot_x_lt').onclick = () => { selection.rotate(-d * $('rot_x').value,0,0) };
    $('rot_x_gt').onclick = () => { selection.rotate( d * $('rot_x').value,0,0) };
    $('rot_y_lt').onclick = () => { selection.rotate(0,-d * $('rot_y').value,0) };
    $('rot_y_gt').onclick = () => { selection.rotate(0, d * $('rot_y').value,0) };
    $('rot_z_lt').onclick = () => { selection.rotate(0,0, d * $('rot_z').value) };
    $('rot_z_gt').onclick = () => { selection.rotate(0,0,-d * $('rot_z').value) };

    // rendering options
    $('render-edges').onclick = () => {
        api.view.set_edges({ toggle: true });
        api.conf.save()
    };
    $('render-ghost').onclick = () => {
        const opacity = api.view.is_arrange() ? 0.4 : 0.25;
        api.view.set_wireframe(false);
        api.visuals.set_opacity(opacity);
        // Also save to old key for backwards compatibility
        api.local.set('model.wireframe.opacity', opacity);
        api.conf.save();
    };
    $('render-wire').onclick = () => {
        api.view.set_wireframe(true, 0, api.space.is_dark() ? 0.25 : 0.5);
        api.visuals.set_opacity(0.25);
        api.conf.save();
    };
    $('render-solid').onclick = () => {
        api.view.set_wireframe(false);
        api.visuals.set_opacity(1.0);
        // Also save to old key for backwards compatibility
        api.local.set('model.wireframe.opacity', 1.0);
        api.conf.save();
    };
    $('mesh-export-stl').onclick = () => { settingsOps.export_objects('stl') };
    $('mesh-export-obj').onclick = () => { settingsOps.export_objects('obj') };
    $('mesh-merge').onclick = selection.merge;
    $('mesh-split').onclick = selection.isolateBodies;
    $('context-duplicate').onclick = selection.duplicate;
    $('context-mirror').onclick = selection.mirror;
    // swarf r14+: move panel wiring. Mirrors rotate-panel: chevrons translate
    // by the value in the input; 'center' zeros XY so the widget snaps to
    // platform center. Move defaults to 10mm per click (vs rotate's 90°).
    if ($('context-move-panel')) {
        $('context-move-panel').onclick = () => toggleSelectionPanel('panel-move');
        $('panel-move-close').onmousedown = (ev) => { ev.stopPropagation(); };
        $('panel-move-close').onclick = (ev) => { ev.stopPropagation(); hideSelectionPanel('panel-move'); };
        // (Phil 11-01) the step is a length in the cam units (3/4, 1/2 in, 10 mm); it keeps its length
        // when the units change; one swarf cannot read, or past the bed, moves nothing
        const movL = self.SwarfLength;
        const movMm = id => {
            const el = $(id), mm = movL ? movL.parse(el.value) : parseFloat(el.value);
            const dev = api.conf.get().device || {}, top = Math.max(dev.bedWidth || 0, dev.bedDepth || 0) || Infinity;
            if (!(mm > 0 && mm <= top)) {
                api.show.alert(`A move step is a length above 0${top < Infinity ? `, up to ${movL ? movL.say(top) : top + ' mm'}` : ''}, like 1/2 in or 10 mm.`, 5);
                if (el.dataset.mm) el.value = movL ? movL.show(+el.dataset.mm) : el.dataset.mm;
                return 0;
            }
            el.dataset.mm = mm;
            return mm;
        };
        for (const id of ['mov_x', 'mov_y']) {
            const el = $(id);
            el.dataset.mm = 10;
            el.title = `${id === 'mov_x' ? 'X' : 'Y'} step: a length like 1/2 in or 10 mm`;
            el.addEventListener('keydown', ev => ev.stopPropagation());
            el.addEventListener('change', () => movMm(id));
        }
        api.event.on('units.set', () => { for (const id of ['mov_x', 'mov_y']) { const el = $(id); if (el && movL) el.value = movL.show(+el.dataset.mm || 10); } });
        if (movL && movL.unit() === 'in') for (const id of ['mov_x', 'mov_y']) $(id).value = movL.show(10);
        $('mov_x_lt').onclick = () => { selection.move(-movMm('mov_x'), 0, 0); };
        $('mov_x_gt').onclick = () => { selection.move( movMm('mov_x'), 0, 0); };
        $('mov_y_lt').onclick = () => { selection.move(0, -movMm('mov_y'), 0); };
        $('mov_y_gt').onclick = () => { selection.move(0,  movMm('mov_y'), 0); };
        $('mov_center').onclick = () => {
            // absolute move to platform origin (0,0,0). widget.move with abs=true
            // places the widget AT that world position rather than adding.
            try {
                const widgets = api.selection.widgets(true);
                if (widgets.length) {
                    const w = widgets[0];
                    selection.move(-w.track.pos.x, -w.track.pos.y, 0);
                }
            } catch (e) {}
        };
    }
    $('context-rotate-panel').onclick = () => toggleSelectionPanel('panel-rotate');
    $('context-scale-panel').onclick = () => toggleSelectionPanel('panel-scale');
    $('panel-rotate-close').onmousedown = (ev) => { ev.stopPropagation(); };
    $('panel-scale-close').onmousedown = (ev) => { ev.stopPropagation(); };
    $('panel-rotate-close').onclick = (ev) => { ev.stopPropagation(); hideSelectionPanel('panel-rotate'); };
    $('panel-scale-close').onclick = (ev) => { ev.stopPropagation(); hideSelectionPanel('panel-scale'); };
    $('context-layflat').onclick = view_tools.startLayFlat;
    $('context-lefty').onclick = view_tools.startLeftAlign;
    $('context-setfocus').onclick = () => {
        view_tools.startFocus(ev => api.space.set_focus(undefined, ev.object.point));
    };
    // $('context-contents').onclick = api.const.SPACE.view.fit;
    $('view-fit').onclick = () => (api.frame ? api.frame() : api.const.SPACE.view.fit());
    // swarf: 'wassup'/'suppopp' GridSpace support-dev element removed from mod-help; skip binding

    if ($('panel-move')) makePanelDraggable('panel-move', 'panel-move-head', 'win.move');
    makePanelDraggable('panel-rotate', 'panel-rotate-head', 'win.roate');
    makePanelDraggable('panel-scale', 'panel-scale-head', 'win.scale');

    // enable modal hiding
    $('mod-x').onclick = api.modal.hide;


    // fix file input on iOS
    try {
        if (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
                $('load-file').removeAttribute('accept');
            }
    } catch (e) {
        console.log('iOS remediation fail', e);
    }
}
