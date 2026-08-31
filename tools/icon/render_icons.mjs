/**
 * Render tools/icon/swarf-icon.svg to the PWA icon PNGs the manifest names.
 * Uses headless Chrome so the mono face and gradients rasterise exactly as
 * the browser would draw them.
 *
 * Usage: node tools/icon/render_icons.mjs
 */
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// 128 and up carry the second chip; below that it reads as noise, so the
// small sizes render from a simplified variant with only the main curl.
const SIZES = [64, 128, 144, 256, 512];
const full = readFileSync('tools/icon/swarf-icon-curl.svg', 'utf8');
const small = readFileSync('tools/icon/swarf-icon-curl-small.svg', 'utf8');

const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--force-device-scale-factor=1', '--hide-scrollbars'],
});
try {
    for (const s of SIZES) {
        const svg = s >= 128 ? full : small;
        const page = await browser.newPage();
        await page.setViewport({ width: s, height: s, deviceScaleFactor: 1 });
        await page.setContent(
            `<style>html,body{margin:0;padding:0;background:transparent}
             svg{display:block;width:${s}px;height:${s}px}</style>${svg}`,
            { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        const buf = await page.screenshot({ omitBackground: true });
        writeFileSync(`web/kiri/swarf-icon-${s}.png`, buf);
        await page.close();
        console.log(`web/kiri/swarf-icon-${s}.png`);
    }
} finally {
    await browser.close();
}
