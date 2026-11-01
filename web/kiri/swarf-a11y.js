/*
 * swarf accessibility layer, bolted onto existing markup: dialog roles and focus trap (Kiri's
 * modal.js flips style.display on .mdialog), live progress text, aria-pressed on the sim-bar
 * toggles, and the cam panels made inert while DRAW or TEX is open.
 */
(function dialogA11y() {
    const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const titleOf = el => {
        const t = el.querySelector('.mdialog > div:first-child, .title, .mod-top');
        return t ? t.textContent.trim() : null;
    };
    let lastFocus = null;

    document.querySelectorAll('.mdialog').forEach(el => {
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        const t = titleOf(el);
        if (t) el.setAttribute('aria-label', t);
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    });

    function visibleDialog() {
        for (const el of document.querySelectorAll('.mdialog')) {
            if (el.style.display === 'flex') return el;
        }
        return null;
    }

    function trap(e) {
        if (e.key !== 'Tab') return;
        const open = visibleDialog();
        if (!open) return;
        const items = [...open.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!open.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', trap, true);

    // modal.js flips style.display directly (no class toggle to watch),
    // so this observes the style attribute on every dialog instead
    new MutationObserver(muts => {
        for (const m of muts) {
            const el = m.target;
            const isOpen = el.style.display === 'flex';
            const wasOpen = m.oldValue === 'display: flex;' || m.oldValue === 'display:flex;';
            if (isOpen && !wasOpen) {
                lastFocus = document.activeElement;
                const items = [...el.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent);
                (items[0] || el).focus();
            } else if (!isOpen && wasOpen) {
                if (lastFocus && document.body.contains(lastFocus) && lastFocus.offsetParent) lastFocus.focus();
                lastFocus = null;
            }
        }
    }).observe(document.getElementById('modal') || document.body, {
        subtree: true, attributes: true, attributeFilter: ['style'], attributeOldValue: true
    });
})();

/* live-region progress: the slice/preview status text gets read aloud as
   it changes instead of requiring a student to keep looking at the corner
   overlay to know whether the machine is still thinking. */
(function liveProgressA11y() {
    const live = id => {
        const el = document.getElementById(id);
        if (el) { el.setAttribute('aria-live', 'polite'); el.setAttribute('aria-atomic', 'true'); }
    };
    live('progress-pct');
    live('progtxt');
})();

/* sim-bar toggles (chips, lightstreams, machine, bed slides) expose their on/off state as
   aria-pressed, not just the swarf-toggle-on/-off class. */
(function toggleAria() {
    const sync = b => b.setAttribute('aria-pressed', b.classList.contains('swarf-toggle-on') ? 'true' : 'false');
    document.querySelectorAll('.swarf-toggle').forEach(sync);
    document.addEventListener('click', e => {
        const b = e.target.closest('.swarf-toggle');
        if (b) sync(b);
    });
    // every toggle lives in the simulate bar: watch it (not the whole body, which mutates per frame
    // in simulate) for toggles added and for classes flipped in code (review r093 B3)
    new MutationObserver(() => document.querySelectorAll('.swarf-toggle').forEach(sync))
        .observe(document.getElementById('layer-animate') || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
})();

/* review 10-30 F7: with DRAW or TEX open, cam's panels sit behind the board; Tab from the board's
   card walked into them (the left panel's material select, "endmills & bits"). They are inert
   while the board is up: no focus, no clicks, nothing read aloud. The mode row and menus stay. */
(function boardInert() {
    const BEHIND = ['panel-left', 'panel-right', 'panel-slide', 'swarf-right-rail', 'swarf-concerns', 'swarf-size', 'swarf-tabcard'];
    let was = null;
    const sync = () => {
        const on = document.body.classList.contains('swarf-draw-open');
        if (on === was) return;
        was = on;
        for (const id of BEHIND) {
            const el = document.getElementById(id);
            if (!el) continue;
            if (on) { el.dataset.swarfInert = el.inert ? 'was' : '1'; el.inert = true; }
            else if (el.dataset.swarfInert) { if (el.dataset.swarfInert === '1') el.inert = false; delete el.dataset.swarfInert; }
        }
    };
    const go = () => { new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] }); sync(); };
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
})();
