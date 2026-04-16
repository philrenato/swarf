import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
    args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const out = { errors: [], nav: [] };
try {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    // capture stack trace on any location assignment
    await page.evaluateOnNewDocument(() => {
        window.__navStack = [];
        const origAssign = window.location.assign?.bind(window.location);
        const origReplace = window.location.replace?.bind(window.location);
        // try to hook via property descriptor — best effort
        try {
            window.location.assign = function(url) {
                window.__navStack.push({ m: 'assign', url, stack: new Error().stack });
                return origAssign(url);
            };
            window.location.replace = function(url) {
                window.__navStack.push({ m: 'replace', url, stack: new Error().stack });
                return origReplace(url);
            };
        } catch (e) { console.error('hook fail', e); }
    });
    page.on('pageerror', e => out.errors.push(e.message));
    page.on('framenavigated', f => out.nav.push({ url: f.url(), main: f === page.mainFrame() }));
    page.on('response', r => { if (r.status() >= 300 && r.status() < 400) out.nav.push({ redirect: r.status(), url: r.url(), loc: r.headers().location }); });
    await page.goto('http://localhost:8765/swarf-app/index.html', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await new Promise(r => setTimeout(r, 4000));
    out.htmlSource = (await page.content()).slice(0, 5000);
    out.url = page.url();
    out.title = await page.title();
    out.navStack = await page.evaluate(() => window.__navStack || 'not-set');
    out.wall = await page.evaluate(() => {
        const w = document.getElementById('swarf-phone-wall');
        const mq1 = window.matchMedia('(max-width: 820px)');
        const mq2 = window.matchMedia('(pointer: coarse)');
        return {
            exists: !!w,
            bodyClass: document.body.className,
            headline: w?.querySelector('.swarf-phone-headline')?.textContent,
            innerW: window.innerWidth, innerH: window.innerHeight,
            mq_maxwidth820: mq1.matches,
            mq_pointerCoarse: mq2.matches,
            hasScript: !!document.querySelector('script[src*="swarf-phone.js"]'),
            localStorage_pref: localStorage.getItem('swarf_phone_mode')
        };
    });
    await page.screenshot({ path: '/tmp/swarf-deploy-phone.png' });
} finally { await browser.close(); console.log(JSON.stringify(out, null, 2)); }
