import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport:{width:1600,height:1000}, args:['--enable-webgl','--use-gl=angle','--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    await page.goto('http://localhost:8181/kiri/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window.kiri && window.kiri.api), { timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));

    // hook up event capture
    await page.evaluate(() => {
        window.__ev = [];
        const targets = ['widget.add', 'widget.delete', 'widgets.loaded', 'load.url', 'platform.layout', 'render.complete'];
        for (const t of targets) {
            window.kiri.api.event.on(t, (payload) => {
                window.__ev.push({ t: t, ts: Date.now(), hasPayload: !!payload, widgetCount: window.kiri.api.widgets.all().length });
            });
        }
        // also intercept space.view.fit to log calls
        const sp = window.moto?.space;
        if (sp && sp.view && sp.view.fit) {
            const orig = sp.view.fit.bind(sp.view);
            sp.view.fit = function(...args) {
                window.__ev.push({ t: 'space.view.fit', ts: Date.now(), args: args.map(a => a && typeof a === 'object' ? Object.keys(a) : String(a)) });
                return orig(...args);
            };
        }
    });

    const input = await page.$('input[type=file]');
    await input.uploadFile('/Users/philrenato/Desktop/1.obj');
    await new Promise(r => setTimeout(r, 4000));

    const events = await page.evaluate(() => window.__ev);
    const t0 = events[0]?.ts;
    console.log(JSON.stringify(events.map(e => ({...e, ts: t0 ? e.ts - t0 : 0})), null, 2));
} finally { await browser.close(); }
