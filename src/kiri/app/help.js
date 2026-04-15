/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { $ } from '../../moto/webui.js';
import { api } from './api.js';
import { modal } from './modal.js';
import { version } from '../../moto/license.js';

const WIN = self.window;

/**
 * Show local help dialog.
 */
function showHelp() {
    showHelpFile(`local`,() => {});
}

/**
 * Show help dialog or open external docs.
 * @param {string} local - If truthy, shows local help modal; otherwise opens docs.grid.space
 * @param {function} then - Callback after help shown
 */
function showHelpFile(local,then) {
    if (!local) {
        // swarf: no external docs redirect. The INFO modal IS the help surface until SearchableHelp lands.
        local = true;
    }
    // swarf: fork version replaces upstream Kiri:Moto version string
    $('kiri-version').innerHTML = `v00000-007 · kiri:moto ${version}`;
    modal.show('help');
    api.event.emit('help.show', local);
}

export const help = {
    show: showHelp,
    file: showHelpFile
};
