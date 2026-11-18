/*
 * swarf service worker rules, kept apart from swarf-sw.js so node can test them
 * (tools/test-sw-core.mjs). The service worker loads this file with importScripts;
 * node loads it with require/createRequire. No browser globals are read here except
 * the ones passed in.
 *
 *   cacheKey(url)        the cache entry a URL is stored under: the build stamp (?b=) is
 *                        dropped, so worker.js?b=X and the precached worker.js are one entry
 *   kindOf(url, dest, nav)  what the request expects back: html, js, css, json, wasm or other
 *   typeMatches(kind, ct)   a Content-Type acceptable for that kind (a filter's HTML page
 *                        answering for a script is not)
 *   storable(resp, req)  a response worth keeping offline: ok, not redirected, same-origin
 *                        basic, and of the kind the request expects
 *   noStore(url, nav)    page and swarf's own small files skip the HTTP cache; the engine,
 *                        fonts and vendor files revalidate instead
 *   networkFirst(opts)   the network answer when it comes in time and is good; else the
 *                        cached copy; else whatever the network said
 */
(function (root) {
    'use strict';

    const TIMEOUT_MS = 4000;

    function extOf(pathname) {
        const last = pathname.split('/').pop() || '';
        const dot = last.lastIndexOf('.');
        return dot < 0 ? '' : last.slice(dot + 1).toLowerCase();
    }

    function cacheKey(url) {
        const u = new URL(url);
        u.hash = '';
        if (u.searchParams.has('b')) {
            u.searchParams.delete('b');
            if (![...u.searchParams.keys()].length) u.search = '';
        }
        return u.href;
    }

    function kindOf(url, destination, navigate) {
        if (navigate) return 'html';
        const ext = extOf(new URL(url).pathname);
        if (ext === 'js' || ext === 'mjs') return 'js';
        if (ext === 'css') return 'css';
        if (ext === 'json') return 'json';
        if (ext === 'wasm') return 'wasm';
        if (ext === 'html' || ext === 'htm' || ext === '') {
            if (destination === 'script' || destination === 'worker' || destination === 'sharedworker') return 'js';
            if (destination === 'style') return 'css';
            if (ext !== '') return 'html';
            // a folder address ("./") is the page
            return new URL(url).pathname.endsWith('/') ? 'html' : 'other';
        }
        return 'other';
    }

    function typeMatches(kind, contentType) {
        const ct = String(contentType || '').toLowerCase();
        switch (kind) {
            case 'html': return ct.includes('text/html');
            case 'js': return /javascript|ecmascript/.test(ct);
            case 'css': return ct.includes('text/css');
            case 'json': return ct.includes('json');
            // older static servers send wasm as a plain byte stream
            case 'wasm': return ct.includes('application/wasm') || ct.includes('octet-stream');
            // fonts, images, models, text: anything but a web page
            default: return !ct.includes('text/html');
        }
    }

    function storable(resp, req) {
        if (!resp || !resp.ok || resp.redirected) return false;
        if (resp.type && resp.type !== 'basic' && resp.type !== 'default') return false;
        const kind = kindOf(req.url, req.destination, req.navigate);
        return typeMatches(kind, resp.headers && resp.headers.get('content-type'));
    }

    function noStore(url, navigate) {
        if (navigate) return true;
        const path = new URL(url).pathname;
        if (/\/(lib|font|vendor|moto|obj)\//.test(path)) return false;
        return extOf(path) !== 'wasm';
    }

    /**
     * @param {Object} o
     * @param {() => Promise<Response>} o.network  the network fetch
     * @param {() => Promise<Response|undefined>} o.cached  the cached copy, if any
     * @param {(r: Response) => boolean} o.good  storable() bound to the request
     * @param {number} [o.timeoutMs]
     * @returns {Promise<{response: Response|null, from: string, store: boolean}>}
     *   from: 'network' | 'cache' | 'none'; store says the network response may be cached
     */
    async function networkFirst(o) {
        const ms = o.timeoutMs === undefined ? TIMEOUT_MS : o.timeoutMs;
        const net = Promise.resolve().then(o.network).then((r) => ({ r }), (e) => ({ e }));
        let timer = null;
        const late = new Promise((res) => { timer = setTimeout(() => res(null), ms); });
        let got = await Promise.race([net, late]);
        clearTimeout(timer);
        if (got === null) {
            // slow network: a cached copy now beats waiting; with none, keep waiting
            const c = await o.cached();
            if (c) return { response: c, from: 'cache', store: false };
            got = await net;
        }
        if (got.e) {
            const c = await o.cached();
            return c ? { response: c, from: 'cache', store: false } : { response: null, from: 'none', store: false };
        }
        if (o.good(got.r)) return { response: got.r, from: 'network', store: true };
        // a page address the server moves (/swarf-app → /swarf-app/): the browser follows it
        if (got.r && got.r.type === 'opaqueredirect') return { response: got.r, from: 'network', store: false };
        // an error page, a redirect or the wrong kind of file: the cached copy if there is one
        const c = await o.cached();
        if (c) return { response: c, from: 'cache', store: false };
        return { response: got.r, from: 'network', store: false };
    }

    const api = { TIMEOUT_MS, extOf, cacheKey, kindOf, typeMatches, storable, noStore, networkFirst };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SwarfSW = api;
})(typeof self !== 'undefined' ? self : globalThis);
