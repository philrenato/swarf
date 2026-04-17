import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', defaultViewport:{width:1600,height:1000}, args:['--enable-webgl','--use-gl=angle','--enable-unsafe-swiftshader'] });
try {
    const page = await browser.newPage();
    const log = [];
    page.on('console', m => { const t=m.text(); if (t.length) log.push({ t: m.type(), m: t.slice(0,200) }); });
    page.on('pageerror', e => log.push({ t: 'pageerror', m: e.message.slice(0,200) }));

    await page.goto('https://renato.design/swarf-app/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // check every second for 25 seconds whether the curtain lifted
    const timeline = [];
    for (let i = 1; i <= 25; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const state = await page.evaluate(() => {
            const c = document.getElementById('curtain');
            return {
                curtainExists: !!c,
                curtainDisplay: c ? window.getComputedStyle(c).display : null,
                curtainStuckClass: c?.classList?.contains('is-stuck'),
                kiriReady: !!(window.kiri && window.kiri.api),
                resetBtnVisible: document.getElementById('swarf-hard-reset')?.offsetParent !== null
            };
        }).catch(()=>({err:'eval'}));
        timeline.push({ s: i, ...state });
        if (state.curtainDisplay === 'none') { console.log(`curtain lifted at t=${i}s`); break; }
    }

    console.log('timeline:');
    for (const t of timeline) console.log(' ', JSON.stringify(t));
    console.log('log tail:');
    for (const l of log.slice(-15)) console.log(' ', l.t + ':', l.m);
} finally { await browser.close(); }
