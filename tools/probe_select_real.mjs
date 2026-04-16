import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport:{width:1600,height:1000}, args:['--enable-webgl','--use-gl=angle','--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    await page.goto('http://localhost:8181/kiri/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.kiri && window.kiri.api), { timeout: 15000 });
    await new Promise(r => setTimeout(r, 2500));
    const input = await page.$('input[type=file]');
    await input.uploadFile('/Users/philrenato/Desktop/1.stl');
    await new Promise(r => setTimeout(r, 4000));

    const state = await page.evaluate(() => {
        const api = window.kiri.api;
        const ws = api.widgets.all();
        const w = ws[0];
        return {
            widgetCount: ws.length,
            selectedCount: api.selection.count(),
            widgetColor: null
        };
    });
    console.log(JSON.stringify(state));
} finally { await browser.close(); }
