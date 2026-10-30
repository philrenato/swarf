// Every box in TEX fits its contents (Phil 10-30: "can we make sure these boxes fit their contents?"),
// in every skin at 1440 x 900 and 1280 x 720, in the states a student meets: a texture mark (basic),
// a pierce mark (advanced), the points tool. For each of TEX's buttons, fields, pills, swatches and
// rows: no text clipped (its content wider or taller than its box), no text or picture outside its
// box or touching its edge, no row that wraps one button onto a line of its own, the card inside
// the window.
//   node tools/look_tex_fit.mjs [url] [skin ...]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome-path.mjs';
const PAGE = process.argv[2] || 'http://127.0.0.1:8139/swarf-app/';
const SKINS = process.argv.slice(3).length ? process.argv.slice(3) : ['glass', 'classic', 'swarf'];
const SIZES = [[1440, 900], [1280, 720]];
const wait = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900'] });
const found = [];
// what does not fit, in the open TEX board
const audit = (page, where) => page.evaluate(where => {
  const out = [], root = document.getElementById('swarf-draw');
  if (!root) return [`${where}: no board`];
  const vis = e => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && e.getClientRects().length; };
  const name = e => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''} "${(e.value || e.textContent || '').trim().slice(0, 28)}"`;
  const card = document.getElementById('tx-card'), cr = card.getBoundingClientRect();
  if (cr.bottom > innerHeight + 0.5 || cr.right > innerWidth + 0.5) out.push(`card past the window (${Math.round(cr.right)}, ${Math.round(cr.bottom)})`);
  const controls = [...root.querySelectorAll('button, input, select, .sd-row > span, .tx-sw span, .tx-sw img, summary, .sd-h')].filter(vis);
  for (const e of controls) {
    // only what is in view in the card (the card scrolls; the probe looks at what is shown)
    const r = e.getBoundingClientRect();
    if (card.contains(e) && (r.bottom < cr.top || r.top > cr.bottom)) continue;
    const s = getComputedStyle(e);
    if (e.tagName !== 'SELECT' && e.tagName !== 'IMG' && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) && e.clientWidth) out.push(`clipped: ${name(e)} (${e.scrollWidth}x${e.scrollHeight} in ${e.clientWidth}x${e.clientHeight})`);
    if (s.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) out.push(`cut short: ${name(e)}`);
    // a button's text and pictures inside its box, not on its edge
    if (e.tagName === 'BUTTON') {
      // its pictures and words with room round them (2 px), its words on one line
      for (const k of e.querySelectorAll('img, span')) {
        if (!vis(k)) continue;
        let q = k.getBoundingClientRect();
        if (k.tagName === 'SPAN' && k.firstChild && k.firstChild.nodeType === 3) { const rg = document.createRange(); rg.selectNodeContents(k); q = rg.getBoundingClientRect(); }
        if (q.width && (q.left < r.left + 2 || q.right > r.right - 2 || q.top < r.top + 1 || q.bottom > r.bottom - 2)) out.push(`touches its box's edge: ${name(k)} in ${name(e)}`);
      }
      const t = [...e.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
      if (t) {
        const rg = document.createRange(); rg.selectNodeContents(t); const q = rg.getBoundingClientRect(), lines = new Set([...rg.getClientRects()].map(c => Math.round(c.top)));
        if (q.width && (q.left < r.left + 2 || q.right > r.right - 2 || q.top < r.top || q.bottom > r.bottom)) out.push(`text on its edge: ${name(e)}`);
        if (lines.size > 1) out.push(`text wraps in its button: ${name(e)}`);
      }
    }
  }
  // rows: no button alone on a wrapped line
  for (const row of [...root.querySelectorAll('.sd-row, .sd-bar')].filter(vis)) {
    const kids = [...row.children].filter(k => vis(k) && k.getBoundingClientRect().width > 1);
    if (kids.length < 2) continue;
    // lines: children whose heights overlap share a line
    const lines = [];
    for (const k of kids) { const q = k.getBoundingClientRect(), L = lines.find(l => q.top < l.bottom - 2 && q.bottom > l.top + 2); if (L) { L.n++; L.top = Math.min(L.top, q.top); L.bottom = Math.max(L.bottom, q.bottom); } else lines.push({ top: q.top, bottom: q.bottom, n: 1 }); }
    if (lines.length > 1 && lines.some(l => l.n === 1) && !row.classList.contains('tx-picks')) out.push(`row wraps one alone: ${name(row)}`);
  }
  return out.map(x => `${where}: ${x}`);
}, where);
try {
  for (const skin of SKINS) for (const [w, h] of SIZES) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    await page.goto(PAGE + '?skin=' + skin, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => !!(window.kiri?.api?.platform?.load_svg && window.__swarfTex && window.SwarfSkin && window.SwarfTexCore), { timeout: 90000, polling: 200 });
    await wait(1500);
    await page.evaluate(s => { localStorage.setItem('swarf-skin', s); window.SwarfSkin.set(s); window.kiri.api.devices.select('ShopBot.Basic'); localStorage.setItem('swarf-expert', '0'); document.body.classList.remove('swarf-expert'); const a = window.kiri.api; for (const x of a.widgets.all()) a.platform.delete(x); a.platform.load_svg('<svg xmlns="http://www.w3.org/2000/svg" width="140mm" height="90mm" viewBox="0 0 140 90"><rect width="140" height="90"/></svg>', 'seat panel', { depth: 19, resolution: 2, segmin: 48, soup: true, dpi: 0 }); }, skin);
    await wait(1200);
    await page.click('#swarf-step-tex'); await wait(600);
    // two brush marks on the part, the second picked
    await page.evaluate(() => {
      const S = window.__swarfTex.state(), C = window.SwarfTexCore, p = S.parts[0];
      S.sel = 0;
      for (const [a, b] of [[[-50, -20], [10, 20]], [[20, -30], [55, 30]]]) {
        const g = C.newGrid(p.box[0] - 2, p.box[1] - 2, p.box[2] + 2, p.box[3] + 2, 0.5);
        C.stampStroke(g, a[0], a[1], b[0], b[1], 10, 1);
        p.marks.push({ id: 'fit' + p.marks.length, made: 'brush', region: g, xf: C.IDENTITY.slice(), fill: C.newFill('knurl', { tool: 1018 }), ver: 1 });
      }
      S.mark = 1; p.dirty = true; S.meshOpen = true;   // the mesh fold open too
    });
    await page.keyboard.press('b'); await wait(1500);
    found.push(...await audit(page, `${skin} ${w}x${h} texture (brush)`));
    await page.keyboard.press('h'); await wait(500);
    found.push(...await audit(page, `${skin} ${w}x${h} points`));
    await page.evaluate(() => { document.body.classList.add('swarf-expert'); });
    await page.keyboard.press('v'); await wait(200);
    await page.evaluate(() => [...document.querySelectorAll('#tx-card .tx-fill')].find(b => b.dataset.fill === 'pierce')?.click());
    await wait(1500);
    found.push(...await audit(page, `${skin} ${w}x${h} pierce (advanced)`));
    await page.evaluate(() => { document.body.classList.remove('swarf-expert'); localStorage.setItem('swarf-expert', '0'); });
    await page.close();
  }
} finally { await browser.close(); }
for (const f of found) console.log('FAIL', f);
console.log(found.length ? `tex fit: ${found.length} problems` : 'tex fit: ok');
process.exit(found.length ? 1 : 0);
