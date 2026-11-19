// TEX through the whole app, every pattern at its defaults (and pierce's kerfs and holes): a 120 x 80
// part of 3/4 in plywood with an outline and auto tabs, one mark over the whole top as TEX first gives
// it (its default numbers and bit). The toolpaths are made and the file read as control reads it:
// made, no rapid sideways below the top, router on in the wood, no deeper than the board and 2 mm;
// the texture cuts into the top (moves between 0.2 mm and its depth) inside the part; the outline
// still frees the part over its tabs. (The core's own numbers for each default: test-tex-defaults.mjs.)
//   node tools/probe_tex_torture.mjs [url] [pattern]
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
import * as C from '../web/kiri/swarf-tex-core.mjs';
const P = createRequire(import.meta.url)('../web/kiri/swarf-run-parse.js');
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const ONLY = process.argv[3];
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what, info) => { if (!ok) { console.log('FAIL', what, info !== undefined ? JSON.stringify(info) : ''); bad.push(what); } return ok; };
const dir = mkdtempSync(join(tmpdir(), 'swarf-textort-'));
const fills = [...Object.keys(C.PATTERNS).map(id => ({ id, kind: 'texture' })), ...Object.keys(C.PIERCES).map(id => ({ id, kind: 'pierce' }))].filter(f => !ONLY || f.id === ONLY);
let browser, page;
async function boot() {
  if (browser) await browser.close().catch(() => {});
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(dir, 'p-')), protocolTimeout: 900000, args: ['--window-size=1440,900'] });
  page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfTex && window.SwarfTexCore && window.__swarfAutoTabs), { timeout: 90000, polling: 250 });
  await wait(1500);
  await page.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(700);
}
try {
  await boot();
  for (const f of fills) {
    const name = `${f.kind} ${f.id}`, t0 = Date.now();
    errors.length = 0;
    try {
      await page.evaluate(() => { const a = kiri.api; a.platform.clear(); const s = a.conf.get(); s.process.ops = []; a.conf.save();
        a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="80mm" viewBox="0 0 120 80"><rect width="120" height="80"/></svg>', 'board', { depth: 19.05, soup: true, dpi: 0 }); });
      await page.waitForFunction(() => kiri.api.widgets.all().length === 1, { timeout: 20000 }); await wait(800);
      await page.evaluate(() => { const a = kiri.api; a.platform.select(a.widgets.all()[0]);
        [...document.getElementById('op-add-list').children].find(e => e.innerText.trim().toLowerCase() === 'outline')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        window.__swarfAutoTabs.set({ density: 0, scale: 0, pin: {} }); window.__swarfAutoTabs.place(); a.conf.save(); });
      await wait(500);
      await page.click('#swarf-step-tex'); await page.waitForFunction(() => window.__swarfTex.state(), { timeout: 15000 });
      const fill = await page.evaluate((id, kind) => { const S = window.__swarfTex.state(), Cc = window.SwarfTexCore, p = S.parts[0];
        const g = Cc.newGrid(p.box[0] - 2, p.box[1] - 2, p.box[2] + 2, p.box[3] + 2, 0.5); Cc.paintWhere(g, () => true, 1);
        const fill = kind === 'pierce' ? Cc.newPierce(id, { origin: [60, 40] }, 19.05) : Cc.newFill(id, { origin: [60, 40] });
        p.marks.push({ id: 'tt', made: 'region', region: g, xf: Cc.IDENTITY.slice(), fill, ver: 1 }); S.sel = 0; S.mark = 0; p.dirty = true;
        return { tool: fill.tool, depth: fill.depth ?? null }; }, f.id, f.kind);
      await page.click('#tx-done'); await wait(1500);
      const ops = await page.evaluate(() => kiri.api.conf.get().process.ops.filter(o => o.type !== '|').map(o => o.type));
      await page.evaluate(() => { window.__ttDone = null; const e = kiri.api.event; e.on('preview.end', () => window.__ttDone = window.__ttDone || 'ok'); e.on('preview.error', x => window.__ttDone = 'error ' + x); document.getElementById('act-paths')?.click(); });
      let made;
      try { await page.waitForFunction(() => !!window.__ttDone, { timeout: 600000, polling: 500 }); made = await page.evaluate(() => window.__ttDone); } catch (e) { made = 'timeout'; }
      let text = '';
      if (made === 'ok') text = await Promise.race([page.evaluate(() => new Promise(res => kiri.api.function.export(g => res(typeof g === 'string' ? g : (g?.gcode || String(g)))))), wait(300000).then(() => '')]);
      const ok = [check(made === 'ok', `${name}: toolpaths made`, made), check(ops.length >= 2, `${name}: a texture step and the outline`, ops)];
      let info = '';
      if (made === 'ok') {
        ok.push(check(text.length > 100, `${name}: a file`));
        const p = P.parse(text); let minZ = Infinity; for (const m of p.moves) if (m.z < minZ) minZ = m.z;
        ok.push(check(!/NaN|undefined/.test(text), `${name}: no NaN`));
        ok.push(check(!P.rapidAcross(p), `${name}: no rapid sideways below the top`, P.rapidAcross(p)));
        ok.push(check(!P.routerOffCut(p), `${name}: router on in the wood`, P.routerOffCut(p)));
        ok.push(check(minZ >= -21.06, `${name}: no deeper than the board and 2 mm`, minZ));
        const tex = p.moves.filter(m => !m.rapid && m.z < -0.2 && m.z > -(f.kind === 'pierce' ? 19.06 : (fill.depth || 6) + 0.06));
        ok.push(check(tex.length > 50, `${name}: the texture cuts into the top (${tex.length} moves)`));
        ok.push(check(minZ <= -18.5, `${name}: the outline still frees the part`, minZ));
        info = `bit ${fill.tool} moves ${tex.length} lowest ${minZ.toFixed(2)} lines ${text.split('\n').length}`;
      }
      ok.push(check(errors.length === 0, `${name}: no page errors`, errors.slice(0, 3)));
      console.log(`${ok.every(Boolean) ? 'ok  ' : 'FAIL'} ${name.padEnd(20)} ${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s ${info}`);
      if (made !== 'ok') await boot();
    } catch (e) {
      check(false, `${name}: case ran: ${e.message}`);
      await boot();
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}
console.log(bad.length ? `tex torture: ${bad.length} FAIL` : `tex torture: ok (${fills.length} fills)`);
process.exit(bad.length ? 1 : 0);
