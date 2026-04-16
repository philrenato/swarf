#!/usr/bin/env node
/**
 * Probe the swarf phone takeover. Boot at 390×844 (iPhone 15-ish),
 * assert the wall is visible and the underlying UI is hidden.
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://localhost:8181/kiri/';

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
    args: ['--enable-webgl', '--use-gl=angle', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});

const out = { console: [], errors: [] };
try {
    const page = await browser.newPage();
    page.on('console', m => out.console.push({ t: m.type(), m: m.text() }));
    page.on('pageerror', e => out.errors.push({ kind: 'pageerror', m: e.message }));

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 1500));

    out.phoneWall = await page.evaluate(() => {
        const w = document.getElementById('swarf-phone-wall');
        const bodyClass = document.body.className;
        const hidden = document.getElementById('container');
        const menubar = document.getElementById('menubar');
        // sample several direct children of body to see which leak through
        const leaks = [];
        for (const child of document.body.children) {
            const s = getComputedStyle(child);
            leaks.push({
                id: child.id || child.tagName,
                display: s.display,
                visibility: s.visibility,
                isWall: child.id === 'swarf-phone-wall'
            });
        }
        return {
            wallExists: !!w,
            wallVisible: w ? getComputedStyle(w).display !== 'none' : false,
            bodyHasSwarfPhone: /\bswarf-phone\b/.test(bodyClass),
            mainContainerDisplay: hidden ? getComputedStyle(hidden).display : null,
            menubarDisplay: menubar ? getComputedStyle(menubar).display : null,
            mark: w?.querySelector('.swarf-phone-mark')?.textContent?.trim(),
            headline: w?.querySelector('.swarf-phone-headline')?.textContent?.trim(),
            leaks
        };
    });

    await page.screenshot({ path: '/tmp/swarf-phone.png', fullPage: false });
    out.screenshot = '/tmp/swarf-phone.png';
} catch (e) {
    out.errors.push({ kind: 'host-throw', m: e.message });
} finally {
    await browser.close();
    console.log(JSON.stringify(out, null, 2));
}
