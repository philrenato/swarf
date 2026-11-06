// control pressed right after tex or draw "done" must carry the new step (review 105 B2: it loaded the
// old toolpaths, byte for byte, and said nothing). Plate + outline, toolpaths, control, back, an inlay
// painted in tex, done, control at once. The file must hold the pocket, and match what a slow press gets.
//   node tools/probe_tex_control.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const url = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-texctl-')), args: ['--window-size=1440,900'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfTex && window.__swarfRun), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(600);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80"><rect width="120" height="80"/></svg>', 'board', { depth: 19, soup: true, dpi: 0 }); });
  await wait(1500);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); });
  await page.evaluate(() => [...document.querySelectorAll('button,span,div')].find(b => b.offsetParent && b.children.length === 0 && b.textContent.trim() === 'outline').click()); await wait(800);
  // the run's file, once control has settled: its name, its moves, the words it holds
  const job = () => page.evaluate(() => { const p = window.__swarfRun.state.prog; return p ? { moves: p.parsed.moves.length, text: p.text } : null; });
  const settled = () => page.waitForFunction(() => { const s = window.__swarfRun.state; return s.open && !s.camBusy && s.prog; }, { timeout: 120000, polling: 100 }).then(() => wait(300));
  await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); document.getElementById('act-paths').click(); setTimeout(res, 60000); })); await wait(1000);
  await page.click('#swarf-step-run'); await settled();
  const before = await job();
  check(before && before.moves > 0, `control brings the outline (${before && before.moves} moves)`);
  const leave = () => page.evaluate(() => { window.__swarfRun.close(); });
  await leave(); await wait(600);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); });
  await page.click('#swarf-step-tex'); await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 15000 });
  await page.evaluate(() => {
    const S = window.__swarfTex.state(), C = window.SwarfTexCore, p = S.parts[0];
    const cx = (p.box[0] + p.box[2]) / 2, cy = (p.box[1] + p.box[3]) / 2;
    const g = C.newGrid(p.box[0] - 2, p.box[1] - 2, p.box[2] + 2, p.box[3] + 2, 0.5); C.paintWhere(g, (x, y) => Math.hypot(x - cx, y - cy) < 25, 1);
    p.marks.push({ id: 'in1', made: 'region', region: g, xf: C.IDENTITY.slice(), fill: C.newFill('waves'), ver: 1 }); S.sel = 0; S.mark = 0; p.dirty = true;
    window.__swarfTex.render();
  });
  await wait(400);
  await page.click('.tx-fill[data-fill="inlay"]');
  await page.waitForFunction(() => /About .* to cut the pocket/.test(document.querySelector('.tx-status')?.textContent || ''), { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => { const e = document.getElementById('tx-depth'); e.value = '3'; e.dispatchEvent(new Event('change')); }); await wait(300);
  // done and control in the same breath, as a hand does. While the toolpaths are made again the old
  // job is on the screen (the review's 800 ms read), and nothing may run it.
  const during = await page.evaluate(() => { document.getElementById('tx-done').click(); document.getElementById('swarf-step-run').click(); const R = window.__swarfRun.state, q = c => document.querySelector(`#swarf-run .sr-actions .${c}`); return { busy: R.camBusy, old: !!R.prog, waits: ['trace', 'air', 'cut'].filter(c => q(c).classList.contains('wait')), why: q('cut').dataset.why, say: document.querySelector('#swarf-run .sr-say')?.textContent, card: (() => { q('cut').click(); return document.querySelector('#swarf-run .sr-sheet.on .sr-card')?.innerText || ''; })() }; });
  check(during.busy && during.old, 'the old job is on screen while the toolpaths are made again');
  check(during.waits.length === 3 && /wait for the toolpaths/.test(during.why), `trace, air cut and cut wait for them (${during.waits}; ${during.why})`);
  check(/Making the toolpaths/.test(during.say), `the sentence says so (${during.say})`);
  check(!/safety glasses/i.test(during.card), 'cut opens no checklist on the old job');
  await page.evaluate(() => document.querySelector('#swarf-run .sr-sheet')?.classList.remove('on'));
  await settled();
  const after = await page.evaluate(() => document.querySelector('#swarf-run .sr-actions .cut').dataset.why);
  check(!/wait for the toolpaths/.test(after), `when they are done nothing still waits for them (${after})`);
  const fast = await job();
  const ops = await page.evaluate(() => window.kiri.api.conf.get().process.ops.map(o => o.type));
  check(ops.includes('inlay'), `the inlay step is there (${ops})`);
  check(fast.text !== before.text, `control at once is not the old file (${before.moves} → ${fast.moves} moves)`);
  check(fast.moves > before.moves + 50, `control at once carries the pocket (${before.moves} → ${fast.moves} moves)`);
  await leave(); await wait(8000);
  await page.click('#swarf-step-run'); await settled();
  const slow = await job();
  check(slow.text === fast.text, `a slow press gets the same file (${fast.moves}, ${slow.moves} moves)`);
  check(!errors.length, `no page errors (${errors.join(' | ')})`);
} catch (e) { check(false, 'threw: ' + e.message); }
await browser.close();
console.log(bad.length ? `tex control: ${bad.length} failed` : 'tex control: ok');
process.exit(bad.length ? 1 : 0);
