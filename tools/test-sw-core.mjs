// swarf-sw-core.js: the service worker's request rules — what may be kept offline, and when the
// cached copy answers instead of the network
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const W = createRequire(import.meta.url)('../web/kiri/swarf-sw-core.js');
const A = 'https://renato.design/swarf-app/';

const resp = (body, { status = 200, type, redirected = false } = {}) => {
    const r = new Response(body, { status, headers: type ? { 'content-type': type } : {} });
    if (redirected) Object.defineProperty(r, 'redirected', { value: true });
    return r;
};
const req = (path, o = {}) => ({ url: A + path, destination: o.destination || '', navigate: !!o.navigate });

// the build stamp is not part of the cache entry; other queries are
assert.equal(W.cacheKey(A + 'lib/kiri/run/worker.js?b=20261118-abc'), A + 'lib/kiri/run/worker.js');
assert.equal(W.cacheKey(A + 'swarf-phone.js?v=1&b=x'), A + 'swarf-phone.js?v=1');
assert.equal(W.cacheKey(A + 'swarf-version.js?check=123'), A + 'swarf-version.js?check=123');
assert.equal(W.cacheKey(A + '#help'), A);

// what each request expects
assert.equal(W.kindOf(A, '', true), 'html');
assert.equal(W.kindOf(A, '', false), 'html');
assert.equal(W.kindOf(A + 'lib/main/kiri.js?b=1', 'script'), 'js');
assert.equal(W.kindOf(A + 'swarf-tex-core.mjs', ''), 'js');
assert.equal(W.kindOf(A + 'swarf.css', 'style'), 'css');
assert.equal(W.kindOf(A + 'swarf-materials.json', ''), 'json');
assert.equal(W.kindOf(A + 'lib/kiri/wasm/manifold.wasm?b=1', ''), 'wasm');
assert.equal(W.kindOf(A + 'vendor/font/ibm-plex-mono-400.woff2', 'font'), 'other');

// a school filter's web page answering for code is never kept, whatever its status
const good = [
    ['lib/main/kiri.js', 'text/javascript; charset=utf-8'],
    ['lib/main/kiri.js', 'application/javascript'],
    ['swarf-tex-core.mjs', 'text/javascript'],
    ['swarf.css', 'text/css; charset=utf-8'],
    ['swarf-materials.json', 'application/json'],
    ['lib/kiri/wasm/kiri-geo.wasm', 'application/wasm'],
    ['lib/kiri/wasm/kiri-geo.wasm', 'application/octet-stream'],
    ['vendor/font/ibm-plex-mono-400.woff2', 'font/woff2'],
    ['swarf-icon-64.png', 'image/png'],
    ['moto/russo-one.ttf', ''],
];
for (const [p, t] of good) assert.ok(W.storable(resp('x', { type: t }), req(p)), `${p} as ${t} is kept`);
assert.ok(W.storable(resp('<html>', { type: 'text/html' }), req('', { navigate: true })), 'the page is kept');
const bad = [
    ['lib/main/kiri.js', 'text/html; charset=utf-8'],
    ['lib/main/kiri.js', 'text/plain'],
    ['lib/main/kiri.js', ''],
    ['swarf.css', 'text/html'],
    ['swarf-materials.json', 'text/html'],
    ['lib/kiri/wasm/kiri-geo.wasm', 'text/html'],
    ['vendor/font/ibm-plex-mono-400.woff2', 'text/html'],
    ['swarf-icon-64.png', 'text/html; charset=utf-8'],
];
for (const [p, t] of bad) assert.ok(!W.storable(resp('x', { type: t }), req(p)), `${p} as ${t || 'no type'} is not kept`);
assert.ok(!W.storable(resp('x', { type: 'text/javascript', redirected: true }), req('lib/main/kiri.js')), 'a redirected answer is not kept');
assert.ok(!W.storable(resp('x', { type: 'text/javascript', status: 404 }), req('lib/main/kiri.js')), 'a 404 is not kept');
assert.ok(!W.storable(resp('x', { type: 'application/json', status: 500 }), req('swarf-materials.json')), 'a 500 is not kept');
assert.ok(!W.storable(resp('<html>', { type: 'text/plain' }), req('', { navigate: true })), 'the page must be a page');
assert.ok(!W.storable(null, req('swarf.css')));

