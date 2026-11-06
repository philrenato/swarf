/*
 * swarf service worker — a lab machine shouldn't lose a CAM job to flaky
 * wifi. Combines two responsibilities in one worker, since a page can
 * only be controlled by a single service worker per scope:
 *
 * 1. COOP/COEP header injection, folded in from coi-serviceworker v0.1.7
 *    (MIT, Guido Zuidhof — github.com/gzuidhof/coi-serviceworker), so
 *    SharedArrayBuffer/crossOriginIsolated work on static hosts (GitHub
 *    Pages, a lab's `python3 -m http.server`) that can't set real HTTP
 *    headers. Without this, Contour and other minion-backed CAM ops fall
 *    back to a slower non-SAB path.
 * 2. An offline fallback: once loaded, swarf's own UI layer and the CAM
 *    engine keep working with no network at all.
 *
 * CACHE_STAMP is rewritten by tools/deploy.sh on every deploy. Bumping it
 * is what invalidates the previous cache — a browser tab left open for
 * weeks should still pick up a new release instead of serving a stale
 * engine forever.
 */
const CACHE_STAMP = '__SWARF_DEPLOY_STAMP__'; // replaced by tools/deploy.sh
const CACHE_NAME = `swarf-shell-${CACHE_STAMP}`;

// small and worth having offline-ready the instant the service worker
// installs. The CAM engine bundle, wasm, and sample STLs are much
// larger (~10MB) and get cached lazily instead, the first time they're
// actually requested — see the fetch handler below.
const EAGER_URLS = [
    '.',
    'index.html',
    'index.css',
    'manifest.json',
    'swarf.css',
    'vendor/font/ibm-plex-mono-400.woff2',
    'vendor/font/ibm-plex-mono-600.woff2',
    'vendor/font/renato-symbols-400.woff2',
    'vendor/font/renato-symbols-600.woff2',
    'font/css/all.min.css',
    'font/webfonts/fa-solid-900.woff2',
    'font/webfonts/fa-regular-400.woff2',
    'swarf-skin.js',
    'swarf-skin-map.css',
    'swarf-skin-glass.css',
    'swarf-skin-classic.css',
    'swarf-phone.js',
    'swarf-sky.js',
    'swarf-phase.js',
    'swarf-material.js',
    'swarf-grid-fade.js',
    'swarf-chips.js',
    'swarf-sim-bar.js',
    'swarf-lightstream.js',
    'swarf-run-parse.js',
    'swarf-run-plan.js',
    'swarf-sound.js',
    'swarf-run-machine.js',
    'swarf-shopbot-usb.js',
    'swarf-shopbot-card.js',
    'swarf-estimate.js',
    'swarf-menu.js',
    'swarf-shopbot-direct.js',
    'swarf-run.js',
    'swarf-plate-model.js',
    'swarf-prefs.js',
    'swarf-modes.js',
    'swarf-lessons.js',
    'swarf-safety-words.js',
    'swarf-tutorial.js',
    'swarf-length.js',
    'swarf-a11y.js',
    'swarf-draw-geom.mjs',
    'swarf-board.js',
    'swarf-tex.js',
    'swarf-file.js',
    'swarf-tex-core.mjs',
    'swarf-tex-worker.mjs',
    'swarf-draw.js',
    'swarf-shape.js',
    'swarf-size.js',
    'swarf-start.js',
    'swarf-version.js',
    'swarf-install.js',
    'swarf-bedname.js',
    'swarf-place.js',
    'swarf-vector.mjs',
    'swarf-sim-machine.js',
    'swarf-shopbot-model.js',
    'swarf-mr1-model.js',
    'vendor/unreason/arrangement.mjs',
    'vendor/unreason/trim.mjs',
    'vendor/unreason/exchange-2d.mjs',
    'vendor/unreason/exchange-2d-read.mjs',
    'swarf-icon-64.png',
    'swarf-icon-128.png',
    'swarf-icon-144.png',
    'swarf-icon-256.png',
    'swarf-icon-512.png',
];

function withCOI(resp) {
    if (!resp || resp.status === 0 || resp.type === 'opaque') return resp;
    const headers = new Headers(resp.headers);
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
}

self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            Promise.all(EAGER_URLS.map((url) =>
                fetch(url, { cache: 'reload' })
                    .then((r) => r.ok && cache.put(url, withCOI(r)))
                    .catch(() => {})
            ))
        )
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => k.startsWith('swarf-shell-') && k !== CACHE_NAME).map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// every same-origin file is network-first; the cache is only the offline fallback. A stale
// cache served first made a fix take two reloads to show, and (10-28) mixed the old build's
// scripts with the new build's CSS on the first launch after a deploy. The page and the shell
// files skip the HTTP cache ('no-store'); the rest revalidate ('no-cache': an unchanged file
// is a cheap 304). Only other origins are cache-first, below.
const EAGER_URL_SET = new Set(EAGER_URLS.map((u) => new URL(u, self.registration.scope).href));

function isNavigation(req) {
    return req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
}

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    // anything on this computer (localhost) is live state: never cache it
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        if (url.origin !== self.location.origin) return;
    }
    const sameOrigin = url.origin === self.location.origin;
    const isShell = isNavigation(req) || EAGER_URL_SET.has(req.url);

    if (sameOrigin) {
        e.respondWith((async () => {
            try {
                const resp = await fetch(req, { cache: isShell ? 'no-store' : 'no-cache' });
                if (resp && resp.ok) {
                    const patched = withCOI(resp);
                    // clone in the same tick: once the body streams to the page a deferred clone throws
                    const forCache = patched.clone();
                    e.waitUntil(caches.open(CACHE_NAME).then((c) => c.put(req, forCache)));
                    return patched;
                }
                return withCOI(resp);
            } catch (err) {
                const cached = await caches.match(req);
                if (cached) return cached;
                return new Response('swarf is offline and this was never cached', {
                    status: 503, statusText: 'offline'
                });
            }
        })());
        return;
    }

    // other origins: cache-first (nothing here writes them to the cache)
    e.respondWith((async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        try {
            return withCOI(await fetch(req));
        } catch (err) {
            return new Response('swarf is offline and this was never cached', {
                status: 503, statusText: 'offline'
            });
        }
    })());
});
