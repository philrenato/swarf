// The MR-1's machine files, line by line, for a one-bit and a two-bit job, and the ShopBot's files
// for the same jobs unchanged to the byte (tools/fixtures/export-shopbot-*.sbp).
//  - start: G21 G90 G94 G17 G54; after the spindle-on line a G4 P2 dwell (spin up before the first plunge)
//  - end: S0, G4 P1, M5, a lift to clearance, M30 (the spindle brought to zero under control, then off)
//  - no M5 or M0 between two bits in one file: a two-bit job is one file per bit, each named for its
//    order and its bit, each with its own start and end; the export card saves them as one .zip and
//    says to zero Z again for each bit
//   node tools/probe_mr1_export.mjs [url]           (BASELINE=1 writes the ShopBot fixtures)
import puppeteer from 'puppeteer-core';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://127.0.0.1:8793/swarf-app/';
const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const BASELINE = !!process.env.BASELINE;
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-mr1x-')), args: ['--window-size=1440,900'] });

// a 120 x 80 x 19 board with an outline on the 1/4 in bit, and for two bits a second outline on the 1/8 in
async function job(page, device, bits) {
  await page.evaluate(d => window.kiri.api.devices.select(d), device);
  await wait(800);
  await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); const s = a.conf.get(); s.process.ops = []; a.conf.save(); });
  await wait(300);
  await page.evaluate(() => window.kiri.api.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80"><rect width="120" height="80" fill="#000"/></svg>', 'board', { depth: 19, resolution: 2, soup: true, dpi: 0 }));
  await page.waitForFunction(() => window.kiri.api.widgets.all().length === 1, { timeout: 15000 });
  await wait(800);
  await page.evaluate(() => { const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); });
  for (let i = 0; i < bits.length; i++) {
    await page.evaluate(() => { const el = [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'outline'); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await wait(500);
  }
  await page.evaluate(bits => { const a = window.kiri.api, s = a.conf.get(); s.process.ops.filter(o => o.type === 'outline').forEach((o, i) => { o.tool = bits[i]; }); a.conf.save(); a.conf.update_fields(); a.event.settings(); }, bits);
  await wait(500);
  return page.evaluate(() => new Promise(res => {
    window.kiri.api.function.export((text, out) => res({ text, files: (out && out.swarfBitFiles) || null, starts: (out && out.swarfStarts) || [] }));
    setTimeout(() => res(null), 120000);
  }));
}
const lines = t => t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(4000);
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && document.getElementById('swarf-material-select') && window.SwarfEstimate), { timeout: 90000, polling: 200 });
  await wait(1500);
  await page.evaluate(() => window.__swarfSetMaterial('hardwood'));

  // ---- the ShopBot: the same file as before, to the byte ----
  for (const [tag, bits] of [['1bit', [1000]], ['2bit', [1000, 1001]]]) {
    const r = await job(page, 'ShopBot.Basic', bits);
    const f = join(FIX, `export-shopbot-${tag}.sbp`);
    if (BASELINE) { writeFileSync(f, r.text); console.log('wrote', f, r.text.length, 'bytes'); continue; }
    const was = existsSync(f) ? readFileSync(f, 'utf8') : null;
    check(r && was !== null && r.text === was, `ShopBot ${tag}: the file is the same to the byte (${r && r.text.length} bytes, fixture ${was && was.length})`);
    check(r && !r.files, `ShopBot ${tag}: one file, as before`);
  }
  if (BASELINE) throw new Error('baseline written');

  // ---- the MR-1, one bit ----
  const one = await job(page, 'Langmuir.MR-1', [1000]);
  const L1 = lines(one.text);
  console.log('    MR-1 one bit, head:', L1.slice(0, 9).join(' | '));
  console.log('    MR-1 one bit, tail:', L1.slice(-6).join(' | '));
  check(L1.slice(0, 5).join(' ') === 'G21 G90 G94 G17 G54', `starts G21 G90 G94 G17 G54 (${L1.slice(0, 5).join(' ')})`);
  const on = L1.findIndex(l => /^M0?3\b/.test(l));
  check(on > 0 && /^G4 P2$/.test(L1[on + 1]), `the spindle-on line is followed by G4 P2 (${L1[on]} | ${L1[on + 1]})`);
  const firstCut = L1.findIndex(l => /^G1\b/.test(l));
  check(on > 0 && firstCut > on + 1, 'the dwell comes before the first cutting move');
  const tail = L1.slice(-5);
  check(tail[0] === 'S0' && tail[1] === 'G4 P1' && /^M0?5$/.test(tail[2]) && /^G0 Z[\d.]+$/.test(tail[3]) && tail[4] === 'M30', `ends S0, G4 P1, M5, a lift, M30 (${tail.join(' | ')})`);
  const lift = +(tail[3].match(/Z([\d.]+)/) || [])[1];
  check(lift >= 9.99 && lift < 150, `the lift is 10 mm over the board, inside the travel (Z ${lift})`);
  check(!L1.slice(0, -5).some(l => /^M0?[05]\b|^M0?0\b/.test(l)), 'no M5 or M0 before the end');
  check(!one.files, 'one bit: one file');

  // ---- the MR-1, two bits ----
  const two = await job(page, 'Langmuir.MR-1', [1000, 1001]);
  check(!!two.files && two.files.length === 2, `two bits: two files (${two.files && two.files.length})`);
  const all = lines(two.text);
  check(!all.some(l => /^M0?0\b/.test(l)) && all.filter(l => /^M0?5$/.test(l)).length <= 1, 'the whole job carries no M0, and no M5 but the end');
  if (two.files && two.files.length === 2) {
    const [a, b] = two.files;
    console.log('    files:', two.files.map(f => f.name).join(', '));
    check(/^1-/.test(a.name) && /1-4/.test(a.name) && /^2-/.test(b.name) && /1-8/.test(b.name), `each file is named for its order and its bit (${a.name}, ${b.name})`);
    for (const [k, f] of [['first', a], ['second', b]]) {
      const L = lines(f.text);
      const ons = L.filter(l => /^M0?3\b/.test(l));
      const i = L.findIndex(l => /^M0?3\b/.test(l));
      check(L.slice(0, 5).join(' ') === 'G21 G90 G94 G17 G54', `${k} file has its own start`);
      check(ons.length === 1 && L[i + 1] === 'G4 P2', `${k} file turns the spindle on once and dwells (${ons.join(', ')})`);
      check(L.slice(-5).join(' ').match(/^S0 G4 P1 M0?5 G0 Z[\d.]+ M30$/), `${k} file has its own end (${L.slice(-5).join(' | ')})`);
      check(!L.slice(0, -5).some(l => /^M0?[05]\b/.test(l)), `${k} file has no stop inside`);
      check(L.some(l => /^G1\b/.test(l)), `${k} file cuts`);
    }
    // the second file's speed is the 1/8 in bit's: its own spindle line, not the first bit's
    const sA = (lines(a.text).find(l => /^M0?3\b/.test(l)) || '').match(/S(\d+)/), sB = (lines(b.text).find(l => /^M0?3\b/.test(l)) || '').match(/S(\d+)/);
    check(sA && sB && +sB[1] >= +sA[1], `each file runs its bit's speed (${sA && sA[1]}, ${sB && sB[1]} rpm)`);
    // the time counts one bit change
    const est = await page.evaluate((t, st) => window.SwarfEstimate.of(t, { sections: st, cfg: window.SwarfEstimate.cfgFor(window.kiri.api.conf.get().device) }), two.text, two.starts);
    check(est.changes === 1, `the estimate counts one bit change (${est.changes})`);
  }

  // ---- the export card for two bits: one .zip, and zero Z for each bit (looked at, never saved) ----
  await page.evaluate(() => document.getElementById('act-export').click());
  await page.waitForFunction(() => { const c = document.querySelector('#mod-x-any.swarf-x .swarf-x-card'); return c && c.offsetParent; }, { timeout: 60000 }).catch(() => {});
  const card = await page.evaluate(() => { const c = document.querySelector('.swarf-x-card'); return c ? { go: c.querySelector('.swarf-x-go').textContent, text: c.textContent } : null; });
  console.log('    card:', card && card.go, '|', card && card.text.replace(/\s+/g, ' ').slice(0, 260));
  check(card && /\.zip$/.test(card.go), `the save button saves a .zip (${card && card.go})`);
  check(card && /zero Z again/i.test(card.text), 'the card says to zero Z again for each bit');
  await page.evaluate(() => window.kiri.api.modal.hide()); await wait(400);

  // ---- the MR-1's time uses its own top speeds ----
  const cfg = await page.evaluate(() => window.SwarfEstimate.cfgFor(window.kiri.api.conf.get().device));
  check(Math.abs(cfg.rapid.xy - 2540 / 60) < 0.01 && Math.abs(cfg.rapid.z - 1016 / 60) < 0.01, `rapids timed at 2540 / 1016 mm/min (${(cfg.rapid.xy * 60).toFixed(0)} / ${(cfg.rapid.z * 60).toFixed(0)})`);
  const sb = await page.evaluate(() => { const E = window.SwarfEstimate; return E.cfgFor({ deviceName: 'ShopBot.Basic', feedMax: 15240, feedMaxZ: 2540 }) === E.SHOP; });
  check(sb, 'the ShopBot keeps its own timing');
} catch (e) {
  if (!BASELINE || !/baseline written/.test(e.message)) { console.log('FAIL', e.message); bad.push(e.message); }
} finally {
  await browser.close();
}
for (const e of errors) console.log('PAGE ERROR', e);
console.log(bad.length || errors.length ? `mr1 export: ${bad.length} failed, ${errors.length} page errors` : 'mr1 export: ok');
process.exit(bad.length || errors.length ? 1 : 0);
