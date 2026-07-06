/*
 * swarf install button — Chrome/Edge (the realistic lab-machine browsers,
 * since the MR-1/ShopBot control PCs are Windows boxes) fire
 * beforeinstallprompt when the page qualifies as installable. Rather than
 * rely on the browser's own address-bar affordance, this surfaces an
 * explicit, visible button — hidden entirely until the browser actually
 * signals it's ready, so it's never a button that LOOKS clickable but
 * does nothing (see feedback_make_buttons_look_like_buttons).
 *
 * Safari/iOS has no programmatic install prompt (manual Add to Home
 * Screen only) — this button simply never appears there, which is
 * correct: there's nothing it could do.
 */
(function () {
    let deferredPrompt = null;

    const btn = document.createElement('div');
    btn.id = 'install-swarf';
    btn.textContent = 'install swarf';
    btn.title = 'install swarf as an app — keeps working offline once installed';
    document.body.appendChild(btn);

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        btn.classList.add('on');
    });

    btn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        btn.textContent = 'installing…';
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        btn.classList.remove('on');
        btn.textContent = 'install swarf';
    });

    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        btn.classList.remove('on');
    });
})();
