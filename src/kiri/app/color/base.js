/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

/**
 * BASE_SCHEME: Shared colors used across all device modes
 * All mode-specific schemes inherit from this base
 */
const BASE_SCHEME = {
    // swarf: widgets in the Downward Spiral palette
    //   selected = rust-red (accent hover)   deselected = bone (text)
    widget: {
        selected: {
            light: [ 0xa8382a, 0x9a3224, 0x8c2b1e, 0x7a2a1a ],
            dark:  [ 0xa8382a, 0x9a3224, 0x8c2b1e, 0x7a2a1a ]
        },
        deselected: {
            light: [ 0xd4cfc4, 0xbab5aa, 0xa09b90, 0x868176 ],
            dark:  [ 0xd4cfc4, 0xbab5aa, 0xa09b90, 0x868176 ]
        },
        disabled: {
            // Computed via avgc(0x888888, baseColor, 3)
            mixWith: 0x888888,
            mixRatio: 3
        }
    },

    // Edge rendering settings
    edges: {
        color: {
            light: 0x888888,
            dark: 0x444444
        },
        angle: 20  // Default edge detection angle threshold
    },

    // Wireframe rendering settings
    wireframe: {
        color: {
            light: 0x000000,
            dark: 0xaaaaaa
        },
        opacity: {
            light: 0.5,
            dark: 0.25
        }
    },

    // swarf: oxidized-iron bed grid
    grid: {
        major: {
            light: 0x3a2820,
            dark:  0x3a2820
        },
        minor: {
            light: 0x2a1a14,
            dark:  0x2a1a14
        }
    },

    // View-specific opacity defaults (common across modes)
    views: {
        ARRANGE: {
            model_opacity: 1.0
        },
        SLICE: {
            slicing_opacity: 0.5
        }
    }
};

export { BASE_SCHEME };
