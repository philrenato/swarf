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
    if (api.feature.work_alerts && !window.SharedArrayBuffer) {
        api.alerts.show("The security context of this", 10);
        api.alerts.show("Window blocks important functionality.", 10);
        api.alerts.show("Try a Chromium-base Browser instead", 10);
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
        api.show.alert('<b style="color:red">caution:</b> beta code ahead', 10);
        sdb.kiri_beta = beta;
    }

    // warn users they are using a development server
    let devwarn = sdb.kiri_dev;
    if (location.host === 'dev.grid.space' && devwarn !== version) {
        api.alerts.show('this is a development server', 10);
        api.alerts.show('use <a href="https://grid.space/kiri">grid.space</a> for production', 10);
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
        ui.acct.export.title = LANG.acct_xpo;
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
    const helpConc = $('swarf-concordance');
    if (helpConc) helpConc.onclick = (ev) => { ev.stopPropagation(); api.modal.show('swarf-concordance'); };
    const helpReset = $('swarf-reset-profile');
    if (helpReset) helpReset.onclick = (ev) => {
        ev.stopPropagation();
        if (confirm('Reset swarf to factory defaults? This clears all saved settings and reloads.')) {
            if (window.__swarfResetProfile) window.__swarfResetProfile();
        }
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
    })();

    // swarf r44 (review 10-28 #7): one camera rule. The view frames all the parts with one
    // margin, and moves only when it has to: a part arrives off screen or onto an empty
    // bed, or a project loads. Deleting, duplicating beside, or redrawing in place leaves
    // the camera where the student put it; an emptied bed goes home.
    (function(){
        const FILL = 1.0;            // space.view.fit padding: the parts span about a third of the view
        const meshes = () => (api.widgets.all() || []).map(w => w.mesh).filter(Boolean);
        const inView = list => {
            const cam = space.internals && space.internals().camera;
            if (!cam) return false;
            cam.updateMatrixWorld();
            const box = new THREE.Box3();
            for (const m of list) { try { m.geometry && m.geometry.computeBoundingBox(); } catch (e) {} box.expandByObject(m); }
            if (box.isEmpty()) return true;
            const v = new THREE.Vector3();
            for (let i = 0; i < 8; i++) {
                v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(cam);
                if (Math.abs(v.x) > 0.9 || Math.abs(v.y) > 0.9 || v.z > 1) return false;
            }
            return true;
        };
        const frame = () => {
            try { space.event.onResize(); } catch (e) {}
            try { api.platform.update_bounds(); } catch (e) {}
            try {
                const all = meshes();
                for (const m of all) { try { m.geometry && m.geometry.computeBoundingBox(); } catch (e) {} }
                if (space.view.fit && all.length) space.view.fit(undefined, { padding: FILL, visibleOnly: true, objects: all });
                else bed();
            } catch (e) {}
        };
        // an empty bed: the home angle, framing the whole bed (review 10-28b #14)
        const bed = () => {
            const plat = space.internals && space.internals().platform;
            space.view.home();
            if (plat && space.view.fit) setTimeout(() => { try { if (!meshes().length) space.view.fit(undefined, { padding: 0.75, objects: [plat] }); } catch (e) {} }, 380);
        };
        api.frame_bed = bed;
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
        apply(localStorage.getItem(key) === '1');
        const tog = $('swarf-expert-toggle');
        if (tog) tog.onclick = (ev) => {
            ev.stopPropagation();
            const next = document.body.classList.contains('swarf-expert') ? 0 : 1;
            localStorage.setItem(key, String(next));
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
            <div id="swarf-concerns-tab" title="rule-based setup warnings — click to expand">
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

        // rule engine: pull current settings + ops, evaluate each rule, render warnings
        function evaluate() {
            const warnings = [];
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
                            body: `plunging at ${op.plunge} mm/min vs feed ${op.rate} mm/min — the palette holds plunge at 30–40% of feed.`,
                            hint: 'too fast a plunge snaps end-mills'
                        });
                    }
                    // rule 3 — step-down past half the tool diameter, the palette's ceiling
                    if (op.down && td && op.down > td * 0.5) {
                        warnings.push({
                            title: `step-down over half the tool diameter`,
                            body: `${op.down.toFixed(2)} mm step-down on a ${td.toFixed(2)} mm tool — the palette stays under ${(td / 2).toFixed(2)} mm.`,
                            hint: 'split into shallower passes for safer cutting'
                        });
                    }
                    // rule 4 — cutting speed past the material's HSS figure: the
                    // machine's spindle floor (ShopBot 9000) or a hand-typed rpm
                    const mat = window.__swarfMaterial;
                    const vcMax = mat && mat.cut && mat.cut.vc;
                    if (vcMax && op.spindle && td) {
                        const vc = Math.PI * td * op.spindle / 1000;
                        if (vc > vcMax * 1.5) {
                            warnings.push({
                                title: `spindle too fast for HSS in ${mat.name}`,
                                body: `${vc.toFixed(0)} m/min cutting speed at ${op.spindle} rpm on a ${td.toFixed(2)} mm tool — HSS in ${mat.name} wants ${vcMax}.`,
                                hint: 'carbide, a smaller tool, or a slower spindle'
                            });
                        }
                    }
                }
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
                        body: `${sx.toFixed(0)} × ${sy.toFixed(0)} mm; the bed is ${bw.toFixed(0)} × ${bd.toFixed(0)} mm. The machine cannot cut it as it is.`,
                        hint: 'make it smaller, or choose the other machine (setup › machine)' });
                    else if (bw && bd && (p.x + b.min.x < -bw / 2 - 0.5 || p.x + b.max.x > bw / 2 + 0.5 || p.y + b.min.y < -bd / 2 - 0.5 || p.y + b.max.y > bd / 2 + 0.5)) warnings.push({
                        title: `${name} hangs off the bed`,
                        body: `part of it sits outside the ${mach}'s ${bw.toFixed(0)} × ${bd.toFixed(0)} mm bed.`,
                        hint: 'drag it back onto the bed' });
                    // the shop's ShopBot rule (KCAD guidelines): boards from 1/4 to 2 1/2 in; thinner goes to the laser
                    if (soft && (sz < 6.35 - 0.05 || sz > 63.5 + 0.05)) warnings.push({
                        title: `${name} is ${sz.toFixed(1)} mm thick`,
                        body: sz < 6.35 ? 'the ShopBot takes boards from 1/4 in (6.35 mm) up. Thinner sheet goes to the laser.' : 'the ShopBot takes boards up to 2 1/2 in (63.5 mm) thick.',
                        hint: sz < 6.35 ? 'use the laser for thin sheet' : 'ask the technician about thicker stock' });
                }
            } catch (e) { /* no device yet */ }
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
            body.innerHTML = warnings.map(w =>
                `<div class="swarf-concern"><strong>${w.title}</strong>${w.body}<em>${w.hint}</em></div>`
            ).join('');
        }
        evaluate();
        // re-evaluate on settings + op changes
        // conf.save emits settings.saved on every op add/edit; the material
        // system emits cam.op.render after a re-derive
        ['settings','settings.saved','cam.op.render','widget.add','widget.delete','device.selected','selection.move','selection.scale','selection.drag']
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
            { kind:'shop', name:'ShopBot quick start', body:'help › ShopBot quick start walks from a drawing to a cut part in ten steps, as on the shop poster, with a show me on the steps swarf can open for you.', tags:'quick start tutorial first time poster steps shopbot how to' },
            { kind:'shop', name:'permission', body:"the ShopBot runs with a faculty member or the technician's say-so. ask before you start.", tags:'permission faculty technician rules kcad shop' },
            { kind:'shop', name:'your board', body:'bring your own board, flat and labeled with your name, with extra for a test cut. 1/4 to 2 1/2 in thick, up to 4 × 8 ft; thinner sheet goes to the laser.', tags:'board material thickness size laser kcad' },
            { kind:'shop', name:'your drawing', body:'closed outlines only, and no doubled lines on top of each other: swarf cuts every line it is given.', tags:'closed paths duplicate lines drawing kcad' },
            { kind:'shop', name:'protection', body:'safety glasses and hearing protection on, dust collection on, hair and sleeves back.', tags:'safety glasses hearing dust kcad' },
            { kind:'shop', name:'the floor e-stop', body:'the red button on the floor, pressed with your foot. in an emergency, step on it and keep clear until everything has stopped.', tags:'e-stop emergency stop floor foot kcad' },
            { kind:'shop', name:'hours', body:'the ShopBot runs when the woodshop is open; check its hours.', tags:'hours woodshop open kcad' },
            { kind:'run', name:'control', body:'drives the ShopBot from swarf over its USB cable, in Chrome or Edge only. jog, zero, trace, air cut, cut. only shows when the ShopBot is the machine; the MR-1 uses export.', tags:'control shopbot usb run machine chrome edge' },
            { kind:'run', name:'trace / air cut / cut', body:'each one opens a checklist first. trace runs the outline of the cut, router off; an air cut runs the whole file above the board; cut starts the router. a button that is waiting tells you what it still needs.', tags:'trace air cut run checklist' },
            { kind:'run', name:'jog', body:'moves at once, by the step you pick. go-to buttons and home ask first. space or esc stops; while a job runs, any key pauses it.', tags:'jog move step keys arrows' },
            { kind:'run', name:'table corners', body:"no home switches on this machine: put the bit over the table's front-left corner once and swarf learns it until the machine is switched off. then zero at, or go to, the front-left or front-right corner.", tags:'table corner absolute zero front left right' },
            { kind:'run', name:'z plate', body:'finds the top of the board by touching the bit to a metal plate. put the plate and its clip away before you cut.', tags:'z plate touch off zero height' },
            { kind:'run', name:'router', body:'Porter-Cable 7518. swarf only switches it on and off; set its speed on its dial, 1 (10,000 rpm) to 5 (21,000).', tags:'router spindle porter cable dial rpm' },
            { kind:'run', name:'test cut', body:'learn the machine on scrap plywood. the square and the circle: a groove you measure with calipers. cut out a square: a part held by tabs.', tags:'test cut training lesson calibrate measure' },
            { kind:'run', name:'draw', body:'the bed seen from above. pen, rectangle, ellipse, text; move points; give it a thickness and a top edge. done or switching mode keeps your changes; cancel drops them.', tags:'draw pen rectangle ellipse text points' },
            { kind:'run', name:'shape', body:'a circle, rectangle, ring, polygon, star or slot, with a thickness.', tags:'shape circle rectangle ring polygon star slot' },
            { kind:'run', name:'modes', body:'cam, draw and control. in draw or control the step row folds to those three.', tags:'modes cam draw control' },
            { kind:'run', name:'zero at', body:'where X 0, Y 0 sits on the stock: its front-left corner (the default), or its center for something round. you put the bit on that spot before you cut.', tags:'zero origin corner center center round x0 y0' },
            { kind:'run', name:'skin', body:'view › skin: wet plastic (default), classic, swarf.', tags:'skin theme look glass classic' },
            { kind:'op', name:'auto tabs', body:'tabs › auto tabs: a starting set of tabs sized for the material, the bit, the board and the machine. how many: fewer to more; size: smaller to larger. apply makes ordinary tabs you can still remove or add to by hand.', tags:'auto tabs bridges hold parts cutout outline' },
            { kind:'run', name:'windows', body:'control runs in Chrome or Edge on Windows too. quit ShopBot 3 first: the box takes one program at a time. press disconnect (or close the tab) before going back to ShopBot 3. if Chrome lists no port for the box, check the box is on and its cable in, quit ShopBot 3, and press connect again.', tags:'windows pc com port com3 shopbot 3 chrome edge one program driver' },
            { kind:'run', name:'windows laptop', body:'your own Windows laptop (no ShopBot software): give the box a driver once with Zadig (zadig.akeo.ie): Options › List All Devices, pick V204ShopBot (USB ID 10C4 83C4), set WinUSB, Replace Driver. never on a PC that runs ShopBot 3.', tags:'windows laptop zadig winusb driver student usb' },
            { kind:'run', name:'disconnect', body:'lets go of the box (outputs off), so another program can use it. connect again and swarf offers to keep your zero.', tags:'disconnect release box com port shopbot 3 reconnect' },
            { kind:'run', name:'e-stop', body:'the red floor button. swarf stops the machine at once, switches the router off and lets go of it; press connect when the machine is safe. machine setup\'s that\'s the e-stop sets which input it is on.', tags:'e-stop emergency stop red button floor input disconnect safety' },
            { kind:'run', name:'router test', body:'the small router button in the jog pad: asks first, sounds a warning, then runs the router until you press it again, any key, the e-stop or 60 s. nothing moves while it runs.', tags:'router test spindle on off button red' },
            { kind:'run', name:'feed override', body:'while a job runs: −5% / +5% from 50 to 150 %, on cutting moves only, never past the machine\'s top speed. each job starts at 100 %.', tags:'feed override speed faster slower percent 5' },
            { kind:'run', name:'inches', body:'setup › preferences › units sets the cards to inches. type 3/4, 1 1/2\", 0.75 in or 19 mm in any length field; control\'s fields take 6in too. control runs .sbp files written in inches.', tags:'inches inch mm units fraction convert' },
            { kind:'run', name:'the shop\'s bits', body:'1/4 straight 48-005, 1/4 up-cut 52-910, 1/4 down-cut 57-910, 1/2 straight 48-072, in the tool list. in wood they cut with the shop\'s own numbers (120 in/min, 1/8 in a pass, 12,000 rpm).', tags:'bits tools shop upcut downcut straight part number feeds' },
            { kind:'run', name:'keep the zero', body:'a zero you set is kept across files, test cuts, a reconnect or a reload: one press of use the zero you set takes it back, no re-zeroing. it is dropped after a bit change or a box restart.', tags:'zero keep reuse reload reconnect' },
            { kind:'run', name:'search down', body:'on the z plate card: how far the bit comes down looking for the plate, 60 mm unless you raise it.', tags:'z plate search down distance touch off' },
            { kind:'op', name:'rough', body:'first pass that clears bulk material in horizontal layers above the part. fast, deep, sloppy by design — finished later by contour.', tags:'roughing clearing bulk first pass' },
            { kind:'op', name:'contour', body:'smooth surface pass. cutter crawls across the X or Y axis at a fine stepover, riding part curves. typical stepover 5–15% of tool diameter.', tags:'contouring finishing surface 2.5d' },
            { kind:'op', name:'outline', body:"cuts the part free from the stock by following its silhouette. usually the last cutting op. add tabs so the part doesn't fly out.", tags:'outline cutout silhouette' },
            { kind:'op', name:'pocket', body:'clears flat-bottomed cavities — trays, countersinks, recesses. selection-driven; pick the floor face and swarf walls down.', tags:'pocket cavity tray' },
            { kind:'param', name:'stepover', body:'how far the tool moves sideways between passes, as a fraction of tool diameter. swarf loads 10–20% for metal and 30–45% for wood, foam and plastic. wider cuts faster and loads the tool harder.', tags:'stepover sideways pass spacing' },
            { kind:'param', name:'step-down', body:'depth of cut per layer. swarf keeps every preset under half the tool diameter, which is conservative for wood and about right for metal. deeper than the tool is wide and the flutes cannot clear the chips.', tags:'depth of cut step down doc layer' },
            { kind:'param', name:'feed rate', body:'how fast the tool moves through material, in mm/min. when in doubt: slower is safer.', tags:'feed feedrate mm/min cutting speed' },
            { kind:'param', name:'plunge rate', body:'how fast the tool drives down into material. usually 30–50% of feed rate. too fast snaps end-mills.', tags:'plunge plungerate descent' },
            { kind:'param', name:'spindle speed', body:'RPM of the cutter. it follows the material and the tool width, not a fixed number — a wider tool at the same RPM cuts faster at its edge, so it has to slow down. the MR-1 tops out at 8000. on the ShopBot the router is set by hand on its dial, 1 (10,000 rpm) to 5 (21,000); the cut card names the setting the file asks for.', tags:'spindle rpm cutter speed' },
            { kind:'param', name:'ease down', body:'ramp into the cut at an angle instead of plunging straight down. easier on the tool, especially for end-mills with no center cut. on by default, and the material sets the angle — 1.8 degrees for metal, up to 10 for foam.', tags:'ease down ramp helix descent' },
            { kind:'param', name:'depth first', body:'finish each Z layer top-to-bottom in one region before moving to the next. opposite is layer-first (sweep all regions per layer).', tags:'depth first order strategy' },
            { kind:'param', name:'tab', body:"small uncut bridge of stock that holds the part during the outline cut so it doesn't shift or fly out. break/sand off after.", tags:'tab tabs holding bridge' },
            { kind:'param', name:'material', body:'what you are cutting. the MATERIAL row at the top of TOOLPATHS sets the feed, plunge, spindle speed, step-down, stepover and ramp angle for every operation, and retints the stock and the chips. the values are conservative starting points for HSS tooling — slow enough to survive a first cut, not fast.', tags:'material stock feeds speeds preset palette' },
            { kind:'param', name:'stock', body:'the raw block of material on the machine bed. defaults to part-bbox in student mode; expert mode lets you size it independently.', tags:'stock material block bed' },
            { kind:'param', name:'z top / z bottom', body:'upper and lower Z bounds for the carving. defines the slab swarf will work inside.', tags:'z top bottom bounds height' },
            { kind:'param', name:'z clearance', body:'how high above stock the tool retracts during rapids. high enough to clear clamps; low enough not to waste time.', tags:'z clearance retract rapid' },
            { kind:'tool', name:'end-mill', body:'flat-bottomed cutter, the workhorse. fewer flutes clear chips better in soft material; more flutes give a finer finish in metal. swarf assumes 2-flute HSS, or 4-flute for steel.', tags:'endmill flat cutter mill flutes' },
            { kind:'tool', name:'ball-end', body:'spherical tip. for 3D contour finishing on curved surfaces. leaves a cusp pattern proportional to stepover.', tags:'ballend spherical 3d finishing' },
            { kind:'tool', name:'v-bit', body:'conical cutter for engraving and chamfering. depth controls the line width.', tags:'vbit cone engraving chamfer' },
            { kind:'tool', name:'drill', body:'plunges straight down to make holes. paired with the drill operation (expert mode).', tags:'drill hole plunge' },
            { kind:'coach', name:'why rough before contour', body:"rough clears the easy bulk first at a deep stepdown. then contour finishes the surface at a fine stepover. one operation can't do both jobs efficiently.", tags:'order strategy rough contour finishing' },
            { kind:'coach', name:'why stepover matters', body:'stepover sets surface finish. wide stepover = scallops between passes (rough texture). narrow stepover = smoother but slower.', tags:'stepover finish quality scallop' },
            { kind:'coach', name:'feeds and speeds', body:'rule of thumb: chip load × flutes × rpm = feed rate. use a chip load chart for your material/diameter or err slow.', tags:'feeds speeds chip load rpm' },
            { kind:'coach', name:'how to keep the part in place', body:'add tabs in the outline operation, or use double-sided tape, vacuum hold-down, or screw clamps for soft sheet stock.', tags:'workholding tabs clamping fixture' }
        ];
        function render(query) {
            const q = (query || '').trim().toLowerCase();
            const matches = !q ? INDEX : INDEX.filter(e =>
                e.name.toLowerCase().includes(q) ||
                e.body.toLowerCase().includes(q) ||
                e.tags.toLowerCase().includes(q)
            );
            if (matches.length === 0) {
                results.innerHTML = '<div class="swarf-help-empty"><p>no matches.</p><p>try a control name, a parameter, or a phrase like &ldquo;why rough&rdquo;.</p></div>';
                return;
            }
            results.innerHTML = matches.map(e =>
                `<div class="swarf-result"><span class="swarf-result-kind ${e.kind}">${e.kind === 'run' ? 'control' : e.kind}</span><strong>${e.name}</strong><p>${e.body}</p></div>`
            ).join('');
        }
        input.addEventListener('keyup', () => render(input.value));
        render('');
    })();

    $('file-new').onclick = (ev) => { ev.stopPropagation(); settingsOps.new_workspace() };
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
        $('mov_x_lt').onclick = () => { selection.move(-parseFloat($('mov_x').value || 0), 0, 0); };
        $('mov_x_gt').onclick = () => { selection.move( parseFloat($('mov_x').value || 0), 0, 0); };
        $('mov_y_lt').onclick = () => { selection.move(0, -parseFloat($('mov_y').value || 0), 0); };
        $('mov_y_gt').onclick = () => { selection.move(0,  parseFloat($('mov_y').value || 0), 0); };
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
