// r52 (v00000-051): a deleted part comes back with ⌘Z; plywood, OSB and hardboard are
// materials; a drawing with an outline drawn twice says so; a latched fault holds every run
// until "all clear"; continue from a line names the bit in use at that line.
//   node tools/probe_r52.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME || '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PAGE = process.argv[2] || 'http://127.0.0.1:8139/swarf-app/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const sp = t => typeof t === 'string' ? t.replace(/ /g, ' ') : t;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const alertText = page => page.evaluate(() => { const d = window.kiri.api.ui.alert; return d && d.dialog.style.display !== 'none' ? d.text.textContent : ''; });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(5000);
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfRun && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 200 });
  await page.evaluate(() => { window.kiri.api.devices.select('ShopBot.Basic'); for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w); });
  await wait(1500);

  // materials
  const mats = await page.evaluate(() => [...document.getElementById('swarf-material-select').options].map(o => o.value));
  check(['plywood', 'osb', 'hardboard'].every(m => mats.includes(m)), `plywood, OSB and hardboard are offered (${mats.join(', ')})`);

  // a doubled outline
  await page.evaluate(() => {
    const r = '<rect x="0" y="0" width="40" height="30" fill="#000"/>';
    window.kiri.api.platform.load_svg(`<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">${r}${r}</svg>`, 'twice', { depth: 6, resolution: 2, segmin: 48, soup: true, dpi: 0 });
  });
  await wait(800);
  const dbl = sp(await alertText(page));
  check(/drawn twice/.test(dbl), `a doubled shape is said ("${dbl.slice(0, 70)}")`);

  // delete, then ⌘Z
  await page.evaluate(() => { for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w);
    window.kiri.api.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><rect x="0" y="0" width="30" height="20" fill="#000"/><rect x="50" y="50" width="30" height="20" fill="#000"/></svg>', 'two', { depth: 6, resolution: 2, segmin: 48, soup: true, dpi: 0 }); });
  await wait(1500);
  const n0 = await page.evaluate(() => window.kiri.api.widgets.all().length);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.delete(a.widgets.all()[0]); });
  await wait(400);
  const said = sp(await alertText(page));
  const n1 = await page.evaluate(() => window.kiri.api.widgets.all().length);
  await page.evaluate(() => window.kiri.api.doit.undo());
  await wait(600);
  const n2 = await page.evaluate(() => window.kiri.api.widgets.all().length);
  check(n1 === n0 - 1 && n2 === n0 && /brings it back/.test(said), `delete then ⌘Z: ${n0} → ${n1} → ${n2} ("${said.slice(0, 50)}")`);
  await page.evaluate(() => window.kiri.api.doit.redo()); await wait(400);
  check(await page.evaluate(() => window.kiri.api.widgets.all().length) === n0 - 1, 'redo deletes it again');

  // a latched fault: every run waits for all clear
  await page.evaluate(() => { for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w); });
  await page.evaluate(() => window.__swarfRun.open()); await wait(1000);
  await page.evaluate(() => window.__swarfRun.loadProgram('t.sbp', ["'UNITS:MM", 'SA', "&Tool =1   'Load 6 mm flat end mill", 'MS,10,5', 'J3,0,0,5', 'M3,0,0,-1', 'M3,40,0,-1', 'C9', "&Tool =2   'Load 3 mm ball end mill", 'M3,40,40,-1', 'J3,0,0,5', 'END'].join('\n'), 'file'));
  await wait(400);
  const press = txt => page.evaluate(txt => [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent.trim() === txt && b.offsetParent).click(), txt);
  await press('zero x y'); await press('zero z'); await wait(200);
  await page.evaluate(() => { window.__swarfRun.state.fault = 'the e-stop stopped the machine'; window.__swarfRun.state.traced = true; });
  await press('zero x y'); await wait(300);            // any refresh
  await page.click('#swarf-run .sr-actions .cut'); await wait(300);
  let card = sp(await page.evaluate(() => document.querySelector('#swarf-run .sr-sheet.on .sr-card')?.textContent || ''));
  check(/Before you can cut/.test(card) && /all clear/.test(card), `a fault holds the cut ("${card.slice(0, 80)}")`);
  await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-sheet.on button')].find(b => /all clear/.test(b.textContent)).click()); await wait(300);
  await page.evaluate(() => { for (const c of document.querySelectorAll('#swarf-run .sr-sheet.on input[type=checkbox]')) c.click(); [...document.querySelectorAll('#swarf-run .sr-sheet.on button')].find(b => b.textContent === 'all clear').click(); });
  await wait(300);
  check(await page.evaluate(() => !window.__swarfRun.state.fault), 'all clear clears it');

  // continue from line 10 names the 3 mm ball end mill, not the file's first bit
  await page.evaluate(() => { const S = window.__swarfRun.state; S.stoppedAt = 10; S.traced = true; const i = document.querySelector('#swarf-run .sr-from input'); i.value = '10'; window.__swarfRun.card(null); });   // card(null) refreshes
  await wait(200);
  await page.evaluate(() => document.querySelector('#swarf-run .sr-from button').click()); await wait(300);
  card = sp(await page.evaluate(() => document.querySelector('#swarf-run .sr-sheet.on .sr-card')?.textContent || ''));
  check(/3 mm ball end mill this file uses at line 10/.test(card), `continue names the bit at that line ("${(card.match(/the bit in the router[^.]*?(line \d+|for)/) || [''])[0]}")`);
  // every machine-control file carries one build; a page that mixes two will not connect
  await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-sheet.on button')].find(b => b.textContent === 'not yet')?.click());
  const builds = await page.evaluate(() => ({ want: window.SWARF_BUILD, got: Object.values(window.SWARF_BUILDS || {}) }));
  check(builds.got.length === 7 && builds.got.every(v => v === builds.want), `seven control files, one build (${builds.want}; ${[...new Set(builds.got)].join(',')})`);
  await page.evaluate(() => { window.SWARF_BUILD = 'another'; });
  await page.evaluate(() => [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent.trim() === 'connect')?.click());
  await wait(600);
  const mix = sp(await page.$eval('#swarf-run .sr-say', e => e.textContent));
  check(/two swarf builds/.test(mix), `a mixed page refuses to connect ("${mix.slice(0, 60)}")`);
  // sounds: made by the browser, the chip turns them off and on
  const snd = await page.evaluate(() => { const S = window.SwarfSound; if (!S) return null; S.set(0.6); const on = S.play('move'); S.set(0); const off = S.play('move'); S.set(0.6);
    const b = [...document.querySelectorAll('#swarf-run button')].find(x => /^sounds (on|off)$/.test(x.textContent)); const t0 = b && b.textContent; b && b.click(); const t1 = b && b.textContent; b && b.click();
    return { on, off, t0, t1 }; });
  check(snd && snd.on === true && snd.off === false && snd.t0 === 'sounds on' && snd.t1 === 'sounds off', `sounds play, mute, and the chip says which ${JSON.stringify(snd)}`);
} finally {
  await browser.close();
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(bad.length ? 'FAIL\n' + bad.join('\n') : 'r52: ok');
  process.exitCode = errors.length || bad.length ? 1 : 0;
}
