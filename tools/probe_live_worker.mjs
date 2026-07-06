import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const stlB64 = readFileSync('/Users/philrenato/Desktop/1.stl').toString('base64');
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport:{width:1600,height:1000}, args:['--enable-webgl','--use-gl=angle','--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    const log = [];
    page.on('console', m => { const t = m.text(); if (t.length) log.push({ t: m.type(), m: t }); });
    page.on('pageerror', e => log.push({ t: 'pageerror', m: e.message }));

    await page.goto('https://renato.design/swarf-app/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 8000));
    await page.waitForFunction(() => !!(window.kiri && window.kiri.api && window.kiri.api.client), { timeout: 25000 });
    await new Promise(r => setTimeout(r, 3000));

    // check client worker state
    const state = await page.evaluate(async () => {
        const api = window.kiri.api;
        return {
            clientKeys: Object.keys(api.client || {}),
            clientSend: typeof api.client?.send,
            crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : 'undefined',
            hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
        };
    });
    console.log('state:', JSON.stringify(state));

    // try a direct worker ping through the client
    const ping = await page.evaluate(async () => {
        const api = window.kiri.api;
        if (!api.client) return { err: 'no client' };
        // try api.client.ping or similar health check
        return {
            hasStart: typeof api.client.start,
            methods: Object.keys(api.client).filter(k => typeof api.client[k] === 'function').slice(0,15)
        };
    });
    console.log('client:', JSON.stringify(ping));

    // print recent console
    for (const l of log.slice(-30)) console.log(l.t+':', (l.m||'').slice(0,200));
} finally { await browser.close(); }
