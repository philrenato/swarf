// r093 control fixes in the browser (simulator): A4 keepZero after a dropped link asks for a trace,
// A5 search down accepted in the simulator, A8 one plate canvas across cards, A9 the last step's
// picture moves on, A15 the viewer stops drawing while control is shut.
//   node tools/probe_r093_control.mjs [url]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfRun), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#000"/></svg>', 'disc', { depth: 6, resolution: 2, segmin: 48, soup: true, dpi: 0 }); });
  await wait(600);
  await page.evaluate(() => { const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(400);
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); setTimeout(res, 60000); }));
  await page.click('#swarf-step-run');
  await page.waitForFunction(() => window.__swarfRun.state.prog && window.__swarfRun.state.machine, { timeout: 60000 });
  await wait(600);
  const btn = t => page.evaluate(t => [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent === t && b.offsetParent).click(), t);
  await page.evaluate(() => { window.__swarfRun.state.machine.timeScale = 50; });

  // A15 -----------------------------------------------------------------------------------
  await page.evaluate(() => { const v = window.__swarfRun.view(); window.__draws = 0; const r = v.renderer.render.bind(v.renderer); v.renderer.render = (...a) => { window.__draws++; return r(...a); }; });
  await wait(500);
  const openDraws = await page.evaluate(() => window.__draws);
  await page.evaluate(() => window.__swarfRun.close());
  await wait(300);
  const d0 = await page.evaluate(() => window.__draws);
  await wait(1000);
  const shutDraws = await page.evaluate(() => window.__draws) - d0;
  await page.evaluate(() => window.__swarfRun.open());
  await wait(500);
  const d1 = await page.evaluate(() => window.__draws);
  await wait(500);
  const reopened = await page.evaluate(() => window.__draws) - d1;
  check(openDraws > 5 && shutDraws === 0 && reopened > 5, `A15 viewer draws: open ${openDraws}/0.5 s, shut ${shutDraws}/1 s, reopened ${reopened}/0.5 s`);

  // A4 ------------------------------------------------------------------------------------
  const a4 = await page.evaluate(() => {
    const S = window.__swarfRun.state;
    Object.assign(S, { zeroHad: { xy: true, z: true }, zeroSetAt: Date.now(), zeroReconnect: true, discAt: 0, lostAt: 0, stoppedAt: 0, traced: true, zeroXY: false, zeroZ: false, zx: false, zy: false });
    document.querySelector('#swarf-run .sr-keepzero').click();
    return { traced: S.traced, say: document.querySelector('.sr-say').textContent };
  });
  check(a4.traced === false && /Trace once/.test(a4.say), `A4 the link dropped while idle, zero kept: trace asked for (traced ${a4.traced}, "${a4.say.slice(0, 60)}")`);

  // A5 + A8 + A9 --------------------------------------------------------------------------
  await btn('zero x y');
  await page.evaluate(() => window.__swarfRun.state.machine.jog('z', 5));
  await page.waitForFunction(() => !window.__swarfRun.state.machine.busy(), { timeout: 10000 });
  await page.evaluate(() => { window.__canv = new Set(); });
  for (let i = 0; i < 3; i++) {
    await btn('z plate');
    await page.waitForFunction(() => document.querySelector('#swarf-run .sr-sheet.on .sr-plate'), { timeout: 5000 });
    await wait(200);
    await page.evaluate(() => window.__canv.add(document.querySelector('#swarf-run .sr-plate-view canvas')));
    if (i < 2) { await btn('cancel'); await wait(200); }
  }
  const canv = await page.evaluate(() => window.__canv.size);
  check(canv === 1, `A8 three plate cards, ${canv} canvas(es)`);
  const reach = await page.evaluate(() => { const i = document.querySelectorAll('#swarf-run .sr-plate-t input')[1]; i.value = '80'; i.dispatchEvent(new Event('change')); return { v: i.value, t: window.__swarfRun.state.machine.plateCfg.travel, say: document.querySelector('.sr-say').textContent }; });
  check(reach.v === '80' && reach.t === 80, `A5 search down 80 in the simulator: field ${reach.v}, travel ${reach.t} ("${reach.say.slice(0, 50)}")`);
  await page.evaluate(() => { for (const c of [...document.querySelectorAll('#swarf-run .sr-plate input[type=checkbox]')].slice(0, 3)) c.click(); });
  await btn('touch the plate to the bit');
  await page.evaluate(() => document.querySelector('#swarf-run .sr-sheet.on .go').click());
  await page.waitForFunction(() => /^Z zeroed/.test(window.__swarfRun.state.machine.state.note), { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#swarf-run .sr-sheet.on'), { timeout: 5000 });
  await wait(400);
  const plateLabel = await page.evaluate(() => document.querySelector('#swarf-run .sr-plate-view .b').style.display);
  check(plateLabel === 'none', `A9 "Z is zero": the picture moved on to 'away' (plate label display "${plateLabel}")`);
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `r093: ${bad.length} failed, ${errors.length} page errors` : 'r093: ok');
process.exit(bad.length || errors.length ? 1 : 0);