// the page and swarf's own files skip the HTTP cache; the engine and fonts revalidate
assert.equal(W.noStore(A, true), true);
assert.equal(W.noStore(A + 'swarf-run.js', false), true);
assert.equal(W.noStore(A + 'lib/main/kiri.js?b=1', false), false);
assert.equal(W.noStore(A + 'font/js/all.min.js', false), false);
assert.equal(W.noStore(A + 'lib/kiri/wasm/manifold.wasm', false), false);

// networkFirst
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CACHED = resp('cached', { type: 'text/javascript' });
const fresh = () => resp('fresh', { type: 'text/javascript' });
const isGood = (r) => W.storable(r, req('lib/main/kiri.js'));
const run = (network, cached, timeoutMs = 40) => W.networkFirst({ network, cached: async () => cached, good: isGood, timeoutMs });

// a quick good answer: the network, and it may be kept
let o = await run(async () => fresh(), CACHED);
assert.equal(o.from, 'network'); assert.equal(o.store, true); assert.equal(await o.response.text(), 'fresh');
// the network too slow: the cached copy, without waiting for the network
let t0 = Date.now();
o = await run(async () => { await sleep(400); return fresh(); }, CACHED);
assert.equal(o.from, 'cache'); assert.equal(o.store, false); assert.ok(Date.now() - t0 < 300, `answered in ${Date.now() - t0} ms`);
// too slow and nothing cached: keep waiting for the network
o = await run(async () => { await sleep(100); return fresh(); }, undefined);
assert.equal(o.from, 'network'); assert.equal(o.store, true);
// offline: the cached copy; offline and nothing cached: nothing
o = await run(async () => { throw new TypeError('Failed to fetch'); }, CACHED);
assert.equal(o.from, 'cache');
o = await run(async () => { throw new TypeError('Failed to fetch'); }, undefined);
assert.equal(o.from, 'none'); assert.equal(o.response, null);
// a filter page, a redirect or an error from the network: the cached copy
o = await run(async () => resp('<html>blocked</html>', { type: 'text/html' }), CACHED);
assert.equal(o.from, 'cache');
o = await run(async () => resp('x', { type: 'text/javascript', redirected: true }), CACHED);
assert.equal(o.from, 'cache');
o = await run(async () => resp('gone', { type: 'text/html', status: 404 }), CACHED);
assert.equal(o.from, 'cache');
// ... and with nothing cached, the network's answer goes to the page but is not kept
o = await run(async () => resp('<html>blocked</html>', { type: 'text/html' }), undefined);
assert.equal(o.from, 'network'); assert.equal(o.store, false);
// a moved page address passes through for the browser to follow
const moved = { type: 'opaqueredirect', ok: false, status: 0, redirected: false, headers: new Headers() };
o = await W.networkFirst({ network: async () => moved, cached: async () => CACHED, good: (r) => W.storable(r, req('', { navigate: true })), timeoutMs: 40 });
assert.equal(o.response, moved); assert.equal(o.store, false);
// the default wait is about four seconds
assert.equal(W.TIMEOUT_MS, 4000);

// the worker: install fails when any file fails (nothing swallowed), the old caches go only once the
// new one is whole, and precached files are not rewritten at run time (only put back when missing)
const sw = readFileSync(new URL('../web/kiri/swarf-sw.js', import.meta.url), 'utf8');
assert.ok(sw.includes("importScripts('swarf-sw-core.js')"));
assert.ok(sw.includes('[/*__SWARF_PRECACHE__*/]'), 'the deploy writes the file list here');
assert.ok(!/\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(sw.slice(sw.indexOf('async function precache'), sw.indexOf('async function complete'))), 'precache swallows no failure');
assert.ok(/throw new Error\(`precache/.test(sw) && /throw err;/.test(sw));
assert.ok(/if \(await complete\(CACHE_NAME\)\)/.test(sw), 'old caches are deleted only after the new one is complete');
assert.ok(/if \(precached && await c\.match\(key\)\) return;/.test(sw), 'a precached file is only put back when missing');
console.log('sw-core: ok');
