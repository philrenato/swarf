// The offline cache's file list, read from a deployed copy of the app: every file the page
// (index.html), its stylesheets, its scripts and the CAM engine load. tools/deploy.sh writes the
// result into swarf-sw.js; tools/test-precache-list.mjs checks it.
//
//   node tools/precache-list.mjs <site dir> [prefix]     prints the list as JSON
//
// Followed, and a missing file stops the list (throws):
//   index.html src= / href= (local), manifest.json icons, url() in each stylesheet,
//   static imports in each module, the bundles' rooted "<prefix>..." strings, ENGINE below.
// Kept when the file is there (a loose scan of swarf's own scripts, which name files in plain
// strings: fetch('swarf-materials.json'), loadScript('vendor/...')):
//   every quoted 'name.ext' with a known file extension, resolved from the app's root.
// Left out: links that open a new page, other origins, and .ttf/.otf beside a .woff2 of the
// same name (the browser takes the woff2).
import { readFileSync, existsSync, statSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

// loaded by the engine at run time from names the scan can't see in a bundle
export const ENGINE = [
    'lib/main/kiri.js',
    'lib/kiri/run/worker.js',
    'lib/kiri/run/minion.js',
    'lib/gpu/raster-worker.js',
];
// the bundles: their own text is minified library code full of unrelated "./x.js" strings,
// so only their rooted "<prefix>..." strings are followed
const BUNDLES = new Set(['lib/main/kiri.js', 'lib/kiri/run/worker.js', 'lib/kiri/run/minion.js']);
const ASSET = /\.(m?js|css|json|wasm|woff2?|ttf|otf|png|svg|stl|txt|md)$/i;
// pages the app links to but never loads itself
const NOT_LOADED = new Set(['license.md', 'THIRD_PARTY_NOTICES.txt']);

const clean = (u) => u.replace(/[?#].*$/, '');
const local = (u) => u && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i.test(u);

export function precacheList(site, prefix = '/swarf-app/') {
    const isFile = (rel) => { const p = path.join(site, rel); return existsSync(p) && statSync(p).isFile(); };
    const out = new Set(['.', 'index.html']);
    const queue = [];
    const missing = [];
    const asked = new Map();
    const add = (rel, from, must) => {
        rel = path.posix.normalize(rel);
        if (rel.startsWith('..') || out.has(rel)) return;
        if (!isFile(rel)) { if (must) missing.push(`${rel} (from ${from})`); return; }
        out.add(rel);
        queue.push(rel);
    };
    // a reference as written in `from`: rooted under the prefix, or relative to `base` (a folder)
    const resolve = (ref, base) => {
        ref = clean(ref);
        if (ref.startsWith(prefix)) return ref.slice(prefix.length);
        if (ref.startsWith('/')) return null;
        return path.posix.join(base, ref);
    };

    const html = readFileSync(path.join(site, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    for (const m of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
        const tag = m[0];
        const src = (tag.match(/\b(?:src|href)="([^"]*)"/i) || [])[1];
        if (!src || !local(src)) continue;
        const rel = resolve(src, '');
        if (rel === null || NOT_LOADED.has(rel)) continue;
        add(rel, 'index.html', true);
        // the page asks for it with this query (swarf-phone.js?v=1): the cache entry carries it too
        const query = (src.match(/\?[^#]*/) || [''])[0];
        if (query) asked.set(path.posix.normalize(rel), query);
    }
    for (const rel of ENGINE) add(rel, 'the engine', true);

    while (queue.length) {
        const rel = queue.shift();
        const dir = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
        const ext = path.extname(rel).toLowerCase();
        if (!/^\.(m?js|css|json)$/.test(ext)) continue;
        let text = readFileSync(path.join(site, rel), 'utf8');
        if (rel === 'manifest.json') {
            for (const icon of JSON.parse(text).icons || []) if (local(icon.src)) add(resolve(icon.src, dir), rel, true);
            continue;
        }
        if (ext === '.css') {
            // inline images carry their own url(#id) references
            text = text.replace(/url\(\s*(?:"data:[^"]*"|'data:[^']*'|data:[^)]*)\s*\)/g, '');
            for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
                if (!local(m[2])) continue;
                const r = resolve(m[2], dir);
                if (r !== null) add(r, rel, true);
            }
            continue;
        }
        if (BUNDLES.has(rel)) {
            const esc = prefix.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
            for (const m of text.matchAll(new RegExp(`["'\`](${esc}[^"'\`\\s]+)["'\`]`, 'g'))) add(resolve(m[1], dir), rel, true);
            continue;
        }
        if (ext === '.mjs') {
            for (const m of text.matchAll(/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g)) {
                const ref = m[1] || m[2];
                if (local(ref)) { const r = resolve(ref, dir); if (r !== null) add(r, rel, true); }
            }
        }
        // swarf's own scripts; the other scripts (minified libraries) load nothing by name
        if (path.posix.basename(rel).startsWith('swarf')) {
            // plain strings naming a file: classic scripts resolve them from the page (the app's root)
            for (const m of text.matchAll(/(['"`])([A-Za-z0-9_\-./]+)\1/g)) {
                const ref = m[2];
                if (!ASSET.test(clean(ref)) || !local(ref)) continue;
                const r = resolve(ref, ref.startsWith('./') || ref.startsWith('../') ? dir : '');
                if (r !== null && !NOT_LOADED.has(r)) add(r, rel, false);
            }
        }
    }
    if (missing.length) throw new Error('precache: files the page loads are not on the site:\n  ' + missing.join('\n  '));
    // the browser loads the woff2 of a font that also ships as ttf/otf
    const list = [...out].filter((r) => !(/\.(ttf|otf)$/i.test(r) && out.has(r.replace(/\.(ttf|otf)$/i, '.woff2'))));
    list.sort((a, b) => (a === '.' ? -1 : b === '.' ? 1 : a < b ? -1 : a > b ? 1 : 0));
    return list.map((r) => r + (asked.get(r) || ''));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const [site, prefix] = process.argv.slice(2);
    if (!site) { console.error('usage: node tools/precache-list.mjs <site dir> [prefix]'); process.exit(2); }
    try {
        console.log(JSON.stringify(precacheList(site, prefix || '/swarf-app/')));
    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }
}
