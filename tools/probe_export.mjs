#!/usr/bin/env node
/**
 * Probe: click "export work" menu and capture what happens.
 * Focus: (1) does the modal/prompt appear, (2) does api.client.zip respond,
 * (3) does api.util.download get called with a Blob/ArrayBuffer?
 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://localhost:8181/kiri/';
const STL = '/Users/philrenato/Desktop/1.stl';
const stlB64 = readFileSync(STL).toString('base64');

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    defaultViewport: { width: 1600, height: 1000 },
    args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

const out = { console: [], errors: [], steps: {}, downloads: [] };

try {
    const page = await browser.newPage();
    page.on('console', m => out.console.push({ t: m.type(), m: m.text() }));
    page.on('pageerror', e => out.errors.push({ kind: 'pageerror', m: e.message, s: e.stack }));
    page.on('requestfailed', r => out.errors.push({ kind: 'requestfailed', url: r.url(), f: r.failure()?.errorText }));

    // capture downloads
    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: '/tmp' });

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForFunction(() => !!(window.kiri?.api?.event), { timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));

    // add a widget so there's something to export
    await page.evaluate((b64) => {
        const bin = atob(b64);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        const dv = new DataView(buf.buffer);
        const n = dv.getUint32(80, true);
        const verts = new Float32Array(n * 9);
        let vi = 0;
        for (let i = 0; i < n; i++) {
            const off = 84 + i * 50 + 12;
            for (let v = 0; v < 9; v++) verts[vi++] = dv.getFloat32(off + v * 4, true);
        }
        const w = window.kiri.api.new.widget().loadVertices(verts);
        window.kiri.api.platform.add(w);
    }, stlB64);
    await new Promise(r => setTimeout(r, 1000));

    // instrument api.util.download so we can see invocation
    await page.evaluate(() => {
        const api = window.kiri.api;
        window.__swarfDownloadCalls = [];
        const orig = api.util.download.bind(api.util);
        api.util.download = (data, name) => {
            const info = {
                name,
                dataType: typeof data,
                isBlob: data instanceof Blob,
                isArrayBuffer: data instanceof ArrayBuffer,
                isUint8Array: data instanceof Uint8Array,
                size: data?.byteLength ?? data?.size ?? data?.length ?? null,
                constructorName: data?.constructor?.name
            };
            window.__swarfDownloadCalls.push(info);
            try { return orig(data, name); } catch (e) { info.throw = e.message; }
        };
    });

    // instrument api.client.zip + api.uc.confirm to see what's happening
    await page.evaluate(() => {
        window.__swarfHits = [];
        const api = window.kiri.api;
        const origZip = api.client.zip?.bind(api.client);
        api.client.zip = (...args) => {
            window.__swarfHits.push({ fn: 'client.zip', argLen: args.length, firstEntryName: args[0]?.[0]?.name });
            return origZip?.(...args);
        };
        const origConfirm = api.uc.confirm?.bind(api.uc);
        api.uc.confirm = (...args) => {
            window.__swarfHits.push({ fn: 'uc.confirm', title: args[0], defName: args[2] });
            return origConfirm?.(...args);
        };
        // also hook onclick on #app-export to see whether it fires
        const el = document.getElementById('app-export');
        if (el) {
            const originalOnclick = el.onclick;
            el.onclick = (ev) => {
                window.__swarfHits.push({ fn: 'app-export.onclick', hadHandler: typeof originalOnclick === 'function' });
                if (typeof originalOnclick === 'function') return originalOnclick.call(el, ev);
            };
        } else {
            window.__swarfHits.push({ fn: 'app-export-missing' });
        }
    });
    const zipInfo = await page.evaluate(() => ({ hasClientZip: typeof window.kiri?.api?.client?.zip === 'function' }));
    out.steps.zipInfo = zipInfo;

    // find the app-export button and click it (this is the menu item)
    const clicked = await page.evaluate(() => {
        const el = document.getElementById('app-export');
        if (!el) return { ok: false, reason: 'no #app-export' };
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        el.click();
        return { ok: true, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, display: style.display, visibility: style.visibility };
    });
    out.steps.clicked = clicked;
    await new Promise(r => setTimeout(r, 800));

    // if a prompt/modal appeared, look for it and auto-accept
    const modalState = await page.evaluate(() => {
        const modal = document.getElementById('modal');
        const visible = modal && getComputedStyle(modal).display !== 'none';
        const ucInput = document.querySelector('#mod-any input, #mod-any textarea');
        const okBtn = document.querySelector('#mod-any button.ok, #mod-any button[data-action="ok"], #mod-any .ok');
        return {
            modalVisible: visible,
            hasUcInput: !!ucInput,
            ucInputValue: ucInput?.value,
            hasOk: !!okBtn,
            modAnyHtml: document.getElementById('mod-any')?.innerHTML?.slice(0, 600)
        };
    });
    out.steps.modalState = modalState;

    // fill the filename + click ok on the <dialog id="dialog">
    const completed = await page.evaluate(() => {
        const d = document.getElementById('dialog');
        if (!d) return { err: 'no dialog' };
        const input = d.querySelector('input[type=text]');
        if (input) input.value = 'workspace_test';
        const btns = Array.from(d.querySelectorAll('button'));
        const okBtn = btns.find(b => /ok|save|export|yes/i.test(b.textContent || ''));
        if (okBtn) { okBtn.click(); return { clicked: okBtn.textContent, btns: btns.map(b => b.textContent) }; }
        return { clicked: null, btns: btns.map(b => b.textContent) };
    });
    out.steps.completed = completed;
    await new Promise(r => setTimeout(r, 4000)); // wait for zip

    // check the download calls
    out.steps.downloadCalls = await page.evaluate(() => window.__swarfDownloadCalls);
    out.steps.hits = await page.evaluate(() => window.__swarfHits);
    // inspect dialog state
    out.steps.dialogState = await page.evaluate(() => {
        const d = document.getElementById('dialog');
        if (!d) return { err: 'no #dialog element' };
        return {
            tagName: d.tagName,
            open: d.open,
            hasShowModal: typeof d.showModal,
            inDom: document.body.contains(d),
            innerHTML: d.innerHTML?.slice(0, 500),
            displayComputed: getComputedStyle(d).display
        };
    });

} catch (e) {
    out.errors.push({ kind: 'host-throw', m: e.message, s: e.stack });
} finally {
    await browser.close();
    console.log(JSON.stringify(out, null, 2));
}
