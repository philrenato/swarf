// A tour of every screen in each skin, for looking (not a gate):
//   node tools/look_skins.mjs [url] [outdir] [skin ...]   (skins default: glass classic swarf)
// Shots: the empty bed, the view menu, SHAPE, a part with its size card and sentence,
// toolpaths, simulate with the machine, DRAW with a part picked, and CONTROL with the job.
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME || '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PAGE = process.argv[2] || 'http://127.0.0.1:8139/swarf-app/';
const OUT = process.argv[3] || '/tmp';
const SKINS = process.argv.slice(4).length ? process.argv.slice(4) : ['glass', 'classic', 'swarf'];
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 120000, args: ['--window-size=1440,900'] });
const errors = [];
try {
  for (const skin of SKINS) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on('pageerror', e => errors.push(`${skin}: ${e.message}`));
    const shot = async name => { await wait(500); await page.screenshot({ path: `${OUT}/${skin}-${name}.png` }); };
    await page.goto(PAGE + '?skin=' + skin, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait(5000);   // the service worker may reload once
    await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfDraw && window.SwarfSkin && document.getElementById('swarf-step-shape')), { timeout: 90000, polling: 200 });
    await page.evaluate(s => { localStorage.setItem('swarf-skin', s); window.SwarfSkin.set(s); window.kiri.api.devices.select('ShopBot.Basic'); for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w); }, skin);
    await wait(1500);
    await shot('1-empty');
    // the view menu
    await page.evaluate(() => { const m = [...document.querySelectorAll('#menubar .top-menu > span')].find(s => /view/i.test(s.textContent.split('\n')[0])); m && m.click(); });
    await shot('2-menu');
    await page.keyboard.press('Escape'); await page.mouse.click(720, 600); await wait(300);
    // SHAPE
    await page.click('#swarf-step-shape');
    await page.waitForFunction(() => document.getElementById('dialog').open, { timeout: 5000 }).catch(() => {});
    await page.evaluate(() => { const s = (id, v) => { const e = document.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } };
      s('shape-kind', 'rect'); s('shape-w', '100'); s('shape-h', '60'); s('shape-t', '12'); s('shape-edge', 'chamfer'); s('shape-es', '3'); });
    await shot('3-shape');
    await page.evaluate(() => [...document.querySelectorAll('#dialog button')].find(b => /^make$/i.test(b.textContent.trim()))?.click());
    await wait(1500);
    await page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all()[0]; w && a.platform.select(w); });
    await shot('4-part');
    // toolpaths
    await page.evaluate(() => { const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await wait(400);
    await page.evaluate(() => document.getElementById('act-paths')?.click());
    await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); setTimeout(res, 60000); }));
    await shot('5-toolpaths');
    // simulate, with the machine
    await page.evaluate(() => { try { localStorage.setItem('swarf-run-ghost', '1'); } catch (e) {} const b = [...document.querySelectorAll('.swarf-step, #act-animate, button')].find(e => /^\s*simulate\s*$/i.test(e.textContent)); b && b.click(); });
    await wait(2500);
    await page.evaluate(() => { const c = document.getElementById('swarf-sim-machine'); if (c) { c.click(); c.click(); } });
    await wait(1800);
    await shot('6-simulate');
    await page.evaluate(() => window.kiri.api.view.set_arrange());
    await wait(800);
    // DRAW
    await page.click('#swarf-step-draw').catch(() => {});
    await wait(1200);
    await page.evaluate(() => { const p = document.querySelector('#sd-svg .sd-part'); p && p.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0 })); });
    await shot('7-draw');
    await page.evaluate(() => [...document.querySelectorAll('#swarf-draw button')].find(b => /cancel/i.test(b.textContent))?.click());
    await wait(800);
    // CONTROL, with the job
    await page.evaluate(() => document.getElementById('act-paths')?.click());
    await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); setTimeout(res, 30000); }));
    await page.click('#swarf-step-run').catch(() => {});
    await page.waitForFunction(() => window.__swarfRun && window.__swarfRun.state.prog, { timeout: 30000 }).catch(() => {});
    await wait(1500);
    await shot('8-control');
    await page.close();
  }
} finally { await browser.close(); }
if (errors.length) console.log('page errors:', errors.slice(0, 8));
console.log('look skins: done');
