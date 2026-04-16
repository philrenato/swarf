/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { $ } from '../../../moto/webui.js';
import { api } from '../api.js';
import { beta, version } from '../../../moto/license.js';
import { fileOps } from '../file-ops.js';
import { local as sdb } from '../../../data/local.js';
import { preferences } from '../preferences.js';
import { settings as set_ctrl } from '../conf/manager.js';
import { settingsOps } from '../conf/settings.js';
import { space } from '../../../moto/space.js';
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

    // show gdpr if it's never been seen and we're not iframed
    const isLocal = LOCAL || WIN.location.host.split(':')[0] === 'localhost';
    if (!sdb.gdpr && WIN.self === WIN.top && !SETUP.debug && !isLocal) {
        $('gdpr').style.display = 'flex';
    }

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

    // swarf: auto-fit camera on every widget add (markup Apr 15 — "approx default
    // zoom to any/all 3D in scene, on startup and as new things come in" + "zoom
    // cube to almost whole screen"). Use space.view.fit() with tight padding so
    // the part fills most of the viewport; home() only sets angles, not zoom.
    //
    // r14+ fix: the rAF fit fires before mesh bounding boxes are computed or
    // before the camera's matrixWorld has settled, producing a tiny blob on
    // the platform. Force computeBoundingBox on each mesh, then fit once
    // immediately AND once after a short delay as a safety net for slow
    // imports (OBJ with quads, 3MF, etc).
    (function(){
        const doFit = () => {
            try { space.event.onResize(); } catch (e) {}
            try { api.platform.update_bounds(); } catch (e) {}
            try {
                const meshes = (api.widgets.all() || []).map(w => w.mesh).filter(Boolean);
                for (const m of meshes) {
                    try { m.geometry && m.geometry.computeBoundingBox(); } catch (e) {}
                }
                if (space.view.fit && meshes.length) {
                    space.view.fit(undefined, { padding: 1.8, visibleOnly: true, objects: meshes });
                } else space.view.home();
            } catch (e) {}
        };
        const fit = () => {
            requestAnimationFrame(doFit);
            setTimeout(doFit, 250);
        };
        api.event.on('widget.add', fit);
        api.event.on('widget.delete', fit);
        api.event.on('widgets.loaded', fit);
        api.event.on('load.url', fit);
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
                for (const op of ops) {
                    const tool = op.tool ? api.conf.get_tool?.(op.tool) : null;
                    const td = tool?.metric ? tool.flute_diam : (tool?.flute_diam || 3);
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
                    // rule 2 — plunge rate equal to or greater than feed rate
                    if (op.feed && op.plunge && op.plunge >= op.feed * 0.95) {
                        warnings.push({
                            title: `plunge rate ≈ feed rate`,
                            body: `plunging at ${op.plunge} mm/min vs feed ${op.feed} mm/min — most tools want plunge at 30–50% of feed.`,
                            hint: 'too fast a plunge snaps end-mills'
                        });
                    }
                    // rule 3 — depth of cut > 1× tool diameter
                    if (op.depth && td && op.depth > td * 1.0) {
                        warnings.push({
                            title: `step-down deeper than tool diameter`,
                            body: `${op.depth.toFixed(2)} mm step-down on a ${td.toFixed(2)} mm tool — chip evacuation gets bad past 1× diameter.`,
                            hint: 'split into shallower passes for safer cutting'
                        });
                    }
                }
            } catch (e) { /* swallow until ops shape is finalised */ }
            render(warnings);
        }
        function render(warnings) {
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
        ['settings','op.add','op.del','op.update','widget.add','widget.delete']
            .forEach(ev => api.event.on(ev, evaluate));
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
        if (b) b.onclick = (ev) => { ev.stopPropagation(); api.modal.show('tools'); };
    })();

    // swarf: Searchable Help — index of every named thing in swarf with a
    // short explanation. Real-time filter against the user's query. Index
    // expands during the coaching pass.
    (function(){
        const input = document.getElementById('swarf-search-input');
        const results = document.getElementById('swarf-search-results');
        if (!input || !results) return;
        const INDEX = [
            { kind:'op', name:'rough', body:'first pass that clears bulk material in horizontal layers above the part. fast, deep, sloppy by design — finished later by contour.', tags:'roughing clearing bulk first pass' },
            { kind:'op', name:'contour', body:'smooth surface pass. cutter crawls across the X or Y axis at a fine stepover, riding part curves. typical stepover 5–15% of tool diameter.', tags:'contouring finishing surface 2.5d' },
            { kind:'op', name:'outline', body:"cuts the part free from the stock by following its silhouette. usually the last cutting op. add tabs so the part doesn't fly out.", tags:'outline cutout silhouette' },
            { kind:'op', name:'pocket', body:'clears flat-bottomed cavities — trays, countersinks, recesses. selection-driven; pick the floor face and swarf walls down.', tags:'pocket cavity tray' },
            { kind:'param', name:'stepover', body:'how far the tool moves sideways between passes. % of tool diameter. roughing 40–60%, finishing 5–15%.', tags:'stepover sideways pass spacing' },
            { kind:'param', name:'step-down', body:'depth of cut per layer. wood/plastic up to 1× tool diameter; aluminum 0.25–0.5×; steel 0.1–0.25×.', tags:'depth of cut step down doc layer' },
            { kind:'param', name:'feed rate', body:'how fast the tool moves through material, in mm/min. when in doubt: slower is safer.', tags:'feed feedrate mm/min cutting speed' },
            { kind:'param', name:'plunge rate', body:'how fast the tool drives down into material. usually 30–50% of feed rate. too fast snaps end-mills.', tags:'plunge plungerate descent' },
            { kind:'param', name:'spindle speed', body:'RPM of the cutter. wood 12k–24k, aluminum 10k–18k, steel 4k–10k.', tags:'spindle rpm cutter speed' },
            { kind:'param', name:'ease down', body:'ramp into the cut at an angle instead of plunging straight down. easier on the tool, especially for end-mills with no center cut. on by default in swarf.', tags:'ease down ramp helix descent' },
            { kind:'param', name:'depth first', body:'finish each Z layer top-to-bottom in one region before moving to the next. opposite is layer-first (sweep all regions per layer).', tags:'depth first order strategy' },
            { kind:'param', name:'tab', body:"small uncut bridge of stock that holds the part during the outline cut so it doesn't shift or fly out. break/sand off after.", tags:'tab tabs holding bridge' },
            { kind:'param', name:'stock', body:'the raw block of material on the machine bed. defaults to part-bbox in student mode; expert mode lets you size it independently.', tags:'stock material block bed' },
            { kind:'param', name:'z top / z bottom', body:'upper and lower Z bounds for the carving. defines the slab swarf will work inside.', tags:'z top bottom bounds height' },
            { kind:'param', name:'z clearance', body:'how high above stock the tool retracts during rapids. high enough to clear clamps; low enough not to waste time.', tags:'z clearance retract rapid' },
            { kind:'tool', name:'end-mill', body:'flat-bottomed cutter, the workhorse. fewer flutes = better chip clearance for soft material.', tags:'endmill flat cutter mill' },
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
                `<div class="swarf-result"><span class="swarf-result-kind ${e.kind}">${e.kind}</span><strong>${e.name}</strong><p>${e.body}</p></div>`
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
    $('view-fit').onclick = api.const.SPACE.view.fit;
    // swarf: 'wassup'/'suppopp' GridSpace support-dev element removed from mod-help; skip binding

    makePanelDraggable('panel-rotate', 'panel-rotate-head', 'win.roate');
    makePanelDraggable('panel-scale', 'panel-scale-head', 'win.scale');

    // enable modal hiding
    $('mod-x').onclick = api.modal.hide;

    // dismiss gdpr alert
    $('gotit').onclick = () => {
        $('gdpr').style.display = 'none';
        sdb.gdpr = Date.now();
    };

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
