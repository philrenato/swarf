// Offline probe of a deploy-shaped copy of the app (a site folder holding swarf-app/, made by the
// deploy's copy steps). It serves the folder itself on 127.0.0.1 so it can stop the server.
//   node tools/probe_offline.mjs <site folder> [port]
// 1. first visit: the worker installs with every listed file, the page is isolated, the engine reports its build
// 2. an install that cannot fetch one file fails and leaves the complete cache and the worker in charge
// 3. an engine from another build: the page reloads once and then says so
// 4. offline (server stopped and the browser offline): a reload brings the app and the engine back
// A fresh browser profile in the system temp folder; nothing is downloaded.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CHROME } from './chrome-path.mjs';

const [siteDir, portArg] = process.argv.slice(2);
if (!siteDir) { console.error('usage: node tools/probe_offline.mjs <site folder> [port]'); process.exit(2); }
const PORT = +(portArg || 8791);
const APP = `http://127.0.0.1:${PORT}/swarf-app/`;
const app = path.join(siteDir, 'swarf-app');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info !== undefined ? ' ' + JSON.stringify(info) : ''}`); };

let server = null;
const serve = async () => {
    server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: siteDir, stdio: 'ignore' });
    for (let i = 0; i < 50; i++) { try { if ((await fetch(APP)).ok) return; } catch (e) { /* not yet */ } await sleep(100); }
    throw new Error('server did not start');
};
const stop = async () => { if (server) { server.kill('SIGTERM'); await new Promise((r) => server.once('exit', r)); server = null; } };

const profile = mkdtempSync(path.join(tmpdir(), 'swarf-offline-profile-'));
const swFile = path.join(app, 'swarf-sw.js');
const workerFile = path.join(app, 'lib/kiri/run/worker.js');
const swText = readFileSync(swFile, 'utf8');
const workerText = readFileSync(workerFile, 'utf8');
const stamp = (swText.match(/const CACHE_STAMP = '([^']+)'/) || [])[1];
const listed = JSON.parse((swText.match(/const PRECACHE = (\[[^\]]*\])/) || [])[1] || '[]');
let browser;
try {
    await serve();
    browser = await puppeteer.launch({
        executablePath: CHROME, headless: 'new', userDataDir: profile,
        args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // the engine's build message, as the page receives it
    await page.evaluateOnNewDocument(() => {
        window.__engine = [];
        const W = window.Worker;
        window.Worker = function (url, opts) {
            const w = new W(url, opts);
            w.addEventListener('message', (e) => { if (e.data && e.data.task === 'engine.build') window.__engine.push(e.data.data); });
            if (/run\/worker\.js/.test(String(url))) window.__workerUrl = String(url);
            return w;
        };
        window.Worker.prototype = W.prototype;
    });
    const settle = async () => {
        await page.waitForFunction(() => window.crossOriginIsolated && navigator.serviceWorker.controller && window.__engine.length, { timeout: 90000 });
        await sleep(1500);
    };
    const cacheState = () => page.evaluate(async () => {
        const out = {};
        for (const k of await caches.keys()) out[k] = (await (await caches.open(k)).keys()).length;
        return out;
    });

    // 1. first visit
    await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await settle();
    let caches1 = await cacheState();
    check('first visit: page isolated and controlled', await page.evaluate(() => window.crossOriginIsolated && !!navigator.serviceWorker.controller));
    check('first visit: the cache holds every listed file', caches1[`swarf-shell-${stamp}`] >= listed.length, { caches: caches1, listed: listed.length });
    const eng = await page.evaluate(() => ({ e: window.__engine, b: window.SWARF_BUILD, url: window.__workerUrl, builds: window.SWARF_BUILDS }));
    check('engine reports the page\'s build, asked for by build', eng.e[0] && eng.e[0].engine === eng.b && eng.url.includes(`?b=${eng.b}`) && !(eng.builds || {})['CAM engine'], eng);

    // 2. a new deploy whose install cannot fetch one file
    const gone = path.join(app, 'swarf-materials.json');
    renameSync(gone, gone + '.away');
    writeFileSync(swFile, swText.replace(`'${stamp}'`, `'${stamp}-next'`));
    const upd = await page.evaluate(async () => {
        const r = await navigator.serviceWorker.getRegistration();
        try { await r.update(); } catch (e) { return 'update threw: ' + e.message; }
        const w = r.installing;
        if (!w) return 'no install';
        return await new Promise((res) => { w.addEventListener('statechange', () => { if (w.state === 'redundant' || w.state === 'activated') res(w.state); }); setTimeout(() => res('timeout ' + w.state), 30000); });
    });
    const caches2 = await cacheState();
    check('failed install: new worker discarded, complete cache kept', upd === 'redundant' && caches2[`swarf-shell-${stamp}`] === caches1[`swarf-shell-${stamp}`] && !caches2[`swarf-shell-${stamp}-next`], { upd, caches: caches2 });
    renameSync(gone + '.away', gone);
    writeFileSync(swFile, swText);

    // 3. the engine from another build (an update that landed while the page loaded)
    writeFileSync(workerFile, workerText.split(`"${stamp}"`).join('"some-other-build"'));
    await page.evaluate(() => { try { sessionStorage.removeItem('swarf-build-reload'); } catch (e) { } });
    let navs = 0;
    const onNav = (f) => { if (f === page.mainFrame()) navs++; };
    page.on('framenavigated', onNav);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(12000);
    const note = await page.evaluate(() => ({ ver: (document.getElementById('ver') || {}).textContent, builds: window.SWARF_BUILDS && window.SWARF_BUILDS['CAM engine'] }));
    page.off('framenavigated', onNav);
    check('another engine build: one reload, then a plain note', navs === 2 && /two swarf builds/.test(note.ver || '') && note.builds === 'some-other-build', { navs, note });
    writeFileSync(workerFile, workerText);
    await page.evaluate(() => { try { sessionStorage.removeItem('swarf-build-reload'); } catch (e) { } });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settle();

    // 4. offline: the server stops and the browser goes offline
    await stop();
    await page.setOfflineMode(true);
    errors.length = 0;
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await settle();
    const off = await page.evaluate(() => ({
        isolated: window.crossOriginIsolated, engine: window.__engine, ver: (document.getElementById('ver') || {}).textContent,
        kiri: !!(window.kiri && window.kiri.api), styled: getComputedStyle(document.body).fontFamily,
    }));
    check('offline reload: app, styles and engine come back from the cache', off.isolated && off.engine.length && off.kiri && !/two swarf builds/.test(off.ver || ''), off);
    check('offline reload: no page errors', errors.length === 0, errors.slice(0, 5));
} catch (e) {
    check('probe ran', false, e.message);
} finally {
    writeFileSync(swFile, swText);
    writeFileSync(workerFile, workerText);
    if (browser) await browser.close();
    await stop();
    rmSync(profile, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `offline probe: ${failed} failed` : 'offline probe: ok');
process.exit(failed ? 1 : 0);
