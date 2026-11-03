// The machining time (Phil 11-02: "a machining time estimate for all paths being simulated here and
// all selected toolpaths being run ... make sure the estimate that goes in export is accurate as
// well"). A 200 x 120 board with an outline and a stone-wall texture: after toolpaths each step card
// shows its share; simulate's bar shows the whole job and, while it plays, the time left falling;
// export says the same number. A part left out takes its time away. (How close the number is to the
// card's own clock: tools/shopbot/test-estimate.mjs.)
//   node tools/probe_estimate.mjs [url]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-estimate';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const addOp = (page, op) => page.evaluate(op => { const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === op); el && el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!el; }, op);
const toolpaths = page => page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); document.getElementById('act-paths').click(); setTimeout(res, 120000); }));
const fresh = page => page.waitForFunction(() => window.SwarfEstimateUI.state().current, { timeout: 60000, polling: 200 }).then(() => true, () => false);
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfTex && window.SwarfTexCore && window.SwarfEstimateUI), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); const s = a.conf.get(); s.process.ops = []; a.conf.save(); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="120mm" viewBox="0 0 200 120"><rect width="200" height="120" fill="#000"/></svg>', 'board', { depth: 19, resolution: 2, soup: true, dpi: 0 }); });
  await wait(1200);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); });
  await addOp(page, 'outline'); await wait(500);
  // TEX: stone wall over a band of the top
  await page.click('#swarf-step-tex');
  await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 15000 });
  await page.evaluate(() => {
    const S = window.__swarfTex.state(), C = window.SwarfTexCore, p = S.parts[0];
    S.sel = 0;
    const g = C.newGrid(p.box[0] - 2, p.box[1] - 2, p.box[2] + 2, p.box[3] + 2, 0.5);
    C.paintWhere(g, (x, y) => x > p.box[0] + 30 && x < p.box[0] + 110 && y > p.box[1] + 30 && y < p.box[3] - 30, 1);
    p.marks.push({ id: 'est', made: 'region', region: g, xf: C.IDENTITY.slice(), fill: C.newFill('stone', { tool: 1018, origin: [0, 0] }), ver: 1 });
    S.mark = 0; p.dirty = true;
  });
  await page.click('#tx-done');
  await wait(1000);
  check(await toolpaths(page) !== undefined, 'toolpaths');
  check(await fresh(page), 'the time is worked out after toolpaths');
  const a = await page.evaluate(() => {
    const st = window.SwarfEstimateUI.state(), ops = window.kiri.api.conf.get().process.ops;
    const cards = [...document.querySelectorAll('#oplist .swarf-op-time')].map(t => ({ step: +t.dataset.step, type: ops[+t.dataset.step] && ops[+t.dataset.step].type, text: t.textContent, shown: !!t.offsetParent }));
    return { sec: st.est.seconds, cut: st.est.cut, air: st.est.air, changes: st.est.changes, steps: st.est.steps, cards };
  });
  console.log('   ', JSON.stringify(a));
  const sum = Object.values(a.steps).reduce((x, y) => x + y, 0);
  check(a.sec > 60 && a.cut > a.air, `a real job: ${(a.sec / 60).toFixed(1)} min, cutting ${(a.cut / 60).toFixed(1)}, in the air ${(a.air / 60).toFixed(1)}`);
  check(Math.abs(sum - a.sec) / a.sec < 0.02, `the steps' shares add up to the whole (${sum.toFixed(0)} of ${a.sec.toFixed(0)} s)`);
  check(a.cards.length === 2 && a.cards.every(c => c.shown && /\d/.test(c.text)), `each step card shows its time: ${a.cards.map(c => `${c.type} ${c.text}`).join(', ')}`);
  await page.screenshot({ path: `${OUT}-steps.png` });

  // simulate: the whole job on the bar, and the time left falling as it plays
  await page.evaluate(() => { const b = [...document.querySelectorAll('.swarf-step, #act-animate, button')].find(e => /^\s*simulate\s*$/i.test(e.textContent)); b && b.click(); });
  await page.waitForFunction(() => { const e = document.querySelector('#layer-animate .swarf-sim-time'); return e && e.offsetParent && /min/.test(e.textContent); }, { timeout: 60000 }).catch(() => {});
  const b0 = await page.evaluate(() => { const e = document.querySelector('#layer-animate .swarf-sim-time'); return e ? { text: e.textContent, title: e.title, shown: !!e.offsetParent, last: e === [...e.parentNode.querySelectorAll('.swarf-sim-extra')].pop() } : null; });
  console.log('   bar:', JSON.stringify(b0));
  const words = await page.evaluate(s => window.SwarfEstimate.words(s), a.sec);
  check(b0 && b0.shown && b0.text.startsWith(words), `simulate's bar says the job's time ("${b0 && b0.text}")`);
  check(b0 && b0.last, 'it sits after the bar\'s toggles');
  check(b0 && /cutting .* in the air/.test(b0.title), 'its tooltip splits cutting from moving in the air');
  const lefts = [];
  for (let i = 0; i < 8; i++) {
    await wait(700);
    const t = await page.evaluate(() => document.querySelector('#layer-animate .swarf-sim-time').textContent);
    const m = t.match(/· (\d+) (min|s) left/);
    if (m) lefts.push(+m[1] * (m[2] === 'min' ? 60 : 1));
  }
  console.log('   left:', lefts.join(', '));
  check(lefts.length >= 3 && lefts[lefts.length - 1] < lefts[0], `while it plays the time left falls (${lefts[0]} s → ${lefts[lefts.length - 1]} s)`);
  await page.screenshot({ path: `${OUT}-sim.png` });

  // export: the same number (the card is looked at, never saved: nothing is downloaded)
  await page.evaluate(() => window.kiri.api.modal.hide && window.kiri.api.modal.hide());
  await page.evaluate(() => document.getElementById('act-export').click());
  await page.waitForFunction(() => { const c = document.querySelector('#mod-x-any.swarf-x .swarf-x-card'); return c && c.offsetParent; }, { timeout: 60000 }).catch(() => {});
  const facts = await page.evaluate(() => { const c = document.querySelector('.swarf-x-card .swarf-x-facts'); return c ? c.textContent : ''; });
  check(facts.startsWith(words), `export says the same time ("${facts}")`);
  const kiriTime = await page.evaluate(() => document.getElementById('output-time') && document.getElementById('output-time').value);
  const hms = kiriTime ? kiriTime.split(':').map(Number) : [0, 0, 0];
  check(Math.abs(hms[0] * 3600 + hms[1] * 60 + hms[2] - a.sec) <= 2, `advanced's time row agrees (${kiriTime})`);
  await page.screenshot({ path: `${OUT}-export.png` });
  await page.evaluate(() => window.kiri.api.modal.hide()); await wait(400);

  // leave the part out: no part, no time
  await page.evaluate(() => { const a = window.kiri.api, w = a.widgets.all()[0]; a.platform.set_cut([w], false); });
  await wait(2000);
  const gone = await page.evaluate(() => ({ cur: window.SwarfEstimateUI.state().current, cards: [...document.querySelectorAll('#oplist .swarf-op-time')].map(t => t.textContent).join('') }));
  check(!gone.cur && gone.cards === '', `a change makes the old time go (${JSON.stringify(gone)})`);
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `estimate: ${bad.length} failed, ${errors.length} page errors` : 'estimate: ok');
process.exit(bad.length || errors.length ? 1 : 0);
