/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { $ } from '../../moto/webui.js';
import { api } from './api.js';
import { consts } from './consts.js';
import { modal } from './modal.js';
import { platform } from './platform.js';
import { selection } from './selected.js';
import { settings } from './conf/manager.js';

const { MODES, VIEWS } = consts;
const clone = Object.clone;

/** Current operating mode ID — swarf forces CAM (spec §4: CNC is the only mode) */
let MODE = MODES.CAM;

/**
 * Get current mode name as string.
 * @returns {string} Mode name (FDM, CAM, SLA, LASER, etc.)
 */
function getMode() {
    return settings.mode();
}

/**
 * Get current mode name in lowercase.
 * @returns {string} Lowercase mode name (fdm, cam, sla, etc.)
 */
function getModeLower() {
    return getMode().toLowerCase();
}

/**
 * Switch to a different operating mode.
 * Convenience wrapper around setMode() that updates platform size after switch.
 * @param {string} mode - Target mode name (FDM, CAM, SLA, LASER, DRAG, WJET, WEDM)
 */
function switchMode(mode) {
    setMode(mode, null, platform.update_size);
}

/**
 * Set operating mode with full initialization.
 * Complex function that:
 * - Validates and sets mode constant
 * - Updates UI to show/hide mode-specific controls
 * - Restores cached device for the mode
 * - Resets view to ARRANGE
 * - Saves settings
 * - Updates platform and selection
 * - Emits mode.set event
 *
 * @param {string} mode - Target mode name (FDM, CAM, SLA, LASER, DRAG, WJET, WEDM)
 * @param {*} lock - Currently unused parameter
 * @param {function} [then] - Optional callback after mode set complete
 */
function setMode(mode, lock, then) {
    // swarf: force CAM; any other requested mode (from persisted settings or deep link) falls back to CAM
    if (!MODES[mode] || mode !== 'CAM') {
        if (mode !== 'CAM') console.log("swarf: forcing CAM mode (requested: " + mode + ")");
        mode = 'CAM';
    }
    const current = settings.get();
    // change mode constants
    current.mode = mode;
    MODE = MODES[mode];
    document.title = 'swarf';
    // swarf: mode menu removed; skip mode-item highlight (elements no longer exist)
    api.uc.setVisible($('gcode-edit'), true);
    // restore cached device profile for this mode
    if (current.cdev[mode]) {
        current.device = clone(current.cdev[mode]);
        api.event.emit('device.select', api.device.get());
    }
    // hide/show
    api.uc.setVisible($('set-tools'), mode === 'CAM');
    // updates right-hand menu by enabling/disabling fields
    api.view.set(VIEWS.ARRANGE);
    api.uc.setMode(MODE);
    // sanitize and persist settings
    api.conf.load();
    api.conf.save();
    // trigger settings event
    api.event.emit('settings', settings.get());
    // other housekeeping
    platform.update_selected();
    selection.update_bounds(api.widgets.all());
    api.conf.update_fields();
    // if device dialog showing, needs to be refreshed
    if (modal.is('setup')) {
        api.show.devices();
    }
    api.space.restore(null, true);
    api.event.emit("mode.set", mode);
    if (then) {
        then();
    }
}

/**
 * Get the name of the current process profile for this mode.
 * @returns {string} Process profile name
 */
function currentProcessName() {
    return settings.get().cproc[getMode()];
}

/**
 * Get the process configuration object for the current mode and profile.
 * @returns {object} Process configuration
 */
function currentProcessCode() {
    return settings.get().sproc[getMode()][currentProcessName()];
}

export const mode = {
    get_id() { return MODE },
    get_lower: getModeLower,
    get: getMode,
    set: setMode,
    switch: switchMode,
    set_expert() {}, // noop
    is_fdm() { return MODE === MODES.FDM },
    is_cam() { return MODE === MODES.CAM },
    is_sla() { return MODE === MODES.SLA },
    is_drag() { return MODE === MODES.DRAG },
    is_wedm() { return MODE === MODES.WEDM },
    is_wjet() { return MODE === MODES.WJET },
    is_laser() { return MODE === MODES.LASER },
    is_2d() { return false ||
        mode.is_drag() ||
        mode.is_wedm() ||
        mode.is_wjet() ||
        mode.is_laser()
    }
};

export const process = {
    code: currentProcessCode,
    get: currentProcessName
};
