/*
 * swarf version stamp — same pattern as Rendre/Glisten's #ver: a small,
 * always-visible build stamp doubling as a manual "force the latest
 * build" button, for a lab machine that never closes its tab. Tapping it
 * asks the service worker for a newer build, waits for it to finish
 * installing (it swaps in its own complete offline copy, swarf-sw.js),
 * then reloads. It never deletes a cache: the offline copy stays whole
 * whether or not there was a newer build.
 *
 * Unlike Rendre/Glisten, swarf doesn't need an unsaved-work confirm
 * dialog here: the workspace (widgets, ops, settings) already persists
 * to IndexedDB independent of this button, so a forced reload just
 * re-loads that same saved state rather than discarding anything.
 */
(function () {
    // single source of truth for the version string: the About panel (src/kiri/app/help.js) reads it
    window.SWARF_VERSION = 'v00000-148';
    window.SWARF_BUILD = '__SWARF_BUILD__';   // stamped by the deploy, as is every machine-control file

    const ver = document.createElement('button');
    ver.type = 'button';
    ver.id = 'ver';
    ver.title = `check for an update (build ${window.SWARF_BUILD})`;
    ver.setAttribute('aria-label', `swarf ${window.SWARF_VERSION}: check for an update`);
    ver.setAttribute('aria-live', 'polite');
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

    // a worker that is installing: wait until it is the one in charge, or has failed
    const settled = (w) => new Promise((res) => {
        if (!w) return res(true);
        const done = () => {
            if (w.state === 'activated') { res(true); return true; }
            if (w.state === 'redundant') { res(false); return true; }
            return false;
        };
        if (done()) return;
        w.addEventListener('statechange', done);
        setTimeout(() => res(false), 120000);
    });

    let updating = false;
    ver.addEventListener('click', async () => {
        if (updating) return;
        updating = true;
        const old = ver.textContent;
        const say = (t, back) => { ver.textContent = t; if (back) setTimeout(() => { ver.textContent = old; }, back); };
        say('updating…');
        try {
            // offline the cache is the only copy of swarf here: nothing to fetch, nothing changes
            try {
                const r = await fetch('swarf-version.js?check=' + Date.now(), { cache: 'no-store' });
                if (!r.ok) throw new Error(r.status);
            } catch (e) {
                say('offline: try again when connected', 4000);
                return;
            }
            const reg = ('serviceWorker' in navigator) && await navigator.serviceWorker.getRegistration().catch(() => null);
            if (reg) {
                await reg.update().catch(() => {});
                const w = reg.installing || reg.waiting;
                if (w) {
                    say('downloading the new build…');
                    if (!await settled(w)) {
                        // the new build did not install whole: this one and its offline copy stay
                        say('update could not finish: this build is kept, try again later', 6000);
                        return;
                    }
                }
            }
            // every file is network-first, so the reload brings the newest build
            window.location.reload();
        } finally {
            updating = false;
        }
    });
})();
