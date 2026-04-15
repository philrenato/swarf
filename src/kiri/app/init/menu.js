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
            span({ class: 'swarf-wordmark' }, [ span({ _: 'swarf' }), span({ class: 'swarf-tm', _: '\u2122' }) ])
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
                    menuItem(actions, { id: 'context-rotate-panel', text: 'rotate', iconClass: 'fas fa-rotate-right' }),
                    menuItem(actions, { id: 'context-scale-panel', text: 'scale / size', iconClass: 'fas fa-expand' }),
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
                    // swarf: expert-mode toggle lives under view (it's a display choice, not a preference)
                    menuItem(actions, { id: 'swarf-expert-toggle', text: 'expert mode', iconClass: 'fas fa-user-gear' }),
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
                    menuItem(actions, { id: 'swarf-help-search', text: 'search help…', iconClass: 'fas fa-magnifying-glass' }),
                    menuItem(actions, { id: 'swarf-concordance', text: 'concordance', iconClass: 'fas fa-book-open' }),
                    hr(),
                    menuItem(actions, { id: 'app-help', text: 'about swarf', iconClass: 'fas fa-circle-info' }),
                ]
            }),
            // hidden tool-nozzle shim — downstream code references ft-nozzle
            div({ class: 'f-row top-menu', style: 'display:none' }, [
                span({ id: 'tool-nozzle' }, [ div({ id: 'ft-nozzle' }) ])
            ]),
            div({ class: 'grow' }),
            // swarf: language selector removed — English-only (spec authorized 2026-04-14)
        ]),
        rotatePanel(actions),
        scalePanel(actions)
    ];
}

function modeTools(actions) {
    // swarf workflow bar: the four verbs a student moves through in order.
    // File (import mesh), Operations (arrange view — set up ops), Preview
    // (slice + show paths), Export (gcode).
    return [
        span({ id: 'swarf-step-file', class: 'swarf-step', onclick() { $('load-file').click(); } }, [
            span([icon('fas fa-file-arrow-up')]),
            label({ title: 'import a part — STL, OBJ, or supported mesh', _: 'import' })
        ]),
        span({ id: 'view-arrange', ...on(actions, 'view-arrange'), class: 'swarf-step' }, [
            span([icon('fas fa-list-check')]),
            label({ title: 'set up toolpaths — rough, contour, outline, pocket', _: 'toolpaths' })
        ]),
        span({ id: 'act-preview', ...on(actions, 'act-preview'), class: 'swarf-step' }, [
            span([icon('fas fa-route')]),
            label({ id: 'label-preview', title: 'slice the part and show the toolpaths', _: 'preview' })
        ]),
        // swarf: SIMULATE step (markup Apr 15) — runs Kiri's animation, watching
        // the tool walk the toolpaths in real time.
        span({ id: 'act-animate', ...on(actions, 'act-animate'), class: 'swarf-step' }, [
            span([icon('fas fa-play')]),
            label({ id: 'label-animate', title: 'play back the toolpath animation — watch the tool work, throw chips, and leave debris on the platform', _: 'simulate' })
        ]),
        span({ id: 'act-export', ...on(actions, 'act-export'), class: 'swarf-step' }, [
            span([icon('fas fa-file-export')]),
            label({ id: 'label-export', title: 'generate gcode for the machine — scene goes achromatic until you touch something new', _: 'export' })
        ]),
        // hidden but preserved so upstream slice code paths still have a hook
        span({ id: 'act-slice', style: 'display:none' })
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
