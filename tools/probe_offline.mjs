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
import { mkdtempSync, rmSync, readFileSync, writeFileSync as writeRaw, renameSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CHROME } from './chrome-path.mjs';

const [siteDir, portArg] = process.argv.slice(2);
if (!siteDir) { console.error('usage: node tools/probe_offline.mjs <site folder> [port]'); process.exit(2); }
const PORT = +(portArg || 8791);
const APP = `http://127.0.0.1:${PORT}/swarf-app/`;
const app = path.join(siteDir, 'swarf-app');
// the test server dates files to the second: each write gets a later time than the last, or the
// browser's revalidation is told "not modified" and keeps an older copy
let stampT = Math.floor(Date.now() / 1000) + 10;
const writeFileSync = (f, text) => { writeRaw(f, text); stampT += 2; utimesSync(f, stampT, stampT); };
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
        executablePath: CHROME, headless: 'new', userDataDir: profile, protocolTimeout: 300000,
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
        // each page notes when its curtain lifts: only the page that stays may have (a press on a
        // page that loads again is lost)
        const t = setInterval(() => {
            const c = document.getElementById('curtain');
            if (!c || c.style.display !== 'none') return;
            clearInterval(t);
            try { const log = JSON.parse(sessionStorage.getItem('probe-curtain') || '[]'); log.push(performance.timeOrigin); sessionStorage.setItem('probe-curtain', JSON.stringify(log)); } catch (e) { /* no storage */ }
        }, 20);
    });
    const settle = async () => {
        await page.waitForFunction(() => window.crossOriginIsolated && navigator.serviceWorker.controller && window.__engine.length && window.SWARF_BUILD && document.getElementById('ver') && window.kiri, { timeout: 90000, polling: 500 });
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
    const gone1 = await page.evaluate(() => ({ lifted: JSON.parse(sessionStorage.getItem('probe-curtain') || '[]'), me: performance.timeOrigin }));
    check('first visit: no page that loaded again had lifted its curtain', gone1.lifted.length === 1 && gone1.lifted[0] === gone1.me, gone1);
    check('first visit: the cache holds every listed file', caches1[`swarf-shell-${stamp}`] >= listed.length, { caches: caches1, listed: listed.length });
    const eng = await page.evaluate(() => ({ e: window.__engine, b: window.SWARF_BUILD, url: window.__workerUrl, builds: window.SWARF_BUILDS }));
    check('engine reports the page\'s build, asked for by build', eng.e[0] && eng.e[0].engine === eng.b && eng.url.includes(`?b=${eng.b}`) && !(eng.builds || {})['CAM engine'], eng);

    // 1b. the version stamp's update with no newer build: a real button, by keyboard; every cache stays whole
    await page.evaluate(async () => { await (await caches.open('other-app-test')).put('/unrelated', new Response('keep')); });
    const btn = await page.evaluate(() => { const v = document.getElementById('ver'); return { tag: v.tagName, label: v.getAttribute('aria-label') }; });
    check('version stamp is a button with a name', btn.tag === 'BUTTON' && /check for an update/.test(btn.label || ''), btn);
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }), page.evaluate(() => document.getElementById('ver').click())]);
    await settle();
    const caches1b = await cacheState();
    check('same-build update: the offline copy stays whole, other caches untouched',
        caches1b[`swarf-shell-${stamp}`] === caches1[`swarf-shell-${stamp}`] && caches1b['other-app-test'] === 1, { caches: caches1b });
    await page.evaluate(async () => { await caches.delete('other-app-test'); });

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
    // the same failed install, from the version stamp: it says so and keeps this build
    writeFileSync(swFile, swText.replace(`'${stamp}'`, `'${stamp}-next2'`));
    await page.evaluate(() => document.getElementById('ver').click());
    const said = await page.waitForFunction(() => /could not finish/.test(document.getElementById('ver').textContent), { timeout: 60000, polling: 300 }).then(() => true, () => false);
    const caches2b = await cacheState();
    check('failed install from the stamp: a plain note, no reload, complete cache kept', said && caches2b[`swarf-shell-${stamp}`] === caches1[`swarf-shell-${stamp}`] && !caches2b[`swarf-shell-${stamp}-next2`], { said, caches: caches2b });
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

    // 3b. a browser with no service worker can never be isolated: the curtain still lifts, within seconds
    {
        const ctx = await browser.createBrowserContext();
        const p2 = await ctx.newPage();
        await p2.evaluateOnNewDocument(() => { try { delete Navigator.prototype.serviceWorker; } catch (e) { /* kept */ } });
        const t0 = Date.now();
        await p2.goto(APP, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const up = await p2.waitForFunction(() => { const c = document.getElementById('curtain'); return c && c.style.display === 'none' && !!window.kiri; }, { timeout: 30000, polling: 100 }).then(() => true, () => false);
        check('no service worker: the curtain lifts within seconds', up && Date.now() - t0 < 20000, { s: (Date.now() - t0) / 1000, isolated: await p2.evaluate(() => window.crossOriginIsolated) });
        await ctx.close();
    }

    // 4. offline: the server stops and the browser goes offline
    await stop();
    await page.setOfflineMode(true);
    // every listed file answers from the offline copy (no-store: not the browser's HTTP cache)
    const lost = await page.evaluate(async (list) => {
        const bad = [];
        for (const f of list) {
            try { const r = await fetch(new URL(f, location.href).href, { cache: 'no-store' }); if (!r.ok) bad.push(`${f} ${r.status}`); } catch (e) { bad.push(`${f} ${e.message}`); }
        }
        return bad;
    }, listed);
    check('offline: every listed file answers from the offline copy', lost.length === 0, lost.slice(0, 8));
    errors.length = 0;
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await settle();
    await page.waitForFunction(() => window.__engine && window.__engine.length, { timeout: 60000, polling: 500 }).catch(() => {});
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

