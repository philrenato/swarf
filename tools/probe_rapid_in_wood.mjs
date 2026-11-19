// No rapid sideways below the top of the board, from swarf's own toolpaths: a ring 3/4 in thick,
// roughed with a 1/4 in bit, with auto tabs (the rough steps over from ring to ring inside the
// pocket and over each tab). Every sideways move under the top is a cut at feed, so control's
// check (a rapid across below the top refuses the file) never fires on a file swarf made.
//   node tools/probe_rapid_in_wood.mjs [url]
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const P = createRequire(import.meta.url)('../web/kiri/swarf-run-parse.js');
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/';
const wait = ms => new Promise(r => setTimeout(r, ms));
const bad = [], errors = [];
const check = (ok, what, info) => { console.log(ok ? 'ok  ' : 'FAIL', what, info !== undefined ? JSON.stringify(info) : ''); if (!ok) bad.push(what); };
const dir = mkdtempSync(join(tmpdir(), 'swarf-rapid-'));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: dir, protocolTimeout: 300000, args: ['--window-size=1440,900'] });
const ring = (o, i) => `<svg xmlns="http://www.w3.org/2000/svg" width="${o}mm" height="${o}mm" viewBox="0 0 ${o} ${o}"><path fill-rule="evenodd" d="M0 ${o / 2}a${o / 2} ${o / 2} 0 1 0 ${o} 0a${o / 2} ${o / 2} 0 1 0 ${-o} 0ZM${(o - i) / 2} ${o / 2}a${i / 2} ${i / 2} 0 1 0 ${i} 0a${i / 2} ${i / 2} 0 1 0 ${-i} 0Z"/></svg>`;
try {
  const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfAutoTabs && document.getElementById('swarf-material-select')), { timeout: 90000, polling: 200 });
  await wait(1500);
  await p.evaluate(() => window.kiri.api.devices.select('ShopBot.Basic')); await wait(900);
  await p.evaluate(() => { const s = document.getElementById('swarf-material-select'); s.value = 'plywood'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await wait(300);
  await p.evaluate(svg => { const a = window.kiri.api; a.platform.clear(); a.platform.load_svg(svg, 'ring', { depth: 19.05, soup: true, dpi: 0 }); }, ring(85.6, 70));
  await p.waitForFunction(() => window.kiri.api.widgets.all().length === 1, { timeout: 20000 }); await wait(800);
  const setup = await p.evaluate(() => {
    const a = window.kiri.api, s = a.conf.get();
    s.process.ops = [];
    [...document.getElementById('op-add-list').children].find(c => c.innerText.trim().toLowerCase() === 'rough')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    a.platform.select(a.widgets.all()[0]);
    window.__swarfAutoTabs.place();
    a.conf.save();
    const w = a.widgets.all()[0];
    return { ops: s.process.ops.map(o => o.type), tabs: (a.widgets.annotate(w.id).tab || []).length };
  });
  await wait(800);
  check(setup.ops.includes('rough') && setup.tabs > 0, 'a ring, a rough step and auto tabs', setup);
  // make the toolpaths, as the button does, then the file
  await p.evaluate(() => document.getElementById('act-paths')?.click());
  const made = await p.evaluate(() => new Promise(res => {
    window.kiri.api.event.on('preview.end', () => res('ok'));
    window.kiri.api.event.on('preview.error', e => res('error ' + e));
    setTimeout(() => res('timeout'), 180000);
  }));
  check(made === 'ok', 'the toolpaths are made', made);
  const text = made !== 'ok' ? '' : await p.evaluate(() => new Promise(res => { const t = setTimeout(() => res(''), 120000); window.kiri.api.function.export(g => { clearTimeout(t); res(typeof g === 'string' ? g : (g?.gcode || String(g))); }); }));
  const parsed = P.parse(text);
  const cuts = parsed.moves.filter(m => !m.rapid && Math.min(m.z, m.z0) < -0.05 && Math.hypot(m.x - m.x0, m.y - m.y0) > 0.05).length;
  check(text.length > 1000 && cuts > 100, 'the file cuts the ring', { bytes: text.length, cuts });
  const dive = P.rapidAcross(parsed);
  check(!dive, 'no rapid goes sideways below the top of the board', dive);
  check(errors.length === 0, 'no page errors', errors.slice(0, 5));
} catch (e) {
  check(false, 'probe ran: ' + e.message);
} finally {
  await b.close();
  rmSync(dir, { recursive: true, force: true });
}
console.log(bad.length ? `rapid in wood: ${bad.length} FAIL` : 'rapid in wood: ok');
process.exit(bad.length ? 1 : 0);
