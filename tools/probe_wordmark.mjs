// the wordmark is Helvetica in every skin, on the curtain too (Phil 11-06). A PC without it shows Arial.
//   node tools/probe_wordmark.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const url = process.argv[2] || 'http://localhost:8080/kiri/';
const bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-mark-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const curtain = await page.evaluate(() => { const e = document.querySelector('#curtain h1.swarf-display'); return e ? getComputedStyle(e).fontFamily : ''; });
  check(/^Helvetica\b/.test(curtain), `the curtain (${curtain})`);
  await page.waitForFunction(() => document.querySelector('.swarf-wordmark') && window.kiri?.api?.platform?.load_svg, { timeout: 90000, polling: 200 });
  await new Promise(r => setTimeout(r, 1500));
  const cdp = await page.createCDPSession(); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  for (const skin of ['glass', 'classic', null]) {
    await page.evaluate(k => { if (k) document.documentElement.dataset.skin = k; else delete document.documentElement.dataset.skin; }, skin);
    await new Promise(r => setTimeout(r, 300));
    const fam = await page.evaluate(() => [...document.querySelectorAll('.swarf-wordmark, .swarf-wordmark *')].filter(e => e.textContent.trim()).map(e => getComputedStyle(e).fontFamily));
    check(fam.length && fam.every(f => /^Helvetica\b/.test(f)), `${skin || 'swarf'} skin asks for it (${[...new Set(fam)]})`);
    const { root } = await cdp.send('DOM.getDocument'); const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.swarf-wordmark .swarf-mark-sw' });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    check(fonts.some(f => /Helvetica/.test(f.familyName)), `${skin || 'swarf'} skin draws in it here (${fonts.map(f => f.familyName)})`);
  }
} catch (e) { check(false, 'threw: ' + e.message); }
await browser.close();
console.log(bad.length ? `wordmark: ${bad.length} failed` : 'wordmark: ok');
process.exit(bad.length ? 1 : 0);
