// The board's thickness at the plate (review 105 fix order 4). The machine knows the top of the board, not the
// spoilboard, so the card takes a calipered number, optional. Over 1 mm from the job's thickness it warns in a
// sentence, what would follow. It never blocks, and nothing it does moves the machine.
//   node tools/probe_plate_board.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const url = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || tmpdir();
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-board-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfRun), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(800);
  const job = async (t, step = 'outline') => {
    await page.evaluate(t => { const a = window.kiri.api, s = a.conf.get(); a.platform.clear(); s.process.ops = []; a.conf.save(); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><rect width="100" height="60"/></svg>', 'board', { depth: t, resolution: 2, segmin: 48, soup: true, dpi: 0 }); }, t); await wait(900);
    await page.evaluate(step => [...document.querySelectorAll('#op-add-list > div')].find(d => d.textContent.trim() === step).click(), step); await wait(400);
    await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); document.getElementById('act-paths').click(); setTimeout(res, 60000); }));
    await page.click('#swarf-step-run');
    await page.waitForFunction(() => window.__swarfRun.state.prog && window.__swarfRun.state.machine && !window.__swarfRun.state.camBusy, { timeout: 90000 });
    await wait(800);
    await page.evaluate(() => { window.__swarfRun.state.machine.timeScale = 50; });
  };
  const btn = t => page.evaluate(t => [...document.querySelectorAll('#swarf-run button')].find(b => b.textContent === t && b.offsetParent)?.click(), t);
  const toTheCard = async () => {
    await btn('zero x y'); await wait(200);
    await btn('z plate'); await wait(400);
    await btn('touch the plate to the bit'); await wait(100);
    await page.evaluate(() => { for (const c of document.querySelectorAll('.sr-plate label input[type=checkbox]')) if (!c.checked) c.click(); }); await wait(100);
    await btn('touch off');
    await page.waitForFunction(() => /Z is zero on top/.test(document.querySelector('.sr-plate')?.textContent || ''), { timeout: 30000 });
    await wait(300);
  };
  const say = () => page.evaluate(() => { const e = document.querySelector('.sr-board-say'); return e ? { text: e.textContent, warn: e.classList.contains('warn') } : null; });
  const typed = async t => { const i = await page.$('.sr-board-in'); await i.click({ clickCount: 3 }); if (t === '') { await page.keyboard.press('Backspace'); } else await page.keyboard.type(t); await wait(150); };
  const pos = () => page.evaluate(() => { const M = window.__swarfRun.state.machine, p = M.state.pos; return { x: p.x, y: p.y, z: p.z, moving: !!M.state.moving, running: !!M.state.running }; });

  // the job is 12.7 mm, cut through
  await job(12.7);
  await toTheCard();
  const field = await page.evaluate(() => { const i = document.querySelector('.sr-board-in'); return i ? { title: i.title, value: i.value, label: i.closest('.sr-plate-t')?.textContent } : null; });
  check(!!field, 'after the touch, the card asks for the board as measured');
  if (!field) throw new Error('no field');
  await page.screenshot({ path: join(OUT, 'plate-board.png') });
  check(!!field.title && /optional/i.test(field.title + field.label) && field.value === '', `optional, empty, with a tooltip ("${field.label}")`);
  const where = await pos();
  const go = () => page.evaluate(() => [...document.querySelectorAll('.sr-card .row .go')].find(b => b.offsetParent));
  let s = await say();
  check(!s || !s.text, 'empty says nothing');
  await typed('13');
  s = await say();
  check(s && !s.warn && /within 1 mm/.test(s.text), `13 against 12.7: no warning: "${s?.text}"`);
  await typed('13.6');
  s = await say();
  check(s && !s.warn, `13.6 is within 1 mm: "${s?.text}"`);
  await typed('14');
  s = await say();
  check(s && s.warn && /short/.test(s.text), `14: over 1 mm: "${s?.text}"`);
  await typed('19');
  s = await say();
  check(s && s.warn && /stop 6\.\d+ mm short/.test(s.text), `19 is thicker: the cut stops short: "${s?.text}"`);
  await typed('6');
  s = await say();
  check(s && s.warn && /6\.\d+ mm into the spoilboard/.test(s.text), `6 is thinner: into the spoilboard: "${s?.text}"`);
  await typed('3/4');
  s = await say();
  check(s && s.warn && /19\.05 mm/.test(s.text), `3/4 is read as a length: "${s?.text}"`);
  await typed('');
  s = await say();
  check(s && !s.text, 'cleared, it says nothing again');
  await typed('6');
  // no em dash in the sentence; sentence case
  s = await say();
  check(!/—/.test(s.text) && /^[A-Z]/.test(s.text), 'the sentence reads as the rest do');
  // never blocks, never moves
  const w2 = await pos();
  check(w2.x === where.x && w2.y === where.y && w2.z === where.z && !w2.moving && !w2.running, `typing moved nothing (Z ${w2.z})`);
  await page.evaluate(() => { for (const c of document.querySelectorAll('.sr-plate label input[type=checkbox]')) if (!c.checked) c.click(); }); await wait(150);
  const gone = await page.evaluate(() => { const b = [...document.querySelectorAll('.sr-card .row button')].find(b => b.textContent === 'done' && b.offsetParent); return b && !b.disabled; });
  check(gone === true, 'done is open with a warning showing: it does not block');
  await btn('done'); await wait(400);
  const line = await page.evaluate(() => document.querySelector('#swarf-run')?.innerText || '');
  check(/spoilboard/.test(line), 'the warning stays said in control after the card closes');
  const w3 = await pos();
  check(w3.z === where.z && !w3.moving, 'closing moved nothing');
  check(await page.evaluate(() => window.__swarfRun.state.zeroZ === true), 'Z is zeroed, the warning or not');

  // a file from elsewhere: no job thickness, only how deep it cuts
  await page.evaluate(() => window.__swarfRun.loadProgram('x.sbp', "'UNITS:MM\nSA\nMS,20,5\nC6\nJZ,5\nJ2,0,0\nM3,0,0,-10\nM2,20,0\nJZ,5\nC7\nEND\n", 'file')); await wait(600);
  await toTheCard();
  await typed('5');
  s = await say();
  check(s && s.warn && /file cuts 10 mm/.test(s.text) && /5 mm into the spoilboard/.test(s.text), `a file that goes through a 5 mm board: "${s?.text}"`);
  await typed('15');
  s = await say();
  check(s && !s.warn && /stays in the board/.test(s.text), `a 15 mm board holds it, nothing to warn of: "${s?.text}"`);
  check(!errors.length, `no page errors: ${errors.slice(0, 3).join(' | ')}`);
} catch (e) { check(false, `the probe stopped: ${e.message}`); }
await browser.close();
console.log(bad.length ? `FAILED ${bad.length}` : 'ALL OK');
process.exit(bad.length ? 1 : 0);
