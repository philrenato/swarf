/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { BASE_SCHEME } from './base.js';

/**
 * CAM_SCHEME: Colors specific to CAM (3-axis milling/machining) mode
 * Inherits from BASE_SCHEME and overrides/extends with CAM-specific values
 */
const CAM_SCHEME = {
    // Inherit all base colors
    ...BASE_SCHEME,

    // CAM-specific view overrides
    views: {
        ...BASE_SCHEME.views,
        SLICE: {
            ...BASE_SCHEME.views.SLICE,
            sliced_opacity: 0.2  // CAM shows more during slice (vs FDM 0.0)
        },
        PREVIEW: {
            preview: {
                light: 0xdddddd,
                dark: 0x888888
            },
            preview_opacity: {
                light: 0.2,
                dark: 0.2
            }
        }
    },

    // CAM-specific operations
    operations: {
        // Tab visualization — swarf v010 r5: mill-red glowing blocks in both
        // themes. Phil: "tabs should be red in general." Reads as part of the
        // mill-red light-language (matches accent, retract markers, simulate
        // button). Opacity kept high so they read as solid glow, not ghosted.
        tabs: {
            color: {
                light: 0xff2a1a,
                dark:  0xff2a1a
            },
            opacity: {
                light: 0.85,
                dark:  0.90
            }
        }
    },

    // Gcode preview colors (same as FDM, but documented for CAM)
    gcode: {
        head: 0x888888,
        move: {
            light: 0xaaaaaa,
            dark: 0x666666
        },
        print: 0x777700
    }
};

export { CAM_SCHEME };
