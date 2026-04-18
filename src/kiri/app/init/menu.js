/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { $, h } from '../../../moto/webui.js';
import { api } from '../api.js';

const { div, span, label, input, button, i, hr } = h;

function icon(cls) {
    return i({ class: cls });
}

function on(actions, id) {
    return actions && typeof actions[id] === 'function' ? { onclick: actions[id] } : {};
}

function tr(key, fallback) {
    return api.language?.current?.[key] || fallback || key;
}

function menuItem(actions, { id, lk, xlk, text, title, iconClass, className, children, onclick }) {
    const attr = {
        ...(id ? { id } : {}),
        ...(title ? { title } : {}),
        ...(className ? { class: className } : {}),
        ...(onclick ? { onclick } : {}),
        ...on(actions, id)
    };
    const lblAttr = {
        ...(lk ? { lk } : {}),
        ...(xlk ? { xlk } : {})
    };
    const resolved = lk ? tr(lk, text) : xlk ? tr(xlk, text) : text;
    return div(attr, [
        resolved !== undefined ? label({ ...lblAttr, _: resolved }) : undefined,
        iconClass ? span([icon(iconClass)]) : undefined,
        children
    ].filter(v => v !== undefined));
}

function dropMenu(actions, side, items) {
    return div({ class: `top-menu-drop top-menu-${side}` }, [
        div({ class: 'content' }, items)
    ]);
}

function topMenu(actions, { text, lk, iconClass, side = 'left', right = false, items }) {
    const resolved = lk ? tr(lk, text) : text;
    return span({ class: right ? 'menu-right' : undefined }, [
        resolved !== undefined ? label({ ...(lk ? { lk } : {}), _: resolved }) : undefined,
        iconClass ? icon(iconClass) : undefined,
        dropMenu(actions, side, items)
    ]);
}

// swarf r14+: move panel — mirrors the rotate panel's pattern.
// Translates the selected widget in X / Y by the value in the input, with
// chevron buttons for +/- direction. Z intentionally omitted — parts sit
// on the platform in CAM. Closes/drags identically to the other panels.
function movePanel(actions) {
    return div({ id: 'panel-move', class: 'selection-panel hide' }, [
        div({ id: 'panel-move-head', class: 'selection-panel-head' }, [
            div({ class: 'selection-panel-head-title' }, [
                i({ class: 'fas fa-arrows-up-down-left-right' }),
                label({ _: 'Move' })
            ]),
            button({ id: 'panel-move-close', class: 'selection-panel-close', title: 'close' }, [
                i({ class: 'fas fa-times' })
            ])
        ]),
        div({ id: 'ft-move', class: 'grid selection-panel-body' }, [
            div({ id: 'mov_x_lt', title: 'move −X by step', ...on(actions, 'mov_x_lt') }, icon('fas fa-chevron-left')),
            label({ _: 'X' }),
            div({ id: 'mov_x_gt', title: 'move +X by step', ...on(actions, 'mov_x_gt') }, icon('fas fa-chevron-right')),
            input({ id: 'mov_x', class: 'value center', size: '6', value: '10', title: 'X step in mm' }),
            div({ id: 'mov_y_lt', title: 'move −Y by step', ...on(actions, 'mov_y_lt') }, icon('fas fa-chevron-left')),
            label({ _: 'Y' }),
            div({ id: 'mov_y_gt', title: 'move +Y by step', ...on(actions, 'mov_y_gt') }, icon('fas fa-chevron-right')),
            input({ id: 'mov_y', class: 'value center', size: '6', value: '10', title: 'Y step in mm' }),
            div({ class: 'buttons f-row' }, [
                button({ id: 'mov_center', class: 'grow', _: 'center', title: 'snap to platform origin', ...on(actions, 'mov_center') })
            ])
        ])
    ]);
}

