// Z plate in the simulator (Phil 10-27: "auto z depth with the touch off tool.
// Like the SB software has, but more tightly integrated"). After zero x y the
// z plate button is the next thing to press; the card's touch off stays shut
// until the three checks are ticked and the plate has touched the bit; touch
// off finds the board's real top (after a wrong Z zero made by hand) and leaves
// the bit 25.4 mm above it; the card then asks for the plate back; the plate
// thickness typed in the card is kept.
//   node tools/probe_plate_sim.mjs [url]
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '/tmp/swarf-plate';
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
  await page.evaluate(() => { try { localStorage.removeItem('swarf-plate-thickness'); } catch (e) {} window.kiri.api.devices.select('ShopBot.Basic'); });
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
  const m = () => page.evaluate(() => { const M = window.__swarfRun.state.machine; return { z: +M.state.pos.z.toFixed(3), board: +M.boardZ.toFixed(3), note: M.state.note, moving: M.state.moving }; });
  await page.evaluate(() => { window.__swarfRun.state.machine.timeScale = 50; });
  // a wrong Z zero by hand: 10 mm down from the start, called zero
  const jogTo = async (dz, z) => { await page.evaluate(d => window.__swarfRun.state.machine.jog('z', d), dz); await page.waitForFunction(z => { const M = window.__swarfRun.state.machine; return !M.busy() && Math.abs(M.state.pos.z - z) < 1e-6; }, { timeout: 10000 }, z); };
  await jogTo(-10, 15.4);
  await btn('zero x y');
  await btn('zero z');
  await wait(200);
  let s = await m();
  check(s.z === 0 && s.board === -15.4, `a wrong zero: Z reads ${s.z}, the board top is really at Z ${s.board}`);
  // the plate button is the next thing once X Y is zeroed (zero z was by eye; a tool change or a fresh zero asks again)
  await page.evaluate(() => { window.__swarfRun.state.zeroZ = false; });
  await btn('zero x y');
  await wait(200);
  const next = await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-zrow button')].find(b => b.textContent === 'z plate').classList.contains('next'));
  const said = await page.evaluate(() => document.querySelector('.sr-say').textContent);
  check(next && /press z plate/.test(said), `after zero x y, z plate is next: "${said}"`);
  // jog up to 30 mm over the board for the plate
  await jogTo(30, 30);                        // Z reads 30, really 45.4 over the board
  await btn('z plate');
  await page.waitForFunction(() => document.querySelector('#swarf-run .sr-sheet.on .sr-plate'), { timeout: 5000 });
  const go = () => page.evaluate(() => { const g = document.querySelector('#swarf-run .sr-sheet.on .go'); return { t: g.textContent, d: g.disabled }; });
  // a plate 6.35 thick (typed), the checks, then the stand-in touch
  await page.evaluate(() => { const i = document.querySelector('#swarf-run .sr-plate-t input'); i.value = '6.35'; i.dispatchEvent(new Event('change')); });
  const g0 = await go();
  await page.evaluate(() => { for (const c of [...document.querySelectorAll('#swarf-run .sr-plate input[type=checkbox]')].slice(0, 3)) c.click(); });
  const g1 = await go();
  await btn('touch the plate to the bit');
  const g2 = await go();
  check(g0.d && g1.d && !g2.d && g2.t === 'touch off', `touch off opens only after the checks and the touch (${g0.d}, ${g1.d}, ${g2.d})`);
  await page.screenshot({ path: `${OUT}-card.png` });
  await page.evaluate(() => document.querySelector('#swarf-run .sr-sheet.on .go').click());
  await page.waitForFunction(() => /^Z zeroed/.test(window.__swarfRun.state.machine.state.note), { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#swarf-run .sr-sheet.on'), { timeout: 5000 });
  s = await m();
  // the board top is Z 0 now, the plate on it 6.35, and the bit lifted to 25.4
  check(Math.abs(s.board) < 0.01 && Math.abs(s.z - 25.4) < 0.01 && /Z zeroed/.test(s.note), `touch off: board top at Z ${s.board}, bit at Z ${s.z} (${s.note})`);
  const dro = await page.evaluate(() => document.querySelectorAll('.sr-axis .v')[2].textContent);
  check(dro === '25.400', `the Z number reads ${dro}`);
  const putShut = await go();
  await page.evaluate(() => document.querySelector('#swarf-run .sr-sheet.on input[type=checkbox]').click());
  const putOpen = await go();
  await page.evaluate(() => document.querySelector('#swarf-run .sr-sheet.on .go').click());
  const closed = await page.evaluate(() => !document.querySelector('#swarf-run .sr-sheet.on') && window.__swarfRun.state.zeroZ);
  check(putShut.d && !putOpen.d && putOpen.t === 'done' && closed, 'the card asks for the plate back, then closes with Z zeroed');
  const kept = await page.evaluate(() => localStorage.getItem('swarf-plate-thickness'));
  check(kept === '6.35', `the plate's thickness is kept (${kept})`);
  // too low: the bit at or under the plate's top refuses
  await jogTo(-25.4, 0);
  const r = await page.evaluate(() => window.__swarfRun.state.machine.zZero());
  s = await m();
  check(r === false && /already reads contact/.test(s.note), `with the bit on the board it refuses: "${s.note}"`);
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `plate sim: ${bad.length} failed, ${errors.length} page errors` : 'plate sim: ok');
process.exit(bad.length || errors.length ? 1 : 0);
