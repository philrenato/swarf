// Control's cut card and the strip under the run buttons, in every skin, at 1440×900 and 1280×720
// (simulator, a disc's outline from cam, nothing zeroed):
//  - the two warnings (not zeroed in swarf, no trace) are 14 px, amber, each with its own tick under it
//  - Z not zeroed: no "Z zero is on the top of your board" tick
//  - the unknown zero said in numbers (the file's X 0 Y 0 from the bit, its Z 0 below the bit, the cut's depth)
//  - the strip says "(or skip it)" on trace only, the zero "(not set: cut will ask)"
//  - the filled button follows the ladder (zero x y first), cut stays pressable but plain
//  - the way in names the router once
//  - control's time is the export's (SwarfEstimate)
//  - at 720 high the file's warnings stand in the strip's place, the checks below
//  - a cut run from the machine's own zero ends with the finished words
//   node tools/probe_cut_card.mjs [url]     (OUT=dir saves a screenshot of each)
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const OUT = process.env.OUT || '';
const SKINS = (process.env.SKINS || 'glass,swarf,classic').split(',');
const SIZES = [[1440, 900], [1280, 720]];
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const rgb = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
// amber: red and green well above blue, red above green (never a gray)
const amber = s => { const [r, g, b] = rgb(s); return r - b > 40 && g - b > 15 && r >= g; };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 240000, userDataDir: mkdtempSync(join(tmpdir(), 'swarf-cutcard-')), args: ['--window-size=1600,1000'] });
try {
  for (const skin of SKINS) for (const [W, H] of SIZES) {
    const tag = `${skin}-${W}x${H}`;
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H });
    page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
    await page.evaluateOnNewDocument(s => { try { localStorage.setItem('swarf_phone_mode', 'off'); localStorage.setItem('swarf-skin', s); } catch (e) {} }, skin);
    const shot = async what => { if (OUT) { await wait(400); await page.screenshot({ path: join(OUT, `${tag}-${what}.png`) }); } };
    try {
      await page.goto(PAGE + (PAGE.includes('?') ? '&' : '?') + 'skin=' + skin, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfRun && window.SwarfEstimate), { timeout: 90000, polling: 200 });
      await wait(1500);
      await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic'));
      await wait(800);
      await page.evaluate(() => { const a = window.kiri.api; for (const w of a.widgets.all()) a.platform.delete(w); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#000"/></svg>', 'disc', { depth: 6, resolution: 2, segmin: 48, soup: true, dpi: 0 }); });
      await wait(600);
      await page.evaluate(() => { const el = Array.from(document.getElementById('op-add-list').children).find(c => c.innerText.trim().toLowerCase() === 'outline'); el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      await wait(400);
      await page.evaluate(() => new Promise(res => { window.kiri.api.event.on('preview.end', res); document.getElementById('act-paths')?.click(); setTimeout(res, 60000); }));
      await wait(500);
      await page.click('#swarf-step-run');
      await page.waitForFunction(() => window.__swarfRun.state.prog && window.__swarfRun.state.machine, { timeout: 60000 });
      await wait(1200);
      await shot('control');
      const scr = await page.evaluate(() => {
        const q = s => document.querySelector('#swarf-run ' + s);
        const need = q('.sr-need');
        const fill = [...document.querySelectorAll('#swarf-run button.fill')].filter(b => b.offsetParent).map(b => b.textContent.trim());
        const cut = q('.sr-actions .cut');
        const cs = getComputedStyle(cut), zxy = [...document.querySelectorAll('#swarf-run .sr-zrow button')].find(b => b.textContent.trim() === 'zero x y');
        return { need: need ? need.textContent.replace(/\u00a0/g, ' ') : '', fill, cutQuiet: cut.classList.contains('quiet'), cutBg: cs.backgroundColor, zxyBg: zxy ? getComputedStyle(zxy).backgroundColor : '', facts: q('.sr-facts').textContent,
          est: window.SwarfEstimate.words(window.SwarfEstimate.of(window.__swarfRun.state.prog.parsed, { cfg: window.SwarfEstimate.cfgFor(window.kiri.api.conf.get().device) }).seconds), warn: [...document.querySelectorAll('#swarf-run .sr-warns > div')].map(d => d.textContent) };
      });
      const skips = (scr.need.match(/or skip it/g) || []).length;
      check(skips === 1 && /traced \(or skip it\)/.test(scr.need) && /X Y zeroed \(not set: cut will ask\)/.test(scr.need) && /Z zeroed \(not set: cut will ask\)/.test(scr.need), `${tag} the strip: "${scr.need}"`);
      check(scr.fill.join() === 'zero x y' && scr.cutQuiet && scr.zxyBg !== scr.cutBg, `${tag} filled: [${scr.fill}], cut plain ${scr.cutQuiet} (cut ${scr.cutBg}, zero x y ${scr.zxyBg})`);
      if (skin === 'glass' && W === 1440) check(scr.facts.endsWith(scr.est), `control's time is the estimate's: "${scr.facts}" vs ${scr.est}`);
      // the cut card
      await page.evaluate(() => [...document.querySelectorAll('#swarf-run .sr-actions button')].find(b => b.textContent.trim() === 'cut' && b.offsetParent).click());
      await wait(800);
      await shot('cut-card');
      const card = await page.evaluate(() => {
        const c = document.querySelector('#swarf-run .sr-card');
        const warns = [...c.querySelectorAll('p.sr-warn')].map(p => { const cs = getComputedStyle(p), n = p.nextElementSibling; return { text: p.textContent, size: cs.fontSize, color: cs.color, tick: n && n.tagName === 'LABEL' ? n.textContent : '' }; });
        const ticks = [...c.querySelectorAll('label')].map(l => l.textContent);
        const way = [...c.querySelectorAll('p')].map(p => p.textContent).find(t => /^First:/.test(t)) || '';
        return { warns, ticks, way, sum: ((c.querySelector('.sr-sum') || {}).textContent || '').replace(/\u00a0/g, ' ') };
      });
      const [wz, wt] = card.warns;
      if (skin === 'glass' && W === 1440) check(card.sum.endsWith(scr.est), `the cut card's time is the same: "${card.sum}"`);
      check(card.warns.length === 2 && card.warns.every(w => w.size === '14px' && amber(w.color) && w.tick), `${tag} two warnings, 14 px amber, a tick under each: ${JSON.stringify(card.warns.map(w => [w.size, w.color, w.tick.slice(0, 30)]))}`);
      check(!!wz && /not zeroed in swarf/.test(wz.text) && /X 0 Y 0 is [\d.]+ (mm|in) from the bit/.test(wz.text) && /Z 0 is [\d.]+ (mm|in) (below|above) the bit/.test(wz.text) && /cut goes [\d.]+ (mm|in) under/.test(wz.text), `${tag} the zero in numbers: "${wz && wz.text}"`);
      check(!!wt && /No trace/.test(wt.text), `${tag} the trace warning: "${wt && wt.text}"`);
      check(!card.ticks.some(t => /^Z zero is/.test(t)), `${tag} no "Z zero is on…" tick while Z is not zeroed (${card.ticks.length} ticks)`);
      check((card.way.match(/router on/g) || []).length <= 1, `${tag} the way in names the router once: "${card.way}"`);
      // at 720 high: a file with warnings shows them in the strip's place
      if (H <= 720) {
        await page.evaluate(() => { const s = document.querySelector('#swarf-run .sr-sheet.on'); const b = s && [...s.querySelectorAll('button')].find(b => b.textContent.trim() === 'not yet'); if (b) b.click(); });
        await wait(300);
        await page.evaluate(() => { const S = window.__swarfRun.state; window.__swarfRun.loadProgram('outside.sbp', S.prog.text, 'file'); });
        await wait(800);
        await shot('control-file');
        const d12 = await page.evaluate(() => {
          const w = document.querySelector('#swarf-run .sr-warns'), need = document.querySelector('#swarf-run .sr-need');
          const lines = w ? [...w.children].map(d => ({ text: d.textContent, color: getComputedStyle(d).color, bottom: d.getBoundingClientRect().bottom })) : [];
          return { lines, warnCount: 0, needBelow: !!(need && need.closest('.sr-plan')), H: innerHeight };
        });
        check(d12.lines.length > 0 && d12.lines.every(l => amber(l.color) && l.bottom <= d12.H) && d12.needBelow, `${tag} the file's warnings in the strip's place, above the fold: ${JSON.stringify(d12.lines.map(l => [l.text.slice(0, 40), l.color, Math.round(l.bottom)]))}, the checks in the plan below ${d12.needBelow}`);
      }
      // a cut from the machine's own zero, run to its end, says it finished
      if (skin === 'glass' && W === 1440) {
        await page.evaluate(() => { window.__swarfRun.state.machine.timeScale = 200; const c = document.querySelector('#swarf-run .sr-card'); for (const b of c.querySelectorAll('input[type=checkbox]')) { b.checked = true; b.dispatchEvent(new Event('change')); } c.querySelector('.row .go').click(); });
        await page.waitForFunction(() => window.__swarfRun.state.lastDone === 'cut', { timeout: 180000 }).catch(() => {});
        // the 5 s note said as the cut starts ("Cutting from the machine's own zero…") holds the line first
        await page.waitForFunction(() => !window.__swarfRun.state.hold, { timeout: 8000 }).catch(() => {});
        await wait(500);
        const say = await page.evaluate(() => document.querySelector('#swarf-run .sr-say').textContent);
        await shot('finished');
        check(/Finished/.test(say) && /machine's own zero/.test(say) && !/press zero x y/.test(say), `a cut with no zero in swarf says it finished: "${say}"`);
      }
    } catch (e) {
      errors.push(`${tag}: ${e.message}`); console.log('ERROR', tag, e.message);
    } finally { await page.close(); }
  }
} finally {
  await browser.close();
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  console.log(bad.length ? `FAIL (${bad.length})` : 'cut card: ok');
  process.exitCode = errors.length || bad.length ? 1 : 0;
}
