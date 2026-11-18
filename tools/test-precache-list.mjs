// tools/precache-list.mjs: the offline cache holds every file the page and the CAM engine load.
// Built three ways: a small made-up site (the rules), a deploy-shaped copy of this source tree
// (nothing swarf loads is missing from the list), and the published site copy when it is here.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { precacheList, ENGINE } from './precache-list.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(path.join(tmpdir(), 'swarf-precache-'));
const put = (dir, rel, text = 'x') => { const p = path.join(dir, rel); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, text); };
const PRE = '/swarf-app/';
const bundles = (dir) => {
    put(dir, 'lib/main/kiri.js', `new Worker("${PRE}lib/kiri/run/worker.js?b=S");locateFile(){return "${PRE}lib/kiri/wasm/manifold.wasm?b=S"};x="./lib/_stream_duplex.js"`);
    put(dir, 'lib/kiri/run/worker.js', `fetch("${PRE}lib/kiri/wasm/kiri-geo.wasm?b=S");new Worker("./minion.js?b=S");"raster-worker.js"`);
    put(dir, 'lib/kiri/run/minion.js', `fetch("${PRE}lib/kiri/wasm/kiri-geo.wasm?b=S")`);
};

try {
    // 1. the rules, on a made-up site
    const a = path.join(tmp, 'a');
    put(a, 'index.html', `<html><head>
<link rel="stylesheet" href="app.css"><link href="manifest.json" rel="manifest">
<script src="swarf-one.js?v=2" defer></script><script type="module" src="swarf-mod.mjs"></script>
<!-- <script src="lib/never.js"></script> -->
<script src="https://example.com/x.js"></script><script async src="//gc.zgo.at/count.js"></script>
<a href="license.md">license</a><a href="other.html">a page</a>
</head></html>`);
    put(a, 'app.css', `@font-face{src:url(font/a.woff2) format("woff2"),url('font/a.ttf')}
.x{background:url("data:image/svg+xml;utf8,<svg><rect filter='url(%23g)'/></svg>")}
@font-face{src:url("font/b.ttf")}`);
    put(a, 'font/a.woff2'); put(a, 'font/a.ttf'); put(a, 'font/b.ttf');
    put(a, 'manifest.json', JSON.stringify({ icons: [{ src: 'icon-64.png' }] })); put(a, 'icon-64.png');
    put(a, 'swarf-one.js', `fetch('swarf-data.json'); loadScript('vendor/lib.min.js'); const u = ['moto/f.ttf', '../moto/f.ttf']; const n = 'swarf-file.js'; fetch('nothing-here.json')`);
    put(a, 'swarf-data.json', '{}'); put(a, 'vendor/lib.min.js'); put(a, 'moto/f.ttf'); put(a, 'swarf-file.js');
    put(a, 'swarf-mod.mjs', `import { a } from './vendor/m/a.mjs';\nnew Worker(new URL('swarf-w.mjs', document.baseURI));`);
    put(a, 'vendor/m/a.mjs', `export { b } from './b.mjs';`); put(a, 'vendor/m/b.mjs');
    put(a, 'swarf-w.mjs', `import C from './swarf-c.mjs';`); put(a, 'swarf-c.mjs');
    put(a, 'license.md'); put(a, 'other.html'); put(a, 'lib/gpu/raster-worker.js');
    put(a, 'lib/kiri/wasm/kiri-geo.wasm'); put(a, 'lib/kiri/wasm/manifold.wasm'); put(a, 'lib/kiri/wasm/unused.wasm');
    bundles(a);
    const L = precacheList(a, PRE);
    const want = ['.', 'index.html', 'app.css', 'manifest.json', 'icon-64.png', 'swarf-one.js?v=2', 'swarf-mod.mjs',
        'font/a.woff2', 'font/b.ttf', 'swarf-data.json', 'vendor/lib.min.js', 'moto/f.ttf', 'swarf-file.js',
        'vendor/m/a.mjs', 'vendor/m/b.mjs', 'swarf-w.mjs', 'swarf-c.mjs',
        ...ENGINE, 'lib/kiri/wasm/kiri-geo.wasm', 'lib/kiri/wasm/manifold.wasm'];
    for (const w of want) assert.ok(L.includes(w), `listed: ${w}`);
    for (const n of ['font/a.ttf', 'license.md', 'other.html', 'lib/never.js', 'lib/kiri/wasm/unused.wasm', 'swarf-one.js', 'nothing-here.json'])
        assert.ok(!L.includes(n), `not listed: ${n}`);
    assert.ok(!L.some((u) => /^(https?:|\/\/|\/)|%23|\.\./.test(u)), 'only the app\'s own files, as relative paths');
    assert.equal(L[0], '.');
    assert.equal(new Set(L).size, L.length);

    // a file the page loads that is not there stops the list, whichever way it is loaded
    const missing = (rel, label) => {
        const saved = readFileSync(path.join(a, rel)); rmSync(path.join(a, rel));
        assert.throws(() => precacheList(a, PRE), new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), label);
        writeFileSync(path.join(a, rel), saved);
    };
    missing('swarf-one.js', 'a script in the page');
    missing('font/b.ttf', 'a font in a stylesheet');
    missing('vendor/m/b.mjs', 'a module import');
    missing('lib/kiri/wasm/kiri-geo.wasm', 'a file a bundle names');
    missing('lib/gpu/raster-worker.js', 'an engine file');
    missing('icon-64.png', 'a manifest icon');
    precacheList(a, PRE);

    // 2. this source tree laid out the way the deploy lays out the site
    const s = path.join(tmp, 's');
    mkdirSync(s);
    const kiri = path.join(ROOT, 'web/kiri');
    for (const f of readdirSync(kiri)) if (f !== 'index.html' && f !== 'index.css') symlinkSync(path.join(kiri, f), path.join(s, f));
    writeFileSync(path.join(s, 'index.css'), readFileSync(path.join(kiri, 'index.css'), 'utf8').replace(/\.\.\/moto\//g, 'moto/'));
    // the site's page uses relative paths where the source's uses rooted ones
    writeFileSync(path.join(s, 'index.html'), readFileSync(path.join(kiri, 'index.html'), 'utf8').replace(/((?:src|href)=")\/(moto|font|lib)\//g, '$1$2/'));
    symlinkSync(path.join(ROOT, 'web/moto'), path.join(s, 'moto'));
    symlinkSync(path.join(ROOT, 'web/font'), path.join(s, 'font'));
    mkdirSync(path.join(s, 'lib/ext'), { recursive: true });
    symlinkSync(path.join(ROOT, 'src/ext/tween.js'), path.join(s, 'lib/ext/tween.js'));
    mkdirSync(path.join(s, 'lib/kiri'), { recursive: true });
    symlinkSync(path.join(ROOT, 'src/wasm'), path.join(s, 'lib/kiri/wasm'));
    put(s, 'lib/gpu/raster-worker.js');
    bundles(s);
    const S = precacheList(s, PRE);
    const srcHtml = readFileSync(path.join(kiri, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    for (const m of srcHtml.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)) {
        const ref = m[1];
        if (/^(https?:|\/\/)/.test(ref)) continue;
        const rel = ref.replace(/^\/(moto|font|lib)\//, '$1/');
        assert.ok(S.includes(rel), `the page loads ${ref}; the offline list has it`);
    }
    // files swarf's scripts load by name, as of this writing; the list must keep finding them
    for (const w of ['swarf-materials.json', 'swarf-tex-worker.mjs', 'swarf-tex-core.mjs', 'vendor/opentype/opentype.min.js',
        'moto/russo-one.ttf', 'vendor/unreason/arrangement.mjs', 'vendor/unreason/trim.mjs', 'vendor/unreason/exchange-2d.mjs',
        'vendor/unreason/exchange-2d-read.mjs', 'vendor/font/ibm-plex-mono-400.woff2', 'vendor/font/renato-symbols-600.woff2',
        'font/webfonts/fa-solid-900.woff2', 'swarf-icon-512.png', 'lib/kiri/wasm/manifold.wasm', 'lib/kiri/wasm/kiri-geo.wasm', ...ENGINE])
        assert.ok(S.includes(w), `the offline list has ${w}`);
    // every file a swarf script or module names in a plain string, and that the app ships, is listed
    for (const f of readdirSync(kiri).filter((f) => /^swarf.*\.m?js$/.test(f) && S.includes(f))) {
        for (const m of readFileSync(path.join(kiri, f), 'utf8').matchAll(/['"`]((?:\.\/)?(?:vendor\/[\w./-]+|swarf[\w.-]*\.(?:m?js|json|css)))['"`]/g)) {
            const rel = m[1].replace(/^\.\//, '');
            if (existsSync(path.join(kiri, rel)) && rel !== 'swarf-sw.js' && rel !== 'swarf-sw-core.js' && !/^swarf-markup/.test(rel)) {
                assert.ok(S.includes(rel) || S.some((u) => u.startsWith(rel + '?')), `${f} names ${rel}; the offline list has it`);
            }
        }
    }
    // the service worker's own files are the browser's to keep, not the list's
    for (const n of ['swarf-sw.js', 'swarf-sw-core.js']) assert.ok(!S.includes(n), `not listed: ${n}`);

    // 3. the published copy, when it sits beside this repo (read only)
    const site = process.env.SWARF_WEB_REPO ? path.join(process.env.SWARF_WEB_REPO, 'swarf-app') : path.join(ROOT, '../../philrenato-web/swarf-app');
    if (existsSync(path.join(site, 'index.html'))) {
        const P = precacheList(site, PRE);
        for (const w of ['.', 'index.html', 'lib/main/kiri.js', 'lib/kiri/run/worker.js', 'lib/kiri/run/minion.js', 'lib/kiri/wasm/kiri-geo.wasm',
            'lib/kiri/wasm/manifold.wasm', 'lib/ext/tween.js', 'font/js/all.min.js', 'moto/palette.css', 'swarf-materials.json'])
            assert.ok(P.includes(w), `the site's list has ${w}`);
        console.log(`precache-list: the site lists ${P.length} files`);
    } else {
        console.log('precache-list: no site copy beside the repo; its check is skipped');
    }
} finally {
    rmSync(tmp, { recursive: true, force: true });
}
console.log('precache-list: ok');
