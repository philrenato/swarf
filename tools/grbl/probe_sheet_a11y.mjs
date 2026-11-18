// Control's cards on the MR-1 (fake Web Serial port, stub GRBL), by keyboard and in a short window:
//  - the job from cam is a .nc file; the cut checklist says spindle, never router or dust collection
//  - every card is a dialog (role, aria-modal) named by the machine and its heading, described by its
//    paragraphs; focus opens on the safe button, Tab and Shift-Tab never leave it, the page behind
//    is inert, and focus goes back to the button that opened it
//  - home by keys: Tab to the home button, Enter; arrows under a card never jog
//  - the longest cut card (X Y and Z not zeroed in swarf, no trace, inches, a long name) at 1280 x 720,
//    1024 x 600 and at 125 % and 150 % zoom (819 x 480, 683 x 400): the card inside the window, both
//    buttons in view and on top, every tick reachable by scrolling the card and on top when it is
//  - cancel by keys (Enter on not yet, then Esc), then tick every box with Space and cut with Enter
//   node tools/grbl/probe_sheet_a11y.mjs [url]
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from '../chrome-path.mjs';
const PAGE = process.argv[2] || 'http://127.0.0.1:8794/swarf-app/';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'swarf-sheet-'));
const stubSrc = readFileSync(new URL('./stub-grbl.cjs', import.meta.url), 'utf8');
const ui = readFileSync(new URL('./probe_grbl_ui.mjs', import.meta.url), 'utf8');
const fakeSerial = ui.slice(ui.indexOf('const fakeSerial = `') + 'const fakeSerial = `'.length, ui.indexOf('})();`;') + '})();'.length);
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-sheet-ud-')), args: ['--window-size=1440,900'] });
try {
  const cdp = await browser.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluateOnNewDocument(stubSrc + fakeSerial);
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfRun && window.SwarfGrbl), { timeout: 90000, polling: 200 });
  await wait(1500);
  const S = expr => page.evaluate(new Function(`const S = window.__swarfRun.state, m = S.machine, st = m && m.state; return (${expr});`));
  const until = (expr, ms = 20000) => page.waitForFunction(new Function(`const S = window.__swarfRun.state, m = S.machine, st = m && m.state; return (${expr});`), { timeout: ms, polling: 50 });
  // a real click on a visible control button by its words
  const click = async t => {
    const hs = await page.$$('#swarf-run button');
    // scrolled into its column first, as a student scrolls to it (the column scrolls in a short window)
    for (const b of hs) if (await b.evaluate((b, t) => b.textContent.trim() === t && !!b.offsetParent, t)) { await b.evaluate(b => b.scrollIntoView({ block: 'nearest' })); const r = await b.boundingBox(); await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); return true; }
    return false;
  };
  const active = () => page.evaluate(() => { const a = document.activeElement, c = document.querySelector('#swarf-run .sr-card'); return { inCard: !!(c && c.contains(a)), tag: a && a.tagName, text: a && (a.textContent || '').trim(), type: a && a.type, checked: a && a.checked }; });
  const sheetOn = () => page.evaluate(() => !!document.querySelector('#swarf-run .sr-sheet.on'));
  const dialog = () => page.evaluate(() => {
    const c = document.querySelector('#swarf-run .sr-card');
    const ids = a => (c.getAttribute(a) || '').split(/\s+/).filter(Boolean).map(id => (document.getElementById(id) || {}).textContent || '').join(' ');
    return { role: c.getAttribute('role'), modal: c.getAttribute('aria-modal'), name: ids('aria-labelledby'), desc: ids('aria-describedby') };
  });

  // an MR-1 job from cam: a .nc file
  await page.evaluate(() => window.kiri.api.devices.select('Langmuir.MR-1'));
  await wait(800);
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20"><rect width="20" height="20"/></svg>', 'square', { depth: 3, resolution: 2, segmin: 48, soup: true, dpi: 0 }); });
  await wait(600);
  await page.evaluate(() => { const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(400);
  await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); document.getElementById('act-paths')?.click(); setTimeout(res, 60000); }));
  await page.click('#swarf-step-run');
  await until('S.prog && m && !S.camBusy', 60000);
  const name = await S('S.prog.name');
  check(/\.nc$/.test(name), `the MR-1 job from cam is a .nc file (${name})`);

  // connect, then home by keys
  check(await click('connect'), 'connect');
  await until('st && st.kind === "grbl" && st.connected', 15000);
  check(await click('home'), 'home pressed (a real click)');
  await until('document.querySelector("#swarf-run .sr-sheet.on")', 5000);
  await wait(100);
  let d = await dialog();
  check(d.role === 'dialog' && d.modal === 'true' && /MR-1/.test(d.name) && /about\sto\shome/.test(d.name), `a dialog named "${d.name}" (role ${d.role}, modal ${d.modal})`);
  let a = await active();
  check(a.inCard && a.text === 'not yet', `focus opens on the safe button ("${a.text}")`);
  const pos0 = await page.evaluate(() => window.__stub.mpos());
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('PageUp'); await wait(400);
  check(JSON.stringify(await page.evaluate(() => window.__stub.mpos())) === JSON.stringify(pos0) && await sheetOn(), 'arrows under a card never jog');
  let left = false;
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); if (!(await active()).inCard) left = true; }
  for (let i = 0; i < 8; i++) { await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift'); if (!(await active()).inCard) left = true; }
  check(!left, 'Tab and Shift-Tab stay in the card');
  const inert = await page.evaluate(() => { const t = [...document.querySelectorAll('#swarf-run .sr-actions button')][0]; t.focus(); return document.activeElement !== t && !!t.closest('[inert]'); });
  check(inert, 'the controls behind the card cannot take focus');
  // to the home button, Enter
  for (let i = 0; i < 4 && (await active()).text !== 'home'; i++) await page.keyboard.press('Tab');
  check((await active()).text === 'home', 'Tab reaches home');
  await page.keyboard.press('Enter');
  await until('st.homed', 20000);
  check(true, 'Enter on the focused home button homes');

  // over the board, zeroed on the board, then swarf told nothing is zeroed or traced: the longest cut card
  await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-modes')[0].querySelectorAll('button')].find(b => b.textContent === '50').click());
  for (const l of ['+X', '+X', '−Y', '−Y', '−Z']) { await page.click(`#swarf-run .sr-pad button[data-axis="${l}"]`); await wait(100); await until('!m.busy() && st.grbl === "Idle"', 10000); await wait(200); }
  // the stub can still report Jog for a status poll after the last jog ends, and zero refuses then: press again
  for (let i = 0; i < 6 && !(await S('S.zeroXY')); i++) { await click('zero x y'); await wait(1000); }
  check(await S('S.zeroXY'), 'zero x y'); await until('S.zeroXY && !m.busy()', 5000);
  check(await click('zero z'), 'zero z'); await until('S.zeroZ && !m.busy()', 5000);
  const long = 'a-cutting-board-with-a-long-name-for-the-shop-wall-left-side-final-v3.nc';
  const text = await S('S.prog.text');
  await page.evaluate((n, t) => window.__swarfRun.loadProgram(n, t, 'file'), long, text);
  await wait(500);
  await page.evaluate(() => [...document.querySelectorAll('#swarf-units button')].find(b => b.textContent === 'in')?.click());
  await wait(400);
  await page.evaluate(() => { const s = window.__swarfRun.state; s.zeroXY = s.zeroZ = false; s.zx = s.zy = false; s.traced = false; window.__swarfRun.tell(''); });
  await wait(300);
  const openCut = async () => { check(await click('cut'), 'cut pressed (a real click)'); await until('document.querySelector("#swarf-run .sr-sheet.on .go")', 5000); await wait(150); };
  await openCut();
  d = await dialog();
  check(/MR-1/.test(d.name) && /Cut/.test(d.name), `the cut card is named "${d.name}"`);
  check(/not zeroed in swarf/.test(d.desc) && /No trace this time/.test(d.desc), 'its warnings are its description');
  const labels = await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-sheet.on label')].map(l => l.textContent));
  check(labels.length >= 8 && labels.some(t => /spindle/.test(t)) && !labels.some(t => /router|dust/.test(t)), `the checklist says spindle, not router or dust (${labels.length} ticks)`);

  // the card in the window, its buttons in view and on top, each tick reachable; at 125 % and 150 % the
  // window is under 820 px wide, so the student has pressed "show the interface anyway" on the narrow-window wall
  await page.evaluate(() => localStorage.setItem('swarf_phone_mode', 'off'));
  for (const [W, H, z] of [[1280, 720, '100 %'], [1024, 600, '100 %'], [819, 480, '125 %'], [683, 400, '150 %']]) {
    await page.setViewport({ width: W, height: H }); await wait(400);
    const r = await page.evaluate(() => {
      const c = document.querySelector('#swarf-run .sr-sheet.on .sr-card'), cr = c.getBoundingClientRect();
      const top = (e) => { const b = e.getBoundingClientRect(), h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { y: Math.round(b.bottom), on: !!h && (h === e || e.contains(h)), inside: b.top >= cr.top - 0.5 && b.bottom <= cr.bottom + 0.5 && b.bottom <= innerHeight }; };
      const btns = [...c.querySelectorAll('.row:last-child button')];
      const out = { card: [Math.round(cr.top), Math.round(cr.bottom)], scroll: c.scrollHeight > c.clientHeight, buttons: btns.map(b => ({ t: b.textContent, ...top(b) })), ticks: [] };
      for (const box of c.querySelectorAll('label input')) { box.scrollIntoView({ block: 'nearest' }); out.ticks.push(top(box)); }
      for (const b of btns) out.buttons.push({ t: b.textContent + ' (scrolled)', ...top(b) });
      c.scrollTop = 0;
      return out;
    });
    check(r.card[0] >= 0 && r.card[1] <= H, `${W} x ${H} (${z}): the card inside the window ${r.card} ${r.scroll ? '(it scrolls)' : ''}`);
    check(r.buttons.length >= 4 && r.buttons.every(b => b.on && b.inside), `${W} x ${H}: not yet and cut in view and on top ${JSON.stringify(r.buttons)}`);
    check(r.ticks.length === labels.length && r.ticks.every(t => t.on && t.inside), `${W} x ${H}: every tick reachable ${JSON.stringify(r.ticks.filter(t => !t.on || !t.inside))}`);
    await page.screenshot({ path: join(OUT, `cut-card-${W}x${H}.png`) });
  }
  await page.setViewport({ width: 1024, height: 600 }); await wait(300);
  await page.evaluate(() => localStorage.removeItem('swarf_phone_mode'));

  // cancel by keys: Enter on not yet; focus back on cut; then Esc
  a = await active();
  check(a.text === 'not yet', `the cut card opens on not yet ("${a.text}")`);
  await page.keyboard.press('Enter'); await wait(300);
  a = await page.evaluate(() => ({ on: !!document.querySelector('#swarf-run .sr-sheet.on'), focus: document.activeElement && document.activeElement.classList.contains('cut') }));
  check(!a.on && a.focus, 'Enter on not yet closes it, focus back on cut');
  await openCut();
  await page.keyboard.press('Escape'); await wait(300);
  check(!(await sheetOn()), 'Esc closes it');

  // tick every box with Space, the go button waits until the last, then Enter on it cuts
  await openCut();
  const go = () => page.evaluate(() => document.querySelector('#swarf-run .sr-sheet.on .go').disabled);
  check(await go(), 'cut is disabled before the ticks');
  let ticked = 0;
  for (let i = 0; i < 40 && ticked < labels.length; i++) {
    await page.keyboard.press('Tab');
    a = await active();
    if (!a.inCard) { check(false, 'Tab left the card'); break; }
    if (a.type === 'checkbox' && !a.checked) { await page.keyboard.press('Space'); ticked++; }
  }
  check(ticked === labels.length && !(await go()), `every box ticked with Space (${ticked}), cut enabled`);
  for (let i = 0; i < 20 && !/without a trace/.test((await active()).text); i++) await page.keyboard.press('Tab');
  check(/without a trace/.test((await active()).text), 'Tab reaches cut without a trace');
  await page.keyboard.press('Enter');
  await until('st.running', 5000).then(() => check(true, 'Enter on the focused cut without a trace starts the cut'), () => check(false, 'Enter on cut without a trace did nothing'));
  await page.evaluate(() => window.__swarfRun.state.machine.stop());
  await until('!st.running', 20000);
} catch (e) {
  check(false, e.message);
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(`screenshots: ${OUT}`);
console.log(bad.length || errors.length ? `sheet a11y: ${bad.length} failed, ${errors.length} page errors` : 'sheet a11y: ok');
process.exit(bad.length || errors.length ? 1 : 0);
