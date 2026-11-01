// Every kind of number field reads mm or inches whatever the setting, and shows the scene's precision
// (Phil 11-01: "everything should accept mm or in when units are typed in"). In mm and in inches it
// types 3/4, 3/4 in, 19 mm and 0.75" (and a bare number) into one field of each kind: a cam field
// with units (limits › clearance), a cam rate (rapid feed), a bit's size in the bits editor, the step
// card's step-down and feed, DRAW's thickness and the size card; it checks the number stored (mm)
// and the number shown, and that a number past a hard limit is refused or held, with its range said.
//   node tools/probe_units_fields.mjs [url]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://127.0.0.1:8080/swarf-app/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const near = (a, b, t = 0.002) => Math.abs(a - b) <= t;
// what each form means, in mm, in each units setting
const FORMS = [['3/4', 19.05], ['3/4 in', 19.05], ['19 mm', 19], ['0.75"', 19.05], ['1 1/2 in', 38.1], ['2 cm', 20]];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(4000);
  await page.waitForFunction(() => !!(window.kiri?.api?.event && window.kiri.api.platform?.load_svg && window.__swarfShape && window.SwarfLength && window.kiri.api.ui?.camZClearance), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  const units = async u => { await page.evaluate(u => { const s = window.kiri.api.ui.units; s.value = u; s.onchange(); }, u); await wait(400); };
  const alerts = () => page.evaluate(() => [...document.querySelectorAll('.kiri-alert, #alert-area div, .alert')].map(e => e.textContent).join(' | '));
  const clearAlerts = () => page.evaluate(() => { try { window.kiri.api.event.alerts(true); } catch (e) { /* none */ } });

  // a part, so the steps panel and DRAW have something to work on
  await page.click('#swarf-step-shape');
  await wait(500);
  await page.evaluate(() => { const s = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }; s('shape-kind', 'rect'); s('shape-w', '150 mm'); s('shape-h', '100 mm'); s('shape-t', '19.05 mm'); });
  await wait(100);
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => /^make$/i.test(b.textContent.trim()) && b.offsetParent).click());
  await page.waitForFunction(() => window.kiri.api.widgets.all().length === 1, { timeout: 10000 });
  await wait(1200);

  // 1. a cam field with units: clearance (process.camZClearance, bound 0.01 to 100 in the units shown)
  const kiriField = (key, text) => page.evaluate((key, text) => {
    const el = window.kiri.api.ui[key];
    el.focus(); el.value = text; el.dispatchEvent(new Event('blur'));
    const s = window.kiri.api.conf.get();
    return { stored: s.process[key], shown: el.value };
  }, key, text);
  for (const u of ['mm', 'in']) {
    await units(u);
    for (const [t, mm] of FORMS) {
      const r = await kiriField('camZClearance', t);
      check(near(r.stored, mm), `[${u}] clearance "${t}" stored ${r.stored} mm (wanted ${mm})`);
      const want = u === 'in' ? String(+(mm / 25.4).toFixed(3)) : String(+mm.toFixed(3));
      check(r.shown === want, `[${u}] clearance "${t}" shows "${r.shown}" (wanted "${want}")`);
    }
    const bare = await kiriField('camZClearance', u === 'in' ? '0.5' : '12.7');
    check(near(bare.stored, 12.7), `[${u}] a bare number is in ${u}: stored ${bare.stored}`);
    await clearAlerts();
    const big = await kiriField('camZClearance', '250');
    const a = await alerts();
    // Kiri's bounds are in mm whatever the units (a clearance is 0.01 to 100 mm, never 100 in)
    check(near(big.stored, 100) && (u === 'in' ? /3\.937 in/.test(a) : /100 mm/.test(a)), `[${u}] past its bound it is held at 100 mm and the range is said in ${u} ("${a.replace(/\s+/g, ' ').slice(0, 90)}")`);
    await clearAlerts();
    const junk = await kiriField('camZClearance', 'abc');
    check(near(junk.stored, big.stored) && /could not read/.test(await alerts()), `[${u}] "abc" keeps the old value and says so (${junk.stored})`);
    // 2. a cam rate with units: the rapid feed, mm/min or in/min
    const r1 = await kiriField('camFastFeed', u === 'in' ? '60' : '1500');
    check(near(r1.stored, u === 'in' ? 1524 : 1500, 0.01), `[${u}] rapid feed typed bare: ${r1.stored} mm/min`);
    const r2 = await kiriField('camFastFeed', '2000 mm');
    check(near(r2.stored, 2000, 0.01), `[${u}] rapid feed "2000 mm": ${r2.stored} mm/min`);
    await kiriField('camFastFeed', '3000 mm');
  }

  // 3. a bit's size in the bits editor, in the bit's own unit
  await units('in');
  await page.evaluate(() => window.kiri.api.show.tools());
  await wait(800);
  const bit = (text, metric) => page.evaluate((text, metric) => {
    const ui = window.kiri.api.ui;
    ui.toolAdd.click();
    ui.toolMetric.checked = metric;
    ui.toolMetric.onclick && ui.toolMetric.onclick();
    const el = ui.toolFluteDiam;
    el.focus(); el.value = text; el.dispatchEvent(new Event('blur'));
    return { shown: el.value, real: el.real };
  }, text, metric);
  for (const [t, mm, metric] of [['1/4', 6.35, false], ['6 mm', 6, false], ['0.25"', 6.35, true], ['6', 6, true], ['6', 152.4, false]]) {
    const r = await bit(t, metric);
    const k = metric ? 1 : 25.4;
    check(near(r.real * k, mm, 0.003), `bit (${metric ? 'mm' : 'in'}) width "${t}": ${r.real} ${metric ? 'mm' : 'in'} = ${+(r.real * k).toFixed(3)} mm (wanted ${mm})`);
    check(r.shown === String(+(mm / k).toFixed(4)), `bit width "${t}" shows "${r.shown}"`);
  }
  await clearAlerts();
  const zero = await page.evaluate(() => { const el = window.kiri.api.ui.toolFluteDiam, was = el.real; el.focus(); el.value = '0'; el.dispatchEvent(new Event('blur')); return { was, now: el.real, shown: el.value }; });
  check(zero.now === zero.was && /above 0/.test(await alerts()), `a bit width of 0 is refused, old ${zero.was} stays (${zero.shown})`);
  await page.evaluate(() => { window.kiri.api.uc.confirm = () => Promise.resolve(true); });
  await page.evaluate(() => { const c = window.kiri.api.ui.toolsClose; c && c.click(); });
  await wait(500);
  await page.evaluate(() => { try { window.kiri.api.dialog.hide(); } catch (e) { /* closed */ } });
  await wait(300);

  // 4. the step card: step-down a length, feed a rate, stepover a share
  const op = (f, text) => page.evaluate((f, text) => {
    const inp = document.querySelector(`[data-swarf-field="${f}"]`);
    if (!inp) return null;
    inp.value = text; inp.dispatchEvent(new Event('change', { bubbles: true }));
    const ops = window.kiri.api.conf.get().process.ops.filter(o => o && o.type && o.type !== '|');
    const id = inp.dataset.op, rec = ops.find(o => [...document.querySelectorAll(`[data-op="${id}"]`)].length && o[f] !== undefined);
    const now = document.querySelector(`[data-swarf-field="${f}"]`);
    return { shown: now && now.value, v: ops.map(o => o[f]).filter(v => v !== undefined) };
  }, f, text);
  await page.evaluate(() => window.kiri.api.platform.select(window.kiri.api.widgets.all()[0]));
  await page.evaluate(() => { const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'outline'); el && el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(600);
  const hasCard = await page.evaluate(() => !!document.querySelector('[data-swarf-field="down"]'));
  check(hasCard, 'the steps panel has a step-down field');
  if (hasCard) {
    for (const u of ['mm', 'in']) {
      await units(u);
      await wait(300);
      for (const [t, mm] of [['1/8', 3.175], ['1/8 in', 3.175], ['3 mm', 3], ['0.125"', 3.175]]) {
        const r = await op('down', t);
        check(r && r.v.some(v => near(v, mm)), `[${u}] step-down "${t}" stored ${r && r.v[0]} mm (wanted ${mm})`);
        const want = u === 'in' ? window_field(mm) : String(+mm.toFixed(3));
        check(r && r.shown === want, `[${u}] step-down "${t}" shows "${r && r.shown}" (wanted "${want}")`);
      }
      await clearAlerts();
      const deep = await op('down', u === 'in' ? '7' : '200');
      check(deep && deep.v.some(v => near(v, 3.175)) && /up to/.test(await alerts()), `[${u}] a step-down past 150 mm is refused, said with its limit`);
      const f1 = await op('rate', u === 'in' ? '60' : '1500');
      check(f1 && f1.v.some(v => near(v, u === 'in' ? 1524 : 1500, 0.01)), `[${u}] feed bare: ${f1 && f1.v[0]}`);
      const f2 = await op('rate', u === 'in' ? '1500 mm/min' : '60 in/min');
      check(f2 && f2.v.some(v => near(v, u === 'in' ? 1500 : 1524, 0.01)), `[${u}] feed with the other unit named: ${f2 && f2.v[0]}`);
      const step = await page.evaluate(() => !!document.querySelector('[data-swarf-field="step"]'));
      if (step) {
        const s1 = await op('step', '40 %');
        check(s1 && s1.v.some(v => near(v, 0.4, 1e-9)) && s1.shown === '40', `[${u}] stepover "40 %": ${s1 && s1.v[0]}, shows ${s1 && s1.shown}`);
        await clearAlerts();
        const s2 = await op('step', '150');
        check(s2 && s2.v.some(v => near(v, 0.4, 1e-9)) && /100 %/.test(await alerts()), `[${u}] stepover 150 refused with its range`);
      }
    }
  }

  // 5. DRAW's thickness and the size card, in inches with mm typed and back
  await units('in');
  await page.evaluate(() => window.kiri.api.platform.select(window.kiri.api.widgets.all()[0]));
  await wait(500);
  const sizeType = (i, t) => page.evaluate((i, t) => { const el = document.querySelectorAll('#swarf-size input:not([type=checkbox])')[i]; el.focus(); el.value = t; el.dispatchEvent(new Event('input')); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); }, i, t);
  await sizeType(0, '200 mm'); await wait(900);
  const sz = await page.evaluate(() => [...document.querySelectorAll('#swarf-size input:not([type=checkbox])')].map(i => i.value));
  check(sz[0] === "7.874", `size card width "200 mm" in inches shows "${sz[0]}" (3 places) [${sz}]`);
  await page.evaluate(() => window.__swarfDraw && window.__swarfDraw.open());
  await wait(1200);
  await page.evaluate(() => { const el = document.getElementById('sd-t'); if (!el) return; el.value = '19 mm'; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); });
  await wait(300);
  const dt = await page.evaluate(() => { const S = window.__swarfDraw.state(), p = S && S.parts[S.sel]; const el = document.getElementById('sd-t'); return { thick: p && p.thick, shown: el && el.value }; });
  check(near(dt.thick, 19) && dt.shown === '0.748', `DRAW thickness "19 mm" in inches: ${dt.thick} mm, shows "${dt.shown}"`);
  await page.evaluate(() => { const el = document.getElementById('sd-t'); if (!el) return; el.value = '7 in'; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); });
  await wait(300);
  const dt2 = await page.evaluate(() => { const S = window.__swarfDraw.state(), p = S && S.parts[S.sel]; return { thick: p && p.thick, say: (document.getElementById('sd-say') || {}).textContent || '' }; });
  check(near(dt2.thick, 19) && /in/.test(dt2.say) && /\d/.test(dt2.say), `DRAW thickness 7 in is refused, said in inches ("${dt2.say}")`);
  await page.keyboard.press('Escape');
  await wait(300);
  await units('mm');
  check(await page.evaluate(() => window.SwarfLength.unit()) === 'mm', 'back to mm');
} finally {
  await browser.close();
}
function window_field(mm) { const v = mm / 25.4, n = Math.round(v * 32); if (n && Math.abs(v - n / 32) <= 0.0005) { let a = n, b = 32; while (a % 2 === 0 && b > 1) { a /= 2; b /= 2; } const w = Math.floor(a / b), r = a % b; return w && r ? `${w} ${r}/${b}` : w ? `${w}` : `${r}/${b}`; } return String(+v.toFixed(3)); }
const real = errors.filter(e => !/ResizeObserver|favicon/.test(e));
check(!real.length, `no page errors (${real.slice(0, 3).join(' | ')})`);
console.log(bad.length ? `units fields: ${bad.length} FAILED` : 'units fields: all ok');
process.exit(bad.length ? 1 : 0);
