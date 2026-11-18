// Control on the direct ShopBot (fake WebUSB box): the zero never stops trace, air cut or cut (Phil 11-18:
// "If I hit trace, let me trace. ALWAYS"). On a computer that never set one, after a box restart and with a
// bit change pending, each press opens its own card at once; the cut card says the zero is not set, with no
// extra tick for it. A readout click left unchanged sets nothing.
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
  let c;
  const card = () => page.evaluate(() => { const c = document.querySelector('#swarf-run .sr-sheet.on .sr-card'); return c ? { h: (c.querySelector('h2') || {}).textContent || '', text: c.textContent, buttons: [...c.querySelectorAll('button')].map(b => b.textContent) } : null; });
  const press = t => page.evaluate(t => { const b = [...document.querySelectorAll('#swarf-run .sr-sheet.on button')].find(b => b.textContent === t); if (b) b.click(); return !!b; }, t);
  const idle = () => page.waitForFunction(() => !window.__swarfRun.state.machine.busy(), { timeout: 10000 }).then(() => wait(200));
  const cut = () => page.evaluate(() => document.querySelector('#swarf-run button.cut').click());
  const shut = () => page.evaluate(() => document.querySelector('#swarf-run .sr-sheet').classList.remove('on'));

  const pressRun = k => page.evaluate(k => document.querySelector(`#swarf-run button.${k}`).click(), k);
  const opens = async (k, head, what) => {
    await shut(); await wait(200);
    await pressRun(k); await wait(300);
    const c = await card();
    check(c && head.test(c.h) && !/Zero first|Before you can/.test(c.h), `${what}: ${k} opens "${c && c.h}"`);
    return c;
  };
  // 1. a computer that never set a zero: trace, air cut and cut each open their own card
  c = await opens('trace', /^Trace/, 'never zeroed');
  check(c && /zero\sis\sset\son\sthe\smachine/.test(c.text), 'the trace card asks to confirm the zero too');
  await opens('air', /air/i, 'never zeroed');
  c = await opens('cut', /^Cut t\.sbp/, 'never zeroed');
  check(c && /not zeroed in swarf/.test(c.text) && /zero\sis\sset\son\sthe\smachine/.test(c.text), 'the cut card says the zero is not set, and asks the student to confirm it');
  const waits = await page.evaluate(() => ['trace', 'air', 'cut'].map(k => document.querySelector(`#swarf-run button.${k}`).classList.contains('wait')));
  check(waits.every(w => !w), `no run button waits on the zero (${waits})`);
  // 2. the box restarted
  await page.evaluate(() => { const S = window.__swarfRun.state; S.zeroLost = true; S.zeroXY = S.zeroZ = false; S.zx = S.zy = false; });
  await opens('trace', /^Trace/, 'after a restart');
  await opens('cut', /^Cut t\.sbp/, 'after a restart');
  await shut();
  // 4. a pending bit change: cut does not wait for Z
  await page.evaluate(() => { const S = window.__swarfRun.state; S.zeroLost = false; S.zeroXY = S.zx = S.zy = true; S.zeroZ = false; S.toolChange = 'Tool change at line 5.'; S.zStale = true; window.__swarfRun.tell('x'); });
  await wait(5400);   // the told line steps aside and control refreshes
  const wt = await page.evaluate(() => { const b = document.querySelector('#swarf-run button.cut'); return { wait: b.classList.contains('wait'), why: b.dataset.why }; });
  check(!wt.wait, `bit change: cut does not wait for Z (${wt.why || 'no wait'})`);

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
