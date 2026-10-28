// r49 (v00000-048):
//  - CONTROL opens on an empty bed: two ways to start, and trace / in the air say what they
//    wait for when pressed (the sentence stays), with a "to run" line naming each need
//  - control is the ShopBot's alone: hidden on the MR-1
//  - a browser without USB is told at the right time: pressing control shows a card first
//  - modes: in control and draw the step row folds to cam · draw · control; cam leads back
//  - setup › preferences regrouped in swarf's words
//   node tools/probe_r49.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME || '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PAGE = process.argv[2] || 'http://127.0.0.1:8139/swarf-app/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const sp = t => typeof t === 'string' ? t.replace(/\u00a0/g, ' ') : t;   // the app ties last words with a no-break space (no orphans)
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
  await wait(5000);   // the service worker may reload the page once
  await page.waitForFunction(ready, { timeout: 90000, polling: 200 });
  await page.evaluate(() => { window.kiri.api.devices.select('ShopBot.Basic'); for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w); });
  await wait(1500);

  // cam mode: no cam step; control is there on the ShopBot
  check(!(await shown(page, 'swarf-step-cam')) && await shown(page, 'swarf-step-run') && await shown(page, 'act-paths'), 'cam: every cam step, control, no cam button');

  // 10-28: X 0, Y 0 at the stock's front-left corner by default; the center one press away
  const og = await page.evaluate(() => { const r = document.getElementById('swarf-origin-row'), p = () => window.kiri.api.conf.get().process.camOriginCenter;
    const before = p(), lit = r && r.querySelector('button.selected')?.textContent;
    [...r.querySelectorAll('button')].find(b => b.textContent === 'center').click(); const mid = p();
    [...r.querySelectorAll('button')].find(b => /corner/.test(b.textContent)).click(); return { row: !!r, before, lit, mid, after: p() }; });
  check(og.row && og.before === false && /corner/.test(og.lit) && og.mid === true && og.after === false, `zero at: front-left corner by default, center a press away ${JSON.stringify(og)}`);

  // control on an empty bed
  await page.click('#swarf-step-run');
  await page.waitForFunction(() => window.__swarfRun.state.open, { timeout: 10000 });
  await wait(800);
  const c = await page.evaluate(() => {
    const q = s => document.querySelector('#swarf-run ' + s);
    return { start: !!q('.sr-start')?.offsetParent, trace: q('.sr-actions .trace').className, disabled: q('.sr-actions .trace').disabled, need: (q('.sr-need')?.textContent || '').replace(/\u00a0/g, ' ') };
  });
  check(c.start, 'control on an empty bed offers make a part / open a file');
  check(/wait/.test(c.trace) && !c.disabled, `trace waits but takes the press (${c.trace}, disabled ${c.disabled})`);
  check(/to run:.*a program.*X Y zeroed.*Z zeroed/.test(c.need), `the to-run line names each need ("${c.need}")`);
  await page.click('#swarf-run .sr-actions .trace');
  await wait(400);
  const said = sp(await page.evaluate(() => document.querySelector('#swarf-run .sr-sheet.on .sr-card')?.textContent || ''));
  check(/Before you can trace/.test(said) && /make a part/.test(said), `pressing a waiting trace opens what it waits for ("${said.slice(0, 80)}…")`);
  await page.evaluate(() => document.querySelector('#swarf-run .sr-sheet').classList.remove('on'));

  // 10-28b: a waiting cut opens what is left to do; trace and in the air ask first; every move swarf makes asks
  await page.evaluate(() => window.__swarfRun.loadProgram('square.sbp', ['MS,10,5', 'J3,0,0,5', 'M3,0,0,-1', 'M3,40,0,-1', 'M3,40,40,-1', 'M3,0,40,-1', 'M3,0,0,-1', 'J3,0,0,5', 'END'].join('\n'), 'file'));
  await wait(400);
  const sheet = () => page.evaluate(() => { const c = document.querySelector('#swarf-run .sr-sheet.on .sr-card'); return c ? c.textContent : ''; }).then(sp);
  const shut = () => page.evaluate(() => document.querySelector('#swarf-run .sr-sheet').classList.remove('on'));
  await page.click('#swarf-run .sr-actions .cut'); await wait(300);
  let t = await sheet();
  check(/Before you can cut/.test(t) && /X Y zeroed/.test(t) && /traced/.test(t), `a waiting cut lists what is left ("${t.slice(0, 90)}…")`);
  await shut();
  const press = txt => page.evaluate(txt => [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent.trim() === txt && b.offsetParent).click(), txt);
  // the plate card shows the plate model, posed for the circuit check
  await press('z plate'); await wait(800);
  const pv = await page.evaluate(() => { const v = document.querySelector('#swarf-run .sr-sheet.on .sr-plate-view'); return v ? { canvas: !!v.querySelector('canvas'), labels: [...v.querySelectorAll('span')].map(s => s.textContent) } : null; });
  check(pv && pv.canvas && pv.labels.includes('ground clip'), `the plate card shows the plate model ${JSON.stringify(pv)}`);
  await page.screenshot({ path: (process.env.OUT || '/tmp') + '/r49-plate.png' });
  await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-sheet.on button')].find(b => b.textContent === 'touch the plate to the bit')?.click()); await wait(1200);
  await page.screenshot({ path: (process.env.OUT || '/tmp') + '/r49-plate-flat.png' });
  await page.keyboard.press('Escape'); await wait(300);
  await press('zero x y'); await press('zero z'); await wait(300);
  await page.click('#swarf-run .sr-actions .trace'); await wait(300);
  t = await sheet();
  const moved0 = await page.evaluate(() => window.__swarfRun.state.machine.state.running);
  check(/Trace the border/.test(t) && /about to move/.test(t) && /router stays off/.test(t) && !moved0, `trace asks first, nothing moves yet ("${t.slice(0, 80)}…")`);
  await shut();
  await page.click('#swarf-run .sr-actions .air'); await wait(300);
  t = await sheet();
  check(/as an air cut/.test(t) && /5 mm above its highest point/.test(t) && /not a clamp check/.test(t), `an air cut asks first ("${t.slice(0, 80)}…")`);
  await shut();
  await press('go to x y 0'); await wait(300);
  t = await sheet();
  const moving = await page.evaluate(() => window.__swarfRun.state.machine.state.moving);
  check(/about to move/.test(t) && !moving, `go to x y 0 asks first, the bit still ("${t.slice(0, 60)}…")`);
  await shut();
  // the table's corners: learn front-left here, then front right becomes X 0: here reads -table length
  await press('table corners'); await wait(300);
  await press('the bit is over the front-left corner'); await wait(200);
  await press('make it X 0, Y 0');   // the first row: front left
  const fl = await page.evaluate(() => ({ ...window.__swarfRun.state.machine.state.pos }));
  await press('table corners'); await wait(300);
  await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-needrow')].find(r => /front right/.test(r.textContent)).querySelector('button').click());
  const fr = await page.evaluate(() => ({ pos: { ...window.__swarfRun.state.machine.state.pos }, w: window.kiri.api.conf.get().device.bedWidth }));
  check(Math.abs(fl.x) < 1e-6 && Math.abs(fl.y) < 1e-6 && Math.abs(fr.pos.x + fr.w) < 1e-6 && Math.abs(fr.pos.y) < 1e-6, `corners: front left X ${fl.x} Y ${fl.y}; front right X ${fr.pos.x} (table ${fr.w})`);
  await page.screenshot({ path: (process.env.OUT || '/tmp') + '/r49-control.png' });

  // test cuts (10-28): the board's size, screwed down, the bit, then control's steps; measuring takes the bit out
  await page.evaluate(() => window.__swarfLessons.choose()); await wait(300);
  await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-needrow')][0].querySelector('button').click()); await wait(300);
  await page.evaluate(() => { const i = document.querySelectorAll('#swarf-run .sr-sheet.on .sr-board-size input'); i[0].value = '220'; i[1].value = '160'; i[2].value = '12';
    for (const c of document.querySelectorAll('#swarf-run .sr-sheet.on input[type=checkbox]')) c.click();
    [...document.querySelectorAll('#swarf-run .sr-sheet.on button')].find(b => /next: the bit/.test(b.textContent)).click(); });
  await wait(300);
  await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-sheet.on button')].find(b => /make the test cut/.test(b.textContent)).click());
  await wait(500);
  const ls = await page.evaluate(() => ({ src: window.__swarfRun.state.prog?.source, name: window.__swarfRun.state.prog?.name, card: (document.querySelector('#swarf-run .sr-sheet.on .sr-card')?.textContent || '').replace(/\u00a0/g, ' ') }));
  check(ls.src === 'lesson' && /square-and-circle/.test(ls.name) && /100 mm square and a 60 mm circle/.test(ls.card) && /220 × 160/.test(ls.card), `test cut 1 loads, sized to the board ("${ls.card.slice(0, 90)}…")`);
  await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-sheet.on button')].find(b => b.textContent === 'start').click());
  await wait(600);
  const lsay = sp(await page.$eval('#swarf-run .sr-say', e => e.textContent));
  check(/front-left corner of your plywood/.test(lsay), `the sentence says where to zero ("${lsay.slice(0, 90)}")`);
  const an = await page.evaluate(() => { const L = window.__swarfLessons.state(); return window.__swarfLessons.analyze({ ox: L.size + 9.6, ix: L.size - 9.4, oy: L.size + 9.5, iy: L.size - 9.5, dp: 3.1 }); });
  check(Math.abs(an.data.X - 0.1) < 1e-6 && Math.abs(an.data.Y) < 1e-9 && Math.abs(an.data.width - 9.5) < 1e-6, `measuring: X +${an.data.X}%, Y ${an.data.Y}%, groove ${an.data.width} mm, the bit's width out`);

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
  await wait(5000);
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
