/*
 * swarf version stamp — same pattern as Rendre/Glisten's #ver: a small,
 * always-visible build stamp doubling as a manual "force the latest
 * build" button. Exists because a service-worker-cached PWA can otherwise
 * get stuck showing an old build indefinitely on a lab machine that
 * never closes its tab — tapping it clears the SW + all caches and
 * hard-reloads.
 *
 * Unlike Rendre/Glisten, swarf doesn't need an unsaved-work confirm
 * dialog here: the workspace (widgets, ops, settings) already persists
 * to IndexedDB independent of this button, so a forced reload just
 * re-loads that same saved state rather than discarding anything.
 */
(function () {
    // single source of truth for the version string: the About panel (src/kiri/app/help.js) reads it
    window.SWARF_VERSION = 'v00000-139';
    window.SWARF_BUILD = '__SWARF_BUILD__';   // stamped by the deploy, as is every machine-control file

    const ver = document.createElement('div');
    ver.id = 'ver';
    ver.title = `tap to update to the latest build (build ${window.SWARF_BUILD})`;
    ver.textContent = window.SWARF_VERSION + ' ↻';
    document.body.appendChild(ver);

    // the CAM engine (worker and helpers) says which build it is as it starts. A deploy that
    // landed while this page loaded can leave an older page with a newer engine: reload once,
    // early, to get one build. Later, or a second time, only say so (and machine connect waits,
    // as for the machine-control files: swarf-run.js buildsAgree).
    const stamped = (b) => typeof b === 'string' && b && !b.startsWith('__');
    function engineBuild(info) {
        const want = window.SWARF_BUILD;
        if (!stamped(want) || !info) return;
        const other = [info.engine, info.minion].find((b) => stamped(b) && b !== want);
        if (!other) return;
        window.SWARF_BUILDS = Object.assign(window.SWARF_BUILDS || {}, { 'CAM engine': other });
        let last = 0;
        try { last = +sessionStorage.getItem('swarf-build-reload') || 0; } catch (e) { last = Date.now(); }
        const early = performance.now() < 30000;
        if (early && Date.now() - last > 60000) {
            try { sessionStorage.setItem('swarf-build-reload', String(Date.now())); } catch (e) { return; }
            ver.textContent = 'swarf was updated while this page loaded: reloading once to match';
            setTimeout(() => window.location.reload(), 1500);
            return;
        }
        ver.textContent = 'two swarf builds on this page: tap here to reload';
    }
    window.swarfEngineBuild = engineBuild;
    (window.SWARF_ENGINE_SEEN || []).forEach(engineBuild);
    window.SWARF_ENGINE_SEEN = [];

    ver.addEventListener('click', async () => {
        const old = ver.textContent;
        ver.textContent = 'updating…';
        // offline the caches are the only copy of swarf here: check the network before clearing them
        try {
            const r = await fetch('swarf-version.js?check=' + Date.now(), { cache: 'no-store' });
            if (!r.ok) throw new Error(r.status);
        } catch (e) {
            ver.textContent = 'offline: try again when connected';
            setTimeout(() => { ver.textContent = old; }, 4000);
            return;
        }
        try {
            if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map((r) => r.update().catch(() => {})));
            }
            if (window.caches) {
                const keys = await caches.keys();
                await Promise.all(keys.map((k) => caches.delete(k)));
            }
        } catch (e) {
            ver.textContent = old;
            return;
        }
        window.location.reload();
    });
})();
