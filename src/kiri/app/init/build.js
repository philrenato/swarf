/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { menubar } from './menu.js';
import { api } from '../api.js';
import { env, opAdd } from '../../mode/cam/app/init-ui.js';

// the rough swarf adds is said once the toolpaths are up: the run clears the alerts before that
let added = false, heard = false;
function sayAdded() {
    added = true;
    if (heard) return;
    heard = true;
    const say = () => {
        if (!added) return;
        added = false;
        // toolpaths refused that time, and the step taken out since: nothing to say
        if (!(env.current?.process?.ops || []).some(op => op && op.swarfAdded)) return;
        api.show.alert('No step yet, so swarf added rough. For a flat part, outline is quicker.', 8);
    };
    api.event.on('preview.end', say);
    api.event.on('preview.error', say);
}

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
            // swarf: 'act-paths' combines toolpaths + preview.
            // If we're returning from SIMULATE, auto-clear sim/trail state
            // first so the new preview starts from a clean slate: going from
            // simulate to toolpaths rebuilds the toolpaths and clears
            // beforehand.
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
                            // marked, so its step card says swarf added it (init-ui.js paintStepLines);
                            // said once the toolpaths are up, since the run clears the alerts
                            const rec = env.popOp.rough.new();
                            rec.swarfAdded = true;
                            opAdd(rec);
                            sayAdded();
                        }
                    }
                } catch (e) {}
                api.function.print();
            }),
            'act-preview':  stop(() => api.function.print()),
            'act-animate':  stop(() => api.function.animate()),
            // swarf: CLEAR — wipe slices/preview/sim; back to arrange
            'act-clear':    stop(() => {
                try { api.function.clear && api.function.clear(); } catch (e) {}
                try { api.animate && api.animate.clear && api.animate.clear(); } catch (e) {}
                try { api.view.set && api.view.set(1); } catch (e) {}  // ARRANGE=1
                try { api.platform.update_origin && api.platform.update_origin(); } catch (e) {}
                // wipe swarf lightstream trail if present
                try { window.dispatchEvent(new CustomEvent('swarf.clear')); } catch (e) {}
            }),
            'act-export':   stop(() => api.function.export()),
            // swarf: simulate display toggles — proxy to the
            // Kiri sim-bar buttons so handlers fire identically.
            'view-trans': stop(() => { try { const ui = api.ui && api.ui.anim; ui && ui.trans && ui.trans.click && ui.trans.click(); } catch (e) {} }),
            'view-model': stop(() => { try { const ui = api.ui && api.ui.anim; ui && ui.model && ui.model.click && ui.model.click(); } catch (e) {} }),
            'view-shade': stop(() => { try { const ui = api.ui && api.ui.anim; ui && ui.shade && ui.shade.click && ui.shade.click(); } catch (e) {} })
        });
    }
};

export { surfaces };