function rotatePanel(actions) {
    return div({ id: 'panel-rotate', class: 'selection-panel hide' }, [
        div({ id: 'panel-rotate-head', class: 'selection-panel-head' }, [
            div({ class: 'selection-panel-head-title' }, [
                i({ class: 'fas fa-rotate-right' }),
                label({ _: 'Rotate' })
            ]),
            button({ id: 'panel-rotate-close', class: 'selection-panel-close', title: 'close' }, [
                i({ class: 'fas fa-times' })
            ])
        ]),
        div({ id: 'ft-rotate', class: 'grid selection-panel-body' }, [
            div({ id: 'rot_x_lt', ...on(actions, 'rot_x_lt') }, icon('fas fa-chevron-left')),
            label({ _: 'X' }),
            div({ id: 'rot_x_gt', ...on(actions, 'rot_x_gt') }, icon('fas fa-chevron-right')),
            input({ id: 'rot_x', class: 'value center', size: '6', value: '90' }),
            div({ id: 'rot_y_lt', ...on(actions, 'rot_y_lt') }, icon('fas fa-chevron-left')),
            label({ _: 'Y' }),
            div({ id: 'rot_y_gt', ...on(actions, 'rot_y_gt') }, icon('fas fa-chevron-right')),
            input({ id: 'rot_y', class: 'value center', size: '6', value: '90' }),
            div({ id: 'rot_z_lt', ...on(actions, 'rot_z_lt') }, icon('fas fa-chevron-left')),
            label({ _: 'Z' }),
            div({ id: 'rot_z_gt', ...on(actions, 'rot_z_gt') }, icon('fas fa-chevron-right')),
            input({ id: 'rot_z', class: 'value center', size: '6', value: '90' }),
            div({ class: 'buttons f-row' }, [
                button({ id: 'unrotate', class: 'grow', lk: 'reset', _: 'reset', ...on(actions, 'unrotate') })
            ])
        ])
    ]);
}

function scalePanel(actions) {
    return div({ id: 'panel-scale', class: 'selection-panel hide' }, [
        div({ id: 'panel-scale-head', class: 'selection-panel-head' }, [
            div({ class: 'selection-panel-head-title' }, [
                i({ class: 'fas fa-expand' }),
                label({ _: 'Scale / Size' })
            ]),
            button({ id: 'panel-scale-close', class: 'selection-panel-close', title: 'close' }, [
                i({ class: 'fas fa-times' })
            ])
        ]),
        div({ id: 'ft-scale', class: 'grid selection-panel-body' }, [
            div([label({ _: 'X' }), input({ id: 'lock_x', type: 'checkbox', _checked: true })]),
            div([label({ _: 'Y' }), input({ id: 'lock_y', type: 'checkbox', _checked: true })]),
            div([label({ _: 'Z' }), input({ id: 'lock_z', type: 'checkbox', _checked: true })]),
            label({ id: 'lab-axis', lk: 'axis', _: 'axis', ...on(actions, 'lab-axis') }),
            input({ id: 'size_x', size: '8', class: 'value' }),
            input({ id: 'size_y', size: '8', class: 'value' }),
            input({ id: 'size_z', size: '8', class: 'value' }),
            label({ id: 'lab-size', lk: 'size', _: 'size' }),
            input({ id: 'scale_x', size: '8', class: 'value', value: '1' }),
            input({ id: 'scale_y', size: '8', class: 'value', value: '1' }),
            input({ id: 'scale_z', size: '8', class: 'value', value: '1' }),
            label({ id: 'lab-scale', lk: 'scale', _: 'scale', ...on(actions, 'lab-scale') }),
            div({ class: 'buttons f-row' }, [
                button({ id: 'scale-reset', class: 'grow j-center', _: 'reset', ...on(actions, 'scale-reset') })
            ])
        ])
    ]);
}

