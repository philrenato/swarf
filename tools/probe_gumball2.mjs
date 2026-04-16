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
        const widget = g?.widget;
        const modes = Object.keys(g?.controls || {});
        const widgetPos = widget?.track?.pos;
        const bb = widget?.getBoundingBox();
        return {
            modeCount: modes.length,
            hasWidget: !!widget,
            widgetPos,
            bottomZ: bb ? bb.min.z + (widgetPos?.z || 0) : null,
            tcVisible: modes.every(m => g.controls[m]?.visible)
        };
    });
    console.log('state:', JSON.stringify(state));

    // fire snapBottom
    await page.evaluate(() => window.__swarfGumball.snapBottom());
    await new Promise(r => setTimeout(r, 200));
    const afterSnap = await page.evaluate(() => {
        const w = window.__swarfGumball?.widget;
        const bb = w?.getBoundingBox();
        return {
            bottomZ: bb ? bb.min.z + (w.track?.pos?.z || 0) : null,
            pos: w?.track?.pos
        };
    });
    console.log('after snapBottom:', JSON.stringify(afterSnap));

    await page.screenshot({ path: '/tmp/swarf-gumball2.png' });
    if (errs.length) console.log('ERRORS:', errs.slice(0,3));
} finally { await browser.close(); }
