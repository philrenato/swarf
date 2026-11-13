// The adversarial review of 11-13 (v00000-114), in the simulator:
//  #1 the plan says the size check and the place check apart ("small enough for the machine"; where it lands
//     is not checked before an X Y zero; the facts say the bit's path)
//  #2 a zero kept across cam shows as an assumption with drop buttons; a fresh Z retires its half; "the board
//     moved" forgets X Y and is not offered back
//  #3 the saved machine file carries the open concerns, and control reads them back from a file opened alone
//  #4 "save the project too" leaves the export card open
//  #7 the tabs block says how many tabs are placed; #9 the add-step items are keyboard buttons
// Nothing is downloaded: api.util.download is caught.
//   node tools/probe_review_1113.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-r1113-')), args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfRun), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => {
    window.__dl = [];
    const u = window.kiri.api.util; u.download = (data, name) => { window.__dl.push({ name, data: String(data) }); };
    if (window.SwarfFile) window.SwarfFile.save = (o) => { window.__dl.push({ name: (o && o.name) + '.swarf', data: '' }); return Promise.resolve(true); };
  });
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><rect width="100" height="60"/></svg>', 'plate', { depth: 6, resolution: 2, segmin: 48, soup: true, dpi: 0 }); });
  await wait(600);

  // #9: the add-step items are buttons; Enter on outline adds it
  const a11y = await page.evaluate(() => { const k = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'outline'); return k ? { role: k.getAttribute('role'), tab: k.getAttribute('tabindex'), desc: k.getAttribute('aria-description') } : null; });
  check(a11y && a11y.role === 'button' && a11y.tab === '0' && !!a11y.desc, `outline is a keyboard button (${JSON.stringify(a11y)})`);
  const ops0 = await page.evaluate(() => document.getElementById('oplist').children.length);
  await page.evaluate(() => [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'outline').focus());
  await page.keyboard.press('Enter'); await wait(500);
  const ops1 = await page.evaluate(() => document.getElementById('oplist').children.length);
  check(ops1 > ops0, `Enter on outline adds the step (${ops0} -> ${ops1})`);
  const ctab = await page.evaluate(() => { const t = document.getElementById('swarf-concerns-tab'); return t ? { role: t.getAttribute('role'), exp: t.getAttribute('aria-expanded'), label: t.getAttribute('aria-label') } : null; });
  check(ctab && ctab.role === 'button' && ctab.exp === 'false' && /concerns/.test(ctab.label || ''), `concerns is a disclosure button (${JSON.stringify(ctab)})`);

  // #7: the tabs block says none are placed, then how many
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); });
  await wait(1500);
  const p0 = await page.evaluate(() => { const e = document.querySelector('.swarf-autotabs-placed'); const g = document.getElementById('swarf-autotabs-go'); return { t: e && e.textContent, none: e && e.classList.contains('none'), go: g && g.textContent }; });
  check(/^0 tabs placed/.test(p0.t || '') && p0.none && /^auto tabs: place \d+$/.test(p0.go || ''), `before: ${JSON.stringify(p0)}`);

  // #3, #4: export with the no-tabs concern open; the project button keeps the card; the file carries the concern
  const paths = () => page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', () => res('ok')); document.getElementById('act-paths')?.click(); setTimeout(() => res('timeout'), 60000); }));
  check(await paths() === 'ok', 'toolpaths (no tabs)');
  await page.evaluate(() => document.getElementById('act-export').click());
  await page.waitForFunction(() => { const c = document.querySelector('#mod-x-any.swarf-x .swarf-x-card'); return c && c.offsetParent; }, { timeout: 60000 }).catch(() => {});
  await page.evaluate(() => document.querySelector('.swarf-x-card .swarf-x-proj').click()); await wait(300);
  const card = await page.evaluate(() => { const c = document.querySelector('#mod-x-any .swarf-x-card'); const p = c && c.querySelector('.swarf-x-proj'); return { open: !!(c && c.offsetParent), proj: p && p.textContent, dl: window.__dl.map(d => d.name) }; });
  check(card.open && /project saved/.test(card.proj || '') && card.dl.some(n => /\.swarf$/.test(n)), `the project saves and the card stays open (${JSON.stringify(card)})`);
  await page.evaluate(() => document.querySelector('.swarf-x-card .swarf-x-go').click()); await wait(500);
  const file = await page.evaluate(() => window.__dl.find(d => /\.sbp$/.test(d.name)));
  const head = file ? file.data.split('\n').slice(0, 4) : [];
  check(!!file && /^' swarf saved: \d{4}-\d\d-\d\d, \d+ concerns? open/.test(head[0]) && head.some(l => /^' swarf concern: .*no tabs/.test(l)), `the file's head carries the concern (${JSON.stringify(head)})`);
  check(head.filter(l => /^' swarf /.test(l)).every(l => /^[\x20-\x7e]*$/.test(l) && l.length <= 130), 'the swarf lines are short plain ASCII');

  // control reads it back from the file opened on its own
  await page.click('#swarf-step-run');
  await page.waitForFunction(() => window.__swarfRun.state.prog && window.__swarfRun.state.machine && !window.__swarfRun.state.camBusy, { timeout: 60000 });
  await wait(800);
  await page.evaluate(() => { window.__swarfRun.state.machine.timeScale = 50; });
  const plan = () => page.evaluate(() => ({ plan: document.querySelector('#swarf-run .sr-plan').innerText, facts: document.querySelector('#swarf-run .sr-facts').textContent }));
  const pl0 = await plan();
  check(/small enough for the machine/.test(pl0.plan) && !/fits the table/.test(pl0.plan) && /where it lands on the table: not checked until X Y is zeroed/.test(pl0.plan), `#1 before a zero the place is not claimed (${pl0.plan.split('\n').slice(0, 3).join(' / ')})`);
  check(/^bit's path /.test(pl0.facts) && /the part itself is smaller/.test(pl0.plan), `#1 the facts say the bit's path ("${pl0.facts}")`);
  await page.evaluate(t => window.__swarfRun.loadProgram('handed-over.sbp', t, 'file'), file.data); await wait(400);
  const pl1 = await plan();
  check(/When this file was saved, swarf said: .*no tabs/.test(pl1.plan), '#3 a file opened alone shows the concern it was saved with');
  const bare = file.data.split('\n').filter(l => !/^' swarf /.test(l)).join('\n');
  await page.evaluate(t => window.__swarfRun.loadProgram('other-software.sbp', t, 'file'), bare); await wait(400);
  const pl2 = await plan();
  check(/cannot see what holds each part down/.test(pl2.plan), '#3 a file with no swarf lines says swarf cannot see the workholding');
  check(!/can't carry out/.test(pl1.plan + pl2.plan), 'the head lines are not unsupported lines');

  // #2: zero, cam and back, the kept note and its buttons
  const btn = t => page.evaluate(t => { const b = [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent.trim() === t && b.offsetParent); if (b) b.click(); return !!b; }, t);
  await page.evaluate(() => window.__swarfRun.close()); await wait(500);
  await page.click('#swarf-step-run');
  await page.waitForFunction(() => window.__swarfRun.state.prog && window.__swarfRun.state.prog.source === 'cam' && !window.__swarfRun.state.camBusy, { timeout: 60000 });
  await wait(800);
  check(await btn('zero x y') && await btn('zero z'), 'zero x y and zero z'); await wait(300);
  const pl3 = await plan();
  check(/on the table from this zero|not checked \(swarf does not know the table's corner/.test(pl3.plan), `#1 after the zero the place row moves on (${(pl3.plan.match(/.*on the table.*|.*where it lands.*/) || [''])[0]})`);
  await page.evaluate(() => window.__swarfRun.close()); await wait(500);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); const b = a.widgets.all()[0].getBoundingBox(); a.selection.scale(140 / (b.max.x - b.min.x), 80 / (b.max.y - b.min.y), 1); });
  await wait(400);
  check(await paths() === 'ok', 'toolpaths again, bigger part');
  await page.click('#swarf-step-run');
  await page.waitForFunction(() => window.__swarfRun.state.prog && !window.__swarfRun.state.camBusy, { timeout: 60000 });
  await wait(800);
  const kept = () => page.evaluate(() => { const k = document.querySelector('#swarf-run .sr-kept'); const S = window.__swarfRun.state; return { text: k ? k.textContent : '', buttons: k ? [...k.querySelectorAll('button')].map(b => b.textContent) : [], xy: !!S.zeroXY, z: !!S.zeroZ, traced: !!S.traced, offer: (() => { const b = document.querySelector('#swarf-run .sr-keepzero'); return b && getComputedStyle(b).display !== 'none' ? b.textContent : ''; })() }; });
  const k0 = await kept();
  check(k0.xy && k0.z && /using the earlier zero \(X Y and Z/.test(k0.text) && k0.buttons.length === 2, `#2 the kept zero shows with two drop buttons (${JSON.stringify(k0)})`);
  check(await btn('zero z'), 'a fresh Z'); await wait(400);
  const k1 = await kept();
  check(/using the earlier zero \(X Y[;)]/.test(k1.text) && k1.buttons.length === 1 && k1.buttons[0] === 'the board moved' && k1.z, `#2 a fresh Z retires its half of the note (${JSON.stringify(k1)})`);
  check(await btn('the board moved'), 'press the board moved'); await wait(400);
  const k2 = await kept();
  check(!k2.xy && k2.z && !k2.traced && !k2.text && !/X Y/.test(k2.offer), `#2 X Y forgotten, not offered back, Z kept (${JSON.stringify(k2)})`);
  // #8 (115): the target in the top row, the next step pinned in the jog panel, the pinned header still live offline
  const lay = await page.evaluate(() => {
    const t = document.querySelector('#swarf-run .sr-top .sr-target'), n = document.querySelector('#swarf-run .sr-jog .sr-pin .sr-next'), pin = document.querySelector('#swarf-run .sr-jog .sr-pin');
    return { target: t && t.textContent, next: n && getComputedStyle(n).display !== 'none' ? n.textContent : '', sticky: pin && getComputedStyle(pin).position, pe: pin && getComputedStyle(pin).pointerEvents };
  });
  check(lay.target === 'practice simulator', `#8 the top row names the target ("${lay.target}")`);
  check(/^next: .*zero|^next: /.test(lay.next) && /x y|X Y|zero/i.test(lay.next), `#8 the next step is pinned in the jog panel ("${lay.next}")`);
  check(lay.sticky === 'sticky' && lay.pe !== 'none', `#8 the jog header stays put and takes clicks (${lay.sticky}, ${lay.pe})`);
  // #8: on a short screen open concerns take the size strip's place; Escape closes and gives focus back
  await page.evaluate(() => window.__swarfRun.close()); await wait(500);
  await page.setViewport({ width: 1280, height: 720 }); await wait(600);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); }); await wait(600);
  const size0 = await page.evaluate(() => { const z = document.getElementById('swarf-size'); return z ? getComputedStyle(z).display : 'none'; });
  await page.evaluate(() => document.getElementById('swarf-concerns-tab').focus());
  await page.keyboard.press('Enter'); await wait(300);
  const open = await page.evaluate(() => { const z = document.getElementById('swarf-size'); return { open: document.getElementById('swarf-concerns').classList.contains('open'), size: z ? getComputedStyle(z).display : 'none', exp: document.getElementById('swarf-concerns-tab').getAttribute('aria-expanded') }; });
  check(open.open && open.exp === 'true' && open.size === 'none', `#8 at 720 the open concerns replace the size strip (strip was ${size0}: ${JSON.stringify(open)})`);
  await page.keyboard.press('Escape'); await wait(300);
  const shut = await page.evaluate(() => { const z = document.getElementById('swarf-size'); return { open: document.getElementById('swarf-concerns').classList.contains('open'), size: z ? getComputedStyle(z).display : 'none', focus: document.activeElement && document.activeElement.id }; });
  check(!shut.open && shut.size === size0 && shut.focus === 'swarf-concerns-tab', `#8 Escape closes, the strip comes back, focus stays on the tab (${JSON.stringify(shut)})`);
  check(!errors.length, `no page errors ${errors.slice(0, 3).join(' | ')}`);
} finally {
  await browser.close();
}
console.log(bad.length ? `\n${bad.length} FAILED` : '\nPASS');
process.exit(bad.length ? 1 : 0);
