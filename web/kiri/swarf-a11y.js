/*
 * swarf accessibility layer — self-contained, bolts onto existing markup
 * without touching Kiri's own modal/progress/toggle code. Pattern borrowed
 * from Rendre's rendre.html a11y pass (dialogA11y/liveProgressA11y/
 * progressBarA11y/segGroupAria) and adapted to swarf's actual DOM:
 * Kiri's modal system toggles inline style.display on .mdialog elements
 * (see src/kiri/app/modal.js) rather than an "on" class, and swarf's
 * sim-bar toggles use .swarf-toggle-on/-off rather than Rendre's .act/.ptog.
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

/* sim-bar toggles (chips / paths / lightstreams) expose their on/off state
   as aria-pressed, not just the swarf-toggle-on/-off class. Synced from one
   delegated click listener so any toggle added later is covered for free. */
(function toggleAria() {
    const sync = b => b.setAttribute('aria-pressed', b.classList.contains('swarf-toggle-on') ? 'true' : 'false');
    document.querySelectorAll('.swarf-toggle').forEach(sync);
    document.addEventListener('click', e => {
        const b = e.target.closest('.swarf-toggle');
        if (b) sync(b);
    });
    // toggles are (re)built after simulate/toolpaths view transitions — catch those too
    new MutationObserver(() => document.querySelectorAll('.swarf-toggle').forEach(sync))
        .observe(document.body, { childList: true, subtree: true });
})();
