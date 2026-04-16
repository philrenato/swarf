import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport:{width:1600,height:1000}, args:['--enable-webgl','--use-gl=angle','--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    await page.goto('http://localhost:8181/kiri/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.kiri && window.kiri.api), { timeout: 15000 });
    await new Promise(r => setTimeout(r, 2500));
    const input = await page.$('input[type=file]');
    await input.uploadFile('/Users/philrenato/Desktop/1.stl');
    await new Promise(r => setTimeout(r, 4500));  // allow auto-select 300ms timer

    const pre = await page.evaluate(() => {
        const api = window.kiri.api;
        const w = api.widgets.all()[0];
        return { selectedCount: api.selection.count(), pos: w ? { x: w.track.pos.x, y: w.track.pos.y } : null };
    });
    console.log('pre:', JSON.stringify(pre));

    // open move panel
    const movePanelExists = await page.evaluate(() => !!document.getElementById('context-move-panel'));
    console.log('movePanelExists:', movePanelExists);
    await page.evaluate(() => document.getElementById('context-move-panel')?.click());
    await new Promise(r => setTimeout(r, 300));
    // click +X (default 10mm)
    await page.click('#mov_x_gt');
    await new Promise(r => setTimeout(r, 300));
    const afterX = await page.evaluate(() => {
        const w = window.kiri.api.widgets.all()[0];
        return { pos: { x: w.track.pos.x, y: w.track.pos.y } };
    });
    console.log('after +X 10mm:', JSON.stringify(afterX));

    await page.click('#mov_y_gt');
    await new Promise(r => setTimeout(r, 300));
    const afterY = await page.evaluate(() => {
        const w = window.kiri.api.widgets.all()[0];
        return { pos: { x: w.track.pos.x, y: w.track.pos.y } };
    });
    console.log('after +Y 10mm:', JSON.stringify(afterY));

    // test center button
    await page.click('#mov_center');
    await new Promise(r => setTimeout(r, 300));
    const afterCenter = await page.evaluate(() => {
        const w = window.kiri.api.widgets.all()[0];
        return { pos: { x: w.track.pos.x, y: w.track.pos.y } };
    });
    console.log('after center:', JSON.stringify(afterCenter));
} finally { await browser.close(); }