function content(actions) {
    return [
        div({ class: 'menubar-appname el-app-hide' }, [
            span({ class: 'swarf-wordmark' }, [
                span({ class: 'swarf-mark-sw', _: 'sw' }),
                span({ class: 'swarf-mark-arf', _: 'arf' }),
                span({ class: 'swarf-tm', _: '\u2122' })
            ])
        ]),
        div({ class: 'menubar-separator el-app-hide' }),
        div({ class: 'f-row top-menu grow' }, [
            topMenu(actions, {
                text: 'files', lk: 'fe_menu', items: [
                    menuItem(actions, { id: 'file-new', lk: 'new', text: 'new', iconClass: 'fas fa-file' }),
                    hr(),
                    menuItem(actions, { id: 'file-recent', lk: 'recent', text: 'recent', iconClass: 'fas fa-list' }),
                    menuItem(actions, {
                        id: 'file-import', lk: 'import', text: 'import', iconClass: 'fas fa-file-upload', children:
                            input({ id: 'load-file', type: 'file', name: 'loadme', style: 'display:none', accept: '.km,.kmz,.stl,.obj,.svg,.dxf,.png,.jpg,.jpeg,.gcode,.nc' })
                    }),
                    hr(),
                    menuItem(actions, { id: 'mesh-export-obj', lk: 'export-obj', text: 'save as OBJ', iconClass: 'fas fa-dice-d20' }),
                    menuItem(actions, { id: 'mesh-export-stl', lk: 'export-stl', text: 'save as  STL', iconClass: 'fas fa-dice-d20' }),
                    hr(),
                    menuItem(actions, { id: 'app-export', lk: 'rc_xpws', text: 'export work', iconClass: 'fas fa-download' }),
                    hr({ class: "app-hide" }),
                    menuItem(actions, { id: 'app-quit', lk: 'quit', text: 'quit', className: 'hide', onclick() { window.close() } })
                ]
            }),
            topMenu(actions, {
                text: 'edit', lk: 'ed_menu', items: [
                    menuItem(actions, { id: 'context-layflat', lk: 'rc_lafl', text: 'face down', iconClass: 'fas fa-angle-double-down' }),
                    menuItem(actions, { id: 'context-lefty', lk: 'face_left', text: 'face left', iconClass: 'fas fa-angle-double-left' }),
                    hr(),
                    menuItem(actions, { id: 'context-mirror', lk: 'rc_mirr', text: 'mirror', iconClass: 'fas fa-arrows-left-right-to-line' }),
                    menuItem(actions, { id: 'context-duplicate', lk: 'rc_dupl', text: 'duplicate', iconClass: 'fas fa-copy' }),
                    hr(),
                    menuItem(actions, { id: 'context-move-panel', text: 'move', title: 'translate the selected part on X / Y', iconClass: 'fas fa-arrows-up-down-left-right' }),
                    menuItem(actions, { id: 'context-rotate-panel', text: 'rotate', title: 'rotate the selected part on X / Y / Z', iconClass: 'fas fa-rotate-right' }),
                    menuItem(actions, { id: 'context-scale-panel', text: 'scale / size', title: 'scale the part by factor or set absolute size', iconClass: 'fas fa-expand' }),
                    hr(),
                    menuItem(actions, { id: 'mesh-merge', lk: 'rc_merg', text: 'merge meshes' }),
                    menuItem(actions, { id: 'mesh-split', lk: 'rc_splt', text: 'isolate meshes' }),
                ]
            }),
            topMenu(actions, {
                text: 'view', lk: 'vu_menu', items: [
                    menuItem(actions, { id: 'view-fit', text: 'fit to part', iconClass: 'fas fa-arrows-to-circle' }),
                    menuItem(actions, { id: 'view-home', text: 'home', iconClass: 'fas fa-home' }),
                    menuItem(actions, { id: 'view-top', text: 'top', iconClass: 'fas fa-square' }),
                    menuItem(actions, { id: 'context-setfocus', text: 'focal point', iconClass: 'fas fa-eye' }),
                    hr(),
                    // swarf: render modes folded into view — they're display choices
                    menuItem(actions, { id: 'render-solid', text: 'solid', iconClass: 'fas fa-square' }),
                    menuItem(actions, { id: 'render-wire', text: 'wireframe', iconClass: 'fas fa-border-all' }),
                    menuItem(actions, { id: 'render-ghost', text: 'transparent', iconClass: 'fas fa-border-none' }),
                    menuItem(actions, { id: 'render-edges', text: 'toggle edges', iconClass: 'fa-regular fa-square' }),
                    hr(),
                    // swarf v010 r7 rev2: simulate display toggles — click
                    // dispatches to the hidden sim-bar button with the same
                    // onclick handler, so behavior is identical whether the
                    // user uses the sim bar icons or this menu.
                    menuItem(actions, { id: 'view-trans', text: 'transparency',    iconClass: 'fa-solid fa-border-none' }),
                    menuItem(actions, { id: 'view-model', text: 'show part model', iconClass: 'fa-solid fa-eye' }),
                    menuItem(actions, { id: 'view-shade', text: 'stock box',       iconClass: 'fa-solid fa-cube' }),
                    hr(),
                    // swarf: expert-mode toggle lives under view (it's a display choice, not a preference)
                    menuItem(actions, { id: 'swarf-expert-toggle', text: 'advanced<sup class="swarf-alpha-sup">alpha</sup>', title: 'show advanced (alpha) tools — untested, may change', iconClass: 'fas fa-user-gear' }),
                    hr(),
                    menuItem(actions, { id: 'app-xpnd', text: 'fullscreen', iconClass: 'fas fa-maximize' })
                ]
            }),
            // swarf: Setup moved to left (Mac app convention — markup Apr 15)
            topMenu(actions, {
                text: 'setup', items: [
                    menuItem(actions, { id: 'set-device', text: 'machines', iconClass: 'fas fa-cube' }),
                    menuItem(actions, { id: 'set-tools', text: 'tool library', iconClass: 'fas fa-tools', className: 'swarf-expert-only' }),
                    menuItem(actions, { id: 'set-prefs', text: 'preferences', iconClass: 'fa-solid fa-square-check' }),
                    hr({ class: "el-app-hide" }),
                    menuItem(actions, { id: 'install', text: 'install' }),
                    menuItem(actions, { id: 'uninstall', text: 'uninstall', className: 'hide' })
                ]
            }),
            // swarf: Info renamed Help, moved to left. Contains About, Searchable Help, Concordance.
            topMenu(actions, {
                text: 'help', items: [
                    menuItem(actions, { id: 'swarf-help-search', text: 'search help…', title: 'search the help corpus', iconClass: 'fas fa-magnifying-glass' }),
                    menuItem(actions, { id: 'swarf-concordance', text: 'concordance', title: 'glossary of swarf terms', iconClass: 'fas fa-book-open' }),
                    hr(),
                    menuItem(actions, { id: 'swarf-reset-profile', text: 'reset profile', title: 'clear all settings and reload swarf', iconClass: 'fas fa-rotate-left' }),
                    menuItem(actions, { id: 'app-help', text: 'about swarf', title: 'about, credits, version', iconClass: 'fas fa-circle-info' }),
                ]
            }),
            // hidden tool-nozzle shim — downstream code references ft-nozzle
            div({ class: 'f-row top-menu', style: 'display:none' }, [
                span({ id: 'tool-nozzle' }, [ div({ id: 'ft-nozzle' }) ])
            ]),
            div({ class: 'grow' }),
            // swarf: language selector removed — English-only (spec authorized 2026-04-14)
        ]),
        movePanel(actions),
        rotatePanel(actions),
        scalePanel(actions)
    ];
}

