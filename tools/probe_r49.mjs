// r49 (v00000-048):
//  - CONTROL opens on an empty bed: two ways to start, and trace / in the air say what they
//    wait for when pressed (the sentence stays), with a "to run" line naming each need
//  - control is the ShopBot's alone: hidden on the MR-1
//  - a browser without USB is told at the right time: pressing control shows a card first
//  - modes: in control and draw the step row folds to cam · draw · control; cam leads back
//  - setup › preferences regrouped in swarf's words
//   node tools/probe_r49.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PAGE = process.argv[2] || 'http://127.0.0.1:8139/swarf-app/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const ready = () => !!(window.kiri?.api?.platform?.load_svg && window.__swarfRun && window.__swarfModes && window.__swarfPrefs && document.getElementById('swarf-step-cam'));
const shown = (page, id) => page.evaluate(id => { const e = document.getElementById(id); return !!(e && e.offsetParent); }, id);
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(ready, { timeout: 90000, polling: 200 });
  await page.evaluate(() => { window.kiri.api.devices.select('ShopBot.Basic'); for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w); });
  await wait(1500);

  // cam mode: no cam step; control is there on the ShopBot
  check(!(await shown(page, 'swarf-step-cam')) && await shown(page, 'swarf-step-run') && await shown(page, 'act-paths'), 'cam: every cam step, control, no cam button');

  // control on an empty bed
  await page.click('#swarf-step-run');
  await page.waitForFunction(() => window.__swarfRun.state.open, { timeout: 10000 });
  await wait(800);
  const c = await page.evaluate(() => {
    const q = s => document.querySelector('#swarf-run ' + s);
    return { start: !!q('.sr-start')?.offsetParent, trace: q('.sr-actions .trace').className, disabled: q('.sr-actions .trace').disabled, need: q('.sr-need')?.textContent || '' };
  });
  check(c.start, 'control on an empty bed offers make a part / open a file');
  check(/wait/.test(c.trace) && !c.disabled, `trace waits but takes the press (${c.trace}, disabled ${c.disabled})`);
  check(/to run:.*a program.*X Y zeroed.*Z zeroed/.test(c.need), `the to-run line names each need ("${c.need}")`);
  await page.click('#swarf-run .sr-actions .trace');
  await wait(1500);
  const said = await page.$eval('#swarf-run .sr-say', e => e.textContent);
  check(/Trace needs: .*make a part/.test(said), `pressing trace says what it waits for, and it stays 1.5 s later ("${said}")`);

  // the row folds: cam · draw · control
  const fold = await page.evaluate(() => [...document.querySelectorAll('#mode-tools > span')].filter(s => s.offsetParent).map(s => s.textContent.trim().toLowerCase()));
  check(fold.join(',') === 'cam,draw,control', `control folds the row to cam · draw · control (${fold.join(' · ')})`);
  await page.click('#swarf-step-cam');
  await wait(800);
  check(!(await page.evaluate(() => window.__swarfRun.state.open)) && await shown(page, 'act-paths') && !(await shown(page, 'swarf-step-cam')), 'cam leads back: control closes, cam steps return');

  // draw is a mode too, under the row; control from draw closes draw
  await page.click('#swarf-step-draw');
  await page.waitForFunction(() => window.__swarfDraw.state(), { timeout: 5000 });
  await wait(500);
  const d = await page.evaluate(() => ({ fold: [...document.querySelectorAll('#mode-tools > span')].filter(s => s.offsetParent).map(s => s.textContent.trim().toLowerCase()).join(','),
    top: document.getElementById('swarf-draw').getBoundingClientRect().top, row: document.getElementById('mode-tools').getBoundingClientRect().bottom }));
  check(d.fold === 'cam,draw,control' && d.top >= d.row, `draw folds the row and sits under it (${d.fold}; draw top ${d.top}, row bottom ${d.row})`);
  await page.click('#swarf-step-run');
  await page.waitForFunction(() => window.__swarfRun.state.open, { timeout: 10000 }).catch(() => {});
  check(!(await page.evaluate(() => window.__swarfDraw.state())) && await page.evaluate(() => window.__swarfRun.state.open), 'control from draw: draw closes, control opens');
  await page.click('#swarf-step-cam'); await wait(600);

  // MR-1: no control step
  await page.evaluate(() => window.kiri.api.devices.select('Langmuir.MR-1'));
  await wait(1000);
  check(!(await shown(page, 'swarf-step-run')), 'control is hidden on the MR-1');
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);

  // preferences regrouped
  await page.evaluate(() => window.kiri.api.modal.show('prefs'));
  await wait(800);
  const p = await page.evaluate(() => {
    const box = document.getElementById('mod-prefs');
    return { groups: [...box.querySelectorAll('.swarf-prefs-group > h4, .swarf-prefs-group > summary')].map(h => h.textContent),
      view: [...box.querySelectorAll('.swarf-prefs-view .var-row')].filter(r => r.offsetParent).map(r => r.querySelector('label').textContent),
      oldShown: !!box.querySelector('.f-row.gap10')?.offsetParent };
  });
  check(p.groups.join(',') === 'the view,the bed,advanced' && !p.oldShown, `preferences: the view, the bed, advanced (${p.groups.join(' · ')}; kiri's grid hidden ${!p.oldShown})`);
  check(p.view.includes('show the origin') && p.view.includes('units'), `the view in swarf's words (${p.view.join(', ')})`);
  await page.screenshot({ path: (process.env.OUT || '/tmp') + '/r49-prefs.png' });
  await page.evaluate(() => { try { window.kiri.api.modal.hide(); } catch (e) {} });
  await page.close();

  // a browser without USB: pressing control shows the card first
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 1440, height: 900 });
  p2.on('pageerror', e => errors.push(e.message));
  await p2.evaluateOnNewDocument(() => { try { Object.defineProperty(Navigator.prototype, 'usb', { get: () => undefined, configurable: true }); } catch (e) {} });
  await p2.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p2.waitForFunction(ready, { timeout: 90000, polling: 200 });
  await p2.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(1500);
  await p2.click('#swarf-step-run');
  const card = await p2.waitForFunction(() => document.getElementById('dialog').open && /Chrome or Edge/.test(document.getElementById('dialog').textContent), { timeout: 5000 }).then(() => true, () => false);
  check(card && !(await p2.evaluate(() => window.__swarfRun.state.open)), 'no USB: pressing control shows the Chrome-or-Edge card first, control stays shut');
} finally {
  await browser.close();
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(bad.length ? 'FAIL\n' + bad.join('\n') : 'r49: ok');
  process.exitCode = errors.length || bad.length ? 1 : 0;
}
