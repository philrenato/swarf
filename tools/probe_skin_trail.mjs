// Each skin its own trail and its own chips (Phil 11-02: "flying chips should only exist in swarf
// theme. And lightstreams in wet plastic should look like glass? And in classic they should look a
// little like barber poles"): the swarf skin draws the red light and has the chips toggle; wet plastic
// draws the glass look, classic the barber pole, and neither has chips; a skin changed at once redraws.
//   node tools/probe_skin_trail.mjs [url]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome-path.mjs';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const errors = [];
const url = process.argv[2] || 'http://localhost:8080/kiri/';
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'skin=swarf', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfTex), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(600);
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); const s = a.conf.get(); s.process.ops = []; a.conf.save();
    a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 60 40"><rect width="60" height="40"/></svg>', 'b', { depth: 12, soup: true, dpi: 0 }); });
  await wait(1500);
  await page.evaluate(() => { const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(500);
  await page.evaluate(() => window.kiri.api.function.prepare());
  await page.waitForFunction(() => window.__swarfLSPoints > 0, { timeout: 60000 });
  const state = () => page.evaluate(() => ({ ...window.__swarfLSLook(), chips: [...document.querySelectorAll('.swarf-toggle-chips')].map(b => getComputedStyle(b).display !== 'none') }));
  const setSkin = id => page.evaluate(id => { const row = document.getElementById('swarf-skin-' + id); if (row) row.click(); else window.SwarfSkin.set(id); }, id);
  let s = await state();
  check(s.light && !s.look, `swarf: the red light (${JSON.stringify(s)})`);
  check(s.chips.length && s.chips.every(Boolean), 'swarf: the chips toggle is there');
  for (const [id, mode, word] of [['glass', 0, 'wet plastic: glass'], ['classic', 1, 'classic: a barber pole']]) {
    await setSkin(id); await wait(400);
    s = await state();
    check(!s.light && s.look && s.mode === mode, `${word} (${JSON.stringify(s)})`);
    check(s.chips.every(c => !c), `${id}: no chips toggle`);
  }
  // chips: none are thrown outside the swarf skin, even with the toggle on
  await page.evaluate(() => { window.__swarfChipsVisible = true; window.dispatchEvent(new CustomEvent('swarf.chips.toggle', { detail: true })); });
  await page.evaluate(() => { const b = [...document.querySelectorAll('.swarf-step, #act-animate, button')].find(e => /^\s*simulate\s*$/i.test(e.textContent)); b && b.click(); });
  await page.waitForFunction(() => window.__swarfLSMoves > 20, { timeout: 30000 }).catch(() => {});
  await wait(1500);
  const air = await page.evaluate(() => (window.__swarfChipStats && window.__swarfChipStats.airborne) || 0);
  const moved = await page.evaluate(() => window.__swarfLSMoves || 0);
  check(moved > 20 && air === 0, `classic, chips on, simulating: no chips (${air}, the bit moved ${moved} times)`);
  await page.evaluate(() => document.getElementById('act-paths')?.click()); await wait(800);
  await setSkin('swarf'); await wait(400);
  s = await state();
  check(s.light && !s.look, 'back to swarf: the red light again');
  // and the same simulate in the swarf skin throws them (so the zero above is the skin's doing)
  await page.evaluate(() => { const b = [...document.querySelectorAll('.swarf-step, #act-animate, button')].find(e => /^\s*simulate\s*$/i.test(e.textContent)); b && b.click(); });
  let most = 0;
  for (let i = 0; i < 20 && !most; i++) { await wait(400); most = Math.max(most, await page.evaluate(() => (window.__swarfChipStats && window.__swarfChipStats.airborne) || 0)); }
  check(most > 0, `swarf, chips on, simulating: chips fly (${most})`);
  check(!errors.length, `no page errors${errors.length ? ': ' + errors[0] : ''}`);
} finally { await browser.close(); }
console.log(bad.length ? `skin trail: ${bad.length} failed` : 'skin trail: ok');
process.exit(bad.length ? 1 : 0);
