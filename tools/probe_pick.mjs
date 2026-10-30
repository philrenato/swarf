// Pick, duplicate, delete, edit — after toolpaths (Phil 10-27: "after I make
// something, how do I select, delete etc?"). In the toolpaths view a real click
// on the part goes back to arranging with it picked; the size card shows edit
// in draw / duplicate / delete; the copy keeps its drawing and sits beside the
// original; delete removes the picked part; edit in draw opens DRAW on it.
//   node tools/probe_pick.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = process.env.CHROME || (process.env.HOME + '/.local/bin/chrome-for-testing');
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-pick';
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfDraw && document.getElementById('swarf-size')), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  await page.evaluate(() => { for (const w of window.kiri.api.widgets.all()) window.kiri.api.platform.delete(w); });
  await page.evaluate(() => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="900mm" height="600mm" viewBox="0 0 900 600"><rect width="900" height="600" fill="#000"/></svg>';
    window.kiri.api.platform.load_svg(svg, 'board', { depth: 18, resolution: 2, segmin: 48, soup: true, dpi: 0 });
    window.kiri.api.platform.deselect();
  });
  await wait(800);
  await page.evaluate(() => { const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(400);
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  const pv = await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', () => res('preview.end')); setTimeout(() => res('timeout'), 90000); }));
  await wait(500);
  const v0 = await page.evaluate(() => window.kiri.api.view.get());
  check(pv === 'preview.end' && v0 === 3, `toolpaths shown (view ${v0})`);
  // a real click on the part (it fills the middle of the canvas)
  const c = await page.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.click(c[0], c[1]);
  await wait(600);
  const st = await page.evaluate(() => { const a = window.kiri.api, card = document.getElementById('swarf-size'); return { view: a.view.get(), n: a.selection.count(), card: card.classList.contains('on'), buttons: [...card.querySelectorAll('.act')].filter(b => b.style.display !== 'none').map(b => b.textContent) }; });
  check(st.view === 1 && st.n === 1 && st.card && st.buttons.join() === 'edit in draw,duplicate,delete', `a click on the part in the toolpaths view picks it: ${JSON.stringify(st)}`);
  await page.screenshot({ path: `${OUT}-picked.png` });
  // duplicate
  await page.evaluate(() => [...document.querySelectorAll('#swarf-size .act')].find(b => b.textContent === 'duplicate').click());
  await wait(800);
  const dup = await page.evaluate(() => window.kiri.api.widgets.all().map(w => ({ x: +w.track.pos.x.toFixed(1), svg: /<svg/.test(w.meta.svg || ''), t: w.meta.t })));
  check(dup.length === 2 && dup.every(d => d.svg) && Math.abs(dup[1].x - dup[0].x) - 900 >= 11.9 && Math.abs(dup[1].x - dup[0].x) - 900 < 20, `the copy keeps its drawing and sits beside it, room for a bit between: ${JSON.stringify(dup)}`);
  // delete the copy (the picked one)
  await page.evaluate(() => { const a = window.kiri.api, ws = a.widgets.all(); a.platform.deselect(); a.platform.select(ws[1]); });
  await wait(300);
  await page.evaluate(() => [...document.querySelectorAll('#swarf-size .act')].find(b => b.textContent === 'delete').click());
  await wait(600);
  const left = await page.evaluate(() => ({ n: window.kiri.api.widgets.all().length, card: document.getElementById('swarf-size').classList.contains('on') }));
  check(left.n === 1 && !left.card, `delete removes it, and the card goes: ${JSON.stringify(left)}`);
  // edit in draw
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); });
  await wait(300);
  await page.evaluate(() => [...document.querySelectorAll('#swarf-size .act')].find(b => b.textContent === 'edit in draw').click());
  await wait(500);
  const dr = await page.evaluate(() => { const S = window.__swarfDraw.state(); return S && { sel: S.sel, name: S.parts[S.sel] && S.parts[S.sel].name, size: document.getElementById('swarf-size').classList.contains('on') }; });
  check(dr && dr.sel === 0 && /board/.test(dr.name) && !dr.size, `edit in draw opens DRAW on it: ${JSON.stringify(dr)}`);
  await page.evaluate(() => window.__swarfDraw.close(false));
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `pick: ${bad.length} failed, ${errors.length} page errors` : 'pick: ok');
process.exit(bad.length || errors.length ? 1 : 0);
