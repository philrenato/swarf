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
 * 2. A cache-first offline app shell: once loaded, swarf's own UI layer
 *    and the CAM engine keep working with no network at all.
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
    'swarf-phone.js',
    'swarf-sky.js',
    'swarf-phase.js',
    'swarf-material.js',
    'swarf-grid-fade.js',
    'swarf-chips.js',
    'swarf-sim-bar.js',
    'swarf-lightstream.js',
    'swarf-a11y.js',
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

// the page itself, and the small swarf-owned UI shell files (including
// the version stamp's own script — the thing whose entire JOB is to
// show what's actually live), are network-first, not cache-first: a
// stale cache serving instantly means a real fix can take TWO reloads
// to show up — reload 1 shows the old cached content while quietly
// refreshing the cache in the background, reload 2 finally shows the
// fix. Same lesson Rendre already learned the hard way (see its own
// sw.js). Only the heavy, slow-changing CAM engine bundle/wasm/samples
// stay cache-first below — that's what keeps swarf usable offline
// without also meaning "usable but stuck on an old UI build."
const EAGER_URL_SET = new Set(EAGER_URLS.map((u) => new URL(u, self.registration.scope).href));

function isNavigation(req) {
    return req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
}

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
    if (req.method !== 'GET') return;

    const sameOrigin = new URL(req.url).origin === self.location.origin;
    const isShell = isNavigation(req) || EAGER_URL_SET.has(req.url);

    if (sameOrigin && isShell) {
        e.respondWith((async () => {
            try {
                const resp = await fetch(req, { cache: 'no-store' });
                if (resp && resp.ok) {
                    const patched = withCOI(resp);
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

    e.respondWith((async () => {
        const cached = await caches.match(req);
        if (cached) {
            // stale-while-revalidate: serve the cached shell instantly,
            // refresh the cache in the background for the next load. The
            // write is wrapped in waitUntil() so the browser doesn't tear
            // the worker down mid-write once respondWith()'s promise
            // resolves — without this, cache.put() here silently never
            // completes and nothing beyond the install-time shell ever
            // gets cached.
            if (sameOrigin) {
                e.waitUntil(
                    fetch(req)
                        .then((r) => r && r.ok && caches.open(CACHE_NAME).then((c) => c.put(req, withCOI(r))))
                        .catch(() => {})
                );
            }
            return cached;
        }
        try {
            const resp = await fetch(req);
            if (sameOrigin && resp && resp.ok) {
                const patched = withCOI(resp);
                // clone synchronously, in the same tick as creating the
                // response — by the time an async .then() callback runs,
                // the browser may already be streaming the returned
                // response's body to the page, which locks it and makes
                // a deferred .clone() throw "body is already used"
                const forCache = patched.clone();
                e.waitUntil(caches.open(CACHE_NAME).then((c) => c.put(req, forCache)));
                return patched;
            }
            return withCOI(resp);
        } catch (err) {
            return new Response('swarf is offline and this was never cached', {
                status: 503, statusText: 'offline'
            });
        }
    })());
});
