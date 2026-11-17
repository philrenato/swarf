// Control on the direct ShopBot (fake WebUSB box), the zero swarf no longer trusts: on a computer that
// never set one, after a box restart, and for a file zeroed at another spot, the cut card leads back to a
// zero (jog, X Y here, Z) and then carries on to the cut. A trusted zero keeps cut one press. A pending bit
// change makes Z required. A readout click left unchanged sets nothing.
//   node tools/shopbot/probe_zero_back.mjs [url]
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from '../chrome-path.mjs';
const PAGE = process.argv[2] || 'http://127.0.0.1:8793/kiri/';
const probeSrc = readFileSync(new URL('./probe_direct_ui.mjs', import.meta.url), 'utf8');
const fakeUsb = probeSrc.slice(probeSrc.indexOf('const fakeUsb = `') + 'const fakeUsb = `'.length, probeSrc.indexOf('})();`;') + '})();'.length);
const stub = readFileSync(new URL('./stub-card.cjs', import.meta.url), 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-zb-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluateOnNewDocument(stub + fakeUsb);
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__swarfRun && window.kiri && window.kiri.api, { timeout: 90000 });
  await wait(1500);
  await page.evaluate(() => window.__swarfRun.open());
  await page.waitForFunction(() => { const m = window.__swarfRun.state.machine; return m && m.state.connected && m.constructor.name === 'DirectMachine'; }, { timeout: 15000 });
  const sbp = ["'UNITS:MM", 'SA', 'C6', 'J3,0,0,5', 'M3,0,0,-1', 'M3,40,0,-1', 'M3,40,30,-1', 'J3,40,30,5', 'C7', 'END'].join('\n');
  await page.evaluate(t => window.__swarfRun.loadProgram('t.sbp', t, 'file'), sbp);
  await wait(500);
  const card = () => page.evaluate(() => { const c = document.querySelector('#swarf-run .sr-sheet.on .sr-card'); return c ? { h: (c.querySelector('h2') || {}).textContent || '', text: c.textContent, buttons: [...c.querySelectorAll('button')].map(b => b.textContent) } : null; });
  const press = t => page.evaluate(t => { const b = [...document.querySelectorAll('#swarf-run .sr-sheet.on button')].find(b => b.textContent === t); if (b) b.click(); return !!b; }, t);
  const idle = () => page.waitForFunction(() => !window.__swarfRun.state.machine.busy(), { timeout: 10000 }).then(() => wait(200));
  const cut = () => page.evaluate(() => document.querySelector('#swarf-run button.cut').click());
  const shut = () => page.evaluate(() => document.querySelector('#swarf-run .sr-sheet').classList.remove('on'));

  // 1. a computer that never set a zero: the cut card leads back to one
  await cut(); await wait(300);
  let c = await card();
  check(c && c.h === 'Zero first' && /never set/.test(c.text), `never set: "${c && c.h}" ${c && c.text.slice(0, 90)}`);
  check(c && c.buttons.includes('X+') && c.buttons.includes('this spot is X 0 Y 0'), 'with a jog pad and the X Y button');
  // a dialog, on its safe button; in a 1024 x 600 window (and at 150 % zoom) its last buttons stay in view and on top
  const dlg = await page.evaluate(() => { const c = document.querySelector('#swarf-run .sr-card'); return { role: c.getAttribute('role'), modal: c.getAttribute('aria-modal'), name: c.getAttribute('aria-labelledby').split(' ').map(id => document.getElementById(id).textContent).join(' '), focus: document.activeElement && document.activeElement.textContent }; });
  check(dlg.role === 'dialog' && dlg.modal === 'true' && /ShopBot/.test(dlg.name) && /Zero first/.test(dlg.name) && dlg.focus === 'not yet', `zero first is a dialog named "${dlg.name}", focus on "${dlg.focus}"`);
  for (const [W, H] of [[1024, 600], [683, 400]]) {
    await page.setViewport({ width: W, height: H }); await wait(300);
    const fit = await page.evaluate(() => {
      const c = document.querySelector('#swarf-run .sr-sheet.on .sr-card'), cr = c.getBoundingClientRect();
      return { card: [Math.round(cr.top), Math.round(cr.bottom)], buttons: [...c.querySelectorAll('.row:last-child button')].map(b => { const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { t: b.textContent, on: hit === b || b.contains(hit), inside: r.bottom <= Math.min(cr.bottom, innerHeight) + 0.5 }; }) };
    });
    check(fit.card[0] >= 0 && fit.card[1] <= H && fit.buttons.length >= 2 && fit.buttons.every(b => b.on && b.inside), `zero first at ${W} x ${H}: card ${fit.card}, buttons ${JSON.stringify(fit.buttons)}`);
  }
  await page.setViewport({ width: 1440, height: 900 }); await wait(300);
  await press('X+'); await idle();
  check(await page.evaluate(() => Math.abs(window.__swarfRun.state.machine.state.pos.x) > 0.5), 'the pad jogs');
  await press('this spot is X 0 Y 0'); await idle(); await wait(200);
  c = await card();
  check(c && /Now Z/.test(c.text) && c.buttons.includes('this is Z 0') && c.buttons.includes('z plate'), `then Z: ${c && c.buttons}`);
  await press('Z−'); await idle();
  await press('this is Z 0'); await idle(); await wait(300);
  c = await card();
  check(c && /^Cut t\.sbp/.test(c.h), `then the cut card itself: "${c && c.h}"`);
  check(c && c.buttons.some(b => /cut/.test(b)) && !c.buttons.some(b => /anyway/.test(b)), `no "anyway": ${c && c.buttons}`);
  await shut();

  // 2. the zero trusted: cut is one press to its checklist
  await cut(); await wait(300);
  c = await card();
  check(c && /^Cut t\.sbp/.test(c.h), `trusted zero: straight to "${c && c.h}"`);
  await shut();

  // 3. the box restarted: back to the way back
  await page.evaluate(() => { const S = window.__swarfRun.state; S.zeroLost = true; S.zeroXY = S.zeroZ = false; S.zx = S.zy = false; });
  await cut(); await wait(300);
  c = await card();
  check(c && c.h === 'Zero first' && /restarted/.test(c.text), `after a restart: ${c && c.text.slice(0, 80)}`);
  await press('not yet'); await wait(200);

  // 4. a pending bit change: Z is required, so cut waits and names it
  await page.evaluate(() => { const S = window.__swarfRun.state; S.zeroLost = false; S.zeroXY = S.zx = S.zy = true; S.zeroZ = false; S.toolChange = 'Tool change at line 5.'; S.zStale = true; window.__swarfRun.tell('x'); });
  await wait(300);
  const wt = await page.evaluate(() => { const b = document.querySelector('#swarf-run button.cut'); return { wait: b.classList.contains('wait'), why: b.dataset.why }; });
  check(wt.wait && /Z/.test(wt.why), `bit change: cut waits for Z (${wt.why})`);

  // 5. a readout opened and left unchanged sets nothing
  const z0 = await page.evaluate(() => window.__swarfRun.state.zeroZ);
  await page.evaluate(() => document.querySelectorAll('#swarf-run .sr-dro .v')[2].click());
  await wait(100);
  await page.evaluate(() => { const i = document.querySelector('#swarf-run .sr-dro input'); if (i) i.blur(); });
  await wait(200);
  check(await page.evaluate(() => window.__swarfRun.state.zeroZ) === z0 && z0 === false, 'an unchanged readout does not zero Z');
  check(await page.evaluate(() => window.__swarfRunBusy === true), 'busy while a bit change is pending');

  // 6. no new file under a held job
  const before = await page.evaluate(() => window.__swarfRun.state.prog.name);
  await page.evaluate(t => window.__swarfRun.loadProgram('other.sbp', t, 'file'), sbp);
  check(await page.evaluate(() => window.__swarfRun.state.prog.name) === before, 'a file opened mid-job is refused');
} catch (e) {
  check(false, e.message);
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `zero back: ${bad.length} failed, ${errors.length} page errors` : 'zero back: ok');
process.exit(bad.length || errors.length ? 1 : 0);