function modeTools(actions) {
    // swarf v010 r7 workflow bar — collapsed to four verbs:
    //   IMPORT · TOOLPATHS · SIMULATE · CLEAR · EXPORT
    // Per Phil markup: TOOLPATHS now combines the old "toolpaths" (arrange
    // view) and "preview" (slice+render paths) into one step. Until that
    // button is hit, NO paths are visible. Clicking it generates and
    // previews them. CLEAR (X) un-previews and wipes any sim state so the
    // scene returns to a clean arrange.
    return [
        span({ id: 'swarf-step-file', class: 'swarf-step', title: 'import a part — STL, OBJ, or supported mesh', onclick() { $('load-file').click(); } }, [
            span([icon('fas fa-file-arrow-up')]),
            label({ _: 'import' })
        ]),
        // Combined TOOLPATHS — fires preview (slice + render paths). Clicking
        // also switches to arrange view so the left drawer for op editing
        // stays reachable. The old 'view-arrange' button is gone because the
        // left TOOLPATHS drawer handles op setup directly.
        span({ id: 'act-paths', ...on(actions, 'act-paths'), class: 'swarf-step', title: 'generate and preview toolpaths — rough, contour, outline, pocket' }, [
            span([icon('fas fa-route')]),
            label({ id: 'label-paths', _: 'toolpaths' })
        ]),
        span({ id: 'act-animate', ...on(actions, 'act-animate'), class: 'swarf-step', title: 'simulate — watch the tool cut, throw chips, and leave debris on the platform' }, [
            span([icon('fas fa-play')]),
            label({ id: 'label-animate', _: 'simulate' })
        ]),
        // swarf v010 r7: CLEAR — nuke all path/preview/sim state
        span({ id: 'act-clear', ...on(actions, 'act-clear'), class: 'swarf-step swarf-step-clear', title: 'clear toolpaths, preview, and simulate state — back to a clean arrange' }, [
            span([icon('fas fa-xmark')]),
            label({ id: 'label-clear', _: 'clear' })
        ]),
        span({ id: 'act-export', ...on(actions, 'act-export'), class: 'swarf-step', title: 'export gcode for the machine' }, [
            span([icon('fas fa-file-export')]),
            label({ id: 'label-export', _: 'export' })
        ]),
        // legacy hidden hooks — upstream slice/preview codepaths still expect
        // these ids. act-paths wires to the same action as act-preview below.
        span({ id: 'act-slice',   style: 'display:none' }),
        span({ id: 'act-preview', style: 'display:none' }),
        span({ id: 'view-arrange', style: 'display:none' })
    ];
}

export const menubar = {
    build(actions = {}) {
        const menubarNode = $('menubar');
        const modeToolsNode = $('mode-tools');
        if (!menubarNode) {
            return;
        }
        h.bind(menubarNode, content(actions));
        if (modeToolsNode) {
            h.bind(modeToolsNode, modeTools(actions));
        }
    }
};
