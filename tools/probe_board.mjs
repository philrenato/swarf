// Board size under material (Phil 11-16): "a button to add an optional material blank size. When active a
// block of material of that size is shown that is what the paths cut from ... can be toggled on and
// off/deleted." A 100 x 60 x 12 mm part on a 200 x 150 x 19 mm board: Kiri's stock is the board, the part
// centred on it and on its bottom, so the cut sits 50 / 45 mm in from the board's front-left corner, the
// top is cut down 7 mm and the outline goes 19 mm deep. A board too small or too thin is a concern. Off
// puts Kiri's stock back to the part's own size; the x removes the numbers.
//   node tools/probe_board.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-board-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfRun && document.getElementById('swarf-board-row')), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
  await wait(800);
  await page.evaluate(() => { const a = window.kiri.api; a.view.set_arrange && a.view.set_arrange(); for (const w of a.widgets.all()) a.platform.delete(w); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><rect width="100" height="60"/></svg>', 'plank', { depth: 12, soup: true, dpi: 0 }); });
  await wait(1200);
  await page.evaluate(() => { const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await wait(500);
  const row = () => page.evaluate(() => {
    const r = document.getElementById('swarf-board-row'), btns = [...r.querySelectorAll('button')].filter(b => b.offsetParent);
    const p = window.kiri.api.conf.get().process, st = window.kiri.api.conf.get().stock;
    return { buttons: btns.map(b => b.textContent), inputs: [...r.querySelectorAll('input')].filter(i => i.offsetParent).map(i => i.value),
      on: p.swarfBoardOn, offset: p.camStockOffset, sx: p.camStockX, sy: p.camStockY, sz: p.camStockZ, anchor: p.camZAnchor, stock: st && [st.x, st.y, st.z].map(v => +(+v).toFixed(2)) };
  });
  const r0 = await row();
  check(r0.buttons.join() === 'board size' && r0.offset !== false, `off at first: one button, Kiri's stock is the part (${JSON.stringify(r0)})`);
  const anchor0 = r0.anchor;
  // the button, then type the board
  await page.evaluate(() => [...document.querySelectorAll('#swarf-board-row button')].find(b => b.textContent === 'board size').click());
  await wait(500);
  const r1 = await row();
  check(r1.on && r1.inputs.length === 3 && +r1.inputs[0] >= 100 && +r1.inputs[1] >= 60, `board size: on, three fields from the part's size rounded up (${r1.inputs})`);
  for (const [i, v] of [[0, '200'], [1, '150'], [2, '19']]) {
    await page.evaluate((i, v) => { const f = [...document.querySelectorAll('#swarf-board-row input')][i]; f.value = v; f.dispatchEvent(new Event('change', { bubbles: true })); }, i, v);
    await wait(250);
  }
  const r2 = await row();
  check(r2.on && r2.offset === false && r2.sx === 200 && r2.sy === 150 && r2.sz === 19 && r2.anchor === 'bottom', `Kiri's stock is the board, the part on its bottom (${JSON.stringify(r2)})`);
  check(JSON.stringify(r2.stock) === '[200,150,19]', `the stock is 200 x 150 x 19 (${r2.stock})`);
  // the board is drawn on the bed
  const drawn = await page.evaluate(() => { let n = 0; window.moto.space.internals().platform.parent.traverse(o => { if (o.isMesh && o.geometry && o.geometry.type === 'BoxGeometry' && o.visible && Math.abs(o.scale.x - 200) < 0.1 && Math.abs(o.scale.y - 150) < 0.1) n++; }); return n; });
  check(drawn === 1, `the board shows on the bed (${drawn})`);
  // toolpaths, into control: where the cut sits
  await page.evaluate(() => document.getElementById('act-paths')?.click());
  await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); setTimeout(res, 90000); }));
  await wait(500);
  await page.click('#swarf-step-run');
  await page.waitForFunction(() => window.__swarfRun.state.prog && window.__swarfRun.state.prog.source === 'cam', { timeout: 90000 });
  const cut = await page.evaluate(() => {
    const mv = window.__swarfRun.state.prog.parsed.moves.filter(m => m.z < -0.01 || m.z0 < -0.01);
    const xs = mv.flatMap(m => [m.x, m.x0]), ys = mv.flatMap(m => [m.y, m.y0]), zs = mv.map(m => m.z);
    const r = a => +a.toFixed(2);
    return { minx: r(Math.min(...xs)), maxx: r(Math.max(...xs)), miny: r(Math.min(...ys)), maxy: r(Math.max(...ys)), minz: r(Math.min(...zs)), topcuts: mv.filter(m => m.z > -7.05 && m.z < -0.01).length, say: document.querySelector('#swarf-run')?.innerText.match(/front-left corner of your board/) ? 1 : 0 };
  });
  console.log('   cut:', JSON.stringify(cut));
  // part 50..150 x 45..105 inside the board; the outline runs a bit's radius outside it (up to 6.35 mm)
  check(cut.minx > 50 - 7 && cut.minx < 50 + 0.5 && cut.maxx < 150 + 7 && cut.maxx > 150 - 0.5, `across: the cut sits 50 mm in from the board's left edge (${cut.minx}..${cut.maxx})`);
  check(cut.miny > 45 - 7 && cut.miny < 45 + 0.5 && cut.maxy < 105 + 7 && cut.maxy > 105 - 0.5, `back: 45 mm in from the board's front edge (${cut.miny}..${cut.maxy})`);
  check(cut.minz <= -18.9 && cut.minz > -21, `the outline goes through the 19 mm board (${cut.minz})`);
  check(cut.topcuts > 0, `the top is cut down to the part (${cut.topcuts} moves between Z 0 and -7)`);
  check(cut.say === 1, 'control names the zero: the front-left corner of your board');
  await page.evaluate(() => window.__swarfRun.close());
  await wait(600);
  // concerns: too small, too thin
  const concern = () => page.evaluate(() => [...document.querySelectorAll('#swarf-concerns-body .swarf-concern strong')].map(e => e.textContent).filter(t => /board/.test(t)));
  await page.evaluate(() => { const f = [...document.querySelectorAll('#swarf-board-row input')]; f[0].value = '80'; f[0].dispatchEvent(new Event('change', { bubbles: true })); f[2].value = '10'; f[2].dispatchEvent(new Event('change', { bubbles: true })); });
  await wait(2500);
  const c1 = await concern();
  check(c1.some(t => /does not fit the board/.test(t)) && c1.some(t => /thicker than the board/.test(t)), `a board too small and too thin: two concerns (${c1})`);
  // off: Kiri's stock back to the part, the numbers kept
  await page.evaluate(() => [...document.querySelectorAll('#swarf-board-row button')].find(b => b.textContent === 'on').click());
  await wait(800);
  const r3 = await row();
  check(!r3.on && r3.offset === true && r3.sx === 0 && r3.sz === 0 && r3.anchor === anchor0 && r3.inputs.join() === '80,150,10', `off: the part's own stock, the anchor back to ${anchor0}, the numbers kept (${JSON.stringify(r3)})`);
  await wait(2000);
  check(!(await concern()).length, 'off: no board concerns');
  await page.evaluate(() => [...document.querySelectorAll('#swarf-board-row button')].find(b => b.textContent === 'off').click());
  await wait(500);
  check((await row()).sx === 80, 'on again: the board is back');
  await page.evaluate(() => [...document.querySelectorAll('#swarf-board-row button')].find(b => b.textContent === '×').click());
  await wait(500);
  const r4 = await row();
  check(r4.buttons.join() === 'board size' && r4.offset === true && !r4.on, `the x: one button again, the part's own stock (${JSON.stringify(r4)})`);
  check(!errors.length, `no page errors (${errors.slice(0, 3).join(' | ')})`);
} finally {
  await browser.close();
}
console.log(bad.length ? `\n${bad.length} FAILED` : '\nPASS');
process.exit(bad.length ? 1 : 0);
