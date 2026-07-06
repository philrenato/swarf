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
    const ver = document.createElement('div');
    ver.id = 'ver';
    ver.title = 'tap to update to the latest build (clears the cache & reloads)';
    ver.textContent = 'v00000-016 ↻';
    document.body.appendChild(ver);

    ver.addEventListener('click', async () => {
        const old = ver.textContent;
        ver.textContent = 'updating…';
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
