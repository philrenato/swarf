/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

import { api } from './api.js';

/**
 * Active alert records. Each record is an array: [message, timestamp, duration, active]
 * @type {Array<[string, number, number, boolean]>}
 */
let alerts = [];

/**
 * Display an alert message to the user
 * @param {string} message - The message to display
 * @param {number} time - Duration in seconds to show the alert
 * @returns {Array|undefined} Alert record [message, timestamp, duration, active] or result of update()
 */
function show(message, time) {
    if (message === undefined || message === null) {
        return update(true);
    }
    // the same words already showing are shown once, for longer, never stacked (Phil 10-30:
    // "about 3 of the same ones up in a row while I waited for them to fade")
    let same = !api.feature.alert_event && alerts.find(a => a[3] && a[0] === message);
    if (same) {
        same[1] = Date.now();
        same[2] = Math.max(same[2] || 5, time || 5);
        setTimeout( update, (same[2] * 1000) + 20);
        update();
        return same;
    }
    let rec = [message, Date.now(), time, true];
    if (api.feature.alert_event) {
        api.event.emit('alert', rec);
    } else {
        alerts.push(rec);
        setTimeout( update, time+0.02);
        update();
    }
    return rec;
}

/**
 * Hide one or more alerts
 * @param {Array|Array<Array>} rec - Single alert record or array of records to hide
 * @param {Array<Array>} [recs] - Optional array of alert records (deprecated parameter style)
 */
function hide(rec, recs) {
    if (Array.isArray(recs)) {
        for (let r of recs) {
            hide(r);
        }
        return;
    }
    if (api.feature.alert_event) {
        api.event.emit('alert.cancel', rec);
        return;
    }
    if (Array.isArray(rec)) {
        rec[3] = false;
        update();
    }
}

/**
 * Update the alert display by filtering expired/inactive alerts and rendering active ones.
 * Filters alerts by age (based on duration) and active flag, limits display to 5 alerts.
 * @param {boolean} [clear] - If true, clears all alerts before updating
 */
function update(clear) {
    if (clear) {
        alerts = [];
    }
    const now = Date.now();
    const { ui } = api;
    // filter out by age and active flag
    alerts = alerts.filter(alert => {
        return alert[3] && (now - alert[1]) < ((alert[2] || 5) * 1000);
    });
    // limit to 5 showing
    while (alerts.length > 5) {
        alerts.shift();
    }
    // return if called before UI configured
    if (!ui.alert) {
        return;
    }
    if (alerts.length > 0) {
        // each one has its × so nobody waits for it to fade (Phil 10-30); a click elsewhere still clears all
        ui.alert.text.innerHTML = alerts.map((v, i) => ['<p class="alert-one"><span>',v[0],'</span><button class="alert-x" data-i="',i,'" title="close" aria-label="close">×</button></p>'].join('')).join('');
        for (let x of ui.alert.text.querySelectorAll('.alert-x')) {
            x.onclick = ev => { ev.stopPropagation(); hide(alerts[+x.dataset.i]); };
        }
        ui.alert.dialog.style.display = 'flex';
    } else {
        ui.alert.dialog.style.display = 'none';
    }
}

export {
    hide,
    show,
    update
};

export default {
    hide,
    show,
    update
};
