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
 * 2. An offline fallback: once installed, swarf's own UI layer and the CAM
 *    engine keep working with no network at all. The install takes every
 *    file the page and engine load (PRECACHE, written by the deploy) or none.
 *
 * CACHE_STAMP is rewritten by tools/deploy.sh on every deploy, so each
 * deploy installs as a new worker with its own cache; the previous cache is
 * deleted only after the new one holds every file. The request rules
 * (timeout, what may be cached) are in swarf-sw-core.js.
 */
const CACHE_STAMP = '__SWARF_DEPLOY_STAMP__'; // replaced by tools/deploy.sh
const CACHE_NAME = `swarf-shell-${CACHE_STAMP}`;

importScripts('swarf-sw-core.js');
const { cacheKey, storable, noStore, networkFirst } = self.SwarfSW;

// every file the page and the CAM engine load, written in by tools/deploy.sh
// (tools/precache-list.mjs builds it from the deployed site). The install fetches all of
// them and fails if any one fails, so a half-filled cache never replaces a whole one.
// Unstamped (a dev server) the list is empty and files are kept as they are first used.
const PRECACHE = [/*__SWARF_PRECACHE__*/];

const SCOPE = self.registration.scope;
const PRECACHE_KEYS = new Set(PRECACHE.map((u) => cacheKey(new URL(u, SCOPE).href)));

function withCOI(resp) {
    if (!resp || resp.status === 0 || resp.type === 'opaque') return resp;
    const headers = new Headers(resp.headers);
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
}

async function precache() {
    const cache = await caches.open(CACHE_NAME);
    try {
        await Promise.all(PRECACHE.map(async (u) => {
            const url = new URL(u, SCOPE).href;
            const r = await fetch(url, { cache: 'reload' });
            const nav = cacheKey(url) === cacheKey(SCOPE) || /\.html$/.test(new URL(url).pathname);
            if (!storable(r, { url, destination: '', navigate: nav })) {
                throw new Error(`precache ${u}: ${r.status} ${r.headers.get('content-type') || ''}${r.redirected ? ' redirected' : ''}`);
            }
            await cache.put(cacheKey(url), withCOI(r));
        }));
    } catch (err) {
        // the previous cache stays the offline copy; this worker is not installed
        await caches.delete(CACHE_NAME);
        throw err;
    }
}

async function complete(name) {
    if (!PRECACHE_KEYS.size) return true;
    const cache = await caches.open(name);
    const have = new Set((await cache.keys()).map((r) => r.url));
    for (const k of PRECACHE_KEYS) if (!have.has(k)) return false;
    return true;
}

self.addEventListener('install', (e) => {
    e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
    e.waitUntil((async () => {
        // older caches go only once this one holds every file
        if (await complete(CACHE_NAME)) {
            const keys = await caches.keys();
            await Promise.all(keys.filter((k) => k.startsWith('swarf-shell-') && k !== CACHE_NAME).map((k) => caches.delete(k)));
        }
        await self.clients.claim();
    })());
});

// every same-origin file is network-first and the cache is the fallback: a stale cache served
// first made a fix take two reloads to show and mixed two builds' scripts and CSS. The network
// gets SwarfSW.TIMEOUT_MS to answer before a cached copy is used. Precached files are not
// rewritten at run time (only put back if missing), so the offline copy stays one build; other
// files are kept as used.
function isNavigation(req) {
    return req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
}

async function fromCache(req, nav) {
    const key = cacheKey(req.url);
    const own = await caches.open(CACHE_NAME);
    const hit = (await own.match(key)) || (await caches.match(key));
    if (hit || !nav) return hit;
    // the page at any address in the app (?reset=1, index.html): the cached page
    return (await own.match(cacheKey(SCOPE))) || (await caches.match(cacheKey(SCOPE)));
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

    if (sameOrigin) {
        const nav = isNavigation(req);
        const key = cacheKey(req.url);
        // a query other than the build stamp (a connectivity check) is never kept; a precached
        // file is written only into a hole (its cache was cleared)
        const precached = PRECACHE_KEYS.has(key);
        const keep = precached || !new URL(key).search;
        e.respondWith((async () => {
            const out = await networkFirst({
                network: () => fetch(req, { cache: noStore(req.url, nav) ? 'no-store' : 'no-cache' }),
                cached: () => fromCache(req, nav),
                good: (r) => storable(r, { url: req.url, destination: req.destination, navigate: nav }),
            });
            if (!out.response) {
                return new Response('swarf is offline and this was never cached', { status: 503, statusText: 'offline' });
            }
            if (out.from === 'cache') return out.response;
            const patched = withCOI(out.response);
            if (out.store && keep) {
                // clone in the same tick: once the body streams to the page a deferred clone throws
                const forCache = patched.clone();
                e.waitUntil(caches.open(CACHE_NAME).then(async (c) => {
                    if (precached && await c.match(key)) return;
                    await c.put(key, forCache);
                }));
            }
            return patched;
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
