/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { menubar } from './menu.js';
import { api } from '../api.js';

const surfaces = {
    build(actions = {}) {
        const stop = (fn) => (ev) => {
            ev?.stopPropagation?.();
            return fn?.(ev);
        };
        menubar.build({
            ...actions,
            'view-arrange': stop(() => api.platform.layout()),
            'act-slice': stop(() => api.function.slice()),
            'act-preview': stop(() => api.function.print()),
            'act-animate': stop(() => api.function.animate()),
            'act-export': stop(() => api.function.export())
        });
    }
};

export { surfaces };
