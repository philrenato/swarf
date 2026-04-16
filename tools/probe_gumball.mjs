import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport:{width:1600,height:1000}, args:['--enable-webgl','--use-gl=angle','--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto('http://localhost:8181/kiri/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.kiri && window.kiri.api), { timeout: 15000 });
    await new Promise(r => setTimeout(r, 2500));

    const input = await page.$('input[type=file]');
    await input.uploadFile('/Users/philrenato/Desktop/1.stl');
    await new Promise(r => setTimeout(r, 4500));

    const state = await page.evaluate(() => {
        const g = window.__swarfGumball;
        if (!g) return { err: 'no gumball exposed' };
        const inst = g.instance;
        const widget = g.widget;
        return {
            hasInstance: !!inst,
            visible: inst?.visible,
            mode: inst && inst.getMode ? inst.getMode() : null,
            size: inst?.size,
            attached: !!widget,
            widgetSelected: window.kiri.api.selection.count() > 0
        };
    });
    console.log('post-load:', JSON.stringify(state));

    // switch to rotate mode via keyboard
    await page.keyboard.press('e');
    await new Promise(r => setTimeout(r, 200));
    const afterE = await page.evaluate(() => ({ mode: window.__swarfGumball?.instance?.getMode() }));
    console.log('after E:', JSON.stringify(afterE));

    await page.keyboard.press('r');
    await new Promise(r => setTimeout(r, 200));
    console.log('after R:', JSON.stringify(await page.evaluate(() => ({ mode: window.__swarfGumball?.instance?.getMode() }))));

    await page.keyboard.press('w');
    await new Promise(r => setTimeout(r, 200));
    console.log('after W:', JSON.stringify(await page.evaluate(() => ({ mode: window.__swarfGumball?.instance?.getMode() }))));

    await page.screenshot({ path: '/tmp/swarf-gumball.png' });
    if (errs.length) console.log('ERRORS:', errs);
} finally { await browser.close(); }
