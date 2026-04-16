/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { menubar } from './menu.js';
import { api } from '../api.js';
import { env, opAdd } from '../../mode/cam/app/init-ui.js';

const surfaces = {
    build(actions = {}) {
        const stop = (fn) => (ev) => {
            ev?.stopPropagation?.();
            return fn?.(ev);
        };
        menubar.build({
            ...actions,
            'view-arrange': stop(() => api.platform.layout()),
            'act-slice':    stop(() => api.function.slice()),
            // swarf v010 r7/r8: 'act-paths' combines toolpaths + preview.
            // If we're returning from SIMULATE, auto-clear sim/trail state
            // first so the new preview starts from a clean slate. Per Phil:
            // "if someone goes from simulate to toolpaths it should rebuild
            // toolpaths/autoclear beforehand."
            'act-paths': stop(() => {
                try {
                    const curView = api.view && api.view.get && api.view.get();
                    // view id 4 = ANIMATE in Kiri's VIEWS const
                    if (curView && curView !== 1) {
                        try { api.function.clear && api.function.clear(); } catch (e) {}
                        try { api.view.set && api.view.set(1); } catch (e) {}
                        try { window.dispatchEvent(new CustomEvent('swarf.clear')); } catch (e) {}
                    }
                } catch (e) {}
                // swarf: auto-add a rough op on the main thread if the user
                // clicks TOOLPATHS without adding one first. Without this, the
                // oplist stays visually empty and the worker silently injects
                // a transient rough op that never surfaces to the UI (so the
                // student sees no op, no concern, no sign anything happened).
                // Mirror on main thread → oplist renders → worker gets a real
                // op in proc.ops → toolpaths render as expected.
                try {
                    const proc = env.current?.process;
                    if (proc && env.isCamMode && env.popOp && env.popOp.rough) {
                        const hasRealOp = (proc.ops || []).some(op => op.type && op.type !== '|');
                        if (!hasRealOp) {
                            opAdd(env.popOp.rough.new());
                        }
                    }
                } catch (e) {}
                api.function.print();
            }),
            'act-preview':  stop(() => api.function.print()),
            'act-animate':  stop(() => api.function.animate()),
            // swarf v010 r7: CLEAR — wipe slices/preview/sim; back to arrange
            'act-clear':    stop(() => {
                try { api.function.clear && api.function.clear(); } catch (e) {}
                try { api.animate && api.animate.clear && api.animate.clear(); } catch (e) {}
                try { api.view.set && api.view.set(1); } catch (e) {}  // ARRANGE=1
                try { api.platform.update_origin && api.platform.update_origin(); } catch (e) {}
                // wipe swarf lightstream trail if present
                try { window.dispatchEvent(new CustomEvent('swarf.clear')); } catch (e) {}
            }),
            'act-export':   stop(() => api.function.export()),
            // swarf v010 r7 rev2: simulate display toggles — proxy to the
            // Kiri sim-bar buttons so handlers fire identically.
            'view-trans': stop(() => { try { const ui = api.ui && api.ui.anim; ui && ui.trans && ui.trans.click && ui.trans.click(); } catch (e) {} }),
            'view-model': stop(() => { try { const ui = api.ui && api.ui.anim; ui && ui.model && ui.model.click && ui.model.click(); } catch (e) {} }),
            'view-shade': stop(() => { try { const ui = api.ui && api.ui.anim; ui && ui.shade && ui.shade.click && ui.shade.click(); } catch (e) {} })
        });
    }
};

export { surfaces };
