// A tour of every menu, card and dialog, in each skin and at two window sizes, for looking (not a gate):
//   node tools/look_cards.mjs [url] [outdir] [skin ...]   (skins default: glass classic swarf)
// Shots: the empty bed, each menu open and hovered, the cards its rows open, the STL units card,
// a part with objects, tabs and strategy, a step open for editing, the bits list, concerns,
// toolpaths, the export card, simulate, DRAW, TEX and CONTROL with the practice machine.
// Each shot also lists the text that reads poorly on its background (contrast under 3:1):
//   <outdir>/contrast.txt
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { CHROME } from './chrome-path.mjs';
import { lowContrast } from './skin_contrast.mjs';
const PAGE = process.argv[2] || 'http://127.0.0.1:8139/swarf-app/';
const OUT = process.argv[3] || '/tmp/swarf-cards';
const SKINS = process.argv.slice(4).length ? process.argv.slice(4) : ['glass', 'classic', 'swarf'];
const SIZES = [[1440, 900], [1024, 600]];
const wait = ms => new Promise(r => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const report = [];
const errors = [];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 180000, args: ['--window-size=1440,900'] });
const stl = (x, y, z) => {
  const v = [[0, 0, 0], [x, 0, 0], [x, y, 0], [0, y, 0], [0, 0, z], [x, 0, z], [x, y, z], [0, y, z]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return 'solid b\n' + f.map(t => ` facet normal 0 0 0\n  outer loop\n${t.map(i => `   vertex ${v[i].join(' ')}`).join('\n')}\n  endloop\n endfacet`).join('\n') + '\nendsolid b\n';
};
try {
  for (const skin of SKINS) for (const [W, H] of SIZES) {
    const tag = `${skin}-${W}`;
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H });
    page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
    let n = 0;
    const shot = async name => {
      await wait(450);
      const file = `${tag}-${String(++n).padStart(2, '0')}-${name}.png`;
      await page.screenshot({ path: `${OUT}/${file}` });
      const low = await page.evaluate(lowContrast);
      if (low.length) report.push(`${file}\n` + low.map(l => '   ' + l).join('\n'));
    };
    const click = sel => page.evaluate(s => { const e = document.querySelector(s); e && e.click(); return !!e; }, sel);
    const closeAll = async () => {
      await page.keyboard.press('Escape'); await wait(150);
      await page.evaluate(() => { try { window.kiri.api.modal.hide(); } catch (e) {} const d = document.getElementById('dialog'); if (d && d.open) d.close(); document.body.click();
        for (const x of document.querySelectorAll('.selection-panel-close')) if (x.offsetParent) x.click(); });
      await wait(350);
    };
    await page.goto(PAGE + '?skin=' + skin, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait(4000);   // the service worker may reload once
    await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.SwarfSkin && window.__swarfRun && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 200 });
    await page.evaluate(s => { localStorage.setItem('swarf-skin', s); window.SwarfSkin.set(s); window.kiri.api.devices.select('ShopBot.Basic'); for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w);
      const u = window.kiri.api.util; u.download = () => {}; }, skin);
    await wait(1500);
    await shot('empty');

    // the menus, open, then with the pointer on the first row
    const heads = await page.evaluate(() => [...document.querySelectorAll('#menubar .top-menu > span')].filter(m => m.querySelector(':scope > .top-menu-drop')).map(m => (m.querySelector(':scope > label')?.textContent || '').trim()));
    for (const h of heads) {
      const at = await page.evaluate(h => { const m = [...document.querySelectorAll('#menubar .top-menu > span')].find(s => (s.querySelector(':scope > label')?.textContent || '').trim() === h); const b = m.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, h);
      await page.mouse.click(at.x, at.y);
      await shot(`menu-${h}`);
      const row = await page.evaluate(() => { const d = [...document.querySelectorAll('#menubar .swarf-open .top-menu-drop .content > div')].find(d => d.offsetParent); if (!d) return null; const b = d.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
      if (row) { await page.mouse.move(row.x, row.y); await shot(`menu-${h}-hover`); }
      await page.mouse.move(at.x, at.y + 400);
      await closeAll();
    }
    // the cards the menu rows open (the ones that only show something)
    const cards = async list => {
      for (const [id, name] of list) {
        if (!await click('#' + id)) continue;
        // a row pressed in code bubbles to its menu's name and opens the menu: put it away
        await page.evaluate(() => { for (const m of document.querySelectorAll('#menubar .swarf-open')) m.classList.remove('swarf-open'); document.body.classList.remove('swarf-menu-open'); });
        await wait(500); await shot(`card-${name}`); await closeAll();
      }
    };
    await cards([['file-new', 'new'], ['file-recent', 'recent'], ['set-device', 'machine'], ['set-tools', 'tool-library'], ['set-prefs', 'preferences'],
      ['swarf-quickstart', 'quick-start'], ['swarf-help-search', 'help-search'], ['swarf-concordance', 'concordance'], ['app-help', 'about']]);

    // an STL in the wrong units: its card
    await page.evaluate(t => { const a = window.kiri.api; a.platform.clear(); a.platform.load_files([new File([t], 'block.stl')]); }, stl(2, 3, 0.75));
    await wait(2500);
    await shot('stl-units');
    await page.evaluate(() => [...document.querySelectorAll('.swarf-stl-units button')].find(b => b.textContent === 'done')?.click());
    await wait(400);

    // a part, picked: objects, tabs, strategy
    await page.evaluate(() => { const a = window.kiri.api; a.platform.clear(); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><rect width="100" height="60"/></svg>', 'plate', { depth: 12, resolution: 2, soup: true, dpi: 0 }); });
    await wait(1200);
    await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); });
    await wait(800);
    await shot('part');
    await cards([['swarf-edit-copies', 'copies'], ['context-move-panel', 'move'], ['context-scale-panel', 'size']]);
    await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); });
    await page.evaluate(() => [...document.querySelectorAll('#swarf-board-row button, #camops button')].find(b => /board size/i.test(b.textContent))?.click());
    await wait(500); await shot('board-size'); await closeAll();
    // two steps, the first open for editing
    for (const k of ['rough', 'outline']) {
      await page.evaluate(k => { const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === k); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }, k);
      await wait(400);
    }
    await page.evaluate(() => { for (const d of document.querySelectorAll('#oplist .swarf-params-open .swarf-op-chevron')) d.click(); document.querySelector('#oplist .draggable.has-params .swarf-op-chevron')?.click(); });
    await wait(400);
    await shot('step-editing');
    const chev = await page.evaluate(() => { const c = document.querySelector('#oplist .draggable:not(.swarf-params-open) .swarf-op-chevron'); if (!c) return null; const b = c.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
    if (chev) { await page.mouse.move(chev.x, chev.y); await shot('step-edit-hover'); await page.mouse.move(W / 2, H - 40); }
    if (await click('#swarf-open-tools')) { await wait(500); await shot('bits'); await closeAll(); }
    if (await click('#swarf-concerns-tab')) { await wait(400); await shot('concerns'); await click('#swarf-concerns-tab'); await wait(300); }

    // toolpaths, export, simulate
    await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); document.getElementById('act-paths')?.click(); setTimeout(res, 60000); }));
    await shot('toolpaths');
    await click('#act-export');
    await page.waitForFunction(() => { const c = document.querySelector('#mod-x-any.swarf-x .swarf-x-card'); return c && c.offsetParent; }, { timeout: 60000 }).catch(() => {});
    await shot('export');
    await closeAll();
    await page.evaluate(() => { const b = [...document.querySelectorAll('.swarf-step, #act-animate, button')].find(e => /^\s*simulate\s*$/i.test(e.textContent)); b && b.click(); });
    await wait(2500);
    await shot('simulate');
    await page.evaluate(() => window.kiri.api.view.set_arrange());
    await wait(800);

    // DRAW and TEX
    await click('#swarf-step-draw'); await wait(1200);
    await shot('draw');
    await page.evaluate(() => [...document.querySelectorAll('#swarf-draw button')].find(b => /cancel/i.test(b.textContent))?.click());
    await closeAll();
    await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); });
    await click('#swarf-step-tex'); await wait(1500);
    await shot('tex');
    await page.evaluate(() => [...document.querySelectorAll('#swarf-tex button, .swarf-tex button')].find(b => /cancel|close|done/i.test(b.textContent))?.click());
    await closeAll();

    // CONTROL with the practice machine
    await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); document.getElementById('act-paths')?.click(); setTimeout(res, 30000); }));
    await page.click('#swarf-step-run').catch(() => {});
    await page.waitForFunction(() => window.__swarfRun && window.__swarfRun.state.prog, { timeout: 30000 }).catch(() => {});
    await wait(1500);
    await shot('control');
    for (const t of ['zero x y', 'connect']) {
      const ok = await page.evaluate(t => { const b = [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent.trim() === t && b.offsetParent); b && b.click(); return !!b; }, t);
      if (ok) { await wait(800); await shot('control-' + t.replace(/\s+/g, '-')); }
    }
    await page.close();
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/contrast.txt`, report.join('\n') + '\n');
if (errors.length) console.log('page errors:', errors.slice(0, 8));
console.log(`look cards: done, ${report.length} shots with low-contrast text (${OUT}/contrast.txt)`);
