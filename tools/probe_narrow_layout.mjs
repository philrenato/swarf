// The floating pieces of the cam view keep off each other, in the three skins, at 1440 x 900,
// 1280 x 800, 1024 x 600 and 683 x 400, with a part and three steps on the bed:
//   - the steps panel ends above the site link in the window's corner
//   - the size card sits clear of the install and version chips and the site link
//   - the concerns pill is never on the size card
//   - the open concerns list leaves the step row in reach
//   - the mm / in switch is never on the step row
//   - both zero at buttons are inside the steps panel
//   node tools/probe_narrow_layout.mjs [url] [outdir for pictures]
//   SKINS=glass SIZES=1024x600 narrow the sweep
import puppeteer from 'puppeteer-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://localhost:8080/kiri/', OUT = process.argv[3] || '';
const SKINS = (process.env.SKINS || 'glass,classic,swarf').split(',');
const SIZES = (process.env.SIZES || '1440x900,1280x800,1024x600,683x400').split(',').map(s => s.split('x').map(Number));
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [], bad = [];
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) bad.push(what); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: mkdtempSync(join(tmpdir(), 'swarf-narrow-')), args: ['--window-size=1440,900'] });
try {
  for (const skin of SKINS) for (const [W, H] of SIZES) {
    const tag = `${skin} ${W}x${H}`;
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H });
    page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
    await page.evaluateOnNewDocument(s => { try { localStorage.setItem('swarf_phone_mode', 'off'); localStorage.setItem('swarf-skin', s); } catch (e) { /* private */ } }, skin);
    await page.goto(PAGE + (PAGE.includes('?') ? '&' : '?') + 'skin=' + skin, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfShape && document.getElementById('swarf-material-select') && document.getElementById('swarf-concerns-tab')), { timeout: 90000, polling: 200 });
    await wait(1500);
    await page.evaluate(() => { const a = window.kiri.api; a.devices.select('ShopBot.Basic'); a.platform.clear(); a.conf.get().process.ops = []; a.conf.save(); a.event.alerts(true); });
    await wait(600);
    // a chamfered disc: its size card is the widest (it names the edge)
    await page.evaluate(() => window.kiri.api.platform.load_svg(window.__swarfShape.svgFor('circle', { d: 120 }), 'disc', { depth: 19.05, resolution: 2, segmin: 48, soup: true, dpi: 0, edge: { kind: 'chamfer', size: 3 } }));
    await page.waitForFunction(() => window.kiri.api.widgets.all().length === 1, { timeout: 10000 });
    await wait(900);
    await page.evaluate(() => { for (const n of ['rough', 'outline', 'drill']) [...document.querySelectorAll('#op-add-list > div')].find(d => d.textContent.trim() === n).click(); window.kiri.api.platform.deselect(); });
    await wait(900);
    // which pairs of pieces overlap by more than a pixel
    const over = pairs => page.evaluate(pairs => {
      const ID = { steps: '#panel-right', rail: '#swarf-right-rail', mark: '#swarf-watermark', inst: '#install-swarf', ver: '#ver', pill: '#swarf-concerns-tab', list: '#swarf-concerns-body', row: '#mode-tools', units: '#swarf-units', size: '#swarf-size' };
      const r = k => { const e = document.querySelector(ID[k]); if (!e) return null; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return null; const b = e.getBoundingClientRect(); return b.width > 1 && b.height > 1 ? b : null; };
      const hit = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      return pairs.filter(([a, b]) => hit(r(a), r(b))).map(p => p.join(' on '));
    }, pairs);
    const shot = what => (OUT ? page.screenshot({ path: join(OUT, `narrow-${skin}-${W}x${H}-${what}.png`) }) : null);
    let o = await over([['steps', 'mark'], ['units', 'row']]);
    await shot('bare');
    check(!o.length, `${tag}: the steps panel is off the site link, the units switch off the step row (${o.join(', ') || 'clear'})`);
    const cut = await page.evaluate(() => { const p = document.getElementById('panel-right').getBoundingClientRect(); return [...document.querySelectorAll('#swarf-origin-row button')].filter(b => b.getBoundingClientRect().right > p.right + 1).map(b => b.textContent); });
    check(!cut.length, `${tag}: both zero at buttons are inside the steps panel (${cut.join(', ') || 'both in'})`);
    await page.evaluate(() => document.getElementById('swarf-concerns-tab').click()); await wait(500);
    o = await over([['list', 'row']]);
    await shot('list');
    check(!o.length, `${tag}: the open concerns list leaves the step row in reach (${o.join(', ') || 'clear'})`);
    await page.evaluate(() => { document.getElementById('swarf-concerns-tab').click(); const a = window.kiri.api; a.platform.select(a.widgets.all()[0]); }); await wait(900);
    o = await over([['size', 'inst'], ['size', 'ver'], ['size', 'mark'], ['pill', 'size'], ['steps', 'size'], ['rail', 'size']]);
    await shot('picked');
    check(!o.length, `${tag}: with the size card up, nothing sits on it (${o.join(', ') || 'clear'})`);
    // the list opened from there stays where its pill is, and still leaves the step row in reach
    const at = () => page.evaluate(() => Math.round(document.getElementById('swarf-concerns-tab').getBoundingClientRect().top));
    const up = await page.evaluate(() => innerWidth <= 1100 || document.getElementById('swarf-concerns').classList.contains('up'));
    const y0 = await at();
    await page.evaluate(() => document.getElementById('swarf-concerns-tab').click()); await wait(500);
    const y1 = await at();
    o = await over([['list', 'row']]);
    await shot('picked-list');
    check((!up || y0 === y1) && !o.length, `${tag}: opened with a part picked, a pill by the menu bar stays there (${up ? `${y0} → ${y1}` : 'under the rail'}) and the list is off the step row (${o.join(', ') || 'clear'})`);
    await page.evaluate(() => document.getElementById('swarf-concerns-tab').click()); await wait(300);
    await page.evaluate(() => { const a = window.kiri.api; a.platform.clear(); a.conf.get().process.ops = []; a.conf.save(); });
    await wait(300);
    await page.close();
  }
  check(!errors.length, `no page errors ${errors.slice(0, 3).join(' | ')}`);
} finally {
  await browser.close();
}
console.log(bad.length ? `\n${bad.length} FAILED` : '\nPASS');
process.exit(bad.length ? 1 : 0);
